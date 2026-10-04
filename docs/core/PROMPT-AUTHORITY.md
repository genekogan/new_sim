# Prompt debug authorization correction

First commissioned Core beta milestone, October 3, 2026 Eastern.
Local fake evidence only; no production prompt was fetched.

The shipped `/v1/prompt/:hash` route checked sign-in and hash existence. A local
real-Hono/Auth/SQLite fixture reproduced five failing negative scenarios: knowing
a stored hash returned its text without originating-call ownership/world checks.
One existing authentication scenario already passed. This is a local reproduction,
not a claim that a production account accessed someone else's prompt.

The corrected route requires a retained call whose actual interned system slot
`request.system[0].text.$prompt` references the hash in the selected world.
Owners require a current, active Soul in that world associated with that call.
Admins may inspect associated calls in the selected world, including global
calls. A response or user-content lookalike is not an association. No prompt
access follows merely from a stored text, a hash, or an old owning relationship.

| Caller/reference | Result |
|---|---|
| Signed-in owner, retained own active-Soul call in selected world | 200 text |
| Identical deduplicated text also used by another Soul | 200 through the caller's own authorized call |
| Admin, retained selected-world call including global/retired-Soul call | 200 text |
| Anonymous or a Soul bearer token on this owner debug route | 401 |
| Other owner, foreign world, mismatched Soul/world, orphan, pruned call, missing hash | Same 404 body |
| Changed owner, retired Soul or removed admin role | Authority reevaluated each request |

All route responses use `Cache-Control: no-store`. No new agent prompt endpoint
or administrator role is introduced. App accepted this policy in the G-010
answer in `<team>/INBOX-game.md`; its code/consumer review remains separate.

Migration 7 creates an expression index over existing originating references;
it does not rewrite/delete historical calls or prompt text, or touch canonical
events/snapshots/physical rules. Genuine retained old references work immediately.
Malformed legacy debug JSON contributes no reference. The index bounds lookup
by world/hash; pruning a call removes its access association naturally. Prompt
storage may outlive debug retention, but its existence is not entitlement.

Evidence: `prompt-authority.test.ts` exercises the actual route, current Auth
and real SQLite, including shared/global/foreign scopes, role/ownership changes,
revocation, reference lookalikes, no-store, retained six-migration upgrade,
restart, idempotent migration and malformed debug history. Before-correction
receipt is retained locally at `data/core-preflight/prompt-before.log`.
The initial qualification ran 22 tests across prompt, DB lock, mandate and replay
suites, all passing with no skips/TODO; the final prompt suite/typecheck receipt
accompanies the merge request.

This is a corrective G-001 behavior change with agreed App policy, not a renamed
additive guarantee. It does not establish full REST/MCP/WS/archive privacy, new
scoped observation, a real second-owner login journey or W/G conformance. PM
merges/releases after handover and runs owner/other-owner/anonymous checks against
the exact staging candidate. Older code may understand the extra index but lacks
this access correction; treat that distinction explicitly in rollback review.
