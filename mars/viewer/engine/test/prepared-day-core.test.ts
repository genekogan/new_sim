import test from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, servicesFor, ENGINE_INVARIANTS } from '../api/registry.ts';
import { classroomScene, classroomParams } from '../scenarios/classroom.ts';
import { workBreakWorld, WORK_BREAK_BINDING as B } from '../scenarios/work-break.ts';
import { pairedMealWalk } from '../scenarios/paired-meal-walk.ts';
import { groundSleepFixture } from '../scenarios/sleep.ts';
import { itemEntity, surfaceSlot, placeOnSlot, heldBy } from '../items/model.ts';
import { readWorkstation } from '../objects/workstation.ts';
import { readClassroom } from '../activities/classroom.ts';
import { readFoodPreparation } from '../activities/prepare-food.ts';
import { readPurposefulRoutine, type PurposefulRoutineParams } from '../activities/purposeful-routine.ts';

// Test-only explicit fixture composition. These are not released scenario factories.
function until(rt: Runtime, done: () => boolean, max = 18000) {
  for (let n = 0; n < max && !done(); n++) rt.step();
  assert.ok(done(), JSON.stringify([...rt.records.values()].filter(r => rt.isActive(r.id))));
  assert.deepEqual(rt.violations, []);
}
function setup(preparation = true) {
  const world = workBreakWorld(4);
  if (preparation) {
    world.entities[B.pot].contents = { food: 'hypothetical cold shared dish', fraction: 0 };
    for (const [item, slot] of [[B.people[0].spoon, 'r1c0'], ['day-beans', 'r0c1'], ['day-greens', 'r0c3']] as const) {
      if (!world.entities[item]) world.entities[item] = itemEntity(item, 'bowl', [0, 0, 0], 0, { contents: { food: item, fraction: 1 } });
      const target = surfaceSlot(world, `${B.table}#${slot}`);
      assert.ok(!('code' in target)); placeOnSlot(world.entities[item], target, 0);
    }
  }
  world.regions.mat = groundSleepFixture([12, 3]).world.regions.mat;
  const rt = new Runtime(world, createRegistry(), servicesFor({ classroom: classroomScene() })(world), ENGINE_INVARIANTS);
  const work = rt.submit('work_at', B.work);
  assert.notEqual(work.status, 'failed', work.diagnostic?.message);
  until(rt, () => { const w = readWorkstation(rt, B.work.station); return !('code' in w) && w.elapsed >= 2; });
  rt.cancel(work.id); until(rt, () => !rt.isActive(work.id));
  const session = rt.submit('classroom_session', classroomParams(4));
  until(rt, () => readClassroom(rt, session.id)?.phase === 'presenting');
  const params: PurposefulRoutineParams = {
    actor: B.work.actor, session: session.id,
    work: { station: B.work.station, seat: B.work.seat, task: B.work.task!, duration: B.work.duration },
    food: { pot: B.pot, participants: structuredClone(B.people), at: B.conversation.at },
    rest: { seat: 'unused-sleep-variant-seat', seconds: 3 }, departure: [10, 12],
    sleep: { actor: B.work.actor, mat: 'mat', duration: 3 },
    ...(preparation ? { preparation: { actor: B.work.actor, spoon: B.people[0].spoon, pot: B.pot, ingredients: ['day-beans', 'day-greens'] as [string, string] } } : {}),
  };
  return { rt, params };
}
function start(preparation = true) {
  const ready = setup(preparation), routine = ready.rt.submit('purposeful_routine', ready.params, { preempt: false });
  assert.notEqual(routine.status, 'failed', routine.diagnostic?.message);
  return { ...ready, routine };
}
function control(rt: Runtime, routine: string, intent: 'pause' | 'resume' | 'end') {
  const rec = rt.submit('purposeful_routine_control', { routine, intent }, { preempt: false });
  assert.notEqual(rec.status, 'failed', rec.diagnostic?.message);
  until(rt, () => !rt.isActive(rec.id));
}
function pause(rt: Runtime, routine: string) {
  control(rt, routine, 'pause');
  until(rt, () => ['paused', 'waiting'].includes(readPurposefulRoutine(rt, routine)!.mode));
}
function finish(rt: Runtime, routine: string) {
  until(rt, () => !rt.isActive(routine) || ['paused', 'waiting'].includes(readPurposefulRoutine(rt, routine)!.mode));
  assert.equal(rt.records.get(routine)!.status, 'completed', JSON.stringify(readPurposefulRoutine(rt, routine)));
  assert.deepEqual(rt.holder('routine:worker'), []);
  assert.deepEqual(rt.holder('actor:worker'), []);
  assert.deepEqual(rt.holder('sleep-purpose:worker'), []);
  assert.deepEqual(rt.holder('sleep-mat:mat'), []);
  assert.equal(rt.world.entities.worker.human!.sleepPose, undefined);
  assert.deepEqual(heldBy(rt.world, 'worker'), []);
}
test('prepared day retains the same notes through gathering, pair, conserved dish and ground sleep', () => {
  const { rt, params } = setup(); params.trip = pairedMealWalk('worker', 'visitor', -8);
  const routine = rt.submit('purposeful_routine', params, { preempt: false });
  assert.notEqual(routine.status, 'failed', routine.diagnostic?.message);
  finish(rt, routine.id);
  const read = readPurposefulRoutine(rt, routine.id)!;
  assert.equal(read.preparation?.complete, true);
  assert.equal(read.sleep!.elapsed, params.sleep!.duration);
  assert.equal(read.progress.restSeconds, 0);
  assert.equal(read.progress.workElapsed, B.work.duration);
  assert.ok(read.progress.meal.every(m => m.served && m.consumed && m.returned));
  assert.ok(read.trip?.participants.every(p => p.arrived));
  assert.equal(rt.world.entities[B.pot].contents!.fraction, 0);
  for (const ingredient of params.preparation!.ingredients) assert.equal(rt.world.entities[ingredient].contents!.fraction, 0);
});
test('pause/retry retains partial preparation and its held spoon without replaying deposits', () => {
  const { rt, routine, params } = start();
  until(rt, () => (readFoodPreparation(rt, B.pot)?.ingredients[0].deposited ?? 0) > 0);
  pause(rt, routine.id);
  const retained = structuredClone(readFoodPreparation(rt, B.pot));
  const fractions = [B.pot, ...params.preparation!.ingredients].map(id => rt.world.entities[id].contents!.fraction);
  for (let n = 0; n < 20; n++) rt.step();
  assert.deepEqual(readFoodPreparation(rt, B.pot), retained);
  assert.deepEqual([B.pot, ...params.preparation!.ingredients].map(id => rt.world.entities[id].contents!.fraction), fractions);
  assert.deepEqual(heldBy(rt.world, 'worker').map(h => h.item.id), [B.people[0].spoon]);
  control(rt, routine.id, 'resume'); finish(rt, routine.id);
  assert.equal(rt.world.entities[B.pot].contents!.fraction, 0);
});
for (const phase of ['lying-down', 'sleeping', 'waking'] as const) test(`parent pause during ${phase} retains the same sleep and safely releases physics`, () => {
  const { rt, routine } = start(false);
  until(rt, () => readPurposefulRoutine(rt, routine.id)?.sleep?.mode === phase);
  if (phase === 'sleeping') for (let n = 0; n < 8; n++) rt.step();
  const previous = readPurposefulRoutine(rt, routine.id)!.sleep!;
  pause(rt, routine.id);
  const paused = readPurposefulRoutine(rt, routine.id)!.sleep!;
  assert.equal(paused.action, previous.action); assert.equal(paused.elapsed, previous.elapsed);
  assert.equal(rt.world.entities.worker.human!.sleepPose, undefined);
  assert.deepEqual(rt.holder('actor:worker'), []); assert.deepEqual(rt.holder('sleep-mat:mat'), []);
  control(rt, routine.id, 'resume'); finish(rt, routine.id);
  assert.equal(readPurposefulRoutine(rt, routine.id)!.sleep!.action, previous.action);
});
test('director sleep interruption retains elapsed rest and End drains owned sleep without finishing notes', () => {
  const { rt, routine } = start(false);
  until(rt, () => readPurposefulRoutine(rt, routine.id)?.sleep?.mode === 'sleeping');
  for (let n = 0; n < 8; n++) rt.step();
  const previous = readPurposefulRoutine(rt, routine.id)!.sleep!;
  const directed = rt.submit('walk_to', { actor: 'worker', x: 12, z: 7 });
  assert.notEqual(directed.status, 'failed', directed.diagnostic?.message);
  until(rt, () => !rt.isActive(directed.id) && readPurposefulRoutine(rt, routine.id)?.mode === 'waiting');
  assert.equal(directed.status, 'completed');
  assert.equal(readPurposefulRoutine(rt, routine.id)!.sleep!.elapsed, previous.elapsed);
  control(rt, routine.id, 'resume');
  until(rt, () => readPurposefulRoutine(rt, routine.id)?.sleep?.mode === 'sleeping');
  assert.equal(readPurposefulRoutine(rt, routine.id)!.sleep!.action, previous.action);
  control(rt, routine.id, 'end'); until(rt, () => !rt.isActive(routine.id));
  assert.equal(routine.status, 'cancelled'); assert.equal(rt.world.entities.worker.human!.sleepPose, undefined);
  assert.deepEqual(rt.holder('actor:worker'), []); assert.deepEqual(rt.holder('sleep-mat:mat'), []);
  assert.deepEqual(rt.holder('sleep-purpose:worker'), []);
  assert.ok(Math.abs(readPurposefulRoutine(rt, routine.id)!.progress.workElapsed - 2) < 1e-8);
});
for (const mismatch of ['preparation-actor', 'preparation-pot', 'preparation-spoon', 'sleep-actor'] as const) test(`routine refuses ${mismatch} without physical effects`, () => {
  const { rt, params } = setup();
  if (mismatch === 'preparation-actor') params.preparation!.actor = 'visitor';
  if (mismatch === 'preparation-pot') params.preparation!.pot = 'other-pot';
  if (mismatch === 'preparation-spoon') params.preparation!.spoon = B.people[1].spoon;
  if (mismatch === 'sleep-actor') params.sleep!.actor = 'visitor';
  const before = rt.stateHash(), rec = rt.submit('purposeful_routine', params, { preempt: false });
  assert.equal(rec.status, 'failed'); assert.match(rec.diagnostic!.code, /^routine\.(preparation|sleep)-binding$/);
  assert.equal(rt.stateHash(), before); assert.deepEqual(rt.holder('routine:worker'), []);
  assert.equal([...rt.records.values()].some(r => r.parent === rec.id), false);
});
test('changed paused preparation refuses Resume without replacing retained quantities', () => {
  const { rt, routine } = start();
  until(rt, () => (readFoodPreparation(rt, B.pot)?.ingredients[0].deposited ?? 0) > 0);
  pause(rt, routine.id);
  const prior = readPurposefulRoutine(rt, routine.id)!.preparation!;
  readFoodPreparation(rt, B.pot)!.mixedTicks++;
  const before = rt.stateHash(), denied = rt.submit('purposeful_routine_control', { routine: routine.id, intent: 'resume' }, { preempt: false });
  assert.equal(denied.status, 'failed'); assert.equal(denied.diagnostic!.code, 'routine.preparation-changed');
  assert.equal(rt.stateHash(), before); assert.deepEqual(readPurposefulRoutine(rt, routine.id)!.preparation, prior);
  control(rt, routine.id, 'end'); until(rt, () => !rt.isActive(routine.id));
});
test('End during preparation preserves deposited food and returns the same spoon through ordinary put', () => {
  const { rt, routine } = start();
  until(rt, () => (readFoodPreparation(rt, B.pot)?.ingredients[0].deposited ?? 0) > 0);
  control(rt, routine.id, 'end'); until(rt, () => !rt.isActive(routine.id));
  assert.equal(routine.status, 'cancelled');
  assert.ok(rt.world.entities[B.pot].contents!.fraction > 0);
  assert.equal(readFoodPreparation(rt, B.pot)!.complete, false);
  assert.deepEqual(rt.holder('actor:worker'), []);
  assert.deepEqual(rt.holder(`entity:${B.pot}`), []);
  assert.deepEqual(heldBy(rt.world, 'worker').map(h => h.item.id), []);
  const spoon = rt.world.entities[B.people[0].spoon];
  assert.equal(spoon.id, B.people[0].spoon);
  assert.deepEqual(spoon.support, { kind: 'resting-on', on: B.table, slot: 'r2c1' });
  assert.ok([...rt.records.values()].some(r => r.verb === 'put_item' && r.status === 'completed' && (r.params as { item?: string; surfaceSlot?: string }).item === spoon.id && (r.params as { surfaceSlot?: string }).surfaceSlot === `${B.table}#r2c1`));
  assert.equal([...rt.records.values()].some(r => r.verb === 'sleep'), false);
});
