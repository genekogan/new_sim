#!/usr/bin/env bash
# Code/service rollback only. Never restore or reset a production database.
set -euo pipefail
. "$(dirname "$0")/../tools/world-launcher/deploy/deploy-env.sh"
HOST="${SIM_HOST:-$(deploy_target)}"
TARGET="${1:-}"
[ -z "$TARGET" ] || [[ "$TARGET" =~ ^[a-f0-9]{7,40}$ ]] || { echo 'invalid build'; exit 1; }
ssh "$HOST" "set -e; cur=\$(readlink /srv/sim/current); target='$TARGET';
  if [ -n \"\$target\" ]; then target=/srv/sim/releases/\$target; else target=\$(readlink /srv/sim/previous); fi;
  test -d \"\$target\"; python3 \"\$cur/infra/rollback-compatible.py\" \"\$target\"; ln -sfn \"\$cur\" /srv/sim/previous; ln -sfn \"\$target\" /srv/sim/current;
  systemctl restart sim;
  if [ -d \"\$target/mars/viewer/engine\" ]; then
    systemctl restart sim-world@mars;
    for key in littlemartians eden; do
      if [ -f \"\$target/worlds/\$key/world.json\" ]; then systemctl restart sim-world@\$key; else systemctl stop sim-world@\$key || true; fi;
    done;
    cp \"\$target/infra/sim.caddy\" /etc/caddy/sites/sim.caddy;
  else
    systemctl stop sim-world@mars || true;
    receipt=/srv/sim/ops/\$(basename \"\$cur\")/caddy.before-promote;
    test -f \"\$receipt\"; cp \"\$receipt\" /etc/caddy/sites/sim.caddy;
  fi;
  caddy validate --config /etc/caddy/Caddyfile >/dev/null; systemctl reload caddy;
  systemctl is-active sim caddy; curl -fsS http://127.0.0.1:4500/healthz"
