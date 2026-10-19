// S2 (tranche 2026-10-19): a paged window's upper floors are kept across static edits that do not reach them (each floor
// is keyed by what it is built from: its level's height, its surfaces and the obstacles in its body band near the window).
// Incremental == full: after every random edit (an obstacle moved, added, removed or raised into a floor's band; a floor
// moved, added or removed; a level raised; the obstacle order changed) every window's grids, read from the one GroundNav
// that kept what it could, are bit-identical to a fresh GroundNav's build of the same scene, and edits far from a
// window's floors rebuild none of them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LevelGrid } from '../spatial/grid.ts';
import { GroundNav, rectOf, type TileRect } from '../spatial/tiled.ts';
import { G_WALK, GROUND_TILE_M, type GroundField } from '../spatial/ground.ts';
import type { Obstacle, SpatialScene, Surface } from '../spatial/types.ts';

const flat: GroundField = {
  id: 'flat-s2', extent: [-256, -256, 256, 256], wadeMax: 0.6, maxSlope: 1,
  height: () => 0, waterLevel: () => null, medium: () => G_WALK, mediaTile: () => new Uint8Array(GROUND_TILE_M * GROUND_TILE_M),
};
const bytes = (a: ArrayBufferView) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
function sameGrid(a: LevelGrid | undefined, b: LevelGrid | undefined, what: string) {
  if (!a || !b) { assert.equal(a, b, what); return; }
  for (const k of ['level', 'y', 'cell', 'nx', 'nz', 'ox', 'oz', 'x0', 'z0'] as const) assert.equal(a[k], b[k], `${what}: ${k}`);
  assert.ok(bytes(a.free).equals(bytes(b.free)), `${what}: free`);
  assert.ok(bytes(a.clearance).equals(bytes(b.clearance)), `${what}: clearance`);
  assert.deepEqual([...a.blockers], [...b.blockers], `${what}: blockers`);
}

test('S2: kept upper floors equal a fresh build after every random static edit; far edits rebuild none', () => {
  let seed = 20261019;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const between = (a: number, b: number) => a + (b - a) * rand();
  let n = 0;
  const obstacle = (y0: number): Obstacle => ({ id: `o${n++}`, kind: 'component', obb: { c: [between(-120, 120), between(-120, 120)], half: [between(0.1, 2), between(0.1, 2)], yaw: between(0, 3) }, y0, y1: y0 + between(0.5, 2.5) });
  const levels = [{ id: 0, y: 0, label: 'ground' }, ...[1, 2, 3, 4, 5].map((id) => ({ id, y: 3 * id, label: `floor ${id}` }))];
  const surface = (level: number): Surface => ({ id: `s${n++}`, level, y: 3 * level, obb: { c: [between(-120, 120), between(-120, 120)], half: [between(2, 6), between(2, 6)], yaw: between(0, 3) } });
  let scene: SpatialScene = {
    bounds: [-256, -256, 256, 256], levels: levels.map((l) => ({ ...l })),
    surfaces: [1, 2, 3, 4, 5, 1, 2, 3].map(surface),
    obstacles: Array.from({ length: 60 }, () => obstacle([0, 3, 6, 9, 12, 15][Math.floor(rand() * 6)] + between(-0.2, 0.5))),
    links: [],
  };
  // the windows a busy world faces: single tiles and a two-tile pair round the floors
  const windows: TileRect[] = [rectOf([[0, 0]]), rectOf([[-70, -70]]), rectOf([[70, -10], [130, -10]]), rectOf([[-100, 90]])];
  const kept = new GroundNav(flat, 0.1, { paged: true });
  const set = (nav: GroundNav, s: SpatialScene) => { nav.setFloors(s.surfaces.filter((x) => x.level === 0)); nav.setSolids(s.obstacles); };
  set(kept, scene);
  for (const r of windows) kept.gridsOver(r, scene);
  let farEdits = 0;
  for (let step = 0; step < 40; step++) {
    const o = [...scene.obstacles], s = [...scene.surfaces], lv = scene.levels.map((l) => ({ ...l }));
    const kind = step % 8;
    let far = false;
    if (kind === 0) { const k = Math.floor(rand() * o.length); o[k] = { ...o[k], obb: { ...o[k].obb, c: [between(-120, 120), between(-120, 120)] } }; }
    else if (kind === 1) o.push(obstacle(3 * Math.floor(between(1, 6)) + 0.1));                  // in a floor's body band
    else if (kind === 2) o.splice(Math.floor(rand() * o.length), 1);
    else if (kind === 3) { const k = Math.floor(rand() * s.length); s[k] = { ...s[k], obb: { ...s[k].obb, c: [between(-120, 120), between(-120, 120)] } }; }
    else if (kind === 4) { if (rand() < 0.5) s.push(surface(1 + Math.floor(rand() * 5))); else s.splice(Math.floor(rand() * s.length), 1); }
    else if (kind === 5) { const l = lv[1 + Math.floor(rand() * 5)]; l.y += 0.25; }
    else if (kind === 6) { const k = Math.floor(rand() * (o.length - 1)); [o[k], o[k + 1]] = [o[k + 1], o[k]]; }
    else { o.push({ ...obstacle(4), obb: { c: [230, 230], half: [1, 1], yaw: 0 } }); far = true; }   // far from every window
    scene = { ...scene, obstacles: o, surfaces: s, levels: lv };
    set(kept, scene);
    const before = kept.stats.floorBuilds;
    const fresh = new GroundNav(flat, 0.1, { paged: true }); set(fresh, scene);
    for (const r of windows) {
      const a = kept.gridsOver(r, scene), b = fresh.gridsOver(r, scene);
      assert.deepEqual([...a.levels.keys()], [...b.levels.keys()], `step ${step} (${kind}) window ${r}: levels`);
      for (const [id, g] of b.levels) sameGrid(a.levels.get(id), g, `step ${step} (${kind}) window ${r} level ${id}`);
    }
    if (far) { farEdits++; assert.equal(kept.stats.floorBuilds, before, `step ${step}: an edit far from every window rebuilds no floor`); }
  }
  assert.equal(farEdits, 5);
  assert.ok(kept.stats.floorHits > 0, 'floors were kept across edits');
});

test('S2: windows holding the same whole floor share it, bit-identical to each window\'s own build; a cut floor is its own', () => {
  const scene: SpatialScene = {
    bounds: [-256, -256, 256, 256], levels: [{ id: 0, y: 0, label: 'ground' }, { id: 1, y: 3, label: 'house floor' }],
    surfaces: [{ id: 'floor', level: 1, y: 3, obb: { c: [20, 20], half: [5, 4], yaw: 0.3 } }, { id: 'long-deck', level: 1, y: 3, obb: { c: [60, -20], half: [12, 2], yaw: 0 } }],
    obstacles: [{ id: 'wall', kind: 'component', obb: { c: [20, 22], half: [3, 0.1], yaw: 0.3 }, y0: 3, y1: 5.5 }],
    links: [],
  };
  const nav = new GroundNav(flat, 0.1, { paged: true }); nav.setFloors([]); nav.setSolids(scene.obstacles);
  const one: TileRect = [0, 0, 0, 0], wide: TileRect = [-1, -1, 1, 0], cut: TileRect = [1, -1, 1, -1];
  const a = nav.gridsOver(one, scene).levels.get(1), built = nav.stats.floorBuilds;
  const b = nav.gridsOver(wide, scene).levels.get(1);
  // the wide window also holds part of the long deck: its floor-1 crop differs, so it is built; a third window holding
  // exactly the house floor shares the first
  const c = nav.gridsOver([0, 0, 0, 1], scene).levels.get(1);
  assert.equal(c, a, 'the same whole floor in another window: shared');
  assert.equal(nav.stats.floorBuilds, built + 1, 'only the window whose crop differs was built');
  for (const [r, g] of [[one, a], [wide, b], [[0, 0, 0, 1] as TileRect, c], [cut, nav.gridsOver(cut, scene).levels.get(1)]] as [TileRect, LevelGrid | undefined][]) {
    const fresh = new GroundNav(flat, 0.1, { paged: true }); fresh.setFloors([]); fresh.setSolids(scene.obstacles);
    sameGrid(g, fresh.gridsOver(r, scene).levels.get(1), `window ${r}`);
  }
});
