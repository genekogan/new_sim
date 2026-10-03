import test from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, servicesFor, ENGINE_INVARIANTS } from '../api/registry.ts';
import { designStudioBindings, designStudioScene, designStudioWorld, designStudioRoutineParams, designStudioContinuationParams } from '../scenarios/design-studio.ts';
import { readClassroom } from '../activities/classroom.ts';
import { readPurposefulRoutine } from '../activities/purposeful-routine.ts';
import { readGatheringContinuation } from '../activities/gathering-continuation.ts';
import { readWorkstation } from '../objects/workstation.ts';
import { heldBy } from '../items/model.ts';
import { pairedMealWalk } from '../scenarios/paired-meal-walk.ts';

function runtime() {
  const world = designStudioWorld();
  return new Runtime(world, createRegistry(), servicesFor({ 'design-studio': designStudioScene() })(world), ENGINE_INVARIANTS);
}
function until(rt: Runtime, done: () => boolean, max = 16000) {
  for (let i = 0; i < max && !done(); i++) rt.step();
  assert.ok(done(), JSON.stringify([...rt.records.values()].filter(r => rt.isActive(r.id)), null, 2));
  assert.deepEqual(rt.violations, []);
}
function submit(rt: Runtime, verb: string, params: unknown) {
  const rec = rt.submit(verb, params); assert.notEqual(rec.status, 'failed', rec.diagnostic?.message); return rec;
}
function start(paired = false) {
  const rt = runtime(), b = designStudioBindings(), notes = submit(rt, 'work_at', b.workBreak.work);
  until(rt, () => { const w = readWorkstation(rt, b.workBreak.work.station); return !('code' in w) && w.elapsed >= 2; });
  rt.cancel(notes.id); until(rt, () => !rt.isActive(notes.id));
  const session = submit(rt, 'classroom_session', b.session);
  until(rt, () => readClassroom(rt, session.id)?.phase === 'presenting');
  const routineParams = designStudioRoutineParams(session.id);
  if (paired) routineParams.trip = pairedMealWalk(b.roles.worker, b.roles.companion, -9);
  const routine = submit(rt, 'purposeful_routine', routineParams);
  const params = designStudioContinuationParams(session.id, routine.id);
  const followUp = submit(rt, 'gathering_continuation', params.work), discussion = submit(rt, 'gathering_continuation', params.discussion);
  return { rt, b, session, routine, followUp, discussion };
}
function finish(run: ReturnType<typeof start>) {
  const { rt, routine, followUp, discussion } = run;
  until(rt, () => [routine, followUp, discussion].every(r => !rt.isActive(r.id)) ||
    readPurposefulRoutine(rt, routine.id)?.mode === 'waiting' || readGatheringContinuation(rt, followUp.id)?.mode === 'waiting' || readGatheringContinuation(rt, discussion.id)?.mode === 'waiting');
  for (const r of [routine, followUp, discussion]) assert.equal(r.status, 'completed', JSON.stringify({ record: r, routine: readPurposefulRoutine(rt, routine.id), followUp: readGatheringContinuation(rt, followUp.id), discussion: readGatheringContinuation(rt, discussion.id) }, null, 2));
}
function clean(rt: Runtime) {
  assert.deepEqual(rt.violations, []);
  for (const e of Object.values(rt.world.entities)) {
    if (e.human) {
      assert.deepEqual(rt.holder(`actor:${e.id}`), []); assert.deepEqual(rt.holder(`routine:${e.id}`), []);
      assert.equal(e.human.task, undefined); assert.deepEqual(heldBy(rt.world, e.id), []);
    }
    assert.notEqual(e.support?.kind, 'none');
  }
}

test('fresh studio runs ordinary critique, real question/rotation/discussion, lunch/rest and same unfinished project plus follow-up', () => {
  const run = start(), { rt, b, session, routine, followUp, discussion } = run;
  until(rt, () => readClassroom(rt, session.id)?.participants.some(p => p.actor === b.roles.worker && p.arrival === 'seated') === true);
  assert.ok(rt.holder(`actor:${b.roles.worker}`).length, 'ordinary classroom owns the actually seated editor');
  until(rt, () => readGatheringContinuation(rt, discussion.id)!.elapsed >= 1);
  assert.equal(session.status, 'completed'); assert.equal(rt.isActive(routine.id), true);
  assert.equal(readGatheringContinuation(rt, followUp.id)!.diagnostic?.code, 'continuation.await-notes');
  const pair = readGatheringContinuation(rt, discussion.id)!;
  assert.ok(pair.floorHolder && pair.attentionTarget);
  for (const actor of b.followUpDiscussion.actors) {
    assert.equal(rt.world.entities[actor].human!.task, pair.child); assert.equal(rt.world.entities[actor].human!.activity, 'talk');
  }
  const firstFloor = pair.floorHolder;
  until(rt, () => readGatheringContinuation(rt, discussion.id)!.floorHolder !== firstFloor);
  assert.ok(readGatheringContinuation(rt, discussion.id)!.floorHolder);
  finish(run);
  const own = readPurposefulRoutine(rt, routine.id)!;
  assert.equal(own.progress.questionAsked, true); assert.deepEqual(own.progress.presenters, b.roles.presenters);
  assert.equal(own.progress.conversationSeen, true); assert.ok(own.progress.meal.every(p => p.served && p.consumed && p.returned));
  assert.equal(own.progress.restSeconds, b.rest.seconds); assert.equal(own.progress.workElapsed, b.workBreak.work.duration);
  const computer = readWorkstation(rt, b.workBreak.work.station); assert.ok(!('code' in computer));
  assert.equal(computer.status, 'completed'); assert.equal(computer.user, b.followUpWork.actor); assert.equal(computer.task, b.followUpWork.work.task);
  assert.equal(readGatheringContinuation(rt, followUp.id)!.elapsed, b.followUpWork.work.duration);
  assert.equal(readGatheringContinuation(rt, discussion.id)!.elapsed, b.followUpDiscussion.duration);
  assert.equal(rt.events.filter(e => e.type === 'mark' && e.name === 'classroom.question' && (e.data as { actor?: string }).actor === b.roles.worker).length, 1);
  clean(rt);
});

test('local direction in studio pauses only the same bound reviewer pair and resumes remaining talk', () => {
  const run = start(), { rt, b, routine, followUp, discussion } = run;
  until(rt, () => readGatheringContinuation(rt, discussion.id)!.elapsed >= 2);
  const walk = submit(rt, 'walk_to', { actor: b.followUpDiscussion.actors[0], x: -11, z: 10 });
  until(rt, () => !rt.isActive(walk.id) && readGatheringContinuation(rt, discussion.id)!.mode === 'waiting');
  assert.equal(walk.status, 'completed'); assert.equal(rt.isActive(routine.id), true); assert.equal(rt.isActive(followUp.id), true);
  const partial = readGatheringContinuation(rt, discussion.id)!;
  assert.equal(partial.diagnostic?.code, 'continuation.directed-away'); assert.ok(partial.elapsed >= 2 && partial.elapsed < b.followUpDiscussion.duration);
  for (const actor of b.followUpDiscussion.actors) assert.deepEqual(rt.holder(`actor:${actor}`), []);
  const records = rt.records.size; for (let i = 0; i < 40; i++) rt.step(); assert.equal(rt.records.size, records);
  submit(rt, 'gathering_continuation_control', { continuation: discussion.id, intent: 'resume' });
  finish(run); assert.equal(readGatheringContinuation(rt, discussion.id)!.elapsed, b.followUpDiscussion.duration); clean(rt);
});

test('occupied studio computer and foreign unfinished task refuse without overwriting them', () => {
  const rt = runtime(), b = designStudioBindings();
  const foreign = submit(rt, 'work_at', { actor: b.followUpWork.actor, ...b.followUpWork.work });
  until(rt, () => { const w = readWorkstation(rt, b.workBreak.work.station); return !('code' in w) && w.elapsed >= 1; });
  const hash = rt.stateHash(), current = readWorkstation(rt, b.workBreak.work.station);
  const busy = rt.submit('work_at', b.workBreak.work);
  assert.equal(busy.status, 'failed'); assert.equal(busy.diagnostic?.code, 'workstation.busy');
  assert.ok(busy.diagnostic?.subjects?.includes(b.workBreak.work.station));
  assert.equal(rt.stateHash(), hash); assert.deepEqual(readWorkstation(rt, b.workBreak.work.station), current);
  rt.cancel(foreign.id); until(rt, () => !rt.isActive(foreign.id));
  const retained = readWorkstation(rt, b.workBreak.work.station), releasedHash = rt.stateHash();
  const unrelated = rt.submit('work_at', b.workBreak.work);
  assert.equal(unrelated.status, 'failed'); assert.equal(unrelated.diagnostic?.code, 'workstation.unfinished-task');
  assert.equal(rt.stateHash(), releasedHash); assert.deepEqual(readWorkstation(rt, b.workBreak.work.station), retained); clean(rt);
});

test('unavailable required studio display refuses before claiming people; restoring it admits the same critique', () => {
  const rt = runtime(), b = designStudioBindings(), display = rt.world.entities[b.session.displayId!];
  display.equipment!.config.available = false;
  const hash = rt.stateHash(), denied = rt.submit('classroom_session', b.session);
  assert.equal(denied.status, 'failed'); assert.equal(denied.diagnostic?.code, 'display.unavailable');
  assert.ok(denied.diagnostic?.subjects?.includes(display.id)); assert.equal(rt.stateHash(), hash); clean(rt);
  display.equipment!.config.available = true;
  const accepted = submit(rt, 'classroom_session', b.session); until(rt, () => !rt.isActive(accepted.id));
  assert.equal(accepted.status, 'completed', accepted.diagnostic?.message); clean(rt);
});

test('factory and bindings reset independently without legacy actor IDs or shared mutable state', () => {
  const a = designStudioWorld(), original = designStudioWorld(), b = designStudioBindings();
  assert.deepEqual(a, original); assert.equal(a.base.campus, 'design-studio');
  for (const legacy of ['worker', 'visitor', 'host', 'presenter1', 'guest1', 'workstation', 'screen', 'serving-table']) assert.equal(a.entities[legacy], undefined);
  assert.equal(b.roles.presenters.length, 2); assert.equal(b.roles.audience.length, 4);
  assert.equal(Object.values(a.entities).filter(e => e.human).length, 9);
  assert.ok(Object.values(a.entities).every(e => e.provenance.confidence === 'hypothetical'));
  a.entities[b.roles.worker].pose.p[0] = 999; a.entities[b.session.displayId!].equipment!.config.available = false;
  b.roles.audience.push('foreign'); b.session.seats.length = 0; b.workBreak.people[0].returns.length = 0; b.followUpWork.work.task = 'foreign';
  assert.deepEqual(designStudioWorld(), original); assert.equal(designStudioBindings().roles.audience.length, 4);
  assert.equal(designStudioBindings().session.seats.length, 8); assert.equal(designStudioBindings().workBreak.people[0].returns.length, 2);
  const parameters = designStudioRoutineParams('exact-session'); parameters.work.task = 'foreign';
  assert.equal(designStudioRoutineParams('exact-session').work.task, 'Prototype project notes');
  const continuation = designStudioContinuationParams('exact-session', 'exact-routine');
  assert.equal(continuation.work.session, 'exact-session'); assert.equal(continuation.work.binding.kind, 'work');
  if (continuation.work.binding.kind === 'work') assert.equal(continuation.work.binding.prerequisite.routine, 'exact-routine');
});

test('fresh studio and same timed commands reproduce full authoritative state/actions/attention marks', () => {
  const a = start(), b = start();
  until(a.rt, () => readGatheringContinuation(a.rt, a.discussion.id)!.elapsed >= 2);
  while (b.rt.tick < a.rt.tick) b.rt.step();
  for (const run of [a, b]) submit(run.rt, 'gathering_continuation_control', { continuation: run.discussion.id, intent: 'pause' });
  for (const run of [a, b]) until(run.rt, () => readGatheringContinuation(run.rt, run.discussion.id)!.mode === 'paused');
  assert.equal(a.rt.tick, b.rt.tick);
  for (const run of [a, b]) submit(run.rt, 'gathering_continuation_control', { continuation: run.discussion.id, intent: 'resume' });
  finish(a); finish(b);
  assert.equal(a.rt.stateHash(), b.rt.stateHash()); assert.deepEqual([...a.rt.records.values()], [...b.rt.records.values()]);
  assert.deepEqual(a.rt.events, b.rt.events); assert.deepEqual(readPurposefulRoutine(a.rt, a.routine.id), readPurposefulRoutine(b.rt, b.routine.id));
  clean(a.rt); clean(b.rt);
});


test('same paired trip and continuing purposes work in independent studio without Mars actor IDs', () => {
  const run = start(true), { rt, routine, b } = run;
  finish(run);
  const state = readPurposefulRoutine(rt, routine.id)!;
  assert.deepEqual(state.trip?.bindings.actors, [b.roles.worker, b.roles.companion]);
  assert.ok(state.trip?.participants.every(p => p.arrived));
  assert.ok(state.progress.meal.every(p => p.served && p.consumed && p.returned));
  for (const actor of state.trip!.bindings.actors) assert.deepEqual(rt.holder(`paired-walk:${actor}`), []);
  clean(rt);
});
