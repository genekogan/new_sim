# G-002 candidate: responsive accumulated purpose

Status: code candidate for App/PM checkpoint review. No route, compiler,
WorldHost event, database migration or physical controller uses it yet.
Exports from `@sim/protocol` use the explicit `V2` suffix and
`contract:'soul-intent/2'`. Current G-001/NOW/replay behavior is unchanged.

## Request and authority

One mechanism accepts plain words and explicit edit/withdraw operations.
An upsert has requestId, words, optional strict/importance, and optional
`edit:{intentId,expectedVersion}`. A withdrawal requires that reference.
An edit conflict cannot silently overwrite another accepted version. Ordinary
clients need no NOW keyword or action/preference category. Importance defaults
to 0.5; it affects consideration, never grants authority or defeats a constraint.

The request cannot supply world, Soul, owner, principal, interpretation,
activity identity or completion. The server stamps world/Soul/source/sequence/
tick after current authentication and ownership checks. Source identifies the
human owner and owner/agent/operator principal; it contains no bearer credential.
Operator is an audit description of existing explicit admin authority, not a
new public role. App reviews this policy before activation.

Request IDs must be durably unique within world/Soul/principal. The future
route reserves the canonical request hash before model work; identical retry
returns the same receipt, conflicting reuse fails. This projection does not
implement idempotent submission or a pending-request store. Revocation, retirement,
world/Soul identity, expected revision and relevant facts must be revalidated
after async interpretation and again at admission. Side-effectful compiler mint
cannot precede that guard; source's current compiler does mint during alignment.

## Meaning and retained purpose

Each accepted revision retains original words, strict flag, importance, source,
understanding, bounded candidate agenda, and trigger. Broad purpose may have
an empty agenda; this is context for future choice, not an executable daily list.
Time/gathering triggers continue to request fresh evaluation. No timetable,
routine object or FIFO scheduling is introduced.

In V2, an ordinary current actionable instruction may be interpreted with a
now trigger and wakes reconsideration promptly. Conditional/optional language
retains its condition. The new chooser must consider feasible current action
against accumulated unfinished purpose and strict context; a now trigger is
not authority to teleport, seize another actor or cancel an unsafe phase.
Old G-001 alignment/NOW reflex semantics remain on the existing path. No old
log event receives the new interpretation retroactively.

`intent-history.ts` is a pure projection of already accepted candidate events.
It retains the latest revision of every purpose, statuses and attempt evidence;
immutable prior revisions remain in the required canonical event history.
Interruption/completion of an attempt leaves a broad purpose active. Fulfilment
is a separate evidenced resolution. Withdrawal preserves its record and prevents
new work; terminal controller observations can still arrive for already admitted
work, including an older revision after an edit. They cannot reactivate current
purpose. Edits advance one version exactly, without touching other purposes.

This reducer validates order/scope/reference/transition consistency. It does
not authenticate its producer, check actual event references, run controllers,
choose behavior or persist data. Attempts/history need bounded hot projections,
durable retention and compatible restart codecs before attachment to a world;
this in-memory candidate is not a long-soak capacity claim.

## Receipts and physical evidence

Receipt phase is received, understood, refused or withdrawn. Received means
the request was durably accepted for interpretation. Understood names the accepted
revision. Neither claims an admitted activity or physical success. If models are
unavailable, existing-card interpretation may work locally; otherwise return a
truthful refusal. A lost response remains uncertain until request lookup resolves.

Outcomes link intent version, attemptId and actual activityId to accepted,
started, blocked, completed or interrupted observations. Admission-only evidence
cannot start/complete an activity or fulfil purpose. Completion requires an
observed start and unchanged activity identity; controller failures identify
the admitted activity. Source tick/sequence cannot point to future evidence.
Runtime must validate references and emit these from actual admission/controller
transitions. Synthetic evidence in the component fixture is not physical proof.

No current universal started signal or purpose-fulfilment evaluator is claimed.
Native ProgramEvent completion is an execution fact; card/kernel application
alone cannot assert that a requested physical object is built or actor arrived.
Supported safe phase exit and borrowed/group activity behavior remain required.

## Checkpoint and qualification

Proposed transport: a separately versioned owner/agent steering operation using
this contract, rather than widening legacy command results silently. Exact URL,
MCP tool and compatibility adapter are reviewed once with App/PM. Root/Toy,
query/perspective and station cue changes are independent named checkpoints.

Before any V2 canonical event is emitted, install the explicit public event-kind
whitelist, protect its private state from cards, define snapshot/replay version
handling and reject unknown epochs. `publicIntentHistoryEventV2` returns only
scope/seq/tick/op/private-update metadata; it omits words, understanding, source,
request IDs and private outcome reasons. Never pass a new private event through
the current generic publicEvent fallback. Full REST/MCP/WS/history/error coverage
and actual owner/agent revocation cases remain required.

Component fixtures cover forged client authority, two retained purposes,
interruption, strict context, JSON replay, edit/version conflicts, terminal
older observations, withdrawal, inconsistent identity/sequence/scope and false
admission-only fulfilment. They do not show the sleeping actor responding to
ordinary campfire language. That actual fake native fixture and measured receipt
→ safe visible transition latency are the next implementation milestone after
precise schema/compatibility checkpoint agreement.
