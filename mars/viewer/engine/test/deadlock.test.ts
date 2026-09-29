import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import type { ActionDef } from '../actions/types.ts';
import { Runtime } from '../runtime/runtime.ts';
import { DEADLOCK_TICKS, publishWait } from '../runtime/waits.ts';
import { SequenceRunner } from '../sequence/runner.ts';
import { addAll, emptyWorld, human, component } from '../world/factory.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { carry } from '../carry/actions.ts';
import { carryCorridors } from '../carry/scenes.ts';
import { CARRY_INVARIANTS } from '../carry/invariants.ts';
import { walkTo } from '../locomotion/walk.ts';
import { provingGround } from '../scenes/proving-ground.ts';

// Deliberately forced wait edges, not a physical vehicle/corridor proof.
const forced: ActionDef<{ movers: string[]; parentRunning?: boolean }, null, { movers: string[]; parentRunning?: boolean; id: string }> = {
  verb: 'forced_wait', description: 'test wait publication', resumable: true,
  schema: z.object({ movers: z.array(z.string()), parentRunning: z.boolean().optional() }),
  reservations: (_w, p) => p.movers.map((mover) => ({ resource: `actor:${mover}`, mode: 'exclusive' as const })),
  plan: () => ({ ok: true, program: null }), start: (_rt, p, _program, id) => ({ ...p, id }),
  step(rt, ex) {
    for (const mover of ex.movers) {
      const blockers: string[] = rt.services.testEdges[mover] ?? [];
      if (blockers.length) publishWait(rt, ex.id, mover, blockers, { code: 'test.wait', message: 'blocked' }, rt.services.testAliases?.[mover]);
    }
    if (ex.movers.every((mover) => !rt.services.testEdges[mover]?.length)) return { status: 'completed' };
    return ex.parentRunning ? { status: 'running', phase: 'gather' } : { status: 'blocked', diagnostic: { code: 'test.wait', message: 'blocked' } };
  }, cancel: () => ({ ok: true }),
};
const registry = new Map<string, ActionDef>([[forced.verb, forced]]);
function setup(edges: Record<string, string[]>, aliases: Record<string, string[]> = {}) {
  const world = addAll(emptyWorld('test', provingGround()), ...Object.keys(edges).map((id, i) => human(id, -20 + i * 2, -20)));
  return new Runtime(world, registry, { testEdges: structuredClone(edges), testAliases: aliases });
}
function ticks(rt: Runtime, n: number) { for (let i = 0; i < n; i++) rt.step(); }
function submit(rt: Runtime) { return Object.keys(rt.services.testEdges).map((mover) => rt.submit('forced_wait', { movers: [mover] }, { id: mover })); }

test('forced three-cycle: deterministic threshold, stable diagnostic, resources retained and recovery on broken edge', () => {
  const rt = setup({ c: ['a'], a: ['b'], b: ['c'] });
  const records = submit(rt);
  ticks(rt, DEADLOCK_TICKS - 1);
  assert.ok(records.every((r) => r.diagnostic?.code === 'test.wait'));
  rt.step();
  assert.ok(records.every((r) => r.diagnostic?.code === 'deadlock.cycle'));
  assert.deepEqual(records[0].diagnostic?.subjects, ['a', 'b', 'c']);
  assert.deepEqual(records[0].diagnostic?.details?.edges, [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }]);
  const eventCount = rt.events.length;
  ticks(rt, 10);
  assert.equal(rt.events.length, eventCount, 'persistent overlay does not alternate with the ordinary wait');
  for (const id of ['a', 'b', 'c']) assert.deepEqual(rt.holder(`actor:${id}`), [id], 'reporting does not free reservations');
  rt.services.testEdges.c = [];
  rt.step();
  assert.equal(rt.records.get('c')?.status, 'completed');
  assert.equal(rt.records.get('a')?.diagnostic?.code, 'test.wait');
  rt.services.testEdges.a = []; rt.services.testEdges.b = [];
  rt.step();
  assert.ok(records.every((r) => r.status === 'completed'));
  assert.equal(rt.services.moverWaits, undefined, 'transient tracker does not persist after all waits end');
  assert.equal(rt.violations.length, 0);
});

test('invalid cycle claims: external sinks, acyclic chains and self aliases never form a cycle', () => {
  for (const edges of [{ a: ['b'], b: ['idle'] }, { a: ['a'], b: ['wall'] }, { a: ['rider'], b: ['a'] }]) {
    const rt = setup(edges, { a: ['rider'] }); const records = submit(rt);
    ticks(rt, DEADLOCK_TICKS + 1);
    assert.ok(records.every((r) => r.diagnostic?.code !== 'deadlock.cycle'));
  }
});

test('gather walkers remain separate mover nodes even when they share one running parent', () => {
  const rt = setup({ a: ['b'], b: ['a'] });
  const rec = rt.submit('forced_wait', { movers: ['a', 'b'], parentRunning: true }, { id: 'carry-parent' });
  ticks(rt, DEADLOCK_TICKS);
  assert.equal(rec.diagnostic?.code, 'deadlock.cycle');
  assert.deepEqual(rec.diagnostic?.subjects, ['a', 'b']);
  assert.equal(rec.status, 'blocked');
  const count = rt.events.length; ticks(rt, 3); assert.equal(rt.events.length, count);
});

test('vehicle/load aliases resolve to mover identity; progress and changed edges reset the episode', () => {
  const rt = setup({ a: ['operator-b'], b: ['crew-a'] }, { a: ['crew-a'], b: ['operator-b'] });
  const records = submit(rt);
  ticks(rt, DEADLOCK_TICKS - 1);
  rt.world.entities.a.pose.p[0] += 0.01; rt.step();
  assert.ok(records.every((r) => r.diagnostic?.code === 'test.wait'));
  ticks(rt, DEADLOCK_TICKS - 1);
  assert.ok(records.every((r) => r.diagnostic?.code === 'deadlock.cycle'));
  rt.services.testEdges.a = ['wall']; rt.step();
  assert.ok(records.every((r) => r.diagnostic?.code === 'test.wait'));
});

test('sequence reports live diagnostic; a future cancellation cue remains eligible', () => {
  const rt = setup({ a: ['b'], b: ['a'] });
  const runner = new SequenceRunner(rt, [
    { id: 'a', verb: 'forced_wait', params: { movers: ['a'] } },
    { id: 'b', verb: 'forced_wait', params: { movers: ['b'] } },
    { id: 'cancel-a', verb: 'cancel', params: { step: 'a' }, at: 12 },
  ]);
  runner.advance();
  for (let i = 0; i < DEADLOCK_TICKS; i++) runner.tick();
  assert.ok(runner.reports.slice(0, 2).every((r) => r.diagnostic?.code === 'deadlock.cycle'));
  assert.equal(runner.reports[2].status, 'pending');
  for (let i = 0; i < 40; i++) runner.tick();
  assert.equal(runner.reports[0].status, 'cancelled');
  assert.equal(runner.reports[2].status, 'completed');
  runner.tick(); // cancellation is cued after the previous tick's coherent graph
  assert.equal(runner.reports[1].diagnostic?.code, 'test.wait');
});

test('JSON snapshot preserves an in-progress wait episode and exact diagnostic tick', () => {
  const rt = setup({ a: ['b'], b: ['a'] }); submit(rt);
  ticks(rt, 150);
  const snap = JSON.parse(JSON.stringify(rt.snapshot()));
  const restored = Runtime.restore(snap, registry, {});
  const cursor = rt.events.length;
  for (let i = 0; i < 60; i++) { rt.step(); restored.step(); assert.equal(restored.stateHash(), rt.stateHash()); }
  assert.deepEqual(restored.events, rt.events.slice(cursor));
  assert.deepEqual(restored.records.get('a')?.diagnostic, rt.records.get('a')?.diagnostic);
  assert.equal(restored.events.find((e) => e.type === 'action' && e.code === 'deadlock.cycle')?.tick, DEADLOCK_TICKS);
});


test('actual opposing passage walkers publish concrete dependencies and recover without a persistent cycle', () => {
  const base = provingGround();
  const world = addAll(emptyWorld('proving-ground', base), human('n1', 15, -20, { yaw: Math.PI / 2 }), human('s1', 15, -10, { yaw: -Math.PI / 2 }));
  const rt = new Runtime(world, new Map<string, ActionDef>([[walkTo.verb, walkTo]]), { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
  let published = false;
  rt.observers.push({ onTick(r) {
    for (const sample of r.services.moverWaits?.samples.values() ?? []) {
      if (sample.mover === 'n1' && sample.blockers.includes('s1') || sample.mover === 's1' && sample.blockers.includes('n1')) published = true;
    }
  } });
  const a = rt.submit('walk_to', { actor: 'n1', x: 15, z: -10.5 });
  const b = rt.submit('walk_to', { actor: 's1', x: 15, z: -19.5 });
  assert.ok(rt.runUntilIdle(1800));
  assert.equal(a.status, 'completed'); assert.equal(b.status, 'completed');
  assert.ok(published, 'actual walk branch publishes the other mover');
  assert.ok(!rt.events.some((e) => e.type === 'action' && e.code === 'deadlock.cycle'));
  assert.deepEqual(rt.violations, []);
});


test('actual held carry publishes its load and crew aliases; persistent reporting preserves support and leaves the result unsettled', () => {
  const base = carryCorridors();
  const world = addAll(emptyWorld('carry-test', base), component('b1', 'beam-12ft', [4, 0, 4]), human('p1', 2, 6.5), human('p2', 6, 1.5), human('bystander', 18, 11));
  const stationary: typeof forced = { ...forced, start(rt, p, program, id) {
    for (const actor of p.movers) rt.world.entities[actor].human!.task = id;
    return forced.start(rt, p, program, id);
  } };
  const rt = new Runtime(world, new Map<string, ActionDef>([[carry.verb, carry], [walkTo.verb, walkTo], [forced.verb, stationary]]),
    { spatial: new Spatial(base), testEdges: { bystander: ['b1'] } }, [...DEFAULT_INVARIANTS, ...CARRY_INVARIANTS]);
  const runner = new SequenceRunner(rt, [
    { id: 'hold', verb: 'forced_wait', params: { movers: ['bystander'] } },
    { id: 'carry', verb: 'carry', params: { crew: ['p1', 'p2'], item: 'b1', to: { x: 18, z: 11, yaw: Math.PI / 2 } } },
  ]);
  runner.advance();
  for (let i = 0; i < 1000 && runner.reports[1].diagnostic?.code !== 'deadlock.cycle'; i++) runner.tick();
  assert.equal(runner.reports[1].diagnostic?.code, 'deadlock.cycle');
  assert.deepEqual(world.entities.b1.support, { kind: 'held', by: ['p1', 'p2'] });
  assert.deepEqual(rt.holder('entity:b1'), ['step:carry']);
  assert.deepEqual(rt.services.moverWaits.samples.get('b1').aliases, ['b1', 'p1', 'p2']);
  assert.equal(runner.result().settled, false);
  assert.ok(runner.result().unsettled.some((reason) => reason.includes('step:carry')));
  assert.deepEqual(rt.violations, []);
  if (process.env.DEADLOCK_CAPTURE) console.log(JSON.stringify({ tick: rt.tick, diagnostic: runner.reports[1].diagnostic, support: world.entities.b1.support, result: runner.result(), violations: rt.violations }));
});

test('actual waiting walker snapshot resumes exactly; older snapshots without tracker start a fresh episode', () => {
  const base = provingGround();
  const world = addAll(emptyWorld('proving-ground', base), human('n1', 15, -20, { yaw: Math.PI / 2 }), human('s1', 15, -10, { yaw: -Math.PI / 2 }));
  const reg = new Map<string, ActionDef>([[walkTo.verb, walkTo]]);
  const rt = new Runtime(world, reg, { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
  rt.submit('walk_to', { actor: 'n1', x: 15, z: -10.5 }); rt.submit('walk_to', { actor: 's1', x: 15, z: -19.5 });
  for (let i = 0; i < 300 && !rt.services.moverWaits; i++) rt.step();
  assert.ok(rt.services.moverWaits);
  const restored = Runtime.restore(JSON.parse(JSON.stringify(rt.snapshot())), reg, { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
  const cursor = rt.events.length;
  for (let i = 0; i < 300; i++) { rt.step(); restored.step(); assert.equal(rt.stateHash(), restored.stateHash()); }
  assert.deepEqual(restored.events, rt.events.slice(cursor));
  assert.deepEqual(restored.violations, []);

  const old = setup({ a: ['b'], b: ['a'] }); submit(old); ticks(old, 150);
  delete old.services.moverWaits; // exact legacy snapshot condition: service field absent
  const legacy = Runtime.restore(JSON.parse(JSON.stringify(old.snapshot())), registry, {});
  assert.equal(legacy.services.moverWaits, undefined);
  ticks(legacy, DEADLOCK_TICKS - 1);
  assert.equal(legacy.records.get('a')?.diagnostic?.code, 'test.wait');
  legacy.step();
  assert.equal(legacy.records.get('a')?.diagnostic?.code, 'deadlock.cycle');
  assert.equal(legacy.records.get('a')?.diagnostic?.details?.sinceTick, 151);
});

test('ambiguous mover aliases do not invent a cycle', () => {
  const rt = setup({ a: ['ambiguous'], b: ['a'], c: ['wall'] }, { b: ['ambiguous'], c: ['ambiguous'] });
  const records = submit(rt); ticks(rt, DEADLOCK_TICKS + 1);
  assert.ok(records.every((r) => r.diagnostic?.code !== 'deadlock.cycle'));
});


test('another action cancelling a reported cycle member in the same tick cannot resurrect its record', () => {
  const rt = setup({ a: ['b'], b: ['a'] }); submit(rt); ticks(rt, DEADLOCK_TICKS);
  const cancel: ActionDef = { ...forced, verb: 'cancel-peer', reservations: () => [], step(runtime) {
    runtime.cancel('a'); return { status: 'completed' };
  } };
  rt.registry = new Map([...rt.registry, [cancel.verb, cancel]]);
  rt.submit(cancel.verb, { movers: [] }); rt.step();
  assert.equal(rt.records.get('a')?.status, 'cancelled');
  assert.equal(rt.isActive('a'), false);
  assert.equal(rt.records.get('b')?.diagnostic?.code, 'test.wait');
});
