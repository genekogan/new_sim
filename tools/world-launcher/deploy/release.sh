#!/usr/bin/env bash
# Option B (production on eden2; NOT run unless Codex chooses it): ship this worktree's HEAD to eden2 as a
# world-launcher release and (by default) switch a stage to it.
#   tools/world-launcher/deploy/release.sh [staging|production] [--no-activate] [--restart|--reload]   (--restart: no handover;
#   --reload: hand over even when this release changes keeper.mjs; the running keeper stays until the next restart)
#   tools/world-launcher/deploy/release.sh --local <dir>     assemble only (Option A: run it on the laptop)
#   tools/world-launcher/deploy/release.sh legacy [--no-activate|--local <dir>]   the original worlds at the site root (old-worlds/
#        README.md): web built for / (no prefix), build we-<sha12>-root, uploaded to /srv/sim-old/releases/ (never pruned by
#        a /worlds release); activation is the kit's (cutover.sh), so legacy is never activated from here
# Run from a clean worktree. The release: `git archive HEAD` (committed files only, so no .env, data or keys),
# the web app built with --base /worlds/ (every URL under the launcher's prefix), the Mars web assets the worlds
# read (.lane/mars-web, dereferenced) and BUILD. Dependencies are installed on the box for Linux.
# Activation is deploy/activate.sh on the box: `systemctl reload` hands the worlds over without closing the port (keeper.mjs).
# Rollback of code: ln -sfn "$(readlink -f /srv/sim-worlds/<stage>.previous)" /srv/sim-worlds/<stage> && systemctl reload sim-worlds@<stage>
# (restart instead of reload if the keeper is not running; settings in /etc/sim-worlds/<stage>.conf change only on restart).
# Take it away entirely: remove the Caddy routes, then systemctl disable --now sim-worlds@<stage> (data stays in /srv/sim-worlds-data/<stage>).
set -euo pipefail
HOST="${SIM_WORLDS_HOST:-root@eden2}"
STAGE=staging; ACTIVATE=1; LOCAL=""; RESTART=""; HOW=""; BASE="${SIM_WORLDS_BASE:-/worlds}"
while [ $# -gt 0 ]; do case "$1" in staging|production|legacy) STAGE="$1";; --no-activate) ACTIVATE=0;; --restart) RESTART=1; HOW=--restart;; --reload) HOW=--reload;; --local) LOCAL="$2"; shift;; *) echo "usage: $0 [staging|production|legacy] [--no-activate] [--restart|--reload] | --local <dir>"; exit 2;; esac; shift; done
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$ROOT"
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "commit first: the release is exactly HEAD"; exit 1; }
BUILD="we-$(git rev-parse --short=12 HEAD)"
RELROOT=/srv/sim-worlds/releases
if [ "$STAGE" = legacy ]; then BASE=""; BUILD="$BUILD-root"; RELROOT=/srv/sim-old/releases; ACTIVATE=0; fi
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
# The Eden experience (connected growing world, atmosphere, presets) is pinned to the qualified Eden world id, exactly as
# the laptop's old-world build pins it (hotfix-integration-00x WEB-MANIFEST.json flags); the /worlds/w/eden fork runs that
# world id. Without it the fork drew only the bare commons (lane FORKFIX). New worlds have other ids: unaffected.
EDEN_WORLDS="${VITE_EDEN_EXPERIENCE_WORLD_IDS-pm-preview-eden-20261005}"
BUILD_ID="$BUILD" VITE_EDEN_EXPERIENCE_WORLD_IDS="$EDEN_WORLDS" pnpm --filter @sim/web exec vite build --logLevel warn --outDir "$OUT/apps/web/dist" --emptyOutDir --base "$BASE/"
grep -qE "(src=|\")$BASE/assets/" "$OUT/apps/web/dist/index.html" || { echo "web build is not under $BASE/"; exit 1; }
# The pin is inlined as the argument of Shell's edenReleaseWorlds call (minified f(`id,...`)); the id also appears hard-coded
# elsewhere (classroom, old Eden), so match the call, in whatever chunk the bundler put Shell (P7d merged it into main).
[ -z "$EDEN_WORLDS" ] || grep -qsE "[A-Za-z_\$][A-Za-z0-9_\$]*\(\`${EDEN_WORLDS%%,*}" "$OUT"/apps/web/dist/assets/*.js || { echo "web build lacks the Eden experience pin ($EDEN_WORLDS)"; exit 1; }
# P1 phones: .br/.gz beside each hashed asset (the launcher serves them; nothing is compressed on the request path)
node tools/world-launcher/deploy/precompress.mjs "$OUT/apps/web/dist/assets"
rsync -aL --delete "$MARS_WEB_SRC/" "$OUT/mars-web/"
# /modular (the humanoid kit and the environment GLBs) is this commit's own copy, never whatever a lane overlay's
# symlink pointed at when the release was assembled: a relative link into the archived tree (no second copy).
rm -rf "$OUT/mars-web/modular"; ln -s ../mars/viewer/public/modular "$OUT/mars-web/modular"
[ -f "$OUT/mars-web/modular/humanoid/kit.json" ] || { echo "no humanoid kit in the release"; exit 1; }
# legacy: every file's sha256 (FILES.sha256), so the kit's preflight proves eden2 runs exactly this tree (sha256sum -c)
[ "$STAGE" != legacy ] || (cd "$OUT" && find . -type f ! -name FILES.sha256 -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256 > FILES.sha256)
du -sh "$OUT" | sed 's/^/   size /'
if [ -n "$LOCAL" ]; then
  echo "assembled $BUILD in $OUT (run pnpm install --offline --frozen-lockfile --filter @sim/server... there; command in team/lanes/deploy.md)"; exit 0
fi

REL="$RELROOT/$BUILD"
echo "== upload to $HOST:$REL"
PREV="$(ssh "$HOST" "readlink /srv/sim-worlds/$STAGE 2>/dev/null || true")"
# never re-mode an existing releases root (install -d would chmod it; /srv/sim-old/releases must stay traversable)
ssh "$HOST" "[ -d $RELROOT ] || install -d -m 750 $RELROOT; install -d -m 750 $REL"
rsync -az --delete ${PREV:+--link-dest="$PREV/"} --exclude node_modules "$OUT/" "$HOST:$REL/"

echo "== install (user, dirs, unit; idempotent) and Linux dependencies"
# legacy: never install.sh (it rewrites the shared unit file and daemon-reloads beside the live /worlds unit); the kit's
# legacy-setup.sh writes the legacy stage's own settings.
INSTALL="bash $REL/tools/world-launcher/deploy/install.sh"; [ "$STAGE" != legacy ] || INSTALL="id simworlds >/dev/null"
ssh "$HOST" "set -e; $INSTALL; chown -R simworlds:simworlds $REL; touch $RELROOT/$BUILD.deps.log; chown simworlds:simworlds $RELROOT/$BUILD.deps.log;
  sudo -u simworlds -H bash -c 'set -euo pipefail; cd $REL; COREPACK_ENABLE_DOWNLOAD_PROMPT=0 nice -n 10 corepack pnpm install --frozen-lockfile --filter @sim/server... > $RELROOT/$BUILD.deps.log 2>&1 && mkdir -p apps/web/node_modules/@sim && ln -sfn ../../../../packages/world-compiler apps/web/node_modules/@sim/world-compiler' || { tail -20 $RELROOT/$BUILD.deps.log; exit 1; }"
# The server imports apps/web/src/humanoid/look.ts (shared look rules), which imports @sim/world-compiler; the server-only
# install doesn't link web's workspace deps, so link that one package (2026-10-11: we-39cb14d848af worlds failed to boot).

if [ "$ACTIVATE" = 0 ]; then echo "uploaded $BUILD (not activated)"; exit 0; fi
echo "== activate $STAGE -> $BUILD"
# activate.sh (in the release): switch the stage link, then `systemctl reload` (the keeper hands the worlds over one at a
# time; no port closes, viewers reconnect) or, for a first keeper install / a changed keeper / --restart, a restart; then
# health + every world's boot smoke, with automatic rollback to <stage>.previous by the same route (lane C4, G9).
ssh "$HOST" "set -e
  [ '$STAGE' != production ] || test -f /etc/sim-worlds/production-auth.env || { echo 'production needs /etc/sim-worlds/production-auth.env (the account provider settings) first'; exit 1; }
  systemctl enable sim-worlds@$STAGE >/dev/null 2>&1
  bash $REL/tools/world-launcher/deploy/activate.sh $STAGE $REL $HOW
  # retention: keep what a stage points at plus the three newest others
  keep=\$(for s in staging production staging.previous production.previous; do readlink -f /srv/sim-worlds/\$s 2>/dev/null; done)
  ls -1dt /srv/sim-worlds/releases/we-*/ | sed 's:/\$::' | tail -n +4 | while read -r d; do echo \"\$keep\" | grep -qx \"\$d\" || { rm -rf \"\$d\" \"\$d.deps.log\"; echo \"pruned \$d\"; }; done"
echo "released $BUILD to $STAGE"
