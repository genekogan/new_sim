# A deterministic destination for quiet elapsed time

The actual native commons reproduction reached tick 37 with no snapshot and no
recent input, then restarted at tick 0. Earlier physical/station fixtures wrote
an explicit checkpoint to avoid that fault. This candidate corrects the ordinary
quiet tail for an explicitly opted-in WorldHost; it does not infer elapsed time
for an old database with no durable destination.

Use the sixth constructor argument `{durableClockV1:true}`. Production bootstrap,
factory defaults, physical rules and the old public contracts remain unchanged.
Migration 15 creates an empty private `clock_frontiers_v1` table. Each opted-in
world retains one strict `durable-clock-frontier/1` row: selected world/seed,
rules, fixed dt, reached tick, accepted prefix sequence and its event hash,
plus exact engine and kernel hashes. No purpose, user identity, model text,
credential or instruction is added. Those private replay hashes are never public
music, camera, history or status projections.

After each successful native step, the host commits derived plays/observations
and then its clock destination before runtime/tick/batch/heartbeat publication.
The write holds the SQLite writer lock, checks current sequence/rules/header,
rejects regression or changed bytes at the same head, and atomically replaces
the single row. Elapsed ticks do not create public or canonical input events.
Actual inputs still have their ordinary sequencer records and ordering; listener
generated next inputs remain queued for the next tick.

Boot validates row bytes and exact accepted prefix before construction. It starts
from an appropriate durable snapshot or the original genesis, folds recorded
inputs, deterministically steps to the destination, advances needs/program
bookkeeping and sweeps kernel expiry, and verifies engine/kernel/rules/dt hashes.
Later same-tick inputs follow the verified prefix. A later exact durable snapshot
or explicit logged recovery supersedes an older clock prefix. Recovery must not
regress elapsed time; its new private destination is persisted before publication.
New replay violations remain visible errors. No models are consulted.

A clock write failure latches the world unavailable and stops its loop. Further
stepping, queued control admission, snapshots and station bindings refuse; Hub
closes existing and late peers with 1013 and sends no unacknowledged frames.
HTTP returns generic no-store 503 before routes/auth, including health and current
body/take reads. Private writer details and replay hashes never enter the reply.
The last committed destination remains recoverable by a new compatible host.
This is explicit failure containment, not automatic model/physics repair.

Executed evidence includes quiet native restart, moving snapshot/genesis restart
and continuation, real derived card effects, retained owner purpose and exact
serialized mind, later same-tick events, old/new commons checkpoint, recorded
station era/cue and fresh anchor after restart, negative prefix/hash/write cases,
and native process exits after step, during the transaction and after commit.
Actual TCP/Hono/anonymous Hub checks exercise committed take publication, a real
ordered pong fence, peer closure, nine generic unavailable reads and private
negative outputs. An explicit native repair is tested both with its new clock
write and when interrupted after the durable repair but before that write.
Paid spend is zero. Source-bound receipts and initial failed assertions are in
the team review bundle.

The initial correction reproduction failed 0 versus 37 as intended. Two new
movement harness failures were incorrect assumptions: the freshly born Soul was
already logically at commons, so its go-to effect was refused; JSON snapshots
omit an undefined optional mind property. The corrected test uses a genuine
walk/rest program and compares serialized mind semantics. The initial station
harness called a nonexistent engine capture method; it now verifies actual
recorded take references against the public capture function. The initial wire
test counted committed in-flight frames as new failure frames; an actual ordered
pong establishes the fence. These original failures remain retained.

## Qualification limits and next work

This is an isolated Core implementation, not default activation or alpha release.
The updated reader refuses clock-bearing worlds if the option is omitted.
**An older binary that predates this table may ignore it.** A release and rollback
must use an explicitly qualified compatible reader; the old arbitrary binary is
not a qualified rollback. SQLite WAL/NORMAL and real process exits are the tested
durability scope; host power-loss, day-long throughput and lifetime replay/storage
are not qualified here. App's generic failure-policy counterpart is requested.

An attempted separate 24-Soul/6-owner native commons clock profile failed before
measurement, under default clock mode: the native placer put h_12 too close to
commons-bench-east (0.17 m clearance versus required 0.28 m). No performance or
24-body commons capacity result is claimed. This concrete arrival/admission fault
is recorded as C173 and is Core's next repair. The earlier 29-body flat-world
fixture remains separate evidence. Persistent commons-to-shore topology, ordinary
owner/compiler water access, full retained-intention clock integration, mounted
World/App consumers and combined release/rollback gates remain open.
