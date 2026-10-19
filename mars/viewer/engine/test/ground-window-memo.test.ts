// Engine P4 (Eden 2026 capabilities freeze): a Soul's capabilities read standing room and reachability at every far
// place, each through a window of its own. The memos that make that cheap must not change a single answer:
// - GroundNav.gridsOver keeps each upper floor per (rect, level) until its inputs change (S2), bit-identical to
//   the old full build (compose + buildGrids over the window); levelOver builds only the level asked for;
// - a failed exhaustive search remembers its start's side, so another goal outside it fails the same way, unsearched,
//   while a reachable goal still routes exactly as without the memo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGrids, type GridSet, type LevelGrid } from '../spatial/grid.ts';
import { GroundNav, rectOf } from '../spatial/tiled.ts';
import { G_WALK, GROUND_TILE_M, type GroundField } from '../spatial/ground.ts';
import { findRoute, strandedMetrics } from '../spatial/path.ts';
import { HUMAN_PROFILE, type Link, type SpatialScene } from '../spatial/types.ts';

const flat: GroundField = {
  id: 'flat-test', extent: [-256, -256, 256, 256], wadeMax: 0.6, maxSlope: 1,
  height: () => 0, waterLevel: () => null, medium: () => G_WALK, mediaTile: () => new Uint8Array(GROUND_TILE_M * GROUND_TILE_M),
};
// house A: a first floor (level 1) its stairs reach; house B: a second floor (level 2) nothing reaches
const stairs: Link = { id: 'a-stairs', kind: 'stairs', from: { level: 0, p: [10, 3], y: 0 }, to: { level: 1, p: [10, 8], y: 3 }, width: 1.2, heading: Math.PI / 2, path: [[10, 0, 3], [10, 3, 8]], usable: true };
const scene = (): SpatialScene => ({
  bounds: [-64, -64, 64, 64],
  levels: [{ id: 0, y: 0, label: 'ground' }, { id: 1, y: 3, label: 'a first floor' }, { id: 2, y: 6, label: 'b second floor' }, { id: 3, y: 9, label: 'far loft' }],
  surfaces: [
    { id: 'a-floor', level: 1, y: 3, obb: { c: [10, 11], half: [4, 4], yaw: 0 } },
    { id: 'b-floor', level: 2, y: 6, obb: { c: [-20, -20], half: [3, 3], yaw: 0.4 } },
    { id: 'loft', level: 3, y: 9, obb: { c: [200, 200], half: [3, 3], yaw: 0 } },
  ],
  obstacles: [
    { id: 'a-partition', obb: { c: [12, 11], half: [0.1, 2.5], yaw: 0 }, y0: 3, y1: 5.5, kind: 'component' },
    { id: 'rock', obb: { c: [-5, 6], half: [1.5, 1], yaw: 0.3 }, y0: 0, y1: 1.5, kind: 'component' },
  ],
  links: [stairs],
});

function sameGrid(a: LevelGrid | undefined, b: LevelGrid | undefined, what: string) {
  if (!a || !b) { assert.equal(a, b, what); return; }
  if (a.nx !== b.nx || a.nz !== b.nz || a.ox !== b.ox || a.oz !== b.oz) { sameCells(a, b, what); return; }
  for (const k of ['level', 'y', 'cell', 'nx', 'nz', 'ox', 'oz', 'x0', 'z0'] as const) assert.equal(a[k], b[k], `${what}: ${k}`);
  assert.ok(Buffer.from(a.free.buffer, a.free.byteOffset, a.free.byteLength).equals(Buffer.from(b.free.buffer, b.free.byteOffset, b.free.byteLength)), `${what}: free`);
  assert.ok(Buffer.from(a.clearance.buffer, a.clearance.byteOffset, a.clearance.byteLength).equals(Buffer.from(b.clearance.buffer, b.clearance.byteOffset, b.clearance.byteLength)), `${what}: clearance`);
  assert.deepEqual([...a.blockers], [...b.blockers], `${what}: blockers`);
}
/** L1: an upper floor is now a grid over its own floors (grid.ts buildGridsOverFloors): every cell of the full-window grid
 *  `b` reads the same through `a` on the global lattice, and a cell outside `a` is blocked with no floor in `b`. */
function sameCells(a: LevelGrid, b: LevelGrid, what: string) {
  for (const k of ['level', 'y', 'cell'] as const) assert.equal(a[k], b[k], `${what}: ${k}`);
  for (let j = 0; j < b.nz; j++) for (let i = 0; i < b.nx; i++) {
    const kb = j * b.nx + i, ia = b.ox + i - a.ox, ja = b.oz + j - a.oz;
    if (ia < 0 || ja < 0 || ia >= a.nx || ja >= a.nz) { if (b.free[kb] || b.clearance[kb] || b.blockers.has(kb)) assert.fail(`${what}: cell ${i},${j} outside the floor grid is open`); continue; }
    const ka = ja * a.nx + ia;
    if (a.free[ka] !== b.free[kb] || !Object.is(a.clearance[ka], b.clearance[kb]) || a.blockers.get(ka) !== b.blockers.get(kb)) assert.fail(`${what}: cell ${i},${j} differs`);
  }
}
/** The window as gridsOver built it before the memo: level 0 composed, every touching upper floor by buildGrids. */
function reference(nav: GroundNav, s: SpatialScene, r: [number, number, number, number]): GridSet {
  const b: [number, number, number, number] = [r[0] * 64, r[1] * 64, (r[2] + 1) * 64, (r[3] + 1) * 64];
  const levels = new Map<number, LevelGrid>([[0, nav.compose(r, s.obstacles)]]);
  const touches = (id: number) => s.surfaces.some((x) => x.level === id && x.obb.c[0] + 6 >= b[0] && x.obb.c[0] - 6 <= b[2] && x.obb.c[1] + 6 >= b[1] && x.obb.c[1] - 6 <= b[3]);
  const upper = s.levels.filter((l) => l.id !== 0 && touches(l.id));
  for (const [id, g] of buildGrids({ ...s, bounds: b, levels: upper }, nav.cell).levels) levels.set(id, g);
  return { cell: nav.cell, levels };
}
const navFor = (s: SpatialScene) => { const nav = new GroundNav(flat, 0.1, { paged: true }); nav.setFloors([]); nav.setSolids(s.obstacles); return nav; };

test('gridsOver keeps floors per window, bit-identical to the full build; levelOver reads one level; edits rebuild what they reach', () => {
  const s = scene(), nav = navFor(s), r = rectOf([[0, 0]]);
  const ref = reference(nav, s, r), a = nav.gridsOver(r, s);
  assert.deepEqual([...a.levels.keys()], [...ref.levels.keys()], 'same levels, same order (the far loft does not touch)');
  for (const [id, g] of ref.levels) sameGrid(a.levels.get(id), g, `level ${id}`);
  const built = nav.stats.floorBuilds;
  assert.equal(built, 2, 'two touching floors built once each');
  const again = nav.gridsOver(r, { ...s, bounds: [0, 0, 1, 1] });   // a page's scene: other bounds, same static world
  assert.equal(nav.stats.floorBuilds, built, 'the second window reuses its floors');
  for (const id of [1, 2]) assert.equal(again.levels.get(id), a.levels.get(id));
  for (const id of [0, 1, 2, 3, 7]) sameGrid(nav.levelOver(r, id, s), a.levels.get(id), `levelOver ${id}`);
  // a far point's own level only: the ground and nothing else
  const far = rectOf([[150, 150]]), before = nav.stats.floorBuilds;
  sameGrid(nav.levelOver(far, 0, s), reference(nav, s, far).levels.get(0), 'far ground');
  assert.equal(nav.stats.floorBuilds, before, 'reading the ground builds no floor');
  // S2: a static edit rebuilds only the floors it reaches (the rock is below both floors' body bands; the partition is on
  // house A's floor), each equal to a fresh build from the new world
  const moved: SpatialScene = { ...s, obstacles: [s.obstacles[0], { ...s.obstacles[1], obb: { ...s.obstacles[1].obb, c: [-4, 6] } }] };
  nav.setSolids(moved.obstacles);
  nav.gridsOver(r, moved);
  assert.equal(nav.stats.floorBuilds, built, 'a rock moved on the ground keeps both floors');
  const wall: SpatialScene = { ...moved, obstacles: [{ ...moved.obstacles[0], obb: { ...moved.obstacles[0].obb, c: [11, 11] } }, moved.obstacles[1]] };
  nav.setSolids(wall.obstacles);
  const b = nav.gridsOver(r, wall), fresh = navFor(wall).gridsOver(r, wall);
  assert.equal(nav.stats.floorBuilds, built + 1, 'the partition moved: house A\'s floor only');
  assert.equal(b.levels.get(2), a.levels.get(2), 'house B kept');
  for (const id of [0, 1, 2]) sameGrid(b.levels.get(id), fresh.levels.get(id), `after the edit, level ${id}`);
});

test('a failed search remembers its side: other goals there fail the same way, reachable ones route as before', () => {
  const s = scene(), nav = navFor(s), r = rectOf([[0, 0]]);
  const grids = nav.gridsOver(r, s);
  // without any memo (fresh grid objects): the reference answers
  const fresh = (): GridSet => ({ cell: grids.cell, levels: new Map([...grids.levels].map(([id, g]) => [id, { ...g }])) });
  const start = { level: 0, p: [0, 0] as [number, number] };
  const goals = [{ level: 2, p: [-20, -20] as [number, number] }, { level: 2, p: [-19, -21] as [number, number] }, { level: 1, p: [9, 12] as [number, number] }, { level: 0, p: [-30, 20] as [number, number] }];
  const want = goals.map((g) => findRoute(fresh(), s, HUMAN_PROFILE, start, g));
  assert.equal(want[0].ok, false); assert.equal(want[1].ok, false); assert.equal(want[2].ok, true, JSON.stringify(want[2])); assert.equal(want[3].ok, true);
  const h0 = strandedMetrics().hits;
  const got = goals.map((g) => findRoute(grids, s, HUMAN_PROFILE, start, g));
  assert.deepEqual(got, want, 'the same answers, failures and routes alike');
  assert.equal(strandedMetrics().hits - h0, 1, 'the second goal upstairs in house B is refused from the memo');
  assert.deepEqual(findRoute(grids, s, HUMAN_PROFILE, start, goals[0]), want[0], 'and the first again too');
  assert.equal(strandedMetrics().hits - h0, 2);
});
