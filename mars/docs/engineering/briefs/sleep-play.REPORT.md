# Supported ground sleep — standalone Play proof, 2026-10-01

Both current-rig hypothetical ground-mat journeys now pass actual Play: ordinary approach, lie down, sustained rest, continuous wake on Pause, retained same-purpose Resume, exactly 18 seconds of rest, ordinary return, real recorded resting-pose replay and three resource-stable resets. This is a standalone saved candidate, not a main integration or public sleep claim. Combined gate and later connected unfinished-purpose proof remain required.

Branch `codex/sleep-mvp`, validation base `2db9f5a`. Release34_checkpoint explicitly returned the CPU/GPU slot before any execution. Its gate/publication work was not blocked. No prepared-day draft was cherry-picked, no engine/spatial/Runtime/activity/take changes were made.

## Small current-rig corrections

- `viewer/app/engine-view/sleep.ts` adds a 0.2-radian renderer-only chin lift, smoothly fading through prone rise r=0..1 and layer weight. Existing flat prone pitch points the head face into the ground; trace vertex minima were forward of the head joint. The correction rotates the existing head transform about the actor-right axis via the existing `turn` adapter.
- `viewer/app/engine-view/humans.ts` applies that expression only with sleepPose and a prone pose. Actor height, ground support, authoritative pose, hands, claims and movement are unchanged. No rig/library migration or generalized anatomy system.
- `viewer/e2e/sleep.spec.ts` retains `recordTake()`'s returned startTick and subtracts it from restTick. Replay accepts seconds from recording start; the initial Step made the old absolute time one tick late, sampling the first wake tick. Exact replay r===0, floor limit -0.03, reset equality, deadlines and all other assertions remain unchanged. Root independently reviewed this genuine harness setup correction before the final attempt.

## Preserved failures and final checks

First unchanged 2-case run: both fail the original major floor assertion, woman head -0.039 m and casual head -0.0303 m; torso/arms/legs are above ground and authoritative violations are empty. Original log `viewer/.cloudflare/sleep-first-browser.log`; traces, decoded flat state and final trace frames preserved under `viewer/.cloudflare/sleep-first-browser-failure/`; transition captures under `viewer/e2e/artifacts/sleep-first-browser/`.

Second run with chin lift: both pass floor, interruption and exact completion, then fail exact replay r===0 (r=0.0146) because of the one-tick recording origin error. Log `viewer/.cloudflare/sleep-head-adapter-browser.log`; traces copied into `viewer/.cloudflare/sleep-head-adapter-failure/`; five captures per rig plus flat JSON under `viewer/e2e/artifacts/sleep-head-adapter-browser/`.

Final command from viewer: `E2E_VITE_PORT=5400 MARS_SIMULATION_PORT=8920 E2E_RUN=sleep-final-browser npm run e2e -- sleep.spec.ts`: **2 passed, 0 failed, 52.1 seconds**. Woman/origin uses sleeper; casual/rotated uses visitor. No retries or skipped cases. Log `viewer/.cloudflare/sleep-final-browser.log`.

`node --test engine/test/sleep.test.ts engine/test/sleep-walk.test.ts engine/test/sleep-take.test.ts`: **50 passed, 0 failed, 0 skipped**, 612.6 ms. `npx tsc --noEmit`, existing ignored e2e config `npx tsc --noEmit -p .cloudflare/sleep-e2e-tsconfig.json`, and scoped oxlint of the three edited source/spec files pass. An initial verification command guessed nonexistent tsconfig.e2e.json and failed TS5058; original log retained as `sleep-final-e2e-tsc.log`, corrected existing config passes with no source change. Full combined gate not run by this helper.

## Inspected evidence and exact outcomes

Personally opened all 12 final PNGs under `viewer/e2e/artifacts/sleep-final-browser/`: each ground-sleep and ground-sleep-rotated prefix with lying-transition, rest, waking-transition, interrupted-upright, completed-return and replay-rest suffixes. Also inspected all ten second-run captures and both first-run transition/failure flat frames. Existing kneeling lie/wake phases, prone torso/limbs and slightly raised chin are credible at the featured mat view; no visible severe major clipping. The completed-return captures show the empty mat because the authored return point is outside this default camera. They do not independently prove visible destination arrival.

Rest sampled minima, metres: woman torso 0.0091, head -0.0109, arm 0.0015, leg 0.0031; casual torso 0.0066, head -0.0178, arm 0.0102, leg 0.0058. Both satisfy the unchanged bounded -0.03 major-volume standard. Fine fingers/clothing and full-tick anatomical/contact certification are excluded.

Both retain action a1 and identical bindings. Woman elapsed 2.15 and casual 2.10 seconds are unchanged through owned continuous wake/Pause; Resume completes a1 at elapsed18, remaining0. Authoritative violations and page errors are empty. Each rig has exactly three Reset snapshots, all **21 geometries / 22 textures**. Recorded replay is the real sleep take with no synthetic extra changes and exact lying r=0. Node proof retains support/ownership/movement, ordinary walker clearance and semantic take regressions.

Proof gallery: `viewer/e2e/artifacts/sleep-final-browser/index.html`; summary and flat/retention-replay-resource JSON reside beside it. All source browser caches, logs, traces and captures remain ignored and must not be staged. No deploy, push, main merge, arbitrary beds/terrain, needs/autonomy or active logical reload restoration claim. Stop here rather than expand anatomy; final combined gate/public proof belong to root.
