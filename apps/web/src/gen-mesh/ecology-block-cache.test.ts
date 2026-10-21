// The blocked-ground index a scatter avoids is built once per world state, not once per scatter (Eden 2026: ~240
// woodlands each rebuilt it over ~3,800 entities, first frame 25 s -> 6 s), and it still sees every edit.
//   node --test apps/web/src/gen-mesh/ecology-block-cache.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_KIT, WorldModel, applyBatch, type DefInput } from '@sim/world-compiler';
import terrainKit from '../../../../packages/world-compiler/src/core-kit/terrain.json' with { type: 'json' };
import { blockedBy } from './ecology.mesh.ts';

function world() {
  const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: 'block' });
  const have = new Set(CORE_KIT.map((d) => d.name));
  for (const d of [...CORE_KIT, ...(terrainKit as unknown as DefInput[]).filter((d) => !have.has(d.name))]) w.defineDef(d, 'core', 0);
  return w;
}

test('scatters share one blocked-ground index per world state; an edit rebuilds it', () => {
  const w = world();
  const add = (ops: unknown[]) => { const r = applyBatch(w, { ops } as never, 'god', 0) as { result: { accepted: boolean } }; assert.equal(r.result.accepted, true, JSON.stringify(r.result)); };
  add([{ op: 'place', def: 'core/bench@1', name: 'bench', p: [10, 10] },
    { op: 'place', def: 'core/woodland@1', name: 'wood-a', shape: { area: [[0, 0], [40, 0], [40, 40], [0, 40]] } },
    { op: 'place', def: 'core/woodland@1', name: 'wood-b', shape: { area: [[0, 0], [40, 0], [40, 40], [0, 40]] } }]);
  let footprints = 0; const fp = w.footprint.bind(w); w.footprint = ((...a: Parameters<typeof fp>) => { footprints++; return fp(...a); }) as typeof w.footprint;
  const a = blockedBy(w, w.get('wood-a')!), first = footprints, b = blockedBy(w, w.get('wood-b')!);
  assert.ok(first > 0, 'the first scatter builds the index');
  assert.equal(footprints, first, 'the second scatter reuses it');
  assert.equal(a(9.3, 10), true, 'a bench leg (+0.6 m pad) blocks'); assert.equal(b(9.3, 10), true); assert.equal(a(29.3, 30), false);
  add([{ op: 'place', def: 'core/bench@1', name: 'bench-2', p: [30, 30] }]);
  assert.equal(blockedBy(w, w.get('wood-a')!)(29.3, 30), true, 'a new solid is seen after the edit');
});

test('the desert-scrub worker scatter (cloned block cells + blockTest) equals the viewer-thread scatter', async () => {
  const { scrubPoints } = await import('@sim/generators');
  const { blockCellsOf, BLOCK_CELL } = await import('./ecology.mesh.ts');
  const { blockTest } = await import('./block-test.ts');
  const w = world();
  const ops = [{ op: 'place', def: 'core/bench@1', name: 'bench', p: [10, 10] }, { op: 'place', def: 'core/bench@1', name: 'bench-2', p: [-40, 25] },
    { op: 'place', def: 'core/woodland@1', name: 'wood', shape: { area: [[-60, -60], [60, -60], [60, 60], [-60, 60]] } }];
  const r = applyBatch(w, { ops } as never, 'god', 0) as { result: { accepted: boolean } }; assert.equal(r.result.accepted, true);
  const e = w.get('wood')!, area: [number, number][] = [[-80, -70], [90, -60], [70, 80], [-75, 60]], params = { density: 0.02, grass: 3 } as never;
  const here = scrubPoints(area, params, 4, blockedBy(w, e));
  const there = scrubPoints(area, params, 4, blockTest(structuredClone(blockCellsOf(w)), BLOCK_CELL, e.id));   // what postMessage delivers
  assert.ok(here.length > 50, `${here.length}`);
  assert.deepEqual(there, here);
});

// P7: a scatter builds the index only around itself (the phone's near-first build pays for nearby things only); its test
// answers exactly as the whole-world index does inside its area
test('a scatter adds only the things that can reach its area, and blocks as the whole index does there', async () => {
  const { blockCellsOf, BLOCK_CELL, BLOCK_REACH } = await import('./ecology.mesh.ts');
  const { blockTest } = await import('./block-test.ts');
  const ops = [{ op: 'place', def: 'core/bench@1', name: 'near', p: [12, 8] }, { op: 'place', def: 'core/bench@1', name: 'edge', p: [-3, 20] },
    { op: 'place', def: 'core/bench@1', name: 'far', p: [400, 400] }, { op: 'place', def: 'core/bench@1', name: 'far-2', p: [-420, 300] },
    { op: 'place', def: 'core/woodland@1', name: 'wood', shape: { area: [[0, 0], [30, 0], [30, 30], [0, 30]] } }];
  const a = world(), b = world();
  for (const w of [a, b]) { const r = applyBatch(w, { ops } as never, 'god', 0) as { result: { accepted: boolean } }; assert.equal(r.result.accepted, true); }
  const seen: string[] = []; const fp = a.footprint.bind(a); a.footprint = ((e: { name?: string }, ...r: unknown[]) => { seen.push(e.name ?? ''); return (fp as (...x: unknown[]) => never)(e, ...r); }) as typeof a.footprint;
  const regional = blockedBy(a, a.get('wood')!), whole = blockTest(blockCellsOf(b), BLOCK_CELL, b.get('wood')!.id);
  assert.ok(seen.includes('near') && seen.includes('edge') && !seen.includes('far') && !seen.includes('far-2'), seen.join());
  assert.ok(BLOCK_REACH >= 64);
  for (let x = -2; x <= 32; x += 0.25) for (let z = -2; z <= 32; z += 0.25) assert.equal(regional(x, z), whole(x, z), `${x},${z}`);
});

// t4-phone: a building reaches about its own size (twice its diagonal + 12 m), a kit thing three times its declared box
// + 8 m, not BLOCK_REACH, so a phone's first trees in
// a town bake no footprints of the houses well beyond them; one that does reach the scatter (a big hall) still blocks
test('a building or kit thing is added only within its own reach of a scatter, and blocks as the whole index does', async () => {
  const { blockCellsOf, BLOCK_CELL } = await import('./ecology.mesh.ts');
  const { blockTest } = await import('./block-test.ts');
  const ops = [{ op: 'place', def: 'core/house@1', name: 'next-door', p: [32, 12], params: { w: 9, d: 8 } },
    { op: 'place', def: 'core/house@1', name: 'down-the-road', p: [100, 12], params: { w: 9, d: 8 } },
    { op: 'place', def: 'core/house@1', name: 'hall', p: [-60, 15], params: { w: 30, d: 24 } },
    { op: 'place', def: 'core/bench@1', name: 'bench-by', p: [31, 20] }, { op: 'place', def: 'core/bench@1', name: 'bench-over', p: [55, 20] },
    { op: 'place', def: 'core/woodland@1', name: 'wood', shape: { area: [[0, 0], [30, 0], [30, 30], [0, 30]] } }];
  const a = world(), b = world();
  for (const w of [a, b]) { const r = applyBatch(w, { ops } as never, 'god', 0) as { result: { accepted: boolean } }; assert.equal(r.result.accepted, true, JSON.stringify(r.result)); }
  const seen: string[] = []; const fp = a.footprint.bind(a); a.footprint = ((e: { name?: string }, ...r: unknown[]) => { seen.push(e.name ?? ''); return (fp as (...x: unknown[]) => never)(e, ...r); }) as never;
  const regional = blockedBy(a, a.get('wood')!), whole = blockTest(blockCellsOf(b), BLOCK_CELL, b.get('wood')!.id);
  assert.ok(seen.includes('next-door') && seen.includes('hall') && seen.includes('bench-by') && !seen.includes('down-the-road') && !seen.includes('bench-over'), seen.join());
  for (let x = -2; x <= 32; x += 0.25) for (let z = -2; z <= 32; z += 0.25) assert.equal(regional(x, z), whole(x, z), `${x},${z}`);
});

// t4-phone: furniture in a house's rooms is inside the floor plan the house blocks whole: no pose or bake of its own, and the
// index blocks exactly the same ground
test('things in a building room add no blocks of their own; the building still blocks them', async () => {
  const { blockCellsOf, BLOCK_CELL } = await import('./ecology.mesh.ts');
  const { blockTest } = await import('./block-test.ts');
  const ops = [{ op: 'place', def: 'core/house@1', name: 'house', p: [15, 15], params: { w: 9, d: 8, style: 'cottage' } },
    { op: 'place', def: 'core/woodland@1', name: 'wood', shape: { area: [[0, 0], [30, 0], [30, 30], [0, 30]] } }];
  const w = world(); const r = applyBatch(w, { ops } as never, 'god', 0) as { result: { accepted: boolean } }; assert.equal(r.result.accepted, true, JSON.stringify(r.result));
  const house = w.get('house')!, room = w.slotsOf(house).find((s) => s.kind === 'room');
  assert.ok(room, 'the cottage has rooms');
  const r2 = applyBatch(w, { ops: [{ op: 'place', def: 'core/chair@1', name: 'chair', in: { parent: house.id, slot: room.id } }] } as never, 'god', 0) as { result: { accepted: boolean } };
  assert.equal(r2.result.accepted, true, JSON.stringify(r2.result));
  const seen: string[] = []; const fp = w.footprint.bind(w); w.footprint = ((e: { name?: string }, ...x: unknown[]) => { seen.push(e.name ?? ''); return (fp as (...y: unknown[]) => never)(e, ...x); }) as never;
  const test = blockTest(blockCellsOf(w), BLOCK_CELL, w.get('wood')!.id);
  assert.ok(seen.includes('house') && !seen.includes('chair'), seen.join());
  assert.equal(test(15, 15), true);
});
