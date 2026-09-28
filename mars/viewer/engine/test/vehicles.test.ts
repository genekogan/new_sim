// Vehicle movement profiles (spec §10, §17 riding): EUC / bicycle riders on the proving ground with
// all default + vehicle invariants enabled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { clearanceAt, nearestBlocker } from '../spatial/grid.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import type { Obstacle } from '../spatial/types.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import { emptyWorld, human, addAll } from '../world/factory.ts';
import type { Entity } from '../world/types.ts';
import { walkTo } from '../locomotion/walk.ts';
import type { ActionDef } from '../actions/types.ts';
import { angleDelta, hypot } from '../core/math.ts';
import { EUC_PROFILE, turnRadiusAt, vehicle, VEHICLE_ACTIONS, VEHICLE_INVARIANTS, STOP_GAP, planCurve } from '../vehicles/index.ts';
import { HUMAN_RADIUS } from '../world/catalog.ts';

function setup(ents: Entity[], extra?: Obstacle[]) {
  const base = provingGround({ extra });
  const w = addAll(emptyWorld('proving-ground', base), ...ents);
  const reg = new Map<string, ActionDef>([walkTo, ...VEHICLE_ACTIONS].map((a) => [a.verb, a]));
  return new Runtime(w, reg, { spatial: new Spatial(base) }, [...DEFAULT_INVARIANTS, ...VEHICLE_INVARIANTS]);
}
const sp = (rt: Runtime) => rt.services.spatial as Spatial;
const xz = (rt: Runtime, id: string): [number, number] => [rt.world.entities[id].pose.p[0], rt.world.entities[id].pose.p[2]];
const dist = (a: [number, number], b: [number, number]) => hypot(a[0] - b[0], a[1] - b[1]);

function mounted(rt: Runtime, actor: string, veh: string) {
  const m = rt.submit('mount', { actor, vehicle: veh });
  assert.equal(m.status, 'executing', m.diagnostic?.message);
  assert.ok(rt.runUntilIdle(200, [m.id]));
  assert.equal(m.status, 'completed');
  assert.equal(rt.world.entities[actor].human!.activity, 'ride');
}

/** Per tick: speed, and the turn radius actually driven must respect the speed-dependent minimum. */
function trackMotion(rt: Runtime, veh: string) {
  const s = { maxSpeed: 0, turnViolations: [] as string[], prev: { p: xz(rt, veh), yaw: rt.world.entities[veh].pose.yaw } };
  rt.observers.push({
    onTick() {
      const e = rt.world.entities[veh];
      const p = xz(rt, veh);
      const ds = dist(p, s.prev.p);
      const v = ds / (1 / 20);
      s.maxSpeed = Math.max(s.maxSpeed, v);
      const dyaw = Math.abs(angleDelta(s.prev.yaw, e.pose.yaw));
      if (ds > 1e-6 && dyaw > ds / turnRadiusAt(EUC_PROFILE, v) + 1e-9) s.turnViolations.push(`t${rt.tick}: ${(ds / dyaw).toFixed(2)} m at ${v.toFixed(2)} m/s`);
      s.prev = { p, yaw: e.pose.yaw };
    },
  });
  return s;
}

test('EUC rides around the proving-ground wall: curvature-limited (1.5 m at speed), clear of the wall, longer than walking', () => {
  const rt = setup([human('p1', -18.7, -15), vehicle('e1', 'euc', -18, -15, 0)]);
  mounted(rt, 'p1', 'e1');
  const walk = sp(rt).route(rt.world, HUMAN_PROFILE, { level: 0, p: [-18, -15] }, { level: 0, p: [-12, -15] });
  assert.ok(walk.ok);
  const m = trackMotion(rt, 'e1');
  let minClear = Infinity;
  rt.observers.push({ onTick: () => { minClear = Math.min(minClear, clearanceAt(sp(rt).level(0)!, xz(rt, 'e1'))); } });
  const a = rt.submit('ride_to', { actor: 'p1', x: -12, z: -15 });
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  assert.ok(rt.runUntilIdle(20 * 60, [a.id]));
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  const out = a.outputs as { length: number; maxLatAccel: number; minRadius: number; miss: number };
  assert.deepEqual(rt.violations, []);
  assert.deepEqual(m.turnViolations, []);
  assert.ok(dist(xz(rt, 'e1'), [-12, -15]) < 0.1, `ended at ${xz(rt, 'e1')}`);
  assert.deepEqual(xz(rt, 'p1'), xz(rt, 'e1'));
  assert.ok(minClear >= EUC_PROFILE.radius, `min clearance ${minClear}`);
  assert.ok(out.maxLatAccel <= EUC_PROFILE.latAccel + 1e-6, `lateral ${out.maxLatAccel}`);
  assert.ok(out.minRadius >= EUC_PROFILE.minTurnRadius, `arc radius ${out.minRadius}`);
  assert.ok(m.maxSpeed > 1.5 && m.maxSpeed <= EUC_PROFILE.speed + 1e-9, `max speed ${m.maxSpeed}`);
  // swinging wide round the wall end on turn-radius arcs costs distance over the walking corridor
  assert.ok(out.length > walk.route.length && out.length < 1.4 * walk.route.length, `ride ${out.length} vs walk ${walk.route.length}`);
  // a stiff EUC that can never turn tighter than 1.5 m still gets round the wall end, on ≥ 1.65 m arcs
  const stiff = { ...EUC_PROFILE, id: 'euc-stiff', minTurnRadius: 1.5 };
  const c = planCurve(sp(rt), rt.world, stiff, 'p1', 0, [-12, -15], [[-18, -15]], 3);
  assert.ok(c.ok, c.ok ? '' : c.diagnostic.message);
  assert.ok(c.curve.minRadius >= 1.5 * 1.1 - 1e-9, `stiff arc radius ${c.curve.minRadius}`);
  for (const q of c.curve.samples) assert.ok(clearanceAt(sp(rt).level(0)!, q.p) >= stiff.radius, `stiff curve clearance at ${q.p}`);
});

test('refused: a target on the deck (vehicles never use links), and walking while riding', () => {
  const rt = setup([human('p1', 0.7, 3), vehicle('e1', 'euc', 0, 3, 0)]);
  mounted(rt, 'p1', 'e1');
  const deck = rt.submit('ride_to', { actor: 'p1', x: 10, z: 10, level: 1 });
  assert.equal(deck.status, 'failed');
  assert.equal(deck.diagnostic?.code, 'route.vehicle-no-link');
  assert.match(deck.diagnostic!.message, /stairs-a/);
  const w = rt.submit('walk_to', { actor: 'p1', x: 3, z: 3 });
  assert.equal(w.status, 'failed');
  assert.equal(w.diagnostic?.code, 'actor.holding');
});

test('person on the path: the EUC slows, stops ≥ 1.0 m short, asks them to step aside, then rides on', () => {
  const rt = setup([human('p1', -0.7, -5), vehicle('e1', 'euc', 0, -5, 0), human('p2', 7, -5)]);
  mounted(rt, 'p1', 'e1');
  const a = rt.submit('ride_to', { actor: 'p1', x: 14, z: -5 });
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  let blockedGap = Infinity, sawBlock = false;
  rt.observers.push({
    onTick() {
      if (a.status === 'blocked' && a.diagnostic?.code === 'traffic.person') {
        sawBlock = true;
        blockedGap = Math.min(blockedGap, dist(xz(rt, 'e1'), xz(rt, 'p2')) - EUC_PROFILE.radius - HUMAN_RADIUS);
      }
    },
  });
  assert.ok(rt.runUntilIdle(20 * 90));
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assert.ok(sawBlock, 'the rider waited for p2');
  assert.ok(blockedGap >= STOP_GAP, `stopped ${blockedGap.toFixed(2)} m short`);
  assert.ok([...rt.records.values()].some((r) => r.verb === 'walk_to' && r.params && (r.params as { actor: string }).actor === 'p2' && r.status === 'completed'), 'p2 stepped aside');
  assert.deepEqual(rt.violations, []); // includes vehicle.close-pass: ≤ 1 m/s within 0.6 m of p2
  assert.ok(dist(xz(rt, 'e1'), [14, -5]) < 0.1);
});

test('dismount: the rider steps off beside it; the parked EUC is an obstacle walkers route around', () => {
  const rt = setup([human('p1', -8.7, 0), vehicle('e1', 'euc', -8, 0, 0), human('p3', -9, 3)]);
  mounted(rt, 'p1', 'e1');
  const a = rt.submit('ride_to', { actor: 'p1', x: -4, z: 0 });
  assert.ok(rt.runUntilIdle(20 * 30, [a.id]));
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  const d = rt.submit('dismount', { actor: 'p1' });
  assert.equal(d.status, 'executing', d.diagnostic?.message);
  assert.ok(rt.runUntilIdle(200, [d.id]));
  assert.equal(d.status, 'completed');
  const p1 = rt.world.entities.p1, e1 = rt.world.entities.e1;
  assert.equal(p1.human!.activity, 'idle');
  assert.equal(p1.human!.riding, undefined);
  assert.equal(p1.human!.grip, undefined);
  assert.equal(e1.phase, undefined);
  assert.deepEqual(e1.support, { kind: 'ground' });
  const g = (sp(rt).sync(rt.world), sp(rt).level(0)!);
  assert.equal(clearanceAt(g, xz(rt, 'e1')), 0);
  assert.equal(nearestBlocker(g, xz(rt, 'e1')), 'e1');
  // a walker whose straight line crosses the parked EUC goes round it
  const ev = xz(rt, 'e1');
  const w = rt.submit('walk_to', { actor: 'p3', x: ev[0] + 3, z: ev[1] });
  // (p3 first walks to the EUC's line)
  assert.ok(rt.runUntilIdle(20 * 30, [w.id]));
  const w2 = rt.submit('walk_to', { actor: 'p3', x: ev[0] - 3, z: ev[1] });
  assert.equal(w2.status, 'executing', w2.diagnostic?.message);
  let closest = Infinity;
  rt.observers.push({ onTick: () => { closest = Math.min(closest, dist(xz(rt, 'p3'), ev)); } });
  assert.ok(rt.runUntilIdle(20 * 30, [w2.id]));
  assert.equal(w2.status, 'completed');
  assert.ok(closest > 0.25 + HUMAN_RADIUS, `walker came ${closest.toFixed(2)} m from the EUC centre`);
  assert.deepEqual(rt.violations, []);
  // and the EUC can be mounted again from where p3 now stands? (reach) — p1 still beside it can
  mounted(rt, 'p1', 'e1');
  assert.deepEqual(rt.violations, []);
});

test('ride_loop: a closed 2-lap perimeter is one continuous, deterministic curve', () => {
  const run = () => {
    const rt = setup([human('p1', -8.7, -8), vehicle('e1', 'euc', -8, -8, 0), human('p2', -4, -1)]);
    mounted(rt, 'p1', 'e1');
    const a = rt.submit('ride_loop', { actor: 'p1', points: [{ x: -8, z: -8 }, { x: 0, z: -8 }, { x: 0, z: 0 }, { x: -8, z: 0 }], laps: 2 });
    assert.equal(a.status, 'executing', a.diagnostic?.message);
    assert.ok(rt.runUntilIdle(20 * 120, [a.id]));
    assert.equal(a.status, 'completed', a.diagnostic?.message);
    assert.deepEqual(rt.violations, []);
    return { hash: rt.stateHash(), out: a.outputs as { length: number; time: number }, end: xz(rt, 'e1') };
  };
  const r1 = run(), r2 = run();
  assert.equal(r1.hash, r2.hash);
  assert.ok(dist(r1.end, [-8, -8]) < 0.1);
  // two laps of a filleted 8 m square (32 m a lap, less the corner cuts)
  assert.ok(r1.out.length > 2 * 28 && r1.out.length < 2 * 33, `loop length ${r1.out.length}`);
});

test('bicycle in the 1.0 m passage is refused, naming the passage walls (radius 0.4 + 0.15 m margin)', () => {
  const rt = setup([human('p1', 15.8, -12), vehicle('b1', 'bicycle', 15, -12, -Math.PI / 2)]);
  mounted(rt, 'p1', 'b1');
  const a = rt.submit('ride_to', { actor: 'p1', x: 15, z: -15 });
  assert.equal(a.status, 'failed');
  assert.equal(a.diagnostic?.code, 'vehicle.too-narrow');
  assert.ok(a.diagnostic!.subjects!.includes('passage-w') && a.diagnostic!.subjects!.includes('passage-e'), a.diagnostic!.message);
  assert.match(a.diagnostic!.message, /passage-w/);
  assert.match(a.diagnostic!.message, /passage-e/);
  // a person on foot fits
  assert.ok(sp(rt).route(rt.world, HUMAN_PROFILE, { level: 0, p: [15, -12] }, { level: 0, p: [15, -15] }).ok);
});

test('kerbs: a 12 cm kerb a walker steps over blocks the EUC (step 5 cm), which rides round it', () => {
  const kerb: Obstacle = { id: 'kerb', obb: { c: [0, -22], half: [0.1, 3], yaw: 0 }, y0: 0, y1: 0.12, kind: 'solid', label: 'kerb' };
  const rt = setup([human('p1', -3.7, -22), vehicle('e1', 'euc', -3, -22, 0)], [kerb]);
  const walk = sp(rt).route(rt.world, HUMAN_PROFILE, { level: 0, p: [-2, -21] }, { level: 0, p: [2, -21] });
  assert.ok(walk.ok && walk.route.length < 4.01, 'walkers step over it');
  mounted(rt, 'p1', 'e1');
  let nearest = Infinity;
  rt.observers.push({ onTick: () => { const p = xz(rt, 'e1'); if (Math.abs(p[1] + 22) < 3.05) nearest = Math.min(nearest, Math.abs(p[0]) - 0.1); } });
  const a = rt.submit('ride_to', { actor: 'p1', x: 3, z: -22 });
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  assert.ok(rt.runUntilIdle(20 * 60, [a.id]));
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assert.ok(nearest >= EUC_PROFILE.radius, `came ${nearest.toFixed(2)} m from the kerb`);
  assert.ok((a.outputs as { length: number }).length > 8, 'went round the kerb');
  assert.deepEqual(rt.violations, []);
});

test('vehicle invariants fire on deliberately invalid states (close pass, rider off the pose, teleport, speed)', () => {
  const rt = setup([human('p1', -0.7, 20), vehicle('e1', 'euc', 0, 20, 0), human('p2', 3, 20.9)]);
  mounted(rt, 'p1', 'e1');
  const e1 = rt.world.entities.e1, p1 = rt.world.entities.p1;
  const codes = () => rt.violations.map((v) => v.code);
  // 2 m/s past p2 with a 0.9 − 0.63 = 0.27 m body gap
  for (let k = 0; k < 30; k++) {
    e1.pose.p = [e1.pose.p[0] + 0.1, 0, 20];
    p1.pose.p = [e1.pose.p[0], EUC_PROFILE.riderY, 20];
    rt.step();
  }
  assert.ok(codes().includes('vehicle.close-pass'), codes().join());
  assert.ok(!codes().includes('vehicle.rider-off'));
  rt.violations.length = 0;
  p1.pose.p = [p1.pose.p[0] + 0.3, p1.pose.p[1], p1.pose.p[2]];
  rt.step();
  assert.ok(codes().includes('vehicle.rider-off'), codes().join());
  rt.violations.length = 0;
  e1.pose.p = [e1.pose.p[0] + 1.0, 0, 20];
  p1.pose.p = [e1.pose.p[0], EUC_PROFILE.riderY, 20];
  rt.step();
  assert.ok(codes().includes('motion.teleport') && codes().includes('vehicle.max-speed'), codes().join());
});
