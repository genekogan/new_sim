import test from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, servicesFor, ENGINE_INVARIANTS } from '../api/registry.ts';
import { classroomScene, classroomParams } from '../scenarios/classroom.ts';
import { WORK_BREAK_BINDING as B, workBreakWorld } from '../scenarios/work-break.ts';
import { readPurposefulRoutine } from '../activities/purposeful-routine.ts';
import type { PurposefulRoutineParams } from '../activities/purposeful-routine.ts';
import { readWorkstation } from '../objects/workstation.ts';
import { readClassroom } from '../activities/classroom.ts';
import { heldBy } from '../items/model.ts';

function until(rt: Runtime, done: () => boolean, max = 16000) {
  for (let i = 0; i < max && !done(); i++) rt.step();
  assert.ok(done(), JSON.stringify([...rt.records.values()].filter(r => rt.isActive(r.id)), null, 2));
  assert.deepEqual(rt.violations, []);
}
function complete(rt: Runtime, verb: string, params: unknown) {
  const rec = rt.submit(verb, params);
  assert.notEqual(rec.status, 'failed', rec.diagnostic?.message);
  until(rt, () => !rt.isActive(rec.id));
  assert.equal(rec.status, 'completed', rec.diagnostic?.message);
  return rec;
}
function setup(count: 4 | 8 = 4) {
  const world = workBreakWorld(count);
  const rt = new Runtime(world, createRegistry(), servicesFor({ classroom: classroomScene() })(world), ENGINE_INVARIANTS);
  if (count === 8) {
    complete(rt, 'take_item', { actor: 'worker', item: 'break-bowl', hand: 'left' });
    complete(rt, 'take_item', { actor: 'worker', item: 'break-spoon', hand: 'right' });
    complete(rt, 'setup_room', { layout: 'side', moves: [
    { actor: 'guest1', helpers: ['guest2'], fixture: 'belongings-table', to: { x: 12, z: -2, yaw: 0 } },
    { actor: 'guest3', fixture: 'seat12', to: { x: 7.5, z: 4.5, yaw: -Math.PI } },
  ] });
    complete(rt, 'stow_items', { actor: 'worker', placements: [{ item: 'break-bowl', surfaceSlot: 'belongings-table#r0c1' }, { item: 'break-spoon', surfaceSlot: 'belongings-table#r0c2' }] });
  }
  const work = rt.submit('work_at', B.work);
  until(rt, () => { const w = readWorkstation(rt, B.work.station); return !('code' in w) && w.elapsed >= 2; });
  rt.cancel(work.id); until(rt, () => !rt.isActive(work.id));
  const session = rt.submit('classroom_session', classroomParams(count));
  until(rt, () => readClassroom(rt, session.id)?.phase === 'presenting');
  const params: PurposefulRoutineParams = {
    actor: B.work.actor, session: session.id,
    work: { station: B.work.station, seat: B.work.seat, task: B.work.task!, duration: B.work.duration },
    food: { pot: B.pot, participants: structuredClone(B.people), at: B.conversation.at },
    rest: { seat: count === 4 ? 'seat8#seat' : 'seat12#seat', seconds: 3 }, departure: [10, 12],
  };
  return { rt, params, session };
}
function finished(rt: Runtime, action: string) {
  until(rt, () => !rt.isActive(action) || ['paused', 'waiting'].includes(readPurposefulRoutine(rt, action)!.mode));
  const rec = rt.records.get(action)!;
  assert.equal(rec.status, 'completed', JSON.stringify(readPurposefulRoutine(rt, action), null, 2));
}
function clean(rt: Runtime) {
  assert.deepEqual(rt.violations, []);
  for (const e of Object.values(rt.world.entities)) {
    if (e.human) { assert.deepEqual(rt.holder(`actor:${e.id}`), []); assert.equal(e.human.task, undefined); }
    assert.notEqual(e.support?.kind, 'none');
  }
}
for (const count of [4, 8] as const) test(`purposeful routine joins real ${count} gathering, eats/rests and finishes same notes`, () => {
  const { rt, params, session } = setup(count), initial = readWorkstation(rt, B.work.station);
  const rec = rt.submit('purposeful_routine', params);
  assert.notEqual(rec.status, 'failed', rec.diagnostic?.message);
  assert.deepEqual(rt.holder('actor:worker'), [], 'logical coordinator never reserves the physical actor');
  finished(rt, rec.id);
  const read = readPurposefulRoutine(rt, rec.id)!;
  assert.equal(read.progress.questionAsked, true);
  assert.deepEqual(read.progress.presenters, ['presenter1', 'presenter2']);
  assert.equal(read.progress.conversationSeen, true);
  assert.equal(read.progress.restSeconds, 3);
  assert.ok(read.progress.meal.every(p => p.served && p.consumed && p.returned));
  const final = readWorkstation(rt, B.work.station);
  assert.ok(!('code' in initial) && !('code' in final));
  assert.equal(final.status, 'completed'); assert.equal(final.task, initial.task); assert.equal(final.user, initial.user);
  assert.equal(final.duration, initial.duration); assert.equal(final.elapsed, final.duration);
  assert.equal(session.status, 'completed');
  assert.deepEqual(heldBy(rt.world, 'worker'), []); assert.deepEqual(heldBy(rt.world, 'visitor'), []);
  assert.deepEqual(rt.holder('routine:worker'), []); clean(rt);
});

function start(count: 4 | 8 = 4) {
  const ready = setup(count), routine = ready.rt.submit('purposeful_routine', ready.params);
  assert.notEqual(routine.status, 'failed', routine.diagnostic?.message);
  return { ...ready, routine };
}
function pause(rt: Runtime, routine: string) {
  complete(rt, 'purposeful_routine_control', { routine, intent: 'pause' });
  until(rt, () => ['paused', 'waiting'].includes(readPurposefulRoutine(rt, routine)!.mode));
}
function resume(rt: Runtime, routine: string) {
  complete(rt, 'purposeful_routine_control', { routine, intent: 'resume' });
}

test('routine pause leaves only its classroom worker and resume never replaces the bound session', () => {
  const { rt, routine, session } = start();
  until(rt, () => readClassroom(rt, session.id)?.participants.some(p => p.actor === 'worker' && p.arrival === 'seated') === true);
  pause(rt, routine.id);
  assert.equal(rt.isActive(session.id), true);
  assert.equal(session.status, 'executing');
  assert.equal(readClassroom(rt, session.id)!.participants.find(p => p.actor === 'guest1')!.state, 'participating');
  assert.equal(readClassroom(rt, session.id)!.participants.find(p => p.actor === 'worker')!.state, 'excluded');
  const departures = [...rt.records.values()].filter(r => r.verb === 'classroom_control' && (r.params as { intent: { kind: string } }).intent.kind === 'depart');
  assert.equal(departures.length, 1);
  assert.deepEqual((departures[0].params as { intent: unknown }).intent, { kind: 'depart', actor: 'worker' });
  until(rt, () => !rt.holder('actor:worker').length && rt.world.entities.worker.human?.activity === 'idle');
  resume(rt, routine.id); finished(rt, routine.id);
  assert.equal(readPurposefulRoutine(rt, routine.id)!.bindings.session, session.id);
  clean(rt);
});

for (const portion of ['partial', 'consumed'] as const) test(`routine ${portion} meal pause/resume retains serving lineage and never refills`, () => {
  const { rt, routine } = start();
  until(rt, () => {
    const meal = readPurposefulRoutine(rt, routine.id)!.progress.meal;
    return portion === 'partial' ? meal.some(p => p.fraction > 0 && p.fraction < 1) : meal.every(p => p.consumed);
  });
  pause(rt, routine.id);
  const paused = readPurposefulRoutine(rt, routine.id)!;
  const pot = rt.world.entities[B.pot].contents!.fraction;
  const servings = [...rt.records.values()].filter(r => r.verb === 'serve' && r.status === 'completed').length;
  assert.ok(paused.progress.meal.every(p => p.served));
  resume(rt, routine.id); finished(rt, routine.id);
  assert.equal(rt.world.entities[B.pot].contents!.fraction, pot, 'no new serving after retained portions');
  assert.equal([...rt.records.values()].filter(r => r.verb === 'serve' && r.status === 'completed').length, servings);
  assert.ok(readPurposefulRoutine(rt, routine.id)!.progress.meal.every(p => p.consumed && p.returned));
  clean(rt);
});

test('rest interruption retains dwell budget and unfinished work while independent direction wins', () => {
  const { rt, routine } = start();
  until(rt, () => readPurposefulRoutine(rt, routine.id)!.progress.restSeconds >= 1);
  const prior = readPurposefulRoutine(rt, routine.id)!;
  const direction = rt.submit('walk_to', { actor: 'worker', x: 12, z: 10 });
  assert.notEqual(direction.status, 'failed', direction.diagnostic?.message);
  until(rt, () => ['paused', 'waiting'].includes(readPurposefulRoutine(rt, routine.id)!.mode));
  until(rt, () => !rt.isActive(direction.id));
  assert.equal(direction.status, 'completed');
  const paused = readPurposefulRoutine(rt, routine.id)!;
  assert.equal(paused.progress.restSeconds, prior.progress.restSeconds);
  assert.equal(paused.progress.workElapsed, prior.progress.workElapsed);
  resume(rt, routine.id); finished(rt, routine.id);
  assert.equal(readPurposefulRoutine(rt, routine.id)!.progress.restSeconds, 3);
  clean(rt);
});

test('pause after only first serving resumes untouched participant and shared conversation exactly once', () => {
  const { rt, routine } = start();
  until(rt, () => readPurposefulRoutine(rt, routine.id)!.progress.meal.filter(p => p.served).length === 1);
  pause(rt, routine.id);
  const served = readPurposefulRoutine(rt, routine.id)!.progress.meal.filter(p => p.served).map(p => p.actor);
  resume(rt, routine.id); finished(rt, routine.id);
  for (const person of B.people) {
    const ownServes = [...rt.records.values()].filter(r => r.verb === 'serve' && (r.params as { actor?: string }).actor === person.actor && r.history.some(h => h.status === 'executing'));
    assert.equal(ownServes.length, 1, `${person.actor} receives one meal`);
  }
  assert.equal(served.length, 1);
  assert.ok([...rt.records.values()].some(r => r.parent === routine.id && r.verb === 'converse' && r.history.some(h => h.phase === 'talking')));
  clean(rt);
});

test('terminal End leaves only worker from foreign session and drains own logical claims', () => {
  const { rt, routine, session } = start();
  until(rt, () => readClassroom(rt, session.id)?.participants.some(p => p.actor === 'worker' && p.arrival === 'seated') === true);
  complete(rt, 'purposeful_routine_control', { routine: routine.id, intent: 'end' });
  until(rt, () => !rt.isActive(routine.id));
  assert.equal(routine.status, 'cancelled');
  assert.equal(rt.isActive(session.id), true);
  assert.equal(readClassroom(rt, session.id)!.participants.find(p => p.actor === 'guest1')!.state, 'participating');
  assert.deepEqual(rt.holder('routine:worker'), []);
  const denied = rt.submit('purposeful_routine_control', { routine: routine.id, intent: 'resume' });
  assert.equal(denied.status, 'failed'); assert.equal(denied.diagnostic?.code, 'routine.inactive');
  until(rt, () => !rt.isActive(session.id)); clean(rt);
});

for (const invalid of ['missing-food', 'foreign-task', 'foreign-work', 'inactive-session', 'missing-rest'] as const)
  test(`invalid ${invalid} binding refuses before routine effects`, () => {
    const { rt, params } = setup();
    if (invalid === 'missing-food') params.food.pot = 'missing-pot';
    if (invalid === 'foreign-task') params.work.task = 'Somebody else notes';
    if (invalid === 'foreign-work') rt.submit('work_at', { ...B.work, resume: true });
    if (invalid === 'inactive-session') params.session = 'missing-session';
    if (invalid === 'missing-rest') params.rest.seat = 'missing-seat#seat';
    const hash = rt.stateHash(), count = rt.records.size;
    const denied = rt.submit('purposeful_routine', params);
    assert.equal(denied.status, 'failed'); assert.match(denied.diagnostic!.code, /^routine\./);
    assert.equal(rt.stateHash(), hash); assert.equal(rt.records.size, count + 1);
    assert.deepEqual(rt.holder('routine:worker'), []);
  });

test('paused logical intent remains unique; cloned readout cannot mutate its authority', () => {
  const { rt, routine, params } = start();
  pause(rt, routine.id);
  until(rt, () => !rt.holder('actor:worker').length && rt.world.entities.worker.human!.activity === 'idle');
  const duplicate = rt.submit('purposeful_routine', params);
  assert.equal(duplicate.status, 'failed'); assert.equal(duplicate.diagnostic?.code, 'reservation.conflict');
  const original = readPurposefulRoutine(rt, routine.id)!;
  const read = readPurposefulRoutine(rt, routine.id)!;
  read.bindings.actor = 'visitor'; read.bindings.food.participants[0].bowl = 'foreign';
  read.progress.meal[0].consumed = true; read.progress.presenters.push('fiction'); read.ownedActions.push('foreign');
  assert.deepEqual(readPurposefulRoutine(rt, routine.id), original);
});

test('foreign changes to paused retained food cause explicit wait without guessing consumption/refill', () => {
  const { rt, routine } = start();
  until(rt, () => readPurposefulRoutine(rt, routine.id)!.progress.meal.some(p => p.fraction > 0 && p.fraction < 1));
  pause(rt, routine.id);
  const prior = readPurposefulRoutine(rt, routine.id)!, amount = rt.world.entities[B.pot].contents!.fraction;
  rt.world.entities['worker-bowl'].contents!.fraction = 0;
  const denied = rt.submit('purposeful_routine_control', { routine: routine.id, intent: 'resume' });
  assert.equal(denied.status, 'failed'); assert.equal(denied.diagnostic?.code, 'routine.food-changed');
  rt.step();
  assert.deepEqual(readPurposefulRoutine(rt, routine.id)!.progress.meal, prior.progress.meal);
  assert.equal(rt.world.entities[B.pot].contents!.fraction, amount);
});

test('timed routine commands reproduce authoritative state and child outcomes deterministically', () => {
  const a = start(), b = start();
  until(a.rt, () => readPurposefulRoutine(a.rt, a.routine.id)!.progress.restSeconds >= 1);
  while (b.rt.tick < a.rt.tick) b.rt.step();
  pause(a.rt, a.routine.id); pause(b.rt, b.routine.id);
  assert.equal(a.rt.tick, b.rt.tick);
  resume(a.rt, a.routine.id); resume(b.rt, b.routine.id);
  finished(a.rt, a.routine.id); finished(b.rt, b.routine.id);
  assert.equal(a.rt.stateHash(), b.rt.stateHash());
  assert.deepEqual([...a.rt.records.values()], [...b.rt.records.values()]);
  assert.deepEqual(readPurposefulRoutine(a.rt, a.routine.id), readPurposefulRoutine(b.rt, b.routine.id));
});

test('late foreign occupied rest seat waits without cancelling its occupant or repeating failed requests', () => {
  const { rt, routine, params } = start();
  until(rt, () => readPurposefulRoutine(rt, routine.id)!.progress.meal.every(p => p.consumed));
  const foreign = rt.submit('sit', { actor: 'guest1', slot: params.rest.seat });
  assert.notEqual(foreign.status, 'failed', foreign.diagnostic?.message);
  until(rt, () => readPurposefulRoutine(rt, routine.id)!.mode === 'waiting');
  const waiting = readPurposefulRoutine(rt, routine.id)!, count = rt.records.size;
  assert.equal(waiting.diagnostic?.code, 'routine.child-refused');
  assert.equal(rt.isActive(foreign.id), true);
  for (let i = 0; i < 100; i++) rt.step();
  assert.equal(rt.records.size, count, 'named coordinator wait does not spam admissions');
  assert.equal(rt.isActive(foreign.id), true);
  rt.cancel(foreign.id); until(rt, () => !rt.isActive(foreign.id));
  resume(rt, routine.id); finished(rt, routine.id); clean(rt);
});

test('foreign changes to paused utensil support refuse without acquiring substitute objects', () => {
  const { rt, routine } = start();
  until(rt, () => readPurposefulRoutine(rt, routine.id)!.progress.meal.some(p => p.fraction > 0 && p.fraction < 1));
  pause(rt, routine.id);
  rt.world.entities['worker-spoon'].support = { kind: 'ground' };
  const count = rt.records.size;
  const denied = rt.submit('purposeful_routine_control', { routine: routine.id, intent: 'resume' });
  assert.equal(denied.status, 'failed'); assert.equal(denied.diagnostic?.code, 'routine.food-changed');
  assert.equal(rt.records.size, count + 1);
});

test('pause after question queue before worker floor clears latch and asks once on same-session resume', () => {
  const { rt, params, session } = setup();
  for (let i = 0; i < 3; i++) rt.submit('classroom_control', { session: session.id, intent: { kind: 'question', actor: 'guest1' } });
  const routine = rt.submit('purposeful_routine', params);
  until(rt, () => [...rt.records.values()].some(r => r.parent === routine.id && r.verb === 'classroom_control' && (r.params as { intent: { kind: string } }).intent.kind === 'question'));
  assert.equal(readPurposefulRoutine(rt, routine.id)!.progress.questionAsked, false);
  pause(rt, routine.id);
  assert.equal(readPurposefulRoutine(rt, routine.id)!.progress.questionAsked, false);
  until(rt, () => !rt.holder('actor:worker').length && rt.world.entities.worker.human!.activity === 'idle');
  resume(rt, routine.id); finished(rt, routine.id);
  const asked = rt.events.filter(e => e.type === 'mark' && e.name === 'classroom.question' && (e.data as { actor?: string; session?: string }).actor === 'worker' && (e.data as { session?: string }).session === session.id);
  assert.equal(asked.length, 1);
  assert.equal(readPurposefulRoutine(rt, routine.id)!.progress.questionAsked, true);
  clean(rt);
});

test('completed routine retains its actual notes progress when another actor reuses the computer', () => {
  const { rt, routine, params } = start();
  finished(rt, routine.id);
  assert.equal(readPurposefulRoutine(rt, routine.id)!.progress.workElapsed, 30);
  const next = rt.submit('work_at', { actor: 'presenter1', station: params.work.station, seat: params.work.seat, task: 'Talk follow-up', duration: 4 });
  assert.notEqual(next.status, 'failed', next.diagnostic?.message);
  until(rt, () => { const w = readWorkstation(rt, params.work.station); return !('code' in w) && w.user === 'presenter1' && w.task === 'Talk follow-up' && w.elapsed >= 1; });
  const current = readWorkstation(rt, params.work.station);
  assert.ok(!('code' in current));
  assert.equal(current.user, 'presenter1'); assert.equal(current.task, 'Talk follow-up');
  assert.ok(current.elapsed >= 1 && current.elapsed < 4);
  const authority = structuredClone(rt.services.purposefulRoutines);
  assert.equal(readPurposefulRoutine(rt, routine.id)!.progress.workElapsed, 30);
  assert.deepEqual(rt.services.purposefulRoutines, authority, 'getter does not update retained authority');
  until(rt, () => !rt.isActive(next.id));
  assert.equal(next.status, 'completed');
  assert.equal(readPurposefulRoutine(rt, routine.id)!.progress.workElapsed, 30);
  clean(rt);
});

test('completed routine stays frozen when worker starts a new task with identical bindings', () => {
  const { rt, routine, params } = start();
  finished(rt, routine.id);
  const historical = readPurposefulRoutine(rt, routine.id)!;
  assert.equal(historical.progress.workElapsed, 30);
  const next = rt.submit('work_at', { actor: params.actor, ...params.work });
  assert.notEqual(next.status, 'failed', next.diagnostic?.message);
  until(rt, () => { const w = readWorkstation(rt, params.work.station); return !('code' in w) && w.action === next.id && w.status === 'active' && w.elapsed === 0; });
  assert.deepEqual(readPurposefulRoutine(rt, routine.id), historical);
  until(rt, () => { const w = readWorkstation(rt, params.work.station); return !('code' in w) && w.action === next.id && w.elapsed >= 1; });
  assert.deepEqual(readPurposefulRoutine(rt, routine.id), historical);
  rt.cancel(next.id); until(rt, () => !rt.isActive(next.id));
  assert.deepEqual(readPurposefulRoutine(rt, routine.id), historical);
  clean(rt);
});

for (const mismatch of ['user', 'task', 'durationSeconds'] as const)
  test(`interrupted routine retains observed work rather than mismatched ${mismatch} progress`, () => {
    const { rt, routine, params } = start();
    until(rt, () => readPurposefulRoutine(rt, routine.id)!.progress.workElapsed >= 5);
    pause(rt, routine.id);
    const retained = readPurposefulRoutine(rt, routine.id)!.progress.workElapsed;
    assert.ok(retained >= 5 && retained < 30);
    // Adversarial foreign equipment state: identity must match every binding.
    const config = rt.world.entities[params.work.station].equipment!.config;
    config[mismatch] = mismatch === 'durationSeconds' ? 40 : 'foreign';
    config.workSeconds = 17;
    rt.step();
    const authority = structuredClone(rt.services.purposefulRoutines);
    assert.equal(readPurposefulRoutine(rt, routine.id)!.progress.workElapsed, retained);
    assert.deepEqual(rt.services.purposefulRoutines, authority);
    assert.equal(readPurposefulRoutine(rt, routine.id)!.mode, 'paused');
    assert.deepEqual(rt.violations, []);
  });
