#!/usr/bin/env bash
# One-shot cloud runner: replay the frozen set against a fix branch and commit the results to `playtest-results`.
#   bash tools/playtest/cloud/run-replay.sh <fix-branch> <out-name> [repeats=1]
# Run from a clone of the playtest branch (lane/playtest-20261024). Idempotent: rerunning resumes every step
# (worktree, install, web build stamp, asset overlay, replay-set receipts, PNG compression, commit). See README.md.
# Layout beside the clone: ../server (fix branch worktree), ../mars-web (overlay), ../results/<out-name>, ../results-branch.
# Never prints tokens; refuses to commit if a token-shaped string is found in the results.
# PLAYTEST_CLOUD_SKIP=step,step skips named steps (for a local dry check of the git plumbing).
set -euo pipefail

FIX="${1:?usage: run-replay.sh <fix-branch> <out-name> [repeats]}"
NAME="${2:?usage: run-replay.sh <fix-branch> <out-name> [repeats]}"
REPEATS="${3:-1}"
[[ "$NAME" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "out-name: letters, digits, . _ - only" >&2; exit 1; }
[[ "$REPEATS" =~ ^[1-9][0-9]*$ ]] || { echo "repeats: a positive integer" >&2; exit 1; }

PT="$(git rev-parse --show-toplevel)"
cd "$PT"
PARENT="$(cd "$PT/.." && pwd)"
SERVER="$PARENT/server"
MARSWEB="$PARENT/mars-web"
OUT="$PARENT/results/$NAME"
RB="$PARENT/results-branch"
mkdir -p "$OUT"
LOG="$OUT/cloud-run.log"
TIMES="$OUT/.cloud-times"
: >> "$TIMES"

say() { printf '[cloud %s] %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$LOG" >&2; }
step() { # step <name> <cmd...>: run, log, record seconds (keeps earlier timings from previous attempts)
  local name="$1"; shift; local t0; t0=$(date +%s)
  if [[ ",${PLAYTEST_CLOUD_SKIP:-}," == *",$name,"* ]]; then say "== $name: skipped (PLAYTEST_CLOUD_SKIP)"; return 0; fi
  say "== $name"
  local rc=0; "$@" >>"$LOG" 2>&1 || rc=$?
  local dt=$(( $(date +%s) - t0 ))
  echo "$name $dt $rc" >> "$TIMES"
  say "   $name: ${dt}s exit $rc"
  return $rc
}
retry() { local n=0; until "$@"; do n=$((n + 1)); [ $n -ge 6 ] && return 1; local w=$(( 2 ** n )); say "retry in ${w}s: $*"; sleep $w; done; }
load1() { cut -d' ' -f1-3 /proc/loadavg 2>/dev/null || uptime | sed 's/.*averages*: //'; }
mem() { awk '/MemTotal|MemAvailable/ {printf "%s %.1f GB  ", $1, $2/1048576}' /proc/meminfo 2>/dev/null || echo n/a; }

LOAD_BEFORE="$(load1)"; MEM_BEFORE="$(mem)"; T_START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
say "fix=$FIX out=$NAME repeats=$REPEATS clone=$PT"

# --- toolchain: node >= 22.18 strips TypeScript itself; older 22.x needs the flag for apps/server/src/main.ts
NODE_V="$(node -p 'process.versions.node')"
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)'; then
  export NODE_OPTIONS="${NODE_OPTIONS:-} --experimental-strip-types"; say "node $NODE_V: adding --experimental-strip-types"
fi
command -v pnpm >/dev/null || { corepack enable >/dev/null 2>&1 || npm i -g pnpm@10 >>"$LOG" 2>&1; }
if ! command -v convert >/dev/null && ! command -v magick >/dev/null && ! command -v ffmpeg >/dev/null; then
  step install-imagemagick bash -c 'export DEBIAN_FRONTEND=noninteractive; (apt-get update -qq && apt-get install -y -qq imagemagick) || (sudo apt-get update -qq && sudo apt-get install -y -qq imagemagick)' || say "no ImageMagick: thumbnails and JPEG compression will be skipped"
fi
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
[ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ] && [ -d /opt/pw-browsers ] && export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
NPM_GLOBAL="$(npm root -g 2>/dev/null || true)"
export NODE_PATH="${NODE_PATH:-}${NODE_PATH:+:}$NPM_GLOBAL"

# --- fix branch → ../server (worktree, detached at origin/<fix>)
step fetch-fix retry git fetch --no-tags origin "+refs/heads/$FIX:refs/remotes/origin/$FIX"
if [ -e "$SERVER/.git" ]; then step checkout-fix git -C "$SERVER" checkout -q --detach "origin/$FIX"
else git worktree prune; step worktree-add git worktree add --detach "$SERVER" "origin/$FIX"; fi
FIX_SHA="$(git -C "$SERVER" rev-parse HEAD)"; PT_SHA="$(git rev-parse HEAD)"
say "fix $FIX @ $FIX_SHA · playtest @ $PT_SHA"

step install-playtest retry pnpm install --frozen-lockfile
step install-server bash -c "cd '$SERVER' && pnpm install --frozen-lockfile"
STAMP="$SERVER/apps/web/dist/.built-sha"
if [ "$(cat "$STAMP" 2>/dev/null || true)" = "$FIX_SHA" ] && [ -f "$SERVER/apps/web/dist/index.html" ]; then say "web build for $FIX_SHA present"
else step web-build bash -c "cd '$SERVER/apps/web' && npx vite build"; [ -d "$(dirname "$STAMP")" ] && echo "$FIX_SHA" > "$STAMP"; fi

# --- asset overlay from production URLs (resumable; sha256 manifest)
step overlay retry node tools/playtest/arena/assets-overlay.mjs "$MARSWEB" --server-root "$SERVER"
export PLAYTEST_MARS_WEB="$MARSWEB"

# --- preflight (recorded) and the replay set (the box is dedicated: --force-machine records gate breaches)
step preflight bash -c "node tools/playtest/playtest.mjs preflight --server-root '$SERVER' --force-machine > '$OUT/cloud-preflight.json'" || { say "preflight failed: see $OUT/cloud-preflight.json"; }
PF_OK="$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).ok)}catch{console.log("unknown")}' "$OUT/cloud-preflight.json")"
RS_RC=0
if [ "$PF_OK" = "true" ]; then
  step replay-set node tools/playtest/playtest.mjs replay-set --server-root "$SERVER" --out "$OUT" --repeats "$REPEATS" --force-machine --frozen tools/playtest/frozen/frozen.json || RS_RC=$?
else RS_RC=2; say "skipping the replay set: preflight not ok"; fi
LOAD_AFTER="$(load1)"; MEM_AFTER="$(mem)"

# --- shrink screenshots for git (story.html keeps its inline thumbnails)
step compress node tools/playtest/cloud/compress-shots.mjs "$OUT" --width 1024 --quality 75 --jobs "$(nproc 2>/dev/null || echo 4)" || true

# --- CLOUD.md
OVERLAY_FACT="$(node -e 'try{const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(`${m.files.length} files, ${Math.round(m.bytes/1048576)} MB from ${m.origin}, missing: ${m.missing.map((x)=>x.rel).join(", ")||"none"}`)}catch{console.log("n/a")}' "$MARSWEB/overlay-manifest.json")"
{
  echo "# Cloud replay: $NAME"
  echo
  echo "- Fix branch: \`$FIX\` @ \`$FIX_SHA\`"
  echo "- Playtest: \`$(git rev-parse --abbrev-ref HEAD)\` @ \`$PT_SHA\`"
  echo "- Repeats: $REPEATS · started $T_START · finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "- Replay-set exit: $RS_RC · preflight ok: $PF_OK"
  echo "- Machine: $(uname -srm) · nproc $(nproc 2>/dev/null || sysctl -n hw.ncpu) · $(node -v) · pnpm $(pnpm -v 2>/dev/null || echo ?) · $(claude --version 2>/dev/null | head -1 || echo 'claude ?')"
  echo "- Memory before: $MEM_BEFORE · after: $MEM_AFTER"
  echo "- Load before: $LOAD_BEFORE · after: $LOAD_AFTER"
  echo "- Browser: Playwright Chromium headless, SwiftShader GL (Linux launch args in lib/platform.mjs); PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH:-unset}"
  echo "- Asset overlay: $OVERLAY_FACT"
  echo "- Screenshots: PNG → JPEG ≤ 1024 px (q75); \`.png\` references in text files rewritten to \`.jpg\`."
  echo
  echo "## Timings (s)"
  echo
  echo "| step | seconds | exit |"; echo "|---|---:|---:|"
  awk '{printf "| %s | %s | %s |\n", $1, $2, $3}' "$TIMES"
} > "$OUT/CLOUD.md"

# --- secret guard: refuse to publish token-shaped strings
if grep -rIlE 'sk-ant-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|gho_[A-Za-z0-9]{30,}|xox[abp]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----' "$OUT" > "$PARENT/.secret-hits" 2>/dev/null; then
  say "token-shaped strings found in $(wc -l < "$PARENT/.secret-hits") files (names in $PARENT/.secret-hits); NOT committing"; exit 3
fi
rm -f "$PARENT/.secret-hits"

# --- commit to playtest-results (existing remote branch, else orphan) and push with backoff
if [ ! -e "$RB/.git" ]; then
  git worktree prune
  if git fetch --no-tags origin "+refs/heads/playtest-results:refs/remotes/origin/playtest-results" >>"$LOG" 2>&1; then
    git worktree add -B playtest-results "$RB" origin/playtest-results >>"$LOG" 2>&1
  else
    if ! git worktree add --orphan -b playtest-results "$RB" >>"$LOG" 2>&1; then # git >= 2.42
      git worktree add --detach "$RB" >>"$LOG" 2>&1
      git -C "$RB" checkout -q --orphan playtest-results
      git -C "$RB" rm -rfq . >/dev/null 2>&1 || true
    fi
    printf '# playtest-results\n\nCloud replay results, one folder per run under results/. Written by tools/playtest/cloud/run-replay.sh.\n' > "$RB/README.md"
  fi
else
  git -C "$RB" fetch --no-tags origin "+refs/heads/playtest-results:refs/remotes/origin/playtest-results" >>"$LOG" 2>&1 && git -C "$RB" rebase -q origin/playtest-results >>"$LOG" 2>&1 || true
fi
git -C "$RB" config user.email >/dev/null 2>&1 || git -C "$RB" config user.email "playtest-cloud@agent.invalid"
git -C "$RB" config user.name >/dev/null 2>&1 || git -C "$RB" config user.name "playtest cloud runner"
mkdir -p "$RB/results/$NAME"
rsync -a --delete --exclude '.cloud-times' "$OUT/" "$RB/results/$NAME/" 2>/dev/null || { rm -rf "$RB/results/$NAME"; mkdir -p "$RB/results/$NAME"; cp -a "$OUT/." "$RB/results/$NAME/"; rm -f "$RB/results/$NAME/.cloud-times"; }
# GitHub refuses files over 100 MB: leave those out and list them
find "$RB/results/$NAME" -type f -size +95M -print -delete | sed "s#^$RB/##" > "$RB/results/$NAME/OMITTED-LARGE-FILES.txt" || true
[ -s "$RB/results/$NAME/OMITTED-LARGE-FILES.txt" ] || rm -f "$RB/results/$NAME/OMITTED-LARGE-FILES.txt"
git -C "$RB" add -A
if git -C "$RB" diff --cached --quiet; then say "results unchanged; nothing to commit"
else git -C "$RB" commit -q -m "playtest results $NAME: $FIX @ ${FIX_SHA:0:12}, repeats $REPEATS, replay exit $RS_RC" && say "committed $(git -C "$RB" rev-parse --short HEAD)"; fi
push() { git -C "$RB" push -q origin playtest-results 2>>"$LOG" || { git -C "$RB" fetch -q --no-tags origin "+refs/heads/playtest-results:refs/remotes/origin/playtest-results" 2>>"$LOG" && git -C "$RB" rebase -q origin/playtest-results 2>>"$LOG"; return 1; }; }
step push retry push || { say "push failed after retries; results are committed locally in $RB"; exit 4; }

say "SCORECARD: results/$NAME/SCORECARD.md on branch playtest-results ($( [ -f "$OUT/SCORECARD.md" ] && echo present || echo MISSING)); local $OUT/SCORECARD.md"
exit "$RS_RC"
