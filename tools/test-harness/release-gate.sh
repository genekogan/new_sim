#!/bin/bash
# Run the committed, pinned Modal release gate. Never executes suites locally.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec node "$ROOT/tools/test-harness/release-gate.mjs" "$@"
