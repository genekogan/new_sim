# Camera verification against the render mesh

The camera planner (`CAMERA.md`) scores readability against obstacle prisms plus bystander capsules. This pass
replays a recorded take in `/studio` and ray-casts the planner's own poses and subject points against the meshes
the studio actually draws. The planner is authoritative for deterministic planning. This pass measures how far
its visibility model is from what a viewer sees.

## How to run
- Browser hook (studio, 2026, with a take open via "Replay take"):
  `await window.__marsStudio.verifyCamera(fromT?, toT?, hz = 2)` returns the report below.
  The module is lazy-imported, so it stays out of the main chunk.
- e2e: `E2E_RUN=<run> npm run e2e -- camera-verify.spec.ts` (from `viewer/`) covers the whole flagship take at
  2 Hz. It writes `e2e/artifacts/<run>/camera-verify.json`, plus `camera-verify-t<t>.png` screenshots (engine
  camera on) of the three largest disagreements. It asserts:
  - `meanReal ≥ 0.85`
  - no *hidden by the real mesh* sample (planner ≥ 0.8 but real ≤ 0.3)
  - the self-checks below

  Runtime is about 26 s in total, of which the verification itself takes about 12.5 s for 1196 samples and
  21.7k rays under SwiftShader.

  Tip: when other agents share `viewer/test-results`, pass `--trace off --output <scratch dir>`. Otherwise a
  concurrent run can delete the trace file and fail the teardown.

## Method (`viewer/app/studio/camera-verify.ts`)
1. **Poses and subjects.** Take every `hz`-th stored track sample (`data.samples`: position, target, fov, and the
   planner's `readability`). The subjects are `shotSubjects(spec)` of the shot window containing `t`
   (`data.shots`).

   The track stores neither subject ids nor points per sample. The points are therefore rebuilt with the
   planner's own code: `takeSampler(take)` + `subjectPoints`. For humans these are the feet, torso, head and
   both hands. For parts they are the 8 catalog-box corners plus the centre.
2. **Scene.** For each sample the replay is seeked (paused) and redrawn, so the take's parts and skinned people
   are posed as rendered. The geometry comes from two sources:
   - **Static meshes** (2026 GLB, ground, scenery; about 126k triangles inside the region the track reaches).
     These are baked into a world-space triangle grid on x/z (1.5 m cells, DDA traversal, Möller–Trumbore).
   - **Take meshes** (`engine components`, `engine humans`) and any skinned or instanced mesh. These go through
     `THREE.Raycaster`.

   Excluded: hidden objects (the ambient visitors and EUC riders are hidden during a take), materials with
   `transparent && opacity < 0.6` (100 GLB meshes; this matches the planner's see-through `glass`), back-side
   domes, and the merged render batches (their original meshes are used instead, which keep their names).
3. **Visibility.** A point is visible when:
   - it is *framed*, using the planner's model unchanged: 16:9, 5 % margin, `safeArea.bottom` band; and
   - the first hit on camera→point is the subject's own mesh, or nothing within `distance − 0.1 m`.

   Subject score = visible/n × min(1, size/0.08), using the planner's size term. The sample score is the
   weighted mean. Framing and size are identical to the planner's, so planner − real isolates occlusion.
4. **Also reported:**
   - `realCrewExempt`: hits on the subject's crew count as visible, as the planner treats them.
   - `noPrism`: the engine evaluator with an empty `CameraWorld` (bystander capsules only), so
     planner − noPrism is exactly the prism occlusion.
   - The occluder mesh (take entity id, or GLB node path).
   - The self-checks:
     - `frameModelMismatch`: our framing/size equals the engine's `readability(…, {cutaway: true})` on every
       sample; it must be 0.
     - `groundRay`: a vertical control ray must hit the static meshes.

## Results: flagship campus take (`c531eaf4…`, track `cam-8c9c3f1c…`), 2026-09-27

| metric | value |
| --- | --- |
| samples (0–597.5 s @ 2 Hz) | 1196 |
| meanPlanner / meanReal | **0.973 / 0.942** (crew-exempt 0.966, noPrism 0.973) |
| maxAbsDiff, min real | 0.461, 0.389 |
| hidden by the real mesh (planner ≥ 0.8, real ≤ 0.3) | **0** |
| real worse by ≥ 0.2 | 31 samples (8 if crew hits are exempted) |
| over-conservative: strict (planner ≤ 0.3, real ≥ 0.8) / soft (real − planner ≥ 0.2) | 0 / **9** |
| occluded points by class (of 21.7k rays) | take parts 919, take people 528, static campus 5 (ground graze) |

Worst samples: all come from the "wide on the deck" shot (475–478.5 s), camera ≈ (34.3, 7.7, −14.2). The
planner scores 0.8–1.0 and the render gives 0.39–0.59. The screenshot `camera-verify-t476.0.png` shows why:
p3 and p4 stand *under* the two deck sheets s1/s2 they have just seated, and only their legs show. The near
upright **A** (blue frame posts and braces) crosses the line to two corners of each sheet and to p4.

The planner cannot see either effect:
- the take's parts are not occluders (`component: {collide, !occlude}` in `record-campus-take.mjs`, and moving
  parts are never occluders);
- the carriers are crew of their sheets, so they are exempt.

Other cases:
- 597 s, follow the visitor: the visitor, climbing the stair, is 2/5 behind upright A's posts (planner 1.0,
  real 0.6).
- 227.5 s, orbit the raise: crew p2 covers 4 of the 9 corners of the upright A being raised (real 0.65,
  crew-exempt 1.0).

Per shot, meanReal ranges from 0.82 (b1 close-up) and 0.84 (deck) up to 1.0 (establishing).

Static campus geometry never disagrees on this take. `noPrism == planner` on every sample, meaning the chosen
poses never lose readability to a prism. The ray casts find no GLB occluder either, only 5 grazing ground hits
at feet points. The staging-east site is open desert between the camera and the bay, so this take does not
exercise the prism extraction for thin or pitched members. That needs a take shot through the campus.

The over-conservative samples all come from bystander **capsules**, since noPrism equals the planner there:
- 62.5–63 s: beams carried, 0.70 vs 1.0
- 170 s: orbit, 0.70 vs 0.96
- 238 s: b1 close-up, 0.78 vs 1.0
- 255 s: 0.72 vs 1.0

A 0.28 m × 1.8 m capsule blocks rays that pass between or beside the skinned body.

## After the fix (same take, track `cam-383c6af7…`, 2026-09-27)
Fixes 1–4 below landed in `engine/camera` (`occluders.ts`, `quality.ts`, `take-sampler.ts`, `data.subjects`):

| metric | before | after |
| --- | --- | --- |
| meanPlanner / meanReal | 0.973 / 0.942 | 0.953 / **0.963** |
| maxAbsDiff, min real | 0.461, 0.389 | **0.200**, 0.511 |
| \|planner − real\| ≥ 0.2 (real worse + over-conservative) | 31 + 9 = 40 | 0 + 1 = **1** |

The planner now sees the deck and post cases, so it scores them honestly (deck shot 0.90 planner / 0.90 real). The
largest remaining gaps (≤ 0.15) are skinned bodies vs capsules in the b1 close-up; noPrism still equals the planner.

## Recommended fixes
1. **Parts as occluders, per tick.** Add the take's present components to the readability occlusion set from
   `takeSampler`: pose + catalog box, time-varying, so the finished bay does not occlude before it is built.
   Extract per catalog kind rather than using the full box:
   - sheets/decks/treads → a thin slab (full box);
   - beams/joists → a thin prism;
   - uprights (frames) → **the two posts only**. A lattice as a solid box would over-occlude badly: the camera
     should see through a rack frame.

   This removes most of the deck and visitor cases.
2. **Crew exemption only near contact.** Exempt a crew hit only within about 0.5 m of the target point (a hand
   on its own load), not across the whole body. That way, carriers under a seated sheet, or a raiser in front
   of the frame, lower the score. Alternatively, drop a load's carriers from `subjects` when the load is also a
   subject.
3. **Tighter bystander proxy.** Use about r 0.2 m, or two capsules (legs and torso+head), to remove the 9
   over-conservative samples. Re-run this pass after changing it.
4. **Record subjects per sample.** Store `subjects` (ids) per shot sample, or at least per corrected window,
   in `mars-camera-track`. Verification and debugging would then not depend on reconstructing points from
   `takeSampler`.
5. Re-run on a take whose cameras look *through* the campus (Chiba, trailers) to validate the prism extraction
   itself. This take gives no evidence either way about thin members or roof overhangs.
