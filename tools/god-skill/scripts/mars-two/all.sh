#!/bin/sh
# Rebuild the Mars 2026 library pieces, register them as core assets, and write the mars-two template.
set -e
cd "$(dirname "$0")/../../../.."
node tools/god-skill/scripts/mars-two/build.mjs 2>&1 | grep -v "prune:\|quantize:\|simplify:"
node tools/god-skill/scripts/import-packs.mjs | head -1
node tools/god-skill/scripts/mars-two/template.mjs
