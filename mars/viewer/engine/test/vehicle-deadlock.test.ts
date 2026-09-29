import { test } from 'node:test';
import { z } from 'zod';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { Runtime } from '../runtime/runtime.ts';
import { SequenceRunner } from '../sequence/runner.ts';
import { Spatial } from '../spatial/service.ts';
import type { SpatialScene } from '../spatial/types.ts';
import { emptyWorld, human, addAll } from '../world/factory.ts';
import { vehicle, VEHICLE_ACTIONS, VEHICLE_INVARIANTS } from '../vehicles/index.ts';
import { rideTo, rideQuiescent } from '../vehicles/actions.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import type { StepSpec } from '../sequence/types.ts';
import type { ActionDef } from '../actions/types.ts';

// Actual mounted traffic, no injected waits, lanes or poses. The early westbound
// EUC enters a pull-over and physically blocks the eastbound rider; southbound
// traffic completes the three-way wait through the existing priority rules.
function junction(extra: StepSpec[] = []) {
  const base: SpatialScene = {
    bounds: [-8, -8, 8, 8], levels: [{ id: 0, y: 0, label: 'ground' }],
    surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [8, 8], yaw: 0 } }],
    obstacles: [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([x, z], i) => ({ id: `wall${i}`, obb: { c: [x * 4.5, z * 4.5], half: [3.5, 3.5], yaw: 0 }, y0: 0, y1: 3 })), links: [],
  };
  const poses = [[-5, 0, 0], [0, -2, Math.PI / 2], [3, 0, Math.PI]];
  const entities = poses.flatMap(([x, z, yaw], i) => [vehicle(`v${i}`, 'euc', x, z, yaw), human(`p${i}`, x + (i === 1 ? 0.65 : 0), z + (i === 1 ? 0 : 0.65))]);
  const execs = new Map<string, Parameters<typeof rideTo.step>[1]>();
  const observed: typeof rideTo = { ...rideTo, start(rt, p, program, id) { const ex = rideTo.start(rt, p, program, id); execs.set(ex.vehicle, ex); return ex; } };
  const registry = new Map<string, ActionDef>(VEHICLE_ACTIONS.map((a) => [a.verb, a.verb === 'ride_to' ? observed : a]));
  const rt = new Runtime(addAll(emptyWorld('vehicle-cycle', base), ...entities), registry, { spatial: new Spatial(base) }, [...DEFAULT_INVARIANTS, ...VEHICLE_INVARIANTS]);
  for (let i = 0; i < 3; i++) {
    const m = rt.submit('mount', { actor: `p${i}`, vehicle: `v${i}` });
    assert.ok(rt.runUntilIdle(100, [m.id])); assert.equal(m.status, 'completed', m.diagnostic?.message);
  }
  const steps: StepSpec[] = [[1.2, 0], [0, 5], [-1.2, 0]].map(([x, z], i) => ({ id: `ride${i}`, verb: 'ride_to', params: { actor: `p${i}`, x, z, speed: i === 0 ? 0.8 : 2 } }));
  const runner = new SequenceRunner(rt, [...steps, ...extra]); runner.advance();
  return { rt, runner, execs };
}

test('real three-EUC cycle is certified blocked while riders and vehicle ownership remain supported', () => {
  const { rt, runner } = junction();
  const result = runner.run(1000);
  assert.equal(result.status, 'blocked'); assert.equal(result.settled, false);
  assert.equal(result.settleTicks, 0); assert.deepEqual(result.cut, []);
  const cycle = result.steps[0].diagnostic!;
  assert.equal(cycle.code, 'deadlock.cycle'); assert.deepEqual(cycle.subjects, ['v0', 'v1', 'v2']);
  assert.deepEqual(cycle.details?.edges, [{ from: 'v0', to: 'v2' }, { from: 'v1', to: 'v0' }, { from: 'v2', to: 'v1' }]);
  const stopped = structuredClone(rt.world.entities);
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(rt.world.entities[`v${i}`].support, { kind: 'ridden-by', by: `p${i}` });
    assert.equal(rt.world.entities[`p${i}`].human!.riding, `v${i}`);
    assert.deepEqual(rt.holder(`actor:p${i}`), [`step:ride${i}`]);
    assert.deepEqual(rt.holder(`entity:v${i}`), [`step:ride${i}`]);
  }
  const hash = rt.stateHash();
  assert.throws(() => rt.snapshot(), /not resumable|cannot take a resumable snapshot/);
  assert.equal(rt.stateHash(), hash, 'unsupported ride snapshot refuses without mutation');
  for (let i = 0; i < 5; i++) runner.tick();
  assert.deepEqual(rt.world.entities, stopped); assert.deepEqual(rt.violations, []);
  if (process.env.VEHICLE_DEADLOCK_CAPTURE) writeFileSync(process.env.VEHICLE_DEADLOCK_CAPTURE, JSON.stringify({ result, vehicles: [0, 1, 2].map((i) => ({ vehicle: rt.world.entities[`v${i}`], rider: rt.world.entities[`p${i}`], owners: rt.holder(`entity:v${i}`) })), snapshotRefusedWithoutMutation: true }, null, 2) + '\n');
});

test('mid-pull-over certification excludes endpoint/resume boundaries, active progress and pending replan/cancel', () => {
  const { rt, runner, execs } = junction(); runner.run(1000);
  const ex = execs.get('v2')!, exhausted = new Set(['v0', 'v1', 'v2']);
  assert.ok(ex.yielding); assert.ok(rideQuiescent(rt, ex, exhausted));
  for (const patch of [{ v: 0.02 }, { cancelling: true }, { replan: true }, { phase: 'pivot' as const }]) assert.equal(rideQuiescent(rt, { ...ex, ...patch }, exhausted), false);
  assert.equal(rideQuiescent(rt, ex, new Set()), false);
  for (const gap of [0, 0.059, 0.06]) {
    const short = { ...ex, curve: { ...ex.curve, length: ex.curve.samples[ex.idx].s + gap } };
    assert.equal(rideQuiescent(rt, short, exhausted), false);
    const p = rt.world.entities.v2.pose.p;
    const samples = [...ex.curve.samples]; samples[samples.length - 1] = { ...samples.at(-1)!, p: [p[0] + gap, p[2]] };
    assert.equal(rideQuiescent(rt, { ...ex, curve: { ...ex.curve, samples } }, exhausted), false);
  }
});

test('a real three-vehicle wait cannot stop ahead of an independent future cancel', () => {
  const { rt, runner } = junction([{ id: 'later', verb: 'cancel', params: { step: 'ride1' }, at: 40 }]);
  for (let i = 0; i < 650; i++) runner.tick();
  assert.ok(rt.exhaustedWaitDiagnostics()); assert.equal(runner.result().status, 'partial');
  for (let i = 0; i < 151; i++) runner.tick();
  assert.equal(runner.reports[3].status, 'completed');
  assert.equal(runner.reports[1].status, 'cancelled');
  assert.deepEqual(rt.world.entities.v1.support, { kind: 'ridden-by', by: 'p1' });
  const before = structuredClone(rt.world.entities.v1.pose);
  const escape = rt.submit('ride_to', { actor: 'p1', x: 0, z: -5, speed: 0.8 });
  assert.equal(escape.status, 'executing', escape.diagnostic?.message);
  for (let i = 0; i < 300; i++) runner.tick();
  assert.notDeepEqual(rt.world.entities.v1.pose, before, 'external directive physically moves the blocker');
  assert.ok(runner.reports.slice(0, 3).every((r) => r.diagnostic?.code !== 'deadlock.cycle'), 'old cycle disappears when its blocker leaves');
  assert.deepEqual(rt.violations, []);
});


test('unknown live work and a future live-step timeout still prevent vehicle-cycle termination', () => {
  const { rt, runner } = junction();
  runner.steps[1].timeout = 40;
  for (let i = 0; i < 600; i++) runner.tick();
  assert.equal(runner.result().status, 'partial'); assert.ok(rt.exhaustedWaitDiagnostics());
  delete runner.steps[1].timeout;
  const unknown: ActionDef = {
    verb: 'unknown-work', description: 'unknown independent test work', schema: z.object({}),
    reservations: () => [], plan: () => ({ ok: true, program: null }), start: () => ({}),
    step: () => ({ status: 'running' }), cancel: () => ({ ok: true }),
  };
  rt.registry = new Map([...rt.registry, [unknown.verb, unknown]]);
  rt.submit(unknown.verb, {}); runner.tick();
  assert.equal(runner.result().status, 'partial'); assert.equal(rt.exhaustedWaitDiagnostics(), null);
  assert.deepEqual(rt.violations, []);
});
