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
STAGE="$(mktemp -d "$OUT/.stage.XXXXXX")"
# Preserve gate inputs on success and failure; never delete the local archive stage.
retain_stage() {
  local original_exit=$? destination=""
  if [ -d "$STAGE" ]; then
    if mkdir -p "$HOME/.Trash" && destination="$(mktemp -d "$HOME/.Trash/sim-gate-stage.XXXXXX")" && mv "$STAGE" "$destination/"; then
      printf 'retained local gate stage in %s\n' "$destination" >&2
    else
      printf 'local gate stage retention move failed; retained paths: %s %s\n' "$STAGE" "$destination" >&2
    fi
  fi
  return "$original_exit"
}
trap retain_stage EXIT
REF="$(git -C "$ROOT" rev-parse --verify "$REF^{commit}")"
HARNESS="$(git -C "$ROOT" rev-parse --verify "$HARNESS^{commit}")"
[ "$BASE" = none ] || BASE="$(git -C "$ROOT" rev-parse --verify "$BASE^{commit}")"
git -C "$ROOT" archive --format=tar.gz -o "$STAGE/head.tgz" "$REF"
git -C "$ROOT" archive --format=tar.gz -o "$STAGE/harness.tgz" "$HARNESS" tools/test-harness
# Z3: the gitignored inputs of the full campus re-extraction (V3-mars-engine, CAMPUS_FULL=1), as the exact bytes the
# harness pins in campus-assets.json; one-validation.sh copies them into each tree. Missing or different bytes stop here.
if CAMPUS_PINS="$(git -C "$ROOT" show "$HARNESS:tools/test-harness/campus-assets.json" 2>/dev/null)"; then
  mkdir -p "$STAGE/campus"; printf '%s\n' "$CAMPUS_PINS" > "$STAGE/campus/campus-assets.json"
  node --input-type=module - "$STAGE/campus" <<'JS' || { echo "campus assets: missing or not the pinned bytes (tools/test-harness/campus-assets.json; CAMPUS_ASSETS_SRC overrides the source dir)"; exit 2; }
import { createHash } from 'node:crypto'; import { constants, copyFileSync, readFileSync } from 'node:fs'; import { join } from 'node:path';
const dir = process.argv[2], pins = JSON.parse(readFileSync(join(dir, 'campus-assets.json'), 'utf8')), src = process.env.CAMPUS_ASSETS_SRC || pins.source;
for (const [name, f] of Object.entries(pins.files)) {
  copyFileSync(join(src, name), join(dir, name), constants.COPYFILE_FICLONE);
  const bytes = readFileSync(join(dir, name)), sha = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== f.bytes || sha !== f.sha256) throw Error(`${name}: ${bytes.length} bytes, sha256 ${sha}`);
}
JS
fi
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
