# Accepted event references survive interrupted compilation — October 4

An opt-in compiler can now commit each accepted mint/deck log fact together with
its private request reference. This closes the missing association exposed by
the partial-mint guard test. It does not turn a minted card into an understood
purpose or claim that the actor started an activity.

## Transaction and replay

`enqueueChecked` accepts an optional synchronous journal. Under one SQLite
`BEGIN IMMEDIATE` write lock, WorldHost checks current authority, appends the
candidate event and writes its journal, then commits. Sequence assignment and
application occur after successful persistence. Guard/journal/persistence refusal
rolls back both rows, emits no application/recovery notification and lets other
inputs continue with the next exact sequence. Journal callbacks must write only
to this host's Db and return synchronous `true`; a Promise is refused.

`Brain.compile` / `mint` carry that journal through every minted/existing-card
deal and final agenda deal. Their current callers still pass no journal/fence;
legacy steering meanings and canonical events remain unchanged. No provider,
budget or model policy changed. A journal requires a current acceptance guard.

Migration 9 adds private accepted-event references, with foreign keys to both
the reservation and canonical event. `IntentRequests.journal` verifies the lease,
pending request, actual event/hash, Soul subject and author before writing.
Real mint events name the recipient in **forSoul**; deck events use **soulId**.
`events` performs current private access checks and verifies every saved
sequence/tick/kind/hash against the durable log. Damaged associations fail closed.
No private words, source IDs, request IDs or worker leases are added to log facts.

Guards/journals are not replayed. Accepted log events remain the source of truth
and WorldHost replays them without a model. Request associations remain private
persistence metadata. They never enter card-readable state, takes or the viewer.

## Actual interrupted-worker fixture

A file-backed SQLite fixture runs the real Brain compiler validation, guarded
mint queue, log append, private journal and fold. Only the compiler transport is
synthetic: it proposes two cards, with one durable zero-cost synthetic admission
counter. It has no socket or provider access.

The worker deliberately exits with code 17 after the first event/reference
transaction commits, either immediately **before** applying the first mint or
immediately **after** applying it and before returning a compiler/intent receipt.
These are worker-thread termination fixtures, not hardware/power-loss tests.

On file close/reopen and actual WorldHost log boot:

- The first accepted mint exists once and is restored to the vocabulary/deck.
- Its private request event reference verifies; the second proposed card is absent.
- The request remains pending with no invented received/understood receipt.
- A duplicate does not obtain another worker lease or rerun the compiler.
- The durable synthetic admission count remains one and cost remains zero.

The journal file has 15 actual ledger/integration tests. It also covers a writer
throwing after inserting its reference (both rows roll back), exact continuation
of unrelated queued work, current authority, foreign Soul/terminal lease refusal,
truthy async callback refusal, damaged reference detection and private access.
Server typecheck/diff check pass on Node 26.8.2. The complete server suite passed
**107/107 checks** in 155s, with no skips/TODO, on the final runtime source. After
that run the two termination fixtures were strengthened to the partial two-card
case and **2/2** passed again; no runtime behavior changed. The full suite's own
ephemeral fake servers stopped with SIGTERM receipts. No mounted UI or paid-model
proof is implied.

Initial two interrupted-worker tests failed to reach their exit point because
the journal incorrectly checked mint payload.soulId. Real compiler mint events
use forSoul. Corrected the subject mapping and removed the synthetic extra field
from direct fixtures; both actual compiler-worker tests pass. They were then
strengthened to terminate a two-card compilation after its first accepted mint.

## Remaining integration

This qualifies persistence of **accepted log facts and their request references**.
It does not automatically reconcile a pending request, restart a compiler worker,
resume unfinished card proposals, refund a spent call, undo an accepted fact or
make a whole multi-card compilation atomic. Runtime recovery may filter earlier
events; reconciliation must account for recovery recipes and actual fold results,
not equate a reference with a successful physical effect.

Next: concrete named private V2 log/fold/public handlers, exact purpose-version
admission, canonical received provenance, accepted revision plus terminal receipt
publication and crash reconciliation. Current `finish` owns its own transaction;
the final publication path must provide an explicit in-acceptance terminal write
rather than nesting it inside a journal. Test lost reply, partial accepted effects,
revocation and exact restart before activating the agreed REST/MCP/capability.
Then qualify ordinary wording against a sleeping native Soul with supported safe
exit, older purposes retained, truthful activity evidence and measured latency.

Compatible older code ignores the extra private tables. Preserve them and the
prompt correction on rollback. Main, live DB/migrations, production credentials,
budgets, release and admission policy were not changed.

## Revised World design input

Read exact World `27879c144ef7716cd0238b5734a93d785e922950` proposals/reviewer.
Verified the three working files byte-for-byte against that pin before running
the inspected read-only reviewer. Its arithmetic passes: closed calm wet domain,
boat deck Y0.5/draft0.3, boarding margin0.4, seated-root sweep separation0.6964,
gangway grade-0.16; Mars shared deck/stair Y3, inboard margin0.9, eight mats/seats/
waiting points, pool depth1.5/two exits/gross108m3. Explicit fields now distinguish
root/pelvis/feet, triangle interpolation and physical/fill/stock dependencies.

This is design consistency only. Core still owns actual support/slope/water/boat
frame/occupancy controllers, body envelopes, sufficient material bill and scene
revision/replay. A World “routeReservations” layout is not an authoritative actor
reservation or a timetable. Gross pool capacity is not an invented fill grant.
Interpret connector release as **refuse retraction while occupied**; retract only
after contacts are safely released. No coupled manifest or inventory changed.
