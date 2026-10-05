# Private causal intention history — optional read adapter

Candidate atop `3a9a0871`, accepted C061 dependency. This adds a read adapter to
existing `soul-intent/2` facts. It does not install a new steering mechanism,
change canonical decisions, infer outcomes from poses, or activate production.

## Installation and discovery

Explicitly construct `IntentControlV2(host, brain, souls, {historyV1:true})` on
an already opted-in intention host/brain. The option defaults off; production
bootstrap is unchanged. Migration16 creates an empty private cursor table, not
an authority grant or a history backfill. Existing intention candidates retain
their previous control DTO and tool discovery when this option is absent.

A genuine current owner's web dashboard adds only
`control.intentHistoryContract: "private-intent-history/1"`. Operators viewing
another owner do not receive a genuine-owner UI capability. When opted in,
REST `/v1/agent/perceive` and MCP `soul_perceive` additionally advertise strict
`intentHistory` with contract, selected world/Soul, pageLimit50, scanLimit200
and cursorTtlMs1800000. The MCP tool catalog positively exposes the read-only
`soul_intent_history_v1` tool. Advertisements do not authorize later requests.

## Endpoints and strict DTO

- Current human/authorized existing operator: GET
  `/v1/souls/:id/intent-v2/history?cursor=<opaque continuation>`.
- Current paired owner agent: GET `/v1/agent/intent-v2/history?cursor=...`.
- MCP: `soul_intent_history_v1({cursor?})`.

The only input is an optional opaque `ih1_` cursor. Unknown query keys,
duplicate query values, client-supplied scopes/frontiers and malformed cursors
are rejected without echoing input. This API has no mutation fallback.
All history replies/errors and opted-in agent-perception replies/errors carry
`Cache-Control: no-store`, including when lifecycle installation is absent.
MCP candidate transport retains its existing no-store and final delivery guard.

`packages/protocol/src/intent-history-page-v1.ts` is the exported strict codec.
Both DTO variants contain `contract`, `intentContract`, exact `worldId`,
`soulId`, current `ownerId`, fixed `frontier:{seq,tick}` and `fromSeq`.

A `state:"page"` contains `throughSeq`, ordered strict
`IntentHistoryEventV2[]`, `visibility:"current-owner"`, `complete`, and mutually
exclusive `nextCursor`/`resumeCursor`. Scan coverage is the global canonical
interval `(fromSeq,throughSeq]`; its contents are filtered to this Soul/current
owner's actual published intention facts. At most50 facts and200 canonical
records are examined per page. An empty page may still make progress through
unrelated records. Follow `nextCursor` until `complete:true`; all those pages
retain the original source frontier despite later publications. Only the
completed page's `resumeCursor` captures a new current frontier. Completeness
means coverage through that frontier, not fulfilled purpose or a latest-N
summary. It is not a claim that a UI has persisted a since-last-visit position.

A `state:"gap"` contains `reason:"prefix-missing"|"source-changed"` and
`expectedSeq`; it never carries partial facts or a continuation cursor. Fresh
reads verify adjacency from the retained source prefix. Continuations pin world
schema/seed/dt, previous position and original head bytes; a missing/changed
anchor refuses continuity. This is not a general tamper-proof history chain or
a history-retention/repair service. Malformed owned facts or missing factual
references return generic unavailable, without exposing source diagnostics.

## What is grounded, and what remains unsupported

The reader emits existing upsert/withdraw publications and actual admission /
controller facts. Publications must match their canonical private request-event
references and author. Admissions must associate the exact logged decision,
Soul, actor and attempt. Controller outcomes must match the accepted admission
and durable native observation outbox's canonical/evidence hashes. Existing
`intentHistoryEventV2` supplies revision, attempt/activity, seq/tick and physical
evidence references. No raw journal or generic flattened timeline is returned.

A recorded completed walk remains an **attempt completion**. The broader
purpose can stay active and accumulate other attempts. The protocol's separate
`resolve` variant already exists, but **there is no canonical purpose-resolution
producer/kind in this implementation**. This reader cannot supply resolution,
fulfilled-purpose badges or inferred progress percentages. App must not treat a
missing resolve event as one. Ordinary-language responsiveness was already
implemented separately; this reader only makes its recorded causes inspectable.

## Authority and private cursor bounds

Use existing live invitation, current DB role/ownership, selected world,
retirement/readiness, body/kernel/Mind identity and authenticated expiry checks.
Paired agent reads additionally bind the current credential generation. Authority
is rechecked before decoding cursor/private facts, under the reader transaction,
and before response delivery. Original purpose ownership filters historical
facts; a changed owner record does not grant another person's words. This does
not add an ownership-transfer flow or new operator permission. Other Souls'
payloads are skipped before JSON decoding, even if damaged.

Cursors are random server-side references, never bearer authority. Private rows
bind world/Soul/current owner/principal/source-kind; human/agent cursors cannot
cross, and rotated generations cannot read old cursor rows. Channel is not a
separate authority boundary, so the same current agent can continue via REST or
MCP. Cursor rows contain internal source anchors; no cursor body/raw source hash
is exposed. Existing intent fact source fields retain their opaque audited
principal identities, never the bearer or its hash.

Cursors expire after30minutes. Cleanup bounds64 rows per Soul/current owner
across generations and2048 per world. Reads use the existing scoped limiter
(120/minute). Expired rows return410 `cursor-expired`; unknown, foreign or
already-evicted rows return404 `cursor-unavailable`, without scope disclosure.
Other inaccessible human-history requests use404 `not-found`; missing/revoked
agent credentials are denied before access (MCP401 / agent-history initial401).
Malformed queries return400, rate limits429, unavailable/inconsistent private
source503. A caller starts a fresh page after unavailable continuity, and may
reconcile explicitly; no silent claim of missing intervals.

Cursor bookkeeping runs in a bounded SQLite transaction, does not append a
canonical input event, and survives a DB reopen. Native event replay is unchanged.
The exact snapshot-reopen fixture qualifies cursor/fact continuity at that saved
head; it is not a new quiet-clock, process-crash, power-loss or lifetime proof.

## Actual validation and retained failures

Final combined strict-protocol/native HTTP/SDK/capability/transport regression:
**60 PASS**, actual Node session12383 / terminal chunk577801 / exit0.
Nine history HTTP/native checks include72 distinct actual facts paged at a
frozen frontier, later publication/resume, empty200-record progress, current
scope/generation/expiry, prefix/source gaps, owned integrity failures,
other-Soul malformed payload exclusion, edit/withdraw, final retirement guard,
exact saved native reopen, off-capability behavior and64-row eviction.
Five actual SDK/TCP4958 checks cover positive discovery/perception parity,
REST-equivalent facts, no-store, malformed private arguments, scope/generation
and expiry, invitation/retirement and final response rotation. Two codec checks
reject false completeness, private extras, and scopes chosen by callers.
Existing44 capability/transport/MCP checks retain actual ordinary owner and
agent sleep→walk→arrival/replay proofs with fake/synthetic minds and zero spend.

Initial history HTTP run: two PASS/three FAIL (full revision supplied where a
strict intent reference was required; invalid cursor JSON blocked by the table
CHECK before endpoint execution). Both harnesses were corrected, plus owned
source validation failures separated from invalid user queries. Corrected five
HTTP tests passed. Initial standalone SDK five passed. Expanded first regression:
57PASS/one FAIL because the new withdrawal test expected200 rather than the
actual202 received receipt; the eventual withdrawal fact was already correct.
Final60 passed after correcting that expectation. All actual receipts, including
failures, are retained in the external review execution record.

App's preliminary source review identified the lifecycle-absent agent-perceive
cache gap; the final source qualifies no-store and current authority before
perception. Exact committed App policy review/adoption, mounted factual rows,
new cursor-return UX, full G consumer qualification, real owners/cohort,
latency/large-history soak, defaults and release remain separate. Final server type check session60863 / chunkd21c0d and protocol type check
chunk9eeee0 both exited0. Inherited default
Mars ES2022 failures remain outside this component. No paid provider, deployment,
main merge, server restart or live DB modification occurred.
