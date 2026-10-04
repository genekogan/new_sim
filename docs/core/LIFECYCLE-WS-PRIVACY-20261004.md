# Internal lifecycle WebSocket privacy and public departure

Core follow-up after8b7ccec. Existing G005 current-authority policy; no new
permission, account, auth/skill or UI policy. Production bootstrap still calls
the four-argument Hub constructor and does not install the candidate.

## Reproduction and correction

Actual local HTTP/WebSocket/native/SQLite tests first passed **0/2** on the
existing Hub: a pending logical Soul appeared in welcome.you.souls before its
body existed, and a cached administrator received a synthetic private BrainCall
after a direct local DB role downgrade. PM retains the original red output in
team/reviews/core-ws-findings-C103-8b7ccec.json, outside the code repo.
These are concrete local counterexamples; no live incident, human private
content or every production role-mutation route is claimed. The cached-role
behavior also exists on the default Hub path and remains a default activation
gate, rather than being silently repaired through candidate installation.

The optional fifth Hub argument accepts only the installed candidate Souls on
the same host/DB. Candidate private delivery rereads current DB user/role,
invitation, world/ownership and actual control readiness. Welcome keeps the
existing Me shape but includes only usable Soul IDs. Initial Brain history and
private broadcasts use current usable IDs; world-level calls remain admin-only.
Private stats routing refreshes authority before its role filter and strips spend
from ordinary/anonymous recipients immediately before serialization. Deleting
the current user clears private authority. No lifecycle request IDs or receipts
are added to WS. Authenticated connections remain public viewers after losing
private authority, and can regain a newly admitted Soul without reconnecting.

Public messages retain their existing serialization and canonical inputs.
Logical retirement immediately revokes private access while the native body may
remain publicly visible. Once the actual retirement is applied, Mind/Soul public
mapping disappears; physical body cleanup obeys the existing candidate policy.
Neither takes nor snapshots are rewritten to suggest early physical removal.
The earlier held-crew proof is retained separately and was not rerun here.

## Executed proof

`node --test apps/server/src/lifecycle-ws.test.ts`: **12/12 PASS** after initial
0/2, corrected2/2 and expanded10/10. Real WebSockets on127.0.0.1:4958, actual
Auth dev identities, invited Alice/Bob, SQLite, native candidate and fake Brain.
All12 listeners/DBs and captured Hub timers close; no children or paid spend.

- Pending Me/public body absence; no private pending call; the same socket
  receives its own synthetic call after actual native admission.
- Admin downgrade denies private calls and the actual two-filter stats route
  delivers only public spend-free stats. Owner receives own calls; a different
  owner/anonymous viewer cannot. World calls reach only the current admin.
- Direct local invitation, owner, world and body mismatches deny private calls.
  A row-only owner rewrite grants neither actor authority because canonical
  identity disagrees; this is not an implemented transfer API.
- Deleting the current user denies private calls and removes spend. Authentication
  held locally across an actual DB downgrade cannot deliver stale role/history.
  Initial history remains available to the ordinary current owner.
- Accepted logical retirement denies private delivery and reconnect usable Me
  before physical cleanup, preserving the actual public body in that interval.
- A real two-Soul departure records unmodified native takes0–20 and20–40;
  requested and committed public mappings, removedSouls batch and surviving peer
  match actual native truth. An anonymous socket receives the exact chunks.
  Actual accepted intent/mandate words, raw owner accounts and private operation
  IDs are absent from captured public log/kernel/snapshot/batch/take frames.
- Tick40 synchronous checkpoint restart and explicit inclusive genesis replay
  match native state and kernel hashes without models. This is a short local
  two-Soul departure, not broad occupied-crew/soak/population proof.
- Installer-absent Hub still supports ordinary authentication/public join on
  the local native fixture. Earlier default native10, candidateHTTP34 and MCP12
  proofs are unchanged and were not rerun for this slice.

The first expanded run was **11/12** because the fixture compared live tick40
against boot's last durable tick25. A second11/12 used pending:false, although
successful saveSnapshot returns an absent pending property. Both harness errors
are retained; no replay source repair is claimed. A real tick40 synchronous
checkpoint and tick assertions corrected the comparison; focused1/1 then final
12/12 pass. Server TypeScript and diff checks pass.

## World C095 artifact

Optional capture after committing the exact producer:

```sh
SIM_PUBLIC_LIFECYCLE_FIXTURE=/absolute/review/path.json node --test --test-name-pattern='public departure' apps/server/src/lifecycle-ws.test.ts
```

The JSON records producer commit plus Hub/test SHA256, engine rules/schema/seed,
tick40 state/kernel/restore/replay identities, two public actor IDs, detached
requested/committed snapshots, actual two chunks and anonymous WS frames. It
does not persist DB, private lifecycle receipts, canonical private log, Minds,
account IDs or credentials. The whole-file SHA256 belongs in the shared handoff.
World must inspect/test its own consumer; producer proof is not adoption.

## Remaining gates

No candidate capability/bootstrap/main/release installation. All async private
surfaces/pair approval-poll, every SDK protocol response, atomic last-byte or
already-buffered network revocation, multiprocess/race stress, compatible
old-world transition/rollback, native capacity, real owners, broader public
privacy and full W/G remain unqualified. Delivery checks use current DB state;
JWT/config-to-DB role revocation and token-session refresh are not newly designed
here. High viewer counts/DB-read cost and occupied-crew public take interpretation
need their own evidence. Prior REST/MCP bounded counterparts remain accepted.
