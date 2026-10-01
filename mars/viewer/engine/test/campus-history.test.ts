// Procedural historical years 2020–2025 → engine scenes (spec §21): generated
// files load as protected canonical states with stable Kit ids, grids build,
// walkers route around the 2022 courtyard and through the 2021 corridor, and
// extraction is deterministic (deploy/history-scenes.mjs --check, run twice).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { hashOf } from '../core/hash.ts';
import type { Vec2 } from '../core/math.ts';
import { WorldHistory, HistoryError } from '../history/store.ts';
import { buildGrids, centreOf, clearanceAt, segmentClearance } from '../spatial/grid.ts';
import { findRoute, type WalkLeg } from '../spatial/path.ts';
import { HUMAN_PROFILE, type SpatialScene } from '../spatial/types.ts';
import { HISTORY_YEARS, campusYearId, forkCampusYear, loadCampusYear, publishCampusYear, type CampusYear } from '../campus/history.ts';
import { classifyHistory, historyConfidence } from '../campus/history-extract.ts';
import { loadCampusFile } from '../campus/history-node.ts';
import type { Region } from '../world/types.ts';
import { RULES_VERSION } from '../construction/rules.ts';
import { hypot } from '../core/math.ts';
import type { Vec3 } from '../core/math.ts';
import { DatabaseSync } from 'node:sqlite';
import type { WorldState } from '../world/types.ts';
import { CameraWorld } from '../camera/geom.ts';
import { CameraNavmesh } from '../camera/synth.ts';

const years = new Map<number, CampusYear>(HISTORY_YEARS.map((y) => [y, loadCampusYear(y, loadCampusFile(y))]));
const Y = (y: number) => years.get(y)!;
const reg = (y: number, id: string) => {
  const r = Y(y).base.regions.find((q) => q.id === id);
  assert.ok(r, `${y} region ${id}`);
  return r;
};
const box = (r: Region) => {
  const xs = r.polygon.map((p) => p[0]), zs = r.polygon.map((p) => p[1]);
  return { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) };
};
const asScene = (y: number) => Y(y).base as unknown as SpatialScene;
const ID_RE = /^([a-z0-9-]+-[a-z0-9-]+-[0-9a-f]{8}(-\d+)?|[a-z0-9-]+-(mars-letters|aluminet|flower-mural|entry-sign|solarium-door))$/;

test('each year 2020–2025 loads as a ground-only scene with provenance on every obstacle', () => {
  for (const [y, { base, world }] of years) {
    const f = loadCampusFile(y);
    assert.equal(f.schema, 'mars-campus-scene/1');
    assert.equal(f.campus, campusYearId(y));
    assert.ok(base.obstacles.length > 1000, `${y}: ${base.obstacles.length} obstacles`);
    const seen = new Set<string>();
    for (const o of base.obstacles) {
      assert.ok(!seen.has(o.id), `${y} duplicate obstacle ${o.id}`);
      seen.add(o.id);
      assert.equal(o.provenance.origin, 'canonical');
      assert.ok(['inferred', 'provisional'].includes(o.provenance.confidence), `${y} ${o.id} ${o.provenance.confidence}`);
      assert.ok(o.label && o.y1 > o.y0, `${y} ${o.id}`);
      assert.match(o.component, ID_RE, `${y}: ${o.component}`);
      assert.ok(o.id === o.component || o.id.startsWith(`${o.component}.`), `${y} ${o.id} belongs to ${o.component}`);
    }
    assert.deepEqual(base.levels.map((l) => l.id), [0], `${y}: only the ground level`);
    assert.equal(base.links.length, 0, `${y}: no stairs/links`);
    assert.equal(base.surfaces.length, 1);
    assert.ok(base.regions.some((r) => r.id === 'chiba'), `${y} chiba region`);
    const { contentHash, ...rest } = f;
    assert.equal(hashOf(rest), contentHash, `${y} contentHash self-consistent`);
    assert.equal(world.base.staticHash, contentHash);
    assert.deepEqual(world.entities, {}, `${y}: canonical world has no people or inventory`);
    assert.equal(world.inventory, 'finite');
    assert.ok(world.env.datetime.startsWith(String(y)));
  }
  // The reviewed 2021 scene mixes direct photographed features with still-provisional placements.
  assert.ok(Y(2021).base.obstacles.some((o) => o.provenance.confidence === 'provisional'));
  assert.ok(Y(2021).base.obstacles.some((o) => o.provenance.confidence === 'inferred'));
  assert.ok(Y(2020).base.obstacles.some((o) => o.provenance.confidence === 'inferred'));
  assert.equal(historyConfidence('Photographic fit; dimensions and hidden surfaces remain provisional'), 'provisional');
  assert.equal(historyConfidence('high'), 'inferred');
  const kinds = new Set([...years.values()].flatMap((c) => c.base.obstacles.map((o) => o.kind)));
  for (const k of ['wall', 'solid', 'glass', 'vehicle', 'fixture']) assert.ok(kinds.has(k as never), `kind ${k}`);
  assert.equal(classifyHistory({ kind: 'salvaged glazing', layer: 'Walls and screens', assembly: 'chiba' }).kind, 'glass');
});

test('obstacle ids are the stable Kit ids (pinned names survive)', () => {
  const comps = (y: number) => new Set(Y(y).base.obstacles.map((o) => o.component));
  assert.ok(comps(2021).has('chiba-aluminet'));
  assert.ok(comps(2021).has('chiba-mars-letters'));
  assert.ok(comps(2024).has('chiba-flower-mural'));
  assert.ok(comps(2024).has('chiba-entry-sign'));
  // The source-fitted aluminet drops at both ends but stays overhead (> 2 m) and walk-through: only a `.up` prism, no ground blocker.
  const al = Y(2021).base.obstacles.filter((o) => o.component === 'chiba-aluminet');
  assert.ok(al.length && al.every((o) => o.id.startsWith('chiba-aluminet.up') && o.y0 > 2));
  // hashed ids from the frozen legacy migration table resolve here too (same Kit build)
  assert.ok([...comps(2022)].some((c) => /^kitchen-12-foot-orange-beam-[0-9a-f]{8}$/.test(c)));
});

test('grids build for every year (bounded extent, free and blocked cells, valid clearance)', () => {
  for (const y of HISTORY_YEARS) {
    const scene = asScene(y), g = buildGrids(scene, 0.1).levels.get(0)!;
    assert.equal(g.free.length, g.nx * g.nz);
    assert.equal(g.clearance.length, g.free.length);
    assert.equal(g.cell, 0.1);
    const [x0, z0, x1, z1] = scene.bounds;
    assert.ok(g.x0 <= x0 && g.x0 > x0 - g.cell - 1e-9, `${y}: grid starts at the scene boundary`);
    assert.ok(g.z0 <= z0 && g.z0 > z0 - g.cell - 1e-9);
    assert.ok(g.x0 + g.nx * g.cell >= x1 - 1e-9 && g.x0 + g.nx * g.cell < x1 + g.cell + 1e-9);
    assert.ok(g.z0 + g.nz * g.cell >= z1 - 1e-9 && g.z0 + g.nz * g.cell < z1 + g.cell + 1e-9);
    let free = 0, invalid = 0;
    for (let i = 0; i < g.free.length; i++) {
      if (g.free[i]) free++;
      if (!Number.isFinite(g.clearance[i]) || g.clearance[i] < 0 || (!g.free[i] && g.clearance[i] !== 0)) invalid++;
    }
    assert.ok(free > 0 && free < g.free.length, `${y}: actual free ground and blocked geometry are represented`);
    assert.equal(invalid, 0, `${y}: clearance finite, nonnegative and zero on blocked cells`);
  }
});

const routeLen = (pts: Vec2[]) => pts.slice(1).reduce((s, p, i) => s + hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
const samples = (pts: Vec2[], step = 0.25) => {
  const out: Vec2[] = [];
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]], n = Math.max(1, Math.ceil(hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
};
function route(y: number, a: Vec2, b: Vec2) {
  const grids = buildGrids(asScene(y), 0.1);
  const t0 = performance.now();
  const r = findRoute(grids, asScene(y), HUMAN_PROFILE, { level: 0, p: a }, { level: 0, p: b });
  const ms = performance.now() - t0;
  assert.ok(r.ok, `${y} route ${a} → ${b}: ${r.ok ? '' : r.diagnostic.message}`);
  const legs = r.route.legs.filter((l): l is WalkLeg => l.kind === 'walk');
  const pts = legs.flatMap((l) => l.points);
  const clearance = Math.min(...legs.map((l) => l.minClearance));
  return { grids, pts, len: routeLen(pts), clearance, ms };
}

test('2022: a walker routes around the courtyard buildings (N of chiba → S of kitchen)', () => {
  const n = box(reg(2022, 'chiba')), s = box(reg(2022, 'kitchen'));
  const a: Vec2 = [(n.x0 + n.x1) / 2, n.z0 - 3], b: Vec2 = [(s.x0 + s.x1) / 2, s.z1 + 3];
  const r = route(2022, a, b);
  const g = r.grids.levels.get(0)!;
  assert.ok(segmentClearance(g, a, b) < HUMAN_PROFILE.radius, 'the straight line is blocked by the buildings');
  assert.ok(r.len > hypot(b[0] - a[0], b[1] - a[1]) + 0.5, 'the route detours');
  assert.ok(r.clearance >= 0.28, `clearance ${r.clearance}`);
  // and the courtyard centre is reachable from outside through a corner passage
  const c = route(2022, [0, 0], a);
  assert.ok(c.clearance >= 0.28, `courtyard clearance ${c.clearance}`);
  console.log(`  2022 around courtyard: ${r.len.toFixed(1)} m (straight ${hypot(b[0] - a[0], b[1] - a[1]).toFixed(1)}), clearance ${r.clearance.toFixed(2)}, ${r.ms.toFixed(0)} ms; courtyard→outside ${c.len.toFixed(1)} m, clearance ${c.clearance.toFixed(2)}`);
});

test('2021: a walker goes straight through the corridor between the two long buildings', () => {
  const h = box(reg(2021, 'chiba'));
  const cx = (h.x0 + h.x1) / 2;
  const a: Vec2 = [cx, h.z0 - 3], b: Vec2 = [cx, h.z1 + 3];
  const r = route(2021, a, b);
  const g = r.grids.levels.get(0)!;
  assert.ok(clearanceAt(g, [cx, (h.z0 + h.z1) / 2]) > 1.5, 'the corridor is a wide bare-ground passage');
  assert.ok(r.len < hypot(b[0] - a[0], b[1] - a[1]) + 1.5, `route ${r.len} m should not go around`);
  const inside = samples(r.pts).filter((p) => p[1] > h.z0 + 2 && p[1] < h.z1 - 8);
  assert.ok(inside.length > 20);
  for (const p of inside) assert.ok(Math.abs(p[0] - cx) < 2.29, `(${p[0].toFixed(2)}, ${p[1].toFixed(2)}) left the 4.57 m corridor`);
  assert.ok(r.clearance >= 0.28, `clearance ${r.clearance}`);
  console.log(`  2021 corridor: ${r.len.toFixed(1)} m, clearance ${r.clearance.toFixed(2)}, ${r.ms.toFixed(0)} ms`);
});

test('2021 low terrace shelves block ground walking while high decks remain overhead', () => {
  const scene=Y(2021).base, g=buildGrids(asScene(2021),0.1).levels.get(0)!;
  const decks=scene.obstacles.filter(o=>o.assembly==='chiba'&&o.component.includes('plywood-deck-sheet'));
  const low=decks.filter(o=>o.y0>.25&&o.y0<g.y+HUMAN_PROFILE.height-.01);
  assert.ok(low.some(o=>o.obb.c[0]<0)&&low.some(o=>o.obb.c[0]>0),'both wings have low shelves');
  for(const deck of low)assert.equal(clearanceAt(g,deck.obb.c),0,`${deck.component}: low shelf blocks`);
  assert.ok(decks.some(o=>o.y0>2&&o.id.includes('.up')),'tall platforms are overhead geometry');
  // The former 40% ground-blocking target encoded a continuous low deck that the
  // flythrough contradicts. Corridor routing above remains an independent test.
});

test('2023 upper west sheet cuts do not mutate shared ground deck geometry', () => {
  const decks=Y(2023).base.obstacles.filter(o=>o.assembly==='chiba'&&o.component.includes('plywood-deck-sheet')&&o.y0<.3);
  assert.equal(decks.length,21,'seven bays retain three ground sheets each');
  for(const deck of decks){
    assert.ok(Math.abs(deck.obb.c[1])<.01,`${deck.component}: ground deck remains centered`);
    assert.ok(Math.abs(deck.obb.half[1]-3.6576)<.01,`${deck.component}: full 24-foot ground depth`);
  }
});

test('building interiors are not walkable (ground-floor decks block)', () => {
  for (const y of [2023, 2025]) {
    const g = buildGrids(asScene(y), 0.25).levels.get(0)!;
    const poly = reg(y, 'chiba').polygon;
    const inside = (p: Vec2) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
        if ((poly[i][1] > p[1]) !== (poly[j][1] > p[1]) && p[0] < ((poly[j][0] - poly[i][0]) * (p[1] - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) c = !c;
      return c;
    };
    let n = 0, blocked = 0;
    for (let c = 0; c < g.nx * g.nz; c++) {
      if (!inside(centreOf(g, c))) continue; // the lattice centre (grid.ts), never hand-computed from x0/z0
      n++;
      if (!g.free[c]) blocked++;
    }
    assert.ok(blocked / n > 0.6, `${y}: only ${((100 * blocked) / n).toFixed(0)}% of Chiba blocks`);
  }
});

test('canonical mars-<year> is protected; edits happen in forks', () => {
  const h = new WorldHistory(RULES_VERSION);
  for (const y of HISTORY_YEARS) {
    const { canonical } = publishCampusYear(h, y, loadCampusFile(y));
    assert.equal(canonical.id, `mars-${y}`);
    assert.ok(canonical.protected);
    const w = h.read(canonical.id);
    assert.throws(() => h.commit(canonical.id, w, { kind: 'design-edit', note: 'try' }), (e: unknown) => e instanceof HistoryError && e.code === 'protected');
  }
  const f = forkCampusYear(h, 2022, 'mars-2022-what-if', 'what if 2022');
  assert.equal(f.protected, false);
  const w = h.read(f.id);
  w.env.datetime = '2022-03-02T10:00';
  h.commit(f.id, w, { kind: 'design-edit', note: 'fork edit' }, 'edit');
  assert.equal(h.read('mars-2022').env.datetime, '2022-03-01T16:00');
});

test('extraction is deterministic: two --check runs match the committed hashes', () => {
  const viewer = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  for (let run = 0; run < 2; run++) {
    const out = execFileSync('node', ['deploy/history-scenes.mjs', '--check'], { cwd: viewer, encoding: 'utf8' });
    for (const y of HISTORY_YEARS) assert.match(out, new RegExp(`${y} deterministic: contentHash matches`), out);
  }
});

// ---- Chiba 2024 front, reconstruction edit of 2026-09-29 (OWNER_FEEDBACK §15; HISTORY_IDS.md "Reconstruction edits") ----
const PRE_EDIT_2024 = 'c542f3fe6c6199d31f0fb5d1f7dcb1937bc7f41b4de990d068d17bcdf0f2bfcc'; // campus-2024.json contentHash before the edit
const EDIT_EVIDENCE = ['docs/engineering/evidence/2024-chiba-facade-front-vertical-inset-stairs-plexiglass.webp', 'docs/engineering/evidence/2024-chiba-solarium-interior-plexiglass-roof.jpg'];
const W2 = (6 * 3.6576) / 2, D2 = (3 * 3.6576) / 2; // Chiba 2024 half-width / half-depth (6 × 3 bays)
const door2024 = () => {
  const jambs = Y(2024).base.obstacles.filter((o) => /^chiba-solarium-door-jamb-[0-9a-f]{8}$/.test(o.id)).map((o) => o.obb.c[1]).sort((a, b) => a - b);
  assert.equal(jambs.length, 2, 'two door jambs');
  return { x: Y(2024).base.obstacles.find((o) => o.id.startsWith('chiba-solarium-door-jamb'))!.obb.c[0], z0: jambs[0] + 0.02, z1: jambs[1] - 0.02 };
};

test('Chiba 2024 edit: untouched pieces keep their ids; replaced pieces are gone; the solarium door is the first door object', () => {
  const comps = new Set(Y(2024).base.obstacles.map((o) => o.component));
  // untouched (same kind + placement): PV on the left flap, the left clear strip, the yellow sliding leaf, pins
  for (const id of ['chiba-photovoltaic-cells-1be2efca', 'chiba-photovoltaic-cells-3ca6e19e', 'chiba-photovoltaic-cells-52b80fd2', 'chiba-salvaged-glazing-bb28cbfd', 'chiba-flower-mural', 'chiba-entry-sign'])
    assert.ok(comps.has(id), `kept ${id}`);
  // replaced by the edit: the leaning frontage sides and the old eye insert
  for (const id of ['chiba-painted-frontage-side-61f2d8e8', 'chiba-painted-frontage-side-6bfae4e1', 'chiba-painted-eye-window-insert-67f917bd']) assert.ok(!comps.has(id), `removed ${id}`);
  const door = Y(2024).base.obstacles.filter((o) => o.component === 'chiba-solarium-door');
  assert.ok(door.length && door.every((o) => o.kind === 'glass' && /plexiglass door/.test(o.label ?? '')));
  const { x, z0, z1 } = door2024();
  assert.ok(Math.abs(x - (W2 + 0.045)) < 0.01 && z1 - z0 > 1.15, `door opening ${z0.toFixed(2)}–${z1.toFixed(2)} at x ${x}`);
  // nothing stands in the opening between the floor and the header (a real gap, for walkers and the camera)
  const inGap = (o: (typeof door)[number]) => o.y0 < 2.1 && o.y1 > 0.3 && Math.abs(o.obb.c[0] - x) < 0.15 + hypot(o.obb.half[0], o.obb.half[1]) && o.obb.c[1] + hypot(o.obb.half[0], o.obb.half[1]) > z0 + 0.05 && o.obb.c[1] - hypot(o.obb.half[0], o.obb.half[1]) < z1 - 0.05;
  const blockers = Y(2024).base.obstacles.filter((o) => inGap(o) && !o.id.startsWith('chiba-solarium-door-jamb')).filter((o) => {
    const scene = { ...asScene(2024), obstacles: [o] } as SpatialScene;
    const g = buildGrids(scene, 0.05).levels.get(0)!;
    return [0.2, 0.4, 0.6, 0.8].some((f) => !g.free[g.nx * Math.round((z0 + f * (z1 - z0) - g.z0) / g.cell) + Math.round((x - g.x0) / g.cell)]);
  });
  assert.deepEqual(blockers.map((o) => o.id), [], 'the solarium doorway is open');
});

test('Chiba 2024 edit: mars-2024 re-seeded — pre-edit canonical + reconstruction-edit checkpoint = the new canonical', () => {
  const f = loadCampusFile(2024);
  assert.notEqual(f.contentHash, PRE_EDIT_2024, 'the edit changed the 2024 static scene');
  const now = loadCampusYear(2024, f).world;
  const pre: WorldState = { ...structuredClone(now), base: { ...now.base, staticHash: PRE_EDIT_2024 } };
  const h = new WorldHistory(RULES_VERSION);
  h.publishCanonical('mars-2024', 'Mars 2024 (before the 2026-09-29 front edit)', pre, 'campus-2024.json before the Chiba front edit');
  assert.throws(() => h.commit('mars-2024', now, { kind: 'reconstruction-edit', note: 'x' }), (e: unknown) => e instanceof HistoryError && e.code === 'protected');
  h.fork('mars-2024', 'mars-2024-chiba-front', 'Chiba 2024 front as photographed');
  const cp = h.commit('mars-2024-chiba-front', now, {
    kind: 'reconstruction-edit',
    note: 'Chiba 2024 front as photographed (2026-09-29): vertical inset with straight stairs, leaning flaps proud of it, plexiglass solarium + end wall with a door',
    evidence: EDIT_EVIDENCE,
  }, 'reconstruction-edit 2026-09-29');
  assert.deepEqual(h.log('mars-2024-chiba-front').map((c) => c.cause.kind), ['reconstruction-edit', 'canonical-publish']);
  // re-seed: publishing the regenerated file gives exactly the edited state, protected again
  const h2 = new WorldHistory(RULES_VERSION);
  const { canonical } = publishCampusYear(h2, 2024, f);
  assert.ok(canonical.protected);
  assert.equal(h2.head('mars-2024').physicalHash, cp.physicalHash);
  assert.equal(hashOf(h2.read('mars-2024')), hashOf(h.read(cp.id)));
});

test('Chiba 2024 edit: the 2024 year room seeds protected mars-2024 from the edited file', async () => {
  const { EngineRoom } = await import('../../simulation/engine-room.ts');
  const db = new DatabaseSync(':memory:');
  const storage = {
    sql: { exec(q: string, ...args: (string | number)[]) { const st = db.prepare(q); const out = /^\s*SELECT/i.test(q) ? st.all(...args) : (st.run(...args), []); return { toArray: () => out }; } },
    transactionSync<T>(fn: () => T): T { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } },
  };
  // oxlint-disable-next-line typescript/no-explicit-any -- tool results are untyped JSON
  const room = new EngineRoom(storage as never, {}, loadCampusFile) as unknown as { call(y: number, t: string, a: object): any };
  const q = room.call(2024, 'query_world', { workspace: 'mars-2024', include: ['regions'] });
  assert.equal(q.protected, true);
  assert.equal(q.entityCount, 0);
  assert.ok((room.call(2024, 'query_world', {}).workspaces as { id: string }[]).some((w) => w.id === 'mars-2024'));
});

test('Chiba 2024 edit: walkers and the camera navmesh pass the solarium door; the hall interior still blocks', () => {
  const { x, z0, z1 } = door2024();
  const zm = (z0 + z1) / 2;
  // walkers: outside → solarium floor (sand, ground level) through the door
  const w = route(2024, [x + 3, zm], [x - 2.5, zm]);
  const crossing = samples(w.pts, 0.05).filter((p) => Math.abs(p[0] - x) < 0.05);
  assert.ok(crossing.length && crossing.every((p) => p[1] > z0 && p[1] < z1), 'walker crosses the end wall only in the doorway');
  // the hall's ground-floor deck footprint (behind the frame front) still blocks: unknown interiors stay non-walkable
  const g = buildGrids(asScene(2024), 0.25).levels.get(0)!;
  let n = 0, blocked = 0;
  for (let c = 0; c < g.nx * g.nz; c++) {
    const [px, pz] = centreOf(g, c);
    if (Math.abs(px) > W2 - 0.3 || Math.abs(pz) > D2 - 0.3) continue;
    n++;
    if (!g.free[c]) blocked++;
  }
  assert.ok(blocked / n > 0.6, `2024 hall: only ${((100 * blocked) / n).toFixed(0)}% blocks`);
  // camera navmesh (CAMERA_DIRECT.md): eye-level flight from outside into the solarium goes through the door
  const f = loadCampusFile(2024);
  const nav = (scene: SpatialScene) => new CameraNavmesh(new CameraWorld(scene), [x - 9, z0 - 7, x + 7, z1 + 6], f.groundY);
  const eye = f.groundY + 1.6;
  const a: Vec3 = [x + 3, eye, zm], b: Vec3 = [x - 2.0, eye, zm];
  const r = nav(asScene(2024)).route(a, b);
  assert.ok(r.ok, `camera route: ${r.ok ? '' : r.diagnostic.message}`);
  const cam = r.points;
  const len = cam.slice(1).reduce((s2, p, i) => s2 + hypot(p[0] - cam[i][0], p[2] - cam[i][2]), 0);
  assert.ok(len < 8, `camera goes straight through the door (${len.toFixed(1)} m)`);
  // counterfactual: the same wall with the door closed → no short route
  const closed = { ...asScene(2024), obstacles: [...asScene(2024).obstacles, { id: 'closed-door', kind: 'glass' as const, obb: { c: [x, zm] as Vec2, half: [0.02, (z1 - z0) / 2 + 0.02] as Vec2, yaw: 0 }, y0: 0.2, y1: 2.3 }] };
  const rc = nav(closed).route(a, b);
  const lenC = rc.ok ? rc.points.slice(1).reduce((s2, p, i) => s2 + hypot(p[0] - rc.points[i][0], p[2] - rc.points[i][2]), 0) : Infinity;
  assert.ok(lenC > len + 3, `closed door: ${rc.ok ? `${lenC.toFixed(1)} m detour` : 'no route'}`);
  console.log(`  2024 solarium door: walker ${w.len.toFixed(1)} m (clearance ${w.clearance.toFixed(2)}); camera ${len.toFixed(1)} m at eye level; closed door → ${rc.ok ? `${lenC.toFixed(1)} m` : 'no route'}; hall ${((100 * blocked) / n).toFixed(0)}% blocked`);
});

// ---- 2022 reconciliation + 2023/24 trailers out of Chiba, reconstruction edits of 2026-09-29 evening (W51) ----------
// Gene's questionnaire answers (OWNER_DECISIONS.md; RECONCILIATION_2022.md §a–§f, §i): 2022 names, clockwise pinwheel,
// stairs parallel to the houses, south-facing 45° solar frames, trailer train, no corner table, north −101°;
// 2023 / 2024 trailer ring keeps out of Chiba (Q2). One re-seed per year (HISTORY_IDS.md "Reconstruction edits").
const PRE_EDIT_W51: Record<number, string> = {
  2022: '8b88e6f090c79b92784954787f0329295286d5b6f5e76f0d9d450023da8c49f2',
  2023: '8e401abb922bbea265694577a71dd7ae9521022646094cf7924d447c1d3e44dc',
  2024: '832e8d9af699feb5afed6949189b4995354db7696ccbaa3c50e52126e37f8865',
};

// 2026-09-29 photographic source review: one new protected canonical for each
// historical year. These hashes are the committed files before this review,
// not values derived from the new procedural scenes.
const PRE_EDIT_PHOTO_REVIEW: Record<number, string> = {
  2021: '8dcfd059dcfb8248e3ee9e0d347402645c4622cb0872351afd40bfaa753379d9',
  2022: 'f8090a99bc9ed24ab37f096ad2bd37bca49d277ae3d7167e51c711d856d4c479',
  2023: '883e6371d53348df0349127e870ad86acc06b59cd53adc7bf8c1f8b22441fe8c',
  2024: 'bd2e0c79f527fa628cea77830dfcb3c4ff7806c02db80d8c3e332548412bc0ba',
  2025: '5399653dfa9d78883104f96580206d8d52d322314e0766db7ac273c7bb3fc909',
};
// User-rejected first pass, frozen before the dense aerial second review.
const PRE_EDIT_SECOND_REVIEW: Record<number, string> = {
  "2021": "796abf8cb4216af66608f35af12573e74109faa70c815473f531830f9b011d8f",
  "2022": "50b567444ff99cde693a0b1a2c989b4b9c14240ab259f60256b89d426a949129",
  "2023": "a84258a16c1e07d876b0e762a967ff8b2d593edd8aab345403e9005fabc23cb4",
  "2024": "17558dab740ae4846c07af4a208724b13b479cd7ec51b770ff721b75da7cdc1e",
  "2025": "309c6b5614a991cd6bf2a11c17efaaf7eef28c4d224ad486e919ba6e13106665"
};
for (const year of [2021, 2022, 2023, 2024, 2025]) test(`photo review ${year}: reconstruction edit re-seeds the protected canonical`, () => {
  const f = loadCampusFile(year);
  assert.notEqual(f.contentHash, PRE_EDIT_PHOTO_REVIEW[year]);
  assert.notEqual(f.contentHash, PRE_EDIT_SECOND_REVIEW[year]);
  const now = loadCampusYear(year, f).world;
  const pre: WorldState = { ...structuredClone(now), base: { ...now.base, staticHash: PRE_EDIT_PHOTO_REVIEW[year] } };
  const h = new WorldHistory(RULES_VERSION);
  h.publishCanonical(campusYearId(year), `Mars ${year} (before photographic review)`, pre, `campus-${year}.json before source review`);
  assert.throws(() => h.commit(campusYearId(year), now, { kind: 'reconstruction-edit', note: 'photo review' }), (e: unknown) => e instanceof HistoryError && e.code === 'protected');
  h.fork(campusYearId(year), `mars-${year}-photo-review`, 'source-backed reconstruction');
  const cp = h.commit(`mars-${year}-photo-review`, now, {
    kind: 'reconstruction-edit',
    note: `${year} source-backed building, room and vehicle corrections`,
    evidence: [`docs/media/reconstruction/campus-history/year-${year}/RECONSTRUCTION.md`],
  }, 'reconstruction-edit photographic review');
  const published = new WorldHistory(RULES_VERSION);
  publishCampusYear(published, year, f);
  assert.equal(published.head(campusYearId(year)).physicalHash, cp.physicalHash);
  assert.equal(hashOf(published.read(campusYearId(year))), hashOf(h.read(cp.id)));
});
const W51_EVIDENCE = ['docs/engineering/RECONCILIATION_2022.md', 'docs/engineering/questions/photos/2022-aerial-03.jpg', 'docs/engineering/questions/photos/2022-DJI_0829.jpg'];
for (const year of [2022, 2023, 2024]) test(`W51 ${year} edit: mars-${year} re-seeded — pre-edit canonical + reconstruction-edit checkpoint = the new canonical`, () => {
  const f = loadCampusFile(year);
  assert.notEqual(f.contentHash, PRE_EDIT_W51[year], 'the edit changed the static scene');
  const now = loadCampusYear(year, f).world;
  const pre: WorldState = { ...structuredClone(now), base: { ...now.base, staticHash: PRE_EDIT_W51[year] } };
  const h = new WorldHistory(RULES_VERSION);
  h.publishCanonical(campusYearId(year), `Mars ${year} (before the W51 edit)`, pre, `campus-${year}.json before the W51 reconstruction edit`);
  h.fork(campusYearId(year), `mars-${year}-w51`, 'W51 reconstruction edit');
  const cp = h.commit(`mars-${year}-w51`, now, { kind: 'reconstruction-edit', note: year === 2022 ? '2022 reconciliation (names, pinwheel, stairs, solar, trailers, no corner table; W51)' : `${year} trailers out of Chiba, off its walls (Q2; W51)`, evidence: W51_EVIDENCE }, 'reconstruction-edit W51');
  const h2 = new WorldHistory(RULES_VERSION);
  publishCampusYear(h2, year, f);
  assert.equal(h2.head(campusYearId(year)).physicalHash, cp.physicalHash);
  assert.equal(hashOf(h2.read(campusYearId(year))), hashOf(h.read(cp.id)));
});

test('2022 review: structural IDs kept; seven trailers and two reclassified shelters, stairs / solar re-made, rv-10…12 and the corner table gone; names on the regions; north −101 on the scene', () => {
  const comps = new Set(Y(2022).base.obstacles.map((o) => o.component));
  for (const k of ['chiba-rack-upright-', 'east-house-12-foot-orange-beam-', 'kitchen-plywood-deck-sheet-', 'west-house-plywood-wall-', 'rv-8-trailer-shell-']) assert.ok([...comps].some((c) => c.startsWith(k)), k);
  assert.ok(comps.has('east-house-plywood-deck-sheet-141763ed'), 'a deck strip kept its id (group moved, placement in the house unchanged)');
  for (const k of ['rv-7-', 'rv-9-', 'rv-10-', 'rv-11-', 'rv-12-', 'west-house-table-']) assert.ok(![...comps].some((c) => c.startsWith(k)), `${k} removed`);
  assert.ok([...comps].some((c) => c.startsWith('chiba-stair-landing-')) && [...comps].some((c) => c.startsWith('west-house-solar-frame-rafter-')));
  assert.deepEqual(['chiba', 'east-house', 'kitchen', 'west-house'].map((id) => reg(2022, id).label), ['Ba Sing Se', 'Cahuilla', 'Chatsubo', 'Huaqiangbei']);
  assert.ok(!Y(2022).base.obstacles.some((o) => /chiba/i.test(o.label ?? '')), 'no "Chiba" label in 2022');
  assert.equal(Y(2022).base.meta.northAzimuthOffset, -101);
  for (const y of [2020, 2021, 2023]) assert.equal(Y(y).base.meta.northAzimuthOffset, undefined, `${y} uses the global bearing`);
  for (const y of [2024, 2025]) assert.equal(Y(y).base.meta.northAzimuthOffset, 0, `${y} uses the local -Z north convention`);
});

test('W51 2023/2024: no trailer stands in or against Chiba — its footprint grid is exactly what it is without any trailer', () => {
  for (const y of [2023, 2024]) {
    const ch = box(reg(y, 'chiba'));
    const polygon = reg(y, 'chiba').polygon;
    const insideHull = (x: number, z: number) => {
      let inside = false;
      for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
        const a=polygon[i],b=polygon[j];
        if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
      }
      return inside;
    };
    const rvs = Y(y).base.obstacles.filter((o) => /^rv-\d+$/.test(o.assembly));
    assert.ok(rvs.length > 0);
    const full = buildGrids(asScene(y), 0.25).levels.get(0)!;
    const bare = buildGrids({ ...asScene(y), obstacles: Y(y).base.obstacles.filter((o) => !/^rv-\d+$/.test(o.assembly)) } as unknown as SpatialScene, 0.25).levels.get(0)!;
    assert.equal(full.nx, bare.nx);
    let inside = 0;
    for (let c = 0; c < full.nx * full.nz; c++) {
      const [px, pz] = centreOf(full, c);
      // Test the actual hull: the end ladder extends its AABB into unrelated parking.
      if (px < ch.x0 || px > ch.x1 || pz < ch.z0 || pz > ch.z1 || !insideHull(px,pz)) continue;
      inside++;
      assert.equal(full.free[c], bare.free[c], `${y} cell (${px.toFixed(2)}, ${pz.toFixed(2)}) in / beside Chiba is changed by a trailer`);
    }
    assert.ok(inside > 1000);
  }
});
