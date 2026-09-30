#!/usr/bin/env bash
# Deploy Sim to eden2 as a new release: test + build locally, rsync into
# /srv/sim/releases/<build>, install deps, run it as STAGING first, smoke-test,
# then flip PRODUCTION to it. Rollback: infra/rollback.sh [<build>].
# Note: deploys the working tree; uncommitted changes are included and the build id gets a -dirty suffix.
set -euo pipefail
HOST="${SIM_HOST:-root@eden2}"
cd "$(dirname "$0")/.."
BUILD="$(git rev-parse --short HEAD)$(git diff --quiet HEAD || echo -dirty)"
REL="/srv/sim/releases/$BUILD"

echo "== typecheck + test ($BUILD)"
pnpm typecheck >/dev/null
pnpm -r test >/dev/null
echo "== build web"
BUILD_ID="$BUILD" pnpm --filter @sim/web build >/dev/null
echo "$BUILD" > BUILD

echo "== rsync → $REL"
ssh "$HOST" "install -d -o sim -g sim -m 750 /srv/sim/releases $REL"
rsync -az --delete --link-dest=/srv/sim/current/ \
  --exclude node_modules --exclude .git --exclude data --exclude '.env' --exclude '.env.*' --exclude '*.db' --exclude '*.db-*' \
  ./ "$HOST:$REL/"

echo "== install deps"
ssh "$HOST" "chown -R sim:sim $REL && sudo -u sim -H bash -lc 'cd $REL && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm install --frozen-lockfile --filter @sim/server... 2>&1 | tail -1'"

echo "== staging"
ssh "$HOST" "ln -sfn $REL /srv/sim/staging && systemctl restart sim-staging && sleep 4 && systemctl is-active sim-staging >/dev/null && curl -fsS http://127.0.0.1:4501/healthz | grep -q '\"build\":\"$BUILD\"' && echo 'staging ok'" || { echo "STAGING FAILED: production untouched; removing the rejected release"; ssh "$HOST" "journalctl -u sim-staging -n 20 --no-pager | cut -c1-200; cur=\$(readlink /srv/sim/current); ln -sfn \$cur /srv/sim/staging; systemctl restart sim-staging; [ \"\$cur\" != \"$REL\" ] && rm -rf $REL"; exit 1; }

echo "== production"
ssh "$HOST" "prev=\$(readlink /srv/sim/current || true); [ -n \"\$prev\" ] && [ \"\$prev\" != \"$REL\" ] && ln -sfn \$prev /srv/sim/previous; ln -sfn $REL /srv/sim/current && systemctl restart sim && sleep 4 && systemctl is-active sim && curl -fsS http://127.0.0.1:4500/healthz; echo
  cd /srv/sim/releases && keep=\$(basename \$(readlink /srv/sim/previous 2>/dev/null || echo none)); ls -1t | tail -n +6 | grep -v \"^\$keep\$\" | xargs -r rm -rf   # keep the 5 newest releases and the rollback target
  journalctl -u sim -n 4 --no-pager | grep -E 'world|http' | cut -c1-200"
echo "== done: $BUILD"
