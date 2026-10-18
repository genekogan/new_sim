// lane L3g (arrival CPU): WorldModel.readPass remembers slotsOf per entity object for one read-only pass, so a slotted
// child's pose no longer re-keys its parent's whole bake once per child. The answers must be the ones outside a pass, the
// memo must not outlive the pass, and any mutation through the model's methods must drop it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_KIT, WorldModel, applyBatch, type Accepted, type Refused } from './index.ts';

function fresh() { const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: 'read-pass' }); for (const d of CORE_KIT) w.defineDef(d, 'core', 0); return w; }
const ok = (r: ReturnType<typeof applyBatch>) => { assert.equal(r.result.accepted, true, JSON.stringify((r.result as Refused).failures)); return r.result as Accepted; };

/** A cottage with three lanterns mounted on its facade, loaded from a snapshot (the arrival path). */
function world() {
  const w = fresh();
  ok(applyBatch(w, { ops: [{ op: 'place', def: 'core/cottage@1', name: 'house', p: [12, -5], r: 0.7 }] }, 'god', 1));
  const house = w.get('house')!, snap = w.snapshot();
  const slot = w.slotsOf(house).find((s) => !s.retired)!.id;
  for (const i of [1, 2, 3]) snap.entities.push({ id: `e_lan${i}`, def: 'core/lantern@1', in: { parent: house.id, slot }, by: 'god', born: 2, v: 1, name: `lan-${i}`, p: [i * 0.2, 0] } as never);
  return WorldModel.fromSnapshot(snap);
}
/** Counts bakes on this model. */
function counted(w: WorldModel) { const c = { n: 0 }, bake = w.bake.bind(w); w.bake = (...a: Parameters<WorldModel['bake']>) => { c.n++; return bake(...a); }; return c; }
const lanterns = (w: WorldModel) => [1, 2, 3].map((i) => w.get(`house/lan-${i}`)!);

test('inside a read pass, slotted children get the same poses and footprints, with the parent baked once', () => {
  const w = world(), kids = lanterns(w);
  const outside = kids.map((e) => [w.worldPose(e), w.footprint(e)]);
  const c = counted(w);
  kids.forEach((e) => w.worldPose(e)); const plain = c.n;
  c.n = 0;
  const inside = w.readPass(() => kids.map((e) => [w.worldPose(e), w.footprint(e)]));
  assert.deepEqual(inside, outside);
  assert.equal(plain, 3, 'outside a pass each child re-bakes its parent');
  assert.equal(c.n, 1 + 3, 'inside: the parent once (for all three poses) plus each lantern its own footprint bake');
});

test('the memo lasts only for the pass, nests, returns the value, and is dropped when the pass throws', () => {
  const w = world(), [a] = lanterns(w), house = w.get('house')!, c = counted(w);
  assert.equal(w.readPass(() => { w.slotsOf(house); return w.readPass(() => { w.slotsOf(house); return 7; }); }), 7);
  assert.equal(c.n, 1, 'nested passes share one memo');
  w.slotsOf(house); assert.equal(c.n, 2, 'after the pass slotsOf bakes again');
  assert.throws(() => w.readPass(() => { w.worldPose(a); throw new Error('boom'); }), /boom/);
  w.slotsOf(house); assert.equal(c.n, 4, 'a throwing pass leaves no memo behind');
});

test('insert/delete during a pass drop the memo, so a re-inserted parent with new params gets fresh slots', () => {
  const w = world(), house = w.get('house')!, [a] = lanterns(w);
  w.readPass(() => {
    const before = w.worldPose(a);
    // re-insert the same object with a different storey count: its slots move, and the memo must not hand back the old ones
    w.delete(house.id); house.params = { ...(house.params ?? {}), floors: 2, w: 9 } as never; w.insert(house);
    const after = w.worldPose(a);
    const fresh2 = WorldModel.fromSnapshot(w.snapshot());
    assert.deepEqual(after, fresh2.worldPose(fresh2.get('house/lan-1')!));
    assert.notDeepEqual(after, before, 'the new params really move the lantern (else this test proves nothing)');
  });
});
