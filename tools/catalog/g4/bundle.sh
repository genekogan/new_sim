#!/usr/bin/env bash
# Pack the tracked tree G4 needs on a remote GPU (Modal) into one tarball: the server, the built web app, the packages,
# the core asset indexes and GLBs, the god-skill tools. Leaves out what G4 never loads (Mars viewer public assets and
# e2e fixtures, the LM world folders, docs). Usage: tools/catalog/g4/bundle.sh <out.tar.gz>   (run from the worktree)
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"; out="${1:?out.tar.gz}"
cd "$root"
git ls-files -z | grep -zv -E '^(mars/viewer/public/|mars/viewer/e2e/|mars/docs/|worlds/littlemartians|docs/|tools/floaters/)' \
  | tar --null -czf "$out" -T - apps/web/dist
ls -lh "$out" | awk '{print $5, $9}'
