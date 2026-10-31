#!/usr/bin/env node
// Installs the repo's pre-commit hook (.github/hooks/pre-commit) into this clone; run by `pnpm install` (prepare).
//
// It writes a small shim into the clone's hooks directory that runs the tracked hook, so the hook stays reviewed
// in the repo and updates with it. Never clobbers: when `core.hooksPath` is set (a personal or global hooks
// directory) or another pre-commit hook exists, it leaves them alone and prints how to chain ours. Does nothing in CI
// or outside a git checkout.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARK = '# sim-hooks: installed by .github/scripts/install-hooks.mjs';
export const SHIM = `#!/bin/sh
${MARK}
hook="$(git rev-parse --show-toplevel)/.github/hooks/pre-commit"
if [ -f "$hook" ]; then exec sh "$hook" "$@"; fi
exit 0
`;

/** What to do, given the environment: { action: 'skip' | 'install' | 'up-to-date' | 'leave', reason }. */
export function plan({ ci, hooksPath, existing }) {
  if (ci) return { action: 'skip', reason: 'CI' };
  if (hooksPath) return { action: 'leave', reason: `core.hooksPath is set (${hooksPath}); add \`sh "$(git rev-parse --show-toplevel)/.github/hooks/pre-commit"\` to your pre-commit hook there to run this repo's checks` };
  if (existing == null) return { action: 'install', reason: 'no pre-commit hook yet' };
  if (existing === SHIM) return { action: 'up-to-date', reason: 'already installed' };
  if (existing.includes(MARK)) return { action: 'install', reason: 'updating the shim' };
  return { action: 'leave', reason: 'a different pre-commit hook exists; add `sh .github/hooks/pre-commit` to it to run this repo\'s checks' };
}

function main() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  let hooksDir;
  try { hooksDir = resolve(root, git('rev-parse', '--git-path', 'hooks')); } catch { return 0; } // not a git checkout
  let hooksPath = '';
  try { hooksPath = git('config', '--get', 'core.hooksPath'); } catch { /* unset */ }
  const file = join(hooksDir, 'pre-commit');
  const p = plan({ ci: Boolean(process.env.CI), hooksPath, existing: existsSync(file) ? readFileSync(file, 'utf8') : null });
  if (p.action === 'install') {
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(file, SHIM);
    chmodSync(file, 0o755);
    console.log('pre-commit hook installed (gitleaks if present + .github/scripts/guards.mjs staged)');
  } else if (p.action === 'leave') console.log(`pre-commit hook not installed: ${p.reason}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
