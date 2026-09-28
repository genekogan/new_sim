// Engine Lab "year walkabout" presets (year-2020 … year-2026): the generated
// engine scenes public/engine/campus-<year>.json (docs/engineering/CAMPUS_SCENE.md)
// fetched and turned into Spatial + grids in the browser, with four walkers
// sent across each campus. The lab renders the studio's real procedural year
// scene behind them (year-walkabout-view.ts) so prism/geometry mismatches show.
// Pure TS (no three.js/DOM): scenarios.ts is imported by node too; fetch only
// happens in prepare().
import { Runtime } from '../../engine/runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../../engine/runtime/invariants.ts';
import { Spatial } from '../../engine/spatial/service.ts';
import { walkTo } from '../../engine/locomotion/walk.ts';
import { clearanceAt, type LevelGrid } from '../../engine/spatial/grid.ts';
import { human, addAll } from '../../engine/world/factory.ts';
import { add2, dist2, heading, norm2, scale2, sub2, type Vec2 } from '../../engine/core/math.ts';
import { campusYearUrl, loadCampusYear, type CampusYearFile } from '../../engine/campus/history.ts';
import { cropScene, CAMPUS_2026_URL } from '../../engine/campus/load.ts';
import { loadCampus2026 } from '../../engine/campus/world.ts';
import type { CampusScene, CampusSceneFile } from '../../engine/campus/types.ts';
import type { ActionDef } from '../../engine/actions/types.ts';
import type { WorldState } from '../../engine/world/types.ts';
import type { Check, Scenario } from './scenarios.ts';

export const WALKABOUT_YEARS = [2020, 2021, 2022, 2023, 2024, 2025, 2026] as const;
/** 2026 is cropped to ±60 m around the staging-east region centre (whole campus is 258×216 m). */
export const STAGING_CROP = 60;
const CELL = 0.1;
/** Clearance a walker spot must have (body radius 0.28 + margin). */
const ROOM = 0.6;

type Loaded = { base: CampusScene; world: WorldState; bytes: number; fetchMs: number; parseMs: number; crop?: [number, number, number, number] };
const loaded = new Map<number, Loaded>();
const pending = new Map<number, Promise<void>>();

/** Fetch + parse a year's scene once (cached per page). */
export function prepareYear(year: number): Promise<void> {
  if (loaded.has(year)) return Promise.resolve();
  let p = pending.get(year);
  if (!p) {
    p = (async () => {
      const t0 = performance.now();
      const res = await fetch(year === 2026 ? CAMPUS_2026_URL : campusYearUrl(year));
      if (!res.ok) throw Error(`campus ${year}: HTTP ${res.status} for ${res.url}`);
      const text = await res.text();
      const t1 = performance.now();
      const json = JSON.parse(text);
      let entry: Loaded;
      if (year === 2026) {
        const full = loadCampus2026(json as CampusSceneFile, { flagshipInventory: false });
        const st = full.base.regions.find((r) => r.id === 'staging-east');
        if (!st) throw Error('campus 2026: no staging-east region');
        const c = centroid(st.polygon);
        const crop: [number, number, number, number] = [c[0] - STAGING_CROP, c[1] - STAGING_CROP, c[0] + STAGING_CROP, c[1] + STAGING_CROP];
        const base = cropScene(full.base, crop);
        const world = { ...full.world, entities: {}, regions: Object.fromEntries(base.regions.map((r) => [r.id, r])) };
        entry = { base, world, bytes: text.length, fetchMs: t1 - t0, parseMs: performance.now() - t1, crop };
      } else {
        const { base, world } = loadCampusYear(year, json as CampusYearFile);
        entry = { base, world, bytes: text.length, fetchMs: t1 - t0, parseMs: performance.now() - t1 };
      }
      loaded.set(year, entry);
    })().finally(() => pending.delete(year));
    pending.set(year, p);
  }
  return p;
}

function need(year: number): Loaded {
  const l = loaded.get(year);
  if (!l) throw Error(`year-${year}: scene not loaded yet (await the scenario's prepare(), e.g. LabSim.loadAsync)`);
  return l;
}

// ---- walkers: region-hull-derived spots ------------------------------------

/** A walk: from → to, optionally proving passage through `via` (closest approach ≤ r). */
export type Walk = { id: string; from: Vec2; to: Vec2; via?: { p: Vec2; r: number; label: string } };
/** Axis-aligned bounds of a region hull; `c` = bounds centre. */
type Box = { c: Vec2; min: Vec2; max: Vec2 };

const centroid = (poly: [number, number][]): Vec2 => {
  let x = 0, z = 0;
  for (const p of poly) (x += p[0]), (z += p[1]);
  return [x / poly.length, z / poly.length];
};
function box(base: CampusScene, id: string): Box {
  const r = base.regions.find((q) => q.id === id);
  if (!r) throw Error(`region "${id}" not in the scene (have ${base.regions.map((q) => q.id).join(', ')})`);
  const xs = r.polygon.map((p) => p[0]), zs = r.polygon.map((p) => p[1]);
  const min: Vec2 = [Math.min(...xs), Math.min(...zs)], max: Vec2 = [Math.max(...xs), Math.max(...zs)];
  return { c: scale2(add2(min, max), 0.5), min, max };
}
/** Closest pair of vertices/edge points between two region hulls → their midpoint (the gap between buildings). */
function gapBetween(base: CampusScene, a: string, b: string): Vec2 {
  const pa = base.regions.find((q) => q.id === a)!.polygon, pb = base.regions.find((q) => q.id === b)!.polygon;
  let best = Infinity, mid: Vec2 = [0, 0];
  const seg = (p: Vec2, s: Vec2, e: Vec2): Vec2 => {
    const d = sub2(e, s), L = d[0] * d[0] + d[1] * d[1];
    const t = L ? Math.max(0, Math.min(1, ((p[0] - s[0]) * d[0] + (p[1] - s[1]) * d[1]) / L)) : 0;
    return add2(s, scale2(d, t));
  };
  for (const [P, Q] of [[pa, pb], [pb, pa]])
    for (const p of P)
      for (let i = 0; i < Q.length; i++) {
        const q = seg(p, Q[i], Q[(i + 1) % Q.length]);
        const d = dist2(p, q);
        if (d < best) (best = d), (mid = scale2(add2(p, q), 0.5));
      }
  return mid;
}
/** Nearest point (spiral over 0.25 m rings, ≤ 8 m) with at least ROOM clearance. */
function snap(g: LevelGrid, p: Vec2): Vec2 {
  if (clearanceAt(g, p) >= ROOM) return p;
  for (let r = 0.25; r <= 8; r += 0.25) {
    const n = Math.ceil((2 * Math.PI * r) / 0.2);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 2 * Math.PI;
      const q: Vec2 = [p[0] + r * Math.cos(a), p[1] + r * Math.sin(a)];
      if (clearanceAt(g, q) >= ROOM) return q;
    }
  }
  throw Error(`no standable spot within 8 m of (${p[0].toFixed(1)}, ${p[1].toFixed(1)})`);
}

/** Per-year intent: where the photographic corrections say people can go. */
function walks(year: number, base: CampusScene): Walk[] {
  const B = (id: string) => box(base, id);
  switch (year) {
    case 2020: {
      const portal = B('chiba'), forest = B('forest'), geo = B('geodesic'), tent = B('tent'), mcda = B('mcda'), canopy = B('canopy');
      return [
        { id: 'w1', from: [portal.min[0] - 4, portal.c[1]], to: [forest.max[0] + 4, forest.c[1]] },
        { id: 'w2', from: [geo.c[0], geo.max[1] + 3], to: [tent.c[0], tent.max[1] + 3] },
        { id: 'w3', from: [mcda.max[0] + 3, mcda.c[1]], to: [portal.c[0], portal.max[1] + 4] },
        { id: 'w4', from: [canopy.c[0], canopy.min[1] - 4], to: [geo.c[0], geo.min[1] - 3] },
      ];
    }
    case 2021: {
      // Corridor between the two parallel wings: hull centre line, walked both ways.
      const h = B('chiba'), cx = h.c[0], mid: Vec2 = [cx, (h.min[1] + h.max[1]) / 2 - 3];
      const via = (dx: number) => ({ p: [cx + dx, mid[1]] as Vec2, r: 1.2, label: 'corridor between the two wings' });
      return [
        { id: 'w1', from: [cx - 1.0, h.min[1] - 5], to: [cx - 1.0, h.max[1] + 3], via: via(-1.0) },
        { id: 'w2', from: [cx + 1.2, h.min[1] - 8], to: [cx + 1.2, h.max[1] + 5], via: via(1.2) },
        { id: 'w3', from: [cx + 0.8, h.max[1] + 4], to: [cx + 0.8, h.min[1] - 4], via: via(0.8) },
        { id: 'w4', from: [cx - 1.4, h.max[1] + 7], to: [cx - 1.4, h.min[1] - 7], via: via(-1.4) },
      ];
    }
    case 2022: {
      // From the courtyard centre out through each of the four corner passages.
      const ids = ['chiba', 'east-house', 'kitchen', 'west-house'];
      const cs = ids.map((id) => B(id).c);
      const centre: Vec2 = scale2(cs.reduce((a, b) => add2(a, b), [0, 0] as Vec2), 1 / 4);
      return ids.map((id, i) => {
        const gap = gapBetween(base, id, ids[(i + 1) % 4]);
        const dir = norm2(sub2(gap, centre));
        return { id: `w${i + 1}`, from: add2(centre, scale2(dir, 1.5)), to: add2(gap, scale2(dir, 7)), via: { p: gap, r: 1.2, label: `corner passage ${id} / ${ids[(i + 1) % 4]}` } };
      });
    }
    case 2023: {
      const h = B('chiba'), k = B('kitchen');
      return [
        { id: 'w1', from: [h.min[0] + 4, h.max[1] + 2.5], to: [k.min[0] - 3, k.c[1]] },
        { id: 'w2', from: [k.c[0], k.min[1] - 3], to: [h.c[0], h.min[1] - 4] },
        { id: 'w3', from: [h.max[0] + 5, h.c[1]], to: [h.min[0] - 5, k.min[1] - 6] },
        { id: 'w4', from: [h.max[0] - 4, h.max[1] + 2.5], to: [k.max[0] + 3, k.max[1]] },
      ];
    }
    case 2024: {
      // Along the painted frontage, past the stepped PV (west) and the salvaged glazing (east).
      const h = B('chiba'), k = B('kitchen'), zf = h.max[1] + 1.5;
      return [
        { id: 'w1', from: [h.min[0] - 5, zf], to: [h.max[0] + 5, zf], via: { p: [h.c[0], zf], r: 1.5, label: 'frontage, in front of the central stairs' } },
        { id: 'w2', from: [h.max[0] + 5, zf + 1.8], to: [h.min[0] - 5, zf + 1.8], via: { p: [h.c[0], zf + 1.8], r: 1.5, label: 'frontage, in front of the central stairs' } },
        { id: 'w3', from: [h.min[0] - 4, h.min[1] - 3], to: [h.max[0] + 4, h.min[1] - 3] },
        { id: 'w4', from: [h.c[0] + 2, zf + 4], to: [k.c[0], k.min[1] - 3] },
      ];
    }
    case 2025: {
      const h = B('chiba'), k = B('kitchen'), s = B('secondary-house'), u = B('utility-booths');
      return [
        { id: 'w1', from: [h.c[0], h.max[1] + 3], to: [k.c[0], k.min[1] - 3] },
        { id: 'w2', from: [h.max[0] + 3, h.c[1]], to: [s.c[0], s.min[1] - 3] },
        { id: 'w3', from: [k.max[0] + 3, k.c[1]], to: [s.min[0] - 3, s.c[1]] },
        { id: 'w4', from: [h.c[0], h.min[1] - 3], to: [u.c[0], u.max[1] + 3] },
      ];
    }
    default: {
      // 2026 staging crop: staging-east ↔ piles and round Chiba.
      const st = B('staging-east'), h = B('chiba'), up = B('pile-uprights'), bm = B('pile-beams'), tb = B('pile-timber');
      return [
        { id: 'w1', from: [st.min[0] + 2, st.min[1] + 2], to: [h.min[0] - 4, h.c[1]] },
        { id: 'w2', from: st.c, to: tb.c },
        { id: 'w3', from: up.c, to: bm.c },
        { id: 'w4', from: [st.max[0] - 2, st.max[1] - 2], to: [h.c[0], h.max[1] + 4] },
      ];
    }
  }
}

// ---- runtime + scenario ------------------------------------------------------

export type WalkaboutInfo = {
  year: number;
  base: CampusScene;
  crop?: [number, number, number, number];
  bytes: number;
  fetchMs: number;
  parseMs: number;
  rasterMs: number;
  gridMs: number;
  cells: number;
  blocking: number;
  walks: Walk[];
  /** Largest snap offset (m) from the hull-derived spot to a standable one. */
  snapped: number;
  /** Closest approach to each walk's `via` so far. */
  closest: Record<string, number>;
};
const infos = new WeakMap<Runtime, WalkaboutInfo>();
/** Year-walkabout metadata for a runtime (undefined for other presets). */
export const walkaboutInfo = (rt: Runtime) => infos.get(rt);

function buildYear(year: number): Runtime {
  const l = need(year);
  const t0 = performance.now();
  const sp = new Spatial(l.base, { cell: CELL, baseId: l.base.meta.contentHash });
  const t1 = performance.now();
  sp.sync({ entities: {} } as unknown as WorldState);
  const t2 = performance.now();
  const g = sp.level(0)!;
  let snapped = 0;
  const ws = walks(year, l.base).map((w) => {
    const from = snap(g, w.from), to = snap(g, w.to);
    snapped = Math.max(snapped, dist2(from, w.from), dist2(to, w.to));
    return { ...w, from, to };
  });
  const y = l.base.meta.groundY;
  const people = ws.map((w) => human(w.id, w.from[0], w.from[1], { y, yaw: heading(sub2(w.to, w.from)), label: `walker ${w.id}` }));
  const world = addAll(structuredClone(l.world), ...people);
  const rt = new Runtime(world, new Map<string, ActionDef>([['walk_to', walkTo]]), { spatial: sp }, DEFAULT_INVARIANTS);
  const blocking = l.base.obstacles.filter((o) => o.y1 > y + 0.22 && o.y0 < y + 1.8).length;
  infos.set(rt, {
    year, base: l.base, crop: l.crop, bytes: l.bytes, fetchMs: l.fetchMs, parseMs: l.parseMs,
    rasterMs: t1 - t0, gridMs: t2 - t1, cells: g.nx * g.nz, blocking, walks: ws, snapped,
    closest: Object.fromEntries(ws.filter((w) => w.via).map((w) => [w.id, Infinity])),
  });
  return rt;
}

const recs = (rt: Runtime) => [...rt.records.values()];

function checks(rt: Runtime): Check[] {
  const info = infos.get(rt)!;
  const bad = recs(rt).filter((r) => r.status !== 'completed');
  const out: Check[] = [
    { ok: recs(rt).length === info.walks.length && bad.length === 0, message: bad.length ? `not completed: ${bad.map((r) => `${r.id} ${r.status} ${r.diagnostic?.code ?? ''} ${r.diagnostic?.message ?? ''}`).join('; ')}` : `all ${info.walks.length} walks completed` },
    { ok: rt.violations.length === 0, message: rt.violations.length ? `${rt.violations.length} violations, first: ${rt.violations[0].message}` : 'zero violations' },
  ];
  for (const w of info.walks) {
    if (!w.via) continue;
    const d = info.closest[w.id];
    out.push({ ok: d <= w.via.r, message: `${w.id} passed through the ${w.via.label} at (${w.via.p[0].toFixed(1)}, ${w.via.p[1].toFixed(1)}): closest ${Number.isFinite(d) ? d.toFixed(2) : '—'} m (≤ ${w.via.r})` });
  }
  return out;
}

const FOCUS: Record<number, [number, number, number, number]> = {
  2020: [0, -8, 34, 60],
  2021: [2, 3, 22, 80],
  2022: [0, 0, 16, 45],
  2023: [0, 20, 30, 60],
  2024: [0, 4, 19, 75],
  2025: [0, 12, 28, 60],
  2026: [8, -4, 40, 60],
};
const INTENT: Record<number, string> = {
  2020: 'portal → forest, geodesic → tent, MCDA → portal, canopy → geodesic.',
  2021: 'two walkers each way down the bare-ground corridor between the two long wings.',
  2022: 'from the courtyard centre out through each of the four corner passages.',
  2023: 'Chiba frontage ↔ the separate kitchen across the trailer circle, and round Chiba.',
  2024: 'both ways along the painted frontage (stepped PV west, glazing east), round the back, and down to the kitchen.',
  2025: 'Chiba ↔ kitchen, secondary house and utility booths.',
  2026: `staging-east ↔ piles and round Chiba (campus-2026.json cropped ±${STAGING_CROP} m around staging-east).`,
};

export function yearWalkabout(year: number): Scenario {
  return {
    name: `year-${year}`,
    title: `Year walkabout ${year}`,
    description: `Engine scene ${year === 2026 ? 'campus-2026.json (crop)' : `campus-${year}.json`} built in the browser (Spatial + 0.1 m grids), drawn under the studio's procedural ${year} geometry. Four walkers: ${INTENT[year]} Overlays: "Engine obstacle prisms" + clearance heatmap show where the engine data disagrees with the render.`,
    prepare: () => prepareYear(year),
    scene: () => need(year).base,
    humans: () => [],
    build: () => buildYear(year),
    start: (rt) => {
      for (const w of infos.get(rt)!.walks) rt.submit('walk_to', { actor: w.id, x: w.to[0], z: w.to[1] });
    },
    tick: (rt) => {
      const info = infos.get(rt)!;
      for (const w of info.walks) {
        if (!w.via) continue;
        const p = rt.world.entities[w.id].pose.p;
        info.closest[w.id] = Math.min(info.closest[w.id], dist2([p[0], p[2]], w.via.p));
      }
    },
    maxTicks: 20 * 240,
    focus: FOCUS[year],
    hud: (rt) => {
      const i = infos.get(rt);
      if (!i) return [];
      return [
        `${year === 2026 ? `campus-2026.json crop [${i.crop!.map((v) => v.toFixed(0)).join(', ')}]` : `campus-${year}.json`}: ${(i.bytes / 1024).toFixed(0)} KB · fetch ${i.fetchMs.toFixed(0)} ms · parse ${i.parseMs.toFixed(0)} ms`,
        `build ${(i.rasterMs + i.gridMs).toFixed(0)} ms (new Spatial + sync: rasters + EDT clearance) · ${(i.cells / 1e6).toFixed(2)} M cells @ ${CELL} m`,
        `${i.base.obstacles.length} prisms, ${i.blocking} block the ground band · spots snapped ≤ ${i.snapped.toFixed(2)} m`,
      ];
    },
    expect: checks,
  };
}

export const yearWalkabouts = (): Scenario[] => WALKABOUT_YEARS.map(yearWalkabout);
