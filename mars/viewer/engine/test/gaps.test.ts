// Evidence gaps (EVIDENCE.md "approximate" notes turned into runtime tests):
//   * two walkers pass side by side in a 2.0 m corridor (the 1.0 m gap still yields);
//   * a walker that starts inside the U-trap walks out and around without
//     oscillating or grazing the U walls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { provingGround, PASS_W } from '../scenes/proving-ground.ts';
import { emptyWorld, human, addAll } from '../world/factory.ts';
import { walkTo } from '../locomotion/walk.ts';
import { clearanceAt } from '../spatial/grid.ts';
import { HUMAN_RADIUS } from '../world/catalog.ts';
import type { ActionDef, ActionRecord } from '../actions/types.ts';
import { hypot } from '../core/math.ts';

/** The proving ground with its opt-in 2.0 m passing corridor. */
function setup(...people: ReturnType<typeof human>[]) {
  const base = provingGround({ corridor: true });
  const w = addAll(emptyWorld('proving-ground', base), ...people);
  return new Runtime(w, new Map<string, ActionDef>([['walk_to', walkTo]]), { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
}
const yields = (r: ActionRecord) => r.history.filter((h) => h.code === 'traffic.yield').length;
/** Seconds from submission to completion. */
const took = (r: ActionRecord) => (r.history.find((h) => h.status === 'completed')!.tick - r.requestedTick) / 20;

// ---- passing: 2.0 m corridor at x = 22, z ∈ [17, 25] ----
const S: [number, number] = [22, 14.5], N: [number, number] = [22, 27.5];

test('2.0 m corridor: two walkers head-on pass side by side without yielding, < 1.4× the solo time', () => {
  assert.equal(PASS_W, 2.0);
  const solo = setup(human('s', S[0], S[1], { yaw: Math.PI / 2 }));
  const r0 = solo.submit('walk_to', { actor: 's', x: N[0], z: N[1] });
  assert.ok(solo.runUntilIdle(20 * 60));
  assert.equal(r0.status, 'completed', r0.diagnostic?.message);
  const soloT = took(r0);

  const rt = setup(human('a', S[0], S[1], { yaw: Math.PI / 2 }), human('b', N[0], N[1], { yaw: -Math.PI / 2 }));
  // they meet inside the corridor: track the closest approach and where it happened
  const meet = { d: Infinity, z: 0 };
  rt.observers.push({
    onTick: (r) => {
      const pa = r.world.entities.a.pose.p, pb = r.world.entities.b.pose.p;
      const d = hypot(pa[0] - pb[0], pa[2] - pb[2]);
      if (d < meet.d) Object.assign(meet, { d, z: (pa[2] + pb[2]) / 2 });
    },
  });
  const a = rt.submit('walk_to', { actor: 'a', x: N[0], z: N[1] });
  const b = rt.submit('walk_to', { actor: 'b', x: S[0], z: S[1] });
  assert.ok(rt.runUntilIdle(20 * 90), `still running: ${a.status}/${b.status}`);
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assert.equal(b.status, 'completed', b.diagnostic?.message);
  assert.deepEqual([yields(a), yields(b)], [0, 0], 'nobody yielded (traffic.yield)');
  assert.ok(meet.z > 17 && meet.z < 25, `they passed inside the corridor (z ${meet.z.toFixed(2)})`);
  assert.ok(meet.d >= 2 * HUMAN_RADIUS, `closest approach ${meet.d.toFixed(3)} m`);
  for (const r of [a, b]) assert.ok(took(r) < 1.4 * soloT, `${took(r)} s vs solo ${soloT} s`);
  assert.deepEqual(rt.violations.map((v) => `${v.code}: ${v.message}`), []);
});

test('1.0 m gap (same scene): opposing walkers still take turns (someone yields)', () => {
  const rt = setup(human('n1', 15, -20, { yaw: Math.PI / 2 }), human('s1', 15, -10, { yaw: -Math.PI / 2 }));
  const a = rt.submit('walk_to', { actor: 'n1', x: 15, z: -10.5 });
  const b = rt.submit('walk_to', { actor: 's1', x: 15, z: -19.5 });
  assert.ok(rt.runUntilIdle(20 * 90));
  assert.equal(a.status, 'completed');
  assert.equal(b.status, 'completed');
  assert.ok(yields(a) + yields(b) >= 1, 'someone yielded with traffic.yield');
  assert.deepEqual(rt.violations.map((v) => `${v.code}: ${v.message}`), []);
});

// Head-on with room to pass (walk.ts `roomToPass`, latched per encounter): neither walker stops to give
// way — both slow to the passing speed on the right-hand PASS_OFFSET and keep walking. Before this, the
// later id stood still for ~1.9 s (`traffic.person`) and blipped blocked/executing as 'a' cleared.
test('2.0 m corridor: both walkers keep moving while passing (no traffic.person stop), >= 0.5 m/s through the pass', () => {
  const rt = setup(human('a', S[0], S[1], { yaw: Math.PI / 2 }), human('b', N[0], N[1], { yaw: -Math.PI / 2 }));
  const s = { d: Infinity, minV: Infinity, prev: null as null | number[][] };
  rt.observers.push({
    onTick: (r) => {
      const pa = r.world.entities.a.pose.p, pb = r.world.entities.b.pose.p;
      const d = hypot(pa[0] - pb[0], pa[2] - pb[2]);
      s.d = Math.min(s.d, d);
      // speed of both walkers while they are within 2 m of each other (the pass itself)
      if (s.prev && d < 2) for (const [i, p] of [pa, pb].entries()) s.minV = Math.min(s.minV, hypot(p[0] - s.prev[i][0], p[2] - s.prev[i][2]) * 20);
      s.prev = [[...pa], [...pb]];
    },
  });
  const a = rt.submit('walk_to', { actor: 'a', x: N[0], z: N[1] });
  const b = rt.submit('walk_to', { actor: 'b', x: S[0], z: S[1] });
  assert.ok(rt.runUntilIdle(20 * 90));
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assert.equal(b.status, 'completed', b.diagnostic?.message);
  assert.deepEqual([a, b].map((r) => r.history.filter((h) => h.status === 'blocked').map((h) => h.code)), [[], []]);
  assert.ok(s.d >= 2 * HUMAN_RADIUS, `closest approach ${s.d.toFixed(3)} m`);
  assert.ok(s.minV >= 0.5 - 1e-6, `slowest walker speed during the pass ${s.minV.toFixed(3)} m/s`);
  assert.deepEqual(rt.violations.map((v) => `${v.code}: ${v.message}`), []);
});

// ---- U-trap: cup around (-15, 12), back wall inner face z = 14.85, opening toward −z ----

test('U-trap: a walker starting at the inner back wall walks out and around to a goal behind the U; no oscillation, never within 0.28 m of the walls', () => {
  const rt = setup(human('p1', -15, 14.4, { yaw: Math.PI / 2 }));
  const sp = rt.services.spatial as Spatial;
  sp.sync(rt.world);
  const s = { flips: 0, last: rt.world.entities.p1.pose.yaw, prevTurn: 0, minClear: Infinity, at: [0, 0], minZ: Infinity };
  rt.observers.push({
    onTick: (r) => {
      const e = r.world.entities.p1;
      const d = e.pose.yaw - s.last;
      const turn = Math.sign(Math.abs(d) > 1e-3 ? d : 0);
      if (turn && s.prevTurn && turn !== s.prevTurn) s.flips++;
      if (turn) s.prevTurn = turn;
      s.last = e.pose.yaw;
      sp.sync(r.world);
      const p: [number, number] = [e.pose.p[0], e.pose.p[2]];
      const c = clearanceAt(sp.level(0)!, p);
      if (c < s.minClear) Object.assign(s, { minClear: c, at: p });
      s.minZ = Math.min(s.minZ, p[1]);
    },
  });
  assert.ok(clearanceAt(sp.level(0)!, [-15, 14.4]) >= HUMAN_RADIUS, 'start is standable');
  const a = rt.submit('walk_to', { actor: 'p1', x: -15, z: 18 });
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  assert.ok(rt.runUntilIdle(20 * 90));
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  const p = rt.world.entities.p1.pose.p;
  assert.ok(hypot(p[0] + 15, p[2] - 18) < 0.05, `arrived at (${p[0].toFixed(2)}, ${p[2].toFixed(2)})`);
  assert.ok(s.minZ < 9, `left the cup through its opening (min z ${s.minZ.toFixed(2)})`);
  assert.ok(s.flips <= 6, `turn direction flips ${s.flips}`);
  assert.ok(s.minClear >= HUMAN_RADIUS, `min clearance ${s.minClear.toFixed(3)} m at (${s.at.map((v) => v.toFixed(2)).join(', ')})`);
  assert.deepEqual(rt.violations.map((v) => `${v.code}: ${v.message}`), []);
});
