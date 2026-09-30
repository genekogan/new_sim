#!/usr/bin/env bash
# Deploy Sim to eden2. Run from the repo root on the laptop:  infra/deploy.sh
# Builds the web app locally, rsyncs the repo to /srv/sim, installs server
# dependencies on the box as the `sim` user, restarts the unit, checks health.
# Touches nothing under /opt/eden3 and nothing belonging to mars-mcp.
set -euo pipefail
HOST="${SIM_HOST:-root@eden2}"
cd "$(dirname "$0")/.."

BUILD_ID="$(git rev-parse --short HEAD)$(git diff --quiet HEAD || echo -dirty)"
echo "== typecheck + test ($BUILD_ID)"
pnpm typecheck >/dev/null
pnpm -r test >/dev/null
echo "== build web"
BUILD_ID="$BUILD_ID" pnpm --filter @sim/web build >/dev/null
echo "$BUILD_ID" > BUILD

echo "== rsync"
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude data --exclude '.env' --exclude '.env.*' --exclude '*.db' --exclude '*.db-*' \
  ./ "$HOST:/srv/sim/"

echo "== install + restart"
ssh "$HOST" 'set -e
  chown -R sim:sim /srv/sim
  sudo -u sim -H bash -lc "cd /srv/sim && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm install --frozen-lockfile --filter @sim/server... 2>&1 | tail -2"
  install -m 644 /srv/sim/infra/sim.service /etc/systemd/system/sim.service
  systemctl daemon-reload
  systemctl enable sim >/dev/null 2>&1
  systemctl restart sim
  sleep 4
  systemctl is-active sim
  curl -fsS http://127.0.0.1:4500/healthz; echo
  journalctl -u sim -n 6 --no-pager | cut -c1-200'
echo "== done"
