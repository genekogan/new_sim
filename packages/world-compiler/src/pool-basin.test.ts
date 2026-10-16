// E2 #5: the swimming pool was a flat blue slab on the lawn. It now carves its own basin: the def's landform is
// authored in the def frame, so it turns, moves and stretches with the pool, sits relative to where the pool stands,
// stays under the paved deck, and goes away with the pool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_KIT, WorldModel, applyBatch, coreRef, type Accepted, type Refused } from './index.ts';

function fresh() { const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: 'pool' }); for (const d of CORE_KIT) w.defineDef(d, 'core', 0); return w; }
const ok = (r: ReturnType<typeof applyBatch>) => { assert.equal(r.result.accepted, true, JSON.stringify((r.result as Refused).failures)); return r.result as Accepted; };
/** World point at def-frame (u, v) of an entity at (x, z) turned by yaw (the engine's convention). */
const at = (x: number, z: number, yaw: number, u: number, v: number) => [x + u * Math.cos(yaw) + v * Math.sin(yaw), z - u * Math.sin(yaw) + v * Math.cos(yaw)] as const;

test('a swimming pool carves a 1.6 m basin under its water, turned with the pool, and the deck covers the slopes', () => {
  const w = fresh(), yaw = 0.5;
  ok(applyBatch(w, { ops: [{ op: 'place', def: coreRef('swimming-pool'), name: 'pool', p: [40, 20], r: yaw }] }, 'god', 1));
  const e = w.get('pool')!; assert.equal(e.p?.length === 3 ? e.p[1] : 0, 0, 'stands on the ground, not in its own hole');
  for (const [u, v] of [[0, 0], [4.5, 2], [-4.5, -2], [2, -2.2]]) { const [x, z] = at(40, 20, yaw, u, v); assert.ok(Math.abs(w.terrain.sample(x, z) - -1.6) < 1e-3, `bed under the water at (${u},${v}): ${w.terrain.sample(x, z)}`); }
  // the terrain's 1 m slopes stay inside the 16 x 11 m deck; beyond it the lawn is untouched
  for (const [u, v] of [[8.3, 0], [-8.3, 0], [0, 5.8], [0, -5.8]]) { const [x, z] = at(40, 20, yaw, u, v); assert.equal(w.terrain.sample(x, z), 0, `lawn at (${u},${v})`); }
  ok(applyBatch(w, { ops: [{ op: 'remove', id: 'pool' }] }, 'god', 2));
  assert.equal(w.terrain.sample(40, 20), 0, 'removing the pool fills its basin');
});

test('a stretched pool carves a stretched basin', () => {
  const w = fresh();
  ok(applyBatch(w, { ops: [{ op: 'place', def: coreRef('swimming-pool'), name: 'long-pool', p: [-50, 0], params: { sx: 2 } }] }, 'god', 1));
  assert.ok(Math.abs(w.terrain.sample(-50 + 9, 0) - -1.6) < 1e-3, 'twice as long');
  assert.equal(w.terrain.sample(-50 + 16.5, 0), 0);
});
