// Lane W1: fromSnapshot(..., {lazyIndex:true}) builds the solid-footprint index on first use; every read and every
// later write sees the same index an eager load gives.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WorldModel, applyBatch, coreLibrary } from './index.ts';

function world(file: string) {
  const g = JSON.parse(readFileSync(new URL(`../../../worlds/templates/${file}`, import.meta.url), 'utf8'));
  const w = new WorldModel({ constants: g.constants, seed: 'lazy-index', state: g.state }); w.library = coreLibrary();
  let born = 1; for (const b of g.batches) { const r = applyBatch(w, { ops: b.ops }, 'god', born++).result; assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 300)); }
  return w;
}
const ids = (w: WorldModel) => [...w.entities.keys()].sort();
const view = (w: WorldModel) => ({ counts: [...w.solidRegionCounts()].sort(), fps: ids(w).map((id) => [id, w.footprintsOf(id)]) });

test('lazy index = eager index, on first read and after edits made before any read', () => {
  const src = world('hello-hamlet.json');
  // An enriched template may anchor any authored solid in a semantic part. Use
  // our own unreferenced solid so this index test does not delete an authored target.
  const placed = applyBatch(src, { ops: [{ op: 'place', def: 'core/chair@1', name: 'lazy-index-probe', p: [70, 0, -70] }] }, 'god', 98).result;
  assert.equal(placed.accepted, true, JSON.stringify(placed));
  const snap = src.snapshot();
  const lib = coreLibrary(), eager = WorldModel.fromSnapshot(snap, undefined, lib), lazy = WorldModel.fromSnapshot(snap, undefined, lib, { lazyIndex: true });
  assert.ok(view(eager).counts.length > 0, 'the template has solid things');
  assert.deepEqual(view(lazy), view(eager));
  // an edit before the first read: the lazy model indexes the current entities, then applies the edit's own index change
  const lazy2 = WorldModel.fromSnapshot(snap, undefined, lib, { lazyIndex: true }), eager2 = WorldModel.fromSnapshot(snap, undefined, lib);
  const victim = [...eager2.entities.values()].find(e => e.name === 'lazy-index-probe')!.id;
  assert.ok(eager2.footprintsOf(victim).length > 0, 'the edit removes an indexed solid');
  for (const w of [eager2, lazy2]) {
    const removed = applyBatch(w, { ops: [{ op: 'remove', id: victim }] }, 'god', 99).result;
    assert.equal(removed.accepted, true, JSON.stringify(removed));
    assert.equal(w.entities.has(victim), false);
    assert.deepEqual(w.footprintsOf(victim), [], 'removed solid leaves no stale index entry');
  }
  assert.deepEqual(view(lazy2), view(eager2));
  assert.deepEqual(view(lazy2.fork()), view(eager2.fork()));
});
