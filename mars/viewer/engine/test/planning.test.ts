// Planning budget (docs/engineering/PLANNING_BUDGET.md): the opt-in profiler,
// planner equality against the frozen reference A*, and the stress-30 bound.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import { emptyWorld, human, addAll } from '../world/factory.ts';
import { walkTo } from '../locomotion/walk.ts';
import type { ActionDef } from '../actions/types.ts';
import { buildGrids, gridsWithObstacles, clearanceAt, type GridSet } from '../spatial/grid.ts';
import { findRoute, type Place } from '../spatial/path.ts';
import { HUMAN_PROFILE, type AgentProfile, type SpatialScene } from '../spatial/types.ts';
import { seedRng, nextRandom } from '../core/rng.ts';
import { findRouteReference } from './path-reference.ts';

function setup(...people: ReturnType<typeof human>[]) {
  const base = provingGround();
  const w = addAll(emptyWorld('proving-ground', base), ...people);
  return new Runtime(w, new Map<string, ActionDef>([['walk_to', walkTo]]), { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
}

test('profiler: rt.profile = true records plan/step/spatial costs and never changes the run', () => {
  const run = (profile: boolean) => {
    const rt = setup(human('p1', -18, -15, { yaw: 0 }), human('p2', -15, 12));
    rt.profile = profile;
    rt.submit('walk_to', { actor: 'p1', x: -12, z: -15 });
    rt.submit('walk_to', { actor: 'p2', x: -15, z: 20 });
    assert.ok(rt.runUntilIdle(20 * 120));
    return rt;
  };
  const on = run(true), off = run(false);
  assert.equal(on.stateHash(), off.stateHash());
  assert.equal(off.prof, null);
  const st = on.prof!.stats;
  assert.equal(st.get('walk_to.plan')?.calls, 2);
  assert.equal(st.get('spatial.route')?.calls, 2);
  assert.ok(st.get('walk_to.step')!.calls > 100);
  assert.equal(st.get('invariants')?.calls, on.tick);
  assert.ok((st.get('spatial.sync')?.calls ?? 0) + (st.get('spatial.sync.rebuild')?.calls ?? 0) > 100);
  for (const r of on.prof!.report()) assert.ok(r.ms >= 0 && r.max <= r.ms + 1e-9, r.key);
  on.profile = false;
  assert.equal(on.prof, null);
  assert.equal((on.services.spatial as Spatial).prof, undefined);
});

/** The production planner must return exactly the frozen reference's result (legs, length, expanded, diagnostics). */
test('planner equality: production findRoute === frozen reference over test routes + 200 seeded proving-ground routes', () => {
  const scene = provingGround();
  const grids = buildGrids(scene, 0.1);
  const cases: [GridSet, SpatialScene, AgentProfile, Place, Place][] = [];
  const add = (g: GridSet, s: SpatialScene, a: Place, b: Place, prof = HUMAN_PROFILE) => cases.push([g, s, prof, a, b]);
  const P = (level: number, x: number, z: number): Place => ({ level, p: [x, z] });
  // navigation.test.ts / walk.test.ts / lab routes
  for (const [a, b] of [
    [P(0, -18, -15), P(0, -12, -15)], [P(0, -15, 12), P(0, -15, 20)], [P(0, 15, -20), P(0, 15, -10)], [P(0, 3.5, 12.5), P(1, 10, 10)],
    [P(1, 8, 8), P(0, 8, 5)], [P(0, 9, 9), P(1, 9, 9)], [P(0, 19.5, 10), P(1, 12, 10)], [P(0, -18, -15), P(0, -15, -15)],
    [P(0, -25, -25), P(1, 12, 12)], [P(0, -28, -28), P(1, 13, 12)], [P(0, 15, -22), P(0, 15, -8)], [P(1, 12, 11.5), P(0, 10, 8.5)],
    [P(0, 15, -20), P(0, 15, -10.5)], [P(0, 15, -10), P(0, 15, -19.5)], [P(0, 20, 11), P(1, 10, 10)],
  ] as [Place, Place][]) add(grids, scene, a, b);
  add(grids, scene, P(0, 15, -20), P(0, 15, -10), { ...HUMAN_PROFILE, radius: 0.6 });
  const noA = provingGround({ stairsAUsable: false });
  const gNoA = buildGrids(noA, 0.1);
  add(gNoA, noA, P(0, 0, 0), P(1, 10, 10));
  add(gNoA, noA, P(0, 20, 11), P(1, 10, 10));
  const panel = provingGround({ extra: [{ id: 'new-panel', obb: { c: [15, -15], half: [0.6, 0.1], yaw: 0 }, y0: 0, y1: 2.4, kind: 'component', label: 'panel' }] });
  add(buildGrids(panel, 0.1), panel, P(0, 15, -20), P(0, 15, -10));
  // people as temporary obstacles (Spatial.routeAround grids)
  const people = [{ id: 'q1', p: [15, -15] }, { id: 'q2', p: [-15, 8] }, { id: 'q3', p: [0, 0] }];
  const extra = people.map((q) => ({ id: q.id, obb: { c: q.p as [number, number], half: [0.3, 0.3] as [number, number], yaw: 0 }, y0: 0, y1: 1.8, kind: 'solid' as const, label: q.id }));
  const aroundScene = { ...scene, obstacles: [...scene.obstacles, ...extra] };
  const around = gridsWithObstacles(grids, extra);
  add(around, aroundScene, P(0, 15, -20), P(0, 15, -10));
  add(around, aroundScene, P(0, -15, 12), P(0, 1, 1));
  // 200 seeded random routes (20 % to/from the deck), standable and not
  const st = seedRng('planning-equality');
  const rand = () => nextRandom(st);
  const pick = (): Place => {
    const deck = rand() < 0.2;
    return deck ? P(1, 6.6 + rand() * 6.8, 7.4 + rand() * 5.2) : P(0, -29 + rand() * 58, -29 + rand() * 58);
  };
  let standable = 0;
  for (let k = 0; k < 200; k++) {
    const a = pick(), b = pick();
    if (clearanceAt(grids.levels.get(a.level)!, a.p) >= 0.4 && clearanceAt(grids.levels.get(b.level)!, b.p) >= 0.4) standable++;
    add(k % 10 === 9 ? around : grids, k % 10 === 9 ? aroundScene : scene, a, b);
  }
  let ok = 0;
  for (const [g, s, prof, a, b] of cases) {
    const got = findRoute(g, s, prof, a, b), want = findRouteReference(g, s, prof, a, b);
    assert.deepEqual(got, want, `route ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
    if (got.ok) ok++;
  }
  assert.ok(ok > 150 && standable > 150, `${ok} ok routes, ${standable} standable pairs`);
});
