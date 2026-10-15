#!/bin/bash
# All web unit tests, including TSX; browser walks are the separately owned GPU gate.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
files=()
while IFS= read -r file; do files+=("$file"); done < <(git ls-files apps/web/src apps/web/test | LC_ALL=C sort | sed -n '/\.test\.\(ts\|tsx\|mjs\|js\)$/p')
[ "${#files[@]}" -gt 0 ] || { echo 'no web unit test files'; exit 1; }
exec node --import="$ROOT/tools/test-harness/web-loader.mjs" --test --test-reporter=tap --test-concurrency=1 "${files[@]}"
