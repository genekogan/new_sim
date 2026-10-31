import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MARK, SHIM, plan } from './install-hooks.mjs';

test('installs only into an empty slot or over its own shim', () => {
  assert.equal(plan({ ci: false, hooksPath: '', existing: null }).action, 'install');
  assert.equal(plan({ ci: false, hooksPath: '', existing: SHIM }).action, 'up-to-date');
  assert.equal(plan({ ci: false, hooksPath: '', existing: `#!/bin/sh\n${MARK}\nold\n` }).action, 'install');
});

test('never clobbers a personal hooks directory or a foreign hook, and skips CI', () => {
  const global = plan({ ci: false, hooksPath: '/somewhere/hooks', existing: null });
  assert.equal(global.action, 'leave');
  assert.match(global.reason, /\.github\/hooks\/pre-commit/);
  assert.equal(plan({ ci: false, hooksPath: '', existing: '#!/bin/sh\nlint-staged\n' }).action, 'leave');
  assert.equal(plan({ ci: true, hooksPath: '', existing: null }).action, 'skip');
});

test('the tracked hook runs gitleaks when present and the staged guards', () => {
  const hook = readFileSync(new URL('../hooks/pre-commit', import.meta.url), 'utf8');
  assert.match(hook, /gitleaks git --pre-commit --staged/);
  assert.match(hook, /guards\.mjs" staged/);
});
