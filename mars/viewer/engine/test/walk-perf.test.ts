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
import { Spatial, narrowComponents } from '../spatial/service.ts';
import { stress, buildRuntime } from '../../app/lab/scenarios.ts';
import { WorldHistory } from '../history/store.ts';
import { emptyWorld, addAll } from '../world/factory.ts';
import { bindTemplate } from '../sequence/bind.ts';
import { rehearse } from '../rehearsal/rehearse.ts';
import { buildBayEntities, buildBayTemplate, buildBayBindings, buildBayRegistry, BUILD_BAY_INVARIANTS, BUILD_BAY_CONTRIBUTORS } from '../scenarios/build-bay.ts';
import { buildBayGround, BUILD_BAY_RULES, BUILD_BAY_SITE } from '../../app/lab/build-bay.ts';
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
    // explainUnusable: a predicate every link passes changes nothing; one no link passes leaves a
    // link-unusable failure 'route.unreachable' (same ok, no link subjects) and changes nothing else
    assert.deepEqual(findRoute(g, s, HUMAN_PROFILE, a, b, { proveUnreachable: true, explainUnusable: () => true }), want);
    const lazy = findRoute(g, s, HUMAN_PROFILE, a, b, { proveUnreachable: true, explainUnusable: () => false });
    if (!want.ok && want.diagnostic.code === 'route.link-unusable') assert.equal((lazy as Extract<RouteResult, { ok: false }>).diagnostic.code, 'route.unreachable');
    else assert.deepEqual(lazy, want);
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
  WALK_PERF.stepSnapshot = fast;
  WALK_PERF.lazyLinkDiagnostics = fast;
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
    WALK_PERF.stepSnapshot = true;
    WALK_PERF.lazyLinkDiagnostics = true;
  }
}

test('walker fast paths off === on: stress-30 (exact: the pin; corridor: its failing people-replan at tick 1126) and the meal', () => {
  const on = stressHash(true, 'exact', 1200);
  assert.equal(on, '5c3a3355257850f2316b92902451c144981486262211d86de4881047ca8a194e');
  assert.equal(stressHash(false, 'exact', 1200), on);
  assert.equal(stressHash(true, 'corridor', 1200), stressHash(false, 'corridor', 1200));
  const meal = (fast: boolean) => {
    WALK_PERF.stepSnapshot = fast;
    WALK_PERF.lazyLinkDiagnostics = fast;
    try {
      const rt = mealRuntime();
      (rt.services.spatial as Spatial).proveUnreachable = fast;
      runMeal(rt);
      return rt.stateHash();
    } finally {
      WALK_PERF.stepSnapshot = true;
      WALK_PERF.lazyLinkDiagnostics = true;
    }
  };
  assert.equal(meal(true), '3c28879fa21e485e910eef10f0266ced8562534d3c83623232b00a94e26090eb');
  assert.equal(meal(false), meal(true));
});

/** Spatial.narrow as it was before PLANNING_BUDGET.md §6, verbatim (frozen reference). */
function narrowReference(g: { nx: number; nz: number; clearance: Float32Array }, r: number, margin = 0.15): Int32Array {
  const n = g.nx * g.nz;
  const lab = new Int32Array(n).fill(-1);
  const isNarrow = (c: number) => g.clearance[c] >= r && g.clearance[c] < 2 * r + margin;
  let next = 0;
  const stack: number[] = [];
  for (let c = 0; c < n; c++) {
    if (lab[c] !== -1 || !isNarrow(c)) continue;
    lab[c] = next;
    stack.push(c);
    while (stack.length) {
      const k = stack.pop()!;
      const i = k % g.nx, j = (k - i) / g.nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= g.nx || nj >= g.nz) continue;
        const m = nj * g.nx + ni;
        if (lab[m] === -1 && isNarrow(m)) { lab[m] = next; stack.push(m); }
      }
    }
    next++;
  }
  return lab;
}

test('narrow(): single-file component labels === the frozen reference (scenes, radii, and every call of the build-bay probe)', () => {
  const scene = provingGround();
  const grids = buildGrids(scene, 0.1);
  let compared = 0;
  const same = (a: Int32Array, b: Int32Array, what: string) => {
    assert.equal(a.length, b.length, what);
    assert.ok(a.every((v, i) => v === b[i]), what);
    compared++;
  };
  for (const [lv, g] of grids.levels) for (const [r, m] of [[0.25, 0.15], [0.3, 0.15], [0.25, 0], [0.5, 0.3]]) same(narrowComponents(g.clearance, g.nx, g.nz, r, m), narrowReference(g, r, m), `level ${lv} r ${r} margin ${m}`);
  const st = seedRng('walk-perf-narrow');
  const rand = () => nextRandom(st);
  for (let k = 0; k < 12; k++) {
    const extra: Obstacle[] = Array.from({ length: 30 }, (_, i) => ({ id: `b${i}`, obb: { c: [-28 + rand() * 56, -28 + rand() * 56] as [number, number], half: [0.1 + rand() * 2, 0.1 + rand() * 0.6] as [number, number], yaw: rand() * 3 }, y0: 0, y1: 2, kind: 'solid' as const, label: `b${i}` }));
    const g = gridsWithObstacles(grids, extra).levels.get(0)!;
    same(narrowComponents(g.clearance, g.nx, g.nz, 0.25, 0.15), narrowReference(g, 0.25), `random scene ${k}`);
  }
  // every narrow() the walkers make while the build-bay probe changes the grids (378 epochs); pinned hash
  // oxlint-disable-next-line typescript/unbound-method -- saved to restore after the probe; re-invoked with orig.call(this, …)
  const orig = Spatial.prototype.narrow;
  let calls = 0;
  Spatial.prototype.narrow = function (this: Spatial, level: number, r: number, margin = 0.15) {
    const got = orig.call(this, level, r, margin);
    same(got, narrowReference(this.grids.levels.get(level)!, r, margin), `construction epoch ${this.epoch} level ${level}`);
    calls++;
    return got;
  };
  let hash = '';
  try {
    const h = new WorldHistory(BUILD_BAY_RULES);
    h.publishCanonical('canon', 'open ground', addAll(emptyWorld('open-ground', buildBayGround()), ...buildBayEntities(BUILD_BAY_SITE)), 'probe');
    h.fork('canon', 'ws', 'ws');
    const plan = bindTemplate(buildBayTemplate(BUILD_BAY_SITE), buildBayBindings, { history: h, baseline: 'ws', registry: buildBayRegistry() });
    const r = rehearse(h, 'ws', plan, { registry: buildBayRegistry(), invariants: BUILD_BAY_INVARIANTS, services: () => ({ spatial: new Spatial(buildBayGround(), { contributors: BUILD_BAY_CONTRIBUTORS }) }) });
    hash = r.take.finalStateHash;
  } finally {
    Spatial.prototype.narrow = orig;
  }
  assert.equal(hash, 'b746b0947e651c054506ccdb6568d5216a84c2d0f0304fda1b8261ba62e7f0c3');
  assert.ok(calls >= 100, `${calls} narrow() calls in the probe`);
  assert.ok(compared >= 25);
});
