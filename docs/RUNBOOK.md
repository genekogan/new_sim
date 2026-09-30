# Runbook (eden2)

Sim runs on the eden2 Hetzner box next to the eden3 alpha and mars-mcp, and touches neither.

| Thing | Where |
|---|---|
| Service | `sim.service` (system unit, `User=sim`, uid 1002), listens `127.0.0.1:4500` |
| Code | `/srv/sim` (rsynced from the laptop; the box has no GitHub credentials) |
| Data | `/srv/sim-data/sim.db` (SQLite, WAL) + hourly `backup-YYYYMMDDHH.db` |
| Secrets | `/home/sim/sim.env` (0600): Privy app id/secret, TypeSafe key, Anthropic key, admin emails, budget |
| Caddy | `/etc/caddy/sites/sim.caddy`, pulled in by one `import sites/*.caddy` line at the end of `/etc/caddy/Caddyfile` (backup `Caddyfile.bak-sim-*`) |
| URLs | `https://sim.eden.art` (needs Route53 A record → <eden2-ip>), `https://<eden2-sslip-host>` (works now) |

## Common operations

```bash
infra/deploy.sh                                   # test, build, rsync, install, restart, health
ssh root@eden2 'systemctl status sim --no-pager'  # status
ssh root@eden2 'journalctl -u sim -n 100 --no-pager'
ssh root@eden2 'systemctl restart sim'            # saves a snapshot on SIGTERM first
```

Admin dials (pause, clock rate, brain live/fake, budget, narrate now, snapshot) are in the web app's
**me** tab for users whose email is in `ADMIN_EMAILS`.

## Caveats

- An eden3 deploy or bootstrap may rewrite `/etc/caddy/Caddyfile` from its repo copy. If `sim.eden.art`
  stops answering after one, re-add the `import sites/*.caddy` line (or rerun `infra/box-setup.sh`).
- After any reboot: `systemctl is-active caddy sim` (Caddy races Docker at boot; see the eden3 RUNBOOK).
- Backups stay on the box. Copy `/srv/sim-data/backup-*.db` off-box if the data starts to matter.
- Brain spend is capped by `BRAIN_BUDGET_USD_PER_DAY`; over the cap, Souls fall back to a deterministic policy.
