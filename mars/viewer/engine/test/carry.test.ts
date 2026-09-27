// Coordinated-carry regressions (spec §11, §28 "Long load around corner",
// "Reservation conflict", "Graceful cancellation"). Geometry is re-checked
// here independently of the planner: exact OBB tests of the carried load
// against every wall, every tick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { entityFootprint, Spatial } from '../spatial/service.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import { emptyWorld, human, addAll, component } from '../world/factory.ts';
import { walkTo } from '../locomotion/walk.ts';
import { carry } from '../carry/actions.ts';
import { CARRY_INVARIANTS } from '../carry/invariants.ts';
import { carryCorridors } from '../carry/scenes.ts';
import { formationFor, laidPose, REACH } from '../carry/formation.ts';
import { obbOverlap, rot2, sub2, type OBB2, type Vec2 } from '../core/math.ts';
import type { ActionDef } from '../actions/types.ts';
import type { Entity } from '../world/types.ts';
import type { SpatialScene } from '../spatial/types.ts';

const REG = new Map<string, ActionDef>([['walk_to', walkTo], ['carry', carry]]);
function setup(base: SpatialScene, ...es: Entity[]) {
  const w = addAll(emptyWorld('carry-test', base), ...es);
  return new Runtime(w, REG, { spatial: new Spatial(base) }, [...DEFAULT_INVARIANTS, ...CARRY_INVARIANTS]);
}
const upright19 = (id: string, x: number, z: number, th = 0) => {
  const pose = laidPose(formationFor('upright-19ft', 4), { x, z, th }, 0);
  return component(id, 'upright-19ft', pose.p, pose.yaw, { pose });
};
/** Distance from a point to an OBB (0 inside). */
function distObb(p: Vec2, o: OBB2) {
  const l = rot2(sub2(p, o.c), -o.yaw);
  const dx = Math.max(0, Math.abs(l[0]) - o.half[0]), dz = Math.max(0, Math.abs(l[1]) - o.half[1]);
  return Math.hypot(dx, dz);
}

/** Independent per-tick audit: load vs walls (exact SAT), carriers vs walls, carriers at reach from the load edge. */
function audit(rt: Runtime, item: string, crew: string[]) {
  const walls = rt.services.spatial.base.obstacles.filter((o: any) => o.kind === 'wall');
  const s = { samples: 0, overlaps: [] as string[], carrierWall: 0, reachErr: 0, maxX: -Infinity, headings: [] as number[] };
  rt.observers.push({
    onTick() {
      const e = rt.world.entities[item];
      if (e.phase !== 'carried') return;
      s.samples++;
      const fp = entityFootprint(e).obb;
      for (const w of walls) if (obbOverlap(fp, w.obb)) s.overlaps.push(`${w.id}@${rt.tick}`);
      for (const c of crew) {
        const h = rt.world.entities[c];
        const p: Vec2 = [h.pose.p[0], h.pose.p[2]];
        for (const w of walls) s.carrierWall = Math.max(s.carrierWall, 0.28 - distObb(p, w.obb));
        if (h.human!.activity === 'carry') s.reachErr = Math.max(s.reachErr, Math.abs(distObb(p, fp) - REACH));
      }
    },
  });
  return s;
}

function cornerRun() {
  const rt = setup(carryCorridors(), component('b1', 'beam-12ft', [4, 0, 4], 0), human('p1', 2, 6.5), human('p2', 6, 1.5));
  const t0 = performance.now();
  const a = rt.submit('carry', { crew: ['p1', 'p2'], item: 'b1', to: { x: 18, z: 11, yaw: Math.PI / 2 } });
  const planMs = performance.now() - t0;
  return { rt, a, planMs };
}

test('carry: 2 people carry a 12 ft beam around the L corner of the 2.5 m corridor', () => {
  const { rt, a, planMs } = cornerRun();
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  console.log(`  12 ft beam / 2.5 m L corridor: plan+validate ${planMs.toFixed(0)} ms`);
  assert.ok(planMs < 2000, `planning took ${planMs} ms`);
  const s = audit(rt, 'b1', ['p1', 'p2']);
  assert.ok(rt.runUntilIdle(20 * 180));
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assert.deepEqual(rt.violations.map((v) => v.message), []);
  assert.ok(s.samples > 100, `audited ${s.samples} carried ticks`);
  assert.deepEqual(s.overlaps, [], 'load never overlaps a wall');
  assert.ok(s.carrierWall <= 0.03, `carrier body penetration ${s.carrierWall}`);
  assert.ok(s.reachErr <= 0.05, `carriers drifted from their grips by ${s.reachErr}`);
  const b = rt.world.entities.b1;
  assert.equal(b.phase, 'staged');
  assert.deepEqual(b.support, { kind: 'ground' });
  const fp = entityFootprint(b).obb;
  assert.ok(Math.hypot(fp.c[0] - 18, fp.c[1] - 11) < 0.02, `set down at ${fp.c}`);
  assert.ok(Math.abs(Math.sin(fp.yaw - Math.PI / 2)) < 0.02 || Math.abs(Math.cos(fp.yaw)) < 0.02);
  for (const c of ['p1', 'p2']) {
    assert.equal(rt.world.entities[c].human!.activity, 'idle');
    assert.equal(rt.world.entities[c].human!.grip, undefined);
  }
  const phases = new Set(a.history.map((h) => h.phase));
  for (const ph of ['gather', 'lift', 'move', 'set-down', 'release']) assert.ok(phases.has(ph), `phase ${ph}`);
  assert.ok((a.outputs!.rotation as number) > 1.4, 'the formation actually turned the corner');
});

test('carry: 19 ft upright with 4 people cannot use the 1.5 m corridor, though the 4 people can walk it', () => {
  const crew = ['q1', 'q2', 'q3', 'q4'];
  const rt = setup(carryCorridors(), upright19('u1', 4, 22), human('q1', 1.5, 19.5), human('q2', 6.5, 19.5), human('q3', 1.5, 24.5), human('q4', 6.5, 24.5));
  const before = rt.stateHash();
  const a = rt.submit('carry', { crew, item: 'u1', to: { x: 18, z: 36, yaw: Math.PI / 2 } });
  assert.equal(a.status, 'failed');
  assert.ok(['carry.clearance', 'carry.no-route'].includes(a.diagnostic!.code), a.diagnostic!.code);
  assert.equal(a.diagnostic!.code, 'carry.clearance', 'humans fit individually → clearance');
  assert.match(a.diagnostic!.message, /19 ft upright/);
  assert.match(a.diagnostic!.message, /corridor B|yard B/);
  assert.equal(rt.stateHash(), before, 'rejected before anything moved');
  console.log(`  rejected: ${a.diagnostic!.message}`);
  // each person individually walks the same corridor to the target yard (one after another)
  const goals: [number, number][] = [[16, 34], [20, 34], [16, 38], [20, 38]];
  crew.forEach((c, i) => {
    const w = rt.submit('walk_to', { actor: c, x: goals[i][0], z: goals[i][1] });
    assert.equal(w.status, 'executing', w.diagnostic?.message);
    assert.ok(rt.runUntilIdle(20 * 120));
    assert.equal(w.status, 'completed', w.diagnostic?.message);
  });
  assert.deepEqual(rt.violations.map((v) => v.message), []);
});

test('carry: 19 ft upright goes straight down the 2.5 m corridor but cannot turn its corner', () => {
  const crew = ['q1', 'q2', 'q3', 'q4'];
  const rt = setup(carryCorridors(), upright19('u1', 4, 4), human('q1', 1, 1), human('q2', 7, 1), human('q3', 1, 7), human('q4', 7, 7));
  const straight = rt.submit('carry', { crew, item: 'u1', to: { x: 13, z: 4, yaw: 0 } });
  assert.equal(straight.status, 'executing', straight.diagnostic?.message);
  rt.cancel(straight.id);
  const rt2 = setup(carryCorridors(), upright19('u1', 4, 4), human('q1', 1, 1), human('q2', 7, 1), human('q3', 1, 7), human('q4', 7, 7));
  const turn = rt2.submit('carry', { crew, item: 'u1', to: { x: 18, z: 11, yaw: Math.PI / 2 } });
  assert.equal(turn.status, 'failed');
  assert.equal(turn.diagnostic!.code, 'carry.clearance');
  assert.match(turn.diagnostic!.message, /corridor A/);
  console.log(`  rejected: ${turn.diagnostic!.message}`);
});

test('carry: crew too small / too large for the load is rejected with the reason', () => {
  const rt = setup(provingGround(), upright19('u3', 0, 0), component('b1', 'beam-12ft', [0, 0, 5], 0), human('p1', -1, -1.5), human('p2', 1, -1.5), human('p3', 0, 3));
  const a = rt.submit('carry', { crew: ['p1', 'p2'], item: 'u3', to: { x: 5, z: -3, yaw: 0 } });
  assert.equal(a.status, 'failed');
  assert.equal(a.diagnostic!.code, 'carry.crew-too-small');
  assert.match(a.diagnostic!.message, /19 ft upright \(61 kg, 5\.8 m\) needs at least 3 carriers.*2 assigned/);
  const b = rt.submit('carry', { crew: ['p1', 'p2', 'p3'], item: 'b1', to: { x: 5, z: 5, yaw: 0 } });
  assert.equal(b.diagnostic?.code, 'carry.crew-too-large');
  const c = rt.submit('carry', { crew: ['p1'], item: 'b1', to: { x: 5, z: 5, yaw: 0 } });
  assert.equal(c.diagnostic?.code, 'carry.crew-too-small');
  const d = rt.submit('carry', { crew: ['p1', 'p1'], item: 'b1', to: { x: 5, z: 5, yaw: 0 } });
  assert.equal(d.diagnostic?.code, 'action.invalid-params');
});

test('carry: a second carry using a busy person fails with reservation.conflict', () => {
  const rt = setup(provingGround(), component('b1', 'beam-12ft', [0, 0, 0], 0), component('b2', 'beam-12ft', [0, 0, 6], 0), human('p1', -1.5, -1), human('p2', 1.5, 1), human('p3', 0, 8));
  const a = rt.submit('carry', { crew: ['p1', 'p2'], item: 'b1', to: { x: 6, z: -4, yaw: 0 } });
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  const b = rt.submit('carry', { crew: ['p2', 'p3'], item: 'b2', to: { x: 6, z: 3, yaw: 0 } });
  assert.equal(b.status, 'failed');
  assert.equal(b.diagnostic!.code, 'reservation.conflict');
  assert.match(b.diagnostic!.message, /actor:p2/);
  const c = rt.submit('walk_to', { actor: 'p1', x: 3, z: 3 });
  assert.equal(c.diagnostic?.code, 'reservation.conflict');
  assert.ok(rt.runUntilIdle(20 * 120));
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assert.deepEqual(rt.violations.map((v) => v.message), []);
});
