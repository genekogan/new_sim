# Purposeful routine candidate — 2026-09-30

Branch `codex/purposeful-routines`, main/base `67e2e3e` (documentation atop deployed release23 engine source `cb37603`). The original doc-only plan rebased to `e689a9e`. Local Git only; no pushes, remotes, deployments or historical edits.

## Playable engine outcome

One explicit registered intent joins the chosen live classroom, asks a real worker question, observes both presenters and a formed smaller conversation containing worker, then performs one shared meal/physical returns, bounded seated quiet rest/get-up and completion of the same interrupted notes. Default4 and physically prepared side8 engine journeys pass. Start honestly requires the committed notes already unfinished and worker standing idle/unowned, and the explicit session currently presenting/questioning. It never cancels/adopts foreign active work, replaces task progress or chooses a later session.

Two verbs: `purposeful_routine` and `purposeful_routine_control` (`pause`, `resume`, `end`). Exported `PurposefulRoutineParams`, `PurposefulRoutineControlParams`, `PurposefulRoutineReadout`, `RoutineMode` and `readPurposefulRoutine(rt,id)` match the root's Lab integration schema. Nested work omits actor; the top-level actor supplies it. Readout returns cloned bindings, diagnostic details, arrays and progress, with no mutable execution references.

The logical `routine:<actor>` claim prevents duplicate intentions. Ordinary children exclusively control movement, posture, hands, support and physical resources. All coordinator dispatches use `preempt:false`; independent directives win through the existing `onDirective` contract. Routine pause/end cancels only owned children and leaves worker through ordinary `classroom_control` `{kind:'depart',actor}`. The unrelated session/participants remain active. Physical departure under that session can outlast logical cleanup; Resume refuses until worker is actually idle/unowned. Terminal End releases the logical claim and cannot resume.

Food calls the existing shared break once. After pause, owned serve/eat lineage and actual retained fractions determine remaining obligations; a fully consumed empty bowl is never served twice. Bounded continuation uses ordinary take/walk/serve only for unserved participants, pair converse/eat remaining portions, owned group release, then ordinary stow returns. It waits for eating's physical completion before stowing, even when the final spoonful has already consumed all food. Portion/support/type changes while paused refuse named `routine.food-changed` rather than guessing or substituting.

Rest counts only occupied ticks and retains remaining dwell time; work retains its original user/task/total duration and elapsed progress. Actual `classroom.question` marks certify asked progress; a queued-but-unasked question latch resets when the worker leaves and requeues on explicit same-session resume. No general scheduling, needs, sleep, active snapshots or persistence claim is made.

## Files and boundaries

- New `viewer/engine/activities/purposeful-routine.ts`: the bounded coordinator, control action, defensive admission/readout and partial-effect continuation.
- New `viewer/engine/test/purposeful-routine.test.ts`: two arrangement journeys, worker-only classroom pause/end, exact queued-before-question interruption, early/partial/consumed meal resumption, retained rest with independent direction, missing/foreign bindings, no repeated admissions while waiting, immutable readout, logical uniqueness and timed deterministic replay.
- `viewer/engine/activities/index.ts`: additive exports only.
- `viewer/engine/api/registry.ts`: additive registration; activities rules version advances 8→9 for the newly published coordination capability. Existing verbs/invariants/DT remain unchanged. No pins or baselines are edited.
- PLAN: activated after verified release23 and narrowed admission/cleanup semantics; this REPORT.

No shared food/workstation/Runtime/spatial/persistence API changed. Root owns Lab controls/hooks, browser captures, combined review/gate, integration and release. The candidate itself has no browser evidence or full pinned-suite certification.

## Validation

Commands from this worktree's `viewer/`:

```sh
node --test engine/test/purposeful-routine.test.ts
npx --no-install tsc --noEmit -p .
npx --no-install oxlint engine/activities/purposeful-routine.ts engine/test/purposeful-routine.test.ts engine/activities/index.ts engine/api/registry.ts
node --test engine/test/purposeful-routine.test.ts engine/test/work-break.test.ts engine/test/social.test.ts
```

Focused coordinator tests:19 passed /0 failed /0 skipped (8.51s), including the reviewer-requested queued-before-floor regression. Earlier related suite:44 passed /0 failed /0 skipped (18 routine cases plus unchanged social/work-break cases). Final same-command result and final TypeScript/lint outcome are recorded below after the last source edit. Timed two-runtime proof compares exact world hash, all action records and cloned routine readout; no normalization or rewritten expectations.

Pins:none changed. Full actual pin impact, full release gate and runtime captures await root's integrated candidate checks. The scoped related tests preserve existing behavior; they do not substitute for that gate. Source changes were reviewed for ownership/secrets before staging. Approximate active implementation/inspection:about one hour; investigation found no shared subsystem prerequisite. No extra agents were spawned by this worker.

Final source checks: TypeScript clean; scoped oxlint clean; related engine command45 passed /0 failed /0 skipped (8.42s), including19 purposeful-routine regressions and the unchanged social/work-break suites. Read-only independent review identified only the queued-question latch issue, fixed and covered by the exact19th regression before this final run. No further serious findings were reported.
