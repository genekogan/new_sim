# Internal owner lifecycle HTTP candidate

Scope: G-005/C087/C094, after current-character fix9127951. This is an isolated
producer candidate. Production startup does not call `Souls.enableLifecycle()`;
no capability is advertised and no App consumer is activated. Installation requires
the qualified native `+crew-removal/1` rules/hash/restore policy. Default worlds and
legacy lifecycle methods remain unchanged when the installer is absent.

## Implemented boundary

The candidate routes creation/retirement through the durable journal transaction
and native runner. Pending creation reserves count/name, stays outside both HTTP
Me usable-Soul lists, and cannot use ordinary owner control/pair routes. Retirement
acceptance revokes tokens and pending pair deliveries immediately; body removal
and its separate terminal checkpoint remain canonical native work. The historical
create receipt is refreshed after both retirement acceptance and actual removal,
preserving a detached original birth fact and exposing no renewed control authority.

Owner/admin exact receipt reads (`GET /v1/lifecycle/:requestId`) and page20 private
history (`GET /v1/lifecycle?cursor=...`, optional authorized admin `owner`) recheck
current invitation/role, selected world and row identity. Foreign/unknown/unavailable
new reads use the same404 body. Explicit malformed/empty cursors are unavailable.
All private candidate responses/errors are no-store. HTTP Me exposes an additive
`lifecycleRequests` page and only currently usable identities in both Soul lists.

`X-Sim-Lifecycle: 1` returns202 `{lifecycle}` for durable pending/removing work,
200 only for actual admitted-ready/retired, and409 for proven ordinary arrival
refusal. No `ok:true` or success-shaped Soul accompanies pending work. Unsupported
opt-in and malformed input accept no operation/allocation. Existing create count,
case-insensitive name and hourly rate policy remains; these are not retry keys.

Legacy HTTP callers wait at most two real seconds for actual terminal readiness/
removal. Confirmed success keeps the previous200 body; unconfirmed work returns503
`lifecycle-pending` with its private projection. This is an accepted operation,
not a refused write or permission to automatically retry. Final response refresh
reauthorizes current human account/receipt. A withdrawn invitation fences pending
birth admission and an outstanding legacy response; reinstatement can reconcile
that same operation/identity.

Valid legacy canonical births with exact current body/Mind/kernel correspondence
retain access without invented lifecycle requests. A bare orphan row does not.
This fixture uses the candidate policy world; it does not qualify old-world migration.

The internal runner has an optional committed-input hook. The installer pumps
after a successful queued input settles, when its in-flight marker has cleared.
Deferred/rejected guards do not trigger an immediate retry loop. Physical removal
still requires another sequenced checkpoint acceptance; no world tick or model is
fabricated merely to answer an HTTP request.

## Executed checks

`node --test --test-concurrency=1 apps/server/src/lifecycle-http.test.ts`: **10/10 PASS**.
Actual Hono/Auth dev accounts, invited ordinary Alice/Bob, SQLite, native engine
and fake Brain; no stub canonical identities. Includes fresh admin/invitation
scope, pending/control denial, actual legacy confirmed200 and measured real2s503,
retirement/token/pair invalidation, both historical receipt refresh phases,
ordinary native unavailable refusal/liveness, concurrent same-process count/name
requests, canonical legacy/orphan distinction, invalid pre-acceptance requests,
invitation withdrawal/reinstatement, and actual TCP response loss on127.0.0.1:4956.

The socket test destroys the accepted202 connection before the reply reaches the
client. Me finds exactly one pending operation; exact receipt refresh after real
host acceptance finds the same Soul/entity and one birth. No create is retried.
The accepted request ID is absent from actual canonical event JSON. Listener closes
and local DBs close. No paid providers/keys/services/production DBs are used: $0.

Failures retained: first run4/7PASS exposed admission remaining pending after
birth application until another tick; optional successful-settlement pumping
corrected that actual adapter gap. Second6/7PASS exposed the test draining removal
and terminal checkpoint synchronously before the settlement microtask could queue
that checkpoint; test now waits for that separate acceptance. Then7/7PASS, expanded
10/10PASS. No claim that the latter harness timing failure was a physical defect.

Server TypeScript passes. Runner/character regressions are rerun because their
queue settlement/helper surface changed; exact results recorded in the merge request.
Earlier storage/crash/native policy/default-camp proofs remain separately bounded.

## Remaining gates

This is **not full G-005 executable conformance**. Queued/in-flight human/agent
write fencing, fresh authority across every async control/read delivery, WS Me/
public replica filtering and actual public take privacy, additional token/account
and pair-poll races, multi-process acceptance, old-world transition/rollback,
real owner onboarding/native cohort capacity and consumer adoption remain open.
Existing guards on initial owner HTTP requests cannot prove queued authority.
Do not install or advertise this candidate until those gates qualify. Default/live
orphan/retired-body/unavailable-birth defects from de2c baseline are not repaired by
selecting this isolated fixture. No main merge, push, deployment or live repair.
