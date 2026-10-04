# Body-based agent pairing poll

App C-025 requested Core's HTTP implementation of the secure launcher's poll
transport. This additive route is independent of V2 intent activation. Parent
is accepted event journal396ae7f; no main/live mutation or migration.

POST `/v1/agent/pair/poll` takes exactly `{ "poll_token": "..." }`. The generated
24-byte base64url token has 32 characters; absent, malformed, extra-field and
query-only credentials fail400. It uses the existing `pairpoll` IP rate bucket
shared with legacy GET. Pending and approved responses preserve their current
shape and one-use15-minute semantics. Unknown/expired/used polls return404;
rate exhaustion429 with Retry-After. Pair start/exchange, owner code generation,
approval and approval metadata now use no-store, including parsing/auth/rate/
body-size errors. Legacy GET remains a compatibility route and is unsuitable
for the secure launcher because its secret is in a URL.

Actual fixtures found that an approved, undelivered poll previously returned an
old token after rotation/revocation or a changed owner. Delivery now rechecks
original ownership, active selected-world Soul, current approving user and
invitation/owner-or-admin authority, and the exact current token hash. Owner
code exchange also rechecks current original ownership/issuer authority. A
denied delivery consumes the approval and returns no token. Existing admin
approval remains subject to its current role. Foreign-world Soul IDs are refused
by owner routing and foreign bearer rows by shared Soul token lookup.

StaleCompilation now says “Request became stale; earlier accepted effects may
remain”. Real two-card compilation still proves that the first accepted mint
survives refusal of the second. No fresh-ID retry is suggested: the future V2
consumer must resolve its durable request before resubmission. Current V2
reservation duplicates supply no lease/call; actual V2 consumer remains pending.

Proof uses real Hono/Auth/SQLite/Souls/WorldHost and fake Brain, in-process with
no network/provider. Seven top-level pairing cases include seven nested authority
changes: approval→body poll→consume once→agentMe/perceive→revoke; wrong owner,
unknown/expired token, strict body/malformed JSON/oversize errors, error no-store,
shared GET/POST rate bucket, token rotation/revocation/retirement, owner/world
change, invitation revoke/admin demotion, foreign-world IDs/bearers and owner
code one-use/current authority. Pair plus compile-fence run:37/37; server tsc
passes. Replacement full server invocation:120/121 pass, one failure,162.7s;
no skips/cancellations. The existing native Mars DJ story failed its Rob:say yes
ordering assertion: Wren joined Rob's gathering, later asked and became DJ at
Rowan's gathering instead. All new pairing cases and real legacy HTTP/MCP/WS
integration passed. This remains an unresolved behavioral qualification failure,
not a green full suite or a proven regression caused by the pairing change.
No blind story rerun; retain its actual trace for follow-up steering work.

The first broad invocation was stopped at88.8s after old Mars/sync test fixtures
opened4976/4750 outside Core's4950–4959 range. It remains incomplete:109 passed,
four cancelled, exit1. Only those own test ports were corrected to4950/4951;
the suite runs serially and the replacement invocation is a distinct receipt.

Limits: development identities are synthetic non-admin/admin Auth users, not
real Privy accounts. No OS credential store, launcher, installed MCP client,
browser or real two-owner cohort proof. Pairing requests remain in memory and
are lost on restart. Secure setup still requires App's audited client and PM's
package/static wiring. Already delivered bearer generation/ownership semantics,
MCP token URL retirement and bounded scoped perception remain separate work.
No intent-v2 endpoint/capability was activated and legacy steer meaning is intact.
