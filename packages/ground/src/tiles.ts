// Tiles: 64 m squares sampled at 1 m (65 × 65 Float32). Both sides bake from
// the same Ground and sample tiles bilinearly; tile hashes are compared.
import { smoothRadius } from './forms.ts';
import { heightAt, influenceBounds, orderedLandforms } from './height.ts';
import { TILE_M, TILE_N, type Ground, type Landform } from './types.ts';

export type TileKey = string; // "tx,tz"
export const tileKey = (tx: number, tz: number): TileKey => `${tx},${tz}`;
export const tileOf = (x: number, z: number): [number, number] => [Math.floor(x / TILE_M), Math.floor(z / TILE_M)];

/** The subset of a Ground that can influence one tile (same result as the full Ground, far fewer distance tests). */
export function groundForTile(g: Ground, tx: number, tz: number): Ground {
  const x0 = tx * TILE_M, z0 = tz * TILE_M, x1 = x0 + TILE_M, z1 = z0 + TILE_M;
  const hits = (b: [number, number, number, number]) => b[2] >= x0 && b[0] <= x1 && b[3] >= z0 && b[1] <= z1;
  let landforms = orderedLandforms(g.landforms).filter((l) => hits(influenceBounds(l)));
  // a smooth brush (L3) samples neighbours up to its kernel radius outside the tile: widen the subset by that much
  let reach = 0;
  for (const l of landforms) if (l.kind === 'brush' && l.op === 'smooth') { const r = smoothRadius(l); if (r > reach) reach = r; }
  if (reach > 0) {
    const wide = (b: [number, number, number, number]) => b[2] >= x0 - reach && b[0] <= x1 + reach && b[3] >= z0 - reach && b[1] <= z1 + reach;
    landforms = orderedLandforms(g.landforms).filter((l) => wide(influenceBounds(l)));
  }
  return { ...g, landforms, _ordered: landforms } as Ground;
}

export function bakeTile(g: Ground, tx: number, tz: number): Float32Array {
  const out = new Float32Array(TILE_N * TILE_N);
  const local = groundForTile(g, tx, tz);
  const x0 = tx * TILE_M, z0 = tz * TILE_M;
  for (let j = 0; j < TILE_N; j++) for (let i = 0; i < TILE_N; i++) out[j * TILE_N + i] = heightAt(local, x0 + i, z0 + j);
  return out;
}

/** FNV-1a over the tile's little-endian bytes, two lanes → 16 hex chars. Engine-independent. */
export function tileHash(t: Float32Array): string {
  const bytes = new Uint8Array(t.buffer, t.byteOffset, t.byteLength);
  let a = 0x811c9dc5, b = 0x050c5d1f;
  for (let i = 0; i < bytes.length; i++) {
    a = Math.imul(a ^ bytes[i], 16777619) >>> 0;
    b = Math.imul(b ^ bytes[(bytes.length - 1 - i)], 16777619) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export function tilesTouched(l: Landform): TileKey[] {
  const [x0, z0, x1, z1] = influenceBounds(l);
  const [a, b] = tileOf(x0, z0), [c, d] = tileOf(x1, z1);
  const out: TileKey[] = [];
  for (let tz = b; tz <= d; tz++) for (let tx = a; tx <= c; tx++) out.push(tileKey(tx, tz));
  return out;
}

/** A Ground plus a lazily baked tile cache. `sample` is the authoritative height for physics and picture alike. */
export class Terrain {
  private tiles = new Map<TileKey, Float32Array>();
  private hashes = new Map<TileKey, string>();
  ground: Ground;
  constructor(ground: Ground) { this.ground = ground; }

  tile(tx: number, tz: number): Float32Array {
    const k = tileKey(tx, tz);
    let t = this.tiles.get(k);
    if (!t) { t = bakeTile(this.ground, tx, tz); this.tiles.set(k, t); }
    return t;
  }
  hash(tx: number, tz: number): string {
    const k = tileKey(tx, tz);
    let h = this.hashes.get(k);
    if (!h) { h = tileHash(this.tile(tx, tz)); this.hashes.set(k, h); }
    return h;
  }
  /** Bilinear height from tiles. Outside the extent: the nearest edge tile still answers (extent is a camera/edit limit). */
  sample(x: number, z: number): number {
    const [tx, tz] = tileOf(x, z);
    const t = this.tile(tx, tz);
    const fx = x - tx * TILE_M, fz = z - tz * TILE_M;
    let i = Math.floor(fx), j = Math.floor(fz);
    if (i >= TILE_M) i = TILE_M - 1; if (j >= TILE_M) j = TILE_M - 1;
    const u = fx - i, v = fz - j;
    const a = t[j * TILE_N + i], b = t[j * TILE_N + i + 1], c = t[(j + 1) * TILE_N + i], d = t[(j + 1) * TILE_N + i + 1];
    const top = a + (b - a) * u, bot = c + (d - c) * u;
    return top + (bot - top) * v;
  }
  /** Gradient magnitude (rise/run) from the tile cell containing (x, z). */
  slope(x: number, z: number): number {
    const [tx, tz] = tileOf(x, z);
    const t = this.tile(tx, tz);
    let i = Math.floor(x - tx * TILE_M), j = Math.floor(z - tz * TILE_M);
    if (i >= TILE_M) i = TILE_M - 1; if (j >= TILE_M) j = TILE_M - 1;
    const a = t[j * TILE_N + i], b = t[j * TILE_N + i + 1], c = t[(j + 1) * TILE_N + i], d = t[(j + 1) * TILE_N + i + 1];
    const dx = ((b - a) + (d - c)) / 2, dz = ((c - a) + (d - b)) / 2;
    return Math.sqrt(dx * dx + dz * dz);
  }
  /** Drop cached tiles a landform touches; returns the keys so callers can notify viewers. */
  invalidate(l: Landform): TileKey[] {
    const keys = tilesTouched(l);
    for (const k of keys) { this.tiles.delete(k); this.hashes.delete(k); }
    return keys;
  }
  /** Replace the ground wholesale (e.g. after an edit batch) and invalidate the tiles any changed landform touches. */
  update(next: Ground, changed: Landform[]): TileKey[] {
    this.ground = next;
    const seen = new Set<TileKey>();
    for (const l of changed) for (const k of this.invalidate(l)) seen.add(k);
    return [...seen];
  }
  get cachedTiles(): number { return this.tiles.size; }
  /** Copy-on-write clone: baked tiles are immutable and shared; invalidation only touches the clone's maps. */
  clone(): Terrain { const t = new Terrain(this.ground); t.tiles = new Map(this.tiles); t.hashes = new Map(this.hashes); return t; }
}
