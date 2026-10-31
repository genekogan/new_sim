# G-001 — current owner/control API baseline

Publisher: Core; App owns human/agent consumers and permission policy.
Current scopes and future G-002/G-003 proposals are accepted; executable
conformance and breaking checkpoints remain distinct from scope signatures.

Public presentation checkpoint (October 4): current `/v1/scene` adds optional
`renderSceneRef`; `/v1/scenes/:hash` resolves an immutable captured render base
registered with an actual take, scoped to this process's world. Unknown/invalid/
other-world references return uniform404; responses use no-store. The strict
`SceneCapturePublication` decoder verifies content, while consumers separately
verify selected world/requested hash. This exposes only existing public render
data, not private intentions or new physical capabilities. Old takes stay
unbound. [Exact backend scope](../core/RECORDED-SCENE-IDENTITY-20261004.md);
App/World source counterparts and history-viewer adoption remain pending.

Internal admission component (October 4): the opt-in native purpose bridge now
produces private `intent-admission-v2` facts linking an exact purpose version to
its canonical decision and actual native program admission/refusal. This adds
no endpoint or capability. Receipt remains understood; admission is distinct
from controller start/completion and broader fulfilment. Decision/fact crash-gap
reconciliation, actual lifecycle, authenticated V2 and compatible rollback remain
activation gates. [Producer evidence](../core/INTENT-ADMISSION-20261004.md).

The subsequent internal controller component records actual native executing
action start and program completion/failure/cancellation with exact private
admission association. Program completion does not fulfil a purpose or imply
all held activities ended. Pure wait/no-op progress, durable observation gaps,
safe post-admission withdrawal and wider recovery remain unqualified. No public
API is added. [Controller evidence](../core/INTENT-CONTROLLER-20261004.md).

## Identity, routes and access

Prefix HTTP/WS/MCP/skill with `/w/<key>` for the selected world. Root aliases
still mean Toy; the coordinated retirement must explicitly migrate/version
them, never reinterpret Toy credentials as Eden credentials. No removal happens
through this baseline. Soul IDs and physical entity IDs are different. Owner
routes/status use Soul ID; public `/v1/world` summary Soul entries use entity ID;
public WS Soul entries carry both `id` (Soul ID) and `entityId`.

Public surfaces: config/health/world/debug-world/scene/take history, kernel,
log/plays/talk and supported grammar/skill docs. These expose public facts, not
private minds. Existing whole-world/public shape is not secretly a scoped Soul
perspective. G-002 will qualify local/regional/atlas and raw-query compatibility;
do not promise that an omitted perceive fact is secret if a public route shows it.
The new selected-world `/llms.txt` HTTP producer returns reviewed App copy as
text/plain before SPA, with links from approved server configuration. Root/proxy,
secure linked skill/client distribution and installed-host qualification remain
separate: see `docs/core/AGENT-READER-ROUTE-20261004.md` for pins and local proof.

Signed-in owner routes include Me, Soul dashboard/timeline/deck/talk/perceive,
command/intent/mandate and pairing/revoke. Existing admin access is explicit;
account/invite policy belongs to App. The paired-agent bearer binds one live
Soul/world; agent status/perceive/deck/log/wait/intent/command/mandate tools use
the same allowed Soul. Revocation and retired-Soul status invalidate its token.
Pairing/approval/waits are process-local today; restart cancels pending work.
No durable pairing/await outcome guarantee is introduced by writing this document.

Private words, rules, current journal, prompts and recovery data require correct
authority. Public event/kernel projections remove those fields before transport.
Prompt debug lookup now requires a genuine retained system reference in a call
in the selected world: current active-Soul owner, or current admin for an
associated selected-world call. Anonymous/Soul tokens receive 401; denied,
missing, pruned, orphan and foreign-world references receive the same 404.
All responses no-store. See `docs/core/PROMPT-AUTHORITY.md` for reviewed policy
and local proof; this does not certify all-route or real-account isolation.

## Actual steering and receipts

Add/edit/remove mandate uses one alignment path. Original words, strict flag,
understanding, agenda, trigger, status and report are retained privately. Current
triggers are none/NOW/time/gathering. Optional/time/gathering wake thinking;
explicit NOW owns a direct agenda. Failed alignment preserves existing rules.
Current status active/done/blocked and strict/block reports retain their legacy
semantics. A rule's accepted meaning is distinct from physical accomplishment.

`steerReceiptSchema` and `SteerReceipt` in `@sim/protocol` describe actual
`Souls.steer` results: accepted rule + text/tick/seq/via/minted, or rejected
reason/via. They do not invent a received/started/completed lifecycle. Removal
currently returns `{ok:true,tick}`. Structured/legacy command forms keep their
existing separate result shapes; no consumer may parse all routes as steer.

`mandateRuleViewSchema` and `ownerSoulDashboardSchema` validate current core
fields while retaining other existing/additive data. Dashboard has status,
agent metadata, created_at and retained-call spend. Out-of-world status has only
id/name/description/in_world; in-world has tick/time/position/activity/doing,
mood/energy/company/mandate, and optional living needs/journal/reflected_day/
customs. Other intent/options/recent fields remain present but opaque in this
minimal decoder; full schema work is incremental. Conditional living fields
are absent on Toy. Do not manufacture a journal or infer an entity ID from a
Soul ID. Spend here is retained call totals, not a durable lifetime Soul bill.

G-002 will add explicit request/intention/activity/outcome association, safe
ordinary-language responsiveness, durable accumulated purpose and scoped
perception. G-003 will add a synchronized public station cue. Those are not
implemented endpoints/capabilities in this baseline, and their real fixtures,
auth checks and compatibility adapters precede shipping a claim.

The internal [atomic admission producer](../core/INTENT-ATOMIC-ADMISSION-20261004.md)
commits newly associated decisions/private admission together before live effects,
using qualified read-only engine admission. This adds no authenticated V2 endpoint
or capability to the current G baseline; controller/purpose/wire/rollback gates
remain distinct. Historical orphan decisions are not inferred or backfilled.

## Bounds, errors and qualification

HTTP bodies on `/v1/*` are bounded at 64 KiB. Query limits/cursors/retention,
owner versus agent error/rate/wait differences and each specific route's grammar
remain source-defined. Current status/options are snapshots, not reservations;
an offered action may become infeasible before execution. Expensive results
require revalidation in G-002. Agent setup docs must state shipped paths only.

`mandate.test.ts` validates actual four-form alignment receipts and the owner
dashboard against these schemas alongside existing private/replay tests.
`contracts.test.ts` includes four-world owner/public marker separation, structural
receipt negatives and W producer cases. `prompt-authority.test.ts` covers the
corrective route with real local Auth/Hono/SQLite and synthetic identities.

Still required: App's actual HTTP/client receipt and permission consumers;
local REST/MCP/WS/history/archive/error marker coverage, wrong-world/revoked
agent negatives, valid owner positives, and later two distinct non-admin live
identity/admission journeys. World supplies viewer/public control conformance.
No full G or clean-profile agent onboarding certification follows from one
component test or type declaration.
