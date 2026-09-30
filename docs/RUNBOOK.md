# Runbook (eden2)

Sim runs on the eden2 Hetzner box next to the eden3 alpha and mars-mcp, and touches neither.

| Thing | Where |
|---|---|
| Service | `sim.service` (system unit, `User=sim`, uid 1002), listens `127.0.0.1:4500` |
| Staging | `sim-staging.service`, port 4501, fake brain, own data in `/srv/sim-data-staging`; `https://<staging-host>` |
| Code | `/srv/sim/releases/<build>`; `/srv/sim/current` → production release, `/srv/sim/staging` → candidate (rsynced from the laptop; the box has no GitHub credentials) |
| Data | `/srv/sim-data/sim.db` (SQLite, WAL); hourly on-box `backup-*.db` (6 hourly + 7 daily kept) |
| Replication | Litestream → R2 `s3://<bucket>/sim/litestream/sim.db` every 10 s, 7-day retention; creds in `/etc/litestream.env` (root 0600) |
| Watchdog | `sim-watch.timer` every minute: restarts `sim` if the tick is stuck twice; logs if Caddy is down |
| Secrets | `/home/sim/sim.env` (0600): Privy app id/secret, TypeSafe key, Anthropic key, admin emails, budget |
| Caddy | `/etc/caddy/sites/sim.caddy`, pulled in by one `import sites/*.caddy` line at the end of `/etc/caddy/Caddyfile` (backup `Caddyfile.bak-sim-*`) |
| URLs | `https://sim.eden.art` (needs Route53 A record → <eden2-ip>), `https://<eden2-sslip-host>` (works now) |

## Common operations

```bash
infra/deploy.sh                # typecheck+test+build → new release → staging smoke test → production flip
infra/rollback.sh [<build>]    # production back to the previous (or a named) release
ssh root@eden2 'systemctl status sim sim-staging litestream sim-watch.timer --no-pager'
ssh root@eden2 'journalctl -u sim -n 100 --no-pager'
ssh root@eden2 'systemctl restart sim'            # saves a snapshot on SIGTERM first
```

### Restore from R2 (tested 2026-09-30: restored copy was one event behind live)

```bash
ssh root@eden2 'set -a; . /etc/litestream.env; set +a; systemctl stop sim; mv /srv/sim-data/sim.db /srv/sim-data/sim.db.bad;
  litestream restore -o /srv/sim-data/sim.db "s3://$R2_BUCKET/sim/litestream/sim.db?endpoint=$R2_ACCOUNT_ID.eu.r2.cloudflarestorage.com&region=auto";
  chown sim:sim /srv/sim-data/sim.db; systemctl start sim'
```

The R2 key on the box is eden3's media-bucket writer key, used under the `sim/` prefix. A dedicated bucket and key would be tidier.

Admin dials (pause, clock rate, brain live/fake, budget, narrate now, snapshot) are in the web app's
**me** tab for users whose email is in `ADMIN_EMAILS`.

## Caveats

- An eden3 deploy or bootstrap may rewrite `/etc/caddy/Caddyfile` from its repo copy. If `sim.eden.art`
  stops answering after one, re-add the `import sites/*.caddy` line (or rerun `infra/box-setup.sh`).
- After any reboot: `systemctl is-active caddy sim` (Caddy races Docker at boot; see the eden3 RUNBOOK).
- Brain spend is capped by `BRAIN_BUDGET_USD_PER_DAY`; over the cap, Souls fall back to a deterministic policy.
