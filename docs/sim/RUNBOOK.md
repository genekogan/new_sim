# Runbook (production on eden2)

Sim runs on the eden2 Hetzner box (<eden2-ip>, `ssh root@eden2`) next to the
eden3 alpha and mars-mcp, and touches neither. Root on that box is shared with
a second admin, so every secret there is readable by both.

| Thing | Where |
|---|---|
| Production | `sim.service` (`User=sim`), `127.0.0.1:4500`, https://sim.eden.art (also https://<eden2-sslip-host>) |
| Staging | `sim-staging.service`, `127.0.0.1:4501`, fake brain, own data in `/srv/sim-data-staging`, https://<staging-host> |
| Code | `/srv/sim/releases/<build>`; `/srv/sim/current` → production, `/srv/sim/staging` → candidate, `/srv/sim/previous` → what production ran before the last deploy. Rsynced from a laptop; the box has no GitHub credentials. The 5 newest releases are kept |
| Data | `/srv/sim-data/sim.db` (SQLite, WAL) + hourly `backup-YYYYMMDDHH.db` (6 hourly + 7 daily) |
| Replication | `litestream.service` → R2 `s3://<bucket>/sim/litestream/sim.db`, 10 s sync, 7-day retention; config `/etc/litestream.yml`, credentials `/etc/litestream.env` (root 0600) |
| Watchdog | `sim-watch.timer`, every minute: restarts `sim` if the tick has not advanced on two consecutive checks (unless paused); logs if Caddy is down |
| Env file | `/home/sim/sim.env` (0600). Must set `PORT=4500`, `HOST=127.0.0.1`, `DATA_DIR=/srv/sim-data` (the only writable path for the unit) and `PUBLIC_URL`; plus `ADMIN_EMAILS`, `BRAIN_MODE`, `BRAIN_BUDGET_USD_PER_DAY`, optionally `COMPILER_MODEL` and `TALK_MODEL`, the Privy app id/secret, TypeSafe and Anthropic keys. It also holds `R2_*` variables that no server code reads yet (reserved for the asset store). Staging: `/home/sim/sim-staging.env` |
| Caddy | `/etc/caddy/sites/sim.caddy`, pulled in by one `import sites/*.caddy` line at the end of `/etc/caddy/Caddyfile` |
| DNS | `sim.eden.art` A record in Route53 (Gene edits DNS) |

## Operations

```bash
infra/deploy.sh                # type check + tests + web build → new release → staging smoke test → production flip
infra/rollback.sh [<build>]    # production back to /srv/sim/previous (or a named release); running it twice swaps back
ssh root@eden2 'systemctl status sim sim-staging litestream sim-watch.timer --no-pager'
ssh root@eden2 'journalctl -u sim -n 100 --no-pager'
ssh root@eden2 'systemctl restart sim'     # SIGTERM saves a snapshot first; clients reconnect on their own
ssh root@eden2 'bash /srv/sim/current/infra/box-setup.sh'   # idempotent: units, Caddy site, watchdog, Litestream
```

Deploy never flips production if staging fails to start on the new release or
reports a different build id; the rejected release is removed and staging is
pointed back at production's release. Deploy ships the **working tree**:
uncommitted changes are included and the build id gets a `-dirty` suffix. A restart reloads from the latest snapshot and
fast-forwards through later events; open pages reload themselves when the build
id changes.

Admin dials (pause, clock rate, brain live/fake, budget, narrate now, snapshot,
invite codes, connected clients) are in the web app's **admin** tab; cost is in
the **spend** tab. Both need an email listed in `ADMIN_EMAILS`.

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
