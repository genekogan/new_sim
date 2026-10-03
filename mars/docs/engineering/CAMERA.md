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
| `take-sampler.ts` | `takeSampler(take)`: a `Sampler` over a recorded Take (same poses as `sampleTake`, indexed and memoised per tick). Humans are standing subjects (+ `contacts`: their grip point); components carry their catalog box corners + centre as points and `occluders`. |
| `occluders.ts` | `partOccluders(def, pose)`: kind-aware sight boxes matching the render — upright = its two 3 in posts (braces ignored), stair flight = two stringers, beams/joists/2x4/treads/plywood = their catalog box; `segmentBox` (OBB slab test). |
| `shotlist.ts` | `planShotList(windows, sampler, scene, opts)`: contiguous `[t0, t1)` shot windows, each planned by `planCameraTrack` on a time-shifted sampler, concatenated on one 1/hz grid with a cut at every boundary; merged report (per-shot findings prefixed with the shot label) plus `shots[]`. |

**Sampler.** `sampler(t) → Record<id, SubjectPose>` with `SubjectPose = {p, yaw, height?, points?, weight?}`.
The same code runs on a live runtime (entity poses) or a recorded take (its keyframes); the camera asks for nothing else.

**Subject points.** Readability uses the action's points (`points`: head, torso, hands, beam end, receiving socket…);
a standing human defaults to feet, torso, head and both hands.

**Shots.** The shot kinds are:
- `fixed {position, target}`
- `follow {subject, offset, frame, lookHeight, damping}`
- `orbit {center|subject, radius, height, period, phase, padding}`: pulls out along its ray until every subject point fits
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
     does not hide its own socket), it misses every other **part's `occluders`** (per tick, so the bay
     does not occlude before it is built) and every other human's **capsule** (r 0.2 m, h 1.7 m). A
     co-subject or `crew` member (carriers, co-workers from `takeSampler`) is see-through only for points
     within `CONTACT_RADIUS` 0.6 m of its grip. Parts and people occlude sight only, never collide.
   - it is above the `safeArea.bottom` UI band, if one is set.

   Subject score = visible fraction × min(1, projected extent / `minSize`) (default 8 % of frame
   height). Extent = max(height, bbox diagonal of its points), so a lying 12 ft upright is 3.7 m. The aggregate is a weighted mean in 0–1. Reasons name concrete objects, e.g.
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
| Framing (`camera-framing`) | A bystander in front lowers readability and the planner swings; behind the subject or as its carrier it does not. Orbiting a lying 3.66 m frame at 8 m keeps every corner in frame (≥ 0.8, never "too small"). A 0.17 safe area keeps a tight group's feet above the band. |
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
- **Not yet available:** render-side blending, debug overlays. People are capsules, not skinned bodies.
- **Safe area coupling.** `safeArea: { bottom }` tilts subject/region shots so the subject sits in the usable band and
  scores points under the band as out of frame (fixed/path stay as authored). The campus take is planned with 0.17
  for the studio replay bar (~130 px; in the e2e 1280×800 layout the canvas is 593 px tall, so it is really ~0.22, and
  the top toolbars cover ~0.18 — not modelled); the track stores it as `data.safeArea`, and the studio applies stored
  poses as-is, so restyling that bar means re-recording with a matching fraction.

## Campus take + studio replay (2026-09-27)
`node deploy/record-campus-take.mjs` rehearses the flagship on a fork of Mars 2026 (as `campus-flagship.test.ts`),
plans a 10-shot list with `planShotList` + `takeSampler` against the ±40 m campus crop plus the finished bay as
collision-only obstacles (`component: {collide, !occlude}`), and writes `public/engine/takes/flagship-campus-2026.json`
(`mars-take-replay/1`: take + camera track + step timeline + moments; 1.39 MB, gzip 235 KB — take 448 KB, camera 938 KB,
so no thinning was needed) and `manifest.json`. `--check` re-records and compares. Result (people as occluders, safe
area 0.17, `cutCost` 2.5 s, raise orbit on `A` + its crew; take `c531eaf4…`): 5976 samples at 10 Hz, 14 cuts (9 shot
boundaries + 5 that dodge passing crews; raise orbit 3 → 2), 0 invalid, 0 crossings, readability min 0.67 / mean 0.97.
The previous camera code on the same take (12 cuts) scores min 0.24, 84 samples < 0.6, under the new evaluator. The studio (`/studio`, 2026) replays it via "Replay take"
(`app/engine-view/take-replay.ts`, `app/studio/take-{host,panel}`); the camera track only drives the view when "Engine
camera" is on, and the take's poses at any t are identical either way (`e2e/studio-take.spec.ts`).

**Parts as occluders (2026-09-27):** re-planned on the same take (`c531eaf4…`, world unchanged): 16 cuts (was 14),
readability min 0.60 / mean 0.95 (was 0.67 / 0.97 under the looser model), 0 invalid; the track now stores
`data.subjects` (scored ids per sample + points when they change, `subjectReader`), payload 1.70 MB (limit raised to 2 MB).

## Verified against the render mesh (2026-09-27, `CAMERA_VERIFY.md`)
`window.__marsStudio.verifyCamera(fromT, toT, hz)` (`app/studio/camera-verify.ts`; e2e `camera-verify.spec.ts`)
ray-casts each planned pose's subject points against the rendered GLB, take parts and skinned people. Flagship take @
2 Hz: meanPlanner 0.973 vs meanReal 0.942, 0 samples hidden by the real mesh (planner ≥ 0.8, real ≤ 0.3), 9
over-conservative (bystander capsules). The gaps are take parts (not occluders here) and crew bodies (exempt), worst on
"wide on the deck" (475–478 s: p3/p4 under the seated sheets, upright A's posts). Static campus never disagrees on
this take. After per-tick part occluders, contact-only crew exemption and 0.2 m capsules: meanReal 0.963, maxAbsDiff 0.20,
1 sample differing by ≥ 0.2 (was 40).

## Chapter shot lists (W39, `chapter-shots.ts`)
The long year-build chapter takes (the 2022 east-house A+B: 13–98 min each) get their shot list from the take itself,
not from a fixed rhythm. `chapterShots(opts)` is pure and deterministic (core/math, sorted iteration); the recorder
(`deploy/record-campus-take.mjs` `chapterSpec`) calls it with the take, its step timeline, the plan steps (for each
step's actors: the crew ids in its bound params), the house footprint, the yard region and a `rate` function.
- **Activity grid** (`activityGrid`): per person, per camera sample (0.5 Hz), working = a recorded `activity` other than
  `idle` / `wait` at any tick of the sample; plus the feet position.
- **Telling steps** (`STEP_INTEREST`): work at the house (raise, pass-up, wall, stringer, tread, rail, panel) 5, beams
  4, climbing / holding 3, a cut at the station 3, carries and fetching 1; the first of each kind in the chapter +2.
- **Shots.** At each cut: the most telling step in progress (or starting within 6 s) whose actors work now; its working
  actors plus anyone working within 6 m of them. The shot ends at the next telling step after 40 s (`event`), after 90 s
  (`long`), when one of them is 9 m from the group's centre (`apart`; a group that parts within 12 s drops its farthest
  member instead), or 12 s after all of them went idle while someone else works (`idle`). Nobody working anywhere: a
  wide of the house. Every 5 min the next cut is a **wide from the yard side** (establishing over the piles, the
  cutting station and the house, alternately ±25° off the house→yard line), 12 s.
- **Angles.** The group is framed from outside the house on its side (the line from the house centre to the group),
  low for people on the ground (10°), higher on the decks. Candidates: ±30°, 0°, ±65°, ±105°, ±145°, 180° off that line
  (a repeat of the same group starts at ±65°: no jump cut) at the preferred height, 10°, 5°, 22° and +15°. With `rate`
  (`shotRater`: the desired pose every sample of the shot, 0 if the camera position is invalid, else `readability` of
  the subjects; the minimum) the first candidate rated ≥ 0.8 wins, else the best. A shot whose best is < 0.6 is split in
  two (≥ 12 s each) and each half chooses again; if a piece still reads < 0.6, the most readable one of its people (or
  someone working elsewhere) who works ≥ half the piece is framed alone, else the house wide. Identical consecutive
  shots merge (no cut to the same frame). `planShotList` then plans the list as for every take.
- **Moments** (the studio's jump buttons): the first of each named telling step — "first raise", "first beam",
  "first hand-up", "first relay" (a beam by its label), "first cut", "first pass-up", "first stringer", "first tread",
  "first post", "first wall", "first rail", "first panel", "up the frame" — at most four, plus `done`. They replace
  W31's generic `work` / `middle` / `done`.
- **Audit** (`shotActivityReport`, any shot list, also W31's): mid-chapter wides and the longest gap between them,
  frameGroup mean / max length, stretches > 20 s in which every framed person is idle while someone else works.
  `camera-chapter-shots.test.ts` checks the mechanism on a hand-made take and the shipped chapter cameras.
