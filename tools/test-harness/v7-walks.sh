#!/bin/bash
# V7 gate step: real-input walks in real Chrome (Metal GPU, shared lease) of THIS checkout, on safe ports 5870-5879.
#   tools/test-harness/v7-walks.sh <outDir>      (run from the candidate checkout; builds web into <outDir>, ~10 min)
# Old worlds (eden/mars/littlemartians, root path) 5870-5872; launcher + new-world walk 5873 (children 5874-5876);
# the God modal e2e (tools/god-skill/e2e/launcher.mjs: Connect, pairing, a command acked, undo/redo, weather, Forsake) runs
# its own launcher on 5877 (children 5878-5879).
# Writes <outDir>/v7-receipt.json (status pass|fail, per-check results, source sha) and prints one RELEASE_GATE_V7 line.
# Only processes this script starts are ever stopped. Never touches 4930-4970 / 4986 / 4987.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$(mkdir -p "${1:?usage: v7-walks.sh <outDir>}" && cd "$1" && pwd)"
export CHROME_LEASE_MODULE=<team>/ops/chrome-lease.mjs
export WALK_BUILDS='{"head":5870}' OLD_WORLDS_OUT="$OUT/old-worlds"
MARS_WEB_SRC="$ROOT/.lane/mars-web"; MARS_WEB="$OUT/mars-web"; PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done; }
trap cleanup EXIT
cd "$ROOT" || exit 1
for p in $(seq 5870 5879); do lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1 && { echo "port $p busy: stop"; exit 1; }; done
[ -d "$MARS_WEB_SRC" ] || { echo "missing $MARS_WEB_SRC overlay"; exit 1; }
# The walks' mars-web is the lane overlay with /modular (the humanoid kit, the environment GLBs and the character wire
# files *.mesh.glb + clips-*.glb) taken from THIS checkout, as release.sh builds a release; a lane overlay's /modular can
# predate them (the 404s of /worlds/modular/environment/*.mesh.glb in V7 walk-new, 2026-10-20).
mkdir -p "$MARS_WEB" || exit 1
SRC_REAL="$(cd "$MARS_WEB_SRC" && pwd -P)"; for e in "$SRC_REAL"/*; do ln -sfn "$e" "$MARS_WEB/${e##*/}"; done
ln -sfn "$ROOT/mars/viewer/public/modular" "$MARS_WEB/modular"
[ -f "$MARS_WEB/modular/humanoid/kit.json" ] && [ -f "$MARS_WEB/modular/environment/clips-ual.glb" ] || { echo "no humanoid kit / character wire files in $MARS_WEB/modular"; exit 1; }
heavy() { python3 <team>/ops/with-heavy-slot.py --owner gate --purpose "$1" --timeout 1800 -- "${@:2}"; }
heavy v7-build-root pnpm --filter @sim/web build > "$OUT/build-root.log" 2>&1 || { echo build-root failed; exit 1; }
heavy v7-build-worlds bash -c "cd apps/web && npx vite build --base /worlds/ --outDir $OUT/web-worlds --emptyOutDir" > "$OUT/build-worlds.log" 2>&1 || { echo build-worlds failed; exit 1; }
node tools/test-harness/old-worlds.mjs "$ROOT" 5870 head > "$OUT/servers-head.log" 2>&1 & PIDS+=($!)
for i in $(seq 1 90); do curl -s -m 2 http://127.0.0.1:5872/w/littlemartians/v1/config >/dev/null && break; sleep 2; done
perl -e 'alarm 1800; exec @ARGV' node tools/test-harness/walk-old.mjs "$OUT/old" > "$OUT/walk-old.log" 2>&1; RC_OLD=$?
kill "${PIDS[0]}" 2>/dev/null; PIDS=(); sleep 3
node tools/world-launcher/launcher.mjs --port 5873 --range 5874-5876 --data "$OUT/launcher-data" --base /worlds --web "$OUT/web-worlds" --mars-web "$MARS_WEB" --dev-auth > "$OUT/launcher.log" 2>&1 & PIDS+=($!)
for i in $(seq 1 30); do curl -s -m 2 http://127.0.0.1:5873/worlds/__sim/worlds.json >/dev/null && break; sleep 1; done
perl -e 'alarm 1800; exec @ARGV' node tools/test-harness/walk-new.mjs http://127.0.0.1:5873 "$OUT/new" > "$OUT/walk-new.log" 2>&1; RC_NEW=$?
cleanup; PIDS=()
perl -e 'alarm 1200; exec @ARGV' node tools/god-skill/e2e/launcher.mjs --port 5877 --range 5878-5879 --web "$OUT/web-worlds" --mars-web "$MARS_WEB" --out "$OUT/god" > "$OUT/god-modal.log" 2>&1; RC_GOD=$?
node tools/test-harness/v7-receipt.mjs "$OUT" "$ROOT" "$RC_OLD" "$RC_NEW" "$RC_GOD"
