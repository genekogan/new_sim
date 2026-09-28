// Frame stances + hang_beam (construction/stance.ts): a bay of two 16 ft reconstruction frames raised on
// open ground, held from behind, beams hung at the Kit's three levels — 0.22 m from the ground, 2.48 m
// handed up to installers on the bracing, 4.757 m through a relay — 0 violations, exact seats.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { CARRY_INVARIANTS } from '../carry/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { walkTo } from '../locomotion/walk.ts';
import { carry } from '../carry/actions.ts';
import { CONSTRUCTION_ACTIONS, liftHandsInReach, uprightsSupported } from '../construction/index.ts';
import { hangHandsInReach, rungs, stanceAccessOk, STANCE_ACTIONS } from '../construction/stance.ts';
import { lyingPose } from '../construction/bundle.ts';
import { seatPoint } from '../construction/rules.ts';
import { addAll, emptyWorld, human } from '../world/factory.ts';
import { def } from '../world/catalog.ts';
import { rot2 } from '../core/math.ts';
import type { ActionDef } from '../actions/types.ts';
import type { Entity } from '../world/types.ts';
import type { SpatialScene } from '../spatial/types.ts';

const U = 'upright-16ft-kit';
const H = def(U).size[1], D = def(U).size[0], L = def('beam-12ft').size[0];
const ground = (): SpatialScene => ({ bounds: [-15, -15, 15, 15], levels: [{ id: 0, y: 0, label: 'ground' }], surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [15, 15], yaw: 0 } }], obstacles: [], links: [] });
const registry = () => new Map<string, ActionDef>([['walk_to', walkTo], ['carry', carry], ...[...CONSTRUCTION_ACTIONS, ...STANCE_ACTIONS].map((a) => [a.verb, a] as [string, ActionDef])]);
const INV = [...DEFAULT_INVARIANTS, ...CARRY_INVARIANTS, uprightsSupported, liftHandsInReach, stanceAccessOk, hangHandsInReach];
const comp = (id: string, defId: string, pose: Entity['pose']): Entity => ({ id, def: defId, kind: 'component', pose, provenance: { origin: 'test-fixture', confidence: 'hypothetical' }, phase: 'stored', support: { kind: 'ground' } });

function world() {
  // A stands at z 0 (lying toward −z first), B at z L (lying toward +z); beams staged later by state
  const w = addAll(emptyWorld('open-ground', ground()),
    comp('A', U, lyingPose(U, 0, -H / 2, -Math.PI / 2, 0)), comp('B', U, lyingPose(U, 0, L + H / 2, Math.PI / 2, 0)),
    ...['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((id, i) => human(id, 4 + i * 1.2, 1.5)));
  return new Runtime(w, registry(), { spatial: new Spatial(ground()) }, INV);
}
function run(rt: Runtime, verb: string, params: unknown) {
  const r = rt.submit(verb, params);
  assert.notEqual(r.status, 'failed', `${verb} ${JSON.stringify(params)}: ${JSON.stringify(r.diagnostic)}`);
  rt.runUntilIdle(20 * 600, [r.id]);
  assert.equal(r.status, 'completed', `${verb} ${JSON.stringify(params)}: ${JSON.stringify(r.diagnostic)}`);
  assert.deepEqual(rt.violations, [], `${verb}: ${JSON.stringify(rt.violations.slice(0, 2))}`);
  return r;
}
/** Stage beam `id` lying 0.40 m outside the seat line of column `col` of A (by state). */
function stage(rt: Runtime, id: string, col: 'l' | 'r') {
  const A = rt.world.entities.A;
  const cs = col === 'l' ? -1 : 1;
  const s = seatPoint(A, cs, 0), out = rot2([cs, 0], A.pose.yaw);
  rt.world.entities[id] = comp(id, 'beam-12ft', { p: [s[0] + out[0] * 0.4, 0, L / 2], yaw: Math.PI / 2 });
}
const faceToward = (rt: Runtime, u: string, other: string) => {
  const e = rt.world.entities[u], o = rt.world.entities[other];
  const n = rot2([0, 1], e.pose.yaw);
  return (o.pose.p[0] - e.pose.p[0]) * n[0] + (o.pose.p[2] - e.pose.p[2]) * n[1] > 0 ? 'f' : 'b';
};

test('hang_beam: a 16 ft reconstruction bay — 0.22 m from the ground, 2.48 m from the bracing, 4.757 m through a relay; exact seats, 0 violations', () => {
  const rt = world();
  assert.deepEqual(rungs(U), [0.25, 0.91, 0.95, 1.61, 1.65, 2.31, 2.35, 3.01, 3.05]);
  run(rt, 'raise_upright', { crew: ['p1', 'p2'], item: 'A', stand_at: { x: 0, z: 0 } });
  run(rt, 'hold_frame', { actor: 'p3', item: 'A', at: { x: 0, z: -0.6 } });
  run(rt, 'let_go', { actor: 'p1', item: 'A' });
  run(rt, 'let_go', { actor: 'p2', item: 'A' });
  assert.equal(rt.submit('let_go', { actor: 'p3', item: 'A' }).diagnostic?.code, 'hold.last-holder');
  run(rt, 'raise_upright', { crew: ['p1', 'p2'], item: 'B', stand_at: { x: 0, z: L } });
  run(rt, 'hold_frame', { actor: 'p6', item: 'B', at: { x: 0, z: L + 0.6 } });
  run(rt, 'let_go', { actor: 'p1', item: 'B' });
  run(rt, 'let_go', { actor: 'p2', item: 'B' });
  // B's column opposite A's l (frames face each other: B's columns are mirrored)
  const colB = (c: 'l' | 'r') => (Math.abs(rt.world.entities.A.pose.yaw - rt.world.entities.B.pose.yaw) > Math.PI / 2 ? (c === 'l' ? 'r' : 'l') : c);
  // low beams from the ground
  for (const [id, col] of [['bl0', 'l'], ['br0', 'r']] as const) {
    stage(rt, id, col);
    run(rt, 'hang_beam', { beam: id, a: 'A', b: 'B', column: col, height: 0.22, installers: ['p1', 'p2'] });
  }
  // mid beams: installers on the bracing (held frames: ≤ 1 m), givers under the load in the aisle
  const fA = faceToward(rt, 'A', 'B'), fB = faceToward(rt, 'B', 'A');
  assert.equal(rt.submit('climb_stance', { actor: 'p4', upright: 'A', column: 'l', face: fA, feet: 1.61 }).diagnostic?.code, 'stance.held-too-high');
  for (const [id, col] of [['bl1', 'l'], ['br1', 'r']] as const) {
    run(rt, 'climb_stance', { actor: 'p4', upright: 'A', column: col, face: fA, feet: 0.91 });
    run(rt, 'climb_stance', { actor: 'p5', upright: 'B', column: colB(col), face: fB, feet: 0.91 });
    stage(rt, id, col);
    run(rt, 'hang_beam', { beam: id, a: 'A', b: 'B', column: col, height: 2.48, installers: ['p4', 'p5'], givers: ['p1', 'p2'] });
    run(rt, 'leave_stance', { actor: 'p4', to: { x: 5, z: 1.8 } });
    run(rt, 'leave_stance', { actor: 'p5', to: { x: 6, z: 1.8 } });
  }
  run(rt, 'release_support', { item: 'A' });
  run(rt, 'release_support', { item: 'B' });
  // top beams: installers at 3.01 m on the stable frames, relay at 0.91 m below them, givers on the ground
  for (const [id, col] of [['bl2', 'l'], ['br2', 'r']] as const) {
    run(rt, 'climb_stance', { actor: 'p4', upright: 'A', column: col, face: fA, feet: 3.01 });
    run(rt, 'climb_stance', { actor: 'p5', upright: 'B', column: colB(col), face: fB, feet: 3.01 });
    stage(rt, id, col);
    // without a relay the gap is refused and named
    const gap = rt.submit('hang_beam', { beam: id, a: 'A', b: 'B', column: col, height: 4.7568, installers: ['p4', 'p5'], givers: ['p1', 'p2'] });
    assert.equal(gap.diagnostic?.code, 'hang.gap');
    assert.match(gap.diagnostic!.message, /reach down only to 2\.51 m: add a relay/);
    run(rt, 'climb_stance', { actor: 'p3', upright: 'A', column: col, face: fA, feet: 0.91 });
    run(rt, 'climb_stance', { actor: 'p6', upright: 'B', column: colB(col), face: fB, feet: 0.91 });
    run(rt, 'hang_beam', { beam: id, a: 'A', b: 'B', column: col, height: 4.7568, installers: ['p4', 'p5'], givers: ['p1', 'p2'], relay: ['p3', 'p6'] });
    for (const [a, x] of [['p3', 3], ['p6', 4], ['p4', 5], ['p5', 6]] as const) run(rt, 'leave_stance', { actor: a, to: { x, z: 1.8 } });
  }
  const E = rt.world.entities;
  for (const [id, y] of [['bl0', 0.22], ['br0', 0.22], ['bl1', 2.48], ['br1', 2.48], ['bl2', 4.7568], ['br2', 4.7568]] as const) {
    assert.equal(E[id].phase, 'installed', id);
    assert.ok(Math.abs(E[id].pose.p[1] + def('beam-12ft').size[1] / 2 - y) < 1e-9, `${id} centre at ${y}`);
  }
  assert.equal(E.A.phase, 'installed');
  assert.equal(E.B.phase, 'installed');
  for (const p of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']) assert.equal(E[p].human!.on, undefined);
  assert.deepEqual(rt.violations, []);
});
