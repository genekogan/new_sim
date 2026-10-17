// upper-floors/1 (lane L4b, old Eden's office floors): a level with `crop` is rasterised over its crop rectangle only, on
// the shared lattice. Inside the crop it must equal the full-extent level cell for cell (free, clearance, blockers), and
// routes over it (including stairs onto it) must be the same as with the full-extent level; incremental updates too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGrids, updateGrids, StaticRaster, type GridSet, type LevelGrid } from '../spatial/grid.ts';
import { findRoute } from '../spatial/path.ts';
import { HUMAN_PROFILE, type Level, type Link, type Obstacle, type SpatialScene, type Surface } from '../spatial/types.ts';
import { stairPath } from '../scenes/proving-ground.ts';
import { seedRng, nextRandom } from '../core/rng.ts';

const CROP: [number, number, number, number] = [10, -6, 22, 4];
function scene(crop: boolean, extra: Obstacle[] = []): SpatialScene {
  const lv11: Level = { id: 11, y: 3.1, label: 'office floor 1', ...(crop ? { crop: CROP } : {}) };
  const surfaces: Surface[] = [
    { id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [30, 30], yaw: 0 } },
    { id: 'deck', level: 1, y: 0.3, obb: { c: [-10, -10], half: [3, 2], yaw: 0 } },
    // the floor: two slabs either side of a stair well
    { id: 'floor-n', level: 11, y: 3.1, obb: { c: [16, -3.5], half: [5.8, 2.3], yaw: 0 } },
    { id: 'floor-s', level: 11, y: 3.1, obb: { c: [17, 1.2], half: [4.8, 2.4], yaw: 0 } },
  ];
  const obstacles: Obstacle[] = [
    { id: 'wall', obb: { c: [0, 5], half: [8, 0.15], yaw: 0 }, y0: 0, y1: 2.4, kind: 'wall' },
    { id: 'desk-up', obb: { c: [18, -3], half: [0.6, 0.4], yaw: 0.3 }, y0: 3.1, y1: 3.9, kind: 'fixture' },
    { id: 'desk-down', obb: { c: [14, -3], half: [0.6, 0.4], yaw: 0 }, y0: 0, y1: 0.9, kind: 'fixture' },
    { id: 'tall', obb: { c: [20, 2], half: [0.3, 0.3], yaw: 0 }, y0: 0, y1: 6, kind: 'solid' },
    ...extra,
  ];
  const stairs: Link = { id: 'flight', kind: 'stairs', from: { level: 0, p: [12.5, 3], y: 0 }, to: { level: 11, p: [12.5, -0.6], y: 3.1 }, width: 0.9,
    heading: -Math.PI / 2, path: stairPath([12.5, 0.2, 2.4], [12.5, 3.1, -0.2], 14), usable: true };
  return { bounds: [-30, -30, 30, 30], levels: [{ id: 0, y: 0, label: 'ground' }, { id: 1, y: 0.3, label: 'deck' }, lv11], surfaces, obstacles, links: [stairs] };
}
function sameInside(full: LevelGrid, crop: LevelGrid, what: string) {
  assert.ok(crop.nx * crop.nz < full.nx * full.nz / 20, `${what}: the crop is small (${crop.nx}x${crop.nz})`);
  for (let j = 0; j < crop.nz; j++) for (let i = 0; i < crop.nx; i++) {
    const c = j * crop.nx + i, f = (crop.oz + j - full.oz) * full.nx + (crop.ox + i - full.ox);
    assert.equal(crop.free[c], full.free[f], `${what}: free at ${i},${j}`);
    assert.equal(crop.clearance[c], full.clearance[f], `${what}: clearance at ${i},${j}`);
    assert.equal(crop.blockers.get(c), full.blockers.get(f), `${what}: blocker at ${i},${j}`);
  }
  // no floor outside the crop on the full level either (so nothing was lost)
  let outside = 0;
  for (let j = 0; j < full.nz; j++) for (let i = 0; i < full.nx; i++) {
    const ci = full.ox + i - crop.ox, cj = full.oz + j - crop.oz;
    if ((ci < 0 || cj < 0 || ci >= crop.nx || cj >= crop.nz) && full.free[j * full.nx + i]) outside++;
  }
  assert.equal(outside, 0, `${what}: free cells outside the crop`);
}
const legsOf = (r: ReturnType<typeof findRoute>) => r.ok ? r.route.legs.map((l) => l.kind === 'walk' ? { walk: l.points } : { link: l.link.id, up: l.ascending }) : r.diagnostic.code;

test('a cropped level holds exactly the full level inside its crop and nothing is lost outside', () => {
  for (const pre of [false, true]) {
    const full = buildGrids(scene(false), 0.1), s = scene(true);
    const crop = buildGrids(s, 0.1, pre ? new StaticRaster(s.obstacles.slice(0, 2), s.bounds, 0.1) : undefined);
    for (const id of [0, 1]) assert.deepEqual([...crop.levels.get(id)!.free], [...full.levels.get(id)!.free], `level ${id} unchanged`);
    sameInside(full.levels.get(11)!, crop.levels.get(11)!, pre ? 'with prefix' : 'plain');
  }
});

test('routes onto, across and off a cropped floor are the ones the full-extent floor gives', () => {
  const full = scene(false), crop = scene(true), gf = buildGrids(full, 0.1), gc = buildGrids(crop, 0.1);
  const trips: [number, [number, number], number, [number, number]][] = [
    [0, [0, 10], 11, [19.5, -4.5]], [11, [19.5, 1.5], 0, [-5, -20]], [11, [11, -4.5], 11, [21, 1.5]], [0, [-20, 0], 0, [20, 20]], [0, [0, 10], 1, [-10, -10]], // (the deck has no stairs: both refuse alike)
  ];
  for (const [la, a, lb, b] of trips) {
    for (const planner of ['exact', 'corridor'] as const) {
      const rf = findRoute(gf, full, HUMAN_PROFILE, { level: la, p: a }, { level: lb, p: b }, { planner, proveUnreachable: true });
      const rc = findRoute(gc, crop, HUMAN_PROFILE, { level: la, p: a }, { level: lb, p: b }, { planner, proveUnreachable: true });
      assert.deepEqual(legsOf(rc), legsOf(rf), `${planner} ${la}:${a} -> ${lb}:${b}`);
      if (lb !== 1) assert.ok(rc.ok, `${planner} ${la}:${a} -> ${lb}:${b} routes`);
    }
  }
  const off = findRoute(gc, crop, HUMAN_PROFILE, { level: 0, p: [0, 10] }, { level: 11, p: [25, 25] });
  assert.equal(off.ok, false, 'a goal off the cropped floor is refused');
  if (!off.ok) assert.equal(off.diagnostic.code, 'route.goal-blocked');
});

test('incremental updates of a cropped level equal a fresh build (random edits on the floor and the ground)', () => {
  const rng = seedRng('grid-level-crop'), rand = () => nextRandom(rng);
  let prevScene = scene(true), prev: GridSet = buildGrids(prevScene, 0.1, undefined, true);
  for (let k = 0; k < 40; k++) {
    const extra: Obstacle[] = [];
    for (let n = Math.floor(rand() * 5); n > 0; n--) {
      const up = rand() < 0.6, y0 = up ? 3.1 : 0;
      extra.push({ id: `e${k}-${n}`, obb: { c: [up ? 10 + rand() * 12 : -25 + rand() * 50, up ? -6 + rand() * 10 : -25 + rand() * 50], half: [0.1 + rand(), 0.1 + rand()], yaw: rand() * Math.PI }, y0, y1: y0 + 0.5 + rand() * 2, kind: 'component' });
    }
    const next = scene(true, extra), inc = updateGrids(prev, prevScene, next, 0.1), fresh = buildGrids(next, 0.1);
    assert.ok(inc, `step ${k}: incremental`);
    for (const [id, g] of fresh.levels) {
      const h = inc!.levels.get(id)!;
      for (const key of ['nx', 'nz', 'ox', 'oz'] as const) assert.equal(h[key], g[key], `step ${k} level ${id} ${key}`);
      assert.equal(h.free.findIndex((v, i) => v !== g.free[i]), -1, `step ${k} level ${id} free`);
      assert.equal(h.clearance.findIndex((v, i) => v !== g.clearance[i]), -1, `step ${k} level ${id} clearance`);
    }
    prev = inc!; prevScene = next;
  }
});
