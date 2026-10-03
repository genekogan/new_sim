// Experiment A2: bespoke engine/spatial planner vs Recast on the SAME scene
// (viewer/engine/scenes/proving-ground.ts), same queries as engine/test/navigation.test.ts.
// Run: node exp-a2-same-scene.mjs   (Node >= 23.6 strips TS types natively)
import { init, NavMeshQuery } from '@recast-navigation/core';
import { generateSoloNavMesh, generateTileCache } from '@recast-navigation/generators';
import { provingGround, DECK_Y } from '../../engine/scenes/proving-ground.ts';
import { buildGrids, segmentClearance } from '../../engine/spatial/grid.ts';
import { findRoute } from '../../engine/spatial/path.ts';
import { HUMAN_PROFILE } from '../../engine/spatial/types.ts';
import { sceneToMesh } from './lib/scene-to-mesh.mjs';
import { now, time, bench, r2, r3, pathLen, save, sha } from './lib/util.mjs';
import { exportNavMesh } from '@recast-navigation/core';

await init();
const R = HUMAN_PROFILE.radius;
const L = (lv) => (lv === 0 ? 0 : DECK_Y);
const Q = {
  wall: [[0, -18, -15], [0, -12, -15]],
  uTrap: [[0, -15, 12], [0, -15, 20]],
  narrow: [[0, 15, -20], [0, 15, -10]],
  stairOblique: [[0, 3.5, 12.5], [1, 10, 10]],
  deckToBelow: [[1, 8, 8], [0, 8, 5]],
  sameXZ: [[0, 9, 9], [1, 9, 9]],
  brokenBToDeck: [[0, 19.5, 10], [1, 12, 10]],
  long: [[0, -28, -28], [1, 13, 12]],
};
const cfg = (radius = R, cs = 0.1, ch = 0.05, extra = {}) => ({
  cs, ch, walkableSlopeAngle: 45, walkableHeight: Math.ceil(1.8 / ch), walkableClimb: Math.floor(0.22 / ch + 1e-6),
  walkableRadius: Math.ceil(radius / cs - 1e-6), maxEdgeLen: 120, maxSimplificationError: 1.3, minRegionArea: 64, mergeRegionArea: 400,
  maxVertsPerPoly: 6, detailSampleDist: 1, detailSampleMaxError: 0.1, ...extra,
});

const out = { scene: 'engine/scenes/proving-ground.ts', bespoke: {}, recast: {} };

// ---- bespoke
const scene = provingGround();
const gms = [];
let grids;
for (let i = 0; i < 5; i++) { const t = now(); grids = buildGrids(scene, 0.1); gms.push(now() - t); }
out.bespoke.gridBuildMs = { first: r2(gms[0]), median: r2(gms.sort((a, b) => a - b)[2]) };
for (const [k, [a, b]] of Object.entries(Q)) {
  const run = () => findRoute(grids, scene, HUMAN_PROFILE, { level: a[0], p: [a[1], a[2]] }, { level: b[0], p: [b[1], b[2]] });
  const r = run();
  const ms = bench(run, 5);
  out.bespoke[k] = r.ok ? { ok: true, len: r2(r.route.length), legs: r.route.legs.map((l) => l.kind === 'link' ? l.link.id : `walk${l.points.length}`).join('>'), expanded: r.route.expanded, ms: r2(ms) } : { ok: false, code: r.diagnostic.code, ms: r2(ms) };
}
// construction: panel into the gap -> full grid rebuild + replan
{
  const t = now();
  const s2 = provingGround({ extra: [{ id: 'new-panel', obb: { c: [15, -15], half: [0.6, 0.1], yaw: 0 }, y0: 0, y1: 2.4, kind: 'component' }] });
  const g2 = buildGrids(s2, 0.1);
  const r = findRoute(g2, s2, HUMAN_PROFILE, { level: 0, p: [15, -20] }, { level: 0, p: [15, -10] });
  out.bespoke.constructionPanel = { rebuildPlusReplanMs: r2(now() - t), ok: r.ok, len: r.ok ? r2(r.route.length) : null };
}

// ---- recast on the same scene
const clearanceOf = (pts) => { // min clearance of Recast straight path, measured on the bespoke grids
  let m = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const lv = a.y > DECK_Y - 0.3 && b.y > DECK_Y - 0.3 ? 1 : a.y < 0.3 && b.y < 0.3 ? 0 : -1;
    if (lv < 0) continue; // on stairs
    m = Math.min(m, segmentClearance(grids.levels.get(lv), [a.x, a.z], [b.x, b.z]));
  }
  return r3(m);
};
function recastSuite(navMesh, label) {
  const q = new NavMeshQuery(navMesh);
  const res = {};
  for (const [k, [a, b]] of Object.entries(Q)) {
    const A = { x: a[1], y: L(a[0]), z: a[2] }, B = { x: b[1], y: L(b[0]), z: b[2] };
    const call = () => q.computePath(A, B, { halfExtents: { x: 0.5, y: 0.5, z: 0.5 } });
    const r = call();
    const last = r.path.at(-1);
    const reached = !!last && Math.hypot(last.x - B.x, last.y - B.y, last.z - B.z) < 0.4;
    res[k] = { success: r.success, reached, len: r2(pathLen(r.path)), corners: r.path.length, minClearanceOnBespokeGrid: r.path.length ? clearanceOf(r.path) : null, us: r2(bench(call, 500) * 1000) };
  }
  q.destroy();
  console.log(label, JSON.stringify(res));
  return res;
}
const mesh = sceneToMesh(scene);
out.recast.meshTris = mesh.indices.length / 3;
for (const cs of [0.1, 0.05]) {
  const ch = cs / 2;
  const [r, ms] = time(() => generateSoloNavMesh(mesh.positions, mesh.indices, cfg(R, cs, ch)));
  const [r2b] = time(() => generateSoloNavMesh(mesh.positions, mesh.indices, cfg(R, cs, ch)));
  out.recast[`solo_cs${cs}`] = r.success ? { buildMs: r2(ms), deterministic: sha(exportNavMesh(r.navMesh)) === sha(exportNavMesh(r2b.navMesh)), queries: recastSuite(r.navMesh, `solo cs${cs}`) } : { error: r.error };
}
// radius 0.6 (bespoke handles per query; Recast needs another mesh)
{
  const [r, ms] = time(() => generateSoloNavMesh(mesh.positions, mesh.indices, cfg(0.6)));
  const q = new NavMeshQuery(r.navMesh);
  const p = q.computePath({ x: 15, y: 0, z: -20 }, { x: 15, y: 0, z: -10 }, { halfExtents: { x: 0.5, y: 0.5, z: 0.5 } });
  out.recast.wide06 = { buildMs: r2(ms), narrowLen: r2(pathLen(p.path)) };
  const wb = findRoute(grids, scene, { ...HUMAN_PROFILE, radius: 0.6 }, { level: 0, p: [15, -20] }, { level: 0, p: [15, -10] });
  out.bespoke.wide06 = { ok: wb.ok, len: wb.ok ? r2(wb.route.length) : null };
}
// construction: TileCache obstacle vs full rebuild
{
  const [tc, ms] = time(() => generateTileCache(mesh.positions, mesh.indices, { ...cfg(R), tileSize: 48, expectedLayersPerTile: 4, maxObstacles: 128 }));
  const q = new NavMeshQuery(tc.navMesh);
  const t = now();
  tc.tileCache.addBoxObstacle({ x: 15, y: 0, z: -15 }, { x: 0.6, y: 1.2, z: 0.1 }, 0);
  let n = 0; while (!tc.tileCache.update(tc.navMesh).upToDate && n < 100) n++;
  const p = q.computePath({ x: 15, y: 0, z: -20 }, { x: 15, y: 0, z: -10 }, { halfExtents: { x: 0.5, y: 0.5, z: 0.5 } });
  out.recast.tileCache = { buildMs: r2(ms), obstacleUpdatePlusReplanMs: r2(now() - t), iters: n + 1, lenAfter: r2(pathLen(p.path)) };
  const s2 = provingGround({ extra: [{ id: 'new-panel', obb: { c: [15, -15], half: [0.6, 0.1], yaw: 0 }, y0: 0, y1: 2.4, kind: 'component' }] });
  const m2 = sceneToMesh(s2);
  const [, rb] = time(() => generateSoloNavMesh(m2.positions, m2.indices, cfg(R)));
  out.recast.soloFullRebuildMs = r2(rb);
}
// incomplete stairs both: recast must be unreachable
{
  const s3 = provingGround({ stairsAUsable: false, stairsBUsable: false });
  const m3 = sceneToMesh(s3);
  const r = generateSoloNavMesh(m3.positions, m3.indices, cfg(R));
  const q = new NavMeshQuery(r.navMesh);
  const p = q.computePath({ x: 0, y: 0, z: 0 }, { x: 10, y: DECK_Y, z: 10 }, { halfExtents: { x: 0.5, y: 0.5, z: 0.5 } });
  const last = p.path.at(-1);
  out.recast.bothStairsBroken = { success: p.success, error: p.error?.name, reachedDeck: !!last && last.y > DECK_Y - 0.3 };
  const b = findRoute(buildGrids(s3, 0.1), s3, HUMAN_PROFILE, { level: 0, p: [0, 0] }, { level: 1, p: [10, 10] });
  out.bespoke.bothStairsBroken = { ok: b.ok, code: b.ok ? null : b.diagnostic.code, message: b.ok ? null : b.diagnostic.message };
}
console.log(JSON.stringify(out.bespoke, null, 1));
console.log(JSON.stringify({ ...out.recast, solo_cs0_1: undefined, solo_cs0_05: undefined }, null, 1));
save('exp-a2-same-scene.json', out);
