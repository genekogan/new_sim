# Internal lifecycle shot and pairing authority

After735ce64. Same accepted G005 current-authority/credential policy, Core-owned
HTTP/Souls scope. No auth/skill/UI, account, new permission, default installation
or capability change. All local native/fake/$0; no paid model or live incident.

## Two concrete corrections

An actual Hono/native/fake camera request first passed1/2: normal usable camera
proposal succeeded, but a proposal computed by Brain.shotFor then held locally
was returned200 after durable logical retirement acceptance. The canonical body
still existed. The shot HTTP route now checks its existing ownerControlGuard
before invoking Brain and passes that guard through existing controlReply for
final delivery after awaiting the shot. The actual generator, response schema,
rate limit and default behavior remain. Already-recorded private BrainCall output
is historical data; the fix withholds the stale HTTP result rather than rewriting
it or claiming a physical replay change.

Expanded shot/pair first10/12 exposed a separate pairing gap. After an admin
approved an agent, removing the actual Soul owner's invitation still permitted
poll200/token because pairAuthority only checked the approving issuer's invitation.
Candidate token authentication already denies an uninvited owner; this is stale
credential delivery, not demonstrated usable-control escalation. Candidate
pairAuthority now also requires an existing invited current owner before approval,
exchange or poll. Captured original ownership/issuer, current world/readiness,
issuer role and pending-token hash continue to be checked. Installer-absent
behavior remains unchanged. No new credential or transfer model is introduced.

The other10/12 failure was a test deleting a Soul-owning user, blocked by SQLite's
actual FK. The fixture was corrected to delete a no-Soul admin issuer; foreign
keys were never disabled. It is a harness correction, not a database fix.

## Executed proof

`node --test --test-concurrency=1 apps/server/src/lifecycle-shot.test.ts apps/server/src/lifecycle-pair.test.ts`:
**25/25 PASS** (shot10/pair15), after shot1/2→2/2, combined10/12→12/12.
Actual Hono HTTP requests/dev Auth, SQLite, native candidate body/kernel/Mind,
fake Brain/JeV. The shot computation is real; only its post-computation return is
locally held. The pairing tokens are freshly generated transient credentials,
used in requests and never printed or included in canonical events.

- Normal actual camera proposal/no-store and installer-absent native owner shot.
- Held shot denial after retirement, invitation/role/ownership/world/body/user
  changes. Invalid current invitation never invokes the generator.
- Agent-start pending, ordinary-owner approval/one-use poll and usable token,
  GET polling shape/no-store, owner-code issue/exchange/one-use credential,
  installer-absent native approval/poll/exchange, and
  foreign approval denial without minting.
- Approved pending delivery denies retirement, invitation, admin downgrade,
  owner/world/body mismatches, token rotation and approving-user deletion. Denied
  polls return no token and cannot redeliver on a later poll.
- Admin approval/exchange for a currently uninvited owner denies before token
  hash creation. Logical pending Soul cannot issue/approve credentials.

Twenty-five in-memory DBs close; there are no listening services or child processes
in this Hono test slice. Existing fixture unref timers end with the test process.
No claim of TCP body/last-byte stress: actual socket MCP/WS proofs remain separate.
Server TypeScript and diff checks pass. Prior HTTP34/MCP12/WS12/native held-crew
evidence is retained, not rerun or expanded by adding these counts together.

## Remaining gates

No bootstrap/capability/consumer/main/live adoption or fullG closure. Other private
read routing and slow body/auth interleavings, role configuration/JWT-to-DB
revocation, buffered delivery, every MCP/SDK protocol response, multi-process/race
stress, compatible old-world transition/rollback, native population capacity,
real owners and long runs remain separately qualified. Current owner eligibility
at pairing cannot establish that every earlier account/default behavior is safe.
Default cached WS authority remains held. World's actual C095 public departure
consumer proof is independent; this change does not modify takes or public bodies.
