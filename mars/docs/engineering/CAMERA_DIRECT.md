# Camera direction: words → shot program → computed trajectory (`viewer/engine/camera/{direct,synth}.ts`)

OWNER_FEEDBACK_2026-09-28 §11, **phase 1** (layers 1 and 2). A director (an LLM or a person) writes typed
`CameraDirection`s. The engine:
1. resolves every name through the semantic world, or asks a structured question;
2. **computes** the move: orbit radius from the subject's extent and the lens, sun-behind geometry from the sun
   model, interior routes through a camera navmesh, and eased timing under motion caps;
3. hands the result to the existing planner (`CAMERA.md`), which validates it.

It is deterministic, pure TypeScript, read-only over the world, and it fails loudly with a `Diagnostic`. Phase 2
(self-correction) plugs in where marked below.

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
`params`, notes, the synthesiser's own `validation`, the planner summary, and **`corrections: []`**.
`trackHash = hashOf(samples)`.

## 4. Tool: `engine_direct_camera { take_id, directions[], track_id?, hz? }`
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
| 2024 kitchen (the 2026 scene has neither) | Fly-through from (8, 1.6, 36) outside, lookAt sink | Straight line blocked by the east plywood wall. 9.1 m route over the 1.26 m half wall (entry at z 39.84). Clustered sink (bowl + rim) at (5.07, 1.01, 43.0). Viewpoint 1.8 m in front at eye height. 18 s (profile minimum 15.7 s); ≤ 16.7°/s, ≤ 29°/s², ≤ 0.87 m/s. 0 invalid, 0 crossings. The sink is readable for the last part of the move (it is behind the wall before). From the east (9, 1.6, 43) the route hairpins round the half wall's end: 26 s. |

## 6. What phase 2 adds (the data is ready for it)
- **New failure checks**, scored on every sample of the simulated shot:
  - stuck between plywood sheets or inside a rack bay (free-space radius below a minimum);
  - a person's head in the foreground (a "foreground blob" on top of the capsules);
  - the sun on the optical axis (sun-behind already refuses this; generalise it);
  - a subject leaving frame during an orbit;
  - horizon tilt;
  - the caps above;
  - the render-side raycast (CAMERA_VERIFY), with disagreements fed back as regressions.
- **Ranked corrections**, re-synthesised through `synthesizeShot(intent, ctx, prev, overrides)`:
  - *raise* → `heightOffset`
  - *widen* → `distanceScale`
  - *swing* → `bearingOffset`
  - *re-route* → `via` (navmesh waypoints)
  - *shorten* → `duration`
  - *split* / *cut* → two programs
- Each applied fix goes into `SynthShot.corrections` / the report's `corrections[]` (`DirectCorrection
  {strategy, t0, t1, reason, params}`), so a director can read why a shot changed.
- The motion-cap diagnostic already reports the peak times (`peaks.at`), which is the input *shorten* / *split*
  need.

## 7. Limits (honest)
- **No door objects in any scene:** openings are just gaps. In 2024 the kitchen is entered over a counter-height
  half wall, which is correct for that geometry but is not a "door".
- **The 2026 campus has no kitchen region and no sink fixture.** Its interiors are blocked `interior:*` prisms by
  rule (CAMPUS_SCENE.md), so interior moves are tested on 2024.
- **Take people and parts do not collide with the camera** (existing policy: occlude only). The navmesh is
  static-scene only. A route through a moving crowd is phase 2 ("foreground blob").
- **Readability of static subjects uses box points:** bounding-box corners or face points, not the mesh
  (CAMERA_VERIFY covers the mesh).
- **The navmesh is built per call** on a crop around start and goal (plus a probe mesh around the room), at about
  100–250 ms. It is cached per `SynthContext`, not across calls.
- **Look-ahead fly-throughs over hairpins are slow by design:** the view-rate cap dominates. Phase 2 *re-route*
  or a smarter look policy (looking at the destination once it is visible) would shorten them.
- **Region subjects without an assembly** get a box height from obstacles whose centres lie inside the polygon,
  or 3 m.
