#!/usr/bin/env bash
# Option B (production on eden2; NOT run unless Codex chooses it): ship this worktree's HEAD to eden2 as a
# world-launcher release and (by default) switch a stage to it.
#   tools/world-launcher/deploy/release.sh [staging|production] [--no-activate]
#   tools/world-launcher/deploy/release.sh --local <dir>     assemble only (Option A: run it on the laptop)
# Run from a clean worktree. The release: `git archive HEAD` (committed files only, so no .env, data or keys),
# the web app built with --base /worlds/ (every URL under the launcher's prefix), the Mars web assets the worlds
# read (.lane/mars-web, dereferenced) and BUILD. Dependencies are installed on the box for Linux.
# Rollback of code: ln -sfn "$(readlink -f /srv/sim-worlds/<stage>.previous)" /srv/sim-worlds/<stage> && systemctl restart sim-worlds@<stage>
# Take it away entirely: remove the Caddy routes, then systemctl disable --now sim-worlds@<stage> (data stays in /srv/sim-worlds-data/<stage>).
set -euo pipefail
HOST="${SIM_WORLDS_HOST:-root@eden2}"
STAGE=staging; ACTIVATE=1; LOCAL=""; BASE="${SIM_WORLDS_BASE:-/worlds}"
while [ $# -gt 0 ]; do case "$1" in staging|production) STAGE="$1";; --no-activate) ACTIVATE=0;; --local) LOCAL="$2"; shift;; *) echo "usage: $0 [staging|production] [--no-activate] | --local <dir>"; exit 2;; esac; shift; done
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$ROOT"
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "commit first: the release is exactly HEAD"; exit 1; }
BUILD="we-$(git rev-parse --short=12 HEAD)"
OUT="$ROOT/.lane/release/$BUILD"
MARS_WEB_SRC="${MARS_WEB_SRC:-$ROOT/.lane/mars-web}"
[ -d "$MARS_WEB_SRC" ] || { echo "no Mars web assets at $MARS_WEB_SRC (see team/lanes/COMMON.md setup)"; exit 1; }
[ -f apps/web/src/base-path.ts ] || { echo "this commit's web app cannot run under a prefix (apps/web/src/base-path.ts missing: team/lanes/deploy-patches/web-base-path.diff)"; exit 1; }
if [ -n "$LOCAL" ]; then
  case "$LOCAL" in /*) ;; *) echo "--local needs an absolute path"; exit 2;; esac
  if [ -e "$LOCAL" ] && ! grep -qs "^we-" "$LOCAL/BUILD"; then echo "$LOCAL exists and is not an earlier launcher release: refusing to replace it"; exit 1; fi
  OUT="$LOCAL"
fi

echo "== assemble $BUILD"
rm -rf "$OUT"; mkdir -p "$OUT"
git archive HEAD | tar -x -C "$OUT"
echo "$BUILD" > "$OUT/BUILD"
BUILD_ID="$BUILD" pnpm --filter @sim/web exec vite build --logLevel warn --outDir "$OUT/apps/web/dist" --emptyOutDir --base "$BASE/"
grep -q "src=\"$BASE/assets/" "$OUT/apps/web/dist/index.html" || { echo "web build is not under $BASE/"; exit 1; }
rsync -aL --delete "$MARS_WEB_SRC/" "$OUT/mars-web/"
# /modular (the humanoid kit and the environment GLBs) is this commit's own copy, never whatever a lane overlay's
# symlink pointed at when the release was assembled: a relative link into the archived tree (no second copy).
rm -rf "$OUT/mars-web/modular"; ln -s ../mars/viewer/public/modular "$OUT/mars-web/modular"
[ -f "$OUT/mars-web/modular/humanoid/kit.json" ] || { echo "no humanoid kit in the release"; exit 1; }
du -sh "$OUT" | sed 's/^/   size /'
if [ -n "$LOCAL" ]; then
  echo "assembled $BUILD in $OUT (run pnpm install --offline --frozen-lockfile --filter @sim/server... there; command in team/lanes/deploy.md)"; exit 0
fi

REL="/srv/sim-worlds/releases/$BUILD"
echo "== upload to $HOST:$REL"
PREV="$(ssh "$HOST" "readlink /srv/sim-worlds/$STAGE 2>/dev/null || true")"
ssh "$HOST" "install -d -m 750 /srv/sim-worlds/releases $REL"
rsync -az --delete ${PREV:+--link-dest="$PREV/"} --exclude node_modules "$OUT/" "$HOST:$REL/"

echo "== install (user, dirs, unit; idempotent) and Linux dependencies"
ssh "$HOST" "set -e; bash $REL/tools/world-launcher/deploy/install.sh; chown -R simworlds:simworlds $REL;
  sudo -u simworlds -H bash -c 'set -euo pipefail; cd $REL; COREPACK_ENABLE_DOWNLOAD_PROMPT=0 nice -n 10 corepack pnpm install --frozen-lockfile --filter @sim/server... > /srv/sim-worlds/releases/$BUILD.deps.log 2>&1' || { tail -20 /srv/sim-worlds/releases/$BUILD.deps.log; exit 1; }"

if [ "$ACTIVATE" = 0 ]; then echo "uploaded $BUILD (not activated)"; exit 0; fi
echo "== activate $STAGE -> $BUILD"
ssh "$HOST" "set -e
  [ '$STAGE' != production ] || test -f /etc/sim-worlds/production-auth.env || { echo 'production needs /etc/sim-worlds/production-auth.env (the account provider settings) first'; exit 1; }
  cur=\$(readlink /srv/sim-worlds/$STAGE 2>/dev/null || true); [ -z \"\$cur\" ] || [ \"\$cur\" = '$REL' ] || ln -sfn \"\$cur\" /srv/sim-worlds/$STAGE.previous
  ln -sfn $REL /srv/sim-worlds/$STAGE.next && mv -Tf /srv/sim-worlds/$STAGE.next /srv/sim-worlds/$STAGE
  systemctl enable sim-worlds@$STAGE >/dev/null 2>&1; systemctl restart sim-worlds@$STAGE
  port=\$(sed -n 's/.*--port \([0-9]*\).*/\1/p' /etc/sim-worlds/$STAGE.conf)
  for i in \$(seq 1 60); do if curl -fsS http://127.0.0.1:\$port$BASE/__sim/healthz 2>/dev/null | grep -q '\"build\":\"$BUILD\"'; then echo \"healthy on 127.0.0.1:\$port\"; break; fi; [ \$i != 60 ] || { journalctl -u sim-worlds@$STAGE -n 30 --no-pager; exit 1; }; sleep 1; done
  # retention: keep what a stage points at plus the three newest others
  keep=\$(for s in staging production staging.previous production.previous; do readlink -f /srv/sim-worlds/\$s 2>/dev/null; done)
  ls -1dt /srv/sim-worlds/releases/we-*/ | sed 's:/\$::' | tail -n +4 | while read -r d; do echo \"\$keep\" | grep -qx \"\$d\" || { rm -rf \"\$d\" \"\$d.deps.log\"; echo \"pruned \$d\"; }; done"
echo "released $BUILD to $STAGE"
