# Private durable lifecycle candidate journal

October4. Branch `core/lifecycle-journal`, parent
`8fccdd5ecce4ef7ad4d6523f197507f39c1d5fe8`. Implements the private storage and
strict wire codecs of accepted G005/C086/C087/C088. No host runner, Souls/HTTP,
pairing, main bootstrap or consumer is activated by this slice.

Candidate migration12 adds an empty private lifecycle operation table with current
world/Soul/owner and physical-event foreign keys, state constraints and bounded
query indexes. It performs no historical Soul backfill, orphan repair or live
migration. Existing eleven migrations remain byte-for-byte unchanged.

`LifecycleJournal.acceptCreate` puts the actual owned row and a pending internal
operation in one `BEGIN IMMEDIATE` transaction. A synchronous caller authority
guard runs inside that same transaction; current invite/count/name policy belongs
to the authorized caller, not this store. `acceptRetire` atomically persists row
retirement/token revocation, a recoverable removal request and the historical
admission receipt revision increment. Pending/recorded creations cannot retire;
logical count/name release does not remove a physical body. No externally supplied
idempotency key or automatic birth retry is introduced.

Birth/removal log acceptance and its private operation association commit together.
Expected normal arrival refusal atomically releases the failed row’s logical
reservation and keeps its private refused receipt, with no birth fact. An already
recorded birth cannot be reclassified as a refusal. Refusal must later be called
only after the actual native probe establishes ordinary unavailable arrival;
neither an exception nor an arbitrary row mutation is sufficient.

Recorded and complete states remain separate. Birth completion reuses the exact
birth association; retirement completion requires a fresh public rules checkpoint
`{checkpoint:'lifecycle-removal-confirmed'}` at the actual confirmed cleanup tick.
That generic checkpoint has no request/owner/Soul identity. Its purpose is to let
model-free replay advance through delayed removal before claiming retired. The
private terminal association and checkpoint commit together. The future native
runner must verify body/program/obligation absence and Mind/kernel cleanup inside
the completion guard. Store tests use explicit synthetic guards/events and **do
not qualify actual physical completion**.

Current world/owner/body association gates lookups; stored immutable body hashes
and source/terminal event hashes detect corruption. Recovery pages contain at most
20 pending/recorded operations, ordered ascending `(requestedAt,requestId)`;
private owner history uses descending keyset pages of20, tied timestamps broken
by request ID. `lc1_` plus the authorized last `lc_32lowerhex` request is the cursor;
foreign/stale cursors cannot select another owner/world. No pending expiry or
automatic terminal pruning is implemented.

`soul-lifecycle/1` and `owner-lifecycle-list/1` strict codecs reject extra private
fields, inconsistent state/fact/readiness/allocation, mixed worlds, duplicate
operation IDs and unbounded pages/cursors. C087 historical create/admitted can be
not-ready/unallocated with reason retirement-accepted. A native producer must
verify that reason against the actual durable retirement; a schema alone cannot.
These exports are not a capability advertisement or API success claim.

Evidence: initial18 storage/codec checks passed; expanded19 includes pending
retirement rejection and old receipt revision/terminal checkpoint invariants.
Six real serialized Node exits target create-write/create-commit,
event-write/event-commit and retire-write/retire-commit. Writes interrupted inside
SQLite roll back the whole row/journal or event/reference unit; post-commit exits
preserve pending/recoverable work. Synthetic events are explicitly storage proof,
not Hono/native lifecycle or surrounding-world liveness qualification. SQLite
trigger failures also roll back; sequential current count/name guards and tied
timestamp pages pass. No concurrent multi-process count/race proof is claimed.
Temporary databases/children close, local fake/$0; no provider/network/live action.

Next: exact opt-in host/native producer and reboot reconciliation, then scoped
Soul/HTTP/token fences and G response conformance. Proposed legacy wait is **2 real
seconds**; unconfirmed work then returns agreed503 with a private pending receipt,
never success or a no-write/refusal promise. Header opt-in returns202 immediately
while pending. Both require final current authority and no-store. This wait and
transport are not implemented here, so App consumers still await the producer pin.

Rollback remains gated: an old binary can ignore the empty additive table, but
cannot process candidate pending operations after activation. Preserve the DB and
journal, pause new acceptance and use a qualified compatible reconciliation/rollback
release; never erase pending work or downgrade to old orphan-producing writes.
Actual candidate/backup restore/live migration/historical repair, active removal,
refusal world liveness, concurrent capacity, real owners and release are unqualified.
