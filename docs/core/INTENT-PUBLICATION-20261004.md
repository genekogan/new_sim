# Private canonical intent publication

Topic `core/intent-publication`, parent pairing2e29d32 after accepted journal396ae7f.
This implements trusted isolated backend producers, named private log handlers,
exact purpose revision admission and atomic receipt publication. No V2 REST/MCP
endpoint, capability, compiler/choice/preemption activation or live migration.

`IntentPublisher.receive` binds current selected-world Soul/body/mind/ownership
and trusted current authorization, then reserves a semantic request once. The
accepted `intent-request-v2` event, verified private reference and received
receipt commit in one sequencer transaction before applying. Its actual envelope
supplies seq/tick. A reservation interrupted before acceptance stays pending with
no received receipt; duplicate submission never gets another lease/worker/call.

`publish` accepts a trusted interpretation or withdrawal. Payloads omit envelope
origins; the server records a new purpose ID once as accepted data. An understood
revision or withdrawal fact, reference and terminal receipt commit together,
without nesting the older finish transaction. Current authorization/body/mind
and exact edited version are checked immediately under the DB writer lock. A
preview of the pure private fold must succeed before commit. One queued edit wins;
the competing stale edit consumes no sequence or simulation effect. Unrelated
purposes, ordinary movement and a legacy coarse intent-version change do not
invalidate an exact purpose edit.

Withdrawal records status provenance. An older in-flight edit cannot undo a
later withdrawal with the same words version. An explicit new request received
after withdrawal can create the next revision. Other purposes and strict settings
remain, and the canonical log retains all old words/revisions. Attempt start/
completion/fulfilment are separate and are not emitted by this producer.

Private history lives in snapshot `extra.intentHistoriesV2`, outside card-readable
kernel state. WorldHost's named handler folds the immutable canonical payload
without models, through genesis/snapshot/recovery replay. Kernel-only replay
recognizes the new kinds as private control facts with no public kernel/body
effect. Detached history reads cannot mutate truth. This makes no immediate
physical choice or wake/preemption promise; Brain still uses the legacy rules.

Protocol publicEvent names both kinds explicitly before either producer can emit
them. It publishes only world/Soul/origin/operation/private-update metadata,
excluding request ID, owner/principal/source, words and interpretation. Actual
Hub batches apply that whitelist. Public HTTP log/kernel/world/debug-world/take/
takes and a real anonymous WebSocket at4952 were tested with private markers.
Private state stayed out of the card/kernel and recording projections. There is
no new raw owner/debug transport that bypasses this projection.

Migration10 adds a nullable received column; earlier pending and terminal refusal
rows/history remain intact. Received and understood/withdrawn lookup/duplicates
verify actual canonical origins/references/content, rather than trusting a stored
receipt's JSON shape. Forged origins, terminal source or altered receipt fail
closed. Current owner/principal access checks still precede lookup; a trusted
scope is not an authenticated wire principal mapping.

Evidence on Node26.8.2, fake minds/$0:

- Ten new real producer/SQLite tests: queue origins, accumulation, exact edit
  races, withdrawal ordering, stale current authority, persistence rollback,
  forged provenance/terminal source/receipt, migration9→10/restart, public HTTP/
  real WS/takes, filtered physical recovery and worker termination.
- Actual worker termination before and after application of the committed
  understood fact preserves fact/reference/receipt. File reopen/log boot restores
  its private revision; duplicate gets no new lease. This is process termination,
  not power-loss testing, autonomous worker recovery or interpretation rerun.
- A deterministic execution fault filters its faulty decision/play through actual
  WorldHost recovery. Private received/publication facts and receipts survive
  the recipe and both snapshot/log restart readers. This qualifies these private
  facts, not general reconciliation of filtered physical progress references.
- Broadened server selection115/115 covers publication/ledger/candidate/guard/
  pairing/privacy/contracts/replay/regressions/recovery/construction/living/DB/
  world isolation/takes/additive native snapshot. After strengthening lookup's
  canonical verification, final publication+ledger25/25 and tsc/diff pass.
  No skips/TODO. Test-only findLast failed the configured TS target, replaced by
  reverse/find; final typecheck succeeds. No runtime TS target change.

The separate full suite at parent2e29d32 remains120/121 with unresolved Mars DJ
target drift. It is not reclassified as passing or proven pre-existing/caused by
pairing. The unchanged failed story was not blindly rerun. See the pairing record
for its trace and the earlier aborted out-of-range-port invocation. Own runtime
tests now use4950–4952; all owned sockets/processes closed after their proof.

Remaining behavioral checkpoint: wire authentication/opaque credential-generation
principals, compiler fences spanning real async interpretation and exact purpose
changes, bounded capacity/retention, authenticated V2 REST/MCP/private consumers,
unfinished interpretation/crash reconciliation, ordinary native supported action
and latency/outcome proof. A terminal understood receipt proves recorded
interpretation, not successful minting of every card or physical action. Private
lookup in this service is trusted internal data; handlers must authorize their
final response and never serialize a reservation/lease/raw private event publicly.

Rollback must preserve requests, references, receipts, prompts and accepted private
history. A reader before these named handlers cannot reconstruct later private
history from a log; qualify a compatible reader before any live V2 activation.
Do not erase new facts or restore old data to manufacture compatibility. Main,
production tables/caps/services/accounts and paid providers are unchanged.
