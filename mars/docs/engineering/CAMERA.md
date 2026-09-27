# Camera and cinematography layer (`viewer/engine/camera/`)

This is pure, deterministic TypeScript with no three.js, DOM, wall-clock or randomness.
Cameras **only read** the world and the spatial scene. A camera track is a separate
object that points at a take by id, so re-shooting a take can never change it (SPEC §18, §21, §28; `RESEARCH.md` §9).

## Model

| File | Role |
| --- | --- |
| `geom.ts` | `CameraWorld` holds the scene obstacles (OBB footprint + `y0..y1` prisms) behind an x/z grid broadphase. It provides the segment/prism slab test (`segmentPrism`), `raycast` / `raycastAll`, `signedDistance`, `pointInside`, `nearestSolid` and `pushOut` (nearest-surface decollision). |
| `shots.ts` | Shot specs are data, and `evaluateShot(spec, sampler, t) → {position, target, fov}` evaluates them. |
| `quality.ts` | Three separate evaluators: `placement`, `readability` and `temporal`. |
| `solve.ts` | A fixed candidate family around the desired pose, decollide/deocclude costs, and `LiveSolver` (greedy with hysteresis, for live use). |
| `plan.ts` | `planCameraTrack(spec, sampler, scene, {duration, hz})` is the lookahead planner for known futures (takes). It returns `{samples, report}`. |
| `track.ts` | `toCameraTrack(id, takeId, plan)` produces the `CameraTrack` stored in `take/types.ts` (`data` = `mars-camera-track/1`). `sampleTrack(data, t)` interpolates, and holds across cuts. |
| `samplers.ts` | `walker(polyline, speed, t0, loop)` gives synthetic subject motion for tests and previews. |
| `take-sampler.ts` | `takeSampler(take)`: a `Sampler` over a recorded Take (same poses as `sampleTake`, indexed and memoised per tick). Humans are standing subjects; components carry their catalog box corners + centre as points. |
| `shotlist.ts` | `planShotList(windows, sampler, scene, opts)`: contiguous `[t0, t1)` shot windows, each planned by `planCameraTrack` on a time-shifted sampler, concatenated on one 1/hz grid with a cut at every boundary; merged report (per-shot findings prefixed with the shot label) plus `shots[]`. |

**Sampler.** `sampler(t) → Record<id, SubjectPose>` with `SubjectPose = {p, yaw, height?, points?, weight?}`.
The same code runs on a live runtime (entity poses) or a recorded take (its keyframes); the camera asks for nothing else.

**Subject points.** Readability uses the action's points (`points`: head, torso, hands, beam end, receiving socket…);
a standing human defaults to feet, torso, head and both hands.

**Shots.** The shot kinds are:
- `fixed {position, target}`
- `follow {subject, offset, frame, lookHeight, damping}`
- `orbit {center|subject, radius, height, period, phase}`
- `frameGroup {subjects, padding, azimuth, elevation}`: bounding box → sphere → fit distance for the fov and aspect
- `path {keys:[{t, position, target}]}`: non-uniform Catmull-Rom (Hermite)
- `reveal {subject|center, azimuth, from, to, t0, t1}`: smoothstep dolly and crane
- `establishing {region}`

Every kind also accepts `fov`, `subjects` (which subjects must stay readable) and `cutaway`.
Follow damping is **stateless**: it is an exponentially weighted average of the undamped pose
over the previous 3·τ seconds. Random-access evaluation therefore equals sequential evaluation
(tested), so scrubbing a take reproduces the camera exactly.

**Collision vs occlusion.** A per-kind policy (`DEFAULT_CAMERA_POLICY`) marks each obstacle as
*collide* (the camera may not enter or cross it) and/or *occlude* (it blocks sight). `glass`
(plexiglass) is collide-only: subjects behind a pane stay readable, but the camera cannot sit in
it or fly through it. A frosted-glass policy makes it occlude too (tested).

## Evaluators (kept separate on purpose)
1. **Placement validity.** The camera is invalid if it is inside a collision solid, closer than
   `MIN_CLEARANCE` = 0.3 m to one, or below y = 0.05. Moving between consecutive samples is
   checked as a swept segment. Crossing a solid is only allowed as a *cut*, never as motion.
2. **Readability.** For each point of each subject:
   - the point is in the frustum (5 % safe margin), and
   - a ray cast against the occlusion set is clear (stopping 5 cm short, so a carried load
     does not hide its own socket).

   Subject score = visible fraction × min(1, projected height / `minSize`) (default 8 % of
   frame height). The aggregate is a weighted mean in 0–1. Reasons name concrete objects, e.g.
   `subject p2 76% occluded by 'U west wall'`, `subject p1 40% outside frame`, `too small (2.1% of frame height)`.
3. **Temporal coherence.** Metrics are peak angular and linear velocity/acceleration (cuts
   excluded), key switches, A→B→A oscillations within 2 s, and the maximum number of cuts in
   any 2 s window.

## Solver and planner
- **Candidates.** The alternate family is fixed and ordered, so it is deterministic and ties
  break by priority. All alternates keep the desired target:
  - `desired`
  - `pull`: along target→camera to 0.45 m before the first collider or occluder, with a
    matching fov widen capped at 80°
  - azimuth swings `az±15…±90`
  - elevation raises `el+15/30/45`
  - `wide1.3/1.6`
  - swing+raise combinations
  Invalid candidates are pushed out (decollided) by at most `maxPush` = 1.5 m. A larger push
  is teleporting, so the candidate counts as invalid instead. `variants` restricts the family.
- **Cost.** Per sample: `2·deviation + 4·(1 − readability) + badness`. Badness is 1000 when
  invalid, plus 1.5 + 4·(0.6 − r) when readability r < 0.6.
- **LiveSolver.** Keeps the current alternate while it stays valid and readable, unless another
  beats it by more than `hysteresis` (0.35) after `minHold` (1.5 s). This is ClearShot-style
  `Activate After` / `Min Duration`.
- **planCameraTrack** samples the take at `hz` (default 10) and builds the full candidate
  table. It then chooses one key per sample by **Viterbi**:
  - Each key's per-sample cost adds its worst badness over the next `lead` seconds (default 1 s).
    The plan therefore moves off a shot *before* an occlusion or collision window starts.
  - Transition costs: 0 for a continuous move on the same key, 0.5 for a small continuous
    blend to another key, and `cutCost`·hz for a cut (default 1.5 s-equivalent).
  - A move is continuous only within 6 m/s and 120°/s, with a limited fov change, and with a
    swept segment that crosses no solid. Anything else is marked `cut`.
  - Hysteresis is therefore global: flipping between near-equal alternates always costs more
    than staying.
- **Report.** The planner reports:
  - `invalidSamples`, `sweptCrossings` and `rejected` (set when either is non-zero; the plan
    fails loudly and never clips)
  - `minReadability`, `meanReadability`, `readableFraction`
  - `cuts[{t, from, to, reason}]`, where the reason names the future failure of the key being
    left, e.g. `ahead: t=5.1 s 'az+15' would cross 'tall wall'`
  - `corrections[{t0, t1, key, reason}]`
  - `reasons[]`: windows where the desired shot fails, e.g.
    `t 7.0–14.0 s: desired shot: subject p2 100% occluded by 'U west wall'`, plus crossings
  - `desired{…}` and `temporal`
- **No hidden architecture.** Occluders are ignored only with an explicit `cutaway: true`
  (inspection mode), and the report says so. Collision always applies.

## Adopted from Cinemachine
- **Decollider vs Deoccluder split** → `pushOut` (placement) is separate from the `pull`
  candidate and readability scoring (line of sight). Both use layer-like per-kind policies,
  and transparent layers match `glass`.
- **Deoccluder strategies** → *Pull Forward* (`pull`), preserve distance (`az±`), and raise
  (`el+`). Shot quality is scored even when no avoidance is needed.
- **Group framing** → `frameGroup` uses the bounding sphere of all subject points, fitted to
  the fov and aspect ratio.
- **ClearShot** → the candidate set is scored by quality. The live selector uses hysteresis and
  a minimum hold time.
- **Damping** → a stateless exponentially weighted follow.

## Deliberately different
- **Future knowledge.** For takes the planner optimises over the whole shot, where Cinemachine
  only looks ahead a short time. Cuts are chosen *before* occlusion and are explained.
- **Output is data.** Tracks store resolved, quantised poses (q6), so they hash deterministically
  (tested) and replay without re-solving. Damping cannot move the camera into geometry, because
  every stored sample is re-validated.
- **Subject is a set of action points**, not a single transform.
- **No silent fixes.** An impossible shot produces `rejected` plus reasons, never a clipped camera.

## Proofs (`engine/test/camera*.test.ts`)
| Test | What it proves |
| --- | --- |
| Geometry | Slab test, rotated OBB, y range, SDF, 0.3 m clearance, pushout, glass policy, readability reasons, partial occlusion over a wall, frustum, size, cutaway. |
| Wall collision | A path keyed through `wall` is corrected by rising over it: no sample inside, no swept crossing. The same path through a 40 m wall is forced into exactly one explained cut. Impossible clearance → `rejected`. |
| U occlusion | A walker enters the U behind a west-side follow camera. The desired shot is unreadable from 7 s. The plan leaves the desired shot at 6 s, keeps readability ≥ 0.6 on every frame, and has zero invalid samples or crossings. |
| Glass | A subject behind the pane gives readability 1 with no correction. A path through the pane never crosses it. |
| Hysteresis | Mirror-image alternates with a swaying subject: greedy without hysteresis flips 10× (9 oscillations); LiveSolver and the planner give 0 oscillations. |
| Replay independence | Runtime walk hashes are identical with and without live camera solving. Two different planned tracks leave the world hash unchanged. |
| Determinism | The plan hash is identical across runs, and the track round-trips through JSON. |
| Perf | A 60 s track at 10 Hz with 3 subjects plans in about 60–80 ms (budget 1 s). |

<sub>Perf row re-checked 2026-09-27: 69 ms, via `cd viewer && node --test --test-name-pattern="perf" engine/test/camera-replay.test.ts` (camera.test.ts has no perf test).</sub>

## Limitations and next steps
- **Visibility uses obstacle prisms only.** It is not the full-resolution render mesh: beams,
  roof overhangs, slanted parts and thin members are represented only as far as the
  SpatialScene has them. Pitched or rolled components are bounded by their footprint prism,
  which is conservative for collision and can over-occlude.
- **Browser verification.** The renderer could verify a planned track with GPU picking. Render
  an ID buffer per sample (or subsample), count the pixels per subject id versus an
  unoccluded render, and report the disagreement against the prism estimate. The render mesh
  would be ground truth for visibility, while the prism model stays authoritative for
  deterministic planning.
- **The camera is a point with clearance**, not a swept sphere, for crossing tests. Clearance
  is enforced at the samples (0.3 m at 10 Hz and ≤ 6 m/s), so a corner can be clipped by up to
  about 0.3 m between samples. Raise `hz` for tight interiors.
- **Candidates are local to the desired target.** There is no global search, cross-subject
  cutting or reverse-angle grammar yet. Viterbi does not enforce a hard minimum shot length
  (the cut cost does this in practice, and `temporal.cutsPer2s` reports it).
- **Not yet available:** render-side blending, debug overlays. Bystanders are not occluders: people and moving
  parts are never in the occlusion set, so another person can stand between the camera and the subject.

## Campus take + studio replay (2026-09-27)
`node deploy/record-campus-take.mjs` rehearses the flagship on a fork of Mars 2026 (as `campus-flagship.test.ts`),
plans a 10-shot list with `planShotList` + `takeSampler` against the ±40 m campus crop plus the finished bay as
collision-only obstacles (`component: {collide, !occlude}`), and writes `public/engine/takes/flagship-campus-2026.json`
(`mars-take-replay/1`: take + camera track + step timeline + moments; 1.41 MB, gzip 206 KB — take 501 KB, camera 904 KB,
so no thinning was needed) and `manifest.json`. `--check` re-records and compares. Result: 6089 samples at 10 Hz, 12 cuts
(9 shot boundaries + 3 in the raise orbit where a crew member walks out of frame), 0 invalid, 0 crossings, readability
min 0.72 / mean 0.98, planned in ~2.3 s. The studio (`/studio`, 2026) replays it via "Replay take"
(`app/engine-view/take-replay.ts`, `app/studio/take-{host,panel}`); the camera track only drives the view when "Engine
camera" is on, and the take's poses at any t are identical either way (`e2e/studio-take.spec.ts`).
