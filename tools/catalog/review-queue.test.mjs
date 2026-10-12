import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateReviewQueue } from './review-queue.mjs';

function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'catalog-review-proof-'));
  const entry = { id: 'eden/test', major: 1, rev: 'b'.repeat(64), def1Hash: 'a'.repeat(64), itemHash: 'c'.repeat(64) };
  const item = { ...entry, aliases: ['core/test@1'], text: { title: 'Test', first: 'Test item' },
    provenance: { tool: 'catalog build' }, tests: { gates: { G4: { ok: true } } }, budgets: { tris: { lod0: 8 }, draws: 1, materials: 1, bytes: { assets: 0 } } };
  const def = { params: { variant: { type: 'enum', default: 'red', values: ['red', 'blue'] } } }, engine = { state: { on: { default: false } } };
  const registry = { current: () => [entry], item: () => item, def: () => def, def1: () => engine };
  const views = ['default', 'variant=blue', 'on=true'].flatMap((label) => ['front-left', 'front-right', 'back', 'above'].map((view, i) => {
    const file = `${label}-${view}.png`; writeFileSync(join(root, file), 'fixture pixels'); return { label, view, file };
  }));
  const report = { gpu: 'ANGLE NVIDIA L4 Vulkan', items: [{ id: 'core/test@1', defHash: entry.def1Hash, ok: true, views }] };
  const generate = () => generateReviewQueue(registry, report, join(root, 'report.json'), join(root, 'out'), [{ entry, item }]);
  try { fn({ root, entry, item, def, engine, registry, report, generate }); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('new candidate refuses wrong hash, absent views, software, targeted or unqualified proof', () => fixture(({ report, generate }) => {
  const render = report.items[0], hash = render.defHash, views = render.views;
  render.defHash = 'd'.repeat(64); assert.throws(generate, /missing exact-hash/); render.defHash = hash;
  render.views = []; assert.throws(generate, /missing required views/); render.views = views;
  report.gpu = 'SwiftShader'; assert.throws(generate, /hardware renderer/); report.gpu = 'NVIDIA';
  report.selection = { targeted: true }; assert.throws(generate, /targeted diagnostics/); delete report.selection;
  render.status = 'unqualified'; assert.throws(generate, /remains unqualified/);
}));

test('exact hardware receipt emits compact review and requires variants plus state views', () => fixture(({ root, report, generate }) => {
  const result = generate();
  assert.equal(result.rows[0].held, false); assert.equal(result.rows[0].images.length, 12);
  assert.match(readFileSync(result.out, 'utf8'), /Exact-hash hardware proof complete/);
  report.items[0].views = report.items[0].views.filter((v) => v.label !== 'on=true');
  assert.throws(generate, /on=true\/front-left/);
  const queue = JSON.parse(readFileSync(join(root, 'out', 'queue.json'), 'utf8'));
  assert.equal(queue.candidates[0].itemHash, 'c'.repeat(64));
}));

test('grandfathered missing or unqualified proof remains explicitly held with no OK export', () => fixture(({ item, report, registry, root, generate }) => {
  item.provenance.tool = 'catalog import-core'; report.items = [];
  const result = generate();
  assert.equal(result.rows[0].held, true); assert.equal(result.rows[0].images.length, 0);
  assert.match(result.rows[0].proofStatus, /Grandfathered seed.*held/);
  assert.match(result.rows[0].reasons.join(';'), /missing exact-hash/);
  const html = readFileSync(result.out, 'utf8');
  assert.match(html, /value==='ok'&&row.held/);
  assert.match(html, /i.row.held&&i.select.value==='ok'/);
  report.items = [{ id: 'core/test@1', defHash: 'a'.repeat(64), ok: false, status: 'unqualified', views: [], errors: ['body fixture missing'] }];
  const diagnostic = generateReviewQueue(registry, report, join(root, 'report.json'), join(root, 'seed-out'), []);
  assert.equal(diagnostic.rows.length, 1); assert.equal(diagnostic.rows[0].held, true);
  assert.match(diagnostic.rows[0].reasons.join(';'), /body fixture missing/);
}));
