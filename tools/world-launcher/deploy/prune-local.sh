#!/usr/bin/env bash
# Keep-last-N for laptop release builds (D1, 2026-10-20: 89 builds had filled 40 GB of the laptop).
#   tools/world-launcher/deploy/prune-local.sh <dir> [keep=3]
# In <dir>, keeps the <keep> newest release ids and removes the older release builds with their <build>.deps.log.
# A release build is a directory named we-<sha12> or we-<sha12>-root whose BUILD file holds exactly its own name (release.sh
# writes it); anything else in <dir> is never touched. A -root twin shares its id, so a release and its legacy build go
# together. keep=0 keeps everything. release.sh runs this after assembling into .lane/release/ or next to a --local <dir>.
set -euo pipefail
DIR="${1:?usage: $0 <dir> [keep]}"; KEEP="${2:-3}"
case "$KEEP" in ''|*[!0-9]*) echo "keep must be a whole number (got '$KEEP')"; exit 2;; esac
[ "$KEEP" -gt 0 ] && [ -d "$DIR" ] || exit 0
ids=" "; n=0
# newest first (directory mtime: release.sh recreates a build's directory every time it assembles it)
while IFS= read -r d; do
  name="${d##*/}"
  [ "$(cat "$d/BUILD" 2>/dev/null)" = "$name" ] || continue
  id="${name%-root}"
  case "$ids" in *" $id "*) continue;; esac
  if [ "$n" -lt "$KEEP" ]; then ids="$ids$id "; n=$((n + 1)); continue; fi
  rm -rf "$d" "$d.deps.log"; echo "   pruned local build $name"
done < <(ls -1dt "$DIR"/we-*/ 2>/dev/null | sed 's:/$::')
