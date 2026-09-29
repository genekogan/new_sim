import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import type { ActionDef } from '../actions/types.ts';
import { Runtime } from '../runtime/runtime.ts';
import { publishWait } from '../runtime/waits.ts';
import { SequenceRunner } from '../sequence/runner.ts';
import { emptyWorld, addAll, human, component } from '../world/factory.ts';
import { Spatial } from '../spatial/service.ts';
import type { SpatialScene } from '../spatial/types.ts';
import { walkTo } from '../locomotion/walk.ts';
import { carry } from '../carry/actions.ts';
import { carryCorridors } from '../carry/scenes.ts';
import { CARRY_INVARIANTS } from '../carry/invariants.ts';
import { WorldHistory } from '../history/store.ts';
import { bindTemplate } from '../sequence/bind.ts';
import { execute, rehearse } from '../rehearsal/rehearse.ts';
import { hashOf } from '../core/hash.ts';
import { provingGround, DECK_Y } from '../scenes/proving-ground.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';

const corridor: SpatialScene = {
  bounds: [-2, -6, 2, 6], levels: [{ id: 0, y: 0, label: 'ground' }],
  surfaces: [{ id: 'floor', level: 0, y: 0, obb: { c: [0, 0], half: [2, 6], yaw: 0 } }],
  obstacles: [-1, 1].map((side) => ({ id: `wall-${side}`, obb: { c: [side * 0.6, 0], half: [0.2, 6], yaw: 0 }, y0: 0, y1: 3 })), links: [],
};
const reg = new Map<string, ActionDef>([[walkTo.verb, walkTo]]);
function trapped() {
  const base = provingGround(), stair = base.links[0];
  const world = addAll(emptyWorld('trapped-stairs', base), human('a', ...stair.from.p, { yaw: 0 }), human('b', ...stair.to.p, { yaw: Math.PI, y: DECK_Y, level: 1 }));
  const rt = new Runtime(world, reg, { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
  const runner = new SequenceRunner(rt, [
    { id: 'a', verb: 'walk_to', params: { actor: 'a', x: 10, z: 10, level: 1 } },
    { id: 'b', verb: 'walk_to', params: { actor: 'b', x: 0, z: 10, level: 0 } },
  ]);
  return { rt, runner };
}

test('actual opposing stair-passage walkers stop as blocked after bounded recovery without cancelling or releasing', () => {
  const { rt, runner } = trapped(); const result = runner.run(1800);
  assert.equal(result.status, 'blocked'); assert.equal(result.settled, false);
  assert.ok(result.endTick < 1800); assert.deepEqual(result.cut, []); assert.equal(result.settleTicks, 0);
  assert.ok(result.steps.every((s) => s.diagnostic?.code === 'deadlock.cycle'));
  assert.deepEqual(rt.holder('actor:a'), ['step:a']); assert.deepEqual(rt.holder('actor:b'), ['step:b']);
  assert.deepEqual(result.violations, []);
  if (process.env.DEADLOCK_CAPTURE) console.log(JSON.stringify({ scenario: 'trapped-passage', result }));
});

const stationary: ActionDef<{ actor: string; blocker: string }, null, { actor: string; blocker: string; id: string }> = {
  verb: 'stationary', description: 'test explicit wait', resumable: true,
  schema: z.object({ actor: z.string(), blocker: z.string() }), reservations: (_w, p) => [{ resource: `actor:${p.actor}`, mode: 'exclusive' }],
  plan: () => ({ ok: true, program: null }), start(rt, p, _program, id) { rt.world.entities[p.actor].human!.task = id; return { ...p, id }; },
  step(rt, ex) { publishWait(rt, ex.id, ex.actor, [rt.services.blocker ?? ex.blocker], { code: rt.services.waitCode ?? 'test.wait', message: 'wait' }); return { status: 'blocked', diagnostic: { code: 'test.wait', message: 'wait' } }; },
  cancel: () => ({ ok: true }),
  recoverWait(rt, ex) { rt.services.attempts ??= {}; rt.services.attempts[ex.actor] = (rt.services.attempts[ex.actor] ?? 0) + 1; return { status: 'attempted', diagnostic: { code: 'deadlock.replan-refused', message: 'test stationary refusal' } }; },
  waitQuiescent: (_rt, ex, exhausted) => exhausted.has(ex.actor),
};
function stationaryRunner() {
  const world = addAll(emptyWorld('stationary', corridor), human('a', 0, -2), human('sink', 0, 2));
  const rt = new Runtime(world, new Map<string, ActionDef>([[stationary.verb, stationary]]), {});
  return { rt, runner: new SequenceRunner(rt, [{ id: 'a', verb: 'stationary', params: { actor: 'a', blocker: 'sink' } }]) };
}

test('acyclic stationary sink, one recovery attempt, snapshot retains exhausted timer and cap', () => {
  const { rt, runner } = stationaryRunner(); runner.advance();
  for (let i = 0; i < 250; i++) runner.tick();
  assert.equal(rt.services.attempts.a, 1);
  const resumed = Runtime.restore(JSON.parse(JSON.stringify(rt.snapshot())), rt.registry, {});
  const resumedRunner = SequenceRunner.restore(resumed, runner.serialize());
  for (let i = 0; i < 150; i++) { runner.tick(); resumedRunner.tick(); }
  assert.equal(runner.result().status, 'blocked'); assert.equal(runner.result().endTick, 400);
  assert.deepEqual(resumedRunner.result(), runner.result()); assert.equal(resumed.services.attempts.a, 1);
  assert.equal(runner.reports[0].diagnostic?.code, 'deadlock.stalled');
});

test('moving sink resets the cumulative progress anchor; stationary unknown actions prevent early stopping', () => {
  const { rt, runner } = stationaryRunner(); runner.advance();
  for (let i = 0; i < 500; i++) { rt.world.entities.sink.pose.p[2] += 0.01; runner.tick(); }
  assert.equal(rt.services.attempts, undefined); assert.equal(runner.result().status, 'partial');
  const unknown = { ...stationary, verb: 'unknown', waitQuiescent: undefined };
  rt.registry = new Map([...rt.registry, [unknown.verb, unknown]]);
  rt.submit('unknown', { actor: 'sink', blocker: 'a' });
  for (let i = 0; i < 500; i++) runner.tick();
  assert.equal(runner.result().status, 'partial');
});


test('anchored reporting tolerance ignores bounded jitter and code alternation, but resets for cumulative translation, rotation and changed blockers', () => {
  const { rt, runner } = stationaryRunner(); runner.advance();
  for (let i = 0; i < 500; i++) { rt.world.entities.a.pose.p[0] = i % 2 ? 0.0002 : -0.0002; rt.services.waitCode = i % 2 ? 'test.yield' : 'test.person'; runner.tick(); }
  assert.equal(rt.services.attempts.a, 1); assert.equal(runner.result().status, 'blocked');
  rt.world.entities.other = human('other', 0, 3); rt.services.blocker = 'other'; runner.tick();
  assert.equal(runner.result().status, 'partial');
  for (let i = 0; i < 199; i++) runner.tick();
  assert.equal(rt.services.attempts.a, 2, 'changed blocker begins a distinct recovery episode');
  for (const rotate of [false, true]) {
    const x = stationaryRunner(); x.runner.advance();
    for (let i = 0; i < 600; i++) {
      if (rotate) x.rt.world.entities.a.pose.yaw += 0.00001;
      else x.rt.world.entities.sink.pose.p[2] += 0.00001;
      x.runner.tick();
    }
    assert.equal(x.rt.services.attempts, undefined, 'slow cumulative progress exceeds the fixed anchor before admission');
    assert.equal(x.runner.result().status, 'partial');
  }
});

test('future cue, pending dependent tail and future timeout prevent early blocked termination', () => {
  for (const mode of ['cue', 'dependent', 'timeout']) {
    const { rt, runner: initial } = stationaryRunner();
    const steps = structuredClone(initial.steps);
    if (mode === 'timeout') steps[0].timeout = 30;
    else steps.push({ id: 'later', verb: 'mark', params: { name: 'later' }, ...(mode === 'cue' ? { at: 30 } : { after: ['a'] }) });
    const runner = new SequenceRunner(rt, steps); runner.advance();
    for (let i = 0; i < 500; i++) runner.tick();
    assert.equal(runner.result().status, 'partial', mode);
    if (mode === 'cue') { for (let i = 0; i < 100; i++) runner.tick(); assert.equal(runner.reports[1].status, 'completed'); assert.equal(runner.result().status, 'partial'); runner.tick(); assert.equal(runner.result().status, 'blocked'); }
  }
});

test('actual carry gather with one blocked walker and another still approaching cannot stop early', () => {
  const base = provingGround();
  const world = addAll(emptyWorld('gather', base), component('load', 'beam-12ft', [-20, 0, 20]), human('p1', -22, 22), human('p2', 25, -25), human('bystander', -21.46304, 20.3754));
  const rt = new Runtime(world, new Map<string, ActionDef>([[carry.verb, carry], [walkTo.verb, walkTo], [stationary.verb, stationary]]), { spatial: new Spatial(base) }, [...DEFAULT_INVARIANTS, ...CARRY_INVARIANTS]);
  const runner = new SequenceRunner(rt, [
    { id: 'hold', verb: 'stationary', params: { actor: 'bystander', blocker: 'p1' } },
    { id: 'carry', verb: 'carry', params: { crew: ['p1', 'p2'], item: 'load', to: { x: -15, z: 20, yaw: 0 } } },
  ]); runner.advance();
  for (let i = 0; i < 550; i++) runner.tick();
  assert.equal(runner.reports[1].diagnostic?.code, 'deadlock.cycle');
  const before = [...world.entities.p2.pose.p];
  for (let i = 0; i < 20; i++) runner.tick();
  assert.notDeepEqual(world.entities.p2.pose.p, before, 'second gathering member is physically still approaching');
  assert.equal(runner.result().status, 'partial'); assert.equal(rt.exhaustedWaitDiagnostics(), null);
  assert.deepEqual(world.entities.load.support, { kind: 'ground' }); assert.deepEqual(rt.violations, []);
});

test('actual supported held carry stops blocked; execute with commitOnFailure still refuses and preserves history', () => {
  const base = carryCorridors();
  const world = addAll(emptyWorld('held', base), component('b1', 'beam-12ft', [4, 0, 4]), human('p1', 2, 6.5), human('p2', 6, 1.5), human('bystander', 18, 11));
  const registry = new Map<string, ActionDef>([[carry.verb, carry], [walkTo.verb, walkTo], [stationary.verb, stationary]]);
  const history = new WorldHistory('test'); history.publishCanonical('canonical', 'fixture', world, 'fixture'); history.fork('canonical', 'work', 'work');
  const plan = bindTemplate({ schema: 'mars-sequence/1', id: 'held', params: {}, steps: [
    { id: 'hold', verb: 'stationary', params: { actor: 'bystander', blocker: 'b1' } },
    { id: 'carry', verb: 'carry', params: { crew: ['p1', 'p2'], item: 'b1', to: { x: 18, z: 11, yaw: Math.PI / 2 } } },
  ] }, {}, { history, baseline: 'work', registry });
  const cfg = { registry, services: () => ({ spatial: new Spatial(base) }), invariants: [...DEFAULT_INVARIANTS, ...CARRY_INVARIANTS], maxTicks: 1800 };
  const rehearsal = rehearse(history, 'work', plan, cfg);
  assert.equal(rehearsal.report.status, 'blocked'); assert.equal(rehearsal.report.settled, false);
  assert.deepEqual(rehearsal.finalState.entities.b1.support, { kind: 'held', by: ['p1', 'p2'] });
  assert.deepEqual(rehearsal.report.violations, []); assert.deepEqual(rehearsal.report.cut, []);
  const before = hashOf(history.toJSON()); const result = execute(history, 'work', plan, cfg, { commitOnFailure: true });
  assert.equal(result.ok, false); assert.ok(!result.ok && result.code === 'execution.failed');
  assert.equal(result.report?.status, 'blocked'); assert.equal(hashOf(history.toJSON()), before);
  if (process.env.DEADLOCK_CAPTURE) console.log(JSON.stringify({ scenario: 'held-carry-execute', report: rehearsal.report, support: rehearsal.finalState.entities.b1.support, historyUnchanged: hashOf(history.toJSON()) === before, executionCode: !result.ok ? result.code : null }));
});


test('deferred planner budget is bounded and explicitly unavailable, never counted as an attempt', () => {
  const { rt, runner: initial } = stationaryRunner();
  const deferred: typeof stationary = { ...stationary, recoverWait: () => ({ status: 'deferred', diagnostic: { code: 'deadlock.recovery-budget', message: 'test exhausted budget' } }) };
  rt.registry = new Map([[deferred.verb, deferred]]);
  const runner = new SequenceRunner(rt, initial.steps); const result = runner.run(800);
  assert.equal(result.status, 'blocked'); assert.equal(result.endTick, 600);
  assert.equal(rt.services.attempts, undefined);
  const recovery = rt.services.moverWaits.samples.get('a').recovery;
  assert.equal(recovery.status, 'unavailable'); assert.equal(recovery.diagnostic.code, 'deadlock.recovery-budget');
  assert.equal(recovery.requestedTick, 200); assert.equal(recovery.completedTick, 400);
});
