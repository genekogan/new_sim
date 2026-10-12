#!/bin/bash
# The ONE major bug-hunting validation (Gene, 2026-10-11): run once, near the end, on the merged integration base
# before it goes to main and production. The plan, durations and how to read the results are at the top of
# team/lanes/rec.md and in docs/god/MERGE-GUIDE.md §8.
#
#   tools/test-harness/one-validation.sh <outDir> [--baseline <tree at the previous production source>] [--skip V5,V8,…]
#
# Ports: 5400–5449 only (port-remap moves Codex-era 4930–4969 test ports to 5400–5439, one step at a time).
# Never touches 4930–4970/4986/4987. Production data is only ever copied read-only (V8). Chrome steps take the lease.
# Steps run strictly one after another, so at most one heavy job is ever running.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:?usage: one-validation.sh <outDir> [--baseline <tree>] [--skip V1,V2]}"; shift
BASELINE=<worktrees>/reconcile-main-e8; SKIP=""
while [ $# -gt 0 ]; do case "$1" in --baseline) BASELINE="$2"; shift;; --skip) SKIP="$2"; shift;; esac; shift; done
mkdir -p "$OUT"; SUM="$OUT/SUMMARY.tsv"; echo -e "step\texit\tseconds\tlog" > "$SUM"
REMAP="--import=$ROOT/tools/test-harness/port-remap.mjs"
DESCRIPTORS=<team>/pm-integration/auth-account-20261009/runtime-modern-context-prep-001
cd "$ROOT" || exit 1
step() {  # step <id> <seconds> <command…>
  local id="$1" t="$2"; shift 2
  case ",$SKIP," in *",${id%%-*},"*) echo -e "$id\tSKIP\t0\t-" >> "$SUM"; return;; esac
  local s=$(date +%s); echo "== $id: $*"
  perl -e 'alarm shift; exec @ARGV' "$t" "$@" > "$OUT/$id.log" 2>&1; local rc=$?
  echo -e "$id\t$rc\t$(( $(date +%s) - s ))\t$OUT/$id.log" >> "$SUM"; tail -n 3 "$OUT/$id.log" | cut -c1-240
}
skipped() { case ",$SKIP," in *",$1,"*) return 0;; esac; return 1; }
busy() { lsof -nP -iTCP:5400-5449 -sTCP:LISTEN 2>/dev/null | tail -n +2; }

# V0 preflight: exact commit, clean tree, our range free, the production listeners present (read-only lsof).
{ echo "HEAD $(git rev-parse HEAD)"; git status --porcelain --untracked-files=no; echo "main $(git rev-parse main) ancestor-of-HEAD:$(git merge-base --is-ancestor main HEAD && echo yes || echo NO)";
  echo "range 5400-5449 listeners:"; busy; echo "production listeners (must be present, never touched):"; lsof -nP -iTCP:4950 -iTCP:4963 -iTCP:4964 -iTCP:4970 -sTCP:LISTEN | tail -n +2; } > "$OUT/V0-preflight.log" 2>&1
cat "$OUT/V0-preflight.log"; [ -z "$(busy)" ] || { echo "ports 5400-5449 busy: stop and investigate"; exit 1; }

# V1 types (all packages); known main-only errors: apps/server/src/edge-comms-manual-replay.test.ts (MERGE-GUIDE F5)
step V1-types 1200 pnpm -r exec tsc --noEmit -p .
# V2 builds: root (old worlds) and /worlds (launcher prefix)
step V2-build-root 900 pnpm --filter @sim/web build
step V2-build-worlds 900 bash -c "cd apps/web && npx vite build --base /worlds/ --outDir $ROOT/.lane/web-worlds --emptyOutDir"
# V3 package and engine suites (no ports)
step V3-packages 2400 bash tools/test-harness/package-suite.sh
step V3-mars-engine 2400 bash -c 'cd mars/viewer && node --test --test-concurrency=4 engine/test/*.test.ts'
step V3-client-cli 1800 node --test --test-concurrency=1 tools/edge-skill/*.test.mjs tools/client-eval/*.test.mjs
step V3-launcher-unit 1200 node --test --test-concurrency=1 tools/world-launcher/launcher.test.mjs tools/world-launcher/launcher-auth.test.mjs   # lane ports 5210-5259
# V4 web tests: node runner (compare the failure set with the baseline's, F6) and bundled .tsx tests
step V4-web 900 bash -c 'cd apps/web && node --test --test-concurrency=1 $(ls src/*.test.* src/**/*.test.* test/*.test.* 2>/dev/null | grep -v "\.tsx$" | sort -u)'
step V4-web-baseline 900 bash -c "cd $BASELINE/apps/web && node --test --test-concurrency=1 \$(ls src/*.test.* src/**/*.test.* test/*.test.* 2>/dev/null | grep -v '\.tsx$' | sort -u)"
# V5 the FULL server suite, on the laptop, safely: every Codex-era port remapped, overrides set, serial
step V5-server-full 3600 env NODE_OPTIONS="$REMAP" PORT_REMAP_BASE=5400 TEST_MARS_PORT=5445 TEST_BODY_CLI_PORT=5446 bash -c 'cd apps/server && node --test --test-concurrency=1 src/*.test.ts src/god/*.test.ts'
[ -z "$(busy)" ] || echo "WARNING: listeners left in 5400-5449 after V5" | tee -a "$OUT/V5-server-full.log"
# V6 new worlds: god + Soul e2es (real servers, fake minds, $0), Clerk via synthetic issuer, under /worlds
step V6-scenarios 1500 node tools/god-skill/e2e/scenarios.mjs --port 5420
step V6-party 1500 node tools/god-skill/e2e/party.mjs --port 5421
step V6-souls-r2 1500 node tools/god-skill/e2e/souls-r2.mjs --port 5422
step V6-join-clerk 900 node tools/god-skill/e2e/join.mjs --mode clerk --base /worlds --port 5425 --range 5426-5429
step V6-join-dev 900 node tools/god-skill/e2e/join.mjs --mode dev --port 5430 --range 5431-5434
step V6-launcher 900 node tools/god-skill/e2e/launcher.mjs --port 5435 --range 5436-5440
for e in souls-ux mars-two lm-two; do [ -f tools/god-skill/e2e/$e.mjs ] && step V6-$e 1500 node tools/god-skill/e2e/$e.mjs --port 5423; done
# V7 real input in real Chrome (lease, GPU), dpr 1 and 2
#   old worlds: local root-path eden/mars/LM from this tree (5401-5403) beside the baseline tree (5411-5413)
#   new world:  launcher under /worlds (5441, children 5442-5444): home → New world → arrival, camera, Join line
if ! skipped V7; then
OLD_WORLDS_OUT="$OUT/old-worlds" node tools/test-harness/old-worlds.mjs "$ROOT" 5401 head > "$OUT/V7-servers-head.log" 2>&1 & P1=$!
OLD_WORLDS_OUT="$OUT/old-worlds" node tools/test-harness/old-worlds.mjs "$BASELINE" 5411 base > "$OUT/V7-servers-base.log" 2>&1 & P2=$!
for p in 5403 5413; do for i in $(seq 1 90); do curl -s -m 2 "http://127.0.0.1:$p/w/littlemartians/v1/config" >/dev/null && break; sleep 2; done; done
export WALK_BUILDS='{"base":5411,"head":5401}'; step V7-old-worlds 1800 node tools/test-harness/walk-old.mjs "$OUT/V7-old-worlds"
kill $P1 $P2 2>/dev/null; sleep 3
node tools/world-launcher/launcher.mjs --port 5441 --range 5442-5444 --data "$OUT/launcher-data" --base /worlds --web "$ROOT/.lane/web-worlds" --mars-web "$ROOT/.lane/mars-web" --dev-auth > "$OUT/V7-launcher.log" 2>&1 & P3=$!
for i in $(seq 1 30); do curl -s -m 2 http://127.0.0.1:5441/worlds/__sim/worlds.json >/dev/null && break; sleep 1; done
step V7-new-world 1800 node tools/test-harness/walk-new.mjs http://127.0.0.1:5441 "$OUT/V7-new-world"
step V7-camera-dpr2 900 node tools/god-skill/e2e/camera-probe.mjs "$(node -e "const r=require('$OUT/V7-new-world/report.json');console.log((r.runs[0].created||'').split('?')[0])")" --dpr 2 --out "$OUT/V7-camera-dpr2"
kill $P3 2>/dev/null; sleep 3
fi
# V8 old-world data safety: production histories copied READ-ONLY, booted check-only on the baseline and on HEAD
step V8-history-boot 3600 node tools/test-harness/history-boot-compare.mjs --descriptors "$DESCRIPTORS" --baseline "$BASELINE" --candidate "$ROOT" --out "$OUT/V8-history" --worlds mars,littlemartians,eden

echo; echo "== SUMMARY ($SUM)"; column -t -s $'\t' "$SUM"; echo "leftover listeners in 5400-5449:"; busy
