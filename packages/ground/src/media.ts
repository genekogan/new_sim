// What a body meets on the ground, at walking scale (spec <eden4>/31 B1, L8).
// The engine plans Souls over these: a coarse 1 m media raster per 64 m tile
// (walk / wade / swim / steep / outside) for routing across the world, and the
// same rules sampled finer near water. Everything here reads the baked tiles
// (Terrain.sample / slope), never the raw height function, so it agrees with
// the picture and with the god's query to the bit.
import { areaMask, pathMask } from './geom.ts';
import { WADE_MAX_M, WALK_MAX_SLOPE } from './settle.ts';
import type { Terrain } from './tiles.ts';
import { TILE_M, type Ground, type Water } from './types.ts';

/** Media codes in a media tile. `outside` = beyond the world extent (never walkable). */
export const MEDIUM = { walk: 0, wade: 1, swim: 2, steep: 3, outside: 4 } as const;
export type MediumCode = (typeof MEDIUM)[keyof typeof MEDIUM];
export const MEDIUM_NAME = ['walk', 'wade', 'swim', 'steep', 'outside'] as const;
export type MediumName = (typeof MEDIUM_NAME)[number];

/** How a body family meets the ground: steepest walkable rise/run and deepest wadable water. */
export type BodyMedia = { maxSlope: number; wadeMax: number };
export const HUMANOID_MEDIA: BodyMedia = Object.freeze({ maxSlope: WALK_MAX_SLOPE, wadeMax: WADE_MAX_M });

/**
 * Canonical identity of a ground recipe (what replay needs to re-derive every height): FNV-1a over the
 * canonical JSON (sorted keys) in two lanes → 16 hex chars. Engine-independent and dependency-free.
 */
export function groundRecipeHash(g: Ground): string {
  const text = canonical({ schema: g.schema, base: g.base, extent: g.extent, seaLevel: g.seaLevel ?? null, noise: g.noise ?? null, landforms: g.landforms, waters: g.waters });
  let a = 0x811c9dc5, b = 0x050c5d1f;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ (c & 0xff), 16777619) >>> 0; a = Math.imul(a ^ (c >>> 8), 16777619) >>> 0;
    b = Math.imul(b ^ text.charCodeAt(text.length - 1 - i), 16777619) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).filter((k) => o[k] !== undefined && !k.startsWith('_')).sort().map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
}

/** Waters whose bounds touch a box (for fast per-cell lookups inside one tile). */
export function watersNear(g: Ground, x0: number, z0: number, x1: number, z1: number): Water[] {
  return g.waters.filter((w) => {
    const pts = w.area ?? w.path!, pad = w.area ? 0 : w.w!;
    let ax = Infinity, az = Infinity, bx = -Infinity, bz = -Infinity;
    for (const [x, z] of pts) { if (x < ax) ax = x; if (x > bx) bx = x; if (z < az) az = z; if (z > bz) bz = z; }
    return bx + pad >= x0 && ax - pad <= x1 && bz + pad >= z0 && az - pad <= z1;
  });
}
/** Water surface at (x, z) among `waters` (last wins, as waterLevelAt), else the sea level, else null. */
export function levelAmong(waters: Water[], seaLevel: number | undefined, x: number, z: number): number | null {
  let level: number | null = null;
  for (const w of waters) if ((w.area ? areaMask(x, z, w.area, 1e-9) : pathMask(x, z, w.path!, w.w!)) > 0) level = w.level;
  return level ?? (seaLevel ?? null);
}

/** In the world extent (half-open on the far edges, as tiles are). */
export const inExtent = (g: Ground, x: number, z: number) => x >= g.extent[0] && x < g.extent[2] && z >= g.extent[1] && z < g.extent[3];

/** What media sampling reads of a terrain (a Terrain, or a TileSampler over one). */
export type HeightSampler = { readonly ground: Ground; sample(x: number, z: number): number; slope(x: number, z: number): number };

/**
 * Terrain.sample / slope with a numeric last-tile memo (no per-call string keys): bit-identical results,
 * ~10× faster for the engine's many lookups in one tile. Tiles still come from (and are cached by) the Terrain.
 */
export class TileSampler implements HeightSampler {
  readonly t: Terrain;
  private tx = NaN; private tz = NaN; private cur: Float32Array | null = null;
  constructor(t: Terrain) { this.t = t; }
  get ground(): Ground { return this.t.ground; }
  private at(tx: number, tz: number): Float32Array {
    if (tx !== this.tx || tz !== this.tz || !this.cur) { this.cur = this.t.tile(tx, tz); this.tx = tx; this.tz = tz; }
    return this.cur;
  }
  /** Same arithmetic as Terrain.sample. */
  sample(x: number, z: number): number {
    const tx = Math.floor(x / TILE_M), tz = Math.floor(z / TILE_M), t = this.at(tx, tz);
    const fx = x - tx * TILE_M, fz = z - tz * TILE_M;
    let i = Math.floor(fx), j = Math.floor(fz);
    if (i >= TILE_M) i = TILE_M - 1; if (j >= TILE_M) j = TILE_M - 1;
    const u = fx - i, v = fz - j, N = TILE_M + 1;
    const a = t[j * N + i], b = t[j * N + i + 1], c = t[(j + 1) * N + i], d = t[(j + 1) * N + i + 1];
    const top = a + (b - a) * u, bot = c + (d - c) * u;
    return top + (bot - top) * v;
  }
  /** Same arithmetic as Terrain.slope. */
  slope(x: number, z: number): number {
    const tx = Math.floor(x / TILE_M), tz = Math.floor(z / TILE_M), t = this.at(tx, tz), N = TILE_M + 1;
    let i = Math.floor(x - tx * TILE_M), j = Math.floor(z - tz * TILE_M);
    if (i >= TILE_M) i = TILE_M - 1; if (j >= TILE_M) j = TILE_M - 1;
    const a = t[j * N + i], b = t[j * N + i + 1], c = t[(j + 1) * N + i], d = t[(j + 1) * N + i + 1];
    const dx = ((b - a) + (d - c)) / 2, dz = ((c - a) + (d - b)) / 2;
    return Math.sqrt(dx * dx + dz * dz);
  }
}

/** Medium of one point for a body (fine sampling: bilinear depth, the 1 m cell's slope). */
export function mediumOf(t: HeightSampler, x: number, z: number, body: BodyMedia = HUMANOID_MEDIA, waters: Water[] = t.ground.waters): MediumCode {
  if (!inExtent(t.ground, x, z)) return MEDIUM.outside;
  const lvl = levelAmong(waters, t.ground.seaLevel, x, z);
  const depth = lvl === null ? 0 : Math.max(0, lvl - t.sample(x, z));
  if (depth > body.wadeMax) return MEDIUM.swim;
  if (t.slope(x, z) > body.maxSlope) return MEDIUM.steep;
  return depth > 0 ? MEDIUM.wade : MEDIUM.walk;
}

/**
 * Coarse media of one 64 m tile: 64 × 64 one-metre cells, cell (i, j) = [x0 + i, x0 + i + 1) ×
 * [z0 + j, z0 + j + 1), classified at its centre (row-major, j * 64 + i).
 */
export function mediaTile(t: HeightSampler, tx: number, tz: number, body: BodyMedia = HUMANOID_MEDIA): Uint8Array {
  const out = new Uint8Array(TILE_M * TILE_M);
  const x0 = tx * TILE_M, z0 = tz * TILE_M;
  const waters = watersNear(t.ground, x0, z0, x0 + TILE_M, z0 + TILE_M);
  for (let j = 0; j < TILE_M; j++) for (let i = 0; i < TILE_M; i++) out[j * TILE_M + i] = mediumOf(t, x0 + i + 0.5, z0 + j + 0.5, body, waters);
  return out;
}

/** Height a swimmer's root keeps: the bed, or this far below the surface when the water is deeper (the head stays out). */
export const SWIM_ROOT_BELOW_M = 1.2;
