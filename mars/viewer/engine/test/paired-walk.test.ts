import test from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, servicesFor, ENGINE_INVARIANTS } from '../api/registry.ts';
import { emptyWorld, human, addAll } from '../world/factory.ts';
import type { SpatialScene } from '../spatial/types.ts';
import { itemEntity } from '../items/model.ts';
import { walkTo } from '../locomotion/walk.ts';
import { provingGround, stairPath } from '../scenes/proving-ground.ts';
import type { Spatial } from '../spatial/service.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import { workBreakWorld, WORK_BREAK_BINDING } from '../scenarios/work-break.ts';
import { classroomScene, classroomParams } from '../scenarios/classroom.ts';
import { designStudioWorld, designStudioScene, designStudioBindings, designStudioRoutineParams, designStudioContinuationParams } from '../scenarios/design-studio.ts';
import { dist2 } from '../core/math.ts';
import { readPurposefulRoutine } from '../activities/purposeful-routine.ts';
import { readWorkstation } from '../objects/workstation.ts';
import { pairedMealWalk } from '../scenarios/paired-meal-walk.ts';
import { readClassroom } from '../activities/classroom.ts';
import { pairedWalk, pairedWalkControl, readPairedWalk, PAIR_MAX_SEPARATION, PAIR_MAX_REGROUP_DISTANCE, type PairedWalkParams } from '../activities/paired-walk.ts';

function setup(horizontal = false, lag = false, unrelatedStairs = false) {
  const scene: SpatialScene = { bounds: [-16, -16, 16, 16], levels: [{ id: 0, y: 0, label: 'authored ground' }],
    surfaces: [{ id: 'floor', level: 0, y: 0, obb: { c: [0, 0], half: [16, 16], yaw: 0 } }],
    obstacles: horizontal ? [{ id: 'off-route-wall', obb: { c: [0, -8], half: [10, 0.1], yaw: 0 }, y0: 0, y1: 2, kind: 'wall' }] : [], links: [] };
  if (unrelatedStairs) {
    const stairs = provingGround();
    scene.levels.push(stairs.levels[1]); scene.surfaces.push(stairs.surfaces[1]);
    scene.links.push(stairs.links[0]);
  }
  const p: PairedWalkParams = horizontal
    ? { actors: ['a', 'b'], rendezvous: [[-4, -0.5], [-4, 0.5]], destination: [[4, -0.5], [4, 0.5]], speed: 0.9 }
    : { actors: ['a', 'b'], rendezvous: [[-0.5, 0], [0.5, 0]], destination: [[-0.5, 8], [0.5, 8]], speed: 0.9 };
  const world = addAll(emptyWorld('paired-fixture', scene),
    human('a', horizontal ? -7 : -3, horizontal ? -2 : -3), human('b', horizontal ? -7 : 3, horizontal ? 2 : -3), human('other', 10, 10));
  const registry = createRegistry(); registry.set(pairedWalk.verb, pairedWalk); registry.set(pairedWalkControl.verb, pairedWalkControl);
  const freeze = { on: lag };
  const delayed: typeof walkTo = { ...walkTo, step(rt, ex, dt) {
    if (freeze.on && ex.actor === 'b' && ex.goal.p[1] === 8) return { status: 'running', phase: 'walk' };
    return walkTo.step(rt, ex, dt);
  } };
  if (lag) registry.set('walk_to', delayed);
  const rt = new Runtime(world, registry, servicesFor({ 'paired-fixture': scene })(world), ENGINE_INVARIANTS);
  return { rt, p, freeze, scene };
}
function until(rt: Runtime, done: () => boolean, max = 3000) {
  for (let i = 0; i < max && !done(); i++) rt.step();
  assert.ok(done(), JSON.stringify([...rt.records.values()])); assert.deepEqual(rt.violations, []);
}
function submit(rt: Runtime, verb: string, p: unknown) {
  const rec = rt.submit(verb, p, { preempt: false }); assert.notEqual(rec.status, 'failed', rec.diagnostic?.message); return rec;
}
function control(rt: Runtime, walk: string, intent: 'pause' | 'resume' | 'end') { return submit(rt, pairedWalkControl.verb, { walk, intent }); }
function clean(rt: Runtime, walk: string, actors = ['a', 'b']) {
  for (const a of actors) { assert.deepEqual(rt.holder(`actor:${a}`), []); assert.deepEqual(rt.holder(`paired-walk:${a}`), []); assert.equal(rt.world.entities[a].human!.task, undefined); }
  for (const id of readPairedWalk(rt, walk)!.ownedActions) assert.equal(rt.isActive(id), false);
  assert.deepEqual(rt.violations, []);
}
for (const horizontal of [false, true]) test(`authored ${horizontal ? 'horizontal' : 'vertical'} pair regroups, walks visibly together and jointly arrives`, () => {
  const { rt, p } = setup(horizontal), action = submit(rt, pairedWalk.verb, p);
  let togetherTicks = 0;
  until(rt, () => {
    const state = readPairedWalk(rt, action.id)!;
    if (state.mode === 'walking' && p.actors.every(a => rt.world.entities[a].human!.activity === 'walk')) {
      togetherTicks++; assert.ok(state.separation <= PAIR_MAX_SEPARATION);
      const children = state.ownedActions.map(id => rt.records.get(id)!).filter(r => rt.isActive(r.id));
      assert.equal(children.length, 2); assert.equal(children[0].requestedTick, children[1].requestedTick);
      assert.ok(children.every(r => (r.params as { speed: number }).speed === p.speed));
    }
    return !rt.isActive(action.id);
  });
  assert.equal(action.status, 'completed', action.diagnostic?.message); assert.ok(togetherTicks > 40, 'both actually walked, rather than only sharing endpoints');
  const state = readPairedWalk(rt, action.id)!; assert.ok(state.participants.every(p => p.arrived));
  assert.equal(action.outputs?.arrived, true); clean(rt, action.id);
});
for (const invalid of ['duplicate', 'missing', 'held', 'foreign', 'lanes', 'obstacle', 'crowd']) test(`${invalid} invitation refuses before effects or owned children`, () => {
  const { rt, p, scene } = setup();
  if (invalid === 'duplicate') p.actors[1] = p.actors[0];
  if (invalid === 'missing') p.actors[1] = 'missing';
  if (invalid === 'held') { const bowl = itemEntity('held-bowl', 'bowl', [-3, 1, -3]); bowl.support = { kind: 'in-hand', by: 'a', hand: 'left' }; rt.world.entities[bowl.id] = bowl; }
  if (invalid === 'foreign') submit(rt, 'walk_to', { actor: 'a', x: -8, z: -3 });
  if (invalid === 'lanes') p.destination[1][0] = 3;
  if (invalid === 'obstacle') { scene.obstacles.push({ id: 'blocked-lane', obb: { c: [0, 4], half: [1, 0.2], yaw: 0 }, y0: 0, y1: 2, kind: 'wall' }); }
  if (invalid === 'crowd') rt.world.entities.other.pose.p = [0, 0, 4];
  const hash = rt.stateHash(), count = rt.records.size, action = rt.submit(pairedWalk.verb, p, { preempt: false });
  assert.equal(action.status, 'failed'); assert.match(action.diagnostic!.code, /^paired_walk\./);
  assert.equal(rt.stateHash(), hash); assert.equal(rt.records.size, count + 1);
  assert.equal([...rt.records.values()].some(r => r.parent === action.id), false);
  assert.deepEqual(rt.holder('paired-walk:a'), []);
});
test('Pause retains destination and Resume regroups locally from actual positions; End releases only owned work', () => {
  const { rt, p } = setup(), other = submit(rt, 'walk_to', { actor: 'other', x: 12, z: 12 }), action = submit(rt, pairedWalk.verb, p);
  until(rt, () => readPairedWalk(rt, action.id)!.participants.every(p => p.progress > 2));
  control(rt, action.id, 'pause'); until(rt, () => readPairedWalk(rt, action.id)!.mode === 'paused');
  assert.deepEqual(readPairedWalk(rt, action.id)!.bindings.destination, p.destination);
  const poses = p.actors.map(a => structuredClone(rt.world.entities[a].pose));
  for (let i = 0; i < 20; i++) rt.step(); assert.deepEqual(p.actors.map(a => rt.world.entities[a].pose), poses);
  control(rt, action.id, 'resume'); assert.ok(readPairedWalk(rt, action.id)!.regroup.every(p => p[1] > 1));
  until(rt, () => readPairedWalk(rt, action.id)!.participants.every(p => p.progress > 4));
  control(rt, action.id, 'end'); until(rt, () => !rt.isActive(action.id)); assert.equal(action.status, 'cancelled');
  assert.notEqual(other.status, 'cancelled'); clean(rt, action.id);
  assert.equal(rt.submit(pairedWalkControl.verb, { walk: action.id, intent: 'resume' }).diagnostic?.code, 'paired_walk.inactive');
});
test('directing either member separates coherently; foreign direction stays active and Resume refuses until release', () => {
  for (const actor of ['a', 'b']) {
    const { rt, p } = setup(), action = submit(rt, pairedWalk.verb, p);
    until(rt, () => readPairedWalk(rt, action.id)!.participants.every(p => p.progress > 1));
    const directive = rt.submit('walk_to', { actor, x: actor === 'a' ? -8 : 8, z: 3 });
    assert.notEqual(directive.status, 'failed', directive.diagnostic?.message);
    until(rt, () => readPairedWalk(rt, action.id)!.mode === 'waiting');
    assert.equal(readPairedWalk(rt, action.id)!.diagnostic?.code, 'paired_walk.directed-away'); assert.equal(rt.isActive(directive.id), true);
    assert.equal(rt.submit(pairedWalkControl.verb, { walk: action.id, intent: 'resume' }).diagnostic?.code, 'paired_walk.actor-busy');
    const count = rt.records.size; for (let i = 0; i < 20; i++) rt.step(); assert.equal(rt.records.size, count);
    until(rt, () => !rt.isActive(directive.id)); assert.equal(directive.status, 'completed');
    control(rt, action.id, 'resume'); until(rt, () => !rt.isActive(action.id)); assert.equal(action.status, 'completed'); clean(rt, action.id);
  }
});
test('actual lag pauses both owned walks with a sticky diagnostic and explicit regroup restores the same trip', () => {
  const { rt, p, freeze } = setup(false, true), action = submit(rt, pairedWalk.verb, p);
  until(rt, () => readPairedWalk(rt, action.id)!.mode === 'waiting');
  const state = readPairedWalk(rt, action.id)!; assert.equal(state.diagnostic?.code, 'paired_walk.separated');
  assert.ok(state.participants[0].progress > state.participants[1].progress); assert.ok(state.ownedActions.every(id => !rt.isActive(id)));
  const count = rt.records.size; for (let i = 0; i < 40; i++) rt.step(); assert.equal(rt.records.size, count);
  freeze.on = false; control(rt, action.id, 'resume'); until(rt, () => !rt.isActive(action.id));
  assert.equal(action.status, 'completed'); clean(rt, action.id);
});
test('paused invitation stays unique and immutable readout cannot change authoritative bindings', () => {
  const { rt, p } = setup(), action = submit(rt, pairedWalk.verb, p); control(rt, action.id, 'pause');
  until(rt, () => readPairedWalk(rt, action.id)!.mode === 'paused');
  const state = readPairedWalk(rt, action.id)!; state.bindings.destination[0][0] = 500; state.ownedActions.push('foreign');
  assert.deepEqual(readPairedWalk(rt, action.id)!.bindings, p);
  assert.equal(rt.submit(pairedWalk.verb, p).diagnostic?.code, 'reservation.conflict');
  control(rt, action.id, 'end'); clean(rt, action.id);
});
test('same timed Pause/Resume produces identical world, child records and marks', () => {
  function replay() {
    const { rt, p } = setup(), action = submit(rt, pairedWalk.verb, p);
    until(rt, () => readPairedWalk(rt, action.id)!.participants.every(p => p.progress > 1));
    control(rt, action.id, 'pause'); until(rt, () => readPairedWalk(rt, action.id)!.mode === 'paused');
    for (let i = 0; i < 10; i++) rt.step(); control(rt, action.id, 'resume'); until(rt, () => !rt.isActive(action.id));
    assert.equal(action.status, 'completed'); clean(rt, action.id);
    return { hash: rt.stateHash(), records: [...rt.records.values()], events: rt.events, readout: readPairedWalk(rt, action.id) };
  }
  assert.deepEqual(replay(), replay());
});

// Root authorized the new 30 m regroup scope after source review established
// that real departure poses already exceed the original draft-only 20 m bound.
// Actors reach those poses through actual classroom departure before invitation.
for (const fixture of ['work-break-4', 'work-break-8', 'design-studio'] as const) {
  test(`${fixture} proposed clear corridor forms and jointly arrives from the actual departure fixture`, () => {
    const studio = fixture === 'design-studio', bindings = studio ? designStudioBindings() : undefined;
    const world = studio ? designStudioWorld() : workBreakWorld(fixture === 'work-break-8' ? 8 : 4);
    const scene = studio ? designStudioScene() : classroomScene();
    const worker = bindings?.roles.worker ?? WORK_BREAK_BINDING.work.actor;
    const companion = bindings?.roles.companion ?? WORK_BREAK_BINDING.people[1].actor;
    const originalCompanion = structuredClone(world.entities[companion].pose);
    const centre = studio ? -9 : -8;
    const p: PairedWalkParams = { actors: [worker, companion],
      rendezvous: [[centre - 0.45, 4], [centre + 0.45, 4]],
      destination: [[centre - 0.45, -5.85], [centre + 0.45, -5.85]], speed: 0.9 };
    const registry = createRegistry(); registry.set(pairedWalk.verb, pairedWalk); registry.set(pairedWalkControl.verb, pairedWalkControl);
    const rt = new Runtime(world, registry, servicesFor({ [world.base.campus]: scene })(world), ENGINE_INVARIANTS);
    // Preserve every authored initial pose. Reach this checkpoint through the
    // actual session and ordinary worker join/departure, not attendee parking.
    const classParams = bindings?.session ?? classroomParams(fixture === 'work-break-8' ? 8 : 4);
    const departure: [number, number] = studio ? [11, 11] : [10, 12];
    const session = submit(rt, 'classroom_session', classParams);
    until(rt, () => readClassroom(rt, session.id)?.phase === 'presenting', 6000);
    submit(rt, 'classroom_control', { session: session.id, intent: { kind: 'join', actor: worker, departure } });
    until(rt, () => !rt.isActive(session.id), 6000);
    assert.equal(session.status, 'completed', session.diagnostic?.message);
    for (const actor of [...classParams.audience, ...classParams.presenters, classParams.host, worker]) {
      const goal = actor === worker ? departure : classParams.departure[actor];
      const at = rt.world.entities[actor].pose.p;
      assert.ok(dist2([at[0], at[2]], goal) <= 0.03, `${actor} completed ordinary departure to its exact bound destination`);
      assert.deepEqual(rt.holder(`actor:${actor}`), []);
    }
    const at = rt.world.entities[worker].pose.p;
    assert.ok(dist2([at[0], at[2]], p.rendezvous[0]) > 20, 'retains the original 20m draft-bound finding at the real completed departure');
    assert.ok(dist2([at[0], at[2]], p.rendezvous[0]) < PAIR_MAX_REGROUP_DISTANCE);
    const action = rt.submit(pairedWalk.verb, p, { preempt: false });
    assert.notEqual(action.status, 'failed', action.diagnostic?.message);
    assert.deepEqual(rt.world.entities[companion].pose, originalCompanion, 'admission itself moves neither person');
    let togetherTicks = 0;
    until(rt, () => {
      const state = readPairedWalk(rt, action.id)!;
      if (state.mode === 'walking' && p.actors.every(a => rt.world.entities[a].human!.activity === 'walk')) {
        togetherTicks++; assert.ok(state.separation <= PAIR_MAX_SEPARATION);
      }
      return !rt.isActive(action.id) || state.mode === 'waiting';
    });
    assert.equal(action.status, 'completed', JSON.stringify(readPairedWalk(rt, action.id)));
    assert.ok(togetherTicks > 40); assert.ok(readPairedWalk(rt, action.id)!.participants.every(p => p.arrived));
    clean(rt, action.id, p.actors);
  });
}

test('over-30m regroup refuses before effects instead of silently moving a distant invitee closer', () => {
  const scene: SpatialScene = { bounds: [-24, -24, 24, 24], levels: [{ id: 0, y: 0, label: 'large authored ground' }],
    surfaces: [{ id: 'floor', level: 0, y: 0, obb: { c: [0, 0], half: [24, 24], yaw: 0 } }], obstacles: [], links: [] };
  const world = addAll(emptyWorld('distant-pair', scene), human('a', -23, -23), human('b', 3, -3));
  const registry = createRegistry(); registry.set(pairedWalk.verb, pairedWalk); registry.set(pairedWalkControl.verb, pairedWalkControl);
  const rt = new Runtime(world, registry, servicesFor({ 'distant-pair': scene })(world), ENGINE_INVARIANTS);
  const p: PairedWalkParams = { actors: ['a', 'b'], rendezvous: [[-0.5, 0], [0.5, 0]], destination: [[-0.5, 8], [0.5, 8]], speed: 0.9 };
  const hash = rt.stateHash(), action = rt.submit(pairedWalk.verb, p, { preempt: false });
  assert.equal(action.status, 'failed'); assert.equal(action.diagnostic?.code, 'paired_walk.rendezvous-scope');
  assert.match(action.diagnostic!.message, /at most 30 m/); assert.equal(rt.stateHash(), hash);
  assert.equal([...rt.records.values()].some(r => r.parent === action.id), false); assert.deepEqual(rt.holder('paired-walk:a'), []);
});

test('unrelated usable stair elsewhere does not refuse a clear level-0 pair corridor', () => {
  const { rt, p } = setup(false, false, true), sp = rt.services.spatial as Spatial;
  assert.ok(sp.base.links.some(l => l.usable));
  const route = sp.route(rt.world, HUMAN_PROFILE, { level: 0, p: p.rendezvous[0] }, { level: 0, p: p.destination[0] });
  assert.equal(route.ok, true); if (route.ok) assert.ok(route.route.legs.every(l => l.kind === 'walk' && l.level === 0));
  const action = submit(rt, pairedWalk.verb, p); until(rt, () => !rt.isActive(action.id) || readPairedWalk(rt, action.id)!.mode === 'waiting');
  assert.equal(action.status, 'completed', JSON.stringify(readPairedWalk(rt, action.id))); clean(rt, action.id);
});

test('a ground-to-ground route actually dependent on stairs refuses before movement', () => {
  const scene: SpatialScene = { bounds: [-12, -8, 12, 8], levels: [{ id: 0, y: 0, label: 'separate ground patches' }, { id: 1, y: 3, label: 'connecting deck' }],
    surfaces: [
      { id: 'left-ground', level: 0, y: 0, obb: { c: [-6, 0], half: [4, 7], yaw: 0 } },
      { id: 'right-ground', level: 0, y: 0, obb: { c: [6, 0], half: [4, 7], yaw: 0 } },
      { id: 'deck', level: 1, y: 3, obb: { c: [0, 0], half: [6, 4], yaw: 0 } },
    ], obstacles: [], links: [
      { id: 'left-stairs', kind: 'stairs', from: { level: 0, p: [-4, 0], y: 0 }, to: { level: 1, p: [-2, 0], y: 3 }, width: 1.2, heading: 0, path: stairPath([-4, 0, 0], [-2, 3, 0], 12), usable: true },
      { id: 'right-stairs', kind: 'stairs', from: { level: 0, p: [4, 0], y: 0 }, to: { level: 1, p: [2, 0], y: 3 }, width: 1.2, heading: -Math.PI, path: stairPath([4, 0, 0], [2, 3, 0], 12), usable: true },
    ] };
  const world = addAll(emptyWorld('stairs-required', scene), human('a', -7, -1), human('b', -7, 1));
  const registry = createRegistry(); registry.set(pairedWalk.verb, pairedWalk); registry.set(pairedWalkControl.verb, pairedWalkControl);
  const rt = new Runtime(world, registry, servicesFor({ 'stairs-required': scene })(world), ENGINE_INVARIANTS);
  const p: PairedWalkParams = { actors: ['a', 'b'], rendezvous: [[-5, -0.5], [-5, 0.5]], destination: [[5, -0.5], [5, 0.5]], speed: 0.9 };
  const route = (rt.services.spatial as Spatial).route(rt.world, HUMAN_PROFILE, { level: 0, p: p.rendezvous[0] }, { level: 0, p: p.destination[0] });
  assert.equal(route.ok, true); if (route.ok) assert.ok(route.route.legs.some(l => l.kind === 'link'), 'fixture requires actual contextual traversal');
  const hash = rt.stateHash(), action = rt.submit(pairedWalk.verb, p, { preempt: false });
  assert.equal(action.status, 'failed'); assert.equal(action.diagnostic?.code, 'paired_walk.ground-route');
  assert.equal(rt.stateHash(), hash); assert.equal([...rt.records.values()].some(r => r.parent === action.id), false);
});


// Exact combined studio journey: ordinary session departure and the independently
// owned reviewer discussion create the crossing; no actor pose/status is injected.
function studioRegroupCrossing() {
  const world = designStudioWorld(), b = designStudioBindings();
  const rt = new Runtime(world, createRegistry(), servicesFor({ 'design-studio': designStudioScene() })(world), ENGINE_INVARIANTS);
  const notes = submit(rt, 'work_at', b.workBreak.work);
  until(rt, () => { const w = readWorkstation(rt, b.workBreak.work.station); return !('code' in w) && w.elapsed >= 2; });
  rt.cancel(notes.id); until(rt, () => !rt.isActive(notes.id));
  const session = submit(rt, 'classroom_session', b.session);
  until(rt, () => readClassroom(rt, session.id)?.phase === 'presenting');
  const params = designStudioRoutineParams(session.id);
  params.trip = pairedMealWalk(b.roles.worker, b.roles.companion, -9);
  const routine = submit(rt, 'purposeful_routine', params);
  const continuations = designStudioContinuationParams(session.id, routine.id);
  const followUp = submit(rt, 'gathering_continuation', continuations.work);
  const discussion = submit(rt, 'gathering_continuation', continuations.discussion);
  until(rt, () => readPurposefulRoutine(rt, routine.id)?.trip?.diagnostic?.code === 'paired_walk.regroup-traffic', 16000);
  const trip = readPurposefulRoutine(rt, routine.id)!.trip!;
  assert.equal(rt.tick, 2972); assert.equal(trip.mode, 'regrouping');
  assert.equal(trip.diagnostic?.details?.cause && (trip.diagnostic.details.cause as { code: string }).code, 'traffic.person');
  assert.match(trip.waitingReason!, /project-editor.*form-reviewer/);
  const blocked = trip.ownedActions.find(id => rt.records.get(id)!.diagnostic?.code === 'traffic.person')!;
  assert.ok(blocked); assert.equal(rt.records.get(blocked)!.parent, trip.action);
  assert.equal(rt.isActive(discussion.id), true);
  return { rt, b, params, routine, discussion, followUp, trip: rt.records.get(trip.action)!, blocked };
}

test('actual combined studio crossing retains the blocked ordinary child and completes the same trip, meal and notes', () => {
  const { rt, b, routine, trip, blocked, discussion, followUp } = studioRegroupCrossing();
  const children = [...readPairedWalk(rt, trip.id)!.ownedActions];
  let recoverTicks = 0;
  until(rt, () => {
    recoverTicks++;
    assert.notEqual(rt.records.get(blocked)!.status, 'cancelled');
    return rt.records.get(blocked)!.status === 'executing' || rt.records.get(blocked)!.status === 'completed';
  });
  assert.ok(recoverTicks <= 100); assert.deepEqual(readPairedWalk(rt, trip.id)!.ownedActions, children);
  until(rt, () => [routine, discussion, followUp].every(r => !rt.isActive(r.id)), 16000);
  for (const r of [routine, trip, discussion, followUp]) assert.equal(r.status, 'completed', r.diagnostic?.message);
  const done = readPurposefulRoutine(rt, routine.id)!;
  assert.ok(done.trip!.participants.every(p => p.arrived));
  assert.ok(done.progress.meal.every(p => p.served && p.consumed && p.returned));
  assert.equal(done.progress.workElapsed, 30);
  clean(rt, trip.id, [b.roles.worker, b.roles.companion]);
  console.log('[studio-regroup]', JSON.stringify({ blockedTick: 2972, recoverTicks, finishedTick: rt.tick, hash: rt.stateHash(), blockedChild: blocked, trip: trip.id, violations: rt.violations.length }));
});

for (const intervention of ['pause-end', 'directive'] as const) test(`actual regroup traffic ${intervention} drains only paired children and preserves foreign discussion`, () => {
  const { rt, b, routine, trip, discussion } = studioRegroupCrossing();
  const foreign = [...rt.holder(`actor:${b.roles.audience[1]}`)]; assert.ok(foreign.length);
  if (intervention === 'pause-end') {
    control(rt, trip.id, 'pause'); until(rt, () => readPairedWalk(rt, trip.id)!.mode === 'paused');
    control(rt, trip.id, 'end'); until(rt, () => !rt.isActive(trip.id));
    assert.equal(trip.status, 'cancelled');
  } else {
    const direction = rt.submit('walk_to', { actor: b.roles.worker, x: 11, z: 11 });
    assert.notEqual(direction.status, 'failed', direction.diagnostic?.message);
    until(rt, () => readPairedWalk(rt, trip.id)!.mode === 'waiting');
    assert.equal(readPairedWalk(rt, trip.id)!.diagnostic?.code, 'paired_walk.directed-away');
    assert.equal(rt.isActive(direction.id), true);
    assert.equal(rt.submit('paired_walk_control', { walk: trip.id, intent: 'resume' }).diagnostic?.code, 'paired_walk.actor-busy');
  }
  assert.equal(rt.isActive(discussion.id), true);
  assert.deepEqual(rt.holder(`actor:${b.roles.audience[1]}`), foreign);
  assert.ok(readPairedWalk(rt, trip.id)!.ownedActions.every(id => !rt.isActive(id)));
  assert.ok(readPurposefulRoutine(rt, routine.id)!.progress.meal.every(p => !p.served));
});

// Deliberate nonprogress injection, as in the existing lag fixture: this tests
// the coordinator's physical clock independently of the ordinary walker planner.
for (const failure of [false, true]) test(`regroup ${failure ? 'hard failure drains immediately' : 'no progress retains the unchanged 100-tick bound'}`, () => {
  const { rt, p } = setup(), registry = rt.registry;
  const stopped: typeof walkTo = { ...walkTo, step(_rt, ex) {
    if (failure && ex.actor === 'a') return { status: 'failed', diagnostic: { code: 'walk.obstacle', message: 'explicit hard failure', subjects: ['a'] } };
    return { status: 'blocked', diagnostic: { code: 'traffic.person', message: `${ex.actor} waits for fixture blocker`, subjects: [ex.actor, 'fixture blocker'] } };
  } }; registry.set('walk_to', stopped);
  const action = submit(rt, pairedWalk.verb, p), dispatched = rt.tick;
  until(rt, () => readPairedWalk(rt, action.id)!.mode === 'waiting');
  const state = readPairedWalk(rt, action.id)!;
  assert.equal(state.diagnostic?.code, failure ? 'paired_walk.child-stopped' : 'paired_walk.stalled');
  if (!failure) { assert.match(state.waitingReason!, /100 ticks/); assert.equal(rt.tick - dispatched, 102); }
  else { assert.equal(rt.tick - dispatched, 3); assert.equal((state.diagnostic!.details!.cause as { code: string }).code, 'walk.obstacle'); }
  assert.ok(state.ownedActions.every(id => !rt.isActive(id)));
  const records = rt.records.size; for (let i = 0; i < 40; i++) rt.step(); assert.equal(rt.records.size, records);
  control(rt, action.id, 'end'); until(rt, () => !rt.isActive(action.id)); clean(rt, action.id);
});
