#!/usr/bin/env bash
# One-time setup on eden2 (run as root ON THE BOX, reviewed first). Idempotent.
# Creates the `sim` user and directories, and wires Caddy through a separate
# site file so the main Caddyfile only gains one `import` line.
set -euo pipefail

id sim >/dev/null 2>&1 || useradd --create-home --shell /bin/bash sim
install -d -o sim -g sim -m 750 /srv/sim /srv/sim-data
[ -f /home/sim/sim.env ] || { install -o sim -g sim -m 600 /dev/null /home/sim/sim.env; echo "created empty /home/sim/sim.env (fill it in)"; }

install -d -m 755 /etc/caddy/sites
install -m 644 /srv/sim/infra/sim.caddy /etc/caddy/sites/sim.caddy
if ! grep -q 'import sites/\*.caddy' /etc/caddy/Caddyfile; then
  cp -p /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak-sim-$(date -u +%Y%m%d-%H%M%S)"
  printf '\n# Additional sites, one file each (added for Sim; safe to keep).\nimport sites/*.caddy\n' >> /etc/caddy/Caddyfile
fi
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl reload caddy
sleep 2
systemctl is-active caddy
