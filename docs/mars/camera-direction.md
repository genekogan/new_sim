# Camera direction

Code: `engine/camera/{direct,parse,synth,solve,correct}.ts`, `engine/api/camera-vocab.ts`. Tests:
`engine/test/camera-direct*.test.ts`, `camera-synth.test.ts`, `camera-correct.test.ts`, `camera-take-file.test.ts`.

A director (an LLM or a person) writes typed `CameraDirection`s, or sentences that parse into them. The engine:

1. resolves every name through the semantic world, or asks a structured question;
2. **computes** the move: orbit radius from the subject's extent and the lens, sun-behind geometry from the sun model,
   interior routes through a camera navmesh, eased timing under motion caps;
3. **simulates** the move against the take (people and parts per tick, the sun, the caps), scores every sample against
   named failure modes, and applies the first of seven ranked corrections that makes every sample valid, or refuses
   with everything it tried;
4. hands the result to the planner ([camera.md](camera.md)), which validates it.

It is deterministic, read-only over the world, and fails loudly with a `Diagnostic`.

## 1. Vocabulary (`direct.ts`, zod; the MCP schema is generated from it)

```ts
{ subject: { kind: 'entity'|'assembly'|'region'|'group', ref },
  motion:  { verb: 'pan', direction?: 'left'|'right', degrees? } | { verb: 'tilt', direction?: 'up'|'down', degrees? }
         | { verb: 'dolly', direction?, distance? } | { verb: 'orbit', degrees, direction?: 'cw'|'ccw' }
         | { verb: 'crane', direction?: 'up'|'down', rise? } | { verb: 'push_in' } | { verb: 'pull_out' }
         | { verb: 'fly_through', from?: [x,y,z] } | { verb: 'hold' },
  duration? | speed?,            // s; deg/s or m/s, not both
  at?,                           // take seconds (default: when the previous direction ends)
  framing?: { size?: 'wide'|'medium'|'close', headroom?: 0..0.4, thirds?: 'left'|'center'|'right', side?: compass8 },
  context?: { sunBehind?: true | { sunset?, flareDeg? }, interior?: region, lookAt?: fixture },
  fov?, label? }
```

| Sentence | Direction |
| --- | --- |
| "pan across the hall with the sunset in the background" | `{subject:{kind:'region',ref:'<hall>'}, motion:{verb:'pan'}, context:{sunBehind:{sunset:true}}}` |
| "do a 270° revolution around the main pallet racks over 2 minutes" | `{subject:{kind:'assembly',ref:'rack bay'}, motion:{verb:'orbit',degrees:270}, duration:120}` |
| "go inside the kitchen and face the sink" | `{subject:{kind:'region',ref:'kitchen-interior'}, motion:{verb:'fly_through'}, context:{interior:'kitchen-interior', lookAt:'sink'}}` |
| "look at this crowd having this activity" | `{subject:{kind:'group',ref:'<action or activity>'}, motion:{verb:'hold'}}` |

`pan`/`tilt`: the camera is still while the view sweeps. `dolly`: tracks sideways keeping its view direction. `crane`:
vertical rise or descent. `push_in`/`pull_out`: wide ↔ close on a fixed bearing. `fly_through`: a navmesh route to a
viewpoint. `hold`: static framing.

## 2. Resolver (`SemanticWorld`, `resolveSubject`, `resolveFixture`)

The index is built once per (scene, world), in sorted-id order: entities; assemblies (connected components of the
`connections` graph, where one with an upright and a beam is named "rack bay", plus scene assemblies by manifest
`assembly`); regions; fixtures (scene obstacles grouped by manifest component); groups from the take's `task` /
`activity` facts.

Matching: an exact id wins, then a unique exact label, then every query word appearing in the id or names. Zero matches
→ `camera.direct.unknown` (listing what is known); more than one → `camera.direct.ambiguous` with `question` and
`candidates` (never a guess). Touching fixture boxes (≤ 0.3 m) count as one thing. Take structures score only members
already in place at the shot's start.

Context refusals (never silent changes): `sun-below-horizon`, `not-sunset` (the take is never relit), `incompatible`
(sun-behind with a wide orbit or fly-through; interior with an unsupported verb), `beyond-take`, `overlap`; invalid
fields → `camera.direct.invalid` / `op.invalid-input`.

## 3. Synthesis (`synth.ts`)

**Framing.** A subject's bounding sphere R is fitted with the planner's `fitDistance(R / fill, fov, aspect, safeBottom)`:
wide fill 0.55 at 22° elevation, medium 0.75 at 14°, close 0.92 at 8°. `headroom` re-pitches; `thirds` turns the view.

**Timing.** Smootherstep s(u) = 6u⁵ − 15u⁴ + 10u³. A move of size L needs T ≥ max(1.875·L / v_cap, √(5.7735·L / a_cap)).
An explicit duration below that is refused (`camera.direct.motion-cap`); a default one is stretched. Real peaks are
measured on the samples afterwards.

**Motion caps** (`MOTION_CAPS`): view 20°/s and 30°/s²; camera 6 m/s outside, 1.5 m/s inside a room; 2 m/s². Default
speeds: pan 8°/s, tilt 6°/s, orbit 6°/s, dolly 1 m/s, crane 0.8 m/s, push 1 m/s, fly 1 m/s; hold 5 s.

**Orbit.** R is the largest extent over the whole window; the centre of a group is its centroid averaged over ±1 s (the
take is a known future). The start heading is forced by `side` / `sunBehind`, else searched over the previous camera's
bearing plus 16 headings.

**Sun behind** (`env/sun.ts sunBehindWindow`). Heading = sun heading + π ± (hfov/2 − 3°); pitch keeps the sun above the
axis and at least `flare` (6°) off it; every sample is then checked (`camera.direct.sun-window`).

**Fly-through.** A camera navmesh over 12 height layers (1.0–8.0 m), each a conservative raster of the solids in its band
(`spatial/grid.ts buildGrids`), free where clearance ≥ 0.3 m + one 0.2 m cell. Door openings are the gaps walls leave.
A* over (layer, cell), string-pulled, then a clamped uniform cubic B-spline verified at every dense sample. The goal
viewpoint for `lookAt` is chosen from 24 headings in front of the fixture. The speed profile slows only where the view
turns. The report names what a straight line would have gone through.

Each direction becomes one `path` shot; `fixed` holds fill gaps; `planShotList` plans the program with alternates off,
so the stored track is the computed move. `trackHash = hashOf(samples)`.

## 4. Self-correction (`solve.ts scoreShot`, `correct.ts correctShot`)

Every sample is scored against the take at that tick. Failure modes, in `FAILURE_ORDER`:

| Kind | Check | Threshold |
| --- | --- | --- |
| `collision` | planner placement and swept move | 0.3 m clearance |
| `squeeze` | free width across the camera, free height above it, distance to take parts (sustained ≥ 0.3 m or 0.5 s) | width < 1.2 m, height < 1.0 m, part < 0.3 m |
| `foreground` | a non-subject person within 1.5 m covering the subject's frame region (≥ 3 samples) | ≥ 25 % |
| `flare` | sun off the optical axis | < 6° |
| `frame` | fraction of subject points in frame (≥ 3 samples; off for fly-through) | < 75 % |
| `occluded` | planner readability, still low with the subjects' own bodies ignored (off for fly-through) | < 0.6 |
| `horizon` | view pitch / roll | > 75° / > 1° |
| `motion` | ω, α, v, a against `MOTION_CAPS` | caps + small tolerance |

Corrections, in `STRATEGY_ORDER`, each a single knob with a fixed ladder; the first valid magnitude wins:

| Rank | Strategy | Knob | Ladder |
| --- | --- | --- | --- |
| 1 | `raise` | height offset | +0.5, 1, 1.5, 2.5, 4 m |
| 2 | `widen` | distance scale | ×1.15, 1.3, 1.5, 1.8 |
| 3 | `swing` | bearing offset (inside the sun-behind band for backlit shots) | ±10 … ±90° |
| 4 | `reroute` | navmesh re-search with the squeezed stretch and take parts blocked | camera radius 0.3, 0.45 m |
| 5 | `shorten` | duration up to the first failing sample (keeps ≥ 50 %) | one |
| 6 | `split` | two shots with a cut (≥ 1 s valid each side) | one |
| 7 | `cut` | keep the longest valid run (≥ 2 s) | one |

Re-synthesis reuses the searched start heading, so a raise changes only height. Strategies are never combined: a shot
needing two fixes is refused (`camera.direct.uncorrectable` with everything tried). The director's own constraints
(explicit durations, the sun window, ambiguity) are never changed. Each shot report carries `simulation` and
`corrections[] { failure, samples, strategy, before, after, reason, params, tried, attempts }`.

## 5. Ops

- `engine_direct_camera { take_id, directions[] | sentences[], track_id?, hz?, correct? }`: resolves against the take's
  final state and campus scene, stores the track beside the take (`kind: 'directed'`, id `dir-<hash>`), returns 1 Hz
  keyframes and the report. `correct: false` returns the computed move unchanged. Sentences and their parsed directions
  give the same track id.
- `engine_parse_camera { take_id | workspace, sentences[] }`: read-only; the grammar is `camera/parse.ts`, its vocabulary
  built from the semantic world (regions, assemblies, fixtures, the activities people do in the take). Unknown verbs,
  missing angles and deictic phrases are refusals with a question.
- `engine_store_camera_track { take_id, track }`: stores an already compiled track, validated like a take-file track.
  A take's camera tracks may hold at most `MAX_TAKE_CAMERA_BYTES` = 4 MiB.
- A take file (`mars-take-replay/1`) may carry extra tracks in `cameras: { [id]: CameraTrack }`
  (`withFileCamera`, `fileCameras`, `fileCamera` in `track.ts`); the take and its hash never change.

The take sampler (`take-sampler.ts`) classifies entities by kind: only humans are capsules; components and fixtures with
a catalog def are sampled as boxes with their own occluders and leave the sampler at their removal tick.

## Render-side verification

The planner scores readability against obstacle prisms plus bystander capsules; this pass measures how far that model is
from what a viewer sees. It needs the studio's three.js scene, so it runs in the browser.

- Hook: `await window.__marsStudio.verifyCamera(fromT?, toT?, hz = 2)` with a take open (also `{ track }` for a directed
  track compiled in the browser). E2E: `e2e/camera-verify.spec.ts` writes `camera-verify.json` and screenshots of the
  largest disagreements, and asserts mean real readability ≥ 0.85 and no sample the planner rates ≥ 0.8 that the
  render rates ≤ 0.3.
- Method (`app/studio/camera-verify.ts`): take every `hz`-th track sample; rebuild subject points with the planner's own
  code (`takeSampler` + `subjectPoints`); seek the replay so parts and skinned people are posed as rendered; ray-cast
  against static meshes (a world-space triangle grid) and take meshes (`THREE.Raycaster`), skipping hidden objects and
  materials with opacity < 0.6 (the planner's see-through glass). Framing and size use the planner's model unchanged, so
  planner − real isolates occlusion. Also reported: a crew-exempt score, a prism-free score, the occluding mesh, and two
  self-checks (`frameModelMismatch` must be 0; a vertical control ray must hit the ground).
- Findings that shaped the planner: take parts occlude per tick (uprights as their two posts, sheets and beams as their
  boxes); crew members are see-through only within 0.6 m of their own grip; bystander capsules are r 0.2 m; tracks
  store their scored subjects per sample (`data.subjects`). Any planner-versus-render gap ≥ 0.2 on a directed track
  becomes a `camera-*.test.ts` fixture.

## Limits

- Openings are gaps in walls; few scenes have door objects.
- Take people and parts never collide with the camera in the planner; self-correction checks them per tick, and re-route adds part
  boxes (1 Hz, axis-aligned) to the navmesh.
- Static subjects are scored by box points, not meshes.
- The navmesh is built per call on a crop (about 100–250 ms) and cached only per synthesis context.
- Look-ahead fly-throughs over hairpins are slow by design (the view-rate cap dominates).
- `split` re-times the rest of the path without recomputing a moving subject's look-at.
- The squeeze thresholds are engineering judgement for a steadicam-sized rig.
- Flare is the sun direction against the optical axis, occluded only by scene prisms.
