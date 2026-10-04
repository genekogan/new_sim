# Compiler acceptance fence — October 4

An opt-in compiler request can now refuse a result after ownership, authority,
body identity or will changes, including while its mint/deck event is waiting
for a tick. This is an isolated implementation seam for G-004. Existing routes
do not pass a fence; legacy steering and NOW behavior remain unchanged.

## Acceptance point

`captureCompilationFence(host, db, mind, currentAuthority)` captures the current
Mind identity, Soul/world/body/owner and `intentVersion`. It immediately checks
these and returns a synchronous, read-only check. Every later check reads the
current Soul row and caller-supplied current authority policy. Active body and
kernel body binding must still exist. Ordinary ticks and movement do not cause
rejection. The caller must derive its authority callback from authenticated
server context; neither a client flag nor a captured UserRow/SoulRow suffices.

`Brain.compile(..., guard)` checks before each compiler attempt, after its reply,
before minting, at each queued mint/deck acceptance and before returning success.
`Brain.mint(..., guard)` also supports direct guarded card proposals. Production
compiler transport remains `callTool`; an optional constructor service permits
the focused tests to inject a synthetic reply into the real compiler path.
No provider, budget, model selection or caching policy changed.

`WorldHost.enqueueChecked(..., guard)` checks immediately before allocating the
canonical sequence and appending/applying the event. A refusal rejects that
promise, consumes no sequence and emits no application notification or recovery
event. Other queued inputs continue. It accepts only synchronous `true`, never a
Promise or truthy value. An accepted event remains a historical fact; its guard
is neither serialized nor consulted during replay or snapshot restoration.

## Proof and limits

Final focused validation: **54/54 checks passed**, including subtests, with no
skips/TODO, across compile-fence, mandate, replay-regressions, prompt-authority
and intent-history tests. Server typecheck and diff check passed, Node 26.8.2.
The new file has eight top-level tests / 23 checks. Real compiler validation,
mint/deck queue, SQLite, fold and WorldHost log/snapshot boot execute. Only the
model reply is synthetic; paid ledger and reported model cost remain zero.

Covered: owner/world/entity change, retirement, will change, replaced Mind,
removed body/binding, deleted principal/invitation, current admin demotion and
exact agent generation rotation. Delayed real compiler replies reject changed
owner/will/invitation. An earlier same-tick intent invalidates a queued mint.
Queued existing-card deals also refuse retirement. Unrelated input survives a
refusal. Accepted guarded events retain identical kernel/physical hashes through
actual WorldHost log boot and snapshot boot after later authority revocation;
kernel-only replay also matches without a model.

The complete server suite then passed **92/92 checks**, no skips/TODO (153s).
This exercises existing actual native carry/recovery/restart, recorded producer,
Toy/Mars HTTP/WS/agent REST/MCP and archive tests with fake models. Its two owned
ephemeral child servers stopped via their test cleanup (SIGTERM receipts); no
live service was used. These existing journeys do not constitute V2 transport,
responsive ordinary-language or mounted browser proof.

Two initial test assertions failed and were corrected: hashing a MintedCard
including provenance is not the original card hash; `replayFromGenesis` has an
exclusive `untilTick` and does not include events accepted at that head tick.
The receipt/hash assertion now checks the compiler verdict, and the paused-head
test uses actual WorldHost boot plus kernel replay. No replay-helper semantics
were changed or silently claimed qualified at that boundary.

The compiler is **not an atomic multi-card transaction**. A test deliberately
accepts its first mint, then revokes authority before its second. The first fact
remains; the later effect is refused. A stale result does not undo an accepted
mint, refund a paid call or mean nothing happened. A durable request service must
retain that progress and reconcile a crash rather than blindly rerun the call.

Queued checked requests are still ephemeral. No durable request reservation,
lookup, resume, purpose revision, native ordinary-language wake, public/private
V2 transport, physical admission or actual REST/MCP policy proof is claimed.
The current fence uses the legacy coarse `Mind.intentVersion`; future V2 edit
admission additionally checks the exact requested purpose revision. Relevant
scene/support/body-capability facts require their own admission validation.

## App checkpoint review

Read exact App `8f54580`, `docs/app/INTENT-V2-CONSUMER-CHECKPOINT.md`, and
`89365c8`, `docs/app/COHORT-ADMISSION-CHECKPOINT.md`.

Core accepts the proposed selected-world owner/agent POST paths, request-lookup
GET paths, MCP names `soul_intent_v2` / `soul_intent_request_v2`, exact candidate
request/receipt grammar, 202 durable received / 200 terminal, uniform unknown or
inaccessible lookup 404/no-store, semantic defaulted-request conflict 409 and
capability-based opt-in. Legacy routes/tools retain meaning; no timeout/404
fallback or automatic fresh-ID resubmission. Current owner/admin/invite and exact
credential generation revalidation, private named handlers and truthful receipt
vs physical outcome distinctions are required, not discharged by this seam.

Reservation, canonical sequence/tick provenance, accepted revision publication
and terminal receipt persistence must be specified together so a crash cannot
invent acceptance or remint effects. Opaque credential-generation IDs need a
persistent trusted mapping reviewed with App, not exposed tokens/token hashes.
Candidate identifier grammar must be checked against actual server identities.
Agreement on adapter names/policy does not advertise the capability or activate
V2 until the proof/checkpoint gates pass and PM agrees.

Core also accepts the cohort proposal's existing invitation/self-create scope
and will qualify failed/full arrival consistency before App enables creation.
An inserted Soul row followed by a failed native spawn is not a usable-body
success. This is separate lifecycle work; no cast transfer, birth quota,
production account or admission change is included here.
