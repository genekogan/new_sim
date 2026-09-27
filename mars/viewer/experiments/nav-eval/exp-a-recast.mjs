// Experiment A: recast-navigation-js on the synthetic proving ground + real campus.glb.
// Run: node exp-a-recast.mjs [--skip-campus]
import { init, Raw, NavMeshQuery, QueryFilter, Crowd, exportNavMesh, getNavMeshPositionsAndIndices, setRandomSeed, statusToReadableString } from '@recast-navigation/core';
import { generateSoloNavMesh, generateTiledNavMesh, generateTileCache } from '@recast-navigation/generators';
import { makeProvingGround, P, DECK } from './lib/proving-ground.mjs';
import { loadCampus } from './lib/campus.mjs';
import { now, time, bench, sha, r2, r3, v, pathLen, penetrations, save, mem, mb } from './lib/util.mjs';

const R = { env: { node: process.version, arch: process.arch }, proving: {}, campus: {} };
const log = (...a) => console.log(...a);

let t = now();
await init();
R.initMs = r2(now() - t);
const heap = () => mb(Raw.Module.HEAPU8?.length ?? 0);
log('init', R.initMs, 'ms; wasm heap', heap(), 'MB');

const cfg = ({ cs = 0.1, ch = 0.05, radius = 0.3, height = 1.8, climb = 0.2, tileSize } = {}) => ({
  cs, ch,
  walkableSlopeAngle: 45,
  walkableHeight: Math.ceil(height / ch),
  walkableClimb: Math.floor(climb / ch + 1e-6),
  walkableRadius: Math.ceil(radius / cs - 1e-6),
  maxEdgeLen: Math.round(12 / cs),
  maxSimplificationError: 1.3,
  minRegionArea: 64,
  mergeRegionArea: 400,
  maxVertsPerPoly: 6,
  detailSampleDist: Math.max(1, cs * 6), // < 0.9 crashes wasm (memory OOB) instead of erroring
  detailSampleMaxError: 0.1,
  ...(tileSize ? { tileSize } : {}),
});

function stats(navMesh) {
  let polys = 0, tiles = 0;
  for (let i = 0; i < navMesh.getMaxTiles(); i++) {
    const h = navMesh.getTile(i).header();
    if (h) { polys += h.polyCount(); tiles++; }
  }
  const bytes = exportNavMesh(navMesh);
  return { polys, tiles, bytes: bytes.length, hash: sha(bytes) };
}

const HE = { x: 0.5, y: 0.5, z: 0.5 }; // Y extent < floor separation (2.88 m)
function route(q, a, b, filter) {
  const [res, ms] = time(() => q.computePath(v(a), v(b), { halfExtents: HE, ...(filter ? { filter } : {}) }));
  const pts = res.path || [];
  const last = pts[pts.length - 1];
  const reached = !!last && Math.hypot(last.x - b[0], last.y - b[1], last.z - b[2]) < 0.35;
  return { success: res.success, reached, error: res.error?.name, n: pts.length, len: r2(pathLen(pts)), ms: r3(ms), pts, maxY: r2(Math.max(...pts.map((p) => p.y), -9)) };
}
const brief = ({ pts, ...r }) => r;

function provingTests(navMesh, pg, label) {
  const q = new NavMeshQuery(navMesh);
  const out = {};
  const w = route(q, P.wallStart, P.wallEnd);
  out.wall = { ...brief(w), straight: 6, hits: penetrations(w.pts, pg.boxes), hitsGrown: penetrations(w.pts, pg.boxes, { grow: 0.25 }) };
  const u = route(q, P.uStart, P.uEnd);
  out.uTrap = { ...brief(u), hits: penetrations(u.pts, pg.boxes) };
  const np = route(q, P.passSouth, P.passNorth);
  out.narrow = { ...brief(np), hits: penetrations(np.pts, pg.boxes) };
  // multi-level: same XZ, different floors
  const nearTop = q.findNearestPoly(v(P.topA), { halfExtents: HE });
  const nearUnder = q.findNearestPoly(v(P.underA), { halfExtents: HE });
  const nearTopBig = q.findNearestPoly(v(P.topA), { halfExtents: { x: 1, y: 4, z: 1 } });
  out.nearest = { topY: r2(nearTop.nearestPoint.y), underY: r2(nearUnder.nearestPoint.y), topYWithTallExtents: r2(nearTopBig.nearestPoint.y) };
  const up = route(q, P.underA, P.topA);
  const onStair = up.pts.some((p) => p.x < -10); // deck is x in [-10,0]; stair is west of it
  out.underToTop = { ...brief(up), usesStair: onStair, hits: penetrations(up.pts, pg.boxes) };
  const down = route(q, P.topA2, P.underA2);
  out.topToUnder = { ...brief(down), usesStair: down.pts.some((p) => p.x < -10) };
  out.groundToTopA = brief(route(q, P.groundW, P.topA));
  out.groundToTopB_brokenStair = brief(route(q, P.groundW, P.topB));
  // area flags: disable stair A polys at query time
  const sa = pg.A.stair;
  const cx = (sa[0] + sa[1]) / 2, cz = (sa[2] + sa[3]) / 2;
  const { polyRefs } = q.queryPolygons({ x: cx, y: 1.475, z: cz }, { x: (sa[1] - sa[0]) / 2, y: 1.225, z: 0.6 }, { maxPolys: 256 });
  const DISABLED = 2;
  for (const ref of polyRefs) navMesh.setPolyFlags(ref, navMesh.getPolyFlags(ref).flags | DISABLED);
  const f = new QueryFilter(); f.includeFlags = 0xffff; f.excludeFlags = DISABLED;
  out.flags = { stairPolysFlagged: polyRefs.length, withExclude: brief(route(q, P.groundW, P.topA, f)), defaultFilter: brief(route(q, P.groundW, P.topA)) };
  for (const ref of polyRefs) navMesh.setPolyFlags(ref, navMesh.getPolyFlags(ref).flags & ~DISABLED);
  // determinism of queries
  const p1 = JSON.stringify(route(q, P.uStart, P.uEnd).pts), p2 = JSON.stringify(route(q, P.uStart, P.uEnd).pts);
  out.queryDeterministic = p1 === p2;
  out.perQueryUs = {
    computePathWall: r2(bench(() => q.computePath(v(P.wallStart), v(P.wallEnd), { halfExtents: HE }), 2000) * 1000),
    computePathStairs: r2(bench(() => q.computePath(v(P.underA), v(P.topA), { halfExtents: HE }), 2000) * 1000),
    findNearestPoly: r2(bench(() => q.findNearestPoly(v(P.topA), { halfExtents: HE }), 5000) * 1000),
  };
  q.destroy();
  log(label, JSON.stringify(out));
  return out;
}

// ---------- Proving ground ----------
const pg = makeProvingGround();
R.proving.geometry = { tris: pg.indices.length / 3, boxes: pg.boxes.length };
for (const cs of [0.1, 0.2]) {
  const ch = cs === 0.1 ? 0.05 : 0.1;
  const key = `cs${cs}`;
  R.proving[key] = {};
  // solo
  const h0 = heap();
  let [res, ms] = time(() => generateSoloNavMesh(pg.positions, pg.indices, cfg({ cs, ch })));
  if (!res.success) { log('solo fail', res.error); continue; }
  const s1 = stats(res.navMesh);
  const [res2] = time(() => generateSoloNavMesh(pg.positions, pg.indices, cfg({ cs, ch })));
  const s2 = stats(res2.navMesh);
  R.proving[key].solo = { buildMs: r2(ms), ...s1, deterministicBytes: s1.hash === s2.hash, wasmHeapMB: heap(), heapBeforeMB: h0 };
  R.proving[key].solo.tests = provingTests(res.navMesh, pg, `solo ${key}`);
  res2.navMesh.destroy();
  // tiled
  [res, ms] = time(() => generateTiledNavMesh(pg.positions, pg.indices, cfg({ cs, ch, tileSize: 64 })));
  if (res.success) {
    const st = stats(res.navMesh);
    const again = stats(generateTiledNavMesh(pg.positions, pg.indices, cfg({ cs, ch, tileSize: 64 })).navMesh);
    R.proving[key].tiled = { buildMs: r2(ms), ...st, deterministicBytes: st.hash === again.hash, tests: provingTests(res.navMesh, pg, `tiled ${key}`) };
    res.navMesh.destroy();
  } else R.proving[key].tiled = { error: res.error };
  // off-mesh connection bridging the broken stair B ("ladder"/special link)
  const offMeshConnections = [{ startPosition: v(P.stairBBottom), endPosition: v(P.stairBTop), radius: 0.4, bidirectional: true, area: 0, flags: 1 }];
  const om = generateSoloNavMesh(pg.positions, pg.indices, { ...cfg({ cs, ch }), offMeshConnections });
  if (om.success) {
    const q = new NavMeshQuery(om.navMesh);
    const r = route(q, P.groundW, P.topB);
    R.proving[key].offMesh = { ...brief(r), note: 'straight path jumps from link start to link end' };
    q.destroy(); om.navMesh.destroy();
  }
  res.navMesh?.destroy?.();
}

// ---------- TileCache: dynamic obstacles ----------
{
  const c = cfg({ cs: 0.1, ch: 0.05, tileSize: 48 });
  let [tc, ms] = time(() => generateTileCache(pg.positions, pg.indices, { ...c, expectedLayersPerTile: 4, maxObstacles: 256 }));
  if (!tc.success) log('tilecache fail', tc.error);
  const { tileCache, navMesh } = tc;
  const st = stats(navMesh);
  const tc2 = generateTileCache(pg.positions, pg.indices, { ...c, expectedLayersPerTile: 4, maxObstacles: 256 });
  const T = { buildMs: r2(ms), ...st, deterministicBytes: st.hash === stats(tc2.navMesh).hash, wasmHeapMB: heap() };
  T.tests = provingTests(navMesh, pg, 'tilecache');
  const q = new NavMeshQuery(navMesh);
  const flush = () => { let n = 0, s = now(); for (;;) { const u = tileCache.update(navMesh); n++; if (u.upToDate || n > 100) break; } return [n, now() - s]; };
  // 1) obstacle across the open route between groundW and a point east -> detour
  const a = [-25, 0, 20], b = [-25, 0, 28];
  const before = route(q, a, b);
  let s = now();
  const ob = tileCache.addBoxObstacle({ x: -25, y: 0, z: 24 }, { x: 3, y: 1.2, z: 0.1 }, 0);
  const addMs = now() - s;
  const [iters, updMs] = flush();
  const after = route(q, a, b);
  s = now(); tileCache.removeObstacle(ob.obstacle); const [iters2, updMs2] = flush(); const remMs = now() - s;
  const restored = route(q, a, b);
  // 2) plug the narrow corridor -> route must fail (partial), then reopen
  const plug = tileCache.addBoxObstacle({ x: 20, y: 0, z: -20 }, { x: 0.6, y: 1.2, z: 0.3 }, 0);
  flush();
  const plugged = route(q, P.passSouth, P.passNorth);
  tileCache.removeObstacle(plug.obstacle); flush();
  const reopened = route(q, P.passSouth, P.passNorth);
  // 3) rotated box obstacle (angle) blocking stair A approach
  const rot = tileCache.addBoxObstacle({ x: -15.5, y: 0, z: 10 }, { x: 1.2, y: 1.2, z: 0.1 }, Math.PI / 2);
  flush();
  const stairBlocked = route(q, P.groundW, P.topA);
  tileCache.removeObstacle(rot.obstacle); flush();
  // update cost scaling: 20 obstacles at once
  const obs = [];
  s = now();
  for (let i = 0; i < 20; i++) obs.push(tileCache.addBoxObstacle({ x: -28 + i * 2.8, y: 0, z: 25 }, { x: 0.5, y: 1, z: 0.5 }, 0));
  const [it20, upd20] = flush();
  const total20 = now() - s;
  for (const o of obs) tileCache.removeObstacle(o.obstacle);
  flush();
  T.dynamic = {
    detour: { beforeLen: before.len, afterLen: after.len, afterReached: after.reached, restoredLen: restored.len, addCallMs: r3(addMs), updateIters: iters, updateMs: r2(updMs), removeUpdateMs: r2(remMs), removeIters: iters2, removeUpdMs: r2(updMs2) },
    corridorPlug: { pluggedReached: plugged.reached, pluggedEnd: plugged.pts.at(-1), reopenedReached: reopened.reached },
    rotatedObstacleOnStair: { reached: stairBlocked.reached, len: stairBlocked.len },
    twentyObstacles: { iters: it20, updateMs: r2(upd20), totalMs: r2(total20) },
  };
  log('tilecache dynamic', JSON.stringify(T.dynamic));
  R.proving.tileCache = T;
  // TileCache + off-mesh connections: not exposed by generateTileCache config -> note
  q.destroy();
}

// ---------- Wide agent ----------
{
  const wide = generateSoloNavMesh(pg.positions, pg.indices, cfg({ radius: 0.8 }));
  const narrow = generateSoloNavMesh(pg.positions, pg.indices, cfg({ radius: 0.3 }));
  const qw = new NavMeshQuery(wide.navMesh), qn = new NavMeshQuery(narrow.navMesh);
  R.proving.wideAgent = {
    narrowMesh_passage: brief(route(qn, P.passSouth, P.passNorth)).reached,
    wideMesh_passage: brief(route(qw, P.passSouth, P.passNorth)).reached,
    wideMesh_stairA: brief(route(qw, P.groundW, P.topA)).reached,
    wideMesh_uTrap: brief(route(qw, P.uStart, P.uEnd)).reached,
    widePolys: stats(wide.navMesh).polys,
    note: 'navmesh is pre-eroded by walkableRadius; a 0.8 m agent on the 0.3 m mesh would be routed through the 1.0 m corridor. One navmesh per radius class.',
  };
  log('wide', JSON.stringify(R.proving.wideAgent));
  qw.destroy(); qn.destroy(); wide.navMesh.destroy(); narrow.navMesh.destroy();
}

// ---------- Crowd: two agents meet in a passage ----------
function crowdRun(passage, seconds = 90) {
  const g = makeProvingGround({ passage });
  const { navMesh } = generateSoloNavMesh(g.positions, g.indices, cfg());
  const crowd = new Crowd(navMesh, { maxAgents: 8, maxAgentRadius: 0.8 });
  const params = { radius: 0.3, height: 1.8, maxAcceleration: 8, maxSpeed: 1.4, collisionQueryRange: 3, pathOptimizationRange: 9, separationWeight: 2 };
  const A = crowd.addAgent(v(P.passSouth), params), B = crowd.addAgent(v(P.passNorth), params);
  A.requestMoveTarget(v(P.passNorth)); B.requestMoveTarget(v(P.passSouth));
  const dt = 1 / 30;
  let minSep = 1e9, arrivedA = null, arrivedB = null, stuck = 0, maxStuck = 0, flipsA = 0, prevVxA = 0, frames = 0;
  const trace = [];
  const s = now();
  for (let i = 0; i < seconds / dt; i++) {
    crowd.update(dt);
    frames++;
    const pa = A.position(), pb = B.position(), va = A.velocity(), vb = B.velocity();
    minSep = Math.min(minSep, Math.hypot(pa.x - pb.x, pa.z - pb.z));
    const tt = i * dt;
    if (arrivedA === null && Math.hypot(pa.x - P.passNorth[0], pa.z - P.passNorth[2]) < 0.5) arrivedA = r2(tt);
    if (arrivedB === null && Math.hypot(pb.x - P.passSouth[0], pb.z - P.passSouth[2]) < 0.5) arrivedB = r2(tt);
    const slow = Math.hypot(va.x, va.z) < 0.05 && Math.hypot(vb.x, vb.z) < 0.05 && (arrivedA === null || arrivedB === null);
    stuck = slow ? stuck + dt : 0; maxStuck = Math.max(maxStuck, stuck);
    // oscillation proxy: sign flips of A's along-corridor velocity (z) while not arrived
    if (arrivedA === null && Math.abs(va.z) > 0.1) { if (prevVxA && Math.sign(va.z) !== Math.sign(prevVxA)) flipsA++; prevVxA = va.z; }
    if (i % 30 === 0) trace.push([r2(tt), r2(pa.x), r2(pa.z), r2(pb.x), r2(pb.z)]);
    if (arrivedA !== null && arrivedB !== null) break;
  }
  const ms = now() - s;
  const res = { passage, arrivedA, arrivedB, minSep: r2(minSep), maxBothStuckS: r2(maxStuck), dirFlipsA: flipsA, simMsPerStep: r3(ms / frames), trace: trace.slice(0, 40) };
  crowd.destroy(); navMesh.destroy();
  return res;
}
R.proving.crowd = { p1_0: crowdRun(1.0), p2_0: crowdRun(2.0) };
log('crowd', JSON.stringify({ a: { ...R.proving.crowd.p1_0, trace: undefined }, b: { ...R.proving.crowd.p2_0, trace: undefined } }));

// ---------- Real campus ----------
if (!process.argv.includes('--skip-campus')) {
  for (const [subset, kind, cs, tileSize] of [['chiba', 'solo', 0.1], ['chiba', 'tiled', 0.1, 64], ['chiba', 'tilecache', 0.1, 48], ['all', 'tiled', 0.2, 64], ['all', 'tiled', 0.1, 64]]) {
    const geo = await loadCampus({ subset });
    const ch = cs === 0.1 ? 0.05 : 0.1;
    const c = cfg({ cs, ch, tileSize });
    const h0 = heap(), m0 = mem();
    let res, ms;
    try {
      if (kind === 'solo') [res, ms] = time(() => generateSoloNavMesh(geo.positions, geo.indices, c));
      else if (kind === 'tiled') [res, ms] = time(() => generateTiledNavMesh(geo.positions, geo.indices, c));
      else [res, ms] = time(() => generateTileCache(geo.positions, geo.indices, { ...c, expectedLayersPerTile: 8, maxObstacles: 512 }));
    } catch (e) { R.campus[`${subset}-${kind}-cs${cs}`] = { error: String(e) }; log(subset, kind, 'threw', e); continue; }
    const key = `${subset}-${kind}-cs${cs}`;
    if (!res.success) { R.campus[key] = { error: res.error, buildMs: r2(ms) }; log(key, 'FAIL', res.error); continue; }
    const st = stats(res.navMesh);
    // walkable area by height band -> multi-level evidence
    const [np, ni] = getNavMeshPositionsAndIndices(res.navMesh);
    const bands = {};
    for (let i = 0; i < ni.length; i += 3) {
      const [a, b, cc] = [ni[i], ni[i + 1], ni[i + 2]].map((k) => [np[k * 3], np[k * 3 + 1], np[k * 3 + 2]]);
      const area = Math.abs((b[0] - a[0]) * (cc[2] - a[2]) - (cc[0] - a[0]) * (b[2] - a[2])) / 2;
      const y = Math.round(((a[1] + b[1] + cc[1]) / 3) / 0.5) * 0.5;
      bands[y] = (bands[y] || 0) + area;
    }
    const levelBands = Object.fromEntries(Object.entries(bands).filter(([, a]) => a > 5).sort((x, y) => +x[0] - +y[0]).map(([y, a]) => [y, Math.round(a)]));
    // random path queries
    setRandomSeed(42);
    const q = new NavMeshQuery(res.navMesh);
    const pairs = [];
    for (let i = 0; i < 300; i++) pairs.push([q.findRandomPoint().randomPoint, q.findRandomPoint().randomPoint]);
    let ok = 0, reached = 0, total = 0;
    const s = now();
    for (const [a, b] of pairs) {
      const r = q.computePath(a, b, { halfExtents: HE });
      if (r.success) ok++;
      const l = r.path.at(-1);
      if (l && Math.hypot(l.x - b.x, l.y - b.y, l.z - b.z) < 0.35) reached++;
      total += r.path.length;
    }
    const perPath = (now() - s) / pairs.length;
    R.campus[key] = {
      tris: geo.tris, verts: geo.verts, buildMs: r2(ms), ...st, wasmHeapMB: heap(), wasmHeapBeforeMB: h0, rssMB: mem().rssMB, rssBeforeMB: m0.rssMB,
      walkableM2ByHeight: levelBands, randomPaths: { n: pairs.length, success: ok, reachedTarget: reached, avgCorners: r2(total / pairs.length), avgMs: r3(perPath) },
    };
    if (kind === 'tilecache') {
      const { tileCache, navMesh } = res;
      const pts = [q.findRandomPoint().randomPoint];
      const t0 = now();
      const o = tileCache.addBoxObstacle(pts[0], { x: 3, y: 1.5, z: 0.1 }, 0.3);
      let n = 0; for (;;) { n++; if (tileCache.update(navMesh).upToDate || n > 200) break; }
      R.campus[key].obstacleAddUpdateMs = r2(now() - t0);
      R.campus[key].obstacleUpdateIters = n;
      tileCache.removeObstacle(o.obstacle);
    }
    log(key, JSON.stringify(R.campus[key]));
    q.destroy();
    res.navMesh.destroy();
    res.tileCache?.destroy();
  }
}
R.finalWasmHeapMB = heap();
save('exp-a-recast.json', R);
log('saved out/exp-a-recast.json');
