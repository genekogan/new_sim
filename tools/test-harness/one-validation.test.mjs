import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const script = readFileSync(join(root, 'tools/test-harness/one-validation.sh'), 'utf8');
const all = 'V1,V2,V3,V4,V5,V6,V7,V8';
const quote = s => `'${s.replaceAll("'", "'\\''")}'`;
function run({ env = {}, args = [] } = {}) {
  mkdirSync(join(root, '.local'), { recursive: true });
  const dir = mkdtempSync(join(root, '.local/validation-shell-'));
  try {
    const tree = join(dir, 'fixture tree'), bin = join(dir, 'bin'), out = join(dir, 'output'), calls = join(dir, 'calls.jsonl');
    mkdirSync(join(tree, 'tools/test-harness'), { recursive: true }); mkdirSync(bin);
    writeFileSync(join(tree, 'tools/test-harness/one-validation.sh'), script);
    // Run the actual shell control flow, but never execute any heavy command, inspect ports or use real Git state.
    const stub = join(dir, 'stub.cjs');
    writeFileSync(stub, `const fs = require('node:fs'), path = require('node:path');
const [command, ...args] = process.argv.slice(2);
if (command === 'perl') fs.appendFileSync(process.env.VALIDATION_STUB_CALLS, JSON.stringify({command:args[3], args:args.slice(4)})+'\\n');
else if (command === 'git' && args[0] === 'rev-parse') console.log('fixture');
else if (command === 'column') process.stdout.write(fs.readFileSync(args.at(-1)));
`);
    for (const command of ['perl', 'git', 'lsof', 'column', 'node', 'pnpm']) {
      writeFileSync(join(bin, command), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(stub)} ${quote(command)} "$@"\n`, { mode: 0o755 });
    }
    const cleanEnv = { ...process.env };
    for (const key of ['BASELINE', 'DESCRIPTORS', 'SUITE_BASELINE', 'SUITE_DESCRIPTORS', 'SUITE_ONLY', 'SERVER_TEST_FILES', 'V5_SHARD', 'NODE_OPTIONS']) delete cleanEnv[key];
    const result = spawnSync('bash', [join(tree, 'tools/test-harness/one-validation.sh'), out, ...args], {
      cwd: tree, env: { ...cleanEnv, PATH: `${bin}:${process.env.PATH}`, CAMPUS_ASSETS_DIR: join(dir, 'absent-campus'), VALIDATION_STUB_CALLS: calls, ...env },
      encoding: 'utf8', timeout: 15000,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.doesNotMatch(result.stderr, /unbound variable|No such file|syntax error/);
    assert.match(result.stdout, /== SUMMARY/);
    assert.equal(existsSync(join(tree, 'injected')), false, 'path values must never be evaluated as shell commands');
    return {
      summary: readFileSync(join(out, 'SUMMARY.tsv'), 'utf8').trim().split('\n').slice(1).map(row => row.split('\t')),
      calls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse) : [],
    };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('all-skipped shell reaches summary with unset optional paths, including baseline=none', () => {
  for (const args of [['--skip', all], ['--baseline', 'none', '--skip', all]]) {
    const r = run({ args });
    assert.ok(r.summary.length > 10);
    assert.ok(r.summary.every(([, status]) => status === 'SKIP'));
    assert.deepEqual(r.summary.find(([id]) => id === 'V8-history-boot')?.slice(0, 3), ['V8-history-boot', 'SKIP', '0']);
    assert.equal(r.calls.length, 0);
    assert.equal(r.summary.some(([id]) => id === 'V4-web-baseline'), !args.includes('none'));
  }
});

test('non-V8 shard retains build preparation and excludes history boot', () => {
  const r = run({ env: { SUITE_ONLY: 'V3-harness' }, args: ['--baseline', 'none', '--skip', 'V7,V8'] });
  assert.deepEqual(r.summary.map(row => row.slice(0, 2)), [['V3-harness', '0']]);
  assert.equal(r.calls.length, 3, 'two preparation builds and the selected step');
  assert.ok(r.calls.some(c => c.args.some(a => a.includes('*.test.mjs'))));
  assert.ok(r.calls.every(c => !c.args.includes('tools/test-harness/history-boot-compare.mjs')));
});

test('selected history step receives literal defaults and configurable paths; CLI baseline wins', () => {
  for (const settings of [
    { env: {}, args: [], baseline: '<worktrees>/reconcile-main-e8', descriptors: '<team>/pm-integration/auth-account-20261009/runtime-modern-context-prep-001' },
    { env: { SUITE_BASELINE: '/fixture/base with spaces', SUITE_DESCRIPTORS: '/fixture/<history> $(touch injected)' }, args: [], baseline: '/fixture/base with spaces', descriptors: '/fixture/<history> $(touch injected)' },
    { env: { SUITE_BASELINE: '/fixture/ignored base', SUITE_DESCRIPTORS: '/fixture/history with spaces' }, args: ['--baseline', '/fixture/CLI <base> $(touch injected)'], baseline: '/fixture/CLI <base> $(touch injected)', descriptors: '/fixture/history with spaces' },
  ]) {
    const r = run({ env: { SUITE_ONLY: 'V8-history-boot', ...settings.env }, args: ['--skip', 'V7', ...settings.args] });
    assert.deepEqual(r.summary.map(row => row.slice(0, 2)), [['V8-history-boot', '0']]);
    const c = r.calls.find(c => c.args[0] === 'tools/test-harness/history-boot-compare.mjs');
    assert.ok(c); assert.equal(basename(c.command), 'node');
    assert.equal(c.args[c.args.indexOf('--baseline') + 1], settings.baseline);
    assert.equal(c.args[c.args.indexOf('--descriptors') + 1], settings.descriptors);
  }
});
