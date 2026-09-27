// Evidence gaps (EVIDENCE.md "approximate" notes turned into runtime tests):
//   * two walkers pass side by side in a 2.0 m corridor (the 1.0 m gap still yields).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { provingGround, PASS_W } from '../scenes/proving-ground.ts';
import { emptyWorld, human, addAll } from '../world/factory.ts';
import { walkTo } from '../locomotion/walk.ts';
import { HUMAN_RADIUS } from '../world/catalog.ts';
import type { ActionDef, ActionRecord } from '../actions/types.ts';

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
      const d = Math.hypot(pa[0] - pb[0], pa[2] - pb[2]);
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

// Known limitation (walk.ts, owned by the locomotion track): on any head-on encounter where
// neither walker holds a traffic resource, the walker with the later id gives way by stopping
// (vmax = 0, `traffic.person`) and sidestepping, even with room for both to keep walking. In the
// 2.0 m corridor 'b' stands still for ~1.9 s (ticks 101–138) and its status blips
// blocked/executing for a few ticks as 'a' clears. This todo passes once give-way slows
// instead of stopping when the offset clearance allows passing.
test('2.0 m corridor: both walkers keep moving while passing (no traffic.person stop)', { todo: 'walk.ts giveWay stops the later-id walker on every head-on encounter' }, () => {
  const rt = setup(human('a', S[0], S[1], { yaw: Math.PI / 2 }), human('b', N[0], N[1], { yaw: -Math.PI / 2 }));
  const a = rt.submit('walk_to', { actor: 'a', x: N[0], z: N[1] });
  const b = rt.submit('walk_to', { actor: 'b', x: S[0], z: S[1] });
  assert.ok(rt.runUntilIdle(20 * 90));
  assert.deepEqual([a, b].map((r) => r.history.filter((h) => h.status === 'blocked').map((h) => h.code)), [[], []]);
});
