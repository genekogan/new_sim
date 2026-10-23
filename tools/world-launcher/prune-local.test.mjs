// Unit tests for deploy/prune-local.sh (lane D1): keep-last-N for laptop release builds. No ports.
import test from 'node:test'; import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, utimesSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path'; import { tmpdir } from 'node:os'; import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'deploy', 'prune-local.sh');
const run = (dir, ...args) => execFileSync('bash', [SCRIPT, dir, ...args], { encoding: 'utf8' });

// builds: [name, ageMinutes, buildFileContent?]
function fixture(builds) {
  const dir = mkdtempSync(join(tmpdir(), 'prune local '));
  const now = Date.now() / 1000;
  for (const [name, age, build = name] of builds) {
    const d = join(dir, name); mkdirSync(d);
    if (build !== null) writeFileSync(join(d, 'BUILD'), `${build}\n`);
    writeFileSync(join(dir, `${name}.deps.log`), 'log');
    utimesSync(d, now - age * 60, now - age * 60);
  }
  return dir;
}

test('keeps the 3 newest release ids with their -root twins and logs; prunes the rest', () => {
  const dir = fixture([
    ['we-aaaaaaaaaaaa', 1], ['we-aaaaaaaaaaaa-root', 0],
    ['we-bbbbbbbbbbbb', 10], ['we-bbbbbbbbbbbb-root', 11],
    ['we-cccccccccccc-root', 20],
    ['we-dddddddddddd', 30], ['we-dddddddddddd-root', 31],
    ['we-eeeeeeeeeeee', 40],
  ]);
  const out = run(dir);
  assert.match(out, /pruned local build we-dddddddddddd\b/);
  assert.deepEqual(readdirSync(dir).filter((n) => !n.endsWith('.log')).sort(), [
    'we-aaaaaaaaaaaa', 'we-aaaaaaaaaaaa-root', 'we-bbbbbbbbbbbb', 'we-bbbbbbbbbbbb-root', 'we-cccccccccccc-root',
  ]);
  assert.equal(existsSync(join(dir, 'we-dddddddddddd-root.deps.log')), false);
  assert.equal(existsSync(join(dir, 'we-aaaaaaaaaaaa.deps.log')), true);
});

test('never touches directories that are not launcher builds', () => {
  const dir = fixture([
    ['we-111111111111', 1], ['we-222222222222', 2], ['we-333333333333', 3],
    ['we-444444444444', 50, 'we-something-else'], ['we-555555555555', 60, null], ['receipts', 70],
  ]);
  run(dir);
  for (const n of ['we-444444444444', 'we-555555555555', 'receipts']) assert.equal(existsSync(join(dir, n)), true, n);
});

test('keep argument: 1 keeps one id, 0 keeps everything, junk is refused', () => {
  const dir = fixture([['we-111111111111', 1], ['we-222222222222', 2]]);
  run(dir, '0');
  assert.equal(readdirSync(dir).filter((n) => n.startsWith('we-') && !n.endsWith('.log')).length, 2);
  run(dir, '1');
  assert.equal(existsSync(join(dir, 'we-222222222222')), false);
  assert.equal(existsSync(join(dir, 'we-111111111111')), true);
  assert.throws(() => run(dir, 'x'));
  assert.equal(run(join(dir, 'missing')), '');
});

// Historical gate identity retained intentionally: Gene's 2026-10-23 no-delete rule
// reverses the old automatic-prune contract. This now proves retention, not pruning.
// Descriptive release-no-delete tests exercise the actual Trash/reuse behavior.
test('release.sh prunes the laptop builds after assembling', async () => {
  const { readFileSync } = await import('node:fs');
  const sh = readFileSync(join(dirname(SCRIPT), 'release.sh'), 'utf8');
  assert.doesNotMatch(sh, /prune-local\.sh|\brm\s+-|--delete/, 'release must not automatically prune or delete');
  assert.match(sh, /trash_existing "\$OUT"/);
  assert.ok(sh.indexOf('trash_existing "$OUT"') < sh.indexOf('echo "assembled'), 'prior artifact is retained before the --local exit');
});
