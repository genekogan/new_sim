# LM-024: completion-dependent tails

Based on release candidate `3881c91`, branch `codex/deadlock-tails`. LM-024 remains
partial; oscillation and back-out are unchanged. No pins or historical content.

After the existing runtime proof certifies every live root/child/ambient mover
quiescent, the runner now proves completion-dependent pending tails inert. A
fixed point follows mandatory `after` and `when: completed` gates, regardless of
declaration order. Conditions are AND: a future time cue cannot bypass an
unfulfilled completion gate. An independent cue/cancel, started-only dependency,
live timeout, invalid/unknown dependency or dependency cycle prevents stopping.

The proof never mutates reports or actions. Tails remain pending; supports and
reservations remain live. Explicit continuation may still admit tails after
external progress. Diagnostics list the inert pending IDs. There is no new
snapshot field: the proof is recomputed from existing runner/runtime state.

Validation: deadlock-recovery suite 10 passed; dependency helper + sequence +
source-scan suites 16 passed, all zero failures/skips/TODO. Typecheck and scoped
lint passed. The targeted held-load capture was rerun and inspected:
[JSON proof](deadlock-tails.capture.json). Both tail steps stay pending, b1 stays
held by p1/p2, zero violations, execute(commitOnFailure) returns execution.failed,
and history is unchanged. Two-level tail snapshot continuation has identical
reports/events and actor ownership. Independent future cancel still executes.
Malformed, missing, duplicate, self and cyclic dependencies refuse certification.

Successful ordinary plans retain behavior. Previously timed-out physical blocked
plans with only inert tails can now return blocked earlier; lead must inspect any
full-suite pin impact in the shared wave-2 window. No full suite/gate/deploy was
run by this worker. Documentation-only movement investigation `9a19bbf` is on the
older deadlock-detection branch and is a separate pending cherry-pick, not part
of this branch's ancestry. Estimate: 20 minutes / 8k tokens, no extra helpers.
