# G2 registry and historical attachment — 2026-10-15

**Code answer: there is no single account registry covering every old `/w/*`
world and every `/worlds` world.** Clerk issuer/subject identity is shared in
concept, but the local `acct_*` allocation is scoped to a registry file. Matching
email, subject or display name must not merge those independently allocated IDs.

| World family | Code evidence at baseline `1080cfa9` | Registry |
| --- | --- | --- |
| New world-engine worlds under `/worlds` | `tools/world-launcher/launcher.mjs:435` builds `child.registryPath`; `children.mjs:200` passes it to every new-world child | `<launcher dataDir>/accounts.sqlite` |
| Old-world copies under `/worlds/w/{eden,mars,littlemartians}` | `children.mjs:233` passes `world.fork.accounts`; `launcher.mjs:229–231` defaults a separate fork registry and **rejects** the launcher's registry as the fork registry | `<launcher dataDir>/forks/accounts.sqlite` by default, or explicit registered path |
| Original `/w/*` writers | Old-world launcher runner verifies exact descriptor/account registry agreement; deployment/rollback tooling names the original shared account registry | Laptop `team/runtime/production-accounts/accounts.sqlite`; planned moved-world service `/srv/sim-old-data/accounts/accounts.sqlite` |

`apps/server/src/account-registry.ts:13–17` binds only exact `(issuer, subject)`
inside the selected SQLite file, allocating a random account ID on first use.
`auth.ts:53–55,163–174` requires an absolute configured path and uses that local
binding after signature/issuer/authorized-party checks. Neither proves cross-file
equality. Membership, history and agent grants remain world scoped
(`accounts/store.ts:71–99`). The convergence release receipt proves the deployed
source/Clerk activation, not live file identity or identical `acct_*` allocations.
This verification read code and existing release records only; no live account,
production database, process environment or credential was inspected.

## Bounded inventory

[`gene-historical-inventory.json`](./gene-historical-inventory.json) preserves all
30 IDs in the existing October 10 closed-birth reconciliation, including the21
retired rows. The source JSON SHA-256 is
`64f16bed3f3c8df750d54e1d082ce3594269a4220f5a77e786ab7aa44083f723`.
Its source is `team/pm-integration/auth-account-20261009/closed-birth-metadata-001/ALL-HISTORY-INVENTORY.json`
(recorded `2026-10-10T00:12:54Z`, Eden `pm-preview-eden-20261005`, head32906).
No production DB was reopened or copied. This is a historical ledger, not a
current roster or an exhaustive Mars/Little Martians reconciliation.

| Evidence class | Count | Disposition |
| --- | ---: | --- |
| Direct Gene creator evidence | 1 | Drake Mallard `s_0529a51d18`; accepted birth/entity/current owner hash retained; target provider identity and current target DB lineage still require verification |
| Current human attribution pending | 5 | Lumen Quill `s_0c7293376e`; His Duckness `s_16afd695d1`; Gene `s_186084ff81`; Roger `s_658a0d9a6d`; Tamsin Quill `s_cea6ba848e` |
| Current Root evaluation cohort | 3 | ReleaseProbe650 Scripted `s_89b6f764e2`, Aster Wayfarer19 `s_d481371d4f`, Sage Continuity19 `s_63c754d55a`; no personal ownership inference |
| Retired operator fixtures | 9 | Eden, Alice, Bob, Carol, David, Oda, Pim, Rowan, Eden Lecture Guest; preserve retirement/history, not automatic Gene attachment |
| Retired Root MVP candidates | 12 | Moss, Sage, Cael, Morrow Finch, Moss the Tinker, Moss-of-the-Quiet-Road, Thistlewick, Thorne, Ilex, Thorn, Juniper Quill, Ione Vale; several references were encounters, so attribution remains qualified |

The earlier refined inventory also excludes six private-clone cohort IDs (Alder,
Rowan Compass, Rowan/Beryl/Nola Precise and Linden Dashboard). Matching the Eden
world ID alone is unsafe: those private clones reused it. All30 historical
entries remain unactivated; **approved attachment entries:0**. Names, residence
on Gene's laptop and operator/test creation are not sufficient personal ownership
proof. The five-human batch above is the specific unanswered human attribution
batch; the Root evaluation candidates also require an explicit disposition.

## Operator attachment tool

`tools/accounts/attach-historical.mjs` is an operator-only script, with no new
HTTP route. The supplied [`attach-manifest.example.json`](./attach-manifest.example.json)
is intentionally non-executable. The release owner must prepare one reviewed
manifest **per registry/account binding**, pinning its real registry path, exact
Clerk issuer/subject/account ID and authorized origin. Every world entry pins its
real target DB path, world/Soul/entity IDs, accepted birth sequence/hash, current
recorded-owner SHA-256, retirement status and attribution evidence hash. Example
entry shape (all values must come from reviewed evidence):

```json
{"approved":true,"soulId":"s_0123456789","entityId":"h_0123456789","birthSeq":1,"birthHash":"<64 hex>","recordedOwnerSHA256":"<64 hex>","retired":false,"evidenceSHA256":"<64 hex>"}
```

From the selected release checkout, the release owner can run:

```sh
node tools/accounts/attach-historical.mjs --manifest /absolute/reviewed-manifest.json --registry /absolute/accounts.sqlite --token-file /absolute/private-clerk-session.jwt --clerk-key-file /absolute/private-clerk-backend.key
```

The default is a read-only preflight and plan. Add `--apply` only to the same
reviewed command when ready to attach. Credential files are read by path at
runtime, must have no group/other access, and are never logged. Do not put token
values in arguments, reports or the manifest. The runtime verifies a fresh RS256
Clerk session, exact issuer/subject/authorized party, active Backend session, and
a fresh provider record containing the verified requested email. The email
checks the pinned target; it never looks up or merges account IDs. The production
API shape follows the [Clerk Backend API reference](https://clerk.com/docs/reference/backend-api).

Apply preflights all worlds read-only, then rechecks within `BEGIN IMMEDIATE`
per world. It inserts exact memberships, the corresponding identity if absent,
and `account_historical_attachments_v1` audit rows with manifest/evidence hashes.
Existing membership conflicts fail closed. It never rewrites `souls.owner`,
accepted events, bodies, retirement, legacy-authority revocations or delegated
credentials. Existing legacy authority must already be captured and unrevoked
for an active agent-local owner; the script refuses to repair/revive it. Thus an
owner association remains distinct from historical birth attribution. No resident
is resurrected. Cross-world transactions are not atomic; retry is idempotent if a
later world fails. Back up the selected target databases through the release
owner's normal procedure before apply; no migration was run in this lane.

The earlier `WorldAccounts.associateAttributed` seam currently obtains fresh
email proof only through Privy. This tool uses Clerk verification directly and
does not weaken that seam or add a generic email/name assignment route.

Validation: `SAFETY_SCRATCH=<team>/scratch/safety/inventory node --test tools/accounts/attach-historical.test.mjs` passes5 tests.
Fixtures prove byte-preserving default dry-run, idempotent audited apply,
unchanged historical/token/grant/legacy rows, retired-history preservation, and
rejection of forged identities, wrong provider subject/email, unverified email,
revoked sessions, wrong registry binding, native residents, changed births,
changed current owners, conflicting memberships and revoked legacy authority.
Provider calls are synthetic fixtures; no real Clerk sign-in or live migration
is claimed.
