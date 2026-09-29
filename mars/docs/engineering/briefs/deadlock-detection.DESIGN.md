# LM-024 approved design — staged implementation

Branch `codex/deadlock-detection`, base integrated `9923eb5`. Read LAST_MILE LM-020/024/025/043; MOVEMENT crowd jams and W38/W47 passage release; CARRY gather/route waits; VEHICLES lane/pull-over retries; Runtime/SequenceRunner/snapshot code. Lead approved staged implementation: reporting first; bounded recovery and safe early blocked termination follow separately. No pins may move independently.

## Findings that constrain the design

- Runtime already has nonterminal `blocked` actions and retries their `step()` every tick. SequenceRunner only returns `completed|partial|aborted|timeout`; its `poll()` does not copy diagnostics for live blocked records into step reports. Consequently live named waits can disappear behind the final generic timeout.
- Walkers expose person, load, passage and destination waits. Existing recovery is already substantial: stationary-blocker replan after 10 ticks, backed-off attempts (maximum six), moving-blocker recovery after 80 ticks, and W47 reciprocal passage release after both sides wait 60 ticks.
- Carries call `walkTo.step()` directly for each gathering person. Those are not child ActionRecords; all sub-execs currently share the carry action id. The carry action returns `running/gather` even when its internal walkers are blocked. An ActionRecord-only detector misses these waits; an action-id-only graph merges distinct gathering people into a false self-loop.
- Carry motion waits on people and tries an augmented-grid route every 120 blocked ticks. Vehicles retry pull-over/resume every ten ticks and may give up on resumption after 1,200 ticks. Existing diagnostic subject arrays differ by verb; parsing prose or assuming a fixed subject offset is unsafe.
- Plain-data services are already encoded by RuntimeSnapshot. A wait tracker can live there and survive pause/resume without another snapshot format, but newly serialized wait metadata can change pause blob hashes; these must be checked rather than claimed unchanged.

## Proposed coherent representation

Add `runtime/waits.ts`, a pure deterministic tracker, with explicit publication from the actual blocking branches in walk/carry/vehicle actions. Never infer edges from diagnostic prose. Each current-tick sample names:

`mover`, `ownerAction`, `aliases`, `blockedBy` entity/resource ids, source diagnostic code, current pose/progress, retry attempt/outcome.

A gathering person is its own mover even when several share one carry ownerAction. A moving formation is one load mover with its crew as aliases. A vehicle mover aliases both vehicle and rider. Blocker entities resolve to these current movers; an idle person or static obstacle remains a named external sink, not an invented action/cycle. Stair/passage branches publish actual holder actors (some current diagnostic subject arrays contain only a link id).

After all actions step, prune stale samples and inspect the whole current-tick graph in sorted id order. Compute strongly connected components (including genuine self-waits only where applicable), retain a canonical ordered cycle/edge list, and measure sustained no-progress using fixed ticks. Do not report a momentary yield as a deadlock. Proposal: a 200-tick (10 s) unchanged wait episode, allowing existing 60/80/120-tick recovery to act first; the exact threshold is an explicit policy, not a physical proof. Edge changes, real movement/progress or a completed action reset the episode.

A persistent acyclic wait against an idle person/static obstacle is a separate `deadlock.stalled` result after bounded applicable retries, not a fabricated cycle. `deadlock.cycle` names movers, owner actions, blockers, edges, elapsed ticks and recovery attempts. All data is JSON; tracker state is in plain runtime services so supported walking pauses resume deterministically. No WorldState or take schema changes are planned.

## Recovery and execution semantics

1. Keep current recovery behavior unchanged for ordinary waits.
2. Once a candidate persists, choose one recovery participant deterministically. An optional action hook requests its existing planner retry from its present pose; it may adjust retry flags, never poses or support/reservations. Carries select the named gather sub-exec explicitly rather than the action-keyed walkExecs map. Recovery uses the existing per-tick planning budget. No general reverse/back-out solver is added.
3. Allow one bounded recovery window for that episode. Progress clears it. If no supported escape exists or the same closed wait survives, expose the named blocked diagnostic without dropping loads, cancelling others, or freeing occupied passage resources.
4. Continuous Runtime remains live and can recover if circumstances change. Avoid alternating normal/deadlock diagnostic events every tick: preserve the deadlock overlay while its underlying wait persists, emit only on transitions.
5. SequenceRunner should surface `status: 'blocked'` and the graph diagnostic before its global timeout when all relevant active roots are irrecoverably waiting and no independent running work or pending time cue can release them. It must not stop a plan just before a scheduled `cancel`/clearance event. An early blocked result is not successful or settled merely because the runner stopped; live held-load states remain unsettled and execute must refuse to commit them. If broader early termination is risky, first ship live/report diagnostics and explicitly leave early-stop acceptance incomplete rather than call a timeout a fix.
6. Always copy the current diagnostic into a blocked StepReport (currently missing). Preserve original blocker/retry diagnostics in structured details.

## Scope boundaries and pin strategy

- LM-024: accurate persistent cycle/stall reporting, bounded existing recovery request, early blocked reporting when safe; two-walker passage + forced three-cycle proof.
- LM-020 remains separate: detecting waits does not co-plan crossing carry formations or prove admission ordering.
- LM-025 remains separate: detecting corridor-A deadlock does not make its 21 waiting layouts back out and complete.
- LM-043 needs an actual three-vehicle wait representation/runtime case; a generic SCC unit test alone is not sufficient evidence for physical vehicle traffic.
- No wall-clock detector, no arbitrary geometry edits, no increased planner caps, no forced release or teleport. Baseline waits must retain outcomes. If an existing pinned run is newly diagnosed/refused or any pin changes, stop and report; do not independently repin.

## Required proof set

- Pure graph cases: two-cycle, forced three-cycle with stable canonical ordering, acyclic wait, static sink, aliases, multiple gather walkers sharing one action, stale-edge removal and moving blocker suppression.
- Runtime proving-ground case: actual two walkers in an unresolvable passage; names both and its resource; no collision/teleport, no unsafe release.
- Runtime forced three-cycle using explicit wait producers and the real detector; breaking one edge clears the diagnostic and permits continuation. Treat this as a detector proof, not a vehicle collision-avoidance proof.
- Actual carry gather stall reaches the tracker although its parent returned running; a safe retry is requested once, not every tick. Unresolved held load stays supported and is not committed by execute.
- Vehicle waits publish rider/vehicle aliases correctly; true three-vehicle closed wait is named if a reproducible fixture is available, otherwise LM-043 stays open.
- A future scheduled cancellation breaks a wait; the runner does not stop prematurely. A normal transient passing/yield scene gets no deadlock diagnosis and keeps its existing hash/event log.
- Paused waiting walkers restored mid-episode match uninterrupted diagnostic tick, result and final state; tracker services remain encodable.
- Inspected JSON capture containing cycle edges, owner actions, retry outcome, blocked report and invariant list. Any scene screenshot is supplemental.

Planned full-scope files: new `runtime/waits.ts`, `runtime/runtime.ts`, optional hook in `actions/types.ts`, `sequence/runner.ts`; publishing/retry hooks in `locomotion/walk.ts`, `carry/actions.ts`, `vehicles/actions.ts` and relevant forklift waits; focused graph/runtime/resume tests and area docs. Runtime/runner shared edits need coordination. The first reporting stage is documented in deadlock-detection.REPORT.md; remaining design items are not claimed complete.
