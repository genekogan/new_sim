#!/usr/bin/env bash
# Pack the tracked tree G4 needs on a remote GPU (Modal) into one tarball: the server, the built web app, the packages,
# the core asset indexes and GLBs, the god-skill tools. Leaves out what G4 never loads (Mars viewer public assets and
# e2e fixtures, the LM world folders, docs). Usage: tools/catalog/g4/bundle.sh <out.tar.gz>   (run from the worktree)
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"; out="${1:?out.tar.gz}"; candidate="${2:-}"
cd "$root"
# Optional reviewed unpublished defs are staged at one known non-secret bundle path.
if [[ -n "$candidate" ]]; then
  node --input-type=module - "$candidate" <<'JS'
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
const file = realpathSync(resolve(process.argv[2])), root = realpathSync(process.cwd()), rel = relative(root, file);
if (rel.startsWith('..') || isAbsolute(rel) || !file.endsWith('.json')) throw new Error('candidate must be a reviewed JSON file inside this worktree');
const defs = JSON.parse(readFileSync(file, 'utf8'));
if (!Array.isArray(defs) || !defs.length || defs.some((d) => d.schema !== 'def/1')) throw new Error('candidate must contain a nonempty def/1 array');
mkdirSync('.lane/g4', { recursive: true }); writeFileSync('.lane/g4/candidate-defs.json', JSON.stringify(defs));
JS
fi
git ls-files -z | grep -zv -E '^(mars/viewer/public/|mars/viewer/e2e/|mars/docs/|worlds/littlemartians/assets/|docs/|tools/floaters/)' \
  | tar --null -czf "$out" -T - apps/web/dist ${candidate:+.lane/g4/candidate-defs.json}
ls -lh "$out" | awk '{print $5, $9}'
