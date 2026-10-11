// scatter/2: ecology with structure. Owner: L3. Spec 33 §2 row 7.
// A palette of species (built-in kinds or any def) with weights; cluster centres give groves and
// glades; rules per species on slope and distance to water (reeds by the water, rocks on the
// steep, trees away from the shore); auto-exclusion of solids, roads and water (the caller passes
// `blocked`, built from the model); size and age from the seed, smaller toward the area's edge
// (a forest edge of saplings and shrubs). Pure: the viewer instances the result; the server or skill
// can count it. Decor: no colliders (Stage B adds trunks as obstacles if wanted).
import { bounds2, n, pointInPoly, rng } from './geom.ts';
import { distToWater, distSeg, type TerrainQuery } from './terrain-query.ts';
import type { Baked, Generator, Shape, Vec2 } from './types.ts';
import type { Value } from './fields.ts';

/** Built-in species the viewer can draw without a def (rounded low-poly). */
export const SPECIES = ['oak', 'pine', 'birch', 'poplar', 'palm', 'bush', 'fern', 'reed', 'rock', 'boulder', 'flower', 'grass', 'cactus'] as const;
export type Species = (typeof SPECIES)[number];
export type PaletteEntry = {
  kind?: Species; def?: string; weight?: number;
  /** only within this many metres of water (reeds) */ nearWater?: number;
  /** only farther than this from water (trees keep off the shore) */ farWater?: number;
  /** slope (rise/run) limits: rocks on steep ground, trees on gentle */ minSlope?: number; maxSlope?: number;
  /** stand in water up to this depth (m): reeds */ wet?: number;
  scale?: [number, number];
};
export type ScatterPoint = { x: number; z: number; k: number; s: number; yaw: number; tone: number };

export const DEFAULT_PALETTE: PaletteEntry[] = [
  { kind: 'oak', weight: 4, farWater: 6, maxSlope: 0.6, scale: [0.7, 1.3] },
  { kind: 'pine', weight: 3, farWater: 4, maxSlope: 0.8, scale: [0.7, 1.4] },
  { kind: 'birch', weight: 1.5, farWater: 3, maxSlope: 0.6, scale: [0.7, 1.2] },
  { kind: 'bush', weight: 2, maxSlope: 0.9, scale: [0.6, 1.3] },
  { kind: 'fern', weight: 1.5, maxSlope: 0.7, scale: [0.6, 1.2] },
  { kind: 'reed', weight: 6, nearWater: 4, wet: 0.5, scale: [0.7, 1.3] },
  { kind: 'rock', weight: 3, minSlope: 0.45, scale: [0.6, 1.6] },
];

export function paletteOf(params: Record<string, Value>): PaletteEntry[] {
  const p = params.palette;
  if (Array.isArray(p) && p.length) return (p as PaletteEntry[]).filter((e) => e && typeof e === 'object' && (e.kind || e.def)).slice(0, 16);
  return DEFAULT_PALETTE;
}

function okFor(e: PaletteEntry, slope: number, dw: number, depth: number): boolean {
  if (depth > 0 && !(e.wet && depth <= e.wet)) return false;
  if (e.nearWater !== undefined && dw > e.nearWater) return false;
  if (e.farWater !== undefined && dw < e.farWater) return false;
  if (e.minSlope !== undefined && slope < e.minSlope) return false;
  if (e.maxSlope !== undefined && slope > e.maxSlope) return false;
  return true;
}

/**
 * Points for a scatter/2 area. `blocked(x, z)` excludes solids, roads, plazas (built by the caller
 * from the model). Water is excluded unless a species may stand in it (`wet`).
 */
export function scatter2Points(area: Vec2[], params: Record<string, Value>, seed: number, q: TerrainQuery, blocked: (x: number, z: number) => boolean = () => false, cap = 6000): ScatterPoint[] {
  const pal = paletteOf(params), density = n(params.density, 0.03), cluster = Math.min(1, Math.max(0, n(params.cluster, 0.4))), spacing = n(params.minSpacing, 2);
  const [x0, z0, x1, z1] = bounds2(area), A = Math.max(1, (x1 - x0) * (z1 - z0));
  const want = Math.min(cap, Math.floor(A * density));
  const rnd = rng((seed | 0) ^ 0x5ca7) ;
  // cluster centres, each with a dominant species
  const K = Math.max(1, Math.round(want / 10)), sigma = Math.sqrt(A / K) * 0.7;
  const total = pal.reduce((a, e) => a + (e.weight ?? 1), 0);
  const pick = (r: number) => { let acc = 0; for (let i = 0; i < pal.length; i++) { acc += (pal[i].weight ?? 1) / total; if (r < acc) return i; } return pal.length - 1; };
  const centres: { x: number; z: number; k: number }[] = [];
  for (let i = 0; i < K * 4 && centres.length < K; i++) { const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0); if (pointInPoly(x, z, area)) centres.push({ x, z, k: pick(rnd()) }); }
  const cell = Math.max(spacing, 0.5), grid = new Map<string, Vec2[]>(), sp2 = spacing * spacing;
  const out: ScatterPoint[] = [];
  const edgeDist = (x: number, z: number) => { let b = Infinity; for (let i = 0, j = area.length - 1; i < area.length; j = i++) b = Math.min(b, distSeg(x, z, area[j], area[i])); return b; };
  for (let tries = 0; out.length < want && tries < want * 14; tries++) {
    const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0), r1 = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd();
    if (!pointInPoly(x, z, area)) continue;
    // clustering: accept with a probability that falls off away from the nearest centre
    let near = centres[0], nd = Infinity;
    for (const c of centres) { const d = (c.x - x) ** 2 + (c.z - z) ** 2; if (d < nd) { nd = d; near = c; } }
    const k0 = Math.max(0, 1 - nd / (sigma * sigma)); const pAccept = 1 - cluster + cluster * k0 * k0;
    if (r1 > pAccept) continue;
    const gx = Math.floor(x / cell), gz = Math.floor(z / cell);
    let free = true;
    for (let dz = -1; dz <= 1 && free; dz++) for (let dx = -1; dx <= 1 && free; dx++) for (const [px, pz] of grid.get(`${gx + dx},${gz + dz}`) ?? []) if ((px - x) ** 2 + (pz - z) ** 2 < sp2) { free = false; break; }
    if (!free || blocked(x, z)) continue;
    const g = q.height(x, z), lv = q.waterLevel(x, z), depth = lv !== null && lv > g ? lv - g : 0, slope = q.slope(x, z), dw = depth > 0 ? 0 : distToWater(q, x, z, 60);
    // species: the cluster's dominant one if its rules allow, else a weighted pick among those that do
    let k = r2 < cluster && okFor(pal[near.k], slope, dw, depth) ? near.k : -1;
    if (k < 0) {
      const ok = pal.map((e, i) => (okFor(e, slope, dw, depth) ? i : -1)).filter((i) => i >= 0);
      if (!ok.length) continue;
      const tw = ok.reduce((a, i) => a + (pal[i].weight ?? 1), 0); let acc = 0; const r = r3 * tw;
      k = ok[ok.length - 1]; for (const i of ok) { acc += pal[i].weight ?? 1; if (r < acc) { k = i; break; } }
    }
    const [s0, s1] = pal[k].scale ?? [0.8, 1.2];
    const edge = Math.min(1, edgeDist(x, z) / 10);
    const s = (s0 + (s1 - s0) * Math.sqrt(r4)) * (0.55 + 0.45 * edge);
    out.push({ x, z, k, s, yaw: rnd() * 6.283, tone: rnd() });
    const key = `${gx},${gz}`; const list = grid.get(key); if (list) list.push([x, z]); else grid.set(key, [[x, z]]);
  }
  return out;
}

export const scatter2Gen: Generator = {
  id: 'scatter/2', form: 'area', owner: 'L3', doc: 'Ecological scatter: a species palette with weights, clustering, auto-exclusion of solids/roads/water, slope and water-distance rules (reeds by water, rocks on the steep), size/age from the seed, saplings at the edge.',
  params: {
    palette: { type: 'json', doc: '[{kind: oak|pine|birch|poplar|palm|bush|fern|reed|rock|boulder|flower|grass|cactus, or def: ref, weight, nearWater?, farWater?, minSlope?, maxSlope?, wet?, scale?: [min,max]}]' },
    density: { type: 'number', min: 0.0005, max: 8, default: 0.03 },
    cluster: { type: 'number', min: 0, max: 1, default: 0.4, doc: '0 uniform … 1 tight clumps' },
    minSpacing: { type: 'number', min: 0.2, max: 30, default: 2 },
    avoid: { type: 'json', doc: 'tags or layers to avoid (default: solid, road, water)' },
  },
  physics({ params, shape }) {
    const area = shape?.area ?? ([[-5, -5], [5, -5], [5, 5], [-5, 5]] as Vec2[]);
    const [x0, z0, x1, z1] = bounds2(area), pal = paletteOf(params);
    const est = Math.min(6000, Math.floor((x1 - x0) * (z1 - z0) * n(params.density, 0.03)));
    const b: Baked = { box: [Math.max(0.1, x1 - x0), 10, Math.max(0.1, z1 - z0)], colliders: [], slots: [], tris: est * 60, notes: [`≈${est} plants and rocks of ${pal.length} species: ${pal.map((e) => e.kind ?? e.def).join(', ')}`] };
    return b;
  },
};
export type { Shape };
