// Forklift (spec §7, §12): pick a plywood panel off the ground, deliver it to the proving-ground
// deck (level 1, 3 m); refusals for reach, lift range, overhead and a blocked approach; people stop
// the truck; determinism. All default + vehicle + forklift invariants enabled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import type { Obstacle, SpatialScene } from '../spatial/types.ts';
import { emptyWorld, human, addAll, component } from '../world/factory.ts';
import type { ActionDef } from '../actions/types.ts';
import { walkTo } from '../locomotion/walk.ts';
import { hashOf } from '../core/hash.ts';
import { VEHICLE_ACTIONS, VEHICLE_INVARIANTS } from '../vehicles/index.ts';
import { forklift, FORKLIFT, FORKLIFT_ACTIONS, FORKLIFT_INVARIANTS } from '../vehicles/forklift.ts';
import { stagedCheck } from '../construction/access.ts';
import { HUMAN_RADIUS } from '../world/catalog.ts';

const H = Math.PI / 2;
type Opts = { extra?: Obstacle[]; scene?: (s: SpatialScene) => void; truck?: [number, number]; ents?: ReturnType<typeof human>[] };

function setup(o: Opts = {}) {
  const base = provingGround({ extra: o.extra });
  o.scene?.(base);
  const [tx, tz] = o.truck ?? [10, -6];
  const w = addAll(emptyWorld('proving-ground', base), forklift('f1', tx, tz, H), human('op', tx + 0.95, tz), component('ply1', 'plywood-4x6', [10, 0, 0], 0, { phase: 'staged' }), ...(o.ents ?? []));
  const reg = new Map<string, ActionDef>([walkTo, ...VEHICLE_ACTIONS, ...FORKLIFT_ACTIONS].map((a) => [a.verb, a]));
  return new Runtime(w, reg, { spatial: new Spatial(base) }, [...DEFAULT_INVARIANTS, ...VEHICLE_INVARIANTS, ...FORKLIFT_INVARIANTS]);
}
const xz = (rt: Runtime, id: string): [number, number] => [rt.world.entities[id].pose.p[0], rt.world.entities[id].pose.p[2]];

function run(rt: Runtime, verb: string, params: Record<string, unknown>, ticks = 20 * 120) {
  const a = rt.submit(verb, params);
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  assert.ok(rt.runUntilIdle(ticks, [a.id]), `${verb} did not finish`);
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  return a;
}
const mountAndPick = (rt: Runtime) => {
  run(rt, 'mount', { actor: 'op', vehicle: 'f1' }, 200);
  return run(rt, 'forklift_pick', { operator: 'op', item: 'ply1' });
};
const DECK_TO = { x: 10, z: 7.7, yaw: 0, level: 1 };

test('forklift picks plywood off the ground and stages it on the 3 m deck (level 1) at the receiving edge', () => {
  const rt = setup();
  mountAndPick(rt);
  const ply = rt.world.entities.ply1;
  assert.deepEqual(ply.support, { kind: 'forks', vehicle: 'f1' });
  assert.ok(Math.abs(ply.pose.p[1] - FORKLIFT.travelHeight) < 1e-9, `travel height ${ply.pose.p[1]}`);
  const d = run(rt, 'forklift_deliver', { operator: 'op', to: DECK_TO });
  assert.deepEqual(rt.violations, []);
  assert.equal(ply.phase, 'staged');
  assert.deepEqual(ply.support, { kind: 'ground' });
  assert.ok(Math.abs(ply.pose.p[1] - 3.0) < 1e-9, `on the deck top: ${ply.pose.p[1]}`);
  assert.ok(Math.hypot(ply.pose.p[0] - 10, ply.pose.p[2] - 7.7) < 1e-6, `placed at ${xz(rt, 'ply1')}`);
  assert.equal((rt.services.spatial as Spatial).level(1)!.y, ply.pose.p[1]); // lying on level 1's floor
  // install_plywood's staged precondition accepts it where it now lies
  assert.equal(stagedCheck(ply, [10, 9], 'plywood.not-staged'), null);
  const out = d.outputs as { surface: string; reach: number };
  assert.equal(out.surface, 'deck');
  assert.ok(out.reach >= 0 && out.reach < 0.2, `reach ${out.reach}`);
  // backed off: truck front ≥ 1 m short of the deck edge (z = 7), operator back to idle-ride
  assert.ok(xz(rt, 'f1')[1] + FORKLIFT.length / 2 <= 7 - FORKLIFT.backOff + 1e-6, `truck at ${xz(rt, 'f1')}`);
  assert.equal(rt.world.entities.op.human!.task, undefined);
  assert.equal(rt.world.entities.op.human!.activity, 'ride');
});

test('refused: a placement deeper than fork reach from the deck edge', () => {
  const rt = setup();
  mountAndPick(rt);
  const a = rt.submit('forklift_deliver', { operator: 'op', to: { x: 10, z: 9.5, yaw: 0, level: 1 } });
  assert.equal(a.status, 'failed');
  assert.equal(a.diagnostic?.code, 'forklift.reach');
  assert.match(a.diagnostic!.message, /1\.40 m/);
  assert.ok(a.diagnostic!.subjects!.includes('deck'));
});

test('refused: a 3.5 m surface is above the 3.2 m lift range', () => {
  const rt = setup({
    scene: (s) => {
      s.levels.push({ id: 2, y: 3.5, label: 'high deck' });
      s.surfaces.push({ id: 'high', level: 2, y: 3.5, obb: { c: [0, 20], half: [3, 2], yaw: 0 }, label: 'high deck' });
      s.obstacles.push({ id: 'high-slab', obb: { c: [0, 20], half: [3, 2], yaw: 0 }, y0: 3.25, y1: 3.5, kind: 'solid', label: 'high deck slab' });
    },
  });
  mountAndPick(rt);
  const a = rt.submit('forklift_deliver', { operator: 'op', to: { x: 0, z: 18.6, yaw: 0, level: 2 } });
  assert.equal(a.status, 'failed');
  assert.equal(a.diagnostic?.code, 'forklift.lift-range');
  assert.match(a.diagnostic!.message, /3\.50 m .*0–3\.2 m/);
});

test('refused: an overhead beam lower than mast + load across the route', () => {
  const beam: Obstacle = { id: 'shade-beam', obb: { c: [0, 2], half: [30, 0.3], yaw: 0 }, y0: 2.0, y1: 2.3, kind: 'solid', label: 'shade beam' };
  const rt = setup({ extra: [beam] });
  mountAndPick(rt);
  const a = rt.submit('forklift_deliver', { operator: 'op', to: DECK_TO });
  assert.equal(a.status, 'failed');
  assert.equal(a.diagnostic?.code, 'forklift.overhead');
  assert.ok(a.diagnostic!.subjects!.includes('shade-beam'), a.diagnostic!.message);
  assert.match(a.diagnostic!.message, /shade beam/);
});

test('refused: both fork-side approach lanes blocked, naming the blockers', () => {
  const crate = (id: string, z: number): Obstacle => ({ id, obb: { c: [10, z], half: [1.2, 0.3], yaw: 0 }, y0: 0, y1: 1.0, kind: 'solid', label: id });
  const rt = setup({ extra: [crate('crate-s', -1.4), crate('crate-n', 1.4)] });
  run(rt, 'mount', { actor: 'op', vehicle: 'f1' }, 200);
  const a = rt.submit('forklift_pick', { operator: 'op', item: 'ply1' });
  assert.equal(a.status, 'failed');
  assert.equal(a.diagnostic?.code, 'forklift.no-approach');
  for (const id of ['crate-s', 'crate-n']) assert.ok(a.diagnostic!.subjects!.includes(id), a.diagnostic!.message);
});

test('a person walking into the lane stops the truck ≥ 1.5 m away; it asks them on and completes', () => {
  const rt = setup({ truck: [10, -11.5], ents: [human('p2', 15, -7.5)] });
  run(rt, 'mount', { actor: 'op', vehicle: 'f1' }, 200);
  const a = rt.submit('forklift_pick', { operator: 'op', item: 'ply1' });
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  const w = rt.submit('walk_to', { actor: 'p2', x: 5, z: -7.5 });
  assert.equal(w.status, 'executing', w.diagnostic?.message);
  let prev = xz(rt, 'f1'), stoppedTicks = 0, minMovingGap = Infinity;
  const gapTo = () => {
    const f = xz(rt, 'f1'), p = xz(rt, 'p2');
    // body gap to the truck box (yaw π/2: 0.6 m across x, 1.3 m along z)
    return Math.hypot(Math.max(Math.abs(p[0] - f[0]) - 0.6, 0), Math.max(Math.abs(p[1] - f[1]) - 1.3, 0)) - HUMAN_RADIUS;
  };
  rt.observers.push({
    onTick() {
      const cur = xz(rt, 'f1');
      const moved = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
      if (a.status === 'blocked' && a.diagnostic?.code === 'traffic.person' && moved < 1e-9) stoppedTicks++;
      if (moved > 1e-9) minMovingGap = Math.min(minMovingGap, gapTo());
      prev = cur;
    },
  });
  assert.ok(rt.runUntilIdle(20 * 120, [a.id]));
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assert.ok(stoppedTicks > 5, `truck stood still for p2 (${stoppedTicks} ticks)`);
  assert.ok(a.history.some((h) => h.code === 'traffic.person'));
  assert.ok(minMovingGap >= FORKLIFT.peopleGap - 0.5, `moved with p2 only ${minMovingGap.toFixed(2)} m away`);
  assert.deepEqual(rt.violations, []);
});

test('determinism: two identical runs of pick + deliver end in the same state', () => {
  const once = () => {
    const rt = setup();
    mountAndPick(rt);
    run(rt, 'forklift_deliver', { operator: 'op', to: DECK_TO });
    return { tick: rt.tick, hash: hashOf(rt.world) };
  };
  assert.deepEqual(once(), once());
});
