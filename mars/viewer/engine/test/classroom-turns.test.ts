import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTurns, stepTurns } from '../activities/turns.ts';
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, ENGINE_INVARIANTS, servicesFor } from '../api/registry.ts';
import { classroomScene, classroomParams, classroomWorld } from '../scenarios/classroom.ts';
import { readClassroom } from '../activities/index.ts';

for (const size of [2, 4]) test(`turn utility is deterministic and only clocks talking members (${size})`, () => {
  const members = Array.from({ length: size }, (_, i) => `a${i}`);
  const poses = members.map((id) => ({ id, p: [1, 0, 2], yaw: 0 }));
  const before = JSON.stringify(poses);
  const run = () => {
    const state = createTurns(1), changes: unknown[] = [];
    for (let i = 0; i < 200; i++) stepTurns(state, members, false, 0.05);
    assert.equal(state.elapsed, 0); assert.equal(state.floorHolder, undefined);
    for (let i = 0; i < 250; i++) if (stepTurns(state, members, true, 0.05)) changes.push([i, state.floorHolder]);
    assert.ok(changes.length >= 3); assert.ok(members.includes(state.floorHolder!));
    const remaining = members.filter((a) => a !== state.floorHolder);
    stepTurns(state, remaining, true, 0.05);
    assert.ok(!state.floorHolder || remaining.includes(state.floorHolder));
    stepTurns(state, members, false, 0.05); assert.equal(state.floorHolder, undefined);
    return changes;
  };
  assert.deepEqual(run(), run()); assert.equal(JSON.stringify(poses), before);
});
test('bounded groups have distinct periods and floor only among eligible members', () => {
  assert.notEqual(createTurns(0).period, createTurns(1).period);
  const state = createTurns(0);
  stepTurns(state, ['one'], true, 100); assert.equal(state.floorHolder, undefined);
  stepTurns(state, [], true, 100); assert.equal(state.floorHolder, undefined);
});
function until(rt: Runtime, check: () => boolean) {
  for (let i = 0; i < 6000 && !check(); i++) rt.step();
  assert.ok(check(), JSON.stringify([...rt.records.values()].filter((r) => rt.isActive(r.id)).map((r) => [r.verb, r.phase, r.diagnostic])));
}
function setup(count: 4 | 8) {
  const w = classroomWorld(count);
  const rt = new Runtime(w, createRegistry(), servicesFor({ classroom: classroomScene() })(w), ENGINE_INVARIANTS);
  const session = rt.submit('classroom_session', { ...classroomParams(count), talkSeconds: 0.3, conversationSeconds: 30 });
  assert.equal(session.status, 'executing');
  return { rt, session };
}
for (const count of [4, 8] as const) test(`formed classroom groups turn and cancellation clears speakers (${count} guests)`, () => {
  const { rt, session } = setup(count);
  until(rt, () => readClassroom(rt, session.id)!.groups.some((g) => g.status === 'gathering'));
  for (const g of readClassroom(rt, session.id)!.groups) if (g.status !== 'talking') assert.equal(g.floorHolder, undefined);
  until(rt, () => readClassroom(rt, session.id)!.groups.every((g) => g.status === 'talking' && !!g.floorHolder));
  const before = JSON.stringify(Object.values(rt.world.entities).map((e) => [e.id, e.pose]));
  const first = readClassroom(rt, session.id)!.groups;
  for (let i = 0; i < 105; i++) rt.step();
  const after = readClassroom(rt, session.id)!.groups;
  assert.ok(after.some((g, i) => g.floorHolder !== first[i].floorHolder));
  for (const g of after) { assert.ok(g.members.includes(g.floorHolder!)); assert.equal(g.attentionTarget?.actor, g.floorHolder); }
  assert.equal(JSON.stringify(Object.values(rt.world.entities).map((e) => [e.id, e.pose])), before, 'turn changes do not move or pose actors');
  assert.ok(rt.events.some((e) => e.type === 'mark' && e.name === 'classroom.group-floor'));
  rt.cancel(session.id);
  assert.ok(readClassroom(rt, session.id)!.groups.every((g) => !g.floorHolder && !g.attentionTarget));
  until(rt, () => !rt.isActive(session.id));
  assert.deepEqual(rt.violations, []); assert.deepEqual([...rt.records.values()].filter((r) => r.status === 'failed'), []);
  for (const a of classroomParams(count).audience) assert.deepEqual(rt.holder(`actor:${a}`), []);
});
test('departing group floor holder never remains eligible or a ghost speaker', () => {
  const { rt, session } = setup(4);
  until(rt, () => readClassroom(rt, session.id)!.groups.every((g) => g.status === 'talking' && !!g.floorHolder) && readClassroom(rt, session.id)!.groups.length > 0);
  const actor = readClassroom(rt, session.id)!.groups.find((g) => g.members.every((a) => a.startsWith('guest')))!.floorHolder!;
  const control = rt.submit('classroom_control', { session: session.id, intent: { kind: 'depart', actor } });
  assert.equal(control.status, 'executing'); rt.step();
  for (let i = 0; i < 300 && rt.isActive(session.id); i++) {
    for (const g of readClassroom(rt, session.id)!.groups) { assert.ok(!g.members.includes(actor)); assert.notEqual(g.floorHolder, actor); assert.notEqual(g.attentionTarget?.actor, actor); }
    rt.step();
  }
  rt.cancel(session.id); until(rt, () => !rt.isActive(session.id));
  assert.deepEqual(rt.violations, []); assert.deepEqual([...rt.records.values()].filter((r) => r.status === 'failed'), []);
  assert.deepEqual(rt.holder(`actor:${actor}`), []);
});
test('classroom floor marks repeat deterministically', () => {
  const run = () => {
    const { rt, session } = setup(4); until(rt, () => !rt.isActive(session.id));
    return rt.events.filter((e) => e.type === 'mark' && e.name === 'classroom.group-floor');
  };
  assert.deepEqual(run(), run());
});
