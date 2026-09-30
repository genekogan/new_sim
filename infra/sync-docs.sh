#!/usr/bin/env bash
# Refresh the documentation snapshots in this repo from their working homes on
# Gene's laptop: the eden4 strategy notes and the Mars engine's docs. Run from
# the repo root, review the diff, commit. Read-only on both sources.
set -euo pipefail
cd "$(dirname "$0")/.."
EDEN4="${EDEN4_DIR:-<eden4>}"
MARS="${MARS_DIR:-<mars-campus-repo>}"

mkdir -p docs/eden4/report docs/mars
cp "$EDEN4"/*.md docs/eden4/
[ -f "$EDEN4/report/eden4.html" ] && cp "$EDEN4/report/eden4.html" docs/eden4/report/

E="$MARS/docs/engineering"
for f in SIMULATION_FRONTIER SIMULATION_FRONTIER_APPLICATIONS SIMULATION_VISION ACTIVE_ROADMAP ENGINEERING ENGINE_GUIDE SPEC HANDOFF \
         TAKES_AND_PLANS CAMERA BODY_MODEL POSES MOVEMENT SOCIAL ITEMS CARRY VEHICLES PLANNING_BUDGET LAB_GUIDE LIB_EVAL OWNER_DECISIONS AUDIT RESEARCH; do
  [ -f "$E/$f.md" ] && cp "$E/$f.md" docs/mars/
done
cp "$MARS/README.md" docs/mars/MARS-README.md
cp "$MARS/ROADMAP.md" docs/mars/MARS-ROADMAP.md
cp "$MARS/viewer/simulation/README.md" docs/mars/SIMULATION-SERVER-README.md
cp "$MARS/viewer/app/lab/README.md" docs/mars/LAB-README.md
cp "$MARS/viewer/public/simulation-agent-guide.md" docs/mars/SIMULATION-AGENT-GUIDE.md

HEAD=$(git -C "$MARS" log -1 --format='%h %cd' --date=iso)
printf 'Mars docs copied from %s\nMars HEAD: %s\nCopied: %s\n' "$MARS" "$HEAD" "$(date -u +%Y-%m-%dT%H:%MZ)" > docs/mars/SNAPSHOT.txt
echo "synced. Mars HEAD: $HEAD"; git status --short docs | wc -l | xargs echo "changed files:"
