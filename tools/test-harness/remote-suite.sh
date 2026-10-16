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
REF=HEAD; BASE=main; SKIP=V7,V8; NODE=22; SERVER_FILES=""; HARNESS=HEAD
while [ $# -gt 0 ]; do case "$1" in --ref) REF="$2"; shift;; --baseline-ref) BASE="$2"; shift;; --skip) SKIP="$2"; shift;;
  --node) NODE="$2"; shift;; --server-files) SERVER_FILES="$2"; shift;; --harness-ref) HARNESS="$2"; shift;; *) echo "unknown arg $1"; exit 2;; esac; shift; done
command -v modal >/dev/null || { echo "modal CLI not found: pip install modal && modal token new"; exit 2; }
[ -z "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ] || echo "note: uncommitted changes are NOT shipped (git archive $REF)"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
STAGE="$(mktemp -d "$OUT/.stage.XXXXXX")"; trap 'rm -rf "$STAGE"' EXIT
REF="$(git -C "$ROOT" rev-parse --verify "$REF^{commit}")"
HARNESS="$(git -C "$ROOT" rev-parse --verify "$HARNESS^{commit}")"
[ "$BASE" = none ] || BASE="$(git -C "$ROOT" rev-parse --verify "$BASE^{commit}")"
git -C "$ROOT" archive --format=tar.gz -o "$STAGE/head.tgz" "$REF"
git -C "$ROOT" archive --format=tar.gz -o "$STAGE/harness.tgz" "$HARNESS" tools/test-harness
(cd "$ROOT" && node tools/test-harness/historical-inputs.mjs "$REF" "$STAGE/historical-inputs.pack")
{ echo "head $REF $(git -C "$ROOT" rev-parse "$REF")"; } > "$STAGE/REFS.txt"
if [ "$BASE" != none ]; then git -C "$ROOT" archive --format=tar.gz -o "$STAGE/base.tgz" "$BASE"; echo "baseline $BASE $(git -C "$ROOT" rev-parse "$BASE")" >> "$STAGE/REFS.txt"; fi
node --input-type=module - "$STAGE" "$REF" "$BASE" "$HARNESS" "$(git -C "$ROOT" rev-parse "$HARNESS:tools/test-harness")" "$NODE" "$SKIP" "$SERVER_FILES" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [stage,sourceSha,base,harnessRef,harnessTree,node,skip,files] = process.argv.slice(2);
const hash = p => createHash('sha256').update(readFileSync(`${stage}/${p}`)).digest('hex');
writeFileSync(`${stage}/RUN-METADATA.json`, JSON.stringify({schemaVersion:1,sourceSha,baselineSha:base==='none'?null:base,harnessRef,harnessTree,harnessArchiveSha256:hash('harness.tgz'),sourceArchiveSha256:hash('head.tgz'),node,skip:skip.split(',').filter(Boolean),serverFiles:files.split(/\s+/).filter(Boolean),suiteCompleted:false}, null, 2)+'\n');
JS
cat "$STAGE/REFS.txt"; mkdir -p "$OUT"; cp "$STAGE/REFS.txt" "$OUT/"
git -C "$ROOT" show "$HARNESS:tools/test-harness/modal_suite.py" > "$STAGE/modal_suite.py"
REMOTE_SUITE_SRC="$STAGE" REMOTE_SUITE_NODE="$NODE" modal run "$STAGE/modal_suite.py" --out "$OUT" --skip "$SKIP" --server-files "$SERVER_FILES" 2>&1 | tee "$OUT/modal.log"
[ -f "$OUT/out/suite/SUMMARY.tsv" ] && column -t -s $'\t' "$OUT/out/suite/SUMMARY.tsv"
