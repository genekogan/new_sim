# Camera direction: words → shot program → computed trajectory → self-correction (`viewer/engine/camera/{direct,synth,solve,correct}.ts`)

OWNER_FEEDBACK_2026-09-28 §11, **phase 1** (layers 1 and 2, W16) and **phase 2** (layer 3, W18). A director (an LLM
or a person) writes typed `CameraDirection`s. The engine:
1. resolves every name through the semantic world, or asks a structured question;
2. **computes** the move: orbit radius from the subject's extent and the lens, sun-behind geometry from the sun
   model, interior routes through a camera navmesh, and eased timing under motion caps;
3. **simulates the move against the take** — people and parts per tick, the sun, the caps — scores every sample
   against named failure modes, and applies the first of seven ranked corrections that makes every sample valid,
   recording why (§6); or refuses the direction with everything it tried;
4. hands the result to the existing planner (`CAMERA.md`), which validates it.

It is deterministic, pure TypeScript, read-only over the world, and it fails loudly with a `Diagnostic`.

## 1. Vocabulary (`direct.ts`, zod; the MCP schema is generated from it)

```ts
{ subject: { kind: 'entity'|'assembly'|'region'|'group', ref },
  motion:  { verb: 'pan', direction?: 'left'|'right', degrees? } | { verb: 'tilt', direction?: 'up'|'down', degrees? }
         | { verb: 'dolly', direction?, distance? } | { verb: 'orbit', degrees, direction?: 'cw'|'ccw' }
         | { verb: 'crane', direction?: 'up'|'down', rise? } | { verb: 'push_in' } | { verb: 'pull_out' }
         | { verb: 'fly_through', from?: [x,y,z] } | { verb: 'hold' },
  duration? | speed?,            // s; deg/s (pan, tilt, orbit) or m/s (dolly, crane, push/pull, fly); not both
  at?,                           // take seconds (default: when the previous direction ends)
  framing?: { size?: 'wide'|'medium'|'close', headroom?: 0..0.4, thirds?: 'left'|'center'|'right', side?: compass8 },
  context?: { sunBehind?: true | { sunset?, flareDeg? }, interior?: region, lookAt?: fixture },
  fov?, label? }
```

The owner's sentences as data (these are exactly what the tests use):

| Sentence | Direction |
| --- | --- |
| "do a pan across Chiba with the sunset in the background" | `{subject:{kind:'region',ref:'chiba'}, motion:{verb:'pan'}, context:{sunBehind:{sunset:true}}}` |
| "do a 270° revolution around the main pallet racks over 2 minutes" | `{subject:{kind:'assembly',ref:'rack bay'}, motion:{verb:'orbit',degrees:270}, duration:120}` |
| "go inside the kitchen and face the sink" | `{subject:{kind:'region',ref:'kitchen-interior'}, motion:{verb:'fly_through'}, context:{interior:'kitchen-interior', lookAt:'sink'}}` |
| "look at this crowd of people having this activity" | `{subject:{kind:'group',ref:'<action or activity>'}, motion:{verb:'hold'}}` (or orbit) |

**Verb semantics:**
- `pan` / `tilt`: the camera is still while the view sweeps across the subject horizontally or vertically.
- `dolly`: the camera tracks sideways along the subject, keeping its view direction.
- `crane`: a vertical rise (or descent) while framing the subject.
- `push_in` / `pull_out`: wide → close, or close → wide, on a fixed bearing.
- `fly_through`: a navmesh route to a viewpoint.
- `hold`: static framing.

## 2. Resolver (`SemanticWorld`, `resolveSubject`, `resolveFixture`)

**Index.** Built once per (scene, world). Every list is kept in sorted-id order, so candidate lists come out
identically on every host.
- **entities**: `world.entities`, named by id, label, def and kind.
- **assemblies**:
  - *take structures*: connected components of the `connections` graph (for example, the flagship's upright,
    beam, joist, deck and stair parts). One containing an upright and a beam is named "rack bay" (aliases:
    pallet rack, rack, bay). Its id is `structure:<first id>`.
  - *scene assemblies*: obstacles grouped by their manifest `assembly`, labelled with the region of the same id.
- **regions**: world regions plus scene regions, named by id and label. The box height is taken from the
  assembly's obstacles.
- **fixtures**: scene obstacles grouped by manifest `component` and named by the label before " · " (for example,
  "sink bowl"), plus world fixture entities.
- **groups**: from `Facts(t)`: `takeFacts(take)` (the take's `task` / `activity` changes) or `worldFacts(world)`.

**Matching:**
1. An exact id (case-insensitive) always wins.
2. Otherwise, an exact label wins if it is unique.
3. Otherwise, every query word (lower-case, stop words dropped, simple plural stripped) must appear in the
   candidate's id or names.

**Outcomes:**
- **0 matches** → `camera.direct.unknown`. The refusal lists what is known (`details.known`).
- **more than 1 match** → `camera.direct.ambiguous`. The message is "which one?", and the details carry
  `question` plus `candidates [{kind, id, label, at}]`. It never guesses.
- **Groups:** humans whose task equals `ref`, `step:<ref>`, or has `ref` as a `:` segment, or whose activity
  equals `ref`, at the shot's start time. They are grouped by task, and more than one task means ambiguous.
- **Fixtures (`lookAt`):**
  - The search runs inside the `interior` room first, then everywhere.
  - Matching components whose boxes touch (≤ 0.3 m) are one physical thing. The 2024 "sink bowl" and "stainless
    sink rim" become one sink.
  - Separate things are a question. The three kitchen "table top"s are an example.
- **Scored members of a take structure:** readability counts only the members already in place at the shot's
  start (within 0.25 m of their final pose). Parts still on the piles are not the subject yet.

**Context checks (refusals, never silent changes):**
- `sunBehind` when the sun is set → `sun-below-horizon`.
- `sunset` while the take is lit at another time (above 12°) → `not-sunset`. The take is never relit.
- `sunBehind` with an orbit wider than the window, or with `fly_through` → `incompatible`.
- `interior` with a verb other than fly_through, hold, pan, tilt or push_in → `incompatible`.
- A shot beyond the take → `beyond-take`; an overlapping `at` → `overlap`.
- Invalid verbs and fields are rejected by zod: `camera.direct.invalid` in the library, `op.invalid-input` from
  the tool.

## 3. Synthesis (`synth.ts`) — formulas

**Framing.** A subject's bounding sphere has radius R (half-diagonal of its box and/or live points, + 0.3 m). It
is fitted with the planner's own `fitDistance(R / fill, fov, aspect, safeBottom)`:

| Size | Fill | Elevation |
| --- | --- | --- |
| wide | 0.55 | 22° |
| medium | 0.75 | 14° |
| close | 0.92 | 8° |

`headroom` re-pitches so the subject's top projects at NDC y = 1 − 2h. `thirds` turns the view by
atan(tan(hfov/2)/3). The UI band is applied with `aimForSafeArea`. Sweeps (pan, tilt, dolly) keep their authored
aim.

**Timing.** Smootherstep easing s(u) = 6u⁵ − 15u⁴ + 10u³, which is C² with zero velocity and acceleration at both
ends. Its peaks are 1.875·L/T for velocity and 5.7735·L/T² for acceleration. The minimum duration of a move of
size L is therefore T_min = max(1.875·L / v_cap, √(5.7735·L / a_cap)).
- A requested duration shorter than T_min is refused (`camera.direct.motion-cap`, "needs ≥ X s").
- A default duration is stretched to T_min.
- After synthesis the real peaks are measured on the samples (`motionPeaks`, including *when* each occurs).
  Defaults are re-timed if needed; explicit durations are refused.

**Motion caps** (`MOTION_CAPS`, measured peaks):

| Quantity | Cap | Reason |
| --- | --- | --- |
| View angular velocity | 20°/s | a 79° frame crosses in ≥ 4 s |
| View angular acceleration | 30°/s² | |
| Camera speed | 6 m/s outside | the planner's continuity limit |
| Camera speed | 1.5 m/s inside a room | |
| Linear acceleration | 2 m/s² | |

Default speeds: pan 8°/s, tilt 6°/s, orbit 6°/s, dolly 1 m/s, crane 0.8 m/s, push 1 m/s, fly 1 m/s. Hold: 5 s.

**Orbit:**
- R is the largest extent about the centre over the whole window, sampled every 0.5 s.
- d = fit(R); horizontal radius r = d·cos el; height = centre + d·sin el.
- Heading: h(t) = h₀ ± θ·s(u). `cw` means heading increases, which is clockwise seen from above.
- For people, the centre is their centroid averaged over ±1 s. The take is a known future, so this is the
  predicted path without walking jitter: the orbit follows the group.
- h₀ is forced by `side` or `sunBehind`. Otherwise it is **searched**: the previous camera's bearing plus 16
  headings, ranked by invalid samples and crossings along the whole arc, then by readability, ties to the lowest
  index.

**Pan / tilt / dolly:**
- The camera stands at distance `depth + H/fill/(2·tan(vfov/2))` from the subject's centre. Tilt uses the width
  and the horizontal fov instead.
- The pan sweep is the subject's lateral half-width w (or `degrees`): the target runs from −w to +w along the
  frame's right vector.
- Readability is scored on *focus points*: the subject's camera-facing box face at the look point's lateral
  position (25/50/75 % of its height). A sweep is not scored as if the whole subject had to be in frame.

**Sun behind** (`env/sun.ts sunBehindWindow`):
- Camera heading from the subject = sun heading + π, ± (hfov/2 − 3°). The sun stays horizontally in frame.
- View pitch ∈ [e☉ − (vfov/2 − 3°), e☉ − flare]. The sun sits above the optical axis, at least `flare` (6°) off
  it, so there is no flare on the axis and no blown-out subject.
- Pans are placed so that atan(w/d) ≤ half-width − 1°: the distance is raised when needed, with a note in the
  report.
- The pitch is kept in the upper 65 % of the window. Near the low end, perspective lifts the sun out of frame at
  the ends of a sweep.
- The camera height follows from the pitch. It never goes below 0.4 m; if it would, the look point is raised,
  with a note.
- **Every sample is then checked** against the sun model: heading inside the window, the sun projecting inside
  the frame (with margin), and at least `flare` off axis. Otherwise → `camera.direct.sun-window`.
- The report carries the heading window as world degrees and as compass degrees (`cameraCompassWindowDeg`).
- `NORTH_AZIMUTH_OFFSET` (sun.ts) remains the single north-axis assumption.

**Fly-through (camera navmesh):**
- **Layers.** Camera heights 1.0, 1.3, 1.6, 1.9 m (eye) and 2.2, 2.6, 3.0, 3.6, 4.4, 5.4, 6.6, 8.0 m (the flight
  layer, up to a roof or open sky), all above ground.
- **Rasters.** Each layer is a raster of the collision solids crossing the band [h − r, h + r], built with
  `spatial/grid.ts buildGrids`: the same conservative OBB raster and exact EDT clearance people navigate with,
  applied to a band scene. There is one extra raster per gap between adjacent layers, for vertical moves.
- **Free nodes.** A node is free when its clearance ≥ r + one cell. The camera radius r is `MIN_CLEARANCE` = 0.3 m;
  the cell is 0.2 m.
- **Rooms and openings.** Rooms are regions (polygons). **Door openings are the gaps walls leave in the rasters**
  (the reconstruction scenes carry no door objects), and a counter-height half wall is an opening above its top.
- **Search.** A* over (layer, cell): 8-connected within a layer with no corner cutting, vertical moves at 1.2×
  their height (it prefers to stay level), 3D Euclidean heuristic, deterministic tie-breaks.
- **Smoothing.** String-pull with a grown sweep (r + 0.05 m) against the exact prisms, then a **clamped uniform
  cubic B-spline (C²)**. It is verified at every dense sample (placement ≥ 0.3 m, no swept crossing).
  Otherwise the control points are densified (1 m, 0.5 m, 0.25 m, then the navmesh nodes) until it verifies.
- **Goal viewpoint for `lookAt`.**
  - Eye height, at a fixed distance by size: close 1.2 m, medium 1.8 m, wide 2.6 m.
  - Candidates are 24 headings around the fixture. Each must be inside the room, a valid placement, free on the
    navmesh, and have a clear sight line to the fixture top.
  - Ranked by closeness to the fixture's front (the direction toward the room's area centroid).
- **Look policy.** Look 4 m ahead along the route, then turn onto the final target over the last 60 % of the
  route. The blend is by angles (heading, then pitch), never a vector lerp.
- **Speed profile along the curve:**
  - v ≤ v_cap;
  - v ≤ ω_cap / |κ| and v ≤ √(½·α_cap / |κ′|), where κ is the signed view rotation per metre (smoothed over
    ±0.5 m);
  - acceleration ≤ min(a_cap, ½·α_cap / |κ|);
  - then an opening (moving minimum, then moving mean over ±0.75 m, which never exceeds any bound);
  - then forward/backward acceleration passes with v = 0 at both ends.

  The camera slows only where the view turns. A longer requested duration is a pure time dilation.
- **Report:** route length, node count, smoothing attempt, `straightLineBlockedBy` (what a naive move would have
  gone through), `usedFlightLayer`, and `entry.via` (what the route passes over at the room boundary, or which
  solids flank the opening).

**Program and validation.**
- Each direction becomes one `path` shot with dense keys at 1/hz. This is an existing shot type, so no new kind
  was needed.
- `fixed` holds fill any gap before or between directions.
- `planShotList` plans the program with **alternates off** (`variants: []`), so the stored track is the computed
  move and the report is the planner's truth about it: invalid samples, swept crossings, readability, cuts.
- `DirectInput.variants` can re-enable the planner's local alternates.
- Static subjects are scored through injected `focus:<i>` subject points.

**Report (per shot):** resolved subject (kind, ref, id, label, scored ids), interior, lookAt, the computed
`params`, notes, the synthesiser's own `validation`, the planner summary, the phase-2 **`simulation`** and
**`corrections`** (§6). `trackHash = hashOf(samples)`. A split shot reports as two shots (the second labelled
`… (after the cut)`).

## 4. Tool: `engine_direct_camera { take_id, directions[], track_id?, hz?, correct? }`
- `correct` (default true) runs phase 2; `false` returns the computed move as is (phase 1) — a different `track_id`.
- Resolves against `take.finalState` (entities, regions, light), the take's sampler and `takeFacts`, and the
  campus scene of the take.
- Stores the track beside the take (`kind: 'directed'`, id `dir-<hash>`). The take and its hash are untouched.
- Returns `track_id`, 1 Hz keyframes and the report.
- Refusals are `{ok:false, code, message, diagnostics}`. The ambiguity code carries the candidates.

## 5. Results (2026-09-28)

| Take | Direction | Computed |
| --- | --- | --- |
| Flagship take, bay orbit from `seat_b1` start (≈226 s) | 270° over 120 s, wide | Structure `structure:A` (24 parts), scored A + B. R 3.47 m → distance 14.94 m, orbit radius 13.86 m, height 7.27 m. Start heading searched (north). View ≤ 3.9°/s. Planner: 0 invalid, 0 crossings, readability min 0.67 / mean 0.94, readable 100 %. At least two crew members move more than 1 m inside the bay's footprint during the orbit (tested). |
| 2026 Chiba, 17:18 (20 min before sunset) | Pan | Sun az 258.3°, el 3.72°. Camera heading window compass 41.6–114.9°, pitch window −18.3…−2.3°. Distance raised to 31.07 m, camera 5.35 m up. 71.3° sweep in 8.9 s. 90 / 90 samples in the window with the sun in frame, min 7.05° off axis. Readability 1.0. At the take's own 16:00 light (sun ~19° up) the same pan works looking up. |
| 2024 kitchen (the 2026 scene has neither) | Fly-through from (8, 1.6, 36) outside, lookAt sink | Straight line blocked by the east plywood wall. 9.1 m route over the 1.26 m half wall (entry at z 39.84) — in fact through the 0.79 m hatch above it, which phase 2 flags and splits (§6.4). Clustered sink (bowl + rim) at (5.07, 1.01, 43.0). Viewpoint 1.8 m in front at eye height. 18 s (profile minimum 15.7 s); ≤ 16.7°/s, ≤ 29°/s², ≤ 0.87 m/s. 0 invalid, 0 crossings. The sink is readable for the last part of the move (it is behind the wall before). From the east (9, 1.6, 43) the route hairpins round the half wall's end: 26 s. |

## 6. Phase 2: self-correction (`solve.ts` `scoreShot`, `correct.ts` `correctShot`)

Every synthesized shot is **simulated against the take** before it is committed: every sample (1/hz) is scored
against the take's people and parts *at that tick* (`takeSampler`), the static scene, the sun at the take's datetime
and the motion caps. A shot is **valid** when no sample fails. An invalid shot goes through **ranked, explicit
corrections**, each candidate re-synthesized (`synthesizeShot(intent, ctx, prev, overrides)`) and re-simulated; the
first candidate valid on every sample wins and is recorded. If nothing works the direction is refused with the list
of everything tried. Deterministic (fixed ladders, fixed order, sorted ids); the camera never mutates the world.

### 6.1 Failure modes (`FAILURE_LIMITS`, `FAILURE_ORDER`)

| Kind | Per-sample check | Threshold | Counts when |
| --- | --- | --- | --- |
| `collision` | the planner's own placement (≥ 0.3 m from static solids) and swept move | `MIN_CLEARANCE` | 1 sample |
| `squeeze` | **free width** across the camera: 4 horizontal axes, both opposite rays (3 m probe) hit a static solid or a take-part box → width = the sum; **free height** over the camera body's 0.6 m square footprint (exact column test: every solid / part whose footprint overlaps bounds it above or below; only when something is above); **part clearance**: distance to the nearest take-part box (parts do not collide in the planner) | width < 1.2 m (a 0.6 m rig + 0.3 m each side: a 1.6 m door passes, two sheets 0.8 m apart do not); height < 1.0 m; part < 0.3 m | sustained: ≥ 0.3 m of camera travel or ≥ 0.5 s — crossing a door's jambs (one sample) is not a squeeze |
| `foreground` | a person (not a subject) within 1.5 m of the camera (to the capsule axis) whose projected capsule (r 0.2 m, five axis points) covers the subject's frame region (NDC box of the subject / focus points, ≥ 0.1 NDC) and is in front of the subject | cover ≥ 25 % | ≥ 3 samples (0.3 s) |
| `flare` | the sun (above the horizon, not hidden by an occluding solid within 80 m) off the optical axis | < 6° (`sunBehindWindow`'s flare) | 1 sample |
| `frame` | fraction of the subject's points inside the frame (5 % margin, UI band): people's points, focus points, and for a take structure under construction **every member whose points lie inside the structure's final box (±0.25 m) at that tick** — the extent grows during the shot | < 75 % | ≥ 3 samples; off for `fly_through` (it looks along its route) |
| `horizon` | view pitch (a look-at camera's roll is undefined near vertical); explicit key `roll` | \|pitch\| > 75°; roll > 1° | 1 sample |
| `motion` | per-sample view ω, α and camera v, a (as `motionPeaks`) | the `MOTION_CAPS` (+0.5°/s, +1°/s², +0.05 m/s, +0.1 m/s²) | 1 sample |

Each failure is a run `{ kind, t0, t1, samples, worst, detail, subjects }` (detail names what: *"free width 0.8 m
between 'part s2' and 'part s1'"*, *"person w1 0.97 m from the camera covers 73% of the subject's frame region"*,
*"sun 5.54° off the optical axis; worst 3.62°"*). The scalar `penalty` (collision 100, squeeze 10, foreground /
flare / frame 5, horizon / motion 3 per failing sample) is only for before/after reporting.

### 6.2 Ranked corrections (`STRATEGY_ORDER`, `LADDERS`, `ADDRESSES`)

Tried in this order; a strategy is tried only when it addresses a failure present; its ladder is tried in order and
the first valid magnitude wins.

| Rank | Strategy | Knob (re-synthesis) | Ladder | Addresses | n/a when |
| --- | --- | --- | --- | --- | --- |
| 1 | `raise` | `heightOffset` (camera / orbit / fixture viewpoint) | +0.5, 1, 1.5, 2.5, 4 m | collision, squeeze, foreground | — |
| 2 | `widen` | `distanceScale` (subject distance) | ×1.15, 1.3, 1.5, 1.8 | collision, squeeze, foreground, frame, horizon, motion | fly_through (fixture distance) |
| 3 | `swing` | `bearingOffset` (orbit start / hold / sweep bearing) | ±10, ±20, ±30, ±45, ±60, ±90° | collision, squeeze, foreground, flare | fly_through; for flare with a backlit shot only offsets that keep the camera heading inside the **sun-behind band** (`sunBehindWindow` heading ± (hfov/2 − 3°)), so the sun stays in frame |
| 4 | `reroute` | `navRadius` + `avoid`: the navmesh re-searched with the squeezed stretch **blocked** (a vertical slot between two static solids is blocked whole — their footprint overlap from the lower top to the upper bottom; otherwise a 0.6 m cell per failing sample) and the take's part boxes (1 Hz over the shot) as obstacles | camera radius 0.3, 0.45 m | collision, squeeze | not a routed move |
| 5 | `shorten` | `duration` = up to the first failing sample (the whole move, faster, under the caps) | one | all but motion | it would keep < 50 % of the shot (that is a cut) |
| 6 | `split` | two shots with a cut: A = the valid lead, B = the path after the failing interval re-timed to end on time (take time runs on; every window boundary is a planner cut) | one | all | < 1 s valid on either side |
| 7 | `cut` | keep the longest valid run (≥ 2 s); a dropped lead is held on the previous frame, which must be valid too | one | all | — |

A **refused synthesis** (`camera.nav.*`, `camera.direct.no-viewpoint`) is corrected the same way (raise, re-route);
the director's own constraints (explicit durations over the caps, the sun window, `beyond-take`, ambiguity) are never
changed. The refusal keeps its code and gains `details.corrections.tried`.

### 6.3 The record (`DirectShotReport.corrections[]`, `simulation`)

```ts
corrections: [{
  failure: 'collision'|'squeeze'|'foreground'|'flare'|'frame'|'horizon'|'motion'|'refused',  // the first failure in FAILURE_ORDER
  samples: { count, t0, t1 },                 // its failing samples (take s)
  strategy: 'raise'|'widen'|'swing'|'reroute'|'shorten'|'split'|'cut',
  before: { valid, failingSamples, penalty, failures: [{ kind, samples, t0, t1, worst, detail }] } | { refused, message },
  after:  { valid: true, failingSamples: 0, penalty: 0, failures: [] },
  reason: string,                             // "squeeze on 9 samples (…free width 0.8 m between 'part s2' and 'part s1'…); raised the camera 1 m (…first valid)"
  params: Record<string, number>,             // heightOffset | distanceScale | bearingOffsetDeg | cameraRadius | duration | cutAt | kept0/kept1
  t0, t1,                                     // the corrected shot
  tried:    [{ strategy, outcome: 'failed'|'n/a', why, attempts?: [{ magnitude?, result }] }],  // everything before it
  attempts: [{ magnitude?, result }],         // the chosen ladder up to the winner ("flare ×16", "flare ×10", "valid")
}]
simulation: { valid, samples, failingSamples, penalty, failures, worst: { minFreeWidth, minPartClearance,
  maxForegroundCover, minSunOffAxisDeg, minFramed, maxAbsPitchDeg, maxOmegaDeg, maxAlphaDeg, maxSpeed, maxAccel } }
```
An uncorrectable shot: `camera.direct.uncorrectable` with `details: { before, corrections: { failure, tried } }`.

### 6.4 Results (2026-09-28, `camera-correct.test.ts`, `camera-synth.test.ts`, `camera-direct.test.ts`)

| Fixture | Failure detected | Chosen |
| --- | --- | --- |
| **Stuck between plywood**: a dolly (6 m, eye level 1.7 m) across the yard plot, two 4x8 sheets standing on their short edge 0.8 m apart as take parts around its path (the planner sees nothing: parts do not collide) | squeeze on 9 samples (t 3.6–4.4 s), free width 0.80 m between `s1` and `s2` | **raise +1 m** (+0.5 m: still squeeze ×9; +1 m: over the 2.44 m tops, part clearance 0.47 m) |
| **Behind a head**: an eye-level hold (camera 1.83 m) on two people talking; `w1` walks 6 m across 0.9 m in front of the lens between 2 and 6 s | foreground on 3 samples (t 3.9–4.1 s): `w1` 0.97 m from the camera covers 73 % of the pair | **raise +0.5 m**, the whole hold (no mid-shot jump) |
| **Group outgrows the frame**: the same hold; `s2` walks 5 m away mid-shot | frame on 22 samples (t 5.9–8 s), worst half the points framed | **widen ×1.15** (raise does not address framing) |
| **Subject leaves frame**: a 270° orbit (45 s) of a crew of three walking 6 m | none: the orbit centre follows the crew (target moves 6 m), min framed 1.0 | **no correction** (`corrections: []`); the same orbit about the crew's *starting* centre fails `frame` on 91 samples (t 36–45 s, worst 0 framed) |
| **Flare**: a 30° pan from the east of the plot at 18:43 on 2026-03-20 (sun az 268.6°, el 1.8°) | flare on 7 samples (t 1.6–2.2 s), worst 3.62° off axis | **swing +20°** inside the sun-behind band (±36.66°): +10° flare ×16, −10° flare ×10, +20° valid; min 7.25° off axis, the sun in frame on most samples (a backlit pan); raise / widen n/a |
| **Impossible**: fly-through into the sealed synthetic room | `camera.nav.unreachable` | **refused**, all seven listed: raise failed (5 × unreachable), widen / swing n/a (routed), re-route failed (2 × unreachable), shorten / split / cut n/a (no track) |

**Phase-1 shots re-scored:**
- Flagship bay orbit (270° / 120 s from `seat_b1`): **valid as computed, `corrections: []`**. The structure grows
  during the orbit (members inside its final box: 5 → 7) and every in-place member is framed on every sample; min
  sun off axis 41°; ω ≤ 3.9°/s. Carry-crew orbit (90° / 20 s): valid, `[]`. Chiba sunset pan: valid, `[]`.
- **Genuine issue — 2024 kitchen move.** "Over the 1.26 m half wall" in fact threads a **0.79 m serving hatch**
  between the half wall (0.23–1.26 m) and the wall panel above (from 2.05 m) at z 39.34: free height 0.78 m on 10
  samples (0.9 s) — "stuck between two sheets of plywood". Raise: +0.5 m exceeds the caps, ≥ +1 m finds no
  eye-level viewpoint; re-route with the hatch blocked: `camera.nav.unreachable` at both radii — **the hatch is the
  only camera-sized way into the 2024 kitchen model**; shorten would keep < 50 %. → **split**: a cut at the hatch
  (5.6 s from (8, 1.6, 36); 14.1 s from the east), the move still ends on time inside, facing the sink.
- **Genuine issue — proving-ground orbit of `n1`** (the API test): the computed 90° orbit passed *inside* the
  passage west wall (8 invalid samples, 4 swept crossings, clearance −0.12 m); phase 1 left it to the planner, which
  cut away from it. Phase 2: **raise +1 m**, 0 invalid, no planner cut.

### 6.5 Render-side verification (CAMERA_VERIFY)
The render pass cannot run from node: `app/studio/camera-verify.ts verifyCamera(scene, replay)` needs the studio's
THREE scene (the GLB, skinned bodies, instanced parts) and verifies `replay.file.camera` — the camera track *inside
a take file* the studio fetches from `public/engine/takes`. A directed track lives in the controller's take store
(`attachCamera`), so no directed track can reach the pass today. What it needs (app / e2e owners): either
`verifyCamera(…, { track })` (verify any stored track of the open take, e.g. from `get_take { include: ['cameras'] }`),
or a take file written with the directed track as its `camera`. The e2e spec (`e2e/camera-verify.spec.ts`) would then
run W16's three shots and the fixtures above; any planner-vs-render gap ≥ 0.2 becomes a `camera-*.test.ts` fixture.
The last run on the recorder's track (CAMERA_VERIFY "After the fix") left one |planner − real| ≥ 0.2 sample (skinned
body vs capsule, b1 close-up) — not a directed track, so no regression is added from it.

## 7. Limits (honest)
- **No door objects in any scene:** openings are just gaps. In 2024 the only camera-sized way into the kitchen is
  the 0.79 m serving hatch above the counter-height half wall; phase 2 flags it as a squeeze and splits the move at
  it (§6.4).
- **The 2026 campus has no kitchen region and no sink fixture.** Its interiors are blocked `interior:*` prisms by
  rule (CAMPUS_SCENE.md), so interior moves are tested on 2024.
- **Take people and parts do not collide with the camera in the planner** (existing policy: occlude only). Phase 2
  checks the camera against them per tick (squeeze / part clearance, foreground people) and re-route adds the take's
  part boxes (sampled at 1 Hz, as axis-aligned prisms) to the navmesh; people are never navmesh obstacles.
- **Readability of static subjects uses box points:** bounding-box corners or face points, not the mesh
  (CAMERA_VERIFY covers the mesh).
- **The navmesh is built per call** on a crop around start and goal (plus a probe mesh around the room), at about
  100–250 ms. It is cached per `SynthContext`, not across calls.
- **Look-ahead fly-throughs over hairpins are slow by design:** the view-rate cap dominates. A smarter look policy
  (looking at the destination once it is visible) would shorten them; phase 2's re-route only avoids failures.
- **Phase 2, honestly:**
  - one correction per shot: the winning candidate must fix *every* failure at once; strategies are never combined
    (raise + swing), so a shot needing two fixes is refused rather than half-fixed;
  - static-subject readability (occlusion by the scene) is still the planner's score, not a phase-2 failure: a brief
    wall wipe in a fly-through is allowed, a subject hidden for the whole shot is only reported (`planner.minReadability`);
  - `shorten` and `cut` have no fixture where they win (raise / widen / swing fix every synthetic case first); their
    mechanics are exercised only through the refusal lists;
  - split re-times the rest of the path: for a *moving* subject its targets were computed for the original times —
    the re-simulation catches a subject that leaves the frame, but the look-at is not recomputed;
  - the squeeze thresholds (1.2 m width, 1.0 m height, 0.3 m / 0.5 s sustained) are engineering judgement (a
    steadicam-sized rig), not measured; a rack bay is only a squeeze where it is that narrow;
  - flare ignores lens-specific ghosts and haze: it is the sun direction vs the optical axis, occluded by the scene's
    prisms (not by take parts or people);
  - the render-side verification of directed tracks needs the browser and a studio change (§6.5).
- **Region subjects without an assembly** get a box height from obstacles whose centres lie inside the polygon,
  or 3 m.
