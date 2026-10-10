// Small shared geometry helpers for physics halves. Owner: L1 (lanes may add, never change signatures).
import type { LocalOBB, Vec2, Vec3 } from './types.ts';

export const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
export const s = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
export const b = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

export function bounds2(pts: Vec2[], pad = 0): [number, number, number, number] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { if (x < x0) x0 = x; if (z < z0) z0 = z; if (x > x1) x1 = x; if (z > z1) z1 = z; }
  return [x0 - pad, z0 - pad, x1 + pad, z1 + pad];
}
export function boxOfBounds(bb: [number, number, number, number], h: number): Vec3 { return [Math.max(0.01, bb[2] - bb[0]), Math.max(0.01, h), Math.max(0.01, bb[3] - bb[1])]; }

/** One OBB per polyline segment: walls, fences, hedges. Gaps (by arc-length interval) are skipped. */
export function segmentColliders(path: Vec2[], thickness: number, y0: number, y1: number, gaps: { from: number; to: number }[] = [], tag?: string): LocalOBB[] {
  const out: LocalOBB[] = [];
  let at = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1], [bx, bz] = path[i];
    const len = Math.hypot(bx - ax, bz - az); if (len < 1e-6) continue;
    // split the segment by gaps
    const cuts: [number, number][] = [[0, len]];
    for (const g of gaps) {
      const g0 = g.from - at, g1 = g.to - at;
      for (let k = cuts.length - 1; k >= 0; k--) {
        const [c0, c1] = cuts[k];
        if (g1 <= c0 || g0 >= c1) continue;
        cuts.splice(k, 1, ...([[c0, Math.max(c0, g0)], [Math.min(c1, g1), c1]] as [number, number][]).filter(([p, q]) => q - p > 0.05));
      }
    }
    const ux = (bx - ax) / len, uz = (bz - az) / len, yaw = Math.atan2(-uz, ux);
    for (const [c0, c1] of cuts) {
      const m = (c0 + c1) / 2;
      out.push({ c: [ax + ux * m, az + uz * m], half: [(c1 - c0) / 2, thickness / 2], yaw, y0, y1, ...(tag ? { tag } : {}) });
    }
    at += len;
  }
  return out;
}

/** Polyline length and a point/tangent at parameter t ∈ [0,1] (by arc length). */
export function polylineLength(path: Vec2[]): number { let l = 0; for (let i = 1; i < path.length; i++) l += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); return l; }
export function pointAlong(path: Vec2[], t: number): { p: Vec2; dir: Vec2 } {
  const total = polylineLength(path); let want = Math.min(1, Math.max(0, t)) * total;
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1], [bx, bz] = path[i], len = Math.hypot(bx - ax, bz - az);
    if (want <= len || i === path.length - 1) { const k = len ? Math.min(1, want / len) : 0; return { p: [ax + (bx - ax) * k, az + (bz - az) * k], dir: len ? [(bx - ax) / len, (bz - az) / len] : [1, 0] }; }
    want -= len;
  }
  return { p: path[0], dir: [1, 0] };
}
/** Offset a polyline sideways by d (left positive): road edges, shoulders, banks. */
export function offsetPolyline(path: Vec2[], d: number): Vec2[] {
  return path.map((p, i) => {
    const a = path[Math.max(0, i - 1)], c = path[Math.min(path.length - 1, i + 1)];
    let dx = c[0] - a[0], dz = c[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    return [p[0] - dz * d, p[1] + dx * d] as Vec2;
  });
}
export function rectPoly(x0: number, z0: number, x1: number, z1: number): Vec2[] { return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]; }
export function polyArea(poly: Vec2[]): number { let a = 0; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]); return Math.abs(a) / 2; }
/** Deterministic PRNG (xorshift32) from a seed; returns [0,1). */
/** Fallback 1 for seed 0 keeps tranche-1 scatter layouts identical. */
export function rng(seed: number) { let x = (seed | 0) || 1; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 1_000_000) / 1_000_000; }; }
export function hashSeed(str: string): number { let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h >>> 0; }
export function pointInPoly(px: number, pz: number, poly: Vec2[]): boolean { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside; } return inside; }
