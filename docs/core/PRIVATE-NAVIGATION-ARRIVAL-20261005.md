# Private navigation arrival witness (G-Core160)

This opt-in producer records that a particular admitted navigation action reached
its native endpoint. It is separate from the programme's later resting tail,
controller interruption/completion and the owner's broader purpose. It never
fulfils the intention, backfills an older request from current pose, classifies
arrival from a generic PLAY or marks an already-here instruction as travelled.

Canonical `intent-arrival-v1` uses strict `private-intent-arrival/1` payloads:
world/Soul/current-owner/body, original intention/version/attempt/programme,
canonical decision/admission/controller-start hashes and sequence references,
paired go-to PLAY, completed native navigation ID/verb/end tick, requested goal,
controller endpoint and actual observed position/level/rules at publication.
The trusted base go-to card and its single walk approach must match. A first
executing navigation controller must have been observed for that exact attempt;
its actual native record must be completed. Observation matches its recorded
endpoint within2mm. Native routes can snap requested coordinates to usable grid
points, so requested goal and reached endpoint are deliberately different fields.

`enableIntentArrivalsV1()` writes a prospective rules fact and a hashed native
runtime policy. Ordinary body walk lowering then requests optional native terminal
endpoint output; earlier/default walks keep their original parameters/outputs.
Connected shore already publishes its actual terminal position. No broad existing
history grammar or phase is changed. One private arrival per original attempt.
The public log/anonymous WS receive only a private-update marker, not intention,
owner, attempt, native action, goal or association. No viewer/model is used in replay.

PLAY, arrival and its owner-indexed immutable publication reference commit in one
SQLite transaction. Empty additive migration17 creates the private reference table;
no old-world inference or feature activation. Record verification binds every
canonical source/hash/actor/target/intention and original owner publication.
A journal error rolls back the entire pair and pauses truthful clock progress.
Restart from the last durable frontier reproduces the derived PLAY/arrival using
its existing decision; the fault fixture proves no repeated decision or false fact.
Post-commit fold recovery retains the committed pair rather than filtering it out.

Private routes:

- GET `/v1/souls/:id/intent-v2/arrivals` for current authenticated owner/operator.
- GET `/v1/agent/intent-v2/arrivals` for the current Soul credential generation.
- Internal `IntentControlV2.arrivalsPage(scope, query)` and
  `readIntentArrivalsV1(service, scope, afterSeq, throughSeq)` share the guards.

MCP tool/agent-host consumer is not introduced in this milestone. Genuine owner's
selected control advertises optional `intentArrivalContract` only when enabled.
Both reads revalidate invitation/retirement/owner/body/current mind and agent
credential generation before querying and again before response. They query only
rows indexed for current world/Soul/owner before parsing private canonical facts.
Foreign-owner corrupt rows are excluded; owned corruption gives generic unavailable.
No-store applies. Foreign owner404, anonymous/old agent credential401, malformed
or repeated query400; schema errors do not echo private source/query text.

Query permits only optional decimal `afterSeq`/`throughSeq`; the frontier cannot
exceed the current canonical head, and after cannot exceed frontier. Response has
strict contract/world/Soul/owner, canonical frontier, after/through, complete,
nextAfterSeq and at most50 arrivals. Reuse returned frontier for fixed pagination;
resume from throughSeq for later arrivals. Numeric sequence is not a credential:
every request uses current authority/generation. Each witness remains bound to
its exact canonical original sources. No source-prefix gaps are filled by guessing.

Current fake-$0 evidence: two native owner directions produce two arrival pairs,
later resting-tail interruptions remain separate and intention stays active;
exact native snapshot/genesis arrival projection; owner/agent HTTP and fixed
frontier reads; token rotation, retirement-before-corruption, foreign-owner row
negative; actual anonymous WS/public Hono/kernel/world/takes exclude private
markers/association; journal-trigger failure/restart without new decision; strict
protocol negatives; feature default-off retains old native output/empty journal.
Affected existing history/query/restart/DB checks pass separately.

Earlier prototype failures are retained: initial producer compared requested
rather than snapped controller endpoint; duplicate query ApiError400 was passed
through the old history formatter and became503. Optional terminal output and a
separate arrival error mapper correct these without widening native proximity or
altering the old history error path. Debug instrumentation was synthetic-only and
removed. This is source/backend conformance, not current P0 activation, actual
real-model request observation or an App consumer/release qualification.

Activation/rollback must retain the named private handler/redactor, migration and
native runtime-policy reader. An old binary cannot safely serve these private
facts; PM's release compatibility check must fence it. The current P0 selected
shore/kitchen supplier is not changed by this commit; a separately pinned
installation closure and App privacy/source agreement are still required.
