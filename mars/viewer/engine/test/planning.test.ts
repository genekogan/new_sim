// Planning budget (docs/engineering/PLANNING_BUDGET.md): the opt-in profiler,
// planner equality against the frozen reference A*, and the stress-30 bound.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import { emptyWorld, human, addAll, component } from '../world/factory.ts';
import { walkTo } from '../locomotion/walk.ts';
import type { ActionDef } from '../actions/types.ts';
import { buildGrids, gridsWithObstacles, clearanceAt, type GridSet } from '../spatial/grid.ts';
import { findRoute, type Place } from '../spatial/path.ts';
import { HUMAN_PROFILE, type AgentProfile, type SpatialScene } from '../spatial/types.ts';
import { seedRng, nextRandom } from '../core/rng.ts';
import { findRouteReference } from './path-reference.ts';
import { stress, buildRuntime } from '../../app/lab/scenarios.ts';
import { segmentClearance } from '../spatial/grid.ts';

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

/** 10 walkers heading north through the 1 m gap at (15, -15); at tick 10 a panel closes it (lab dropPanel). */
function gapCrowd(replansPerTick?: number) {
  const people = Array.from({ length: 10 }, (_, k) => human(`g${k}`, 9 + (k % 5) * 3, -27 + Math.floor(k / 5) * 2.5, { yaw: Math.PI / 2 }));
  const rt = setup(...people);
  if (replansPerTick !== undefined) rt.services.planning = { replansPerTick };
  const ids = people.map((p, k) => rt.submit('walk_to', { actor: p.id, x: 9 + (k % 5) * 3, z: -6 }).id);
  for (let t = 0; t < 20 * 150 && ids.some((i) => rt.isActive(i)); t++) {
    rt.step();
    if (rt.tick === 10) {
      rt.world.entities.panel = component('panel', 'plywood-4x8', [15, 1.22, -15], Math.PI / 2, { phase: 'installed', pose: { p: [15, 1.22, -15], yaw: Math.PI / 2, roll: Math.PI / 2 } });
    }
  }
  return { rt, ids };
}

test('replan budget: construction replans are staggered deterministically, walkers keep a clear prefix, all arrive', () => {
  const unlimited = gapCrowd(Infinity), budget = gapCrowd(2), again = gapCrowd(2);
  for (const { rt, ids } of [unlimited, budget]) {
    assert.deepEqual(rt.violations, []);
    for (const i of ids) assert.equal(rt.records.get(i)!.status, 'completed', `${i} ${rt.records.get(i)!.diagnostic?.message}`);
  }
  const bu = unlimited.rt.services.replanBudget, bb = budget.rt.services.replanBudget;
  assert.ok(bu.peak >= 5, `unlimited: ${bu.peak} replans in one tick`);
  assert.equal(bu.deferred, 0);
  assert.ok(bb.deferred > 0, 'some walkers waited their turn');
  assert.ok(bb.peak < bu.peak, `budgeted peak ${bb.peak} < unlimited ${bu.peak}`);
  assert.equal(bb.replans, bu.replans, 'the same walkers replan, just later');
  assert.ok(bb.deferred <= bb.replans * 10, 'nobody waits more than 10 ticks');
  assert.equal(budget.rt.stateHash(), again.rt.stateHash(), 'deterministic');
});

test('corridor planner (opt-in): failures identical to exact, successes clear and near-optimal', () => {
  const scene = provingGround();
  const grids = buildGrids(scene, 0.1);
  const st = seedRng('corridor-planner');
  const rand = () => nextRandom(st);
  const P = (level: number, x: number, z: number): Place => ({ level, p: [x, z] });
  const pick = (): Place => (rand() < 0.2 ? P(1, 6.6 + rand() * 6.8, 7.4 + rand() * 5.2) : P(0, -29 + rand() * 58, -29 + rand() * 58));
  let same = 0, ok = 0;
  for (let k = 0; k < 120; k++) {
    const a = pick(), b = pick();
    const e = findRoute(grids, scene, HUMAN_PROFILE, a, b), c = findRoute(grids, scene, HUMAN_PROFILE, a, b, { planner: 'corridor' });
    if (!e.ok) { assert.deepEqual(c, e); continue; }
    assert.ok(c.ok);
    ok++;
    if (JSON.stringify(c.route.legs) === JSON.stringify(e.route.legs)) same++;
    assert.ok(Math.abs(c.route.length - e.route.length) <= 0.05 * e.route.length + 0.2, `length ${c.route.length} vs ${e.route.length}`);
    // every segment clear, except where the exact route is not either (a raw, snapped start)
    const minClear = (legs: typeof e.route.legs) => Math.min(...legs.flatMap((l) => (l.kind === 'walk' ? l.points.slice(1).map((q, i) => segmentClearance(grids.levels.get(l.level)!, l.points[i], q)) : [])));
    assert.ok(minClear(c.route.legs) >= Math.min(HUMAN_PROFILE.radius, minClear(e.route.legs)) - 1e-6, `clearance ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  }
  assert.ok(ok > 100 && same / ok > 0.85, `${same}/${ok} identical`);
});

/** Lab stress-30 as the lab steps it (rt.step() + tick script), 60 s simulated. Bounds are loose for the
 *  parallel test runner; standalone numbers are in PLANNING_BUDGET.md (deploy/perf-stress.mjs). */
function stressRun(planner: 'exact' | 'corridor') {
  const s = stress(30);
  const rt = buildRuntime(s);
  (rt.services.spatial as Spatial).planner = planner;
  s.start(rt);
  const costs: number[] = [];
  for (let i = 0; i < 20 * 60; i++) {
    const t0 = performance.now();
    rt.step();
    s.tick!(rt);
    costs.push(performance.now() - t0);
  }
  return { rt, max: Math.max(...costs), mean: costs.reduce((x, y) => x + y, 0) / costs.length };
}

test('stress-30: exact planner keeps the pinned result; per-tick cost bounded; zero violations', () => {
  stressRun('corridor'); // JIT warm-up (a long-lived lab/DO process is warm)
  const exact = stressRun('exact');
  assert.equal(exact.rt.violations.length, 0);
  assert.equal(exact.rt.stateHash(), 'a6e42f5c6bfba73d76bc6080a4373236031f79bfee46533306d374333390e26c', 'stress-30 final state unchanged by the planning-budget work');
  const corr = stressRun('corridor');
  assert.equal(corr.rt.violations.length, 0);
  console.log(`stress-30 max tick: exact ${exact.max.toFixed(1)} ms (mean ${exact.mean.toFixed(2)}), corridor ${corr.max.toFixed(1)} ms (mean ${corr.mean.toFixed(2)})`);
  assert.ok(exact.max <= 150, `exact max tick ${exact.max.toFixed(1)} ms`);
  assert.ok(corr.max <= 60, `corridor max tick ${corr.max.toFixed(1)} ms`);
  assert.ok(exact.mean <= 3 && corr.mean <= 3);
});
