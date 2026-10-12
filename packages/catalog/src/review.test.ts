import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coreLibrary, hashOf } from '@sim/world-compiler';
import { Registry } from './registry.ts';
import { makeItem, writeCore } from './import-core.ts';
import { loadContract } from './contract.ts';
import { applyReviews, promoteChecked, reviewQueue } from './review.ts';

test('review is immutable metadata, stale decisions fail, fix holds promotion and a reviewed green item can promote', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-review-'));
  try {
    const reg = new Registry(dir), at = new Date().toISOString();
    const def = coreLibrary().get('core-bench@1')!, built = await makeItem(def, { at, run: 'review', author: 'test', contract: loadContract() });
    writeCore(reg, [{ ...built, def }], 'seed');
    const item = { ...built.item, status: 'candidate' as const, tests: { ...built.item.tests, gates: { ...built.item.tests.gates } } };
    for (const gate of ['G1', 'G2', 'G3', 'G4', 'G5'] as const) item.tests.gates[gate] = { ok: true, at, report: 'test fixture' };
    reg.putItem(item);
    const entry = { ...reg.resolve(`${item.id}@1`)!, itemHash: hashOf(item), status: 'candidate' as const };
    reg.publish('candidate', [entry], 'candidate');
    const decision = { id: item.id, major: item.major, rev: item.rev, itemHash: entry.itemHash, verdict: 'fix' as const, note: 'Improve the ends.' };
    assert.equal(reviewQueue(reg).length, 1);
    assert.throws(() => promoteChecked(reg, [item.id], 'too-soon'), /candidate.young/);
    applyReviews(reg, [decision], 'test:gene', 'review-fix');
    assert.throws(() => promoteChecked(reg, [item.id], 'held'), /review.hold/);
    assert.throws(() => applyReviews(reg, [{ ...decision, verdict: 'ok' }], 'test:gene', 'stale'), /review.stale/);
    const current = reg.resolve(`${item.id}@1`, 'candidate')!;
    assert.equal(current.rev, item.rev); assert.equal(current.def1Hash, item.def1Hash);
    applyReviews(reg, [{ ...decision, itemHash: current.itemHash, verdict: 'ok' }], 'test:gene', 'review-ok');
    promoteChecked(reg, [item.id], 'reviewed');
    assert.equal(reg.resolve(`${item.id}@1`)!.rev, item.rev);
    assert.equal(reviewQueue(reg).length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('48-hour candidates still require a green nightly regression, and failed per-item gates cannot be reviewed away', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-review-gates-'));
  try {
    const reg = new Registry(dir), at = '2026-10-10T00:00:00.000Z';
    const def = coreLibrary().get('core-bench@1')!, built = await makeItem(def, { at, run: 'review', author: 'test', contract: loadContract() });
    writeCore(reg, [{ ...built, def }], 'seed');
    const item = { ...built.item, status: 'candidate' as const, tests: { ...built.item.tests, gates: { ...built.item.tests.gates } } };
    for (const gate of ['G1', 'G2', 'G3', 'G4', 'G5'] as const) item.tests.gates[gate] = { ok: true, at, report: 'test fixture' };
    reg.putItem(item); const entry = { ...reg.resolve(`${item.id}@1`)!, itemHash: hashOf(item), status: 'candidate' as const };
    reg.publish('candidate', [entry], 'candidate');
    assert.throws(() => promoteChecked(reg, [item.id], 'no-g7', Date.parse('2026-10-12T01:00:00Z')), /catalog.G7/);
    const failed = { ...item, review: { by: 'test:gene', verdict: 'ok' as const, at }, tests: { ...item.tests, gates: { ...item.tests.gates, G3: { ok: false, at, report: 'blocked' } } } };
    reg.putItem(failed); reg.publish('candidate', [{ ...entry, itemHash: hashOf(failed) }], 'failed');
    assert.throws(() => promoteChecked(reg, [item.id], 'no-bypass'), /catalog.gates/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
