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
const ID_RE = /^([a-z0-9-]+-[a-z0-9-]+-[0-9a-f]{8}(-\d+)?|[a-z0-9-]+-(mars-letters|aluminet|flower-mural|entry-sign))$/;

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
  // Kit sources say "provisional"; 2020 carries high → inferred.
  assert.ok(Y(2021).base.obstacles.every((o) => o.provenance.confidence === 'provisional'));
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
  // The aluminet is overhead (≥ 3.4 m) and walk-through: only a `.up` prism, no ground blocker.
  const al = Y(2021).base.obstacles.filter((o) => o.component === 'chiba-aluminet');
  assert.ok(al.length && al.every((o) => o.id.startsWith('chiba-aluminet.up') && o.y0 > 3));
  // hashed ids from the frozen legacy migration table resolve here too (same Kit build)
  assert.ok([...comps(2022)].some((c) => /^kitchen-12-foot-orange-beam-[0-9a-f]{8}$/.test(c)));
});

test('grids build for every year (ms, cells)', () => {
  const report: string[] = [];
  for (const y of HISTORY_YEARS) {
    buildGrids(asScene(y), 0.1); // warm
    const t0 = performance.now();
    const g = buildGrids(asScene(y), 0.1).levels.get(0)!;
    const ms = performance.now() - t0;
    let free = 0;
    for (let i = 0; i < g.free.length; i++) if (g.free[i]) free++;
    report.push(`${y}: ${ms.toFixed(0)} ms, ${(g.nx * g.nz / 1e6).toFixed(2)} M cells (${((100 * free) / (g.nx * g.nz)).toFixed(0)}% free)`);
    assert.ok(ms < 1000, `${y} grid ${ms} ms`);
  }
  console.log(`  campus-history grids @0.1 m: ${report.join('; ')}`);
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

test('building interiors are not walkable (ground-floor decks block)', () => {
  for (const y of [2021, 2023, 2025]) {
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
    assert.ok(blocked / n > (y === 2021 ? 0.4 : 0.6), `${y}: only ${((100 * blocked) / n).toFixed(0)}% of Chiba blocks`);
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
