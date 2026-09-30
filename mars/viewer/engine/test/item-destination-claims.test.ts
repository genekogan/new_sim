import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { createRegistry } from '../api/registry.ts';
import type { ActionDef } from '../actions/types.ts';
import type { SpatialScene } from '../spatial/types.ts';
import { emptyWorld, addAll, human, FIXTURE } from '../world/factory.ts';
import { itemEntity, surfaceSlot, placeOnSlot } from '../items/model.ts';
const scene: SpatialScene = { bounds: [-12, -12, 12, 12], levels: [{ id: 0, y: 0, label: 'ground' }], surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [12, 12], yaw: 0 } }], obstacles: [], links: [] };
const destination = 'table#r0c2', resource = `surface-slot:${destination}`;
function until(rt: Runtime, done: () => boolean, max = 2400) { for (let i = 0; i < max && !done(); i++) rt.step(); assert.ok(done(), JSON.stringify([...rt.records.values()].filter((r) => rt.isActive(r.id)))); }
function setup() {
  const w = addAll(emptyWorld('destination-claims', scene), { id: 'table', kind: 'fixture', def: 'table-6ft', pose: { p: [0, 0, 0], yaw: 0 }, provenance: FIXTURE, support: { kind: 'ground' } });
  const slot = surfaceSlot(w, destination); assert.ok(!('code' in slot));
  addAll(w, human('a', slot.p[0] - .45, slot.p[2] - .55), human('b', slot.p[0] + .45, slot.p[2] - .55));
  const rt = new Runtime(w, createRegistry(), { spatial: new Spatial(scene) }, DEFAULT_INVARIANTS);
  for (const actor of ['a', 'b']) {
    const p = w.entities[actor].pose.p;
    w.entities[`${actor}-bowl`] = itemEntity(`${actor}-bowl`, 'bowl', [p[0], 0, p[2] - .65]);
    const take = rt.submit('take_item', { actor, item: `${actor}-bowl`, hand: 'left' });
    assert.equal(take.status, 'executing', take.diagnostic?.message); until(rt, () => !rt.isActive(take.id)); assert.equal(take.status, 'completed');
  }
  return rt;
}
function put(rt: Runtime, actor: string, surface = destination, parent?: string) { return rt.submit('put_item', { actor, item: `${actor}-bowl`, surfaceSlot: surface }, { parent }); }
function held(rt: Runtime, actor: string) { assert.deepEqual(rt.world.entities[`${actor}-bowl`].support, { kind: 'in-hand', by: actor, hand: 'left' }); }
function released(rt: Runtime, actor: string, slot = destination) {
  assert.deepEqual(rt.holder(`actor:${actor}`), []); assert.deepEqual(rt.holder(`hand:${actor}:left`), []); assert.deepEqual(rt.holder(`entity:${actor}-bowl`), []); assert.deepEqual(rt.holder(`surface-slot:${slot}`), []); assert.deepEqual(rt.violations, []);
}
test('two real held items racing one slot receive an authoritative conflict', () => {
  const rt = setup(), first = put(rt, 'a'); assert.equal(first.status, 'executing'); assert.deepEqual(rt.holder(resource), [first.id]);
  const before = rt.stateHash(), second = put(rt, 'b');
  assert.equal(second.status, 'failed'); assert.equal(second.diagnostic?.code, 'reservation.conflict'); assert.equal(second.diagnostic?.details?.resource, resource); assert.equal(rt.stateHash(), before); held(rt, 'b');
  until(rt, () => !rt.isActive(first.id)); assert.equal(first.status, 'completed'); assert.deepEqual(rt.world.entities['a-bowl'].support, { kind: 'resting-on', on: 'table', slot: 'r0c2' }); released(rt, 'a');
});
test('different destination slots permit concurrent normal puts', () => {
  const rt = setup(), a = put(rt, 'a', 'table#r0c0'), b = put(rt, 'b', 'table#r0c5');
  assert.equal(a.status, 'executing'); assert.equal(b.status, 'executing'); until(rt, () => !rt.isActive(a.id) && !rt.isActive(b.id));
  assert.equal(a.status, 'completed'); assert.equal(b.status, 'completed'); released(rt, 'a', 'table#r0c0'); released(rt, 'b', 'table#r0c5');
});
for (const after of [false, true]) test(`cancel ${after ? 'after' : 'before'} release preserves correct support and frees destination`, () => {
  const rt = setup(), action = put(rt, 'a');
  until(rt, () => action.phase === (after ? 'withdraw' : 'reach'));
  rt.cancel(action.id); assert.equal(action.status, 'cancelled');
  if (after) assert.deepEqual(rt.world.entities['a-bowl'].support, { kind: 'resting-on', on: 'table', slot: 'r0c2' }); else held(rt, 'a');
  rt.step(); released(rt, 'a');
  if (!after) { const next = put(rt, 'b'); assert.equal(next.status, 'executing'); until(rt, () => !rt.isActive(next.id)); assert.equal(next.status, 'completed'); }
});
for (const change of ['occupy', 'remove', 'move', 'rotate', 'wrong-def'] as const) test(`late destination ${change} refuses release and retains held support`, () => {
  const rt = setup(), action = put(rt, 'a'); until(rt, () => action.phase === 'reach');
  if (change === 'occupy') {
    const s = surfaceSlot(rt.world, destination); assert.ok(!('code' in s));
    const intruder = itemEntity('intruder', 'cup', [0, 0, 0]); placeOnSlot(intruder, s, 0); rt.world.entities.intruder = intruder;
  } else if (change === 'remove') delete rt.world.entities.table;
  else if (change === 'move') rt.world.entities.table.pose.p[0] += .2;
  else if (change === 'rotate') rt.world.entities.table.pose.yaw += .1;
  else rt.world.entities.table.def = 'camp-chair';
  until(rt, () => !rt.isActive(action.id)); assert.equal(action.status, 'failed');
  assert.equal(action.diagnostic?.code, change === 'occupy' ? 'item.slot-occupied' : change === 'move' || change === 'rotate' ? 'item.destination-moved' : 'item.destination-unavailable');
  for (const id of ['a', 'a-bowl', destination]) assert.ok(action.diagnostic?.subjects?.includes(id)); held(rt, 'a'); rt.step(); released(rt, 'a');
});
test('failed ground approach releases destination reservation while retaining held item', () => {
  const rt = setup();
  const walk = rt.submit('walk_to', { actor: 'a', x: -5, z: -5 }); until(rt, () => !rt.isActive(walk.id)); assert.equal(walk.status, 'completed');
  const action = put(rt, 'a'); assert.equal(action.status, 'executing');
  const child = [...rt.records.values()].find((r) => r.parent === action.id && r.verb === 'walk_to'); assert.ok(child); rt.cancel(child.id);
  until(rt, () => !rt.isActive(action.id)); assert.equal(action.status, 'failed'); held(rt, 'a'); released(rt, 'a');
});
test('an owning parent delegates the exact destination token and retains it through child completion', () => {
  const rt = setup();
  const parent: ActionDef<{ actor: string }, null, { id: string; child?: string }> = {
    verb: 'test_stow_parent', description: 'test-only parent claim', schema: z.strictObject({ actor: z.string() }),
    reservations: (_w, p) => [{ resource, mode: 'exclusive' }, { resource: `actor:${p.actor}`, mode: 'exclusive' }],
    plan: () => ({ ok: true, program: null }), start: (_rt, _p, _prog, id) => ({ id }),
    step: () => ({ status: 'running' }), cancel: () => ({ ok: true }),
  };
  rt.registry.set(parent.verb, parent);
  const owner = rt.submit(parent.verb, { actor: 'a' }); assert.equal(owner.status, 'executing');
  const blocked = put(rt, 'b'); assert.equal(blocked.diagnostic?.code, 'reservation.conflict');
  const child = put(rt, 'a', destination, owner.id); assert.equal(child.status, 'executing'); assert.deepEqual(rt.holder(resource), [owner.id, child.id]);
  until(rt, () => !rt.isActive(child.id)); assert.equal(child.status, 'completed'); assert.deepEqual(rt.holder(resource), [owner.id]);
  rt.cancel(owner.id); released(rt, 'a');
});
test('mid-reach snapshot restoration keeps destination binding and claim until normal release', () => {
  const rt = setup(), action = put(rt, 'a'); until(rt, () => action.phase === 'reach');
  const snapshot = JSON.parse(JSON.stringify(rt.snapshot()));
  const restored = Runtime.restore(snapshot, createRegistry(), { spatial: new Spatial(scene) }, DEFAULT_INVARIANTS);
  assert.deepEqual(restored.holder(resource), [action.id]);
  until(rt, () => !rt.isActive(action.id)); until(restored, () => !restored.isActive(action.id));
  assert.equal(restored.stateHash(), rt.stateHash()); assert.equal(restored.records.get(action.id)?.status, 'completed'); released(restored, 'a');
});
