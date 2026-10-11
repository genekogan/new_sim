// Tiled ground navigation (spec <eden4>/31 B1, lane L8): Spatial for big
// worlds. Only worlds whose state carries `groundV1` (entity worlds) use it.
//
//  - Coarse: 1 m media cells over the whole extent (walk / wade / swim / steep /
//    outside), from the ground field's per-tile media rasters. Coarse A* across
//    tiles decides whether a destination is reachable on foot at all, names what
//    is in the way (a cliff, deep water) precisely, and cuts long routes into hops.
//  - Fine: the engine's ordinary 0.1 m walk rasters and exact clearance fields,
//    built lazily per 64 m tile (with a 2 m apron so clearance is exact to 2 m
//    across tile seams) and kept in an LRU. A tile is rebuilt only when the ground
//    recipe or an obstacle reaching it changes.
//  - The engine-facing level-0 grid is a lattice-aligned composite of the tiles of
//    a *window* that always covers every body and every active route; it only grows.
//    Each hop is planned with the existing planner (findRoute) on a composite of
//    just that hop's tiles, so a route never depends on how far the window has grown.
import { datan2, hypot, obbCorners, pointInObb, type Vec2 } from '../core/math.ts';
import { BODY_HEIGHT, STEP, buildGrids, edt, latticeCentre, latticeOf, rasterObb, type GridSet, type LevelGrid } from './grid.ts';
import { findRoute, type Leg, type Place, type RouteOpts, type RouteResult, type WalkLeg } from './path.ts';
import type { AgentProfile, Obstacle, SpatialScene, Surface } from './types.ts';
import { GROUND_TILE_M, G_OUTSIDE, G_STEEP, G_SWIM, G_WADE, G_WALK, MEDIUM_NAMES, coarseMedium, type GroundField } from './ground.ts';

/** Apron (m) around each fine tile: clearance is exact up to this distance across tile seams. */
export const FINE_APRON_M = 2;
/** Fine tiles kept (each 640 × 640 cells, ~2.9 MB). */
export const FINE_LRU = 24;
/** Largest window (tiles per side): 6 × 64 m = 384 m. Routes needing more are refused ('ground.too-far'). */
export const MAX_WINDOW_TILES = 6;
/** Longest hop (m along the coarse path) planned by the fine planner at once. */
export const HOP_M = 48;

export type TileRect = [tx0: number, tz0: number, tx1: number, tz1: number];
type FineTile = { key: string; free: Uint8Array; clearance: Float32Array; blk: Int16Array; ids: string[] };

const tileOf = (v: number) => Math.floor(v / GROUND_TILE_M);
/** Margin (m) a window keeps around what it must cover: a neighbouring tile joins only when a point is this close to it. */
export const WINDOW_MARGIN_M = 12;
/** Tile rect covering points grown by `marginM` metres. */
export function rectOf(points: Vec2[], marginM = WINDOW_MARGIN_M): TileRect {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, z] of points) { const ta = tileOf(x - marginM), tb = tileOf(z - marginM), tc = tileOf(x + marginM), td = tileOf(z + marginM); if (ta < a) a = ta; if (tb < b) b = tb; if (tc > c) c = tc; if (td > d) d = td; }
  return [a, b, c, d];
}
const unionRect = (p: TileRect | null, q: TileRect): TileRect => (p ? [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[2], q[2]), Math.max(p[3], q[3])] : q);
const rectBounds = (r: TileRect): [number, number, number, number] => [r[0] * GROUND_TILE_M, r[1] * GROUND_TILE_M, (r[2] + 1) * GROUND_TILE_M, (r[3] + 1) * GROUND_TILE_M];

/** Grid-relevant identity of an obstacle (as grid.ts obstacleKey). */
const obstacleKey = (o: Obstacle) => `${o.id}|${o.obb.c[0]},${o.obb.c[1]},${o.obb.half[0]},${o.obb.half[1]},${o.obb.yaw}|${o.y0},${o.y1}`;
function fnv(s: string, h = 0x811c9dc5): number { for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h; }

/**
 * LevelGrid.blockers over a composite: per-cell indices into an id table (diagnostics only). The table is filled from the
 * tiles on first use (most composites are never asked), so composing costs only the copies of `free` and `clearance`.
 */
class ComposedBlockers extends Map<number, string> {
  private _cells: Int32Array | null = null; private ids: string[] = []; private n = 0; private fill: (() => { cells: Int32Array; ids: string[] }) | null;
  constructor(fill: () => { cells: Int32Array; ids: string[] }) { super(); this.fill = fill; }
  private get cells(): Int32Array {
    if (!this._cells) { const f = this.fill!(); this.fill = null; this._cells = f.cells; this.ids = f.ids; for (let i = 0; i < f.cells.length; i++) if (f.cells[i] >= 0) this.n++; }
    return this._cells;
  }
  override get size() { void this.cells; return this.n; }
  override get(i: number) { const k = this.cells[i]; return k >= 0 ? this.ids[k] : undefined; }
  override has(i: number) { return this.cells[i] >= 0; }
  override set(i: number, id: string): this { const cells = this.cells; let k = this.ids.indexOf(id); if (k < 0) { k = this.ids.length; this.ids.push(id); } if (cells[i] < 0) this.n++; cells[i] = k; return this; }
  override delete(i: number) { const cells = this.cells; if (!(cells[i] >= 0)) return false; cells[i] = -1; this.n--; return true; }
  override clear() { this.cells.fill(-1); this.n = 0; }
  override *entries(): MapIterator<[number, string]> { const cells = this.cells; for (let i = 0; i < cells.length; i++) if (cells[i] >= 0) yield [i, this.ids[cells[i]]]; }
  override *keys(): MapIterator<number> { for (const [i] of this.entries()) yield i; }
  override *values(): MapIterator<string> { for (const [, v] of this.entries()) yield v; }
  override [Symbol.iterator]() { return this.entries(); }
  override forEach(fn: (v: string, k: number, m: Map<number, string>) => void, thisArg?: unknown) { for (const [k, v] of this.entries()) fn.call(thisArg, v, k, this); }
}

/**
 * Decks (lane A-souls, R2): a level-0 floor slab that lies more than FLOOR_RISE above the ground under it somewhere — a
 * bridge over a river, a pier over a lake, a raised platform — is ground in its own right: where it covers a cell (and
 * lies on or above the ground there), the walker's height is the deck's, the medium is walk (never water or steep), and
 * obstacles (rails) are measured from the deck. The overlay is a GroundField over the recipe's field, so the coarse
 * media, the fine rasters, swimming and settling all see the same thing. No decks: the recipe's field itself.
 * 80/20: the ground under a deck is not walkable separately (one height per cell), and a deck's open sides are entered
 * as from any neighbouring cell — the generators put rails on the open sides of bridges and piers.
 */
export function deckedField(base: GroundField, decks: Surface[], key: string): GroundField {
  const buckets = new Map<string, Surface[]>();
  for (const s of decks) {
    let ax = Infinity, az = Infinity, bx = -Infinity, bz = -Infinity;
    for (const [x, z] of obbCorners(s.obb)) { if (x < ax) ax = x; if (x > bx) bx = x; if (z < az) az = z; if (z > bz) bz = z; }
    for (let j = Math.floor(az / 8); j <= Math.floor(bz / 8); j++) for (let i = Math.floor(ax / 8); i <= Math.floor(bx / 8); i++) {
      const k = `${i},${j}`, l = buckets.get(k); if (l) l.push(s); else buckets.set(k, [s]);
    }
  }
  const deckY = (x: number, z: number): number | null => {
    const l = buckets.get(`${Math.floor(x / 8)},${Math.floor(z / 8)}`); if (!l) return null;
    let y = -Infinity, g = NaN;
    for (const s of l) if (s.y > y && pointInObb([x, z], s.obb)) { if (g !== g) g = base.height(x, z); if (s.y >= g - 0.05) y = s.y; }
    return y === -Infinity ? null : y;
  };
  const tiles = new Map<string, Uint8Array>();
  return {
    id: `${base.id}|decks:${key}`, extent: base.extent, wadeMax: base.wadeMax, maxSlope: base.maxSlope,
    height: (x, z) => deckY(x, z) ?? base.height(x, z),
    waterLevel: (x, z) => (deckY(x, z) === null ? base.waterLevel(x, z) : null),
    medium: (x, z) => (deckY(x, z) === null ? base.medium(x, z) : G_WALK),
    mediaTile: (tx, tz) => {
      const k = `${tx},${tz}`; let m = tiles.get(k); if (m) return m;
      m = base.mediaTile(tx, tz);
      const x0 = tx * GROUND_TILE_M, z0 = tz * GROUND_TILE_M;
      if (buckets.size && [...buckets.keys()].some((b) => { const [i, j] = b.split(',').map(Number); return i * 8 < x0 + GROUND_TILE_M && i * 8 + 8 > x0 && j * 8 < z0 + GROUND_TILE_M && j * 8 + 8 > z0; })) {
        m = m.slice();
        for (let j = 0; j < GROUND_TILE_M; j++) for (let i = 0; i < GROUND_TILE_M; i++) if (deckY(x0 + i + 0.5, z0 + j + 0.5) !== null) m[j * GROUND_TILE_M + i] = G_WALK;
      }
      tiles.set(k, m);
      return m;
    },
  };
}

export class GroundNav {
  /** The recipe's field; `field` is it, or it overlaid with decks (setFloors). */
  readonly base: GroundField;
  field: GroundField;
  readonly cell: number;
  /** Fine cells per tile edge (640 at 0.1 m). */
  readonly per: number;
  readonly apron: number;
  /** Tiles the engine-facing grids cover (inclusive); grows only. */
  window: TileRect | null = null;
  /** Counters for tests and the status page. */
  stats = { fineBuilds: 0, fineHits: 0, composites: 0, coarseExpanded: 0 };
  private fine = new Map<string, FineTile>();
  private composed = new Map<string, LevelGrid>();
  /**
   * Paged navigation (lane NAV, worlds whose ground fact says `nav: 'paged/1'`): no single grow-only window. The engine
   * faces a set of small windows (Spatial clusters, one per group of nearby bodies and their current walk chunks), routes
   * are planned a chunk (one coarse hop) at a time, and the tile caches are sized to what the windows hold. Off: as before.
   */
  readonly paged: boolean;
  /** Fine tiles kept (paged: at least the windows' tiles); composites kept. */
  fineMax = FINE_LRU;
  composedMax = 4;

  constructor(field: GroundField, cell = 0.1, opts: { paged?: boolean } = {}) {
    this.base = this.field = field; this.cell = cell; this.paged = !!opts.paged;
    this.per = Math.round(GROUND_TILE_M / cell);
    if (Math.abs(this.per * cell - GROUND_TILE_M) > 1e-9) throw new Error('ground: the cell must divide the 64 m tile');
    this.apron = Math.round(FINE_APRON_M / cell);
  }

  /** Level-0 floors laid over the ground (a house's ground-floor slab, a deck at grade), bucketed by 8 m cell. */
  private floors = new Map<string, Surface[]>();
  /** Floor slabs at most this far above the ground there raise the standing height to the slab (m). */
  static FLOOR_RISE = 0.5;
  private deckKey = '';
  setFloors(surfaces: Surface[]) {
    // decks first (they change the field the floors below are measured on)
    const b = this.base, decks = surfaces.filter((s) => [s.obb.c as Vec2, ...obbCorners(s.obb)].some(([x, z]) => s.y > b.height(x, z) + GroundNav.FLOOR_RISE));
    const key = decks.length ? fnv(decks.map((s) => `${s.id}:${s.y}:${s.obb.c}:${s.obb.half}:${s.obb.yaw}`).join('|')).toString(16) : '';
    if (key !== this.deckKey) { this.deckKey = key; this.field = key ? deckedField(b, decks, key) : b; this.composed.clear(); }
    this.floors.clear();
    for (const s of surfaces) {
      let ax = Infinity, az = Infinity, bx = -Infinity, bz = -Infinity;
      for (const [x, z] of obbCorners(s.obb)) { if (x < ax) ax = x; if (x > bx) bx = x; if (z < az) az = z; if (z > bz) bz = z; }
      for (let j = Math.floor(az / 8); j <= Math.floor(bz / 8); j++) for (let i = Math.floor(ax / 8); i <= Math.floor(bx / 8); i++) {
        const k = `${i},${j}`, l = this.floors.get(k); if (l) l.push(s); else this.floors.set(k, [s]);
      }
    }
  }
  /** Large solids (both half-extents ≥ 1.25 m, in the body band above the ground) as coarse 1 m blockers, bucketed by 8 m cell. */
  private solids = new Map<string, Obstacle[]>();
  static SOLID_MIN_HALF = 1.25;
  setSolids(obstacles: Obstacle[]) {
    this.solids.clear();
    for (const o of obstacles) {
      if (Math.min(o.obb.half[0], o.obb.half[1]) < GroundNav.SOLID_MIN_HALF) continue;
      const h = this.field.height(o.obb.c[0], o.obb.c[1]);
      if (o.y1 <= h + STEP || o.y0 >= h + BODY_HEIGHT) continue;
      let ax = Infinity, az = Infinity, bx = -Infinity, bz = -Infinity;
      for (const [x, z] of obbCorners(o.obb)) { if (x < ax) ax = x; if (x > bx) bx = x; if (z < az) az = z; if (z > bz) bz = z; }
      for (let j = Math.floor(az / 8); j <= Math.floor(bz / 8); j++) for (let i = Math.floor(ax / 8); i <= Math.floor(bx / 8); i++) {
        const k = `${i},${j}`, l = this.solids.get(k); if (l) l.push(o); else this.solids.set(k, [o]);
      }
    }
  }
  /** Whether the 1 m cell centred at (x, z) lies well inside a large solid (0.75 m in from its edge). */
  coarseSolid(x: number, z: number): boolean {
    if (!this.solids.size) return false;
    const l = this.solids.get(`${Math.floor(x / 8)},${Math.floor(z / 8)}`);
    if (l) for (const o of l) if (pointInObb([x, z], { c: o.obb.c, half: [o.obb.half[0] - 0.75, o.obb.half[1] - 0.75], yaw: o.obb.yaw })) return true;
    return false;
  }

  /** Where a body's feet are on level 0 at (x, z): the ground, or a floor slab laid on it (within FLOOR_RISE above). */
  standY(x: number, z: number): number {
    let h = this.field.height(x, z);
    if (!this.floors.size) return h;
    const l = this.floors.get(`${Math.floor(x / 8)},${Math.floor(z / 8)}`);
    if (l) { const g = h; for (const s of l) if (s.y > h && s.y >= g - 0.05 && s.y <= g + GroundNav.FLOOR_RISE && pointInObb([x, z], s.obb)) h = s.y; }
    return h;
  }

  /** Grow the window to cover `r`: 'same' | 'grown' | 'too-big' (then nothing changes). */
  include(r: TileRect): 'same' | 'grown' | 'too-big' {
    const ext = this.extentTiles(), q: TileRect = [Math.max(r[0], ext[0]), Math.max(r[1], ext[1]), Math.min(r[2], ext[2]), Math.min(r[3], ext[3])];
    if (q[0] > q[2] || q[1] > q[3]) return 'same';
    const next = unionRect(this.window, q);
    if (this.window && next.every((v, k) => v === this.window![k])) return 'same';
    if (next[2] - next[0] + 1 > MAX_WINDOW_TILES || next[3] - next[1] + 1 > MAX_WINDOW_TILES) return 'too-big';
    this.window = next;
    return 'grown';
  }
  extentTiles(): TileRect { const e = this.field.extent; return [tileOf(e[0]), tileOf(e[1]), tileOf(e[2] - 1e-6), tileOf(e[3] - 1e-6)]; }
  bounds(): [number, number, number, number] { return rectBounds(this.window ?? [0, 0, 0, 0]); }
  boundsOf(r: TileRect): [number, number, number, number] { return rectBounds(r); }

  // ---------------------------------------------------------------- fine tiles

  private relevant(obstacles: Obstacle[], tx: number, tz: number, boxes: Float64Array): Obstacle[] {
    const pad = FINE_APRON_M + this.cell, x0 = tx * GROUND_TILE_M - pad, z0 = tz * GROUND_TILE_M - pad, x1 = x0 + GROUND_TILE_M + 2 * pad, z1 = z0 + GROUND_TILE_M + 2 * pad;
    const out: Obstacle[] = [];
    for (let k = 0; k < obstacles.length; k++) if (boxes[4 * k + 2] >= x0 && boxes[4 * k] <= x1 && boxes[4 * k + 3] >= z0 && boxes[4 * k + 1] <= z1) out.push(obstacles[k]);
    return out;
  }
  private keyOf(tx: number, tz: number, rel: Obstacle[]): string {
    let h = fnv(`${this.field.id}|${tx},${tz}|${rel.length}`), h2 = 0x050c5d1f;
    for (const o of rel) { const k = obstacleKey(o); h = fnv(k, h); h2 = fnv(k, h2 ^ 0x9e3779b9); }
    return `${tx},${tz}:${h.toString(16)}${h2.toString(16)}`;
  }

  /** One tile's fine level-0 raster: ground media, then obstacles in the body band above the ground there, then the exact EDT. */
  fineTile(tx: number, tz: number, rel: Obstacle[], key = this.keyOf(tx, tz, rel)): FineTile {
    const hit = this.fine.get(key);
    if (hit) { this.fine.delete(key); this.fine.set(key, hit); this.stats.fineHits++; return hit; }
    this.stats.fineBuilds++;
    const { per, apron: A, cell, field } = this;
    const M = per + 2 * A, ox = tx * per - A, oz = tz * per - A;
    const free = new Uint8Array(M * M), blk = new Int16Array(M * M).fill(-1), ids: string[] = ['ground:outside', 'ground:steep', 'ground:water'];
    // coarse media around the apron'd tile (1 m cells), and which cells touch water
    const c0x = Math.floor(latticeCentre(ox, cell)) - 1, c0z = Math.floor(latticeCentre(oz, cell)) - 1;
    const cw = Math.floor(latticeCentre(ox + M - 1, cell)) + 2 - c0x;
    const coarse = new Uint8Array(cw * cw), wet = new Uint8Array(cw * cw);
    for (let j = 0; j < cw; j++) for (let i = 0; i < cw; i++) coarse[j * cw + i] = coarseMedium(field, c0x + i + 0.5, c0z + j + 0.5);
    for (let j = 0; j < cw; j++) for (let i = 0; i < cw; i++) {
      let w = 0;
      for (let dj = -1; dj <= 1 && !w; dj++) for (let di = -1; di <= 1; di++) {
        const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= cw || b >= cw) continue;
        const c = coarse[b * cw + a]; if (c === G_WADE || c === G_SWIM) { w = 1; break; }
      }
      wet[j * cw + i] = w;
    }
    for (let j = 0; j < M; j++) {
      const z = latticeCentre(oz + j, cell), cj = Math.floor(z) - c0z;
      for (let i = 0; i < M; i++) {
        const x = latticeCentre(ox + i, cell), ci = Math.floor(x) - c0x, k = j * M + i, c = coarse[cj * cw + ci];
        if (c === G_OUTSIDE) { blk[k] = 0; continue; }
        if (c === G_STEEP) { blk[k] = 1; continue; }
        if (wet[cj * cw + ci]) {
          const lvl = field.waterLevel(x, z);
          if (lvl !== null && lvl - field.height(x, z) > field.wadeMax + 1e-4) { blk[k] = 2; continue; }
        }
        free[k] = 1;
      }
    }
    // obstacles in the body band above the ground at each cell (first listed names the cell, as stampLevel)
    for (const o of rel) {
      let idx = -1;
      rasterObb(o.obb, ox, oz, cell, M, M, (k) => {
        if (!free[k]) return;
        const x = latticeCentre(ox + (k % M), cell), z = latticeCentre(oz + Math.floor(k / M), cell), h = field.height(x, z);
        if (o.y1 <= h + STEP || o.y0 >= h + BODY_HEIGHT) return;
        if (idx < 0) { idx = ids.length; ids.push(o.id); if (idx > 32000) throw new Error('ground: too many obstacles in one tile'); }
        free[k] = 0; blk[k] = idx;
      }, true);
    }
    const clear = edt(free, M, M, cell);
    // crop to the tile
    const t: FineTile = { key, free: new Uint8Array(per * per), clearance: new Float32Array(per * per), blk: new Int16Array(per * per), ids };
    for (let j = 0; j < per; j++) {
      const src = (j + A) * M + A;
      t.free.set(free.subarray(src, src + per), j * per);
      t.clearance.set(clear.subarray(src, src + per), j * per);
      t.blk.set(blk.subarray(src, src + per), j * per);
    }
    this.fine.set(key, t);
    while (this.fine.size > this.fineMax) this.fine.delete(this.fine.keys().next().value!);
    return t;
  }

  /** Level-0 grid over a tile rect: the fine tiles side by side on the global lattice (the last few are memoised). */
  compose(r: TileRect, obstacles: Obstacle[]): LevelGrid {
    const boxes = boxesOf(obstacles);
    const tiles: { tx: number; tz: number; rel: Obstacle[]; key: string }[] = [];
    for (let tz = r[1]; tz <= r[3]; tz++) for (let tx = r[0]; tx <= r[2]; tx++) { const rel = this.relevant(obstacles, tx, tz, boxes); tiles.push({ tx, tz, rel, key: this.keyOf(tx, tz, rel) }); }
    const ckey = r.join(',') + '|' + tiles.map((t) => t.key).join(';');
    const memo = this.composed.get(ckey);
    if (memo) { this.composed.delete(ckey); this.composed.set(ckey, memo); return memo; }
    const { per, cell } = this, ntx = r[2] - r[0] + 1, ntz = r[3] - r[1] + 1, nx = ntx * per, nz = ntz * per;
    const free = new Uint8Array(nx * nz), clearance = new Float32Array(nx * nz), parts: { ft: { blk: Int16Array; ids: string[] }; gx: number; gz: number }[] = [];
    for (const t of tiles) {
      const ft = this.fineTile(t.tx, t.tz, t.rel, t.key), gx = (t.tx - r[0]) * per, gz = (t.tz - r[1]) * per;
      parts.push({ ft: { blk: ft.blk, ids: ft.ids }, gx, gz });
      for (let j = 0; j < per; j++) {
        const dst = (gz + j) * nx + gx, src = j * per;
        free.set(ft.free.subarray(src, src + per), dst);
        clearance.set(ft.clearance.subarray(src, src + per), dst);
      }
    }
    // blocker ids per cell, in the same order as before (tiles row-major, each tile's own table), built when first read
    const fillBlockers = () => {
      const cells = new Int32Array(nx * nz).fill(-1), ids: string[] = [], idOf = new Map<string, number>();
      for (const { ft, gx, gz } of parts) {
        const map = ft.ids.map((id) => { let k = idOf.get(id); if (k === undefined) { k = ids.length; ids.push(id); idOf.set(id, k); } return k; });
        for (let j = 0; j < per; j++) { const dst = (gz + j) * nx + gx, src = j * per; for (let i = 0; i < per; i++) { const b = ft.blk[src + i]; if (b >= 0) cells[dst + i] = map[b]; } }
      }
      return { cells, ids };
    };
    const ox = r[0] * per, oz = r[1] * per;
    const lat = latticeOf(rectBounds(r), cell);
    if (lat.ox !== ox || lat.oz !== oz || lat.nx !== nx || lat.nz !== nz) throw new Error('ground: tile lattice mismatch');
    const grid: LevelGrid = { level: 0, y: 0, cell, nx, nz, ox, oz, x0: ox * cell, z0: oz * cell, free, clearance, blockers: new ComposedBlockers(fillBlockers) };
    this.stats.composites++;
    this.composed.set(ckey, grid);
    while (this.composed.size > this.composedMax) this.composed.delete(this.composed.keys().next().value!);
    return grid;
  }

  /** All levels over the window: level 0 composed from tiles; upper levels (decks, floors) as ordinary flat grids. */
  grids(scene: SpatialScene): GridSet {
    const levels = new Map<number, LevelGrid>();
    levels.set(0, this.compose(this.window!, scene.obstacles));
    const upper = scene.levels.filter((l) => l.id !== 0);
    if (upper.length) for (const [id, g] of buildGrids({ ...scene, levels: upper }, this.cell).levels) levels.set(id, g);
    return { cell: this.cell, levels };
  }

  /**
   * Paged: all levels over a tile rect, on the rect's own lattice — level 0 composed from tiles, each upper level (a deck,
   * a floor) that has a surface reaching the rect built flat over it (so multi-level routes and walkers on upper floors
   * see the same lattice as level 0).
   */
  gridsOver(r: TileRect, scene: SpatialScene): GridSet {
    const levels = new Map<number, LevelGrid>(), b = rectBounds(r);
    levels.set(0, this.compose(r, scene.obstacles));
    const upper = scene.levels.filter((l) => l.id !== 0 && scene.surfaces.some((s) => s.level === l.id && touches(s.obb, b)));
    if (upper.length) for (const [id, g] of buildGrids({ ...scene, bounds: b, levels: upper }, this.cell).levels) levels.set(id, g);
    return { cell: this.cell, levels };
  }

  // ---------------------------------------------------------------- coarse routing

  /**
   * A* over 1 m cells (8-connected, no corner cutting) inside `box` (cells), with a cost per medium
   * (Infinity = impassable). Returns cell-centre waypoints from start to goal, or null.
   */
  coarsePath(from: Vec2, to: Vec2, cost: readonly number[], marginM = 48, maxExpand = 600_000): Vec2[] | null {
    const e = this.field.extent;
    const bx0 = Math.max(Math.floor(e[0]), Math.floor(Math.min(from[0], to[0]) - marginM)), bz0 = Math.max(Math.floor(e[1]), Math.floor(Math.min(from[1], to[1]) - marginM));
    const bx1 = Math.min(Math.ceil(e[2]) - 1, Math.floor(Math.max(from[0], to[0]) + marginM)), bz1 = Math.min(Math.ceil(e[3]) - 1, Math.floor(Math.max(from[1], to[1]) + marginM));
    const W = bx1 - bx0 + 1, H = bz1 - bz0 + 1;
    if (W <= 0 || H <= 0) return null;
    const idx = (x: number, z: number) => (Math.floor(z) - bz0) * W + (Math.floor(x) - bx0);
    const s = idx(from[0], from[1]), g = idx(to[0], to[1]);
    if (s < 0 || g < 0 || s >= W * H || g >= W * H) return null;
    const med = new Uint8Array(W * H).fill(255);
    const m = (k: number) => { let v = med[k]; if (v === 255) { const x = bx0 + (k % W) + 0.5, z = bz0 + Math.floor(k / W) + 0.5; v = med[k] = this.coarseSolid(x, z) ? G_SOLID : coarseMedium(this.field, x, z); } return v; };
    const gs = new Float64Array(W * H).fill(Infinity), came = new Int32Array(W * H).fill(-1), shut = new Uint8Array(W * H);
    const gxC = g % W, gzC = Math.floor(g / W);
    const h = (k: number) => { const dx = Math.abs((k % W) - gxC), dz = Math.abs(Math.floor(k / W) - gzC); return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz); };
    const heap = new MinHeap();
    gs[s] = 0; heap.push(s, h(s));
    let expanded = 0;
    while (heap.size) {
      const cur = heap.pop();
      if (shut[cur]) continue; shut[cur] = 1;
      if (cur === g) break;
      if (++expanded > maxExpand) break;
      const ci = cur % W, cj = Math.floor(cur / W);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        // the goal's own 1 m cell is always enterable: the fine check already admitted the exact point (a cell's centre may
        // read steep or deep where the goal itself, at its edge, is fine)
        const n = nj * W + ni, c = n === g ? Math.min(cost[m(n)], 2) : cost[m(n)];
        if (!(c < Infinity)) continue;
        if (di && dj && (!(cost[m(cj * W + ni)] < Infinity) || !(cost[m(nj * W + ci)] < Infinity))) continue;
        const t = gs[cur] + (di && dj ? Math.SQRT2 : 1) * c;
        if (t < gs[n]) { gs[n] = t; came[n] = cur; heap.push(n, t + h(n)); }
      }
    }
    this.stats.coarseExpanded += expanded;
    if (!shut[g]) return null;
    const cellsOut: number[] = [];
    for (let k = g; k >= 0; k = came[k]) cellsOut.push(k);
    cellsOut.reverse();
    return cellsOut.map((k) => [bx0 + (k % W) + 0.5, bz0 + Math.floor(k / W) + 0.5] as Vec2);
  }
}

/** Whether an obb's bounding box meets the bounds [x0, z0, x1, z1]. */
function touches(o: { c: Vec2; half: Vec2; yaw: number }, b: [number, number, number, number]): boolean {
  let ax = Infinity, az = Infinity, bx = -Infinity, bz = -Infinity;
  for (const [x, z] of obbCorners(o)) { if (x < ax) ax = x; if (x > bx) bx = x; if (z < az) az = z; if (z > bz) bz = z; }
  return bx >= b[0] && ax <= b[2] && bz >= b[1] && az <= b[3];
}

/**
 * Paged windows: unit rects (a body's neighbourhood, a walker's chunk) merged while two share a tile and their union
 * stays ≤ `max` tiles a side. Canonical: sorted first, then merged greedily, so the same set of units always gives the
 * same windows (live and restored engines agree).
 */
export function clusterRects(units: TileRect[], max = MAX_WINDOW_TILES): TileRect[] {
  const cmp = (p: TileRect, q: TileRect) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2] || p[3] - q[3];
  const rs = units.map((u) => [...u] as TileRect).sort(cmp).filter((u, i, a) => i === 0 || cmp(u, a[i - 1]) !== 0);
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < rs.length && !merged; i++) for (let j = i + 1; j < rs.length; j++) {
      const p = rs[i], q = rs[j];
      if (p[0] > q[2] || q[0] > p[2] || p[1] > q[3] || q[1] > p[3]) continue;
      const u = unionRect(p, q);
      if (u[2] - u[0] + 1 > max || u[3] - u[1] + 1 > max) continue;
      rs[i] = u; rs.splice(j, 1); merged = true; break;
    }
  }
  return rs.sort(cmp);
}

function boxesOf(obstacles: Obstacle[]): Float64Array {
  const b = new Float64Array(obstacles.length * 4);
  obstacles.forEach((o, k) => {
    let ax = Infinity, az = Infinity, bx = -Infinity, bz = -Infinity;
    for (const [x, z] of obbCorners(o.obb)) { if (x < ax) ax = x; if (x > bx) bx = x; if (z < az) az = z; if (z > bz) bz = z; }
    b[4 * k] = ax; b[4 * k + 1] = az; b[4 * k + 2] = bx; b[4 * k + 3] = bz;
  });
  return b;
}

class MinHeap {
  private k: number[] = []; private v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, pri: number) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(pri);
    while (i > 0) { const p = (i - 1) >> 1; if (v[p] <= pri) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = pri;
  }
  pop(): number {
    const k = this.k, v = this.v, top = k[0], lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      let i = 0; const n = k.length;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i, mv = lv; if (l < n && v[l] < mv) { m = l; mv = v[l]; } if (r < n && v[r] < mv) { m = r; mv = v[r]; } if (m === i) break; k[i] = k[m]; v[i] = v[m]; i = m; }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

// ---------------------------------------------------------------- hierarchical route

/** Coarse code of a 1 m cell inside a large solid (coarse routing only; never in a media tile). */
export const G_SOLID = 5;
/** Costs per medium for walking (walk, wade, swim, steep, outside, solid). Dry ground is preferred to the shallows. */
export const WALK_COST = [1, 2, Infinity, Infinity, Infinity, Infinity] as const;
/** Costs for explaining a refused walk: what is the cheapest thing in the way. */
const EXPLAIN_COST = [1, 2, 8, 60, Infinity, Infinity] as const;
/** Costs for swimming: water first, the shallows and a little dry ground to step in and out. */
export const SWIM_COST = [3, 1.5, 1, Infinity, Infinity, Infinity] as const;

const fmt = (p: Vec2) => `${p[0].toFixed(1)}, ${p[1].toFixed(1)}`;
const failR = (code: string, message: string, at?: Place): RouteResult => ({ ok: false, diagnostic: { code, message, subjects: [], ...(at ? { at: [at.p[0], 0, at.p[1]] as [number, number, number] } : {}) } });

/** Why a body cannot be (or stand) at a point on the ground, or null. */
export function groundGoalIssue(f: GroundField, p: Vec2, place = 'destination'): RouteResult | null {
  const m = f.medium(p[0], p[1]);
  if (m === G_OUTSIDE) return failR('ground.outside', `the ${place} (${fmt(p)}) lies beyond the edge of the world`);
  if (m === G_SWIM) { const lvl = f.waterLevel(p[0], p[1]) ?? 0; return failR('ground.deep-water', `the ${place} (${fmt(p)}) is in water ${(lvl - f.height(p[0], p[1])).toFixed(1)} m deep (wading stops at ${f.wadeMax} m); swim there instead`); }
  if (m === G_STEEP) return failR('ground.steep', `the ${place} (${fmt(p)}) is on ground steeper than ${slopeDeg(f.maxSlope)}° (a cliff); no footing there`);
  return null;
}
const slopeDeg = (s: number) => Math.round((datan2(s, 1) * 180) / Math.PI);

/** The hierarchical walk planner for ground worlds. `include` grows the engine window (false: too big). */
export function groundRoute(nav: GroundNav, scene: SpatialScene, profile: AgentProfile, start: Place, goal: Place, opts: RouteOpts, include: (r: TileRect) => boolean, windowGrids: () => GridSet): RouteResult {
  if (nav.paged) return pagedRoute(nav, scene, profile, start, goal, opts);
  const f = nav.field;
  if (start.level !== 0 || goal.level !== 0) {
    if (!include(rectOf([start.p, goal.p]))) return failR('ground.too-far', `(${fmt(goal.p)}) is too far to plan in one walk; walk part of the way first`, goal);
    return findRoute(windowGrids(), scene, profile, start, goal, opts);
  }
  const goalIssue = groundGoalIssue(f, goal.p);
  if (goalIssue) return goalIssue;
  const sm = f.medium(start.p[0], start.p[1]);
  if (sm === G_SWIM) return failR('ground.in-water', `you are swimming (${fmt(start.p)}); swim to the shore before walking`, start);
  // the coarse search looks 48 m around the straight line first, then wider (a way round a long cliff)
  const path = nav.coarsePath(start.p, goal.p, WALK_COST) ?? nav.coarsePath(start.p, goal.p, WALK_COST, 160, 2_000_000);
  if (!path) {
    const alt = nav.coarsePath(start.p, goal.p, EXPLAIN_COST, 96);
    if (alt) for (const q of alt) {
      const m = coarseMedium(f, q[0], q[1]);
      if (m === G_STEEP) return failR('ground.cliff', `no footpath to (${fmt(goal.p)}): ground steeper than ${slopeDeg(f.maxSlope)}° (a cliff) is in the way at (${fmt(q)})`, { level: 0, p: q });
      if (m === G_SWIM) return failR('ground.deep-water', `no footpath to (${fmt(goal.p)}): water deeper than ${f.wadeMax} m is in the way at (${fmt(q)}); swim across or go round`, { level: 0, p: q });
    }
    return failR('ground.unreachable', `no way on foot from (${fmt(start.p)}) to (${fmt(goal.p)})`, goal);
  }
  // hops along the coarse path, each planned by the fine planner on just its own tiles
  const hops: { to: Vec2; via: Vec2[] }[] = [];
  let acc = 0, via: Vec2[] = [];
  for (let k = 1; k < path.length; k++) {
    acc += hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]); via.push(path[k]);
    if (acc >= HOP_M && k < path.length - 4) { hops.push({ to: path[k], via }); acc = 0; via = []; }
  }
  hops.push({ to: goal.p, via });
  const legs: Leg[] = [];
  let from: Place = start, length = 0, expanded = 0;
  for (let h = 0; h < hops.length; h++) {
    const last = h === hops.length - 1, target: Place = { level: 0, p: hops[h].to };
    const r = rectOf([from.p, target.p, ...hops[h].via]);
    if (!include(r)) return failR('ground.too-far', `(${fmt(goal.p)}) is too far to walk to in one go; walk part of the way first`, goal);
    const grids: GridSet = { cell: nav.cell, levels: new Map([[0, nav.compose(r, scene.obstacles)]]) };
    const res = findRoute(grids, { ...scene, bounds: rectBounds(r), links: [] }, profile, from, target, last ? opts : { ...opts, goalTolerance: 2.5 });
    if (!res.ok) return res;
    for (const leg of res.route.legs) appendLeg(legs, leg);
    length += res.route.length; expanded += res.route.expanded;
    const end = (res.route.legs.at(-1) as WalkLeg | undefined)?.points.at(-1);
    from = { level: 0, p: end ?? target.p };
  }
  return { ok: true, route: { legs, length, expanded } };
}

/** Paged: start and goal this close (m) are routed in one go (any levels); farther, a chunk at a time on level 0. */
export const PAGED_DIRECT_M = 72;

/**
 * Paged planner (lane NAV): the coarse path proves the whole way (and names what is in the way, as groundRoute), but only
 * its first hop is planned fine; the route then carries `rest` (the real goal) and the walker plans the next chunk before
 * it reaches the end of this one. A goal on another level is approached on level 0 until it is within PAGED_DIRECT_M.
 */
export function pagedRoute(nav: GroundNav, scene: SpatialScene, profile: AgentProfile, start: Place, goal: Place, opts: RouteOpts): RouteResult {
  const f = nav.field, direct = hypot(goal.p[0] - start.p[0], goal.p[1] - start.p[1]) <= PAGED_DIRECT_M;
  if (start.level !== 0 || goal.level !== 0) {
    if (direct) { const r = rectOf([start.p, goal.p]); return findRoute(nav.gridsOver(r, scene), { ...scene, bounds: rectBounds(r) }, profile, start, goal, opts); }
    if (start.level !== 0) return failR('ground.too-far', `(${fmt(goal.p)}) is too far to plan from an upper floor; walk down first`, goal);
  } else {
    const goalIssue = groundGoalIssue(f, goal.p);
    if (goalIssue) return goalIssue;
  }
  const sm = f.medium(start.p[0], start.p[1]);
  if (sm === G_SWIM) return failR('ground.in-water', `you are swimming (${fmt(start.p)}); swim to the shore before walking`, start);
  const path = nav.coarsePath(start.p, goal.p, WALK_COST) ?? nav.coarsePath(start.p, goal.p, WALK_COST, 160, 2_000_000);
  if (!path) {
    const alt = nav.coarsePath(start.p, goal.p, EXPLAIN_COST, 96);
    if (alt) for (const q of alt) {
      const m = coarseMedium(f, q[0], q[1]);
      if (m === G_STEEP) return failR('ground.cliff', `no footpath to (${fmt(goal.p)}): ground steeper than ${slopeDeg(f.maxSlope)}° (a cliff) is in the way at (${fmt(q)})`, { level: 0, p: q });
      if (m === G_SWIM) return failR('ground.deep-water', `no footpath to (${fmt(goal.p)}): water deeper than ${f.wadeMax} m is in the way at (${fmt(q)}); swim across or go round`, { level: 0, p: q });
    }
    return failR('ground.unreachable', `no way on foot from (${fmt(start.p)}) to (${fmt(goal.p)})`, goal);
  }
  // the first hop (as groundRoute cuts them); the last one ends at the goal itself
  let acc = 0, k = 1;
  for (; k < path.length; k++) { acc += hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]); if (acc >= HOP_M && k < path.length - 4) break; }
  const last = k >= path.length && goal.level === 0, target: Vec2 = last ? goal.p : path[Math.min(k, path.length - 1)];
  const r = rectOf([start.p, target, ...path.slice(1, k + 1)]);
  const grids: GridSet = { cell: nav.cell, levels: new Map([[0, nav.compose(r, scene.obstacles)]]) };
  const res = findRoute(grids, { ...scene, bounds: rectBounds(r), links: [] }, profile, start, { level: 0, p: target }, last ? opts : { ...opts, goalTolerance: 2.5 });
  if (!res.ok || last) return res;
  // length: this chunk's, plus the coarse path's remainder (an estimate of the whole walk, e.g. routeEstimateV1)
  let more = 0;
  for (let j = Math.min(k, path.length - 1) + 1; j < path.length; j++) more += hypot(path[j][0] - path[j - 1][0], path[j][1] - path[j - 1][1]);
  return { ok: true, route: { ...res.route, length: res.route.length + more, rest: goal } };
}

function appendLeg(legs: Leg[], leg: Leg) {
  const prev = legs.at(-1);
  if (prev?.kind === 'walk' && leg.kind === 'walk' && prev.level === leg.level) {
    const a = prev.points.at(-1)!, b = leg.points[0];
    const pts = a[0] === b[0] && a[1] === b[1] ? leg.points.slice(1) : leg.points;
    legs[legs.length - 1] = { ...prev, points: [...prev.points, ...pts], minClearance: Math.min(prev.minClearance, leg.minClearance) };
  } else legs.push(leg);
}

export { MEDIUM_NAMES, G_WALK, G_WADE, G_SWIM, G_STEEP, G_OUTSIDE };
