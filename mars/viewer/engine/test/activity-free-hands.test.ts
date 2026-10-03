import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, ENGINE_INVARIANTS, servicesFor } from '../api/registry.ts';
import { classroomWorld, classroomScene, classroomParams } from '../scenarios/classroom.ts';
import { readClassroom } from '../activities/index.ts';
import { readWorkstation } from '../objects/workstation.ts';
import { itemEntity, heldBy } from '../items/model.ts';
import { FIXTURE } from '../world/factory.ts';
function setup() {
  const w = classroomWorld();
  w.entities.returns = { id: 'returns', def: 'table-6ft', kind: 'fixture', pose: { p: [8, 0, 0], yaw: 0 }, provenance: FIXTURE, support: { kind: 'ground' } };
  return new Runtime(w, createRegistry(), servicesFor({ classroom: classroomScene() })(w), ENGINE_INVARIANTS);
}
function until(rt: Runtime, done: () => boolean, max = 6000) {
  for (let i = 0; i < max && !done(); i++) rt.step();
  assert.ok(done(), JSON.stringify([...rt.records.values()].filter((r) => rt.isActive(r.id)).map((r) => [r.verb, r.phase, r.diagnostic])));
}
function take(rt: Runtime, actor: string, both = false) {
  const p = rt.world.entities[actor].pose.p;
  for (const [def, hand, dz] of (both ? [['bowl', 'left', -.2], ['spoon', 'right', .2]] : [['bowl', 'left', 0]]) as [string, 'left' | 'right', number][]) {
    const id = `${actor}-${def}`;
    rt.world.entities[id] = itemEntity(id, def, [p[0] + .65, 0, p[2] + dz], 0, def === 'bowl' ? { contents: { food: 'soup', fraction: 1 } } : {});
    const action = rt.submit('take_item', { actor, item: id, hand });
    assert.equal(action.status, 'executing', action.diagnostic?.message);
    until(rt, () => !rt.isActive(action.id)); assert.equal(action.status, 'completed', action.diagnostic?.message);
  }
  assert.equal(heldBy(rt.world, actor).length, both ? 2 : 1);
}
function claims(rt: Runtime, actor: string) {
  return Object.fromEntries([`actor:${actor}`, `hand:${actor}:left`, `hand:${actor}:right`, `holds:${actor}`, `entity:${actor}-bowl`, `entity:${actor}-spoon`, 'workstation:workstation', 'slot:work-chair#seat', 'display:screen'].map((r) => [r, rt.holder(r)]));
}
function refused(rt: Runtime, actor: string, verb: string, params: unknown, code: string) {
  const hash = rt.stateHash(), before = claims(rt, actor), held = heldBy(rt.world, actor).map(({ item }) => item.id);
  const action = rt.submit(verb, params);
  assert.equal(action.status, 'failed'); assert.equal(action.diagnostic?.code, code);
  for (const id of [actor, ...held]) assert.ok(action.diagnostic?.subjects?.includes(id), id);
  assert.equal(rt.stateHash(), hash, 'refusal must preserve poses, support and task progress'); assert.deepEqual(claims(rt, actor), before);
  return action;
}
const work = { actor: 'worker', station: 'workstation', seat: 'work-chair#seat', duration: 3, task: 'Sketch notes' };
for (const both of [false, true]) test(`classroom initial entry refuses real held ${both ? 'bowl and spoon' : 'bowl'} without mutation`, () => {
  const rt = setup(); take(rt, 'guest1', both);
  refused(rt, 'guest1', 'classroom_session', classroomParams(), 'classroom.hands-occupied'); assert.deepEqual(rt.violations, []);
});
for (const both of [false, true]) test(`classroom joining refuses real held ${both ? 'bowl and spoon' : 'bowl'}, then works after explicit put`, () => {
  const rt = setup(); take(rt, 'visitor', both);
  const session = rt.submit('classroom_session', { ...classroomParams(), talkSeconds: 60 });
  assert.equal(session.status, 'executing'); until(rt, () => readClassroom(rt, session.id)?.phase === 'presenting');
  const params = { session: session.id, intent: { kind: 'join', actor: 'visitor', departure: [-7, 12] } };
  refused(rt, 'visitor', 'classroom_control', params, 'classroom.hands-occupied');
  for (const [i, { item }] of heldBy(rt.world, 'visitor').entries()) {
    const put = rt.submit('put_item', { actor: 'visitor', item: item.id, surfaceSlot: `returns#r0c${i}` });
    assert.equal(put.status, 'executing', put.diagnostic?.message); until(rt, () => !rt.isActive(put.id)); assert.equal(put.status, 'completed', put.diagnostic?.message);
  }
  const joined = rt.submit('classroom_control', params); assert.equal(joined.status, 'executing', joined.diagnostic?.message);
  until(rt, () => readClassroom(rt, session.id)?.participants.find((p) => p.actor === 'visitor')?.arrival === 'seated');
  rt.cancel(session.id); until(rt, () => !rt.isActive(session.id)); assert.deepEqual(rt.violations, []);
});
for (const both of [false, true]) test(`fresh computer work refuses real held ${both ? 'bowl and spoon' : 'bowl'}`, () => {
  const rt = setup(); take(rt, 'worker', both); refused(rt, 'worker', 'work_at', work, 'workstation.hands-occupied'); assert.deepEqual(rt.violations, []);
});
test('unfinished computer work refuses held meal items, explicit puts permit same-user resume', () => {
  const rt = setup(); const first = rt.submit('work_at', work); assert.equal(first.status, 'executing');
  until(rt, () => { const s = readWorkstation(rt, 'workstation'); return !('code' in s) && s.elapsed >= .5; });
  rt.cancel(first.id); until(rt, () => !rt.isActive(first.id)); const unfinished = readWorkstation(rt, 'workstation');
  take(rt, 'worker', true);
  refused(rt, 'worker', 'work_at', { ...work, resume: true }, 'workstation.hands-occupied');
  assert.deepEqual(readWorkstation(rt, 'workstation'), unfinished);
  for (const [i, { item }] of heldBy(rt.world, 'worker').entries()) {
    const put = rt.submit('put_item', { actor: 'worker', item: item.id, surfaceSlot: `returns#r0c${i}` });
    assert.equal(put.status, 'executing', put.diagnostic?.message); until(rt, () => !rt.isActive(put.id)); assert.equal(put.status, 'completed', put.diagnostic?.message);
  }
  const resumed = rt.submit('work_at', { ...work, resume: true }); assert.equal(resumed.status, 'executing', resumed.diagnostic?.message);
  until(rt, () => !rt.isActive(resumed.id)); assert.equal(resumed.status, 'completed'); assert.deepEqual(rt.holder('actor:worker'), []); assert.deepEqual(rt.violations, []);
});
test('ordinary taking a second item and seated eating remain supported', () => {
  const rt = setup(); take(rt, 'worker', true);
  const seat = rt.submit('sit', { actor: 'worker', slot: 'work-chair#seat' }); assert.equal(seat.status, 'executing'); until(rt, () => seat.phase === 'occupied');
  const eat = rt.submit('eat', { actor: 'worker', bowl: 'worker-bowl', spoon: 'worker-spoon', cycles: 1 });
  assert.equal(eat.status, 'executing', eat.diagnostic?.message); until(rt, () => !rt.isActive(eat.id)); assert.equal(eat.status, 'completed');
  assert.equal(heldBy(rt.world, 'worker').length, 2); rt.cancel(seat.id); until(rt, () => !rt.isActive(seat.id)); assert.deepEqual(rt.violations, []);
});
test('free-hand classroom entry still completes with the same physical actions', () => {
  const rt = setup(); const session = rt.submit('classroom_session', { ...classroomParams(), talkSeconds: .3, conversationSeconds: .3 });
  assert.equal(session.status, 'executing'); until(rt, () => !rt.isActive(session.id)); assert.equal(session.status, 'completed', session.diagnostic?.message); assert.deepEqual(rt.violations, []);
});
