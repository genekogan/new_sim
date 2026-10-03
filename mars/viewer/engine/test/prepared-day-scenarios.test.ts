import test from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, servicesFor, ENGINE_INVARIANTS } from '../api/registry.ts';
import { PREPARED_DAY_NAMES, preparedDayWorld, preparedDayScene, preparedDayBindings, type PreparedDayScenario } from '../scenarios/prepared-day.ts';
import { classroomParams } from '../scenarios/classroom.ts';
import { WORK_BREAK_BINDING } from '../scenarios/work-break.ts';
import { designStudioBindings } from '../scenarios/design-studio.ts';
import { pairedMealWalk } from '../scenarios/paired-meal-walk.ts';
import { readClassroom } from '../activities/classroom.ts';
import { readPurposefulRoutine, type PurposefulRoutineParams } from '../activities/purposeful-routine.ts';
import { readGatheringContinuation } from '../activities/gathering-continuation.ts';
import { readWorkstation } from '../objects/workstation.ts';
import { heldBy } from '../items/model.ts';

function until(rt: Runtime, done: () => boolean, max = 18000) {
  for (let i = 0; i < max && !done(); i++) rt.step();
  assert.ok(done(), JSON.stringify([...rt.records.values()].filter(r => rt.isActive(r.id))));
  assert.deepEqual(rt.violations, []);
}
function complete(rt: Runtime, verb: string, params: unknown) {
  const r = rt.submit(verb, params);
  assert.notEqual(r.status, 'failed', r.diagnostic?.message);
  until(rt, () => !rt.isActive(r.id));
  assert.equal(r.status, 'completed', r.diagnostic?.message);
  return r;
}
function setup(name: PreparedDayScenario) {
  const world = preparedDayWorld(name), scene = preparedDayScene(name);
  const rt = new Runtime(world, createRegistry(), servicesFor({ classroom: scene, 'design-studio': scene })(world), ENGINE_INVARIANTS);
  const studio = name === 'prepared-day-studio' ? designStudioBindings() : undefined;
  const b = studio?.workBreak ?? structuredClone(WORK_BREAK_BINDING);
  const sessionParams = studio?.session ?? classroomParams(name === 'prepared-day-8' ? 8 : 4);
  const additions = preparedDayBindings(name)!;
  rt.step(); assert.deepEqual(rt.violations, [], 'fresh first Step must be authoritative');
  if (name === 'prepared-day-8') {
    complete(rt, 'take_item', { actor: 'worker', item: 'break-bowl', hand: 'left' });
    complete(rt, 'take_item', { actor: 'worker', item: 'break-spoon', hand: 'right' });
    complete(rt, 'setup_room', { layout: 'side', moves: [
      { actor: 'guest1', helpers: ['guest2'], fixture: 'belongings-table', to: { x: 12, z: -2, yaw: 0 } },
      { actor: 'guest3', fixture: 'seat12', to: { x: 7.5, z: 4.5, yaw: -Math.PI } },
    ] });
    complete(rt, 'stow_items', { actor: 'worker', placements: [{ item: 'break-bowl', surfaceSlot: 'belongings-table#r0c1' }, { item: 'break-spoon', surfaceSlot: 'belongings-table#r0c2' }] });
  }
  const notes = rt.submit('work_at', b.work);
  assert.notEqual(notes.status, 'failed', notes.diagnostic?.message);
  until(rt, () => { const w = readWorkstation(rt, b.work.station); return !('code' in w) && w.elapsed >= 2; });
  rt.cancel(notes.id); until(rt, () => !rt.isActive(notes.id));
  const unfinished = readWorkstation(rt, b.work.station);
  const session = rt.submit('classroom_session', sessionParams);
  until(rt, () => readClassroom(rt, session.id)?.phase === 'presenting');
  const params: PurposefulRoutineParams = {
    actor: b.work.actor, session: session.id,
    work: { station: b.work.station, seat: b.work.seat, task: b.work.task!, duration: b.work.duration },
    food: { pot: b.pot, participants: b.people, at: b.conversation.at },
    rest: studio?.rest ?? { seat: name === 'prepared-day-8' ? 'seat12#seat' : 'seat8#seat', seconds: 5 },
    departure: studio?.departure ?? [10, 12], ...additions,
    trip: pairedMealWalk(b.work.actor, b.people[1].actor, studio ? -9 : -8),
  };
  return { rt, b, params, session, unfinished, studio, sessionParams };
}
for (const name of PREPARED_DAY_NAMES) test(`${name} conserves identities and completes distinct continuing commitments`, () => {
  const { rt, b, params, session, unfinished, studio, sessionParams } = setup(name);
  const ids = Object.keys(rt.world.entities).sort();
  const day = rt.submit('purposeful_routine', params, { preempt: false });
  assert.notEqual(day.status, 'failed', day.diagnostic?.message);
  const discussion = rt.submit('gathering_continuation', { session: session.id, binding: studio?.followUpDiscussion ?? { kind: 'discussion', actors: ['guest1', 'guest2'], at: [-7, 6], duration: 20 } });
  const follow = rt.submit('gathering_continuation', { session: session.id, binding: {
    ...(studio?.followUpWork ?? { kind: 'work', actor: sessionParams.presenters[0], work: { station: b.work.station, seat: b.work.seat, task: 'Record talk follow-up', duration: 12 } }),
    prerequisite: { routine: day.id, actor: b.work.actor, station: b.work.station, task: b.work.task!, duration: b.work.duration },
  } });
  assert.notEqual(discussion.status, 'failed', discussion.diagnostic?.message);
  assert.notEqual(follow.status, 'failed', follow.diagnostic?.message);
  until(rt, () => readPurposefulRoutine(rt, day.id)?.phase === 'preparation');
  assert.deepEqual(readWorkstation(rt, b.work.station), unfinished);
  until(rt, () => !rt.isActive(day.id));
  assert.equal(day.status, 'completed', JSON.stringify(readPurposefulRoutine(rt, day.id)));
  const final = structuredClone(readPurposefulRoutine(rt, day.id)!);
  assert.equal(final.progress.workElapsed, b.work.duration);
  assert.equal(final.preparation?.complete, true);
  assert.ok(final.preparation?.ingredients.every(i => i.deposited === 1));
  assert.equal(final.sleep?.elapsed, params.sleep!.duration);
  assert.ok(final.trip?.participants.every(p => p.arrived));
  assert.ok(final.progress.meal.every(p => p.served && p.consumed && p.returned));
  until(rt, () => !rt.isActive(discussion.id) && !rt.isActive(follow.id));
  assert.equal(discussion.status, 'completed', JSON.stringify(readGatheringContinuation(rt, discussion.id)));
  assert.equal(follow.status, 'completed', JSON.stringify(readGatheringContinuation(rt, follow.id)));
  const remembered = readPurposefulRoutine(rt, day.id)!;
  // Trip separation is a live world measurement even after arrival. Preserve
  // the historical intent/progress rather than requiring people to stay still.
  assert.deepEqual(remembered.bindings, final.bindings);
  assert.deepEqual(remembered.progress, final.progress, 'subsequent computer use cannot replace the completed original purpose');
  assert.deepEqual(remembered.preparation, final.preparation);
  assert.deepEqual(remembered.sleep, final.sleep);
  assert.equal(remembered.status, 'completed');
  assert.deepEqual(Object.keys(rt.world.entities).sort(), ids, 'no replacement ingredients, utensils or participants spawned');
  for (const id of [b.pot, ...params.preparation!.ingredients]) assert.equal(rt.world.entities[id].contents!.fraction, 0);
  for (const e of Object.values(rt.world.entities)) {
    if (e.human) { assert.deepEqual(rt.holder(`actor:${e.id}`), []); assert.equal(e.human.sleepPose, undefined); assert.deepEqual(heldBy(rt.world, e.id), []); }
    assert.notEqual(e.support?.kind, 'none');
  }
  assert.deepEqual(rt.holder('sleep-mat:mat'), []);
  assert.deepEqual(rt.holder(`sleep-purpose:${b.work.actor}`), []);
});
test('prepared-day authoring is detached, deterministic and preserves original finite quantities', () => {
  for (const name of PREPARED_DAY_NAMES) {
    const a = preparedDayWorld(name), b = preparedDayWorld(name);
    assert.deepEqual(a, b);
    const binding = preparedDayBindings(name)!;
    assert.equal(a.entities[binding.preparation.pot].contents!.fraction, 0);
    for (const id of binding.preparation.ingredients) assert.equal(a.entities[id].contents!.fraction, 1);
    a.entities[binding.preparation.ingredients[0]].contents!.fraction = 0;
    assert.equal(b.entities[binding.preparation.ingredients[0]].contents!.fraction, 1);
    binding.sleep.duration = 999;
    assert.equal(preparedDayBindings(name)!.sleep.duration, 18);
  }
  assert.equal(preparedDayBindings('unknown'), undefined);
});
