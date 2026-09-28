// Region-local grid updates (docs/engineering/PLANNING_BUDGET.md §4): Spatial.sync patches the
// previous grids (grid.ts updateGrids) instead of rebuilding them. The patch must be bit-identical
// to a full buildGrids — same `free` bytes, same `clearance` float32 bits, same `blockers` entries,
// same level order — on random scenes and on every construction step of the real sequences.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGrids, gridsWithObstacles, updateGrids, StaticRaster, BlockerMap, cellOf, centreOf, type GridSet } from '../spatial/grid.ts';
import { findRoute } from '../spatial/path.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import { Spatial } from '../spatial/service.ts';
import type { Level, Obstacle, SpatialScene, Surface } from '../spatial/types.ts';
import type { WorldState } from '../world/types.ts';
import { seedRng, nextRandom } from '../core/rng.ts';
import { WorldHistory } from '../history/store.ts';
import { emptyWorld, addAll } from '../world/factory.ts';
import { bindTemplate } from '../sequence/bind.ts';
import { rehearse } from '../rehearsal/rehearse.ts';
import { buildBayEntities, buildBayTemplate, buildBayBindings, buildBayRegistry, BUILD_BAY_INVARIANTS, BUILD_BAY_CONTRIBUTORS, type Site } from '../scenarios/build-bay.ts';
import { buildBayGround, BUILD_BAY_RULES, BUILD_BAY_SITE } from '../../app/lab/build-bay.ts';
import { scenarioByName, buildRuntime } from '../../app/lab/scenarios.ts';
import { readCampus2026File } from '../campus/node.ts';
import { cropScene } from '../campus/load.ts';
import { CAMPUS_ID, loadCampus2026 } from '../campus/world.ts';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { human, component } from '../world/factory.ts';
import { walkTo } from '../locomotion/walk.ts';
import { carry } from '../carry/actions.ts';
import { CARRY_INVARIANTS } from '../carry/invariants.ts';
import { carryCorridors } from '../carry/scenes.ts';
import { hashOf } from '../core/hash.ts';
import type { ActionDef } from '../actions/types.ts';
import type { Entity } from '../world/types.ts';

/** Throws naming the first difference between two grid sets (level order, dims, free, clearance bits, blockers). */
function assertSameGrids(a: GridSet, b: GridSet, what: string) {
  assert.equal(a.cell, b.cell, `${what}: cell`);
  assert.deepEqual([...a.levels.keys()], [...b.levels.keys()], `${what}: level order`);
  for (const [id, ga] of a.levels) {
    const gb = b.levels.get(id)!;
    for (const k of ['level', 'y', 'cell', 'nx', 'nz', 'ox', 'oz', 'x0', 'z0'] as const) assert.equal(ga[k], gb[k], `${what}: level ${id} ${k}`);
    const df = ga.free.findIndex((v, i) => v !== gb.free[i]);
    assert.equal(df, -1, `${what}: level ${id} free differs at cell ${df}`);
    const ca = new Uint32Array(ga.clearance.buffer, ga.clearance.byteOffset, ga.clearance.length);
    const cb = new Uint32Array(gb.clearance.buffer, gb.clearance.byteOffset, gb.clearance.length);
    const dc = ca.findIndex((v, i) => v !== cb[i]);
    assert.equal(dc, -1, `${what}: level ${id} clearance differs at cell ${dc} (${ga.clearance[dc]} vs ${gb.clearance[dc]})`);
    assert.equal(ga.blockers.size, gb.blockers.size, `${what}: level ${id} blocker count`);
    for (const [c, bid] of gb.blockers) if (ga.blockers.get(c) !== bid) assert.fail(`${what}: level ${id} blocker at cell ${c}: ${ga.blockers.get(c)} vs ${bid}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Random scenes: 240 seeded scenes × 5 chained add / remove / move / surface / new-level steps

const box = (rand: () => number, id: string, [x0, z0, x1, z1]: number[], big = 3): Obstacle => {
  const band = rand();
  const y0 = band < 0.15 ? 2.2 : band < 0.25 ? -0.5 : 0; // some overhead (above body band on level 0), some below
  const y1 = band < 0.25 && band >= 0.15 ? 0.1 : y0 + 0.3 + rand() * 2.5; // band 0.15–0.25: under step height
  const yaw = rand() < 0.5 ? 0 : rand() * Math.PI;
  // ~10 % reach past the scene edge
  const c: [number, number] = [x0 - 1 + rand() * (x1 - x0 + 2), z0 - 1 + rand() * (z1 - z0 + 2)];
  return { id, obb: { c, half: [0.05 + rand() * big, 0.05 + rand() * big * 0.6], yaw }, y0, y1, kind: 'component' };
};

function randomScene(rand: () => number, sceneIx: number): { scene: SpatialScene; prefix?: StaticRaster; cell: number } {
  const w = 6 + rand() * 14, d = 6 + rand() * 14;
  const bounds: [number, number, number, number] = [-w / 2, -d / 2, w / 2, d / 2];
  const cell = rand() < 0.75 ? 0.1 : 0.25;
  const levels: Level[] = [{ id: 0, y: 0, label: 'ground' }];
  const surfaces: Surface[] = [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [w / 2 - rand() * 2, d / 2 - rand() * 2], yaw: rand() < 0.2 ? rand() * 0.4 : 0 } }];
  if (rand() < 0.5) {
    levels.push({ id: 4, y: 2, label: 'deck' });
    surfaces.push({ id: 'deck', level: 4, y: 2, obb: { c: [rand() * 2, rand() * 2], half: [1 + rand() * 3, 1 + rand() * 3], yaw: 0 } });
  }
  const nBase = Math.floor(rand() * 12), nDyn = Math.floor(rand() * 10);
  const base = Array.from({ length: nBase }, (_, k) => box(rand, `base${k}`, bounds));
  const dyn = Array.from({ length: nDyn }, (_, k) => box(rand, `dyn${sceneIx}-${k}`, bounds, 1.5));
  const scene: SpatialScene = { bounds, levels, surfaces, obstacles: [...base, ...dyn], links: [] };
  // like Spatial: the base obstacles are a memoised prefix (half the scenes use none)
  const prefix = rand() < 0.5 ? new StaticRaster(base, bounds, cell) : undefined;
  if (!prefix) return { scene, cell };
  return { scene, prefix, cell };
}

function mutate(rand: () => number, s: SpatialScene, p: number, step: number): SpatialScene {
  const obstacles = [...s.obstacles], surfaces = [...s.surfaces], levels = [...s.levels];
  const ops = 1 + Math.floor(rand() * 3);
  for (let o = 0; o < ops; o++) {
    const r = rand(), dyn = obstacles.length - p;
    if (r < 0.35 || dyn === 0) obstacles.splice(p + Math.floor(rand() * (dyn + 1)), 0, box(rand, `add${step}-${o}`, s.bounds, 1.2)); // insert anywhere after the prefix
    else if (r < 0.6) obstacles.splice(p + Math.floor(rand() * dyn), 1); // remove
    else if (r < 0.8) {
      const k = p + Math.floor(rand() * dyn), ob = obstacles[k]; // move / resize, same id
      obstacles[k] = { ...ob, obb: { ...ob.obb, c: [ob.obb.c[0] + rand() - 0.5, ob.obb.c[1] + rand() - 0.5], half: [ob.obb.half[0] * (0.5 + rand()), ob.obb.half[1]] } };
    } else if (r < 0.9) {
      // a deck sheet appears (possibly creating a new level) or one goes away
      const own = surfaces.filter((x) => x.id.startsWith('sheet'));
      if (own.length && rand() < 0.4) surfaces.splice(surfaces.indexOf(own[Math.floor(rand() * own.length)]), 1);
      else {
        const lv = rand() < 0.5 ? 4 : 7, y = lv === 4 ? 2 : 3.5;
        if (!levels.some((l) => l.id === lv)) levels.push({ id: lv, y, label: `level ${lv}` });
        surfaces.push({ id: `sheet${step}-${o}`, level: lv, y, obb: { c: [rand() * 4 - 2, rand() * 4 - 2], half: [0.6, 1.2], yaw: rand() < 0.7 ? 0 : 0.3 } });
      }
    } else {
      // ground patch grows/shrinks (a surface edit on an existing level)
      const k = surfaces.findIndex((x) => x.id === 'ground');
      const g = surfaces[k];
      surfaces[k] = { ...g, obb: { ...g.obb, half: [g.obb.half[0] + rand() - 0.5, g.obb.half[1]] } };
    }
  }
  return { ...s, obstacles, surfaces, levels };
}

test('updateGrids === buildGrids over 240 seeded random scenes × 5 chained edits (free, clearance bits, blockers)', () => {
  const rand = ((st) => () => nextRandom(st))(seedRng('grid-incremental'));
  let patched = 0, fallbacks = 0, around = 0;
  for (let n = 0; n < 240; n++) {
    const { scene: s0, prefix, cell } = randomScene(rand, n);
    const p = prefix ? prefix.obstacles.length : 0;
    let scene = s0, grids = buildGrids(scene, cell, prefix, true);
    assertSameGrids(grids, buildGrids(scene, cell), `scene ${n} (prefix raster vs plain)`);
    for (let step = 0; step < 5; step++) {
      const next = mutate(rand, scene, p, step);
      const up = updateGrids(grids, scene, next, cell, prefix);
      const full = buildGrids(next, cell, prefix, true);
      if (up) { patched++; assertSameGrids(up, full, `scene ${n} step ${step}`); } else fallbacks++;
      scene = next;
      grids = up ?? full;
      // people on top of patched grids (windowed clearance) and on plain grids (full EDT)
      if (step % 2 === 0) {
        const people = Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, k) => box(rand, `q${k}`, scene.bounds, 0.4));
        const want = buildGrids({ ...scene, obstacles: [...scene.obstacles, ...people] }, cell);
        assertSameGrids(gridsWithObstacles(grids, people), want, `scene ${n} step ${step} + people`);
        assertSameGrids(gridsWithObstacles(buildGrids(scene, cell), people), want, `scene ${n} step ${step} + people (no columns)`);
        around++;
      }
    }
  }
  // edits are pure inserts / removes / moves, so the patch always applies
  assert.equal(fallbacks, 0);
  assert.equal(patched, 1200);
  assert.ok(around >= 600);
});

test('updateGrids: reordered or duplicate obstacles fall back (null); a no-op edit reuses every level', () => {
  const s: SpatialScene = {
    bounds: [-5, -5, 5, 5], levels: [{ id: 0, y: 0, label: 'g' }], links: [],
    surfaces: [{ id: 'g', level: 0, y: 0, obb: { c: [0, 0], half: [5, 5], yaw: 0 } }],
    obstacles: [
      { id: 'a', obb: { c: [0, 0], half: [1, 1], yaw: 0 }, y0: 0, y1: 2 },
      { id: 'b', obb: { c: [0.5, 0], half: [1, 1], yaw: 0 }, y0: 0, y1: 2 },
    ],
  };
  const g = buildGrids(s, 0.1, undefined, true);
  assert.equal(updateGrids(g, s, { ...s, obstacles: [s.obstacles[1], s.obstacles[0]] }, 0.1), null, 'swap changes which one names shared cells');
  assert.equal(updateGrids(g, s, { ...s, obstacles: [...s.obstacles, s.obstacles[0]] }, 0.1), null, 'duplicate key');
  const same = updateGrids(g, s, { ...s, obstacles: [...s.obstacles] }, 0.1)!;
  assert.equal(same.levels.get(0), g.levels.get(0), 'untouched level reused');
  assert.ok(g.levels.get(0)!.blockers instanceof BlockerMap);
});

test('BlockerMap behaves as a Map<number, string> (get / has / set / delete / size / iteration, copies independent)', () => {
  const m = new BlockerMap(10);
  m.set(3, 'a').set(7, 'b').set(3, 'c');
  assert.equal(m.size, 2);
  assert.equal(m.get(3), 'c');
  assert.equal(m.get(4), undefined);
  assert.equal(m.get(99), undefined);
  assert.equal(m.has(7), true);
  const c = m.copy();
  c.delete(7);
  c.set(0, 'a');
  assert.deepEqual([...m], [[3, 'c'], [7, 'b']]);
  assert.deepEqual([...c.entries()], [[0, 'a'], [3, 'c']]);
  assert.deepEqual([...c.keys()], [0, 3]);
  assert.deepEqual(new Map(c), new Map([[0, 'a'], [3, 'c']]));
  assert.throws(() => m.set(10, 'x'), RangeError);
});

// ---------------------------------------------------------------------------------------------
// Real construction sequences: every Spatial rebuild compared with a from-scratch buildGrids

/**
 * Runs `fn` with every Spatial.sync that rebuilt checked against a from-scratch buildGrids of the
 * synced scene (via an independent base-obstacle raster — plain buildGrids re-rasterises the 2.7k
 * campus prisms, 0.25 s a call — and fully plain on each service's first sync); returns the count.
 */
function checkingSyncs(fn: () => void): number {
  const proto = Spatial.prototype;
  const orig = proto.sync;
  const rasters = new WeakMap<Spatial, StaticRaster>();
  let n = 0;
  proto.sync = function (this: Spatial, world: WorldState) {
    const rebuilt = orig.call(this, world);
    if (rebuilt) {
      n++;
      let r = rasters.get(this);
      if (!r) {
        rasters.set(this, (r = new StaticRaster(this.base.obstacles, this.base.bounds, this.cell)));
        assertSameGrids(this.grids, buildGrids(this.scene, this.cell), `sync ${n} (epoch ${this.epoch}, plain)`);
      }
      assertSameGrids(this.grids, buildGrids(this.scene, this.cell, r), `sync ${n} (epoch ${this.epoch})`);
    }
    return rebuilt;
  };
  try {
    fn();
  } finally {
    proto.sync = orig;
  }
  return n;
}

test('Spatial.sync patches === full rebuild at every construction step: build-bay on open ground (probe) + lab construction', () => {
  let hash = '';
  const n = checkingSyncs(() => {
    const h = new WorldHistory(BUILD_BAY_RULES);
    h.publishCanonical('canon', 'open ground', addAll(emptyWorld('open-ground', buildBayGround()), ...buildBayEntities(BUILD_BAY_SITE)), 'probe');
    h.fork('canon', 'ws', 'ws');
    const plan = bindTemplate(buildBayTemplate(BUILD_BAY_SITE), buildBayBindings, { history: h, baseline: 'ws', registry: buildBayRegistry() });
    const r = rehearse(h, 'ws', plan, { registry: buildBayRegistry(), invariants: BUILD_BAY_INVARIANTS, services: () => ({ spatial: new Spatial(buildBayGround(), { contributors: BUILD_BAY_CONTRIBUTORS }) }) });
    assert.equal(r.report.status, 'completed');
    hash = r.take.finalStateHash;
    const s = scenarioByName('construction')!;
    const rt = buildRuntime(s);
    s.start(rt);
    for (let i = 0; i < 200; i++) { rt.step(); s.tick?.(rt); }
  });
  assert.ok(n > 100, `${n} rebuilds checked`);
  assert.equal(hash, 'b746b0947e651c054506ccdb6568d5216a84c2d0f0304fda1b8261ba62e7f0c3', 'determinism probe hash unchanged');
});

test('Spatial.sync patches === full rebuild at every construction step: campus flagship (staging-east crop)', () => {
  const n = checkingSyncs(() => {
    const file = readCampus2026File();
    const { base, world } = loadCampus2026(file, { flagshipInventory: false });
    const st = world.regions['staging-east'];
    const xs = st.polygon.map((p) => p[0]), zs = st.polygon.map((p) => p[1]);
    const site: Site = { origin: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2], yaw: 0, groundY: base.meta.groundY };
    const local = cropScene(base, [site.origin[0] - 40, site.origin[1] - 40, site.origin[0] + 40, site.origin[1] + 40]);
    const h = new WorldHistory('mars-rules/flagship-campus-test');
    h.publishCanonical(CAMPUS_ID, 'Mars 2026 (canonical)', world, 'test');
    h.fork(CAMPUS_ID, 'build', 'flagship build (hypothetical)');
    const w = h.read('build');
    for (const e of buildBayEntities(site)) w.entities[e.id] = e;
    h.commit('build', w, { kind: 'design-edit', note: 'flagship piles + crew' });
    const cfg = { registry: buildBayRegistry(), invariants: BUILD_BAY_INVARIANTS, services: () => ({ spatial: new Spatial(local, { contributors: BUILD_BAY_CONTRIBUTORS, baseId: file.contentHash }) }) };
    const plan = bindTemplate(buildBayTemplate(site), buildBayBindings, { history: h, baseline: 'build', registry: buildBayRegistry() });
    const reh = rehearse(h, 'build', plan, cfg);
    assert.equal(reh.report.status, 'completed');
    assert.equal(reh.take.finalStateHash, 'c56ea8da9b0382a785680e2d70850632ae577cc88901817ef63f332e23247157', 'campus flagship hash unchanged');
  });
  assert.ok(n > 300, `${n} rebuilds checked`);
});

// ---------------------------------------------------------------------------------------------
// carry/validate.ts: the approach-route grids (item as a 1 m obstacle) and the pickup grid (a tall
// item left out) are patched from the synced grids by Spatial.gridsFor instead of rebuilt

/** Runs `fn` with every Spatial.gridsFor result compared with a from-scratch buildGrids of its scene. */
function checkingGridsFor(fn: () => void): { calls: number; patched: number } {
  const proto = Spatial.prototype;
  const orig = proto.gridsFor;
  const out = { calls: 0, patched: 0 };
  proto.gridsFor = function (this: Spatial, scene: SpatialScene) {
    const got = orig.call(this, scene);
    out.calls++;
    const self = this as unknown as { raster: StaticRaster; grids: GridSet; scene: SpatialScene };
    if (updateGrids(self.grids, self.scene, scene, this.cell, self.raster)) out.patched++;
    assertSameGrids(got, buildGrids(scene, this.cell, new StaticRaster(this.base.obstacles, this.base.bounds, this.cell)), `gridsFor ${out.calls}`);
    if (this.base.obstacles.length < 200) assertSameGrids(got, buildGrids(scene, this.cell), `gridsFor ${out.calls} (plain)`);
    return got;
  };
  try {
    fn();
  } finally {
    proto.gridsFor = orig;
  }
  return out;
}

test('Spatial.gridsFor === buildGrids for every carry plan (gather routes, tall pickup), and the routes it yields are unchanged', () => {
  const REG = new Map<string, ActionDef>([['walk_to', walkTo], ['carry', carry]]);
  const setup = (...es: Entity[]) => new Runtime(addAll(emptyWorld('carry-test', carryCorridors()), ...es), REG, { spatial: new Spatial(carryCorridors()) }, [...DEFAULT_INVARIANTS, ...CARRY_INVARIANTS]);
  const gathers: string[] = [];
  const gatherOf = (rt: Runtime, id: string) => hashOf((rt as unknown as { live: Map<string, { program: { gather: unknown } }> }).live.get(id)!.program.gather);
  const res = checkingGridsFor(() => {
    // corner run (2 carriers, 12 ft beam), with a stack beside the path, and a standing upright (tall pickup)
    for (const extra of [[], [component('stack', '2x4-8ft', [12, 0, 4], 0)]]) {
      const rt = setup(component('b1', 'beam-12ft', [4, 0, 4], 0), human('p1', 2, 6.5), human('p2', 6, 1.5), ...extra);
      const a = rt.submit('carry', { crew: ['p1', 'p2'], item: 'b1', to: { x: 18, z: 11, yaw: Math.PI / 2 } });
      assert.equal(a.status, 'executing', a.diagnostic?.message);
      gathers.push(gatherOf(rt, a.id));
    }
    const rt = setup(component('u8', 'upright-8ft', [4, 0, 4], 0), human('p1', 2, 6.5), human('p2', 6, 1.5));
    const a = rt.submit('carry', { crew: ['p1', 'p2'], item: 'u8', to: { x: 18, z: 11, yaw: Math.PI / 2 } });
    gathers.push(`${a.status}:${a.diagnostic?.code ?? gatherOf(rt, a.id)}`);
    // the build-bay probe: 13 carries on open ground
    const h = new WorldHistory(BUILD_BAY_RULES);
    h.publishCanonical('canon', 'open ground', addAll(emptyWorld('open-ground', buildBayGround()), ...buildBayEntities(BUILD_BAY_SITE)), 'probe');
    h.fork('canon', 'ws', 'ws');
    const plan = bindTemplate(buildBayTemplate(BUILD_BAY_SITE), buildBayBindings, { history: h, baseline: 'ws', registry: buildBayRegistry() });
    const r = rehearse(h, 'ws', plan, { registry: buildBayRegistry(), invariants: BUILD_BAY_INVARIANTS, services: () => ({ spatial: new Spatial(buildBayGround(), { contributors: BUILD_BAY_CONTRIBUTORS }) }) });
    assert.equal(r.take.finalStateHash, 'b746b0947e651c054506ccdb6568d5216a84c2d0f0304fda1b8261ba62e7f0c3', 'determinism probe hash unchanged');
  });
  console.log(`  gridsFor: ${res.calls} calls, ${res.patched} patched`);
  // gather routes as planned on the former whole-grid buildGrids (measured before the switch). Re-pinned
  // (was 8b5ab468…125f8) by grid lattice anchoring, 2026-09-28: same cells, vertices moved ≤ 1 ulp (PLANNING_BUDGET.md);
  // re-pinned (was ea04513b…39ab) by walker fallback + hypot + encounters on the smoothed path, 2026-09-28: same
  // cells and vertices, one leg length 1 ulp apart (dist2 = √ of the sum of squares instead of the host hypot)
  const G = '9ba1037c4e200eb336fef7a58bfa79e1130388cefe6d1f84902aadb2bbe0133f';
  assert.deepEqual(gathers, [G, G, 'failed:carry.target-blocked'], 'gather routes unchanged');
  assert.ok(res.calls >= 15 && res.patched === res.calls, `${res.patched}/${res.calls} patched`);
});

// ---------------------------------------------------------------------------------------------
// Grid lattice anchoring (2026-09-28): every grid's cells are cells of one global lattice, so a crop
// (different bounds, off-lattice) changes no coordinate — shared cells have bit-identical centres and
// rasters, and routes that stay inside both grids are bit-identical (campus-full.test.ts end to end).

test('grids of different bounds share one lattice: same cell centres, free cells and routes', () => {
  const big = provingGround();
  const small: SpatialScene = { ...big, bounds: [-27.37, -28.93, 26.61, 29.77] };
  const A = buildGrids(big, 0.1), B = buildGrids(small, 0.1);
  for (const [id, a] of A.levels) {
    const b = B.levels.get(id)!;
    assert.ok(b.ox !== a.ox && b.oz !== a.oz, 'the crop moves the grid origin');
    let checked = 0;
    for (let j = 0; j < b.nz; j += 7)
      for (let i = 0; i < b.nx; i += 7) {
        const p = centreOf(b, j * b.nx + i), c = cellOf(a, p);
        assert.equal(cellOf(b, p), j * b.nx + i, 'cellOf(centreOf(c)) === c');
        assert.deepEqual(centreOf(a, c), p, `level ${id} cell (${i}, ${j}): same centre in both grids`);
        assert.equal(a.free[c], b.free[j * b.nx + i], `level ${id} cell (${i}, ${j}): same free bit`);
        checked++;
      }
    assert.ok(checked > 1000);
  }
  for (const planner of ['exact', 'corridor'] as const)
    for (const [s, g] of [[[-18, -15], [-12, -15]], [[-15, 12], [-15, 20]], [[15, -20], [15, -10]], [[-20, -20], [20, 20]]] as [[number, number], [number, number]][]) {
      const ra = findRoute(A, big, HUMAN_PROFILE, { level: 0, p: s }, { level: 0, p: g }, { planner });
      const rb = findRoute(B, small, HUMAN_PROFILE, { level: 0, p: s }, { level: 0, p: g }, { planner });
      assert.ok(ra.ok, JSON.stringify(ra).slice(0, 200));
      assert.deepEqual(rb, ra, `${planner} route ${s} → ${g} identical on both grids`);
    }
});
