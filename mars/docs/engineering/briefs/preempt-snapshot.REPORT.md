# LM-029: snapshots during social stand-up

Waiting directives now serialize their plain intent and dependency ids in an optional
version-1 graph field. The graph already preserves the cancelling sit exec, record
aliases, reservations, cancellation reason and exact-seat return intent. Restore
resolves the directive definition from the supplied registry; it does not plan or
reserve until the original stand-up finishes. Ordinary queue-free snapshots retain
their previous shape. No world/event behavior or pin is intentionally changed.

Validation rejects malformed wait provenance, duplicate ids, missing holds,
self/cyclic parents, mismatched parameters, unknown verbs and pre-owned resources.
Dropping a wait dependency is refused. Pending carry intent is covered through the
stand-up boundary, while snapshotting the started carry still refuses its unsupported
live codec. This does not claim carry resumability or change LM-026 conversation scope.

Proof: ten social-return tests pass, including six tick-exact 420-tick continuations
from tick 77 and tick 82 with normal continuation, cancellation and a newer directive.
World hashes match every tick; action records and event suffixes match exactly.
Eight focused social/pre-emption tests pass, including pending-carry restoration;
source scan, TypeScript and lint pass. Full gate belongs to integration.

Personally inspected all six JSON captures in preempt-snapshot.capture.json:
normal continuation returns p1 to [0,0,-5] seated; cancellation finishes stand-up
at [0,0,-4.375] idle without starting the cancelled walk; a newer refused directive
suppresses return and leaves the completed original walk at [-4,0,-7] idle.
All have zero invariant violations. These are nonvisual snapshot proofs.

Review hardening: every requested/pre-empting record must appear exactly once in
the waiting graph; deleting the field or an entry is now refused. Social returns
are validated as a restricted seat-return queue, not arbitrary deferred commands:
source verb/standalone status/occupied and pre-emption history, actor, original
explicit slot (or original auto-selection owner), activity, top-level directive
existence and unique source must agree. Already-created returns cannot be queued
again. Invalid cases name snapshot.waiting-invalid or snapshot.return-invalid.
Queue-free old snapshots remain supported. Valid take_slot and sit continuations
remain exact. Twelve social tests plus source scan pass; tsc/lint pass.

This is snapshot graph consistency, not cryptographic authentication. For an
auto-selected seat after its source exec has ended, the original record identifies
its owner, not the resolved local seat; that local slot remains stored intent.
A caller who forges the entire matching action history is outside this validation
claim. Normal admission still checks current seat availability and physical reach.
