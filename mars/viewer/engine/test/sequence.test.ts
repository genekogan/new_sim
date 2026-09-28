// Sequence templates, binding and the runner (spec §14).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime, DT } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { bindTemplate, PlanError, substitute } from '../sequence/bind.ts';
import { runSequence, SETTLE_S } from '../sequence/runner.ts';
import type { ActionDef } from '../actions/types.ts';
import { z } from 'zod';
import { DECK_Y } from '../scenes/proving-ground.ts';
import type { SequenceTemplate, StepSpec } from '../sequence/types.ts';
import { config, crossBindings, crossTemplate, pgHistory, pgWorld, registry } from './sequence-fixtures.ts';

const runtime = () => {
  const c = config();
  const w = pgWorld();
  return new Runtime(w, c.registry, c.services(w), DEFAULT_INVARIANTS);
};
const codes = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    assert.ok(e instanceof PlanError, String(e));
    return e.diagnostics.map((d) => d.code);
  }
  assert.fail('expected PlanError');
};
const tpl = (steps: StepSpec[], params: SequenceTemplate['params'] = {}): SequenceTemplate => ({ schema: 'mars-sequence/1', id: 't', params, steps });

test('substitution: whole-string refs, indices, fields, $$ escape; no interpolation or eval', () => {
  const b = { crew: ['a', 'b'], deck: [10, 12], spot: { x: 3 } };
  assert.deepEqual(substitute({ a: '$crew[1]', x: '$deck[0]', y: '$spot.x', lit: '$$crew', n: [1, '$crew[0]'] }, b, 'p'), {
    a: 'b', x: 10, y: 3, lit: '$crew', n: [1, 'a'],
  });
  assert.throws(() => substitute('$crew[5]', b, 'p'), (e: any) => e.code === 'plan.bad-reference');
  assert.throws(() => substitute('$nope', b, 'p'), (e: any) => e.code === 'plan.unbound-reference');
  assert.equal(substitute('go to $crew[0]', b, 'p'), 'go to $crew[0]', 'no string interpolation: only whole-string refs');
  assert.throws(() => substitute('$crew[0] + 1', b, 'p'), (e: any) => e.code === 'plan.bad-reference');
  assert.throws(() => substitute('$crew.constructor', b, 'p'), (e: any) => e.code === 'plan.bad-reference');
});

test('bind: validated against registry + baseline; plan hash is content-addressed', () => {
  const h = pgHistory();
  const plan = bindTemplate(crossTemplate, crossBindings, { history: h, baseline: 'ws', registry: registry() });
  assert.equal(plan.baselineCheckpoint, h.head('ws').id);
  assert.equal(plan.baselinePhysicalHash, h.head('ws').physicalHash);
  assert.equal(plan.rulesVersion, h.rulesVersion);
  assert.deepEqual(plan.steps[2].params, { actor: 'p1', x: 10, z: 10, level: 1 });
  const again = bindTemplate(crossTemplate, crossBindings, { history: h, baseline: h.head('ws').id, registry: registry() });
  assert.equal(again.planHash, plan.planHash);
  const other = bindTemplate(crossTemplate, { ...crossBindings, crew: ['s1', 'n1', 'p1'] }, { history: h, baseline: 'ws', registry: registry() });
  assert.notEqual(other.planHash, plan.planHash);
  // plans survive JSON round trips unchanged
  assert.deepEqual(JSON.parse(JSON.stringify(plan)), plan);
});

test('bind: invalid templates and bindings fail loudly with every problem listed', () => {
  const h = pgHistory();
  const ctx = { history: h, baseline: 'ws', registry: registry() };
  assert.deepEqual(codes(() => bindTemplate(tpl([{ id: 'a', verb: 'fly', params: {} }]), {}, ctx)), ['action.unknown-verb']);
  assert.deepEqual(codes(() => bindTemplate(tpl([{ id: 'a', verb: 'walk_to', params: { actor: 'n1', x: 1, z: 1, speed: 10 } }]), {}, ctx)), ['action.invalid-params']);
  const crewT = tpl([{ id: 'a', verb: 'walk_to', params: { actor: '$who', x: 1, z: 1 } }], { who: { kind: 'actor' } });
  assert.deepEqual(codes(() => bindTemplate(crewT, {}, ctx)), ['plan.missing-binding', 'plan.unbound-reference']);
  assert.deepEqual(codes(() => bindTemplate(crewT, { who: 'panel' }, ctx)), ['plan.not-an-actor']);
  assert.deepEqual(codes(() => bindTemplate(crewT, { who: 'ghost' }, ctx)), ['plan.unknown-entity']);
  assert.deepEqual(codes(() => bindTemplate(crewT, { who: 'n1', extra: 1 }, ctx)), ['plan.unknown-binding']);
  assert.deepEqual(
    codes(() => bindTemplate(tpl([{ id: 'a', verb: 'wait_ticks', params: { n: 1 }, after: ['b'] }, { id: 'b', verb: 'wait_ticks', params: { n: 1 }, when: { event: 'started', step: 'a' } }]), {}, ctx)),
    ['sequence.cycle'],
  );
  assert.deepEqual(codes(() => bindTemplate(tpl([{ id: 'a', verb: 'wait_ticks', params: { n: 1 }, after: ['zz'] }]), {}, ctx)), ['sequence.unknown-step']);
  assert.deepEqual(codes(() => bindTemplate(tpl([{ id: 'a', verb: 'wait_ticks', params: { n: 1 } }, { id: 'a', verb: 'wait_ticks', params: { n: 2 } }]), {}, ctx)), ['sequence.duplicate-step']);
  assert.deepEqual(codes(() => bindTemplate({ ...tpl([{ id: 'a', verb: 'wait_ticks', params: { n: 1 } }]), script: 'rm -rf' } as any, {}, ctx)), ['sequence.invalid-template']);
});

test('runner: barriers, when-started / when-completed chains', () => {
  const rt = runtime();
  const t0 = rt.tick;
  const r = runSequence(rt, [
    { id: 'a', verb: 'wait_ticks', params: { n: 10 } },
    { id: 'b', verb: 'wait_ticks', params: { n: 30 } },
    { id: 'c', verb: 'wait_ticks', params: { n: 5 }, after: ['a', 'b'] },
    { id: 'd', verb: 'wait_ticks', params: { n: 5 }, when: { event: 'started', step: 'c' } },
    { id: 'e', verb: 'wait_ticks', params: { n: 1 }, when: { event: 'completed', step: 'a' } },
  ]);
  assert.equal(r.status, 'completed');
  const s = Object.fromEntries(r.steps.map((x) => [x.id, x]));
  assert.equal(s.a.endedTick, t0 + 10);
  assert.equal(s.b.endedTick, t0 + 30);
  assert.equal(s.c.submittedTick, t0 + 30, 'barrier releases on the tick the last dependency completes');
  assert.equal(s.d.submittedTick, s.c.submittedTick, 'when-started fires on the same tick');
  assert.equal(s.e.submittedTick, t0 + 10);
  assert.equal(r.endTick, t0 + 35);
});

test('runner: `at` cues start on the exact tick; late cues are reported', () => {
  const rt = runtime();
  const r = runSequence(rt, [
    { id: 'slow', verb: 'wait_ticks', params: { n: 30 } },
    { id: 'cue', verb: 'wait_ticks', params: { n: 1 }, at: 2.0 },
    { id: 'late', verb: 'wait_ticks', params: { n: 1 }, at: 0.5, after: ['slow'] },
  ]);
  const s = Object.fromEntries(r.steps.map((x) => [x.id, x]));
  assert.equal(s.cue.submittedTick! - r.startTick, Math.round(2.0 / DT));
  assert.equal(s.cue.cueLateTicks, 0);
  assert.equal(s.late.submittedTick! - r.startTick, 30);
  assert.equal(s.late.cueLateTicks, 30 - Math.round(0.5 / DT));
});

test('runner: onFail abort cancels live steps and skips pending ones', () => {
  const rt = runtime();
  const r = runSequence(rt, [
    { id: 'walk', verb: 'walk_to', params: { actor: 'p1', x: -20, z: 0 } },
    { id: 'gap', verb: 'wait_ticks', params: { n: 10 } },
    { id: 'bad', verb: 'walk_to', params: { actor: 'n1', x: -15, z: -15 }, after: ['gap'] }, // inside the test wall
    { id: 'later', verb: 'wait_ticks', params: { n: 5 }, after: ['bad'] },
    { id: 'cue', verb: 'wait_ticks', params: { n: 5 }, at: 30 },
  ]);
  assert.equal(r.status, 'aborted');
  const s = Object.fromEntries(r.steps.map((x) => [x.id, x]));
  assert.equal(s.bad.status, 'failed');
  assert.match(s.bad.diagnostic!.code, /^route\./);
  assert.equal(s.walk.status, 'cancelled');
  assert.equal(s.later.status, 'skipped');
  assert.equal(s.cue.status, 'skipped');
  assert.equal(s.later.diagnostic?.code, 'sequence.aborted');
  assert.equal(rt.world.entities.p1.human!.activity, 'idle');
  assert.ok(r.diagnostics.some((d) => d.subjects?.[0] === 'bad'));
  assert.equal(r.endTick - r.startTick, 10, 'aborted immediately, did not wait for the 30 s cue');
});

test('runner: onFail continue keeps independent branches, skips dependents', () => {
  const rt = runtime();
  const r = runSequence(rt, [
    { id: 'walk', verb: 'walk_to', params: { actor: 'p1', x: 0, z: 12.5 } },
    { id: 'bad', verb: 'walk_to', params: { actor: 'n1', x: -15, z: -15 }, onFail: 'continue' },
    { id: 'dep', verb: 'wait_ticks', params: { n: 5 }, after: ['bad'] },
    { id: 'dep2', verb: 'wait_ticks', params: { n: 5 }, when: { event: 'started', step: 'bad' } },
    { id: 'mid', verb: 'wait_ticks', params: { n: 20, fail: true }, onFail: 'continue' },
    { id: 'afterMid', verb: 'wait_ticks', params: { n: 1 }, when: { event: 'started', step: 'mid' } },
  ]);
  assert.equal(r.status, 'partial');
  const s = Object.fromEntries(r.steps.map((x) => [x.id, x]));
  assert.equal(s.walk.status, 'completed');
  assert.equal(s.dep.status, 'skipped');
  assert.equal(s.dep.diagnostic?.code, 'sequence.dependency-failed');
  assert.match(s.dep.diagnostic!.message, /"bad"/);
  assert.equal(s.dep2.status, 'skipped', 'a step that never started cannot trigger when-started');
  assert.equal(s.mid.status, 'failed');
  assert.equal(s.mid.diagnostic?.code, 'test.fail');
  assert.equal(s.afterMid.status, 'completed', 'mid failed after starting, so when-started held');
  assert.deepEqual(r.violations, []);
});

test('runner: tick budget → timeout, live actions cancelled', () => {
  const rt = runtime();
  const r = runSequence(rt, [{ id: 'w', verb: 'wait_ticks', params: { n: 1000 } }], { maxTicks: 50 });
  assert.equal(r.status, 'timeout');
  assert.equal(r.steps[0].status, 'cancelled');
  assert.ok(r.diagnostics.some((d) => d.code === 'sequence.timeout'));
});

test('runner: proving-ground walkers — passage yield + barrier-gated climb, no violations', () => {
  const h = pgHistory();
  const plan = bindTemplate(crossTemplate, crossBindings, { history: h, baseline: 'ws', registry: registry() });
  const rt = runtime();
  const r = runSequence(rt, plan.steps);
  assert.equal(r.status, 'completed');
  assert.deepEqual(r.violations, []);
  const s = Object.fromEntries(r.steps.map((x) => [x.id, x]));
  assert.ok(s.north.blockedTicks + s.south.blockedTicks > 0, 'someone yielded at the passage');
  assert.equal(s.climb.submittedTick, Math.max(s.north.endedTick!, s.south.endedTick!));
  assert.equal(rt.world.entities.p1.human!.level, 1);
});

test('runner: timeout settles deferred cancels, lists cut steps, reports refusals (review M4)', () => {
  // how many ticks until p1 is ~70% up the stair (then a timeout lands mid-flight)
  const probe = runtime();
  probe.submit('walk_to', { actor: 'p1', x: 10, z: 10, level: 1 });
  let budget = 0;
  while (probe.world.entities.p1.pose.p[1] < 0.7 * DECK_Y && budget < 20 * 60) probe.step(), budget++;
  const rt = runtime();
  const r = runSequence(rt, [
    { id: 'climb', verb: 'walk_to', params: { actor: 'p1', x: 10, z: 10, level: 1 } },
    { id: 'later', verb: 'wait_ticks', params: { n: 5 }, after: ['climb'] },
  ], { maxTicks: budget });
  assert.equal(r.status, 'timeout');
  assert.deepEqual(r.cut.sort(), ['climb', 'later']);
  const s = Object.fromEntries(r.steps.map((x) => [x.id, x]));
  assert.equal(s.climb.status, 'cancelled', 'the deferred cancel finished inside the settle budget');
  assert.equal(s.climb.diagnostic?.code, 'sequence.timeout');
  assert.equal(s.later.status, 'skipped');
  assert.ok(r.settleTicks > 0 && r.settleTicks < SETTLE_S / DT, `settled in ${r.settleTicks} ticks`);
  assert.equal(r.settled, true, r.unsettled.join('; '));
  assert.equal(r.ticks, budget + r.settleTicks, 'final state recorded after settling');
  const p1 = rt.world.entities.p1;
  assert.equal(p1.human!.level, 1, 'stepped off at the (nearer) top landing');
  assert.equal(p1.human!.task, undefined);
  assert.ok(![...rt.records.values()].some((x) => x.status === 'executing' || x.status === 'blocked'));
  assert.deepEqual(r.violations, []);
  assert.ok(!r.diagnostics.some((d) => d.code === 'sequence.cancel-refused'), 'a deferred cancel is not a refusal');

  // an action that refuses every cancel: recorded, retried, and the result says the world is not settled
  const stubborn: ActionDef<Record<string, never>, null, Record<string, never>> = {
    verb: 'stubborn', description: 'test: never stops', schema: z.strictObject({}), reservations: () => [],
    plan: () => ({ ok: true, program: null }), start: () => ({}), step: () => ({ status: 'running', phase: 'holding' }),
    cancel: () => ({ ok: false, diagnostic: { code: 'test.refuse', message: 'will not stop here' } }),
  };
  const c = config();
  c.registry.set('stubborn', stubborn as ActionDef);
  const w = pgWorld();
  const rt2 = new Runtime(w, c.registry, c.services(w), DEFAULT_INVARIANTS);
  const r2 = runSequence(rt2, [{ id: 'hold', verb: 'stubborn', params: {} }], { maxTicks: 10 });
  assert.equal(r2.status, 'timeout');
  assert.deepEqual(r2.cut, ['hold']);
  assert.equal(r2.settled, false);
  assert.equal(r2.settleTicks, SETTLE_S / DT, 'bounded settle budget');
  assert.match(r2.unsettled[0], /step:hold \(stubborn\) is still executing/);
  assert.ok(r2.diagnostics.some((d) => d.code === 'sequence.cancel-refused' && /will not stop here/.test(d.message)));
  assert.ok(r2.diagnostics.some((d) => d.code === 'sequence.unsettled'));
});

// ---- LM-016: step timeout, cancel / mark steps (W58) ------------------------------------------------

test('runner (LM-016): a step timeout cancels the live step with a named reason and applies onFail', () => {
  const rt = runtime();
  const t0 = rt.tick;
  const r = runSequence(rt, [
    { id: 'long', verb: 'wait_ticks', params: { n: 200 }, timeout: 2 },
    { id: 'after', verb: 'wait_ticks', params: { n: 5 }, after: ['long'] },
    { id: 'side', verb: 'wait_ticks', params: { n: 100 } },
  ]);
  assert.equal(r.status, 'aborted', 'default onFail abort');
  const s = Object.fromEntries(r.steps.map((x) => [x.id, x]));
  assert.equal(s.long.status, 'cancelled');
  assert.equal(s.long.endedTick, t0 + Math.round(2 / DT));
  assert.equal(s.long.diagnostic?.code, 'sequence.step-timeout');
  assert.match(s.long.diagnostic!.message, /did not finish within its 2 s timeout/);
  assert.equal(s.side.status, 'cancelled', 'abort stops the other live step');
  assert.equal(s.after.status, 'skipped');
  assert.ok(r.diagnostics.some((d) => d.code === 'sequence.step-timeout'));
  // onFail continue: only the dependents are skipped
  const r2 = runSequence(runtime(), [
    { id: 'long', verb: 'wait_ticks', params: { n: 200 }, timeout: 1, onFail: 'continue' },
    { id: 'after', verb: 'wait_ticks', params: { n: 5 }, after: ['long'] },
    { id: 'side', verb: 'wait_ticks', params: { n: 60 } },
  ]);
  const s2 = Object.fromEntries(r2.steps.map((x) => [x.id, x]));
  assert.equal(r2.status, 'partial');
  assert.deepEqual([s2.long.status, s2.after.status, s2.side.status], ['cancelled', 'skipped', 'completed']);
  // a step that finishes in time is untouched
  const r3 = runSequence(runtime(), [{ id: 'quick', verb: 'wait_ticks', params: { n: 10 }, timeout: 5 }]);
  assert.equal(r3.status, 'completed');
});

test('runner (LM-016): cancel stops a live step (not a failure), skips a pending one; mark puts an event in the run; `at` applies', () => {
  const rt = runtime();
  const t0 = rt.tick;
  const r = runSequence(rt, [
    { id: 'wander', verb: 'wait_ticks', params: { n: 1000 } },
    { id: 'stop', verb: 'cancel', params: { step: 'wander' }, at: 1.5 },
    { id: 'never', verb: 'wait_ticks', params: { n: 5 }, at: 100 },
    { id: 'skipit', verb: 'cancel', params: { step: 'never' }, after: ['stop'] },
    { id: 'm', verb: 'mark', params: { name: 'lights-down', data: { cue: 3 } }, when: { event: 'completed', step: 'stop' } },
  ]);
  const s = Object.fromEntries(r.steps.map((x) => [x.id, x]));
  assert.equal(s.stop.status, 'completed');
  assert.equal(s.stop.submittedTick, t0 + Math.round(1.5 / DT));
  assert.equal(s.wander.status, 'cancelled');
  assert.equal(s.wander.diagnostic?.code, 'sequence.step-cancelled');
  assert.equal(s.never.status, 'skipped');
  assert.equal(s.never.diagnostic?.code, 'sequence.step-cancelled');
  assert.deepEqual(s.stop.outputs, { cancelled: 'wander', was: 'cancelled' });
  assert.equal(r.status, 'completed', 'steps the plan cancels ran as directed: no abort, not partial');
  assert.equal(r.endTick, t0 + Math.round(1.5 / DT), 'nothing left to run');
  const marks = rt.events.filter((e) => e.type === 'mark');
  assert.deepEqual(marks.map((e: any) => [e.name, e.data, e.tick]), [['lights-down', { cue: 3 }, t0 + Math.round(1.5 / DT)]]);
});

test('bind (LM-016): cancel/mark are validated like verbs — unknown / self targets and bad params are refused; timeout in the schema', () => {
  const h = pgHistory();
  const ctx = { history: h, baseline: 'ws', registry: registry() };
  const ok = bindTemplate(tpl([{ id: 'a', verb: 'wait_ticks', params: { n: 5 }, timeout: 3 }, { id: 'c', verb: 'cancel', params: { step: 'a' } }, { id: 'm', verb: 'mark', params: { name: 'x' } }]), {}, ctx);
  assert.equal(ok.steps[0].timeout, 3);
  assert.deepEqual(codes(() => bindTemplate(tpl([{ id: 'c', verb: 'cancel', params: { step: 'ghost' } }]), {}, ctx)), ['sequence.unknown-step']);
  assert.deepEqual(codes(() => bindTemplate(tpl([{ id: 'c', verb: 'cancel', params: { step: 'c' } }]), {}, ctx)), ['sequence.unknown-step']);
  assert.deepEqual(codes(() => bindTemplate(tpl([{ id: 'm', verb: 'mark', params: {} }]), {}, ctx)), ['action.invalid-params']);
  assert.deepEqual(codes(() => bindTemplate(tpl([{ id: 'a', verb: 'wait_ticks', params: { n: 5 }, timeout: -1 }]), {}, ctx)), ['sequence.invalid-template']);
});
