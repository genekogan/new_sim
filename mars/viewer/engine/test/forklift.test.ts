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
import { hypot } from '../core/math.ts';

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
  assert.ok(hypot(ply.pose.p[0] - 10, ply.pose.p[2] - 7.7) < 1e-6, `placed at ${xz(rt, 'ply1')}`);
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
    return hypot(Math.max(Math.abs(p[0] - f[0]) - 0.6, 0), Math.max(Math.abs(p[1] - f[1]) - 1.3, 0)) - HUMAN_RADIUS;
  };
  rt.observers.push({
    onTick() {
      const cur = xz(rt, 'f1');
      const moved = hypot(cur[0] - prev[0], cur[1] - prev[1]);
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

// ---------- vehicle–vehicle traffic (VEHICLES.md "Vehicle–vehicle collision") ----------

import { vehicle, footprintOf } from '../vehicles/index.ts';
import { boxGap, place, vehicleCollision } from '../vehicles/traffic.ts';
import type { Entity } from '../world/types.ts';

function traffic(ents: Entity[], extra?: Obstacle[]) {
  const base = provingGround({ extra });
  const w = addAll(emptyWorld('proving-ground', base), ...ents);
  const reg = new Map<string, ActionDef>([walkTo, ...VEHICLE_ACTIONS, ...FORKLIFT_ACTIONS].map((a) => [a.verb, a]));
  return new Runtime(w, reg, { spatial: new Spatial(base) }, [...DEFAULT_INVARIANTS, ...VEHICLE_INVARIANTS, ...FORKLIFT_INVARIANTS]);
}
/** Ground-plan gap between two vehicles' whole footprints (box, rider, tines, load). */
function vgap(rt: Runtime, a: string, b: string) {
  const fp = (id: string) => { const v = rt.world.entities[id]; return place(footprintOf(rt.world, v), xz(rt, id), v.pose.yaw).map((x) => x.obb); };
  return boxGap(fp(a), fp(b));
}
function runUntil(rt: Runtime, cond: () => boolean, max: number) {
  for (let n = 0; n < max && !cond(); n++) rt.step();
  return cond();
}
const msgsOf = (rt: Runtime) => rt.violations.map((v) => `${v.code}: ${v.message}`);

function headOn() {
  const rt = traffic([forklift('f1', -12, -6, 0), human('op1', -12, -6.95), vehicle('e1', 'euc', 10, -6, Math.PI), human('r1', 10, -5.3)]);
  run(rt, 'mount', { actor: 'op1', vehicle: 'f1' }, 200);
  run(rt, 'mount', { actor: 'r1', vehicle: 'e1' }, 200);
  let minGap = Infinity, waitBand = Infinity;
  const reach = footprintOf(rt.world, rt.world.entities.e1).reach;
  rt.observers.push({
    onTick: (r) => {
      minGap = Math.min(minGap, vgap(r, 'f1', 'e1'));
      // while it gives way, the rider's body stays ≥ YIELD_GAP from the forklift's lane (the line z = -6, ± 0.6 m truck half-width)
      const rec = [...r.records.values()].find((x) => x.verb === 'ride_to' && (x.params as { actor: string }).actor === 'r1');
      if (rec?.status === 'blocked' && rec.diagnostic?.code === 'traffic.vehicle') waitBand = Math.min(waitBand, Math.abs(xz(r, 'e1')[1] + 6) - 0.6 - reach);
    },
  });
  // the EUC sets off first (its lane is published), so the forklift plans through the lane rather than around it
  const e = rt.submit('ride_to', { actor: 'r1', x: -5, z: -6 });
  assert.equal(e.status, 'executing', e.diagnostic?.message);
  rt.step();
  const f = rt.submit('ride_to', { actor: 'op1', x: 12, z: -6 });
  assert.equal(f.status, 'executing', f.diagnostic?.message);
  const done = rt.runUntilIdle(20 * 120, [f.id, e.id]);
  return { rt, f, e, done, minGap, waitBand };
}

test('traffic: head-on forklift vs EUC in one 3 m lane — the rider (smaller) pulls over and waits ≥ 1 m clear of the forklift\'s lane, both arrive; 0 violations', () => {
  const { rt, f, e, done, minGap, waitBand } = headOn();
  assert.ok(done, `not finished: f ${f.status} ${f.diagnostic?.message} / e ${e.status} ${e.diagnostic?.message}`);
  assert.equal(f.status, 'completed', f.diagnostic?.message);
  assert.equal(e.status, 'completed', e.diagnostic?.message);
  assert.ok(e.history.some((h) => h.phase === 'pull-over'), 'the EUC (smaller) yields by pulling over');
  assert.ok(!f.history.some((h) => h.phase === 'pull-over'), 'the forklift keeps its lane');
  const waits = rt.events.filter((x) => x.type === 'action' && x.code === 'traffic.vehicle');
  assert.ok(waits.some((x) => x.type === 'action' && x.id === e.id && /gives way to op1 on f1 \(forklift\)/.test(x.message ?? '')), JSON.stringify(waits.map((x) => x.type === 'action' && x.message)));
  assert.ok(minGap >= 0.9, `the vehicles came ${minGap.toFixed(2)} m apart`);
  assert.ok(waitBand >= 1.0 - 0.02 && waitBand < Infinity, `gave way ${waitBand.toFixed(2)} m from the lane`);
  assert.ok(hypot(xz(rt, 'e1')[0] + 5, xz(rt, 'e1')[1] + 6) < 0.3, 'the rider resumed to its target');
  assert.deepEqual(msgsOf(rt), []);
});

test('traffic: a rider stopped in the forklift\'s lane — the forklift stops ≥ 1 m short and waits with the rider named; once the rider rides off it carries on; 0 violations', () => {
  const rt = traffic([forklift('f1', -12, -6, 0), human('op1', -12, -6.95), vehicle('e1', 'euc', 0, -4.5, -H), human('r1', 0.7, -4.5)]);
  run(rt, 'mount', { actor: 'op1', vehicle: 'f1' }, 200);
  run(rt, 'mount', { actor: 'r1', vehicle: 'e1' }, 200);
  // the EUC rides 1.5 m into the forklift's line and stops there before the forklift's lane reaches it
  // (riding nowhere after that, in the way); the forklift planned while the EUC was moving, so not round it
  const e = rt.submit('ride_to', { actor: 'r1', x: 0, z: -6 });
  assert.equal(e.status, 'executing', e.diagnostic?.message);
  rt.step();
  const f = rt.submit('ride_to', { actor: 'op1', x: 12, z: -6 });
  assert.equal(f.status, 'executing', f.diagnostic?.message);
  let minGap = Infinity;
  rt.observers.push({ onTick: (r) => { minGap = Math.min(minGap, vgap(r, 'f1', 'e1')); } });
  assert.ok(runUntil(rt, () => f.status === 'blocked', 20 * 30), f.status);
  assert.equal(e.status, 'completed', e.diagnostic?.message);
  assert.ok(!e.history.some((h) => h.phase === 'pull-over'), 'the EUC stopped in the lane before the lane reached it');
  assert.equal(f.diagnostic?.code, 'traffic.vehicle');
  assert.match(f.diagnostic!.message, /op1 on f1 waits for r1 on e1 \(euc\), stopped in its lane/);
  for (const id of ['op1', 'f1', 'r1', 'e1']) assert.ok(f.diagnostic!.subjects!.includes(id), id);
  for (let i = 0; i < 20 * 5; i++) rt.step();
  assert.equal(f.status, 'blocked', 'still waiting: a forklift cannot swerve round it from 1 m (2.5 m turn radius, no reversing)');
  assert.ok(minGap >= 0.95, `closest while waiting ${minGap.toFixed(2)} m`);
  // the rider rides off (it starts inside the forklift's lane and leaves it within 3 m: no pull-over needed)
  const off = rt.submit('ride_to', { actor: 'r1', x: 0, z: -2 });
  assert.equal(off.status, 'executing', off.diagnostic?.message);
  assert.ok(rt.runUntilIdle(20 * 60, [f.id, off.id]));
  assert.equal(off.status, 'completed', off.diagnostic?.message);
  assert.equal(f.status, 'completed', f.diagnostic?.message);
  assert.ok(minGap >= 0.5, `closest while the EUC left and the forklift slowed past it: ${minGap.toFixed(2)} m`);
  assert.deepEqual(msgsOf(rt), []);
});

test('traffic: two forklifts crossing — f2 (same size, id after f1) stops clear of f1\'s lane with the reason named, then crosses; 0 violations', () => {
  const rt = traffic([forklift('f1', -2, -6, 0), human('op1', -2, -6.95), forklift('f2', 4, -12, H), human('op2', 4.95, -12)]);
  run(rt, 'mount', { actor: 'op1', vehicle: 'f1' }, 200);
  run(rt, 'mount', { actor: 'op2', vehicle: 'f2' }, 200);
  let minGap = Infinity;
  rt.observers.push({ onTick: (r) => { minGap = Math.min(minGap, vgap(r, 'f1', 'f2')); } });
  const a = rt.submit('ride_to', { actor: 'op1', x: 12, z: -6 });
  const b = rt.submit('ride_to', { actor: 'op2', x: 4, z: 3 });
  assert.equal(b.status, 'executing', b.diagnostic?.message);
  assert.ok(rt.runUntilIdle(20 * 120, [a.id, b.id]));
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assert.equal(b.status, 'completed', b.diagnostic?.message);
  const wait = rt.events.find((x) => x.type === 'action' && x.id === b.id && x.status === 'blocked' && x.code === 'traffic.vehicle');
  assert.ok(wait && wait.type === 'action' && /op2 on f2 gives way to op1 on f1 \(forklift\): waits 1 m clear of its lane/.test(wait.message!), JSON.stringify(wait));
  assert.ok(!a.history.some((h) => h.status === 'blocked'), 'f1 never waited');
  assert.ok(minGap >= 1.0, `closest ${minGap.toFixed(2)} m`);
  assert.deepEqual(msgsOf(rt), []);
});

test('traffic: plan-time vehicle.path-conflict — an EUC boxed against a wall inside a moving forklift\'s lane cannot yield, so its ride is refused naming both', () => {
  // wall face 0.6 m behind the EUC (1.85 m off the forklift's line): no pull-over spot ≥ 1 m clear of the lane
  const wall: Obstacle = { id: 'lane-wall', obb: { c: [0, -3.45], half: [11, 0.1], yaw: 0 }, y0: 0, y1: 2.4, kind: 'wall', label: 'lane wall' };
  const rt = traffic([forklift('f1', -12, -6, 0), human('op1', -12, -6.95), vehicle('e1', 'euc', 2, -4.15, Math.PI), human('r1', 1.3, -4.15)], [wall]);
  run(rt, 'mount', { actor: 'op1', vehicle: 'f1' }, 200);
  const f = rt.submit('ride_to', { actor: 'op1', x: 12, z: -6 });
  assert.equal(f.status, 'executing', f.diagnostic?.message);
  run(rt, 'mount', { actor: 'r1', vehicle: 'e1' }, 200);
  while (xz(rt, 'f1')[0] < -7 && rt.isActive(f.id)) rt.step();
  const e = rt.submit('ride_to', { actor: 'r1', x: -10, z: -4.15 });
  assert.equal(e.status, 'failed');
  assert.equal(e.diagnostic?.code, 'vehicle.path-conflict', e.diagnostic?.message);
  assert.match(e.diagnostic!.message, /r1 on e1 \(euc\) would meet op1 on f1 \(forklift\).*must give way.*no room to pull over/);
  for (const id of ['r1', 'e1', 'op1', 'f1']) assert.ok(e.diagnostic!.subjects!.includes(id), id);
  // the same ride once the forklift has passed is fine
  assert.ok(rt.runUntilIdle(20 * 60, [f.id]) && (f.status as string) === 'completed', f.diagnostic?.message);
  const later = rt.submit('ride_to', { actor: 'r1', x: -10, z: -4.15 });
  assert.equal(later.status, 'executing', later.diagnostic?.message);
  assert.ok(rt.runUntilIdle(20 * 60, [later.id]) && (later.status as string) === 'completed', later.diagnostic?.message);
  assert.deepEqual(msgsOf(rt), []);
});

test('traffic: forced overlaps fire collision.vehicle-vehicle naming both (and a carried load); a load raised clear above a parked EUC does not', () => {
  const rt = setup({ ents: [human('r1', 3, 3)] });
  addAll(rt.world, vehicle('e1', 'euc', 3, 2, 0));
  mountAndPick(rt); // ply1 on f1's forks at travel height
  const load = rt.world.entities.ply1;
  assert.equal(load.support?.kind, 'forks');
  assert.deepEqual(msgsOf(rt), []);
  // forced (direct world edit — edit_world itself refuses to move vehicles): park e1 under the load
  const e1 = rt.world.entities.e1;
  e1.pose.p = [load.pose.p[0], 0, load.pose.p[2]];
  rt.step();
  const v = rt.violations.filter((x) => x.code === 'collision.vehicle-vehicle');
  assert.equal(v.length, 1, msgsOf(rt).join('\n'));
  assert.ok(['e1', 'f1', 'ply1'].every((id) => v[0].subjects!.includes(id)), v[0].message);
  assert.match(v[0].message, /f1's ply1 overlaps e1 \(euc\)|e1 \(euc\) overlaps f1's ply1/);
  // the load 2.5 m up is clear of a parked (riderless) EUC's 0.55 m box
  const n0 = rt.violations.length;
  load.pose.p = [load.pose.p[0], 2.5, load.pose.p[2]];
  rt.world.entities.e1.pose.p = [load.pose.p[0] + 0, 0, load.pose.p[2]];
  const col = vehicleCollision;
  assert.deepEqual(col(rt).map((d) => d.code), []);
  // truck body on truck body
  addAll(rt.world, forklift('f2', xz(rt, 'f1')[0] + 1, xz(rt, 'f1')[1], H));
  const d = col(rt);
  assert.equal(d.length, 1);
  assert.deepEqual(d[0].subjects!.slice(0, 2), ['f1', 'f2']);
  assert.ok(rt.violations.length === n0);
});

test('traffic determinism: the head-on run twice → same state hash and event log', () => {
  const a = headOn(), b = headOn();
  assert.equal(a.rt.stateHash(), b.rt.stateHash());
  assert.equal(JSON.stringify(a.rt.events), JSON.stringify(b.rt.events));
});
