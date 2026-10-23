// Unit tests for budget.mjs on tiny synthetic dist trees (no build).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compare, main, measure, readBaseline, stableName, writeBaseline } from './budget.mjs';

// Incompressible-ish bytes so raw and gzip move together.
const blob = (n, seed = 1) => { const b = Buffer.alloc(n); let x = seed; for (let i = 0; i < n; i++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; b[i] = x >>> 24; } return b; };
function dist(files) {
  const d = mkdtempSync(join(tmpdir(), 'budget-dist-'));
  mkdirSync(join(d, 'assets'));
  for (const [f, n] of Object.entries(files)) writeFileSync(join(d, f), blob(n, f.length));
  return d;
}
const BASE = { 'assets/core-kit-DboE7x8I.js': 200_000, 'assets/main-yaEyrd2D.js': 120_000, 'assets/esm-4m95mIXy.js': 30_000, 'assets/esm-DGrw_Ymo.js': 30_000, 'assets/main-AbCdEf12.css': 8_000, 'assets/logo-Abcdefgh.png': 500_000, 'index.html': 2_000 };
const withEnv = fn => { const saved = [process.env.REMOTE_SUITE_CPU, process.env.SUITE_COVERAGE_DIR]; delete process.env.REMOTE_SUITE_CPU; delete process.env.SUITE_COVERAGE_DIR; try { return fn(); } finally { if (saved[0] !== undefined) process.env.REMOTE_SUITE_CPU = saved[0]; if (saved[1] !== undefined) process.env.SUITE_COVERAGE_DIR = saved[1]; } };

test('stableName strips only the trailing 8-char vite hash', () => {
  assert.equal(stableName('assets/core-kit-DboE7x8I.js'), 'assets/core-kit.js');
  assert.equal(stableName('assets/toViemAccount-moo9TJem-CCwsYjjg.js'), 'assets/toViemAccount-moo9TJem.js');
  assert.equal(stableName('assets/_esm-CEQFkwJm.js'), 'assets/_esm.js');
  assert.equal(stableName('early.js'), 'early.js');
});

test('measure keeps code files only and sums same-named chunks', () => {
  const m = measure(dist(BASE));
  assert.deepEqual(Object.keys(m.chunks), ['assets/core-kit.js', 'assets/esm.js', 'assets/main.css', 'assets/main.js']);
  assert.equal(m.chunks['assets/esm.js'].files, 2);
  assert.equal(m.chunks['assets/esm.js'].bytes, 60_000);
  assert.equal(m.total.bytes, 388_000);
  assert.ok(m.total.gzip > 0);
});

test('an unchanged build is clean, even when hashes change', () => {
  const base = measure(dist(BASE));
  const renamed = Object.fromEntries(Object.entries(BASE).map(([f, n]) => [f.replace(/-[A-Za-z0-9_-]{8}\./, '-ZZZZZZZZ.'), n]));
  const c = compare(base, measure(dist(renamed)));
  assert.equal(c.ok, true, JSON.stringify(c.offenders));
  assert.equal(c.added.length + c.removed.length, 0);
});

test('+10% on one chunk fails (raw and gzip), +9% passes', () => {
  const base = measure(dist(BASE));
  const fails = compare(base, measure(dist({ ...BASE, 'assets/main-yaEyrd2D.js': 132_000 })));
  assert.equal(fails.ok, false);
  assert.deepEqual([...new Set(fails.offenders.map(o => `${o.kind} ${o.key}`))], ['grew assets/main.js']);
  assert.ok(fails.offenders.some(o => o.metric === 'bytes' && o.pct >= 10 && o.pct < 10.01));
  assert.deepEqual(compare(base, measure(dist({ ...BASE, 'assets/main-yaEyrd2D.js': 133_000 }))).offenders.map(o => o.metric), ['bytes', 'gzip']);
  assert.equal(compare(base, measure(dist({ ...BASE, 'assets/main-yaEyrd2D.js': 130_800 }))).ok, true);
});

test('the total fails at +10% even when every chunk is within budget', () => {
  const base = measure(dist(BASE));
  const spread = Object.fromEntries(Object.entries(BASE).map(([f, n]) => [f, Math.round(n * 1.095)]));
  spread['assets/extra-Qwertyui.js'] = 3_000; // small new chunk: reported, not failed
  const c = compare(base, measure(dist(spread)));
  assert.deepEqual([...new Set(c.offenders.map(o => o.kind))], ['total']);
  assert.deepEqual(c.added.map(a => a.key), ['assets/extra.js']);
});

test('growth under the slack does not fail a small chunk; the threshold is configurable', () => {
  const base = measure(dist(BASE));
  const css = measure(dist({ ...BASE, 'assets/main-AbCdEf12.css': 9_600 })); // +20% but +1.6 KB
  assert.equal(compare(base, css).ok, true);
  assert.equal(compare(base, css, { slack: 0 }).ok, false);
  const plus6 = measure(dist({ ...BASE, 'assets/core-kit-DboE7x8I.js': 212_000 }));
  assert.equal(compare(base, plus6).ok, true);
  assert.equal(compare(base, plus6, { threshold: 5 }).ok, false);
});

test('a new chunk of 100 KB or more without a baseline entry fails; a removed chunk does not', () => {
  const base = measure(dist(BASE));
  const { 'assets/core-kit-DboE7x8I.js': _gone, ...rest } = BASE;
  const c = compare(base, measure(dist({ ...rest, 'assets/viem-Abcdefgh.js': 110_000 })));
  assert.deepEqual(c.offenders.map(o => `${o.kind} ${o.key}`), ['new assets/viem.js']);
  assert.deepEqual(c.removed.map(r => r.key), ['assets/core-kit.js']);
  assert.deepEqual(compare(base, measure(dist({ ...rest, 'assets/small-Abcdefgh.js': 90_000 }))).offenders, []);
});

test('--write round-trips through --check, and is refused inside a gate run', () => {
  const d = dist(BASE), file = join(mkdtempSync(join(tmpdir(), 'budget-bl-')), 'baseline.json'), out = [];
  withEnv(() => assert.equal(main(['--dist', d, '--baseline', file, '--write'], m => out.push(m)), 0));
  const b = readBaseline(file);
  assert.ok(b.note.join(' ').includes('reviewed commit'));
  assert.deepEqual(b.chunks, measure(d).chunks);
  assert.equal(main(['--dist', d, '--baseline', file, '--check'], m => out.push(m)), 0);
  const grown = dist({ ...BASE, 'assets/core-kit-DboE7x8I.js': 230_000 });
  const lines = [];
  assert.equal(main(['--dist', grown, '--baseline', file, '--check'], m => lines.push(m)), 1);
  assert.match(lines.join('\n'), /GREW +assets\/core-kit\.js +bytes +195\.3 KB -> 224\.6 KB \(\+15\.0%\)/);
  const before = readFileSync(file, 'utf8');
  const saved = process.env.REMOTE_SUITE_CPU; process.env.REMOTE_SUITE_CPU = '1';
  try { assert.throws(() => writeBaseline(measure(grown), file), /refusing --write inside a gate run/); }
  finally { if (saved === undefined) delete process.env.REMOTE_SUITE_CPU; else process.env.REMOTE_SUITE_CPU = saved; }
  assert.equal(readFileSync(file, 'utf8'), before);
});
