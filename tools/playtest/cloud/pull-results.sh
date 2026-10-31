#!/usr/bin/env bash
# Pull one cloud replay arm from the `playtest-results` branch into a local folder and (optionally) rescore it against
# a local baseline arm:  bash tools/playtest/cloud/pull-results.sh <arm> [dest-root=.local/playtest/replays/cloud] [baseline-arm]
# The arm lands at <dest-root>/<arm>; with a baseline arm, SCORECARD-vs-<baseline>.md is written beside its SCORECARD.md.
set -euo pipefail
ARM="${1:?usage: pull-results.sh <arm> [dest-root] [baseline-arm]}"
ROOT="${2:-.local/playtest/replays/cloud}"   # relative to the repo root (cd below)
BASE="${3:-}"
PT="$(git rev-parse --show-toplevel)"; cd "$PT"
git fetch -q --no-tags origin "+refs/heads/playtest-results:refs/remotes/origin/playtest-results"
git cat-file -e "origin/playtest-results:results/$ARM/replay-set.json" 2>/dev/null || { echo "no results/$ARM on playtest-results yet" >&2; exit 2; }
mkdir -p "$ROOT/$ARM"
git archive "origin/playtest-results" "results/$ARM" | tar -x -C "$ROOT" --strip-components=1
echo "pulled results/$ARM → $ROOT/$ARM ($(git rev-parse --short origin/playtest-results))"
if [ -n "$BASE" ]; then
  [ -f "$ROOT/$BASE/replay-set.json" ] || { echo "baseline arm $BASE not pulled yet ($ROOT/$BASE)" >&2; exit 3; }
  REP="$(node -p "require(process.argv[1]).repeats || 1" "$ROOT/$ARM/replay-set.json")"
  node tools/playtest/playtest.mjs replay-set --score-only --repeats "$REP" --out "$ROOT/$ARM" --baseline "$ROOT/$BASE" --frozen tools/playtest/frozen/frozen.json >/dev/null
  cp "$ROOT/$ARM/SCORECARD.md" "$ROOT/$ARM/SCORECARD-vs-$BASE.md"
  echo "scorecard vs $BASE → $ROOT/$ARM/SCORECARD-vs-$BASE.md"
fi
