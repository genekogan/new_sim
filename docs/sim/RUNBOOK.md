# Runbook — Sim on eden2

Reviewed 2026-10-03 against scoped deployment/rollback scripts and merge receipts.
Canonical checkout: `<repo>`. Host: `ssh root@eden2` (<eden2-ip>).
Sim shares this host with eden3 and mars-mcp. Touch only Sim units, data, release
links, its Caddy site and its Litestream entries. Never operate `/opt/eden3`, the
Mars service/user, unrelated services, DNS or Cloudflare from this tranche.

## Processes and paths

| World | Production port/unit | Staging port/unit | Production DB |
|---|---|---|---|
| Toy | 4500 / `sim` | 4501 / `sim-staging` | `/srv/sim-data/sim.db` |
| Mars | 4502 / `sim-world@mars` | 4512 / `sim-world-staging@mars` | `/srv/sim-data/mars/sim.db` |
| Little Martians | 4503 / `sim-world@littlemartians` | 4513 / `sim-world-staging@littlemartians` | `/srv/sim-data/littlemartians/sim.db` |
| Eden | 4504 / `sim-world@eden` | 4514 / `sim-world-staging@eden` | `/srv/sim-data/eden/sim.db` |

All processes run as `sim`, listen on loopback, and use independent files/clocks.
Staging DBs mirror those paths under `/srv/sim-data-staging`; minds are fake.
Caddy routes `/w/<key>/` to the matching process; `main.ts` strips its own
world prefix before HTTP/WS routing. Root Toy API aliases remain
compatible; `/` lists worlds. Three `/l/<key>` Labs and Mars year pages are static
browser surfaces, separate from live-world state.

| Resource | Location/behavior |
|---|---|
| Public/staging | `https://sim.eden.art`, `https://<staging-host>` |
| Release links | `/srv/sim/current`, `/srv/sim/staging`, `/srv/sim/previous` → immutable `/srv/sim/releases/<build>` |
| Ops receipts | `/srv/sim/ops/<build>/`: qualification markers, previous links, Caddy copies, consistent four-world pre-promotion backups |
| Env | `/home/sim/sim.env`, `sim-staging.env`; per-world overrides `/home/sim/worlds/<key>.env`, `staging-<key>.env` |
| Caddy | `/etc/caddy/sites/sim.caddy`, imported by the host Caddyfile |
| Watchdog | `sim-watch.timer` each minute; all four production clocks; restarts an active, unpaused unit after two unchanged checks; reports inactive Caddy |
| DB replication | `litestream.service`, `/etc/litestream.yml`; existing Sim R2 prefix `sim/litestream/sim.db` and `{mars,littlemartians,eden}.db` |
| Replication secrets | `/etc/litestream.env` (root 0600); do not print credential values |
| On-box backups | Per-world `backup-YYYYMMDDHH.db`; six recent hourly and retained UTC daily copies |

Production keeps $0.50 per world per rolling real 24 hours (hard maximum $1).
Per-world envs inherit scoped Sim Privy/model/R2 settings and specify verified
owner, world key/id/path, engine, port and data. No DEV_AUTH on a public host.
No original Mars checkout or MARS_ENGINE_DIR is needed. Root is shared with a second admin;
keep credentials out of logs, diffs and proof artifacts.

## Stage, promote and roll back

Review the diff and run secret scans before staging/committing/pushing. Use a clean
committed canonical checkout, with relevant checks already passing:

```bash
infra/deploy.sh --stage
infra/deploy.sh --promote <qualified-build>
infra/rollback.sh [<compatible-build>]
```

Stage builds the shell/static app, copies decoders, rsyncs the release without
secrets/databases/raw archives, installs scoped world templates, selects staging,
checks all four build IDs and runs the ten-route browser smoke. Promotion requires
the exact selected staging qualification marker, takes consistent backups of all
existing production databases and selects that release for the production units.
Its production health/smoke receipts remain distinct from the stage receipt.

Set `PLAYWRIGHT_BROWSERS_PATH` to an explicit workspace cache; see
[E2E](../../E2E.md). If `pnpm check` already passed for unchanged runtime code,
`SIM_CHECKS_ALREADY_PASSED=1 infra/deploy.sh --stage` reuses that logged proof;
required browser smoke still runs. Documentation-only changes need focused docs/
tooling validation, not another long native gate. Never label a failed check passed.
The script does not run box bootstrap. A failed stage cannot qualify promotion;
inspect the actual links/units and receipts rather than assuming automatic cleanup.

Rollback is code/service-only and invokes `infra/rollback-compatible.py` before
changing production links/services. Choose a reader that understands accepted
mandates, `build_lookout` and `quietSeatCourtesy`. The inactive courtesy reader
`9e78ee416a79` passed after activation; the immediately previous qualified release
is preferable after later docs-only releases. Older sleep-only readers are refused.
Never erase accepted events or restore a DB just to make old code work. A release
without later worlds may stop their units but must retain their databases.
Keep the compatible rollback directory. The current deploy script does not
automatically prune release directories; retention is an operator task, and must
preserve the selected production/staging/previous targets.

Check actual identity/health (public read-only):

```bash
curl -fsS https://sim.eden.art/w/mars/healthz
ssh root@eden2 'systemctl is-active sim sim-staging sim-world@mars sim-world@littlemartians sim-world@eden sim-world-staging@mars sim-world-staging@littlemartians sim-world-staging@eden caddy litestream sim-watch.timer'
ssh root@eden2 'journalctl -u sim-world@mars -n 100 --no-pager'
```

Repeat health after a short interval to verify clock advance; a single response
only proves reachability. Paused units intentionally do not advance. Restart only
an owned Sim unit when warranted. Graceful SIGTERM drains queued accepted inputs
and captures a snapshot if resumable. At an unsnappable controller it preserves
the safe snapshot and logs a passive accepted head marker for exact replay.
Hard crash recovery reaches durable checkpoint/events; recorded take ticks are
not an authoritative replay head. Pairing codes, pending approvals and waits
are in memory and may need retry after restart. Pages reload on build changes.

## Living worlds and policy history

`ENABLE_LIVING_WORLD=1` is active only in the three non-Toy worlds. Days are
72,000 ticks; quiet renewal releases controllers and builds a fresh Runtime.
Customs/day observations inform individually chosen activities. Eden remains idle
without direction. Camp resources renew at quiet first light; construction parts
remain physically installed and are never replenished/dismantled by renewal.

Resumability uses the verb codec in its actual phase: held/raising frames cannot
be treated as resumable merely because lowering has a codec. Unsafe card failure
restores an accepted baseline/suffix recipe, avoids the failed option and records
faults; three faults quarantine a card. Public views expose counts, not recipes.
Qualification rejects every physical recovery, including cleared violations.

Policies are accepted `rules.runtimePolicy` history, not retroactive code defaults.
Existing non-Toy worlds have two policy events (sleep limit, then courtesy) and
one courtesy activation, with saved flags true; Toy has zero. Restart must not
add another activation. `sleepBlockTicks:1200` cancels an interrupted persistent
sleep after a minute of blockage through its normal exit; Lab Resume stays native.
Quiet-seat courtesy drains finished social holds and uses legal native `makeWay`
walks for free bystanders. Active programs and construction crews retain control.

The published workshop/library pair and shared wiring are in the fork. The
activities29→31 checkpoint upgrade is explicitly admitted; exported plans should
be rebound against the registry. Unknown physics versions are not qualified.

## Takes, cost and private steering

`ARCHIVE_TAKES=1` is active on deployed worlds, default off locally. Production
uses existing Sim R2 keys; staging uses `R2_PREFIX=sim/staging`, never production
objects. SQLite holds compressed recent take chunks (camp measured ~13 KB per
simulated second). Five-minute segments compress off-loop and upload under
`<prefix>/takes/<world-id>/`; metadata receipt and SHA-256 read-back must verify
before local pruning. The manifest remains in the DB. R2 failure retains local
history. Restore DB and referenced take objects together to retain old rewind.

Durable paid-cost reservations precede provider calls. Unknown prices refuse
admission; missing/invalid usage or uncertain transport retains the reservation.
Tier buckets pace spending; the rolling ledger remains independent of restart,
budget changes and trace pruning. Admin budget/mode are temporary until restart;
clock rate persists. Local/tests and staging use fake minds.

Private rules: owner `/v1/souls/<id>/mandate` GET/POST and DELETE
`.../mandate/<rule-id>`, paired-agent equivalents and MCP `soul_steer`,
`soul_mandate`, `soul_remove_rule`. Prefix each with the selected `/w/<key>`.
Rule words/alignments, journals and recovery recipes are private accepted state.
Timed/gathering/optional rules request thinking; only explicit NOW executes its
agenda directly. See [API](API.md) and [brain](BRAIN.md) for semantics.

## Replay and recovery

After relevant kernel/fold changes, the scoped read-only kernel verifier compares
log replay with a live hash. For Toy:

```bash
ssh root@eden2 'cd /srv/sim/current/apps/server && sudo -u sim node /srv/sim/current/infra/verify-kernel.ts /srv/sim-data/sim.db http://127.0.0.1:4500'
```

This helper initializes Toy anchors and is Toy-only; substituting another DB
path does not make it a valid Mars-world verifier. Use the world-specific replay/
restart qualification for new worlds. Do not rerun passing proof after prose changes. R2 restore of Toy was tested September 30;
that is historical restore evidence, not a destructive operation to repeat now.
For actual data loss: stop only the affected world and coordinate Litestream,
retain its damaged DB/WAL, restore to a separate file, integrity/replay-check it,
then install with correct `sim` ownership. Select a compatible code reader and
preserve archive objects. Data rollback loses accepted history; obtain Gene's
explicit instruction before intentionally rolling production data back.

After host reboot check all owned units and Caddy; Caddy can race Docker. If another
service's deployment drops the Sim Caddy import, inspect the scoped site/import
and repair only the Sim integration; do not redeploy/bootstrap an unrelated app.
The existing R2 writer is shared and broader than Sim; stay inside the Sim prefix.

## Qualification handoff

[STATUS](../STATUS.md), [qualification](../MERGE-QUALIFICATION-20261003.md) and the
local MERGE-LOG distinguish passed runtime/48-day evidence from the original RED
native gate and focused repairs. The remaining live checkpoint is eligible after
October 4 13:27 UTC and at least 24 living days. Verify clocks, owner counts,
zero recovery/card faults, bounded paid ledger, idempotent policies, recent
checkpoints and archive receipts. Record proof before closing the tranche and
turning off its heartbeat. Do not repeat passing soaks to fill elapsed time.
