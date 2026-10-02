# Alpha extension contracts — bounded documentation report (2026-10-02)

Scope: canonical `ENGINE_GUIDE.md` authoring/registration/UI, retained-effects,
ordinary recovery, fault quarantine and persistence contracts. No engine, app,
browser, performance or camera edits; existing navigation already links the guide
and authoritative coverage inventory. Expansion priority belongs to the active
roadmap: alpha stabilization first; meaningful activities may continue after verified
alpha under the current owner authorization. No Eden work or GUI save/load here.

Source read: clean saved docs base `f04368e`; read-only candidate
`<mars-worktrees>/world-alpha-stabilization` at the same base with its
owner's dirty `viewer/app/lab/sim.ts`. Read `actions/types.ts`, `api/registry.ts`,
`activities/room-preparation.ts`, `scenarios/room-preparation.ts`,
`runtime/snapshot.ts`, `sequence/runner.ts`, `app/lab/scenarios.ts`,
`living-object-scenarios.ts`, `room-preparation-hud.tsx`, `hook.ts`, `panel.tsx`,
`camera-observation.ts`, `scenario-contracts.ts` and
`deploy/scenario-contracts.mjs`; inspected `SCENARIO_COVERAGE.json` and
`TAKES_AND_PLANS.md`. The room example is an existing bounded physical contract,
not a newly implemented feature. Parent reports release40 functional `05370e8`
online verified; old saved-worktree deployment metadata is not refreshed here.

The guide explicitly distinguishes ordinary failure/world-clock continuation from
serious invariant or unknown executor faults: preserve inspectable actual state and
claims, no unsafe automatic cleanup, explicit fresh Reset. Candidate executor/UI
host guard and coverage acceptance remain pending combined current-source proof;
this report makes no online, arbitrary-recovery or complete63 certification claim.

Validation: `git diff --check`, relative Markdown target check,
`node deploy/scenario-contracts.mjs --check` and `npm run typecheck` on the saved
worktree. All pass. Initial typecheck lacked `tsc`; an ignored symlink to the
sibling candidate’s existing node_modules enabled the successful check. No new
browser/gate/public proof.
