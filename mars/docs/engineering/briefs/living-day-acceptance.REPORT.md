# Connected living-day disruption acceptance

Frozen reviewed source base `5608442`, isolated checkout `<mars-worktrees>/living-day-acceptance`. This lane adds only a Node disruption test, a browser acceptance spec and this brief. Existing day coordination, activities, hooks, HUD, catalog and rendering remain root-owned. These are unshipped candidates, not a public release or complete-system claim.

## Executed Node representatives

`node --test viewer/engine/test/living-day-disruptions.test.ts`: **8/8 PASS**, 0 fail/skip/TODO, 12,200.5545 ms. Each representative executes in both `living-day-4` and `living-day-studio` with the actual registry, spatial scene, invariants and connected-day coordinator.

- Main routine Pause/Resume retains a partial cold-preparation commitment, deposited fractions and work progress while other activity continues. It then pauses the same physical sleep purpose, safely releases the actor/mat, resumes that same sleep action and completes the meal and original notes.
- Directing the reader away safely retains an unfinished bookmark and user/task identity. The carer completes first-plant watering independently while the reader remains paused. Explicit reader Resume returns to the same reading commitment; the whole day completes.
- A foreign `work_at` owner occupies the preferred computer. The assistant binds to the declared auxiliary computer/chair, without canceling the original owner. Canceling that fixture owner later lets the complete connected day finish; routine work remains bound to the auxiliary station.
- A missing required display refuses the gathering transition with `object.unknown` naming that display. Restoring the exact fixture leaves the day waiting; explicit Retry creates the new session while retaining the original initial-work commitment. The day then completes.

Every stepped journey asserts zero authoritative invariant violations. Completion verifies actor/entity claims released, no held items, finite garden water ending at 0.25, and retained purpose outcomes. These are bounded authored arrangements and permitted alternatives; they do not prove arbitrary casting, resource outages or every cross-product combination.

The initial run was 6/8 PASS. Both missing-display cases reached the intended refusal but the test assumed a display-specific diagnostic prefix; the actual shared object validator correctly emits `object.unknown`. The revised assertion checks that exact code and the missing display ID in subjects. No implementation, deadlines, tolerance or baseline changed. Initial log remains preserved.

Viewer TSc, strict focused e2e TSc and scoped oxlint PASS. Ignored logs in `viewer/.cloudflare/`: `living-day-disruptions-first.log`, `living-day-disruptions-second.log`, `living-day-tsc.log`, `living-day-e2e-tsc.log`, `living-day-lint.log`.

## Browser acceptance authored, not executed

`viewer/e2e/living-day.spec.ts` has two actual-Play cases: classroom/original worker/preferred equipment and studio/project assistant/auxiliary equipment. Each explicitly calls `runScenario(...,{paused:true,speed:8})` before Start; it follows independent reader direction/resumption, carer continuation, retained partial preparation, same-action sleep pause/resumption and completion of the original notes. Six planned captures per environment and a detached state-proof JSON cover those moments. No baselines are added or changed. Browser execution awaits the exclusive slot and actual capture inspection.

Occupied equipment and missing-display representatives are Node-only in this lane: the existing HUD offers casting/preference controls and safe activity controls, but no artificial outage/foreign-occupant controls were added. This deliberately preserves scope. No full gate, build, idle performance, public deployment, save/load, autonomous needs model, new activity or camera work is included.
