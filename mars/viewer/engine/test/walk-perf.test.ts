// Walker performance work (PLANNING_BUDGET.md §6) is pure performance: every switch in WALK_PERF and
// Spatial.proveUnreachable must leave routes, runs and pinned hashes bit-identical. Each test runs the
// same thing with the fast paths off and on and compares (the style of the profiled == unprofiled test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGrids, gridsWithObstacles, clearanceAt, type GridSet } from '../spatial/grid.ts';
import { findRoute, type Place, type RouteResult } from '../spatial/path.ts';
import { HUMAN_PROFILE, type Obstacle, type SpatialScene } from '../spatial/types.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import { seedRng, nextRandom } from '../core/rng.ts';
import { dcos, dsin } from '../core/math.ts';
import { findRouteReference } from './path-reference.ts';
import { WALK_PERF } from '../locomotion/walk.ts';
import type { Spatial } from '../spatial/service.ts';
import { stress, buildRuntime } from '../../app/lab/scenarios.ts';
import { mealRuntime, runMeal } from '../scenarios/meal.ts';

const P = (level: number, x: number, z: number): Place => ({ level, p: [x, z] });
const person = (id: string, x: number, z: number): Obstacle => ({ id, obb: { c: [x, z], half: [0.3, 0.3], yaw: 0 }, y0: 0, y1: 1.8, kind: 'solid', label: id });
/** k people on a circle of radius rad round (x, z): a pocket nobody can walk into or out of. */
const ring = (tag: string, x: number, z: number, rad: number, k: number) =>
  Array.from({ length: k }, (_, i) => person(`${tag}${i}`, x + rad * dcos((2 * Math.PI * i) / k), z + rad * dsin((2 * Math.PI * i) / k)));

test('proveUnreachable: routeAround-style searches === frozen reference A*, walled-in pockets and cut-off decks included', () => {
  const st = seedRng('walk-perf-prove');
  const rand = () => nextRandom(st);
  const cases: [GridSet, SpatialScene, Place, Place][] = [];
  const scene = provingGround();
  const grids = buildGrids(scene, 0.1);
  const around = (extra: Obstacle[]): [GridSet, SpatialScene] => [gridsWithObstacles(grids, extra), { ...scene, obstacles: [...scene.obstacles, ...extra] }];
  // the stress-30 failure: stairs-a's foot held by people, stairs-b unfinished → the deck is cut off
  const foot = [person('f1', 0.85, 10), person('f2', 0.85, 10.6)];
  {
    const [g, s] = around(foot);
    cases.push([g, s, P(0, 0.6, 12.33), P(1, 9.1, 7.93)], [g, s, P(0, -20, -20), P(1, 10, 10)], [g, s, P(1, 10, 10), P(0, -20, -20)]);
  }
  // 60 seeded cases: goal walled in, start walled in, both, neither; ground and deck; some goals on obstacles
  for (let k = 0; k < 60; k++) {
    const deckA = rand() < 0.15, deckB = rand() < 0.25;
    const a = deckA ? P(1, 6.6 + rand() * 6.8, 7.4 + rand() * 5.2) : P(0, -28 + rand() * 56, -28 + rand() * 56);
    const b = deckB ? P(1, 6.6 + rand() * 6.8, 7.4 + rand() * 5.2) : P(0, -28 + rand() * 56, -28 + rand() * 56);
    const extra: Obstacle[] = [];
    const mode = k % 4;
    if ((mode === 0 || mode === 2) && b.level === 0) extra.push(...ring(`g${k}-`, b.p[0], b.p[1], 0.7 + rand() * 0.6, 10));
    if ((mode === 1 || mode === 2) && a.level === 0) extra.push(...ring(`s${k}-`, a.p[0], a.p[1], 0.7 + rand() * 0.6, 10));
    if (rand() < 0.3) extra.push(...foot);
    for (let i = 0; i < 4; i++) extra.push(person(`x${k}-${i}`, -28 + rand() * 56, -28 + rand() * 56));
    const [g, s] = around(extra);
    cases.push([g, s, a, b]);
  }
  let failed = 0, ok = 0;
  const codes = new Set<string>();
  for (const [i, [g, s, a, b]] of cases.entries()) {
    const fast = findRoute(g, s, HUMAN_PROFILE, a, b, { proveUnreachable: true });
    const want = findRouteReference(g, s, HUMAN_PROFILE, a, b);
    assert.deepEqual(fast, want, `route ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
    // corridor planner: identical with and without the proof (its fallback is the exact search)
    if (i % 3 === 0) assert.deepEqual(findRoute(g, s, HUMAN_PROFILE, a, b, { planner: 'corridor', proveUnreachable: true }), findRoute(g, s, HUMAN_PROFILE, a, b, { planner: 'corridor' }));
    if (fast.ok) ok++;
    else { failed++; codes.add(fast.diagnostic.code); }
  }
  assert.ok(failed >= 20 && ok >= 15, `${failed} failing, ${ok} ok`);
  assert.ok(codes.has('route.unreachable') && codes.has('route.link-unusable'), [...codes].join(','));
  // the stress case fails with the same named reason
  const r = cases[0];
  const got = findRoute(r[0], r[1], HUMAN_PROFILE, r[2], r[3], { proveUnreachable: true }) as Extract<RouteResult, { ok: false }>;
  assert.equal(got.diagnostic.code, 'route.link-unusable');
  assert.deepEqual(got.diagnostic.subjects, ['stairs-b']);
  // maxExpand smaller than the grid: the proof stands aside, so a search-limit failure stays a search-limit failure
  const [g, s] = around(ring('lim', 20, -20, 0.8, 10));
  const lim = { maxExpand: 5000 };
  assert.deepEqual(findRoute(g, s, HUMAN_PROFILE, P(0, -20, 20), P(0, 20, -20), { ...lim, proveUnreachable: true }), findRoute(g, s, HUMAN_PROFILE, P(0, -20, 20), P(0, 20, -20), lim));
  assert.ok(clearanceAt(grids.levels.get(0)!, [20, -20]) > 0.4);
});

function stressHash(fast: boolean, planner: 'exact' | 'corridor', ticks: number) {
  WALK_PERF.entitySnapshot = fast;
  try {
    const s = stress(30);
    const rt = buildRuntime(s);
    const sp = rt.services.spatial as Spatial;
    sp.planner = planner;
    sp.proveUnreachable = fast;
    s.start(rt);
    for (let i = 0; i < ticks; i++) {
      rt.step();
      s.tick!(rt);
    }
    assert.equal(rt.violations.length, 0);
    return rt.stateHash();
  } finally {
    WALK_PERF.entitySnapshot = true;
  }
}

test('walker fast paths off === on: stress-30 (exact: the pin; corridor: its failing replan at tick 1126) and the meal', () => {
  const on = stressHash(true, 'exact', 1200);
  assert.equal(on, '093779fd18f0a1c1875c7cbe41347a967f4ea6da06b21b29113ab28b55fcac55');
  assert.equal(stressHash(false, 'exact', 1200), on);
  assert.equal(stressHash(true, 'corridor', 1200), stressHash(false, 'corridor', 1200));
  const meal = (fast: boolean) => {
    WALK_PERF.entitySnapshot = fast;
    try {
      const rt = mealRuntime();
      (rt.services.spatial as Spatial).proveUnreachable = fast;
      runMeal(rt);
      return rt.stateHash();
    } finally {
      WALK_PERF.entitySnapshot = true;
    }
  };
  assert.equal(meal(true), '9dae86bfd31ef8331c5930d345c7ceace5bd2f7a8a247ab02462c262f4a70f87');
  assert.equal(meal(false), meal(true));
});
