#!/usr/bin/env bash
# Ship this worktree's HEAD to eden2 as a world-launcher release, and (by default) switch a stage to it.
#   tools/world-launcher/deploy/release.sh [staging|production] [--no-activate]
# Run on the laptop from a clean worktree. What goes over: `git archive HEAD` (committed files only, so no
# .env, data or keys), the web app built with its assets under /we-assets/, the Mars web assets the worlds
# read (.lane/mars-web, dereferenced) and BUILD. Dependencies are installed on the box for Linux.
# Rollback of code: ln -sfn "$(readlink -f /srv/sim-worlds/<stage>.previous)" /srv/sim-worlds/<stage> && systemctl restart sim-worlds@<stage>
# Take it away entirely: remove the Caddy routes, then systemctl disable --now sim-worlds@<stage> (data stays in /srv/sim-worlds-data/<stage>).
set -euo pipefail
HOST="${SIM_WORLDS_HOST:-root@eden2}"
STAGE=staging; ACTIVATE=1
for a in "$@"; do case "$a" in staging|production) STAGE="$a";; --no-activate) ACTIVATE=0;; *) echo "usage: $0 [staging|production] [--no-activate]"; exit 2;; esac; done
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$ROOT"
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "commit first: the release is exactly HEAD"; exit 1; }
BUILD="we-$(git rev-parse --short=12 HEAD)"
OUT="$ROOT/.lane/release/$BUILD"
MARS_WEB_SRC="${MARS_WEB_SRC:-$ROOT/.lane/mars-web}"
[ -d "$MARS_WEB_SRC" ] || { echo "no Mars web assets at $MARS_WEB_SRC (see team/lanes/COMMON.md setup)"; exit 1; }

echo "== assemble $BUILD"
rm -rf "$OUT"; mkdir -p "$OUT"
git archive HEAD | tar -x -C "$OUT"
echo "$BUILD" > "$OUT/BUILD"
BUILD_ID="$BUILD" pnpm --filter @sim/web exec vite build --logLevel warn --outDir "$OUT/apps/web/dist" --emptyOutDir --assetsDir we-assets
grep -q '/we-assets/' "$OUT/apps/web/dist/index.html" || { echo "web build did not use /we-assets/"; exit 1; }
rsync -aL --delete "$MARS_WEB_SRC/" "$OUT/mars-web/"
du -sh "$OUT" | sed 's/^/   size /'

REL="/srv/sim-worlds/releases/$BUILD"
echo "== upload to $HOST:$REL"
PREV="$(ssh "$HOST" "readlink -f /srv/sim-worlds/$STAGE 2>/dev/null || true")"
ssh "$HOST" "install -d -m 750 /srv/sim-worlds/releases $REL"
rsync -az --delete ${PREV:+--link-dest="$PREV/"} --exclude node_modules "$OUT/" "$HOST:$REL/"

echo "== install (user, dirs, unit; idempotent) and Linux dependencies"
ssh "$HOST" "set -e; bash $REL/tools/world-launcher/deploy/install.sh; chown -R simworlds:simworlds $REL;
  sudo -u simworlds -H bash -c 'set -euo pipefail; cd $REL; COREPACK_ENABLE_DOWNLOAD_PROMPT=0 nice -n 10 corepack pnpm install --frozen-lockfile --filter @sim/server... > /srv/sim-worlds/releases/$BUILD.deps.log 2>&1' || { tail -20 /srv/sim-worlds/releases/$BUILD.deps.log; exit 1; }"

if [ "$ACTIVATE" = 0 ]; then echo "uploaded $BUILD (not activated)"; exit 0; fi
echo "== activate $STAGE -> $BUILD"
ssh "$HOST" "set -e
  [ '$STAGE' != production ] || test -f /etc/sim-worlds/production-auth.env || { echo 'production needs /etc/sim-worlds/production-auth.env (the account provider settings) first'; exit 1; }
  cur=\$(readlink -f /srv/sim-worlds/$STAGE 2>/dev/null || true); [ -z \"\$cur\" ] || [ \"\$cur\" = '$REL' ] || ln -sfn \"\$cur\" /srv/sim-worlds/$STAGE.previous
  ln -sfn $REL /srv/sim-worlds/$STAGE.next && mv -Tf /srv/sim-worlds/$STAGE.next /srv/sim-worlds/$STAGE
  systemctl enable sim-worlds@$STAGE >/dev/null 2>&1; systemctl restart sim-worlds@$STAGE
  port=\$(sed -n 's/.*--port \([0-9]*\).*/\1/p' /etc/sim-worlds/$STAGE.conf)
  for i in \$(seq 1 60); do if curl -fsS http://127.0.0.1:\$port/__worlds/healthz 2>/dev/null | grep -q '\"build\":\"$BUILD\"'; then echo \"healthy on 127.0.0.1:\$port\"; break; fi; [ \$i != 60 ] || { journalctl -u sim-worlds@$STAGE -n 30 --no-pager; exit 1; }; sleep 1; done
  # retention: keep what a stage points at plus the three newest others
  keep=\$(for s in staging production staging.previous production.previous; do readlink -f /srv/sim-worlds/\$s 2>/dev/null; done)
  ls -1dt /srv/sim-worlds/releases/we-*/ | sed 's:/\$::' | tail -n +4 | while read -r d; do echo \"\$keep\" | grep -qx \"\$d\" || { rm -rf \"\$d\" \"\$d.deps.log\"; echo \"pruned \$d\"; }; done"
echo "released $BUILD to $STAGE"
