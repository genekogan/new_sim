#!/usr/bin/env bash
# Prepare + browser-qualify staging, then promote that exact release.
# infra/deploy.sh --stage ; infra/deploy.sh --promote <build>
set -euo pipefail
HOST="${SIM_HOST:-root@eden2}"
cd "$(dirname "$0")/.."
MODE="${1:---stage}"
BUILD="${2:-$(git rev-parse --short=12 HEAD)}"
[[ "$BUILD" =~ ^[a-f0-9]{7,40}$ ]] || { echo "invalid build"; exit 1; }
REL="/srv/sim/releases/$BUILD"
STAGING=https://<staging-host>

if [ "$MODE" = --stage ]; then
  [ -z "$(git status --porcelain)" ] || { echo "commit the reviewed release first"; exit 1; }
  if [ "${SIM_CHECKS_ALREADY_PASSED:-0}" != 1 ]; then pnpm check; fi
  BUILD_ID="$BUILD" pnpm --filter @sim/web build >/dev/null
  SIM_STATIC=1 pnpm --filter mars-campus-viewer build:static >/dev/null
  echo "$BUILD" > BUILD
  ssh "$HOST" "install -d -o sim -g sim -m 750 /srv/sim/releases $REL"
  rsync -az --delete --link-dest=/srv/sim/current/ \
    --exclude node_modules --exclude .git --exclude data --exclude '.env*' \
    --exclude '*.db*' --exclude .e2e --exclude '.pw-browsers' --exclude '.cloudflare' \
    --exclude research --exclude vendor --exclude '__pycache__' --exclude '*.blend' \
    ./ "$HOST:$REL/"
  ssh "$HOST" "set -e; chown -R sim:sim $REL; sudo -u sim -H bash -lc 'set -euo pipefail; cd $REL; COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm install --frozen-lockfile --filter @sim/server... > /tmp/sim-deps-$BUILD.log 2>&1';
    install -m 644 $REL/infra/sim-world@.service /etc/systemd/system/sim-world@.service;
    install -m 644 $REL/infra/sim-world-staging@.service /etc/systemd/system/sim-world-staging@.service;
    install -d -o sim -g sim -m 750 /srv/sim-data/mars /srv/sim-data-staging/mars;
    install -d -o root -g sim -m 750 /home/sim/worlds;
    systemctl daemon-reload"
  # Resolve the one existing admin owner from the toy DB without logging it.
  ssh "$HOST" python3 - <<'PYREMOTE'
import sqlite3, pathlib, os, grp
conn=sqlite3.connect('file:/srv/sim-data/sim.db?mode=ro',uri=True)
rows=conn.execute("SELECT id FROM users WHERE role='admin'").fetchall()
assert len(rows)==1, 'one verified existing admin owner required'
owner=rows[0][0]
for stage, port, data, origin in [(False,4502,'/srv/sim-data/mars','https://sim.eden.art'),(True,4512,'/srv/sim-data-staging/mars','https://<staging-host>')]:
    path=pathlib.Path('/home/sim/worlds')/('staging-mars.env' if stage else 'mars.env')
    text=f'WORLD_KEY=mars\nWORLD_ID=mars-1\nENGINE=mars\nPORT={port}\nDATA_DIR={data}\nPUBLIC_URL={origin}/w/mars\nWORLD_OWNER_ID={owner}\nMAX_SOULS_PER_USER=8\n'
    if stage: text+='BRAIN_MODE=fake\n'
    # Existing configuration is preserved on later milestone deploys.
    if not path.exists():
        path.write_text(text);os.chmod(path,0o640);os.chown(path,0,grp.getgrnam('sim').gr_gid)
PYREMOTE
  ssh "$HOST" "set -e; install -d -m 700 /srv/sim/ops/$BUILD; cp /etc/caddy/sites/sim.caddy /srv/sim/ops/$BUILD/caddy.before-stage;
    readlink /srv/sim/staging > /srv/sim/ops/$BUILD/staging.previous;
    ln -sfn $REL /srv/sim/staging; systemctl restart sim-staging; systemctl enable --now sim-world-staging@mars; systemctl restart sim-world-staging@mars"
  # Stage routing only. Production's original proxy is kept until promotion.
  ssh "$HOST" "python3 - '$REL/infra/sim.caddy' <<'PYREMOTE'
from pathlib import Path
import sys
candidate=Path(sys.argv[1]).read_text()
old=Path('/etc/caddy/sites/sim.caddy').read_text()
marker='# Staging:'
assert marker in old and marker in candidate
Path('/etc/caddy/sites/sim.caddy').write_text(old.split(marker)[0]+marker+candidate.split(marker,1)[1])
PYREMOTE
    caddy validate --config /etc/caddy/Caddyfile >/dev/null && systemctl reload caddy"
  for attempt in $(seq 1 30); do
    if ssh "$HOST" "curl -fsS http://127.0.0.1:4501/healthz | grep -q '$BUILD' && curl -fsS http://127.0.0.1:4512/healthz | grep -q '$BUILD'"; then break; fi
    [ "$attempt" != 30 ] || { echo 'staging health failed; production unchanged'; exit 1; }
    sleep 1
  done
  SIM_SMOKE_BASE="$STAGING" node infra/smoke.mjs
  ssh "$HOST" "echo '$BUILD browser smoke passed' > /srv/sim/ops/$BUILD/staging-qualified"
  echo "staging qualified: $BUILD"
  exit 0
fi

[ "$MODE" = --promote ] || { echo 'use --stage or --promote <build>'; exit 1; }
ssh "$HOST" "test -f /srv/sim/ops/$BUILD/staging-qualified && test \"\$(readlink /srv/sim/staging)\" = '$REL' && curl -fsS http://127.0.0.1:4512/healthz | grep -q '$BUILD'"
# Online, consistent SQLite backup, no data reset or migration.
ssh "$HOST" "python3 - '$BUILD' <<'PYREMOTE'
import sqlite3,pathlib,sys
folder=pathlib.Path('/srv/sim/ops')/sys.argv[1]
source=sqlite3.connect('file:/srv/sim-data/sim.db?mode=ro',uri=True)
target=sqlite3.connect(folder/'toy-before.db');source.backup(target);target.close();source.close()
PYREMOTE
  cp /etc/caddy/sites/sim.caddy /srv/sim/ops/$BUILD/caddy.before-promote;
  prev=\$(readlink /srv/sim/current); echo \"\$prev\" > /srv/sim/ops/$BUILD/production.previous;
  [ \"\$prev\" = '$REL' ] || ln -sfn \"\$prev\" /srv/sim/previous;
  ln -sfn $REL /srv/sim/current; systemctl restart sim; systemctl enable --now sim-world@mars; systemctl restart sim-world@mars"
for attempt in $(seq 1 30); do
  if ssh "$HOST" "curl -fsS http://127.0.0.1:4500/healthz | grep -q '$BUILD' && curl -fsS http://127.0.0.1:4502/healthz | grep -q '$BUILD'"; then break; fi
  if [ "$attempt" = 30 ]; then
    ssh "$HOST" "prev=\$(cat /srv/sim/ops/$BUILD/production.previous); ln -sfn \"\$prev\" /srv/sim/current; systemctl restart sim; systemctl stop sim-world@mars"
    echo 'production health failed; toy rolled back'; exit 1
  fi
  sleep 1
done
ssh "$HOST" "set -e; cp $REL/infra/sim.caddy /etc/caddy/sites/sim.caddy;
  caddy validate --config /etc/caddy/Caddyfile >/dev/null || { cp /srv/sim/ops/$BUILD/caddy.before-promote /etc/caddy/sites/sim.caddy; exit 1; };
  systemctl reload caddy;
  python3 - <<'PYREMOTE'
from pathlib import Path
p=Path('/etc/litestream.yml');s=p.read_text()
if '/srv/sim-data/mars/sim.db' not in s:
    s+='  - path: /srv/sim-data/mars/sim.db\n    replica:\n      url: s3://\${R2_BUCKET}/sim/litestream/mars.db?endpoint=\${R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com&region=auto\n      sync-interval: 10s\n      retention: 168h\n      snapshot-interval: 6h\n'
    p.write_text(s)
PYREMOTE
  systemctl restart litestream; systemctl is-active sim sim-world@mars caddy litestream"
if ! SIM_SMOKE_BASE=https://sim.eden.art node infra/smoke.mjs; then
  infra/rollback.sh
  echo 'production browser smoke failed; code/services rolled back, databases preserved'; exit 1
fi
ssh "$HOST" "echo '$BUILD production smoke passed' > /srv/sim/ops/$BUILD/production-qualified"
echo "production released: $BUILD"
