// Per-level walkability rasters + exact Euclidean clearance fields.
// Deterministic, allocation-light and pure TS so it runs in the Durable
// Object as well as the browser. Rebuilt (or patched) when construction
// changes the scene.
import { obbCorners, obbOverlap, pointInObb, type OBB2, type Vec2 } from '../core/math.ts';
import type { Obstacle, SpatialScene } from './types.ts';

export type LevelGrid = {
  level: number;
  y: number;
  cell: number;
  nx: number;
  nz: number;
  x0: number;
  z0: number;
  /** 1 = floor present and free of obstacles at body height. */
  free: Uint8Array;
  /** Distance (m) from cell centre to the nearest non-free cell (0 on blocked cells). */
  clearance: Float32Array;
  /** Obstacle id blocking each cell (for diagnostics), '' when free/void. */
  blockers: Map<number, string>;
};

export type GridSet = { cell: number; levels: Map<number, LevelGrid> };

const BODY_HEIGHT = 1.8;
const STEP = 0.22;

/**
 * Memoised rasters of a fixed obstacle list (a static base scene, e.g. the 2.7k campus obstacles):
 * per level height, the index of the first listed obstacle covering each cell (conservative
 * raster, −1 none). buildGrids given this `prefix` skips re-rasterising those obstacles when they
 * lead `scene.obstacles` — same free cells and blockers, since obstacles only clear cells and the
 * first one to clear a floor cell names it.
 */
export class StaticRaster {
  readonly obstacles: Obstacle[];
  readonly bounds: [number, number, number, number];
  readonly cell: number;
  private byY = new Map<number, Int32Array>();

  constructor(obstacles: Obstacle[], bounds: [number, number, number, number], cell: number) {
    this.obstacles = obstacles.slice(); // snapshot: fits() compares element identity
    this.bounds = bounds;
    this.cell = cell;
  }

  /** Whether `scene` (at `cell`) starts with exactly these obstacles on the same raster. */
  fits(scene: SpatialScene, cell: number): boolean {
    if (cell !== this.cell || scene.obstacles.length < this.obstacles.length || scene.bounds.some((b, k) => b !== this.bounds[k])) return false;
    for (let k = 0; k < this.obstacles.length; k++) if (scene.obstacles[k] !== this.obstacles[k]) return false;
    return true;
  }

  firstCover(y: number): Int32Array {
    let m = this.byY.get(y);
    if (m) return m;
    const [minX, minZ, maxX, maxZ] = this.bounds, cell = this.cell;
    const nx = Math.ceil((maxX - minX) / cell), nz = Math.ceil((maxZ - minZ) / cell);
    const cover = new Int32Array(nx * nz).fill(-1);
    this.obstacles.forEach((o, k) => {
      if (o.y1 <= y + STEP || o.y0 >= y + BODY_HEIGHT) return;
      rasterObb(o.obb, minX, minZ, cell, nx, nz, (i) => { if (cover[i] < 0) cover[i] = k; }, true);
    });
    if (this.byY.size >= 8) this.byY.delete(this.byY.keys().next().value!);
    this.byY.set(y, cover);
    return cover;
  }
}

export function buildGrids(scene: SpatialScene, cell = 0.1, prefix?: StaticRaster): GridSet {
  const [minX, minZ, maxX, maxZ] = scene.bounds;
  const nx = Math.ceil((maxX - minX) / cell), nz = Math.ceil((maxZ - minZ) / cell);
  const levels = new Map<number, LevelGrid>();
  const pre = prefix?.fits(scene, cell) ? prefix : undefined;
  for (const lv of scene.levels) {
    const free = new Uint8Array(nx * nz);
    const blockers = new Map<number, string>();
    for (const s of scene.surfaces) if (s.level === lv.id) rasterObb(s.obb, minX, minZ, cell, nx, nz, (i) => (free[i] = 1));
    if (pre) {
      const cover = pre.firstCover(lv.y);
      for (let i = 0; i < cover.length; i++) if (cover[i] >= 0 && free[i]) { blockers.set(i, pre.obstacles[cover[i]].id); free[i] = 0; }
    }
    for (let k = pre ? pre.obstacles.length : 0; k < scene.obstacles.length; k++) {
      const o = scene.obstacles[k];
      if (o.y1 <= lv.y + STEP || o.y0 >= lv.y + BODY_HEIGHT) continue; // below step height or overhead
      rasterObb(o.obb, minX, minZ, cell, nx, nz, (i) => {
        if (free[i]) blockers.set(i, o.id);
        free[i] = 0;
      }, true);
    }
    levels.set(lv.id, { level: lv.id, y: lv.y, cell, nx, nz, x0: minX, z0: minZ, free, clearance: edt(free, nx, nz, cell), blockers });
  }
  return { cell, levels };
}

/**
 * `base` (built by buildGrids from some scene) with `extra` obstacles appended to that scene.
 * Bit-identical to rebuilding: obstacles only ever clear cells, so copy the base rasters, stamp
 * the extras with the same rule and order, and rerun the exact EDT. Rasterising the base
 * obstacles (thousands on the campus) dominates buildGrids; this skips it.
 */
export function gridsWithObstacles(base: GridSet, extra: Obstacle[]): GridSet {
  const levels = new Map<number, LevelGrid>();
  for (const [id, g] of base.levels) {
    let free: Uint8Array | null = null;
    let blockers = g.blockers;
    for (const o of extra) {
      if (o.y1 <= g.y + STEP || o.y0 >= g.y + BODY_HEIGHT) continue;
      rasterObb(o.obb, g.x0, g.z0, g.cell, g.nx, g.nz, (i) => {
        if (!(free ?? g.free)[i]) return;
        if (!free) { free = g.free.slice(); blockers = new Map(g.blockers); }
        blockers.set(i, o.id);
        free[i] = 0;
      }, true);
    }
    levels.set(id, free ? { ...g, free, blockers, clearance: edt(free, g.nx, g.nz, g.cell) } : g);
  }
  return { cell: base.cell, levels };
}

/**
 * Visit cells covered by the OBB. `conservative` (obstacles): every cell the OBB
 * touches, so thin panels are never lost between cell centres. Otherwise
 * (floors): only cells whose centre lies inside, so floors never grow.
 */
export function rasterObb(o: OBB2, x0: number, z0: number, cell: number, nx: number, nz: number, fn: (i: number) => void, conservative = false) {
  const cs = obbCorners(o);
  let ax = Infinity, az = Infinity, bx = -Infinity, bz = -Infinity;
  for (const [x, z] of cs) { ax = Math.min(ax, x); az = Math.min(az, z); bx = Math.max(bx, x); bz = Math.max(bz, z); }
  const i0 = Math.max(0, Math.floor((ax - x0) / cell)), i1 = Math.min(nx - 1, Math.ceil((bx - x0) / cell));
  const j0 = Math.max(0, Math.floor((az - z0) / cell)), j1 = Math.min(nz - 1, Math.ceil((bz - z0) / cell));
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const p: Vec2 = [x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell];
      if (conservative ? obbOverlap(o, { c: p, half: [cell / 2 - 1e-9, cell / 2 - 1e-9], yaw: 0 }) : pointInObb(p, o, 1e-9)) fn(j * nx + i);
    }
}

/** Felzenszwalb–Huttenlocher exact squared EDT, returned as metres. Out-of-grid counts as blocked. */
function edt(free: Uint8Array, nx: number, nz: number, cell: number): Float32Array {
  const INF = 1e20;
  const g = new Float64Array(nx * nz);
  // columns: pad with blocked boundary at -1 and n
  const n = Math.max(nx, nz) + 2;
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), zb = new Float64Array(n + 1);
  const pass = (len: number) => {
    let k = 0;
    v[0] = 0; zb[0] = -INF; zb[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= zb[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; zb[k] = s; zb[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (zb[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
  };
  for (let i = 0; i < nx; i++) {
    const len = nz + 2;
    f[0] = 0; f[len - 1] = 0;
    for (let j = 0; j < nz; j++) f[j + 1] = free[j * nx + i] ? INF : 0;
    pass(len);
    for (let j = 0; j < nz; j++) g[j * nx + i] = d[j + 1];
  }
  const out = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    const len = nx + 2;
    f[0] = 0; f[len - 1] = 0;
    for (let i = 0; i < nx; i++) f[i + 1] = g[j * nx + i];
    pass(len);
    // distance from centre to nearest blocked *centre*, minus half a cell ≈ distance to blocked cell edge
    for (let i = 0; i < nx; i++) out[j * nx + i] = free[j * nx + i] ? Math.max(0, Math.sqrt(d[i + 1]) * cell - cell / 2) : 0;
  }
  return out;
}

export const cellOf = (g: LevelGrid, p: Vec2) => {
  const i = Math.floor((p[0] - g.x0) / g.cell), j = Math.floor((p[1] - g.z0) / g.cell);
  return i < 0 || j < 0 || i >= g.nx || j >= g.nz ? -1 : j * g.nx + i;
};
export const centreOf = (g: LevelGrid, idx: number): Vec2 => [g.x0 + ((idx % g.nx) + 0.5) * g.cell, g.z0 + (Math.floor(idx / g.nx) + 0.5) * g.cell];

/** Bilinear-free clearance lookup at a point (cell sample). Outside grid → 0. */
export function clearanceAt(g: LevelGrid, p: Vec2): number {
  const c = cellOf(g, p);
  return c < 0 ? 0 : g.clearance[c];
}

/** Minimum clearance sampled along a segment (step ≤ half a cell). */
export function segmentClearance(g: LevelGrid, a: Vec2, b: Vec2): number {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.ceil(len / (g.cell * 0.5)));
  let m = Infinity;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const c = clearanceAt(g, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    if (c < m) m = c;
    if (m <= 0) break;
  }
  return m;
}

/** Nearest blocker id around a point (diagnostics: "blocked by east wall"). */
export function nearestBlocker(g: LevelGrid, p: Vec2, radius = 1.5): string | undefined {
  const c = cellOf(g, p);
  if (c < 0) return undefined;
  const r = Math.ceil(radius / g.cell), ci = c % g.nx, cj = Math.floor(c / g.nx);
  let best: string | undefined, bd = Infinity;
  for (let j = Math.max(0, cj - r); j <= Math.min(g.nz - 1, cj + r); j++)
    for (let i = Math.max(0, ci - r); i <= Math.min(g.nx - 1, ci + r); i++) {
      const id = g.blockers.get(j * g.nx + i);
      if (id) { const d = (i - ci) ** 2 + (j - cj) ** 2; if (d < bd) { bd = d; best = id; } }
    }
  return best;
}
