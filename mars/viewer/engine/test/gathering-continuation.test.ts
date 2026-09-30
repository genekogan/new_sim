import test from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, servicesFor, ENGINE_INVARIANTS } from '../api/registry.ts';
import { classroomScene, classroomParams } from '../scenarios/classroom.ts';
import { WORK_BREAK_BINDING as B, workBreakWorld } from '../scenarios/work-break.ts';
import { readClassroom } from '../activities/classroom.ts';
import { readPurposefulRoutine } from '../activities/purposeful-routine.ts';
import { readGatheringContinuation } from '../activities/gathering-continuation.ts';
import type { GatheringContinuationParams } from '../activities/gathering-continuation.ts';
import { readWorkstation } from '../objects/workstation.ts';

function until(rt: Runtime, done: () => boolean, max = 18000) {
  for (let i = 0; i < max && !done(); i++) rt.step();
  assert.ok(done(), JSON.stringify([...rt.records.values()].filter(r => rt.isActive(r.id)), null, 2));
  assert.deepEqual(rt.violations, []);
}
function complete(rt: Runtime, verb: string, params: unknown) {
  const rec = rt.submit(verb, params);
  assert.notEqual(rec.status, 'failed', rec.diagnostic?.message);
  until(rt, () => !rt.isActive(rec.id)); assert.equal(rec.status, 'completed', rec.diagnostic?.message);
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
  const notes = rt.submit('work_at', B.work);
  until(rt, () => { const w = readWorkstation(rt, B.work.station); return !('code' in w) && w.elapsed >= 2; });
  rt.cancel(notes.id); until(rt, () => !rt.isActive(notes.id));
  const session = rt.submit('classroom_session', classroomParams(count));
  until(rt, () => readClassroom(rt, session.id)?.phase === 'presenting');
  const routine = rt.submit('purposeful_routine', { actor: 'worker', session: session.id,
    work: { station: B.work.station, seat: B.work.seat, task: B.work.task, duration: B.work.duration },
    food: { pot: B.pot, participants: structuredClone(B.people), at: B.conversation.at },
    rest: { seat: count === 4 ? 'seat8#seat' : 'seat12#seat', seconds: 3 }, departure: [10, 12],
  });
  assert.notEqual(routine.status, 'failed', routine.diagnostic?.message);
  const workParams: GatheringContinuationParams = { session: session.id, binding: {
    kind: 'work', actor: 'presenter1', work: { station: B.work.station, seat: B.work.seat, task: 'Record talk follow-up', duration: 12 },
    prerequisite: { routine: routine.id, actor: 'worker', station: B.work.station, task: B.work.task!, duration: B.work.duration },
  } };
  const discussionParams: GatheringContinuationParams = { session: session.id, binding: { kind: 'discussion', actors: ['guest1', 'guest2'], at: [-7, 6], duration: 20 } };
  return { rt, session, routine, workParams, discussionParams };
}
function start(count: 4 | 8 = 4) {
  const ready = setup(count), work = ready.rt.submit('gathering_continuation', ready.workParams), discussion = ready.rt.submit('gathering_continuation', ready.discussionParams);
  assert.notEqual(work.status, 'failed', work.diagnostic?.message); assert.notEqual(discussion.status, 'failed', discussion.diagnostic?.message);
  return { ...ready, work, discussion };
}
function finish(rt: Runtime, action: string) {
  until(rt, () => !rt.isActive(action) || readGatheringContinuation(rt, action)?.mode === 'waiting');
  assert.equal(rt.records.get(action)!.status, 'completed', JSON.stringify(readGatheringContinuation(rt, action), null, 2));
}
function pause(rt: Runtime, action: string) {
  complete(rt, 'gathering_continuation_control', { continuation: action, intent: 'pause' });
  until(rt, () => readGatheringContinuation(rt, action)?.mode === 'paused');
}
function clean(rt: Runtime) {
  assert.deepEqual(rt.violations, []);
  for (const e of Object.values(rt.world.entities)) {
    if (e.human) { assert.deepEqual(rt.holder(`actor:${e.id}`), []); assert.equal(e.human.task, undefined); }
    assert.notEqual(e.support?.kind, 'none');
  }
}

for (const count of [4, 8] as const) test(`real ${count} departure supports concurrent discussion and exact-notes follow-up work`, () => {
  const { rt, session, routine, work, discussion, workParams } = start(count);
  assert.equal(readGatheringContinuation(rt, discussion.id)!.elapsed, 0);
  assert.equal(rt.holder('actor:guest1').includes(discussion.id), false);
  until(rt, () => readGatheringContinuation(rt, discussion.id)!.elapsed >= 1);
  assert.equal(session.status, 'completed');
  const pair = readGatheringContinuation(rt, discussion.id)!, waiting = readGatheringContinuation(rt, work.id)!;
  assert.equal(waiting.mode, 'awaiting'); assert.equal(waiting.diagnostic?.code, 'continuation.await-notes');
  assert.equal(waiting.elapsed, 0); assert.equal(rt.isActive(routine.id), true);
  assert.ok(pair.floorHolder && pair.attentionTarget);
  for (const actor of ['guest1', 'guest2']) {
    assert.equal(rt.world.entities[actor].human!.task, pair.child);
    assert.equal(rt.world.entities[actor].human!.activity, 'talk');
  }
  const floor = pair.floorHolder;
  until(rt, () => readGatheringContinuation(rt, discussion.id)!.floorHolder !== floor);
  assert.ok(readGatheringContinuation(rt, discussion.id)!.floorHolder);
  until(rt, () => readGatheringContinuation(rt, work.id)!.elapsed >= 1);
  assert.equal(routine.status, 'completed'); assert.equal(readPurposefulRoutine(rt, routine.id)!.progress.workElapsed, 30);
  const w = readWorkstation(rt, B.work.station); assert.ok(!('code' in w));
  assert.equal(w.user, 'presenter1'); assert.equal(w.task, 'Record talk follow-up'); assert.equal(w.status, 'active');
  finish(rt, work.id); finish(rt, discussion.id);
  assert.equal(readGatheringContinuation(rt, work.id)!.elapsed, 12);
  assert.equal(readGatheringContinuation(rt, discussion.id)!.elapsed, 20);
  assert.equal(readPurposefulRoutine(rt, routine.id)!.progress.workElapsed, 30);
  for (const a of ['worker', 'presenter1', 'guest1', 'guest2']) assert.deepEqual(rt.holder(`routine:${a}`), []);
  const historical = readGatheringContinuation(rt, work.id)!;
  assert.equal(workParams.binding.kind, 'work');
  if (workParams.binding.kind === 'work') complete(rt, 'work_at', { actor: 'presenter1', ...workParams.binding.work });
  assert.deepEqual(readGatheringContinuation(rt, work.id), historical);
  clean(rt);
});

test('directed guest movement pauses only discussion, then resumes remaining real talk with same partner', () => {
  const { rt, discussion, work, routine } = start();
  until(rt, () => readGatheringContinuation(rt, discussion.id)!.elapsed >= 2);
  const directed = rt.submit('walk_to', { actor: 'guest1', x: -10, z: 9 });
  assert.notEqual(directed.status, 'failed', directed.diagnostic?.message);
  until(rt, () => readGatheringContinuation(rt, discussion.id)!.mode === 'waiting' && !rt.isActive(directed.id));
  const retained = readGatheringContinuation(rt, discussion.id)!;
  assert.equal(retained.diagnostic?.code, 'continuation.directed-away'); assert.ok(retained.elapsed >= 2 && retained.elapsed < 20);
  assert.equal(rt.isActive(work.id), true); assert.equal(rt.isActive(routine.id), true);
  assert.deepEqual(rt.holder('actor:guest1'), []); assert.deepEqual(rt.holder('actor:guest2'), []);
  const records = rt.records.size; for (let i = 0; i < 40; i++) rt.step(); assert.equal(rt.records.size, records);
  complete(rt, 'gathering_continuation_control', { continuation: discussion.id, intent: 'resume' });
  finish(rt, discussion.id); finish(rt, work.id);
  const children = [...rt.records.values()].filter(r => r.parent === discussion.id && r.verb === 'converse');
  assert.equal(children.length, 2); assert.ok(children.every(r => JSON.stringify((r.params as { actors: string[] }).actors) === JSON.stringify(['guest1', 'guest2'])));
  assert.equal(readGatheringContinuation(rt, discussion.id)!.elapsed, 20); clean(rt);
});

test('pause and terminal End of presenter work preserve pair and worker; partial work resumes same task', () => {
  const { rt, discussion, work, routine, workParams } = start();
  pause(rt, work.id);
  assert.equal(rt.isActive(routine.id), true); assert.equal(rt.isActive(discussion.id), true);
  complete(rt, 'gathering_continuation_control', { continuation: work.id, intent: 'resume' });
  assert.equal(readGatheringContinuation(rt, work.id)!.mode, 'awaiting');
  assert.equal(readGatheringContinuation(rt, work.id)!.child, undefined, 'early Resume observes its exact gate without taking the classroom actor');
  until(rt, () => readGatheringContinuation(rt, work.id)!.elapsed >= 2);
  pause(rt, work.id); const retained = readGatheringContinuation(rt, work.id)!.elapsed;
  assert.ok(retained >= 2 && retained < 12); assert.deepEqual(rt.holder('actor:presenter1'), []);
  const partial = readWorkstation(rt, B.work.station); assert.ok(!('code' in partial)); assert.equal(partial.status, 'unfinished'); assert.equal(partial.elapsed, retained);
  complete(rt, 'gathering_continuation_control', { continuation: work.id, intent: 'resume' });
  until(rt, () => readGatheringContinuation(rt, work.id)!.elapsed > retained);
  complete(rt, 'gathering_continuation_control', { continuation: work.id, intent: 'end' }); until(rt, () => !rt.isActive(work.id));
  assert.equal(work.status, 'cancelled'); assert.equal(routine.status, 'completed');
  finish(rt, discussion.id);
  const historical = readGatheringContinuation(rt, work.id)!;
  assert.ok(historical.elapsed > retained && historical.elapsed < 12);
  assert.deepEqual(rt.holder('routine:presenter1'), []);
  if (workParams.binding.kind === 'work') complete(rt, 'work_at', { actor: 'presenter1', ...workParams.binding.work, resume: true });
  assert.deepEqual(readGatheringContinuation(rt, work.id), historical); clean(rt);
});

test('End of active discussion releases both local intentions without touching waiting work or classroom', () => {
  const { rt, discussion, work, routine, session } = start();
  until(rt, () => readGatheringContinuation(rt, discussion.id)!.elapsed >= 1);
  complete(rt, 'gathering_continuation_control', { continuation: discussion.id, intent: 'end' }); until(rt, () => !rt.isActive(discussion.id));
  assert.equal(discussion.status, 'cancelled'); assert.equal(session.status, 'completed');
  assert.equal(rt.isActive(work.id), true); assert.equal(rt.isActive(routine.id), true);
  for (const a of ['guest1', 'guest2']) { assert.deepEqual(rt.holder(`routine:${a}`), []); assert.deepEqual(rt.holder(`actor:${a}`), []); }
  finish(rt, work.id); clean(rt);
});

test('cancelled exact prerequisite gives sticky named wait and never adopts a later notes intention', () => {
  const { rt, work, discussion, routine, session } = start();
  rt.cancel(routine.id); until(rt, () => !rt.isActive(routine.id));
  until(rt, () => session.status === 'completed' && readGatheringContinuation(rt, work.id)!.mode === 'waiting');
  const prior = readWorkstation(rt, B.work.station), count = rt.records.size;
  assert.equal(readGatheringContinuation(rt, work.id)!.diagnostic?.code, 'continuation.prerequisite-ended');
  for (let i = 0; i < 100; i++) rt.step(); assert.equal(rt.records.size, count);
  assert.deepEqual(readWorkstation(rt, B.work.station), prior);
  const denied = rt.submit('gathering_continuation_control', { continuation: work.id, intent: 'resume' });
  assert.equal(denied.status, 'failed'); assert.equal(denied.diagnostic?.code, 'continuation.prerequisite-ended');
  finish(rt, discussion.id);
  complete(rt, 'gathering_continuation_control', { continuation: work.id, intent: 'end' }); until(rt, () => !rt.isActive(work.id)); clean(rt);
});

test('occupied work seat causes stable refusal; explicit retry after ordinary release completes', () => {
  const { rt, work, discussion, routine } = start();
  pause(rt, work.id); finish(rt, discussion.id);
  until(rt, () => !rt.isActive(routine.id)); assert.equal(routine.status, 'completed');
  const foreign = rt.submit('sit', { actor: 'guest1', slot: B.work.seat });
  assert.notEqual(foreign.status, 'failed', foreign.diagnostic?.message); until(rt, () => foreign.phase === 'occupied');
  complete(rt, 'gathering_continuation_control', { continuation: work.id, intent: 'resume' });
  until(rt, () => readGatheringContinuation(rt, work.id)!.mode === 'waiting');
  const current = readWorkstation(rt, B.work.station), count = rt.records.size;
  assert.equal(readGatheringContinuation(rt, work.id)!.diagnostic?.code, 'continuation.child-refused');
  for (let i = 0; i < 100; i++) rt.step(); assert.equal(rt.records.size, count); assert.equal(rt.isActive(foreign.id), true);
  assert.deepEqual(readWorkstation(rt, B.work.station), current);
  rt.cancel(foreign.id); until(rt, () => !rt.isActive(foreign.id));
  complete(rt, 'gathering_continuation_control', { continuation: work.id, intent: 'resume' }); finish(rt, work.id); clean(rt);
});

test('paused continuation never adopts an independent completion of the same follow-up task', () => {
  const { rt, work, discussion, workParams } = start();
  until(rt, () => readGatheringContinuation(rt, work.id)!.elapsed >= 2);
  pause(rt, work.id); const prior = readGatheringContinuation(rt, work.id)!;
  if (workParams.binding.kind === 'work') complete(rt, 'work_at', { actor: 'presenter1', ...workParams.binding.work, resume: true });
  assert.equal(readGatheringContinuation(rt, work.id)!.elapsed, prior.elapsed);
  const denied = rt.submit('gathering_continuation_control', { continuation: work.id, intent: 'resume' });
  assert.equal(denied.status, 'failed'); assert.equal(denied.diagnostic?.code, 'continuation.work-changed');
  complete(rt, 'gathering_continuation_control', { continuation: work.id, intent: 'end' }); until(rt, () => !rt.isActive(work.id));
  finish(rt, discussion.id); clean(rt);
});

test('cancelled gathering refuses departure success and ending its intentions leaves worker cleanup alone', () => {
  const { rt, work, discussion, session, routine } = start();
  rt.cancel(session.id); until(rt, () => !rt.isActive(session.id));
  until(rt, () => readGatheringContinuation(rt, work.id)!.mode === 'waiting' && readGatheringContinuation(rt, discussion.id)!.mode === 'waiting');
  for (const action of [work, discussion]) {
    assert.equal(readGatheringContinuation(rt, action.id)!.diagnostic?.code, 'continuation.session-ended');
    assert.equal(readGatheringContinuation(rt, action.id)!.elapsed, 0);
    complete(rt, 'gathering_continuation_control', { continuation: action.id, intent: 'end' }); until(rt, () => !rt.isActive(action.id));
  }
  assert.equal(rt.isActive(routine.id), true, 'continuation End does not cancel unrelated worker routine');
  rt.cancel(routine.id); until(rt, () => !rt.isActive(routine.id)); clean(rt);
});

for (const invalid of ['session', 'participant', 'duplicate', 'prerequisite', 'task', 'station', 'seat'] as const)
  test(`invalid ${invalid} continuation refuses before effects`, () => {
    const { rt, workParams, discussionParams } = setup();
    const p = structuredClone(invalid === 'participant' || invalid === 'duplicate' ? discussionParams : workParams);
    if (invalid === 'session') p.session = 'missing-session';
    if (p.binding.kind === 'discussion') p.binding.actors = invalid === 'duplicate' ? ['guest1', 'guest1'] : ['guest1', 'missing'];
    else {
      if (invalid === 'prerequisite') p.binding.prerequisite.routine = 'missing';
      if (invalid === 'task') p.binding.prerequisite.task = 'foreign';
      if (invalid === 'station') p.binding.work.station = 'missing';
      if (invalid === 'seat') p.binding.work.seat = 'missing#seat';
    }
    const hash = rt.stateHash(), count = rt.records.size;
    const denied = rt.submit('gathering_continuation', p); assert.equal(denied.status, 'failed');
    assert.match(denied.diagnostic!.code, /^continuation\./); assert.equal(rt.stateHash(), hash); assert.equal(rt.records.size, count + 1);
    assert.deepEqual(rt.holder('routine:presenter1'), []); assert.deepEqual(rt.holder('routine:guest1'), []);
  });

test('shared logical claims prevent overlapping commitments and readout cannot mutate authority', () => {
  const { rt, work, workParams, discussion, discussionParams } = start();
  const duplicate = rt.submit('gathering_continuation', discussionParams);
  assert.equal(duplicate.status, 'failed'); assert.equal(duplicate.diagnostic?.code, 'reservation.conflict');
  const overlap = rt.submit('gathering_continuation', { ...discussionParams, binding: { kind: 'discussion', actors: ['guest1', 'presenter1'], at: [-7, 6], duration: 20 } });
  assert.equal(overlap.status, 'failed'); assert.equal(overlap.diagnostic?.code, 'reservation.conflict');
  const original = readGatheringContinuation(rt, work.id)!, altered = readGatheringContinuation(rt, work.id)!;
  altered.bindings.session = 'foreign'; altered.elapsed = 999; altered.ownedActions.push('foreign');
  if (altered.bindings.binding.kind === 'work') altered.bindings.binding.work.task = 'foreign';
  assert.deepEqual(readGatheringContinuation(rt, work.id), original);
  assert.deepEqual(original.bindings, workParams);
  pause(rt, discussion.id); assert.deepEqual(rt.holder('routine:guest1'), [discussion.id]);
});

test('same timed discussion intervention reproduces world, children, marks and readouts exactly', () => {
  const a = start(), b = start();
  until(a.rt, () => readGatheringContinuation(a.rt, a.discussion.id)!.elapsed >= 2);
  while (b.rt.tick < a.rt.tick) b.rt.step();
  pause(a.rt, a.discussion.id); pause(b.rt, b.discussion.id);
  assert.equal(a.rt.tick, b.rt.tick);
  complete(a.rt, 'gathering_continuation_control', { continuation: a.discussion.id, intent: 'resume' });
  complete(b.rt, 'gathering_continuation_control', { continuation: b.discussion.id, intent: 'resume' });
  finish(a.rt, a.work.id); finish(b.rt, b.work.id); finish(a.rt, a.discussion.id); finish(b.rt, b.discussion.id);
  assert.equal(a.rt.stateHash(), b.rt.stateHash()); assert.deepEqual([...a.rt.records.values()], [...b.rt.records.values()]);
  assert.deepEqual(a.rt.events, b.rt.events); assert.deepEqual(readGatheringContinuation(a.rt, a.work.id), readGatheringContinuation(b.rt, b.work.id));
  assert.deepEqual(readGatheringContinuation(a.rt, a.discussion.id), readGatheringContinuation(b.rt, b.discussion.id)); clean(a.rt); clean(b.rt);
});
