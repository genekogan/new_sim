// Camera geometry queries against SpatialScene obstacle prisms (OBB footprint
// + world y range). Pure, deterministic, read-only: nothing here mutates the
// scene or the world. Obstacles are split by per-kind policy into the
// *collision* set (camera may not enter / cross) and the *occlusion* set
// (blocks line of sight). Plexiglass ('glass') collides but does not occlude.
import { dcos, dsin, type Vec3, hypot } from '../core/math.ts';
import type { Obstacle, SpatialScene } from '../spatial/types.ts';

export type ObstacleKind = NonNullable<Obstacle['kind']>;
export type KindPolicy = { collide: boolean; occlude: boolean };
export type CameraPolicy = Record<ObstacleKind, KindPolicy> & { default: KindPolicy };

export const DEFAULT_CAMERA_POLICY: CameraPolicy = {
  wall: { collide: true, occlude: true },
  solid: { collide: true, occlude: true },
  glass: { collide: true, occlude: false },
  component: { collide: true, occlude: true },
  vehicle: { collide: true, occlude: true },
  fixture: { collide: true, occlude: true },
  default: { collide: true, occlude: true },
};

/** Obstacle with precomputed frame + world AABB for fast queries. */
export type Solid = {
  o: Obstacle;
  cx: number; cz: number; c: number; s: number;
  hx: number; hz: number; y0: number; y1: number;
  minX: number; maxX: number; minZ: number; maxZ: number;
  collide: boolean; occlude: boolean;
};

export type Mask = 'collide' | 'occlude';

/**
 * Read-only query structure over a scene's obstacles. A uniform x/z grid is
 * used as broadphase; each solid is listed in every cell its AABB touches.
 */
export class CameraWorld {
  solids: Solid[];
  cell: number;
  minX: number; minZ: number; nx: number; nz: number;
  cells: number[][];
  private stamp: Uint32Array;
  private gen = 0;

  constructor(scene: SpatialScene, policy: CameraPolicy = DEFAULT_CAMERA_POLICY, cell = 4) {
    this.cell = cell;
    this.solids = scene.obstacles.map((o) => {
      const pol = (o.kind && policy[o.kind]) || policy.default;
      const c = dcos(o.obb.yaw), s = dsin(o.obb.yaw);
      const [hx, hz] = o.obb.half;
      const ex = Math.abs(c) * hx + Math.abs(s) * hz, ez = Math.abs(s) * hx + Math.abs(c) * hz;
      return {
        o, cx: o.obb.c[0], cz: o.obb.c[1], c, s, hx, hz, y0: o.y0, y1: o.y1,
        minX: o.obb.c[0] - ex, maxX: o.obb.c[0] + ex, minZ: o.obb.c[1] - ez, maxZ: o.obb.c[1] + ez,
        collide: pol.collide, occlude: pol.occlude,
      };
    });
    const [bx0, bz0, bx1, bz1] = scene.bounds;
    let x0 = bx0, z0 = bz0, x1 = bx1, z1 = bz1;
    for (const q of this.solids) { x0 = Math.min(x0, q.minX); z0 = Math.min(z0, q.minZ); x1 = Math.max(x1, q.maxX); z1 = Math.max(z1, q.maxZ); }
    this.minX = x0; this.minZ = z0;
    this.nx = Math.max(1, Math.ceil((x1 - x0) / cell));
    this.nz = Math.max(1, Math.ceil((z1 - z0) / cell));
    this.cells = Array.from({ length: this.nx * this.nz }, () => [] as number[]);
    this.solids.forEach((q, i) => {
      const [ia, ja, ib, jb] = this.range(q.minX, q.minZ, q.maxX, q.maxZ);
      for (let j = ja; j <= jb; j++) for (let k = ia; k <= ib; k++) this.cells[j * this.nx + k].push(i);
    });
    this.stamp = new Uint32Array(this.solids.length);
  }

  private range(ax: number, az: number, bx: number, bz: number): [number, number, number, number] {
    const f = (v: number, m: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor((v - m) / this.cell)));
    return [f(ax, this.minX, this.nx), f(az, this.minZ, this.nz), f(bx, this.minX, this.nx), f(bz, this.minZ, this.nz)];
  }

  /** Solids (indices, ascending) whose AABB may touch the x/z box [a, b] grown by pad. */
  candidates(ax: number, az: number, bx: number, bz: number, pad = 0): number[] {
    const x0 = Math.min(ax, bx) - pad, x1 = Math.max(ax, bx) + pad, z0 = Math.min(az, bz) - pad, z1 = Math.max(az, bz) + pad;
    const [ia, ja, ib, jb] = this.range(x0, z0, x1, z1);
    if (ia === ib && ja === jb) return this.cells[ja * this.nx + ia];
    // dedupe with a generation stamp per solid (no Set per query: raycasts toward subject points cross cells every sample)
    if (++this.gen === 0xffffffff) { this.stamp.fill(0); this.gen = 1; }
    const g = this.gen, stamp = this.stamp, out: number[] = [];
    for (let j = ja; j <= jb; j++) for (let k = ia; k <= ib; k++) for (const i of this.cells[j * this.nx + k]) if (stamp[i] !== g) { stamp[i] = g; out.push(i); }
    return out.sort((p, q) => p - q);
  }
}

/**
 * Segment a→b vs one prism (slab test in the OBB frame + y range).
 * Returns the parametric entry/exit [t0, t1] clipped to [0, 1], or null.
 * t0 = 0 means a starts inside (or on the surface of) the prism.
 */
export function segmentPrism(a: Vec3, b: Vec3, q: Solid, grow = 0): [number, number] | null {
  let t0 = 0, t1 = 1;
  // local frame: l = rot(-yaw) * (p - c)
  const ax = a[0] - q.cx, az = a[2] - q.cz, dx = b[0] - a[0], dz = b[2] - a[2];
  const lax = ax * q.c + az * q.s, laz = -ax * q.s + az * q.c;
  const ldx = dx * q.c + dz * q.s, ldz = -dx * q.s + dz * q.c;
  const slabs: [number, number, number, number][] = [
    [lax, ldx, -q.hx - grow, q.hx + grow],
    [laz, ldz, -q.hz - grow, q.hz + grow],
    [a[1], b[1] - a[1], q.y0 - grow, q.y1 + grow],
  ];
  for (const [p, d, lo, hi] of slabs) {
    if (Math.abs(d) < 1e-12) {
      if (p < lo || p > hi) return null;
      continue;
    }
    let u = (lo - p) / d, v = (hi - p) / d;
    if (u > v) { const w = u; u = v; v = w; }
    if (u > t0) t0 = u;
    if (v < t1) t1 = v;
    if (t0 > t1) return null;
  }
  return [t0, t1];
}

export type Hit = { t: number; solid: Solid };

/** Nearest hit along a→b against the mask; `skip` ignores obstacle ids. */
export function raycast(world: CameraWorld, a: Vec3, b: Vec3, mask: Mask, skip?: ReadonlySet<string>, grow = 0): Hit | null {
  let best: Hit | null = null;
  for (const i of world.candidates(a[0], a[2], b[0], b[2], grow)) {
    const q = world.solids[i];
    if (!q[mask] || (skip && skip.has(q.o.id))) continue;
    if (Math.max(a[1], b[1]) < q.y0 - grow || Math.min(a[1], b[1]) > q.y1 + grow) continue;
    const h = segmentPrism(a, b, q, grow);
    if (h && (!best || h[0] < best.t)) best = { t: h[0], solid: q };
  }
  return best;
}

/** All distinct solids crossed by a→b (sorted by entry t). */
export function raycastAll(world: CameraWorld, a: Vec3, b: Vec3, mask: Mask): Hit[] {
  const out: Hit[] = [];
  for (const i of world.candidates(a[0], a[2], b[0], b[2])) {
    const q = world.solids[i];
    if (!q[mask]) continue;
    const h = segmentPrism(a, b, q);
    if (h) out.push({ t: h[0], solid: q });
  }
  return out.sort((x, y) => x.t - y.t || (x.solid.o.id < y.solid.o.id ? -1 : 1));
}

/** Signed distance from p to the prism surface (negative inside). */
export function signedDistance(p: Vec3, q: Solid): number {
  const x = p[0] - q.cx, z = p[2] - q.cz;
  const lx = Math.abs(x * q.c + z * q.s) - q.hx;
  const lz = Math.abs(-x * q.s + z * q.c) - q.hz;
  const hy = (q.y1 - q.y0) / 2;
  const ly = Math.abs(p[1] - (q.y0 + hy)) - hy;
  const ox = Math.max(lx, 0), oy = Math.max(ly, 0), oz = Math.max(lz, 0);
  return hypot(ox, oy, oz) + Math.min(Math.max(lx, ly, lz), 0);
}

export function pointInside(p: Vec3, q: Solid, margin = 0): boolean {
  return signedDistance(p, q) < margin;
}

/** Nearest solid (by signed distance) within `range` of p for the mask. */
export function nearestSolid(world: CameraWorld, p: Vec3, mask: Mask = 'collide', range = 2): { d: number; solid: Solid } | null {
  let best: { d: number; solid: Solid } | null = null;
  for (const i of world.candidates(p[0], p[2], p[0], p[2], range)) {
    const q = world.solids[i];
    if (!q[mask]) continue;
    const d = signedDistance(p, q);
    if (d <= range && (!best || d < best.d)) best = { d, solid: q };
  }
  return best;
}

/** Outward direction of the prism surface nearest to p (finite-difference SDF gradient). */
function gradient(p: Vec3, q: Solid): Vec3 {
  const e = 1e-4;
  const g: Vec3 = [
    signedDistance([p[0] + e, p[1], p[2]], q) - signedDistance([p[0] - e, p[1], p[2]], q),
    signedDistance([p[0], p[1] + e, p[2]], q) - signedDistance([p[0], p[1] - e, p[2]], q),
    signedDistance([p[0], p[1], p[2] + e], q) - signedDistance([p[0], p[1], p[2] - e], q),
  ];
  const l = hypot(g[0], g[1], g[2]);
  return l > 1e-12 ? [g[0] / l, g[1] / l, g[2] / l] : [0, 1, 0];
}

/**
 * Nearest-surface pushout (Cinemachine Decollider analogue): move p out of
 * collision solids until every one is ≥ radius away, never below `minY`.
 * Iterative; returns ok=false if it cannot converge (e.g. wedged in a gap
 * narrower than 2·radius).
 */
export function pushOut(world: CameraWorld, p: Vec3, radius: number, minY = 0.05, iters = 8): { p: Vec3; moved: boolean; ok: boolean; blocker?: Solid } {
  let cur: Vec3 = [p[0], Math.max(p[1], minY), p[2]];
  let moved = cur[1] !== p[1];
  for (let k = 0; k < iters; k++) {
    const n = nearestSolid(world, cur, 'collide', radius + 0.01);
    if (!n || n.d >= radius - 1e-6) return { p: cur, moved, ok: true };
    const g = gradient(cur, n.solid);
    const push = radius - n.d + 1e-3;
    cur = [cur[0] + g[0] * push, Math.max(minY, cur[1] + g[1] * push), cur[2] + g[2] * push];
    moved = true;
  }
  const n = nearestSolid(world, cur, 'collide', radius + 0.01);
  return n && n.d < radius - 1e-6 ? { p: cur, moved, ok: false, blocker: n.solid } : { p: cur, moved, ok: true };
}

export const solidName = (q: Solid) => `'${q.o.label ?? q.o.id}'`;
