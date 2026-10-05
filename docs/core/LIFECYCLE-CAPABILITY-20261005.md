# Private lifecycle response capability

The explicit lifecycle installer now supplies optional `lifecycleCapability`
on authenticated `GET /v1/me`. This is additive and private, uses `no-store`,
and is absent without the installer or the current human invitation. The route
rechecks the actual user record after authentication returns. Main/bootstrap,
invitation, account limits, ownership, writes, receipts and birth policy are
unchanged. The previous lifecycle receipt codec remains byte-identical.

`ownerLifecycleCapabilitySchema` defines the strict projection:

```json
{
  "contract": "owner-lifecycle-capability/1",
  "worldId": "the-selected-host",
  "userId": "the-current-human",
  "receiptContract": "soul-lifecycle/1",
  "historyContract": "owner-lifecycle-list/1",
  "optIn": {"header": "X-Sim-Lifecycle", "value": "1"}
}
```

This advertises an available response protocol. It is not a bearer credential,
permission grant, capacity promise, idempotency key, admission, fresh readiness
or a visible body. A pending owner may receive it while their usable Soul list
is empty. Consumers must strictly decode and match current Me.userId and the
configured selected world, clear on account/world change, and await fresh
correspondence before enabling control. Missing or malformed capability must
not trigger a speculative header write or automatic retry.

G005 remains the response contract: opted-in accepted pending/retiring uses202;
qualified terminal uses200 with lifecycle, and actual arrival refusal uses409.
Legacy200 is terminal; accepted-but-unconfirmed legacy503 and lost/malformed
responses require private refresh. Name conflict is not delivery confirmation.
Own authenticated creation supplies the human owner; no operator assignment
or impersonation route is added. Receipt access never restores retired authority.

Actual focused native/API proof covers installer absence, uninvited/unsigned
absence, unsupported opt-in with no allocation, selected-host rather than
mutable config identity, two independently invited humans, real202 pending →
actual sequenced native birth → fresh private admitted/ready correspondence,
foreign404, held Auth invitation withdrawal/deletion, and strict malformed
projection rejection. Anonymous config/world/debug-world/scene/kernel/log/take
surfaces exclude the capability and private request ID at the tested head.

Final affected45 PASS across the new five cases, existing actual lifecycle
HTTP, private authority and receipt-codec suites; server scoped ES2023 types0.
A strengthened public-surface negative has a separate affected one-case PASS.
All compiler/minds local/fake/$0, disposable SQLite, closed resources. No UI,
realAuth, installed-agent, cohort/capacity, full privacy or release qualification.
Frozen8dc/primary03 and earlier immutable inputs remain unchanged. App consumer
adoption requires review of this exact new producer/codec pin; the old G210
receipt read-only grant cannot silently be treated as this new capability.
