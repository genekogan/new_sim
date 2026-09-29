# LM-024: bounded recovery and conservative blocked result, stage 2

Builds on stage 1 commit `c7523ec` on `codex/deadlock-detection`. LM-024 remains
**partial**. No historical content, pins, planner cap increases, merge or deploy.

## Behavior and safety

At 200 unchanged wait ticks, each mover gets one existing validated recovery
attempt or an explicit named unavailable/refused result. Walking shares its exact
person/load route-and-squeeze implementation (six-attempt cap retained); carry
addresses the named gather sub-walk or shares its stopped-floor augmented-grid
formation planner; ordinary stopped rides share their route replanner (existing
cap retained). All extra attempts use the existing per-tick replan admission
budget. Budget admission may defer for at most 200 ticks, then reports unavailable
rather than claiming a retry. Active pull-over/resume, stairs and unsupported
phases do not invent a planner escape. Existing natural retries continue.

Another 200 unchanged ticks after attempt/refusal exhaust the episode. An
acyclic wait becomes `deadlock.stalled`; a closed wait retains `deadlock.cycle`.
Anchored translation >1 mm or wrapped angle >0.001 rad resets progress. These are
reporting-only tolerances. Slow cumulative movement exceeds the fixed anchor;
sub-millimetre steering jitter and wait-code alternation cannot reset retry caps.
Changed dependencies reset the episode; unrelated world poses do not enter it.

`SequenceStatus` adds `blocked`. Early stopping requires action-specific proof
that every internal mover is exhausted, including every root/child/ambient live
action. Unknown actions, any pending step (including dependent tails), live step
timeouts, moving gather members and active ride pull-over/resume prevent it.
Any cue/cancellation/timeout after the runtime graph gets another full tick before
certification. No cancel/settle is invoked; supports and reservations remain
live. Execute rejects blocked/unsettled results even with commitOnFailure.

Audited downstream status handling: rehearsal `runReport` uses SequenceStatus and
only completed+zero violations yields ok; controller and execute propagate the
report; no other strict completed/partial/aborted/timeout schema or exhaustive
render switch exists. Typecheck passes. Snapshot fields are optional, and plain
service recovery state preserves one-attempt caps and deadlines on restoration.

## Validation and inspected capture

- Consolidated focused run: **76 passed, 0 failed, 0 skipped, 0 todo**, 6.37 s:
  deadlock, deadlock-recovery, walk, resume, sequence, carry, vehicles, rehearsal,
  source-scan suites.
- After final anchored-angle refinement: both deadlock suites **19 passed**, 1.92 s.
- Typecheck and scoped oxlint passed; final diff inspection/check completed before
  commit. Lead owns the full rebased/integrated gate.
- Actual opposing stairs-a walkers return **blocked at tick 635**, retaining
  actor reservations with no cuts, no settle ticks and zero invariant violations.
  Stair recovery correctly says unavailable, not attempted.
- Actual held carry returns **blocked at tick 942**; b1 remains held by p1/p2,
  zero violations. Official execute with commitOnFailure returns execution.failed
  and leaves the complete history hash unchanged.
- Actual gather fixture: p1 is physically blocked at its approach while p2 is
  still walking across the proving ground. Parent reports the cycle but cannot
  early-stop; the load remains on the ground, zero violations.
- Forced 3-cycle, acyclic/static sinks, aliases, exact pause/resume recovery caps,
  future cues/timeouts/dependent tails, unknown ambient work, bounded budget
  refusal, code alternation, oscillation vs cumulative translation/rotation, and
  changed blocker identity all have focused regressions.

[Captured JSON](deadlock-recovery.capture.json) was read directly. It includes the
physical stair report and held-load execution refusal, with recovery request and
completion ticks, original blocker codes, invariant lists, support and unchanged
history confirmation. Stage-1 capture remains a historical reporting-stage proof.

## Identity and remaining scope

Ordinary opposing passage is still tick **239**, world
`6b4055949d6b025c0db12888eb316fe5168ae6079640cb7c8bc17ec5b0a0a373`, events
`0ba3c1b38192a28f5801cee3078979f5c2d4669c42e93df70a1f1b6f79e18b87`, exactly
matching current integrated baseline. The waiting snapshot blob changes from
`2facff0b586d0b0690f53e0fe293f1547e24ede9e9caf15428cd3f5f7a143c72` to
`15f4a32b5facad410692842d1479fe711514afc2a69ffb293eb554fbb204fb5a` because of
anchors and recovery bookkeeping. No pins edited. Long persistent waits can now
finish with blocked rather than timeout; any affected full-suite pins must be
reviewed together in the lead's next pin window, not blindly updated.

Still partial: 0.8–0.95 m ground-corridor opposing walkers genuinely alternate
~0.1 m lateral positions, so they reset pose progress and retain ordinary timeout
behavior. The reporting tolerance was not broadened to hide that motion. Fully
quiescent gather recognition is deliberately conservative (finished/null internal
walks prevent certification), dependent tails still prevent early stop,
forklift-specific waits remain uncovered, and actual three-vehicle cycle proof
belongs to LM-043. LM-020 co-planning and LM-025 physical back-out are separate.
