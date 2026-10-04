# Private request reservations — October 4

The candidate V2 backend now has durable, private world/Soul/principal/request
reservations. Exactly one concurrent SQLite worker receives the internal lease;
duplicates receive the stored request state and cannot start another compiler
run. Changed semantic words/settings under the same ID conflict. Nothing here
activates a route, capability, canonical event or new steering behavior.

## What exists

Migration 8 adds `intent_requests_v2`, without rewriting events, Souls, prompts
or prior migrations. `IntentRequests.reserve` parses the exact candidate request,
normalizes defaults and hashes stable JSON. In one `BEGIN IMMEDIATE` transaction
it checks the current active Soul/world/owner and trusted principal policy, then
returns the existing reservation or creates one with a random internal lease.
REST/MCP channel differences retain the first request's audit source. They do
not create another reservation for the same principal, Soul, world and ID.

The trusted handler must bind the source/principal to its authenticated identity
and supply a synchronous, read-only **current** policy check. This storage class
does not authenticate a claimed principal. Source IDs are validated with the
candidate grammar; opaque credential-generation mapping remains integration
work and cannot contain a bearer token or token hash.

`lookup` repeats current authority inside its short SQLite transaction. Missing
and inaccessible return the same null. Retirement, owner change, wrong world,
revoked invitation/agent generation and admin demotion deny private lookup/retry
when the trusted policy says so. Transfer never grants old-owner private receipts
through a reused request/principal key. HTTP no-store/status and actual Auth/MCP
binding still need their adapters and route tests.

`finish` requires the original internal worker lease, validates request/receipt
scope and semantics, and durably stores an immutable terminal receipt. Exact
repeated terminal writes are harmless; different answers conflict. A trusted
worker may store a private refusal after authority loss: later revocation does
not erase why the old operation was refused. Understood/withdrawn additionally
require a synchronous producer check of **real canonical acceptance in the same
Db transaction**. That check must verify the specific revision/withdrawal fact,
not just current permission or a supplied `true` flag. Their concrete canonical
producer is not installed by this component.

## Pending is not an acceptance claim

A reserved row with no terminal receipt is private internal pending state. It
is deliberately **not** a fabricated `received` wire receipt or accepted world
revision. This module cannot allocate canonical sequence/tick provenance for
that wire phase. It rejects attempts to finish with a received receipt.

Reservations survive file close/reopen. Duplicates after restart still do not
receive a lease or rerun interpretation. There is no automatic worker resume,
expiry, overwrite or fresh-ID retry. A crashed pending request needs explicit
progress reconciliation before the final service can promise recovery; it must
not be described as currently being interpreted merely because its row exists.

The compiler's accepted partial mints remain the critical next seam. Before
activation, persist request progress and accepted effect references atomically
with those canonical facts, reconcile a crash between acceptance and receipt,
and test that neither minted effects nor paid calls repeat. Also install named
private log/fold/public handlers, exact purpose-version admission and retained
intent projection/restart codecs before publishing any V2 event. Pending rows
are not card-readable world state or a timetable/routine/work queue.

## Proof

Final **52/52 focused checks passed**, no skips/TODO, across request ledger,
compiler fence, intent history, prompt authority, living/spend and database lock
tests. Server typecheck and diff check passed on Node 26.8.2. Nine new ledger
tests use actual SQLite, including file close/reopen, an exact migration-7
upgrade, parallel worker-thread connections and changed-authority callbacks.
Only the worker that creates a reservation gets a lease; an identical concurrent
request returns a duplicate, a different concurrent body conflicts. Tests leave
world event count and paid cost unchanged. Unique files/directories under the
worktree's ignored `.e2e/intent-ledger` are removed; no live database was used.

Verified terminal persistence is a refusal. Understood/withdrawn tests prove
that absent/failed canonical proof and inconsistent scope/words/version cannot
write a terminal receipt; they do not invent accepted canonical events to claim
those paths qualified. No real producer success/withdrawal transaction, HTTP/MCP
202/200, native response, private public-surface marker test, actor admission or
automatic crash recovery is claimed here. The previous guard pin's complete
92-check server suite remains its receipt; it was not needlessly repeated for
this additive private table. Focused migration/current policy checks ran now.

Initial run failed before tests because a constructor parameter property is not
supported by native Node strip-only TypeScript. It was replaced with an explicit
property/assignment; subsequent nine new tests and final 52-check suite passed.

## Integration and rollback

This component depends on the accepted G-004 candidate and opt-in guard pin.
The agreed selected-world transport remains gated. The final service owns
reservation-to-canonical-received provenance, compiler progress, accepted fact
publication/terminal receipt atomicity, bounded retention and limits, canonical
reconciliation and actual owner/agent/public/restart fixtures.

Older compatible code ignores the extra table and its migration record; it must
not delete pending/private rows to make a rollback appear clean. Any eventual
fallback still preserves the independent prompt authority correction. No main,
push, deploy, production account/token, budget or admission change occurred.
