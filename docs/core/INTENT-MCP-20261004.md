# Shared candidate intention MCP transport

October4, after HTTP implementation234081e and station provenance14d44bf.
Explicit optional `handleMcp(req,res,souls,intentV2)` registers the agreed
`soul_intent_v2` write and `soul_intent_request_v2` read tools. Production main
still calls the original three-argument handler. No default tool/capability,
root/route/policy/Auth/skill/renderer/paid/main/release activation.

## Shared behavior

The candidate must share the same selected host/Souls as `IntentControlV2`.
Before slow body reads it captures a trusted `agentScope(token,'mcp')`; token,
owner invitation, current Soul/body/Mind and opaque generation are checked after
the read, before every tool and at final reply. Candidate installation also
protects legacy private tools with this current guard when the independent
lifecycle installer is absent. Default legacy behavior stays on its prior path.
Candidate init/list/call/error/405/413 responses are no-store.

Both new tools call the exact shared service/publisher/request store, never a
second compiler or controller. Write consumes the strict soul-intent/2 request;
read accepts only requestId, without a Soul selector. Receipt content is the
same bare canonical grammar as REST. JSON-RPC HTTP200 is transport delivery;
`phase:received` still means pending interpretation and `isError:false` does
not establish action or fulfilment. Conflicts/unavailable/missing/current-authority
failures are safe tool-error envelopes. No retry, legacy fallback or synthetic
physical completion. A valid new generation cannot read an older namespace.

MCP SDK1.31.0 advertises a union-root input as an empty object despite validating
that union at call time. The discovery object derives fields/validators from
the existing authoritative request union, removes optional default wrappers
(which would add forbidden fields to withdrawal) and lists the actual strict
object fields. Conditional full request validation delegates to the existing
union before SDK diagnostics and again in the service. Lookup's strict object
uses that same requestId grammar. No new request vocabulary/parser is introduced.
Before SDK validation, malformed private arguments receive a generic invalid
result; credential-shaped unknown property names cannot enter its diagnostic text.
The catalog's conditional semantics are explained in the tool description;
its object JSON schema alone is not the whole authoritative union.

Annotations identify an idempotent write versus a read. They do not authorize
repeat mutation under a new request identity. REST/api and MCP/channel aliases
share the same durable world/Soul/current-generation/request namespace; original
source channel is retained on retry in both directions. Withdrawal needs the
actual current version and no compiler. Existing URL-token compatibility is
unchanged; these fixtures use headers and do not qualify named connector setup.

## Executed evidence

Final11 new tests in `apps/server/src/intent-mcp.test.ts`: actual SDK Client /
StreamableHTTPClientTransport initialize/discovery/calls against the actual
stateless MCP server over localTCP4958. Token is obtained through the existing
local owner pair-code/exchange, not a hard-coded production credential. Native
Mars camp/SQLite/Hono/HTTP and MCP share the extracted
`apps/server/test/intent-native-fixture.ts`; compiler transport is synthetic,
Jev fake, paid$0. No live Privy/model/CLI/Keychain/named-host/browser qualification.

Actual paired SDK agent gives an ordinary campfire direction to a sleeping body:
received186, publication186, observed walking231, native arrival682; earlier
optional friend purpose remains, two total synthetic compiler calls and exact
model-free inclusive genesis body hash, no native violations. This is bounded
simulation-clock responsiveness, not wall-clock latency or broad-purpose completion.

Other new proof: candidate-only tool discovery/actual fields/read-write annotations;
REST→MCP and MCP→REST duplicate/final receipt/audit retention; semantic defaults/
conflict/no repeated call or accepted effect; strict withdrawal; malformed argument
and credential-shaped-key diagnostics; actual SQLite graceful close/reopen and
receipt/generation lookup; rotated old identity401/new generation hidden request;
real slow-body rotation before tool registration; delayed compiler rotation,
invitation loss and retirement; final reply denial after earlier valid received
fact; existing private perception denied after rotation without lifecycle setup.

Corrected combined run **43/43** =11 MCP +20 HTTP from the extracted shared fixture
+12 affected lifecycle/default MCP tests. Final current11 after a test-only type
correction passes; server TypeScript exit0. No broader passing suite repeated.

Initial **4/11**: fixture object spread copied a zero call counter and detached
its held-compiler setter, causing false early terminal expectations; repeated
server closure/rebind reused connections and produced ECONNRESET. Corrected by
preserving the live fixture object and setting Connection:close only on the local
test server. Production transport unchanged; no POST retry added. Initial tsc
rejected a direct property comparison narrowed to sleep across native ticks;
the test now reads activity freshly through a function. Failures remain failures.

## Stable consumer input and next seam

The extracted fixture is committed with this milestone for App's separate mounted
human receipt/uncertainty/native proof. It keeps the same native factory, seed,
world, local authenticated principals, actual compiler validation/journaling path
and default-off service as the prior HTTP fixture. Tests use a real TestContext
for cleanup/mocks; a standalone consumer runner must own equivalent cleanup and
mock lifecycle, drive the host explicitly, and describe that harness scope.
It does not create or start a service on import, pay a provider, run a worker,
expose credentials, or change production bootstrap. Its module-level factory is
an existing native scene; a fixture call allocates only its explicit local DB.

App's fifteen paced-station runtime/transitive/lock inputs remain exact234081e;
MCP/helper/test/doc changes touch none of them. App9f6e491 short actual paced
native/two-listener source/receipt/interface counterpart accepted separately
with all15 Core hashes and saved receipt independently matched; Core did not
rerun its browser/audio. Scheduling/shared requested targets are not acoustic/
device output phase, full128beat transitions, long radio or default adoption.

App requests a precise current own-selected-Soul `intentContract` capability DTO
for future Shell activation; candidate source/authorization/shape proposal is
next owned seam. A missing route/404 or engine-needs flag must never select V2
or trigger fallback. This transport milestone does not invent that projection.
App accepted exact234 HTTP source-policy scope; mounted/new MCP counterpart and
capability agreement remain separate. All G004 behavioral activation/compatible
history+outbox+generation-writer rollback/retention/worker-loss/reconciliation/
signedJWT/realowner/provider-quality/post-start-safe-withdrawal/soak/fullG gates
remain open. No model-free replay claim for unlogged idle tails is added.

Broader Goal stays active; initial window ends October6 23:59 America/New_York.
Only PM may merge/push/deploy after Gene's explicit merge-closure handover.

## Malformed-envelope follow-up after the e93 milestone

PM C143 reproduced that String(rpc.params.name) throws for JSON name
{"toString":0,"valueOf":0}. One new actual paired local SDK/TCP negative test
reproduced an escaped handler rejection: the local test server's fallback
returned503. The adapter now checks typeof name==='string' before checking the
agreed tool names, leaving malformed envelope validation to the existing SDK.
Final focused **1/1**: HTTP200 carries JSON-RPC error **-32603**, not a receipt or
success; no TypeError/credential/hash echo, no compiler/canonical/model effect,
and a subsequent valid tools/list still responds. SDK1.31's outer Zod request
parser maps this malformed request to InternalError before its InvalidParams
wrapper. The first corrected test expected-32602 and failed; exact SDK source
and observed-32603 explain the corrected expectation. No SDK/root change or
broader pass claim. The earlier43/11 evidence remains at its stated source pin;
those passing suites were not repeated for this one-line malformed-name fix.
