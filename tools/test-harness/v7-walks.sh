#!/bin/bash
# V7 gate step: real-input walks in real Chrome (Metal GPU, shared lease) of THIS checkout, on safe ports 5870-5879.
#   tools/test-harness/v7-walks.sh <outDir>      (run from the candidate checkout; builds web into <outDir>, ~13 min)
# Old worlds (eden/mars/littlemartians, root path) 5870-5872; launcher + new-world walk 5873 (children 5874-5876);
# then the launcher e2e, 5873 (children 5874-5878).
# Writes <outDir>/v7-receipt.json (status pass|fail, per-check results, source sha) and prints one RELEASE_GATE_V7 line.
# Only processes this script starts are ever stopped. Never touches 4930-4970 / 4986 / 4987.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$(mkdir -p "${1:?usage: v7-walks.sh <outDir>}" && cd "$1" && pwd)"
export CHROME_LEASE_MODULE=<team>/ops/chrome-lease.mjs
export WALK_BUILDS='{"head":5870}' OLD_WORLDS_OUT="$OUT/old-worlds"
MARS_WEB="$ROOT/.lane/mars-web"; PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done; }
trap cleanup EXIT
cd "$ROOT" || exit 1
for p in $(seq 5870 5879); do lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1 && { echo "port $p busy: stop"; exit 1; }; done
[ -d "$MARS_WEB" ] || { echo "missing $MARS_WEB overlay"; exit 1; }
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
# The launcher e2e (claim, pair, build, undo/redo, flags, preview, restart, look) in real Chrome: it left the CPU gate (Z3,
# 2026-10-20: SwiftShader on Modal failed 3 of 3) and is judged here. Its own launcher on 5873, worlds on 5874-5878.
perl -e 'alarm 900; exec @ARGV' node tools/god-skill/e2e/launcher.mjs --port 5873 --range 5874-5878 > "$OUT/launcher-e2e.log" 2>&1; RC_LAUNCHER=$?
node tools/test-harness/v7-receipt.mjs "$OUT" "$ROOT" "$RC_OLD" "$RC_NEW" "$RC_LAUNCHER"
