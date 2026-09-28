// Gene's questions page: docs/engineering/questions/index.html is what QUESTIONS_FOR_GENE.md generates, and the
// release (deploy/prepare.py) stages it with every picture it shows under /questions/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Q = path.resolve(ROOT, '../docs/engineering/questions');

test('questions/index.html is up to date with QUESTIONS_FOR_GENE.md (node deploy/questions-html.mjs)', () => {
  execFileSync('node', ['deploy/questions-html.mjs', '--check'], { cwd: ROOT, stdio: 'pipe' });
});

test('prepare.py stages index.html and every file the page references, and stays small', () => {
  const staged = JSON.parse(execFileSync('python3', ['deploy/prepare.py', '--questions'], { cwd: ROOT, encoding: 'utf8' }));
  assert.equal(staged[0], 'index.html');
  const html = readFileSync(path.join(Q, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"#?]+)"/g)].map((m) => m[1]).filter((r) => !/^[a-z]+:|^\//.test(r));
  for (const r of refs) assert.ok(staged.includes(r), `${r} is shown on the page but not staged`);
  assert.ok(staged.every((r) => existsSync(path.join(Q, r))));
  assert.ok(!staged.some((r) => r.startsWith('tools/')), 'tools/ must not ship');
  const bytes = staged.reduce((n, r) => n + statSync(path.join(Q, r)).size, 0);
  assert.ok(bytes < 25 * 1024 * 1024, `questions page is ${(bytes / 1048576).toFixed(1)} MiB (limit 25)`);
});

test('the worker routes /questions/ to the staged page', () => {
  const src = readFileSync(path.join(ROOT, 'deploy/configure.mjs'), 'utf8');
  assert.match(src, /path==='\/questions\/'/);
  assert.match(src, /url\.pathname='\/questions\/index\.html'/);
});
