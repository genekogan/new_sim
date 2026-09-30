#!/usr/bin/env bash
# Point production at the release it ran before the last deploy (/srv/sim/previous),
# or at a named build, and restart. Usage: infra/rollback.sh [<build>]
set -euo pipefail
HOST="${SIM_HOST:-root@eden2}"
ssh "$HOST" "set -e; cur=\$(readlink /srv/sim/current); target='${1:-}';
  if [ -n \"\$target\" ]; then target=/srv/sim/releases/\$target; else target=\$(readlink /srv/sim/previous 2>/dev/null || true); fi;
  [ -n \"\$target\" ] && [ -d \"\$target\" ] || { echo \"no rollback target (releases: \$(ls -1t /srv/sim/releases | tr '\\n' ' '))\"; exit 1; };
  ln -sfn \$cur /srv/sim/previous; ln -sfn \$target /srv/sim/current; systemctl restart sim; sleep 4; systemctl is-active sim; curl -fsS http://127.0.0.1:4500/healthz; echo; echo \"rolled back \$(basename \$cur) → \$(basename \$target)\""
