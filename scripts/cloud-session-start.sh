#!/usr/bin/env bash
# SessionStart hook (.claude/settings.json) for Claude Code cloud sessions. Does nothing on a local machine.
#   - pnpm install --frozen-lockfile when the lockfile or package.json changed since the last install
#   - pnpm assets:pull when tools/assets/manifest.json changed since the last pull
#   - PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers for the session when that directory exists
# Output is kept to a few lines (it lands in the session's context); full logs go to $TMPDIR.
set -uo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = true ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" || exit 0

log="${TMPDIR:-/tmp}/sim-session-start.log"
state=node_modules/.cache/sim-session-start
fingerprint() { git ls-files -s -- "$@" 2>/dev/null | sha256sum | cut -c1-16; }
stamp() { cat "$state/$1" 2>/dev/null; }

if [ -d /opt/pw-browsers ]; then
  export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
  [ -n "${CLAUDE_ENV_FILE:-}" ] && echo "export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers" >> "$CLAUDE_ENV_FILE"
fi

deps=$(fingerprint pnpm-lock.yaml package.json '*/package.json' '*/*/package.json')
if [ ! -d node_modules ] || [ "$(stamp deps)" != "$deps" ]; then
  if pnpm install --frozen-lockfile >"$log" 2>&1; then
    mkdir -p "$state" && echo "$deps" > "$state/deps"; echo "session-start: dependencies installed"
  else
    echo "session-start: pnpm install --frozen-lockfile FAILED (log: $log)"; tail -5 "$log"
  fi
fi

media=$(fingerprint tools/assets/manifest.json)
if [ -f tools/assets/manifest.json ] && [ "$(stamp media)" != "$media" ]; then
  if timeout 480 pnpm assets:pull --quiet >>"$log" 2>&1; then
    mkdir -p "$state" && echo "$media" > "$state/media"; echo "session-start: media pulled"
  else
    echo "session-start: pnpm assets:pull failed or timed out (log: $log); media-dependent tests will fail until it succeeds"
  fi
fi
exit 0
