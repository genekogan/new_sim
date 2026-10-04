# Isolated ordinary-intention HTTP transport

October 4, 2026. Core candidate after `3be1a84`, implementing the exact
App/Core/PM G004 transport agreement. No production bootstrap, capability
advertisement, legacy steering meaning, App-owned auth/skill, renderer, root
wiring, main, push or deployment change.

## Installed candidate

Explicitly construct `IntentControlV2(host, brain, souls)` on a shared DB and a
Brain constructed with `intentV2Choices:true`, then inject `intentV2` into
`buildApp`. A different host/Brain/Souls or a default-off Brain is refused.
Production `main.ts` constructs neither the service nor that switch.

Owner POST `/v1/souls/:id/intent-v2`, GET
`/v1/souls/:id/intent-v2/requests/:requestId`; agent POST
`/v1/agent/intent-v2`, corresponding request GET. Bodies consume the exact strict
`soul-intent/2` grammar. Successful bodies are bare `IntentReceiptV2`, not a
legacy `{ok,understood}` response. Canonical received returns202; terminal
understood/refused/withdrawn returns200. All paths, including inactive404,
auth/schema/body-limit/error responses, are no-store. No implicit legacy fallback.

Server-stamped owner source uses the authenticated human principal; admin
control is explicitly `operator` with the actual target owner. Agent source
uses a random durable `g_` credential-generation identity, never bearer/hash.
Migration14 adds one nullable private Soul column without inference/backfill.
Normal token mint/rotate sets a fresh random generation, revoke/retire clears it;
pre14 tokens receive one through a compare-and-set only in the opted-in adapter.
Legacy token lookup itself does not assign one. Rotation removes the old
credential's access and isolates the new request namespace, including an
identical request ID. Graceful actual SQLite reopen preserves generation/receipt.

Current owner/invite/admin role, active selected-world Soul, owner/body/kernel/
Mind bindings, scoped credential/hash/generation and relevant purpose version
are checked across awaits and acceptance. The real compiler receives the same
preparation guard and atomic accepted-effect journal as final publication. Final
HTTP serialization checks authority again. Human JWT expiry is derived only
after Auth verifies that exact bearer, then bound to synchronous guards. Dev
credentials use their existing local identity and have no synthetic JWT expiry.
This does not introduce a global Privy session-revocation registry.

The common service durably reserves one worker before interpretation. Semantic
defaults/hash define duplicate identity; duplicate terminal or received retries
return the same stored fact without another call/mint/action. Body reuse or
already stale expected version returns409. Concurrent interpretation may first
return202 and later record a private refused `version-conflict` receipt; it cannot
rewrite the earlier response or overwrite another accepted version. Withdrawal
uses the same request namespace and publisher without compiler work.

A bounded in-process set tracks current work (64 global); new submission rate
uses existing per-Soul/principal limits20/minute. This is not multiprocess,
load/retention or sustained-cost qualification. A pre-canonical crash/failure
reservation has no received receipt and returns503 on duplicate, never another
worker. A captured received request may remain202 after worker/storage loss;
no automatic restart or retry is introduced. Corrupt retained receipt lookup is
503, not an invented404 or success. Unknown/inaccessible lookup is uniform404.
Missing/invalid agent identity remains401 before lookup; a valid new generation
cannot see the old namespace. Internal/provider/storage error details stay private.

## Actual evidence and failures

`apps/server/src/intent-transport.test.ts`: final **20/20** new checks, Node26.8.2,
single shared heavy lease. Actual local dev authentication (two ordinary human
principals and existing admin), Hono, native Mars camp engine, canonical log,
SQLite, real TCP HTTP and anonymous Hub WS. Compiler transport is synthetic
zero-dollar injected output; native chooser is fake Jev. No provider/network
model, real Privy owner, browser or mounted App/World claim.

Ordinary HTTP words `go to the campfire` while a body actually sleeps on a mat:
canonical received186, interpretation publication186, observed native walking231,
actual campfire arrival682. Older independent optional friend-purpose remains
private context; two compiler calls total including that earlier purpose. Model-free
inclusive genesis reproduces native state hash; no native violation and paid$0.
The observed45tick/2.25 simulation-second transition is a bounded fixture result,
not live wall-clock or universal responsiveness. Receipt understanding is not
physical completion or broad-purpose fulfilment.

Other new checks: semantic retry/conflict/no reissue, failed canonical receipt
transaction, queued body/invite/rotation guards, delayed compiler invite/operator/
rotation/retirement/ownership loss, direct trusted expiry guard, post-acceptance
final HTTP revocation, concurrent edits/withdrawal, missing compiler, inactive
adapter, malformed/oversize body, wrong world, opaque generation/lazy migration,
actual file reopen and old-generation access denial. Real TCP owner/agent submissions
and anonymous join/live batches plus public log/kernel/debug/world/scene/takes
exclude private words, summaries, request IDs, generation, bearer and hash markers.

Earlier affected run had **77/78**, exposing a stale reservation migration fixture:
it deleted all later migration records while only dropping reservation tables,
so migration11 tried to recreate a retained table. Corrected its reconstruction
to remove only records8–10; preserving later retained schema is part of that test.
Next run **78/79**: only the new migration14 check failed on SQLite's null-prototype
row versus a plain expected object, with identical values. Corrected test compares
plain field copies. The 60 affected publication/request/lifecycle-write/pair checks
passed in that run; no broad re-execution after their unchanged source.
New+default replay run **23/23** preceded the final corrupt-lookup hardening
(19new +4default). Final20 new tests qualify current hardening; earlier4default
replay evidence covers unchanged default runtime. Final server tsc exit0.

Initial new run13/14 failed because a wrong-world fixture used factory fields
`schema/dt` that belong to the actual runtime; corrected to host.engine fields.
Initial tsc failed on Hono.request's `Response|Promise<Response>` inference in the
fixture, corrected async helper signatures; runtime source types had no error.
All failures remain failures at their original pins; later passes are scoped above.

## Review and remaining gates

App source/policy counterpart and mounted V2 receipt/uncertainty/native journey
are required before activation. MCP tools `soul_intent_v2` and
`soul_intent_request_v2` are still uninstalled, though the shared service accepts
trusted mcp channel scopes. Real owner/provider language quality, current JWT
expiry through actual signed Auth, post-start edit/withdrawal safe behavior,
worker crash reconciliation through these new routes, retention/soak/capacity,
fulfilled-purpose evidence, capability/default mounting and compatible private
reader/outbox rollback remain open. Multi-mint is journaled, not an atomic whole.
Older binaries that rotate credentials without updating generation cannot be
assumed safe downgrade writers; do not adopt or activate them against this new
private namespace without explicit compatible rollback qualification.

Station codec/producer/fold/Hub/world host/native factory are unchanged from the
previous station/commons pins. New Db changes only migration14 and private token
metadata; Brain adds a read-only opt-in flag; HTTP adds optional V2 routes. App
paced-station fixture must pin current committed sources/dependencies rather
than import moving worktree files. No station/default activation from this MR.

Post-commit station follow-up initially returned4/5: the preserved station
recording's provenance test compared its earlier authored HTTP hash with current
HTTP source. (The mismatch was HTTP, not Db.) Preserve the exact27b78076 recording
and all nine authored hashes against producerd0b08ff. The corrected check now
explicitly qualifies that immutable historical input; a separate fresh actual
current-source generator exercises native station/SQLite/genesis/TCP/WS again.
This is compatibility evidence, never a rewrite of the old receipt as a new run.
App's15 runtime input hashes remain exactly234081e; the follow-up changes only
this document and station.test.ts. Final follow-up10/10 includes the fresh current producer, finite codec and
history checks; final server tsc exit0. The first4/5 remains failed.

Broader Goal continues into the retained-intention/privacy/physical program.
Existing-world commons transition/rollback and terrain/water/boat/composition/
memory work remain unfinished. Window ends October6 23:59 America/New_York;
main/release handover still requires Gene's explicit confirmation in PM chat.
