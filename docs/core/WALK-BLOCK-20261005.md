# Safe native walk blockage — optional walk-block/1

Core topic on top of `0882a76e`; no default or existing-world activation.

## Actual finding and behavior

The 4800-tick diagnostic captured actual controller records/events and durable
observation rows. Two directions were still walking and waiting for traffic.
A different accepted program had a no-op approach followed by a timed wait: no
executing walk or start was observed, so its completion was correctly withheld
from the private attempt ledger. No unpublished observation was found. This
change does not invent that absent start or mark a broader purpose fulfilled.

The adapter's original timeout handles deadlock and occupied-goal diagnostics,
but misses other prolonged walk blockage. Native deadlock detection can later
change the diagnostic. A deterministic occupied-landing test also reproduced an
existing fault: the original adapter reports failure immediately after requesting
cancellation, even though a native walker can still own a between-level body.
That legacy behavior remains reproducible under its original rules.

Explicit `marsFactory({...cfg, walkBlockV1:true})` adds `+walk-block/1` to the
native rules and a policy tag to the canonical adapter hash. All blocked actual
`walk_to` actions, including those lowered inside a living program, count toward
the existing limit of more than 1200 continuously blocked ticks (60 world seconds
at 20 Hz). Executing progress resets the count. Other native action types and
sleep's separate policy are unchanged.

At the limit the adapter requests native cancellation. Immediate safe cleanup
produces one failed program event with `route.blocked` and the current native
reason. Deferred cancellation stores its reason in the program snapshot and
retains the program until the native action actually ends. A blocked landing can
therefore keep cancellation pending indefinitely; safety outranks a fabricated
terminal or a floor projection. A real intervention clearing the landing allows
native movement and cancellation to finish. There is no relocation, replacement
body, invented outcome, model, new routine or navigation bypass.

False/absent configuration preserves the original rules, hash and actual blocked
trajectory. Both directions of cross-policy history and snapshot restoration
refuse; duplicate/unknown policy versions refuse. This is a new explicit world
policy, not an implicit checkpoint transition or a live rollback mechanism.

## Executed proof

- Five focused native tests: policy fences/default equivalence; actual prolonged
  traffic and deferred cancellation with exact snapshot continuation; real
  traffic clearance before timeout; exact legacy premature terminal reproduction;
  cancellation back to a supported entry with released actor and one failure.
- Affected native arrival/commons/removal and owned response/retry/private-reader
  regression: **45 PASS**. After fixture typing and a stronger live-action
  assertion, final native **5 PASS**, engine/server ES2023 scoped types exit 0.
- Actual 24 owned Souls / six invited local HTTP humans, 24 synthetic directions,
  fake needs-aware native choices, **7200 ticks** with both optional retry and new
  walk policy. **14 native timeout events**, seven associated with requested
  attempts; every corresponding private block matches the real failed program
  and tick. Every retry follows a separately recorded genuine block and cooldown.
  Latest requested phases: **10 completed, 3 blocked, 3 started, 8 no attempt**.
  No all-24 responsiveness or causal improvement over a different random-ID run.
- Complete private pages, foreign-owner 404/public negatives, zero unpublished
  observation rows, zero native violations/paid spend; saved tick 7200/seq 382.
  New WAL connection, native snapshot and model-free genesis reconstruction agree
  on engine, kernel, needs, station, clock and private history. Same-process saved
  recovery is not an OS process crash, old-binary rollback or real cohort proof.

Immutable diagnostic: `.e2e/intent-history/cohort-liveness-diagnostic.json`.
Immutable population proof: `.e2e/intent-history/cohort-walk-block-first.json`.
Future test invocations use new dated artifacts rather than overwriting them.
Detailed receipts, source/dependency/artifact pins and limits are in the team
review records accompanying the commit.

Retained failures: first fixture had no valid audience slot (1 PASS/1 FAIL);
second expected `held` instead of native `occupied` (1/1); expanded tests wrongly
assumed legacy traffic stayed nonterminal and a second layout had two slots (3/2);
then expected `traffic.person` although deadlock classification had legitimately
changed to `deadlock.stalled` (4/1). All assertion changes follow actual native
behavior. Initial engine types found extra native region layout and unknown
record params; a follow-up found missing required region label/provenance. Corrected in test code, no root lib change. The combined shell's
last server check exited 0 despite those earlier engine errors; separate final
engine and server receipts are the actual type success evidence.

## Counterparts and remaining work

No W/G wire or permission schema changes. World continues to consume actual
native takes; App continues to read strict private admissions/observations. Safe
terminal ordering allows an already-enabled retained retry to consider the
recorded block, but does not activate retry or the new engine policy by default.
PM/App/World must review the exact optional component before candidate adoption.
The accepted immutable 8dc first-loop image and App's d979 image remain unchanged.

This does not repair all explicit stop/replacement/removal paths, guarantee
traffic liveness when both landings stay unsafe, implement already-at feedback,
prove all owners respond, or install a connected shore/Mars basin. Those remain
independent commissioned work. No new worker, runtime setting, release or access.
