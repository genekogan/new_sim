#!/bin/bash
# The full test suite off the laptop, on a Modal CPU container (lane OPS2; doc: tools/test-harness/REMOTE-SUITE.md).
#   tools/test-harness/remote-suite.sh <outDir> [--ref HEAD] [--baseline-ref main|none] [--skip V7,V8] [--node 22]
# Ships `git archive <ref>` (committed tree only) plus the baseline ref, runs one-validation.sh remotely with V7 (real
# Chrome, needs a GPU) and V8 (laptop production histories) skipped by default, and unpacks the logs into
# <outDir>/out/suite (SUMMARY.tsv there). Needs `modal` installed and authenticated (`modal profile current`).
# Nothing runs on the laptop but git archive and the Modal client: no ports, no node test processes.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:?usage: remote-suite.sh <outDir> [--ref HEAD] [--baseline-ref main|none] [--skip V7,V8] [--node 22]}"; shift
REF=HEAD; BASE=main; SKIP=V7,V8; NODE=22
while [ $# -gt 0 ]; do case "$1" in --ref) REF="$2"; shift;; --baseline-ref) BASE="$2"; shift;; --skip) SKIP="$2"; shift;;
  --node) NODE="$2"; shift;; *) echo "unknown arg $1"; exit 2;; esac; shift; done
command -v modal >/dev/null || { echo "modal CLI not found: pip install modal && modal token new"; exit 2; }
[ -z "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ] || echo "note: uncommitted changes are NOT shipped (git archive $REF)"
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
git -C "$ROOT" archive --format=tar.gz -o "$STAGE/head.tgz" "$REF"
(cd "$ROOT" && node tools/test-harness/historical-inputs.mjs "$REF" "$STAGE/historical-inputs.pack")
{ echo "head $REF $(git -C "$ROOT" rev-parse "$REF")"; } > "$STAGE/REFS.txt"
if [ "$BASE" != none ]; then git -C "$ROOT" archive --format=tar.gz -o "$STAGE/base.tgz" "$BASE"; echo "baseline $BASE $(git -C "$ROOT" rev-parse "$BASE")" >> "$STAGE/REFS.txt"; fi
cat "$STAGE/REFS.txt"; mkdir -p "$OUT"; cp "$STAGE/REFS.txt" "$OUT/"
REMOTE_SUITE_SRC="$STAGE" REMOTE_SUITE_NODE="$NODE" modal run "$ROOT/tools/test-harness/modal_suite.py" --out "$OUT" --skip "$SKIP" 2>&1 | tee "$OUT/modal.log"
[ -f "$OUT/out/suite/SUMMARY.tsv" ] && column -t -s $'\t' "$OUT/out/suite/SUMMARY.tsv"
