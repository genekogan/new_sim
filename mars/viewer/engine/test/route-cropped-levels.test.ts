// L1 (Eden 2026 memory): a paged window's upper floors are now grids over their own floors (grid.ts buildGridsOverFloors),
// and route searches index each level's own cells (path.ts layout). Routes must not change: on random multi-level scenes
// with stairs, findRoute over the cropped levels gives exactly the result over full-window levels — legs, points,
// lengths, expansions, and failures with the same codes, messages and subjects — for the exact and corridor planners,
// with people-named failures and the reverse-flood proof on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGrids, buildGridsOverFloors, type GridSet } from '../spatial/grid.ts';
import { findRoute, type RouteOpts } from '../spatial/path.ts';
import { HUMAN_PROFILE, type Level, type Link, type Obstacle, type SpatialScene, type Surface } from '../spatial/types.ts';
import { seedRng, nextRandom } from '../core/rng.ts';

function scene(rand: () => number): SpatialScene {
  const x0 = (rand() - 0.5) * 100, z0 = (rand() - 0.5) * 100, w = 40 + rand() * 30, d = 40 + rand() * 30;
  const levels: Level[] = [{ id: 0, y: 0, label: 'ground' }], surfaces: Surface[] = [{ id: 'ground', level: 0, y: 0, obb: { c: [x0 + w / 2, z0 + d / 2], half: [w / 2, d / 2], yaw: 0 } }];
  const links: Link[] = [], obstacles: Obstacle[] = [];
  const houses = 1 + Math.floor(rand() * 4);
  let id = 1;
  for (let h = 0; h < houses; h++) {
    const cx = x0 + 8 + rand() * (w - 16), cz = z0 + 8 + rand() * (d - 16), floors = 1 + Math.floor(rand() * 3);
    let below = 0;
    for (let f = 1; f <= floors; f++, id++) {
      const y = f * 3;
      levels.push({ id, y, label: `h${h} floor ${f}` });
      surfaces.push({ id: `h${h}f${f}`, level: id, y, obb: { c: [cx, cz], half: [4 + rand() * 2, 3 + rand() * 2], yaw: 0 } });
      const sx = cx - 2 + rand() * 4;
      links.push({ id: `h${h}s${f}`, kind: 'stairs', from: { level: below, p: [sx, cz - 2], y: y - 3 }, to: { level: id, p: [sx, cz + 1.5], y }, width: 1.2, heading: Math.PI / 2, path: [[sx, y - 3, cz - 2], [sx, y, cz + 1.5]], usable: rand() < 0.9 });
      for (let k = 0; k < 4; k++) obstacles.push({ id: `h${h}f${f}o${k}`, obb: { c: [cx - 4 + rand() * 8, cz - 3 + rand() * 6], half: [0.2 + rand(), 0.2 + rand()], yaw: rand() * 3 }, y0: y, y1: y + 1 + rand(), kind: 'component' });
      below = id;
    }
  }
  for (let k = 0; k < 20; k++) obstacles.push({ id: `g${k}`, obb: { c: [x0 + rand() * w, z0 + rand() * d], half: [0.2 + rand() * 2, 0.2 + rand() * 2], yaw: rand() * 3 }, y0: 0, y1: 1.5, kind: 'component' });
  return { bounds: [x0, z0, x0 + w, z0 + d], levels, surfaces, obstacles, links };
}

test('routes over cropped upper levels equal routes over full-window levels', () => {
  const rng = seedRng('route-cropped-levels'), rand = () => nextRandom(rng);
  let routes = 0, fails = 0, linked = 0;
  for (let s = 0; s < 25; s++) {
    const sc = scene(rand), full = buildGrids(sc, 0.1), crop: GridSet = buildGridsOverFloors({ ...sc, levels: sc.levels.filter((l) => l.id !== 0) }, 0.1);
    crop.levels.set(0, full.levels.get(0)!);
    const cropped: GridSet = { cell: 0.1, levels: new Map([...full.levels.keys()].map((k) => [k, crop.levels.get(k)!])) };
    const fullLv = new Map(full.levels); const fullSet: GridSet = { cell: 0.1, levels: fullLv };
    const pts = sc.surfaces.map((x) => ({ level: x.level, c: x.obb.c, h: x.obb.half }));
    for (let k = 0; k < 12; k++) {
      const a = pts[Math.floor(rand() * pts.length)], b = pts[Math.floor(rand() * pts.length)];
      const at = (p: typeof a) => ({ level: p.level, p: [p.c[0] + (rand() - 0.5) * p.h[0], p.c[1] + (rand() - 0.5) * p.h[1]] as [number, number] });
      const start = at(a), goal = at(b);
      for (const opts of [{}, { planner: 'corridor' }, { proveUnreachable: true, nameObstacles: (id: string) => id.startsWith('g') || id.includes('o') }, { allowUnusableLinks: true }] as RouteOpts[]) {
        const want = findRoute(fullSet, sc, HUMAN_PROFILE, start, goal, opts), got = findRoute(cropped, sc, HUMAN_PROFILE, start, goal, opts);
        assert.deepEqual(got, want, `scene ${s} route ${k} ${JSON.stringify(opts)}`);
        if (want.ok) { routes++; if (want.route.legs.some((l) => l.kind === 'link')) linked++; } else fails++;
      }
    }
  }
  assert.ok(routes > 200 && fails > 20 && linked > 50, `routes ${routes} (${linked} over stairs), failures ${fails}`);
});
