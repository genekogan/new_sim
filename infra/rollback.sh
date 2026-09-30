#!/usr/bin/env bash
# Point production at a previous release and restart. Usage: infra/rollback.sh [<build>]
# Without an argument, the release before the current one.
set -euo pipefail
HOST="${SIM_HOST:-root@eden2}"
ssh "$HOST" "set -e; cd /srv/sim/releases; cur=\$(basename \$(readlink /srv/sim/current)); target='${1:-}';
  [ -n \"\$target\" ] || target=\$(ls -1t | grep -v \"^\$cur\$\" | head -1);
  [ -d \"\$target\" ] || { echo \"no such release: \$target\"; ls -1t; exit 1; };
  ln -sfn /srv/sim/releases/\$target /srv/sim/current; systemctl restart sim; sleep 4; systemctl is-active sim; curl -fsS http://127.0.0.1:4500/healthz; echo; echo \"rolled back \$cur → \$target\""
