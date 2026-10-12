#!/usr/bin/env bash
# Commit-only source plus explicitly prepared nonsecret registry/review and required static assets.
set -euo pipefail
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
OUT="${1:?absolute output tar.gz required}"
PREPARED="${2:?prepared registry directory required}"
case "$OUT" in /*) ;; *) exit 2;; esac
[ ! -e "$OUT" ] || { echo 'use a fresh output path'; exit 2; }
[ -z "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ] || { echo 'commit source first'; exit 2; }
TMP="$(mktemp -d /tmp/sim-catalog-proof.XXXXXX)"
git -C "$ROOT" archive HEAD | tar -x -C "$TMP"
mkdir -p "$TMP/.lane"
rsync -a "$PREPARED/registry/" "$TMP/.lane/registry/"
rsync -a "$PREPARED/review/" "$TMP/.lane/review/"
rsync -aL "$ROOT/.lane/mars-web/" "$TMP/.lane/mars-web/"
tar -czf "$OUT" -C "$TMP" .
echo "$OUT"
# The temporary source is intentionally retained until proof completion; no live directories are modified.
echo "temporary proof source: $TMP"
