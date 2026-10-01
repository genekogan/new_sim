// Dropping unsupported live work must not strand durable equipment as active.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { SnapshotError, type RuntimeSnapshot } from '../runtime/snapshot.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import type { SpatialScene } from '../spatial/types.ts';
import { emptyWorld, human, addAll, FIXTURE } from '../world/factory.ts';
import type { Entity } from '../world/types.ts';
import type { ActionDef } from '../actions/types.ts';
import { walkTo } from '../locomotion/walk.ts';
import { SOCIAL_ACTIONS } from '../social/actions.ts';
import { allSlots } from '../social/slots.ts';
import { WORKSTATION_ACTIONS, readWorkstation } from '../objects/workstation.ts';

const scene: SpatialScene = {
  bounds: [-12, -12, 12, 12], levels: [{ id: 0, y: 0, label: 'ground' }],
  surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [12, 12], yaw: 0 } }], obstacles: [], links: [],
};
const registry = new Map<string, ActionDef>([walkTo, ...SOCIAL_ACTIONS, ...WORKSTATION_ACTIONS].map(a => [a.verb, a]));
function setup() {
  const fixture = (id: string, def: string, z: number): Entity => ({ id, def, kind: 'fixture', pose: { p: [0, 0, z], yaw: 0 }, provenance: FIXTURE });
  const world = addAll(emptyWorld('workstation-drop-review', scene), fixture('desk', 'computer-workstation', 0), fixture('chair', 'camp-chair', -1.2), human('user', 0, -4));
  const rt = new Runtime(world, registry, { spatial: new Spatial(scene) }, DEFAULT_INVARIANTS);
  return { rt, params: { actor: 'user', station: 'desk', seat: 'chair#seat', duration: 5, task: 'retained-checkpoint-notes' } };
}
function state(rt: Runtime) {
  const value = readWorkstation(rt, 'desk'); assert.ok(!('code' in value)); return value;
}
function until(rt: Runtime, done: () => boolean) {
  for (let n = 0; n < 2400 && !done(); n++) rt.step();
  assert.ok(done(), 'real physical work/cleanup must finish within existing bounded ticks');
}
const restore = (snap: RuntimeSnapshot) => Runtime.restore(JSON.parse(JSON.stringify(snap)), registry, { spatial: new Spatial(scene) }, DEFAULT_INVARIANTS);
function clean(rt: Runtime) {
  for (const key of ['actor:user', 'workstation:desk', 'entity:desk', 'entity:chair']) assert.deepEqual(rt.holder(key), [], key);
  for (const slot of allSlots(rt)) assert.equal(slot.claimedBy, undefined, slot.id);
  assert.equal(rt.world.entities.user.human!.task, undefined);
  assert.deepEqual(rt.violations, []);
}
function liveWork() {
  const { rt, params } = setup(), action = rt.submit('work_at', params);
  until(rt, () => state(rt).elapsed >= 0.5);
  assert.equal(state(rt).status, 'active'); return { rt, params, action };
}

test('active work default snapshot refusal is unchanged and leaves ownership/progress intact', () => {
  const { rt, action } = liveWork(), before = rt.stateHash(), read = state(rt), claims = rt.holder('workstation:desk');
  assert.throws(() => rt.snapshot(), e => e instanceof SnapshotError && e.code === 'snapshot.non-resumable' && e.subjects.includes(action.id));
  assert.equal(rt.stateHash(), before); assert.deepEqual(state(rt), read); assert.deepEqual(rt.holder('workstation:desk'), claims); assert.ok(rt.isActive(action.id));
});
test('allowDrop cannot produce an ownerless active workstation after JSON restore and child drain', () => {
  const { rt, params, action } = liveWork(), before = rt.stateHash(), read = state(rt), claims = rt.holder('workstation:desk');
  const beforeEvents = JSON.stringify(rt.events), beforeRecords = JSON.stringify([...rt.records]);
  let snap: RuntimeSnapshot;
  try { snap = rt.snapshot({ allowDrop: true }); }
  catch (e) {
    assert.ok(e instanceof SnapshotError); assert.equal(e.code, 'snapshot.drop-unsafe');
    assert.ok(e.subjects.includes(action.id)); assert.ok(e.subjects.includes('desk')); assert.match(e.message, /desk.*active|active.*desk/);
    assert.equal(rt.stateHash(), before); assert.deepEqual(state(rt), read);
    assert.deepEqual(rt.holder('workstation:desk'), claims); assert.ok(rt.isActive(action.id));
    assert.equal(JSON.stringify(rt.events), beforeEvents); assert.equal(JSON.stringify([...rt.records]), beforeRecords); return;
  }
  // Pre-fix path: demonstrate the actual world-level wedge, not only absence of a guard.
  const copy = restore(snap);
  until(copy, () => [...copy.records.values()].every(rec => !copy.isActive(rec.id)));
  assert.equal(copy.records.get(action.id)!.status, 'cancelled'); clean(copy);
  if (state(copy).status === 'active') assert.equal(copy.submit('work_at', { ...params, resume: true }).diagnostic?.code, 'workstation.active-state');
  assert.equal(state(copy).status, 'unfinished', 'restored cancelled work must not remain active without a live owner');
});
test('ordinary safe stop then quiescent JSON restore retains exact unfinished progress and supports explicit continuation', () => {
  const { rt, params, action } = liveWork(); rt.cancel(action.id);
  until(rt, () => !rt.isActive(action.id)); clean(rt);
  const before = state(rt); assert.equal(before.status, 'unfinished'); assert.ok(before.elapsed >= 0.5 && before.elapsed < params.duration);
  const copy = restore(rt.snapshot()); clean(copy);
  assert.equal(copy.stateHash(), rt.stateHash()); assert.deepEqual(state(copy), before);
  const continued = copy.submit('work_at', { ...params, resume: true });
  assert.notEqual(continued.status, 'failed', continued.diagnostic?.message);
  until(copy, () => !copy.isActive(continued.id)); clean(copy);
  assert.equal(state(copy).status, 'completed'); assert.equal(state(copy).elapsed, params.duration);
});
