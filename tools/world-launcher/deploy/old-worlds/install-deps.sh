#!/usr/bin/env bash
# Install server deps into an old-worlds release on eden2 (run as root; work is done as simworlds). Lane KIT 2026-10-15.
#   bash install-deps.sh /srv/sim-old/releases/<name>
# The laptop runs the sealed tree with a full workspace install; eden2 needs only the server closure:
# pnpm --filter @sim/server..., then root-level links so tools/core/*.mjs (outside apps/server) resolve the same
# packages, mars-campus-viewer -> mars/viewer, and @sim/world-compiler for apps/web/src/humanoid/look.ts
# (same recipe as CLOUD2 so-5e478f8a and tools/world-launcher/deploy/release.sh). Idempotent.
set -euo pipefail
R=${1:?release dir}; test -f "$R/RELEASE.json"
chown -R simworlds:simworlds "$R"
sudo -u simworlds -H bash -s "$R" <<'EOF'
set -euo pipefail; R=$1; cd "$R/input"
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 nice -n 10 pnpm install --frozen-lockfile --filter @sim/server... > "$R/deps.log" 2>&1 || { tail -20 "$R/deps.log"; exit 1; }
S=apps/server/node_modules
for e in "$S"/* "$S"/@*/*; do
  case "$e" in "$S"/@*/*) rel=${e#"$S"/}; scope=${rel%%/*}; mkdir -p "node_modules/$scope"; t="node_modules/$rel"; src="../../$e";;
                "$S"/@*) continue;;
                *) rel=${e#"$S"/}; t="node_modules/$rel"; src="../$e";; esac
  [ -e "$t" ] || ln -s "$src" "$t"
done
[ -e node_modules/mars-campus-viewer ] || ln -s ../mars/viewer node_modules/mars-campus-viewer
mkdir -p apps/web/node_modules/@sim; ln -sfn ../../../../packages/world-compiler apps/web/node_modules/@sim/world-compiler
echo "deps ok: $(ls node_modules | tr '\n' ' ')"
EOF
