# Runbook (production on eden2)

Sim runs on the eden2 Hetzner box (<eden2-ip>, `ssh root@eden2`) next to the
eden3 alpha and mars-mcp, and touches neither. Root on that box is shared with
a second admin, so every secret there is readable by both.

| Thing | Where |
|---|---|
| Production | `sim.service` (`User=sim`), `127.0.0.1:4500`, https://sim.eden.art (also https://<eden2-sslip-host>) |
| Mars | `sim-world@mars`, port 4502, `/srv/sim-data/mars/sim.db`; staging `sim-world-staging@mars`, port 4512, separate staging file |
| Staging | `sim-staging.service`, `127.0.0.1:4501`, fake brain, own data in `/srv/sim-data-staging`, https://<staging-host> |
| Code | `/srv/sim/releases/<build>`; `/srv/sim/current` → production, `/srv/sim/staging` → candidate, `/srv/sim/previous` → what production ran before the last deploy. Rsynced from a laptop; the box has no GitHub credentials. The 5 newest releases are kept |
| Data | `/srv/sim-data/sim.db` (SQLite, WAL) + hourly `backup-YYYYMMDDHH.db` (6 hourly + 7 daily) |
| Replication | `litestream.service` → R2 `s3://<bucket>/sim/litestream/sim.db`, 10 s sync, 7-day retention; config `/etc/litestream.yml`, credentials `/etc/litestream.env` (root 0600) |
| Watchdog | `sim-watch.timer`, every minute: restarts `sim` if the tick has not advanced on two consecutive checks (unless paused); logs if Caddy is down |
| Env file | `/home/sim/sim.env` (0600). Must set `PORT=4500`, `HOST=127.0.0.1`, `DATA_DIR=/srv/sim-data` (the only writable path for the unit) and `PUBLIC_URL`; plus `ADMIN_EMAILS`, `BRAIN_MODE`, `BRAIN_BUDGET_USD_PER_DAY`, optionally `COMPILER_MODEL` and `TALK_MODEL`, the Privy app id/secret, TypeSafe and Anthropic keys. It also holds the `R2_*` credentials used for verified take archives (only under the existing Sim prefix). Staging: `/home/sim/sim-staging.env` |
| Caddy | `/etc/caddy/sites/sim.caddy`, pulled in by one `import sites/*.caddy` line at the end of `/etc/caddy/Caddyfile` |
| DNS | `sim.eden.art` A record in Route53 (Gene edits DNS) |

## Living-camp activation boundary

`ENABLE_LIVING_WORLD` is a Mars-only activation flag; see MERGE-LOG for the
current deployed setting. The playback release understands camp
checkpoints before activation, so it is the compatible code rollback for the subsequent
living-camp milestone. Enable only in Mars's per-world env after the 48-day proof and
stage qualification; never in the shared toy env. The day is 72,000 engine ticks, with
quiet resumable checkpoints, fresh Runtime at first light, private journals and no
activity timetable. Recovery receipts hold a private checkpoint/suffix recipe, exposed
publicly only as card fault counts; three faults quarantine a card.

Take archival requires `ARCHIVE_TAKES=1` in the per-world env; local development
is off by default. Staging must use `R2_PREFIX=sim/staging` with its own data,
never production's take keys. Take chunks keep a rolling 24-hour buffer in compressed SQLite storage (measured
camp ~13 KB/s). Completed five-minute segments are compressed in a worker and
archived under `${R2_PREFIX}/takes/<world-id>/<segment>.json.gz`; manifests stay in
the world database. Upload, metadata receipt and SHA-256 read-back must all pass
before old local chunks are removed. An R2 outage retains local history; recent
rewind needs no R2 request. Older pages verify the manifest checksum before decoding.
The actual R2 proof uploaded/read back 299 camp chunks: 3.84 MB local gzip to
2.78 MB archive. Preserve the take objects alongside the SQLite backup when restoring.
Code rollback to the playback release remains state-compatible, with local rewind
only; re-promoting the archive reader restores older rewind without a data restore. The model ledger is independent of trace pruning and budget changes. Unknown
model prices refuse admission; uncertain transport failures retain the reservation.

## Owner mandate controls

In a living world, POST `/v1/souls/<id>/mandate` with `{words, strict, id?}` adds
or edits one private rule. GET lists it; DELETE `/v1/souls/<id>/mandate/<rule-id>`
removes it. Ownership is enforced. Paired agents use the corresponding
`/v1/agent/mandate` routes or MCP `soul_steer`, `soul_mandate`, `soul_remove_rule`.
The same endpoints work under the world's API prefix. Existing command and
structured-intent APIs become mandate changes in living worlds; toy keeps its old
command/intent behavior. Rule count is bounded at 24 per Soul. Alignment failure
leaves the rule unchanged. NOW has precedence; a ten-minute unplayable next card
reports blocked, and a newer NOW reports its predecessor replaced. Other triggers
only request thinking. Strict reports are bounded to one per world day.

Owner words and rule internals live in accepted private events/checkpoints, never
public kernel/log views. Preserve the database for rollback. The previous camp
release cannot redact/fold new mandate events. The rollback compatibility guard
refuses any older reader once mandate events exist; choose a mandate-capable
release. Before any such events exist, the preceding camp release remains valid.
Never restore data to erase steering. Successful model replies without a valid usage receipt retain the paid
reservation; investigate the receipt rather than forgiving cost automatically.

## Operations

```bash
infra/deploy.sh --stage         # checks/build → staging + browser proof
infra/deploy.sh --promote BUILD # promote that exact qualified staging release
infra/rollback.sh [<build>]    # production back to /srv/sim/previous (or a named release); running it twice swaps back
ssh root@eden2 'systemctl status sim sim-staging litestream sim-watch.timer --no-pager'
ssh root@eden2 'journalctl -u sim -n 100 --no-pager'
ssh root@eden2 'systemctl restart sim'     # SIGTERM saves a snapshot first; clients reconnect on their own
ssh root@eden2 'bash /srv/sim/current/infra/box-setup.sh'   # idempotent: units, Caddy site, watchdog, Litestream
```

Deploy never flips production if staging fails to start on the new release or
reports a different build id; the rejected release is removed and staging is
pointed back at production's release. Deploy requires a clean committed release. A restart reloads from the latest snapshot and
fast-forwards through later events; open pages reload themselves when the build
id changes.

Admin dials (pause, clock rate, brain live/fake, budget, narrate now, snapshot,
invite codes, connected clients) are in the web app's **admin** tab; cost is in
the **spend** tab. Both need an email listed in `ADMIN_EMAILS`.

## Check that the log still explains the world

`infra/verify-kernel.ts` replays the kernel from the event log (no engine stepping,
no models, read-only) and compares the result with the live server's kernel hash:

```bash
ssh root@eden2 'cd /srv/sim/current/apps/server && sudo -u sim node /srv/sim/current/infra/verify-kernel.ts /srv/sim-data/sim.db http://127.0.0.1:4500'
```

It prints the event counts and `MATCH`, or the things and links that differ. First
run, 2026-10-01: 11,939 events replayed in 35 ms and matched. Run it after any
deploy that touches `packages/kernel` or `apps/server/src/fold.ts`.

## Restore from R2

Tested 2026-09-30: the restored copy was one event behind live, integrity ok.

```bash
ssh root@eden2 'set -a; . /etc/litestream.env; set +a
  systemctl stop sim litestream
  mkdir -p /srv/sim-data/bad && mv /srv/sim-data/sim.db* /srv/sim-data/bad/
  litestream restore -o /srv/sim-data/sim.db "s3://$R2_BUCKET/sim/litestream/sim.db?endpoint=$R2_ACCOUNT_ID.eu.r2.cloudflarestorage.com&region=auto"
  chown sim:sim /srv/sim-data/sim.db; systemctl start sim litestream'
```

For a smaller loss of state, an on-box `backup-*.db` can be copied over `sim.db`
the same way.

## Caveats

- The R2 key is eden3's media-bucket writer key, used under the `sim/` prefix. It
  can write anywhere in that bucket; a dedicated bucket and key would be safer.
- An eden3 deploy or bootstrap may rewrite `/etc/caddy/Caddyfile` from its repo
  copy and drop the `import` line. If the Sim sites stop answering after one,
  rerun `box-setup.sh`.
- After any reboot: `systemctl is-active caddy sim sim-staging litestream`
  (Caddy races Docker at boot on this box; see the eden3 runbook).
- Model spend is capped by `BRAIN_BUDGET_USD_PER_DAY` (0.5 in production). When a
  tier's share is spent, a busy Soul waits, an idle Soul takes a free built-in
  choice, the narrator and director skip, and typed commands ask to retry.
- The budget and the brain mode set in the admin tab last until the next restart
  (the env file is the default). Clock rate persists.
- Pairing codes, pending approvals and agents' `wait` calls live in memory: a
  restart or deploy cancels them, and agents mid-pairing must start again.
- Privy's free tier ends at 499 monthly users.
# Eden4 successor milestone — 2026-10-03

Canonical checkout is `<repo>`; `<old-sim-repo>` stays in place.
Mars engine is required in-repo at `mars/viewer/engine`. No production
dependency on Gene's original Mars checkout or MARS_ENGINE_DIR.

Release flow: `infra/deploy.sh --stage`, review its browser proof, then
`infra/deploy.sh --promote <build>`. Each release is committed first; the
stage receipt pins the same build. If `pnpm check` just passed for this code,
the lead may set `SIM_CHECKS_ALREADY_PASSED=1` with its logged proof to avoid
rerunning three minutes of unchanged engine tests. Smoke always runs on stage.
Browser cache must be explicit (see E2E.md). Deployment does not run box-setup.

| World | Production | Staging | Data | Unit |
|---|---|---|---|---|
| Toy | 4500 | 4501 | `/srv/sim-data/sim.db` | existing `sim` / `sim-staging` |
| Mars | 4502 | 4512 | `/srv/sim-data/mars/sim.db` | `sim-world@mars` / `sim-world-staging@mars` |

Toy's existing units remain selected to preserve its data/service identity;
new worlds use the template. Per-world env overrides live in
`/home/sim/worlds/` and contain the verified owner ID, port and data directory.
No DEV_AUTH on a public host. All stage minds are fake. World API and WS
prefixes are `/w/<id>/`; original root toy API aliases remain compatible.

`/l/mars` and `/w/mars/2020`…`2027` are the original static app. Large
campus derivatives are streamed through a restricted same-origin proxy to
the existing public Worker; no Worker/DNS edits. Never run the original
Mars prepare script against archive symlinks. Current takes/baselines are
vendored, and historical release packaging needs its separate fixture cache.

Ops receipts/consistent pre-release toy backup: `/srv/sim/ops/<build>/`.
Rollback: preserve new-world data, flip `/srv/sim/current` to the previous
release, restart toy and any world supported by that release; if reverting
to pre-merge Sim, stop Mars and restore `caddy.before-promote` from the
receipt before validating/reloading Caddy. Do not restore the toy DB unless
Gene explicitly authorizes a destructive data rollback. `infra/rollback.sh`
handles code/service rollback only. Keep at least the rollback release.

Snapshots now defer non-resumable activities instead of dropping them.
Compaction from WorldState is separately proven only when every controller
has released. `eat` and `hold_items` in this alpha are resumable. Server
TakeRecorder chunks render with TakePeople; no browser Runtime on live pages.

---
