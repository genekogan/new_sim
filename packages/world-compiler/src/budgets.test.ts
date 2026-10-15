import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CREATION_LIMITS as L } from '@sim/generators';
import { WorldModel, applyBatch, type Entity, type Refused } from './index.ts';
const cube = { schema: 'def/1' as const, name: 'cube', size: { box: [0.1, 1, 0.1] as [number, number, number] }, overlaps: ['cube'], make: { kind: 'gen' as const, gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, 0.5, 0], size: [0.1, 1, 0.1] }] } } };
test('clone expansion cannot bypass the world entity limit', () => {
  const w = new WorldModel({ constants: { ground: 'land', limits: { entities: 1 } as never }, seed: 'budget' });
  w.defineDef(cube, 'god', 0);
  assert.equal(applyBatch(w, { ops: [{ op: 'place', def: 'cube@1', name: 'a' }] }, 'god', 0).result.accepted, true);
  const before = w.snapshot(), r = applyBatch(w, { ops: [{ op: 'clone', id: 'a', p: [3, 0], count: 2 }] }, 'god', 1).result as Refused;
  assert.equal(r.failures[0].code, 'budget.world'); assert.equal(r.failures[0].measured, 3); assert.equal(r.failures[0].limit, 1); assert.deepEqual(w.snapshot(), before);
});
test('region budget counts each solid entity once; non-solids do not count', () => {
  const w = new WorldModel({ constants: { ground: 'land' }, seed: 'region' }); w.defineDef(cube, 'god', 0);
  for (let i = 0; i < L.regionSolidEntities; i++) {
    const e: Entity = { id: `a${i}`, def: 'cube@1', in: { parent: 'world' }, p: [5, 0, 5], by: 'fixture', born: 0, v: 1 }; w.insert(e); w.index(e.id, w.footprint(e));
  }
  const r = applyBatch(w, { ops: [{ op: 'place', def: 'cube@1', p: [5, 5] }] }, 'god', 1).result as Refused;
  assert.equal(r.failures[0].code, 'budget.region'); assert.equal(r.failures[0].measured, L.regionSolidEntities + 1); assert.equal(r.failures[0].limit, L.regionSolidEntities);
  assert.equal(applyBatch(w, { ops: [{ op: 'place', def: 'cube@1', p: [40, 40] }] }, 'god', 1).result.accepted, true);
  w.defineDef({ ...cube, name: 'decor', layer: 'decor' }, 'god', 0);
  assert.equal(applyBatch(w, { ops: [{ op: 'place', def: 'decor@1', p: [5, 5] }] }, 'god', 1).result.accepted, true);
});
test('retained definition revisions count by content, not alias', () => {
  const w = new WorldModel({ constants: { ground: 'land' }, seed: 'defs' }), d = w.defineDef(cube, 'god', 0);
  for (let i = 1; i < L.worldDefs; i++) w.defs.set(`sha:${i}`, { ...d, hash: String(i), ref: `old-${i}@1` });
  const r = applyBatch(w, { ops: [{ op: 'define', def: { ...cube, name: 'next' } }] }, 'god', 1).result as Refused;
  assert.equal(r.failures[0].code, 'budget.world'); assert.equal(r.failures[0].field, 'defs'); assert.equal(r.failures[0].measured, L.worldDefs + 1);
});
test('world triangle budget includes every placed instance', () => {
  const w = new WorldModel({ constants: { ground: 'land' }, seed: 'tris', assets: () => ({ tris: L.defTris, bytes: 10, textures: 0, box: [1, 1, 1] }) });
  const d = w.defineDef({ schema: 'def/1', name: 'mesh', layer: 'decor', size: { box: [1, 1, 1] }, make: { kind: 'mesh', asset: 'a'.repeat(64), collide: 'none' } }, 'god', 0);
  for (let i = 0; i < L.worldTris / L.defTris; i++) w.insert({ id: `m${i}`, def: d.ref, in: { parent: 'world' }, by: 'fixture', born: 0, v: 1 });
  const r = applyBatch(w, { ops: [{ op: 'place', def: d.ref }] }, 'god', 1).result as Refused;
  assert.equal(r.failures[0].code, 'budget.world'); assert.equal(r.failures[0].field, 'tris'); assert.equal(r.failures[0].measured, L.worldTris + L.defTris);
});
test('definition input size is bounded independently of asset bytes', () => {
  const w = new WorldModel({ constants: { ground: 'land' }, seed: 'def-bytes' });
  const large = { ...cube, make: { ...cube.make, args: { ...cube.make.args, padding: 'x'.repeat(L.defBytes) } } };
  const r = applyBatch(w, { ops: [{ op: 'define', def: large }] }, 'god', 1).result as Refused;
  assert.equal(r.failures[0].code, 'def.budget'); assert.equal(r.failures[0].limit, L.defBytes);
});
