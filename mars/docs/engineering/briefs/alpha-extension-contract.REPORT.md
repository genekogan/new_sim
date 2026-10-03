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


## Final bounded contract critique — 2026-10-02

Read-only audit against unreleased root candidate `033f8cb`: canonical guide/index,
coverage status, `app/lab/sim.ts`, `hook.ts`, `panel.tsx`,
`engine/runtime/snapshot.ts`, `engine/test/lab-terminal-result.test.ts` and authored
`e2e/alpha-control-quarantine.spec.ts`. Four proved documentation gaps corrected:

- Frozen first `scriptResult` boundary was undocumented: live hashes may advance;
  terminal/refusal/budget receipt or `done()` alone is not successful effects proof.
  Later faults invalidate the receipt, and Reset begins a fresh run.
- Control quarantine was worded only as a future requirement, although candidate
  panel/hook fences exist. Describe implemented fences while keeping combined UI
  certification pending.
- Future hook registration lacked the actual default fence/allowlist rule: new
  methods are fenced; allowlisting requires detached-read or presentation/fresh-world
  proof rather than permitting another path into halted authority.
- Snapshot-drop limits named only held loads, omitting existing action-owned active
  equipment refusal and the need for an ordinary safe task stop preserving progress.

Existing full UI Play, deterministic/disruption, sustained/probe/diagnostic contracts,
canonical inventory links and deferred GUI save/load limits remain accurate; no new
parallel catalog or broad rewrite. INDEX and coverage remain untouched. The inventory
still records draft/current-source acceptance pending; all63 certification and alpha
acceptance are unclaimed. Authored tests/source inspection are not fresh execution or
public acceptance evidence.

Validation: relative Markdown targets and `git diff --check` PASS; documentation-only
source cross-check, no browser/fullgate or new runtime test. Prior typecheck remains
prior evidence, not a check of candidate033f8cb. Only ENGINE_GUIDE and this report change.
