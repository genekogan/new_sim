// Per-level walkability rasters + exact Euclidean clearance fields.
// Deterministic, allocation-light and pure TS so it runs in the Durable
// Object as well as the browser. Rebuilt (or patched) when construction
// changes the scene.
import { obbCorners, pointInObb, type OBB2, type Vec2 } from '../core/math.ts';
import type { SpatialScene } from './types.ts';

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

export function buildGrids(scene: SpatialScene, cell = 0.1): GridSet {
  const [minX, minZ, maxX, maxZ] = scene.bounds;
  const nx = Math.ceil((maxX - minX) / cell), nz = Math.ceil((maxZ - minZ) / cell);
  const levels = new Map<number, LevelGrid>();
  for (const lv of scene.levels) {
    const free = new Uint8Array(nx * nz);
    const blockers = new Map<number, string>();
    for (const s of scene.surfaces) if (s.level === lv.id) rasterObb(s.obb, minX, minZ, cell, nx, nz, (i) => (free[i] = 1));
    for (const o of scene.obstacles) {
      if (o.y1 <= lv.y + STEP || o.y0 >= lv.y + BODY_HEIGHT) continue; // below step height or overhead
      rasterObb(o.obb, minX, minZ, cell, nx, nz, (i) => {
        if (free[i]) blockers.set(i, o.id);
        free[i] = 0;
      });
    }
    levels.set(lv.id, { level: lv.id, y: lv.y, cell, nx, nz, x0: minX, z0: minZ, free, clearance: edt(free, nx, nz, cell), blockers });
  }
  return { cell, levels };
}

/** Visit every cell whose centre lies inside the OBB. */
export function rasterObb(o: OBB2, x0: number, z0: number, cell: number, nx: number, nz: number, fn: (i: number) => void) {
  const cs = obbCorners(o);
  let ax = Infinity, az = Infinity, bx = -Infinity, bz = -Infinity;
  for (const [x, z] of cs) { ax = Math.min(ax, x); az = Math.min(az, z); bx = Math.max(bx, x); bz = Math.max(bz, z); }
  const i0 = Math.max(0, Math.floor((ax - x0) / cell)), i1 = Math.min(nx - 1, Math.ceil((bx - x0) / cell));
  const j0 = Math.max(0, Math.floor((az - z0) / cell)), j1 = Math.min(nz - 1, Math.ceil((bz - z0) / cell));
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const p: Vec2 = [x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell];
      if (pointInObb(p, o, 1e-9)) fn(j * nx + i);
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
