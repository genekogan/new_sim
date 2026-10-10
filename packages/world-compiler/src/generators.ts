// Generators: deterministic (params, seed) → geometry recipe + physics. The
// compiler needs only the physics half (box, colliders, slots, landform); the
// viewer runs the same generator for the picture. M1 ships the small set the
// hello world needs; buildings arrive in M3 (spec §3.4).
import type { LandformBody } from '@sim/ground';
import type { Field, Slot, Value } from './schemas.ts';

/** Local oriented box in the def frame: centre (x, z), half extents, yaw, vertical span. */
export type LocalOBB = { c: [number, number]; half: [number, number]; yaw: number; y0: number; y1: number; tag?: string };

export type Baked = {
  /** Local axis-aligned bounds (x width, y height, z depth) at scale 1. */
  box: [number, number, number];
  colliders: LocalOBB[];
  slots: Slot[];
  landform?: LandformBody;
  water?: { level: number };
  /** Triangle estimate for budgets (generators are cheap; meshes report real counts). */
  tris: number;
};

export type GenContext = { params: Record<string, Value>; seed: number; shape?: { path?: [number, number][]; width?: number; area?: [number, number][] } };

export type Generator = {
  id: string;
  params: Record<string, Field>;
  bake(ctx: GenContext): Baked;
};

const n = (v: Value | undefined, d: number) => (typeof v === 'number' ? v : d);

/** A plain box: the universal placeholder and the collider of most props. */
export const boxGen: Generator = {
  id: 'box/1',
  params: { w: { type: 'number', min: 0.05, max: 400, default: 1 }, h: { type: 'number', min: 0.05, max: 120, default: 1 }, d: { type: 'number', min: 0.05, max: 400, default: 1 }, color: { type: 'color', default: '#9a9a9a' } },
  bake({ params }) {
    const w = n(params.w, 1), h = n(params.h, 1), d = n(params.d, 1);
    return { box: [w, h, d], colliders: [{ c: [0, 0], half: [w / 2, d / 2], yaw: 0, y0: 0, y1: h }], slots: [{ id: 'top', kind: 'surface', p: [0, h, 0], yaw: 0, accepts: {}, capacity: 64 }], tris: 12 };
  },
};

/** A landform. `point` form → bump; `path` form → ridge; `area` form → plateau or carve (negative height). No collider: terrain is the physics. */
export const landformGen: Generator = {
  id: 'landform/1',
  params: { height: { type: 'number', min: -200, max: 400, default: 6 }, radius: { type: 'number', min: 1, max: 2000, default: 20 }, peak: { type: 'number', min: 0.25, max: 6, default: 1 }, edge: { type: 'number', min: 0.5, max: 200, default: 8 } },
  bake({ params, shape }) {
    const h = n(params.height, 6), r = n(params.radius, 20), peak = n(params.peak, 1), edge = n(params.edge, 8);
    let landform: LandformBody;
    if (shape?.path) landform = { kind: 'ridge', path: shape.path, w: shape.width ?? r, h, peak };
    else if (shape?.area) landform = h < 0 ? { kind: 'carve', area: shape.area, bed: h, edge } : { kind: 'plateau', area: shape.area, h, edge };
    else landform = { kind: 'bump', c: [0, 0], r, h, peak };
    return { box: [2 * r, Math.abs(h), 2 * r], colliders: [], slots: [], landform, tris: 0 };
  },
};

/** A lake or pond: carves a bed and fills with water to `level`. `area` form. */
export const lakeGen: Generator = {
  id: 'lake/1',
  params: { depth: { type: 'number', min: 0.2, max: 60, default: 4 }, level: { type: 'number', min: -100, max: 400, default: -0.3 }, edge: { type: 'number', min: 0.5, max: 60, default: 6 } },
  bake({ params, shape }) {
    const depth = n(params.depth, 4), level = n(params.level, -0.3), edge = n(params.edge, 6);
    const area = shape?.area ?? [[-10, -10], [10, -10], [10, 10], [-10, 10]];
    return { box: [20, depth, 20], colliders: [], slots: [], landform: { kind: 'carve', area, bed: level - depth, edge }, water: { level }, tris: 0 };
  },
};

/** Deterministic scatter over an area: positions come from the seed. The viewer instances `of` defs at these points. */
export const scatterGen: Generator = {
  id: 'scatter/1',
  params: { density: { type: 'number', min: 0.001, max: 10, default: 0.05 }, minSpacing: { type: 'number', min: 0.2, max: 50, default: 2 }, radius: { type: 'number', min: 0.1, max: 10, default: 0.4 }, height: { type: 'number', min: 0.1, max: 60, default: 6 } },
  bake({ params, shape }) {
    const area = shape?.area ?? [[-5, -5], [5, -5], [5, 5], [-5, 5]];
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of area) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
    return { box: [x1 - x0, n(params.height, 6), z1 - z0], colliders: [], slots: [], tris: 0 };
  },
};

/** Scatter points for an area; shared by server (none needed for physics yet) and viewer. Poisson-ish by rejection on a seeded hash. */
export function scatterPoints(area: [number, number][], density: number, minSpacing: number, seed: number, cap = 4000): [number, number][] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of area) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  const want = Math.min(cap, Math.floor((x1 - x0) * (z1 - z0) * density));
  const out: [number, number][] = [];
  let s = (seed | 0) || 1;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1000000) / 1000000; };
  const inside = (px: number, pz: number) => { let i = false; for (let a = 0, b = area.length - 1; a < area.length; b = a++) { const [xi, zi] = area[a], [xj, zj] = area[b]; if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) i = !i; } return i; };
  const ms2 = minSpacing * minSpacing;
  for (let tries = 0; out.length < want && tries < want * 12; tries++) {
    const px = x0 + rnd() * (x1 - x0), pz = z0 + rnd() * (z1 - z0);
    if (!inside(px, pz)) continue;
    let ok = true;
    for (const [qx, qz] of out) if ((qx - px) ** 2 + (qz - pz) ** 2 < ms2) { ok = false; break; }
    if (ok) out.push([px, pz]);
  }
  return out;
}

export const GENERATORS: Record<string, Generator> = Object.fromEntries([boxGen, landformGen, lakeGen, scatterGen].map((g) => [g.id, g]));
export function registerGenerator(g: Generator) { GENERATORS[g.id] = g; }
