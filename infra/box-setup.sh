#!/usr/bin/env bash
# One-time / idempotent box setup for eden2, run as root ON THE BOX after a deploy
# has placed a release under /srv/sim/releases. Installs units, Caddy site, the
# watchdog timer and Litestream. Never touches /opt/eden3 or mars-mcp.
set -euo pipefail
REL="${1:-/srv/sim/current}"

id sim >/dev/null 2>&1 || useradd --create-home --shell /bin/bash sim
install -d -o sim -g sim -m 750 /srv/sim /srv/sim/releases /srv/sim-data /srv/sim-data-staging
[ -f /home/sim/sim.env ] || { install -o sim -g sim -m 600 /dev/null /home/sim/sim.env; echo "created empty /home/sim/sim.env (fill it in)"; }
[ -f /home/sim/sim-staging.env ] || {
  install -o sim -g sim -m 600 /dev/null /home/sim/sim-staging.env
  printf 'PORT=4501\nHOST=127.0.0.1\nDATA_DIR=/srv/sim-data-staging\nPUBLIC_URL=https://<staging-host>\nBRAIN_MODE=fake\nINVITE_REQUIRED=1\n' >> /home/sim/sim-staging.env
  grep -E '^(PRIVY_APP_ID|PRIVY_APP_SECRET|ADMIN_EMAILS)=' /home/sim/sim.env >> /home/sim/sim-staging.env || true
}

install -m 644 "$REL/infra/sim.service" /etc/systemd/system/sim.service
install -m 644 "$REL/infra/sim-staging.service" /etc/systemd/system/sim-staging.service
install -m 644 "$REL/infra/sim-watch.service" /etc/systemd/system/sim-watch.service
install -m 644 "$REL/infra/sim-watch.timer" /etc/systemd/system/sim-watch.timer
systemctl daemon-reload
systemctl enable sim sim-staging sim-watch.timer >/dev/null 2>&1
systemctl start sim-watch.timer

# Caddy: separate site file + one import line
install -d -m 755 /etc/caddy/sites
install -m 644 "$REL/infra/sim.caddy" /etc/caddy/sites/sim.caddy
if ! grep -q 'import sites/\*.caddy' /etc/caddy/Caddyfile; then
  cp -p /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak-sim-$(date -u +%Y%m%d-%H%M%S)"
  printf '\n# Additional sites, one file each (added for Sim; safe to keep).\nimport sites/*.caddy\n' >> /etc/caddy/Caddyfile
fi
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null && systemctl reload caddy

# Litestream (continuous replication to R2), if credentials are present
if [ -f /etc/litestream.env ]; then
  if ! command -v litestream >/dev/null; then
    tmp=$(mktemp -d); curl -fsSL -o "$tmp/ls.deb" https://github.com/benbjohnson/litestream/releases/download/v0.5.17/litestream-0.5.17-linux-x86_64.deb
    dpkg -i "$tmp/ls.deb" >/dev/null; rm -rf "$tmp"
  fi
  install -m 644 "$REL/infra/litestream.yml" /etc/litestream.yml
  install -d /etc/systemd/system/litestream.service.d
  printf '[Service]\nEnvironmentFile=/etc/litestream.env\n' > /etc/systemd/system/litestream.service.d/10-env.conf
  systemctl daemon-reload; systemctl enable litestream >/dev/null 2>&1; systemctl restart litestream
  sleep 3; systemctl is-active litestream
fi
systemctl is-active caddy sim sim-staging sim-watch.timer
