// Engine P4 (Eden 2026 capabilities freeze): a paged window's upper floors are rasterised over their own surfaces only
// (grid.ts buildGridsOverFloors). That must be bit-identical to the full buildGrids — same `free` bytes, `clearance`
// float32 bits and `blockers` (entries and first-cover ids) — on random multi-level scenes: rotated floors, floors past
// the window edge, a level with no floor in the window, obstacles in and out of the body band.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGrids, buildGridsOverFloors, type GridSet } from '../spatial/grid.ts';
import type { Level, Obstacle, SpatialScene, Surface } from '../spatial/types.ts';
import { seedRng, nextRandom } from '../core/rng.ts';

/** L1: each level of `a` (buildGridsOverFloors) is a crop of `b`'s level (buildGrids) on the same global lattice: every
 *  cell of `b` reads the same through `a` (free, clearance bits, first-cover blocker), and a cell outside the crop is
 *  blocked with no floor in `b` (free 0, clearance 0, no blocker) — what cellOf −1 reads. */
function assertSameGrids(a: GridSet, b: GridSet, what: string) {
  assert.equal(a.cell, b.cell, `${what}: cell`);
  assert.deepEqual([...a.levels.keys()], [...b.levels.keys()], `${what}: level order`);
  for (const [id, ga] of a.levels) {
    const gb = b.levels.get(id)!;
    for (const k of ['level', 'y', 'cell'] as const) assert.equal(ga[k], gb[k], `${what}: level ${id} ${k}`);
    assert.ok(ga.nx * ga.nz <= Math.max(1, gb.nx * gb.nz), `${what}: level ${id} crop no bigger than the window`);
    const bitsA = new Uint32Array(ga.clearance.buffer, ga.clearance.byteOffset, ga.clearance.length);
    const bitsB = new Uint32Array(gb.clearance.buffer, gb.clearance.byteOffset, gb.clearance.length);
    let inCrop = 0;
    for (let j = 0; j < gb.nz; j++) for (let i = 0; i < gb.nx; i++) {
      const kb = j * gb.nx + i, ia = gb.ox + i - ga.ox, ja = gb.oz + j - ga.oz, inside = ia >= 0 && ja >= 0 && ia < ga.nx && ja < ga.nz;
      if (!inside) { assert.ok(gb.free[kb] === 0 && gb.clearance[kb] === 0 && !gb.blockers.has(kb), `${what}: level ${id} cell ${i},${j} outside the crop is open in buildGrids`); continue; }
      const ka = ja * ga.nx + ia; inCrop++;
      if (ga.free[ka] !== gb.free[kb] || bitsA[ka] !== bitsB[kb] || ga.blockers.get(ka) !== gb.blockers.get(kb)) assert.fail(`${what}: level ${id} cell ${i},${j} differs (free ${ga.free[ka]}/${gb.free[kb]}, clearance ${ga.clearance[ka]}/${gb.clearance[kb]}, blocker ${ga.blockers.get(ka)}/${gb.blockers.get(kb)})`);
    }
    // every crop cell lies in the window (a level with no floor here is one blocked cell)
    if (ga.nx * ga.nz > 1) assert.equal(inCrop, ga.nx * ga.nz, `${what}: level ${id} crop inside the window`);
    else assert.ok(ga.free[0] === 0 && ga.clearance[0] === 0, `${what}: level ${id} empty level is blocked`);
  }
}

function randomScene(rand: () => number): { scene: SpatialScene; cell: number } {
  const w = 20 + rand() * 60, d = 20 + rand() * 60, x0 = (rand() - 0.5) * 200, z0 = (rand() - 0.5) * 200;
  const bounds: [number, number, number, number] = [x0, z0, x0 + w, z0 + d];
  const cell = rand() < 0.75 ? 0.1 : 0.25;
  const levels: Level[] = [], surfaces: Surface[] = [], obstacles: Obstacle[] = [];
  const nLevels = 1 + Math.floor(rand() * 4);
  for (let l = 0; l < nLevels; l++) {
    const id = l + 1, y = 2.5 + l * 3;
    levels.push({ id, y, label: `floor ${id}` });
    // 0–4 floors per level (0: the level has no floor in this window), some past the edge, some rotated
    const n = Math.floor(rand() * 5);
    for (let k = 0; k < n; k++) {
      const c: [number, number] = [x0 - 5 + rand() * (w + 10), z0 - 5 + rand() * (d + 10)];
      surfaces.push({ id: `s${id}-${k}`, level: id, y, obb: { c, half: [1 + rand() * 6, 1 + rand() * 6], yaw: rand() < 0.4 ? rand() * Math.PI : 0 } });
    }
  }
  const nObs = Math.floor(rand() * 40);
  for (let k = 0; k < nObs; k++) {
    const y0 = rand() * 12, y1 = y0 + 0.1 + rand() * 4;
    const c: [number, number] = [x0 - 5 + rand() * (w + 10), z0 - 5 + rand() * (d + 10)];
    // ids repeat sometimes: the first cover names the cell, in list order
    obstacles.push({ id: `o${k % 30}`, obb: { c, half: [0.05 + rand() * 4, 0.05 + rand() * 4], yaw: rand() < 0.5 ? 0 : rand() * Math.PI }, y0, y1, kind: 'component' });
  }
  return { scene: { bounds, levels, surfaces, obstacles, links: [] }, cell };
}

test('buildGridsOverFloors is bit-identical to buildGrids on random multi-level scenes', () => {
  const rng = seedRng('grid-floor-crop');
  const rand = () => nextRandom(rng);
  for (let s = 0; s < 60; s++) {
    const { scene, cell } = randomScene(rand);
    assertSameGrids(buildGridsOverFloors(scene, cell), buildGrids(scene, cell), `scene ${s}`);
  }
});

test('a floor touching the window edge and a window with no floors at all', () => {
  const bounds: [number, number, number, number] = [0, 0, 64, 64];
  const scene: SpatialScene = { bounds, levels: [{ id: 1, y: 3, label: 'a' }, { id: 2, y: 6, label: 'b' }], links: [],
    surfaces: [{ id: 'edge', level: 1, y: 3, obb: { c: [0, 32], half: [4, 4], yaw: 0 } }, { id: 'corner', level: 1, y: 3, obb: { c: [64, 64], half: [3, 3], yaw: 0.3 } }],
    obstacles: [{ id: 'wall', obb: { c: [1, 32], half: [0.1, 3], yaw: 0 }, y0: 3, y1: 6, kind: 'component' }] };
  assertSameGrids(buildGridsOverFloors(scene, 0.1), buildGrids(scene, 0.1), 'edges');
  const g2 = buildGridsOverFloors(scene, 0.1).levels.get(2)!;
  assert.equal(g2.free.some((v) => v), false, 'a level without floors here is all blocked');
});
