// Small deterministic geometry. Only + − × ÷, comparisons and sqrt (all
// correctly rounded under IEEE-754), so every JS engine returns identical bits.
import type { Vec2 } from './types.ts';

export const sq = (a: number) => a * a;
export const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
/** Cubic smoothstep on [0,1]. */
export const smooth = (t: number) => { const c = clamp01(t); return c * c * (3 - 2 * c); };
/** Wyvill bump: 1 at d=0, 0 at d≥1, C² continuous. */
export const bumpK = (d: number) => { if (d >= 1) return 0; const u = 1 - d * d; return u * u * u; };
/** Integer power for small positive integer exponents; fractional peaks use sqrt chains. */
export function powPeak(k: number, peak: number): number {
  if (peak === 1) return k;
  if (peak === 2) return k * k;
  if (peak === 3) return k * k * k;
  if (peak === 0.5) return Math.sqrt(k);
  // General case: k^peak = exp(peak·ln k) is engine-dependent; approximate with
  // integer part × sqrt chain on the fraction (0.5 / 0.25 steps), all exact ops.
  let out = 1, ip = Math.floor(peak), frac = peak - ip;
  for (let i = 0; i < ip; i++) out *= k;
  let root = Math.sqrt(k), step = 0.5;
  while (frac >= 0.25 - 1e-12) { if (frac >= step - 1e-12) { out *= root; frac -= step; } root = Math.sqrt(root); step /= 2; }
  return out;
}

export function distPointSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax, vz = bz - az, wx = px - ax, wz = pz - az;
  const n = vx * vx + vz * vz;
  const t = n === 0 ? 0 : clamp01((wx * vx + wz * vz) / n);
  return Math.sqrt(sq(px - (ax + vx * t)) + sq(pz - (az + vz * t)));
}
export function distPolyline(px: number, pz: number, path: Vec2[]): number {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const d = distPointSeg(px, pz, path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
    if (d < best) best = d;
  }
  return best;
}
export function pointInPoly(px: number, pz: number, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
export function distPolyEdge(px: number, pz: number, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const d = distPointSeg(px, pz, poly[j][0], poly[j][1], poly[i][0], poly[i][1]);
    if (d < best) best = d;
  }
  return best;
}
/** 1 inside (beyond `edge` from the boundary), 0 outside, smooth across the band inside the polygon. */
export function areaMask(px: number, pz: number, poly: Vec2[], edge: number): number {
  if (!pointInPoly(px, pz, poly)) return 0;
  return smooth(distPolyEdge(px, pz, poly) / edge);
}
/** 1 on the path centre line, 0 at distance ≥ w, smooth between. */
export function pathMask(px: number, pz: number, path: Vec2[], w: number): number {
  return 1 - smooth(distPolyline(px, pz, path) / w);
}
export function polyBounds(pts: Vec2[], pad = 0): [number, number, number, number] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { if (x < x0) x0 = x; if (z < z0) z0 = z; if (x > x1) x1 = x; if (z > z1) z1 = z; }
  return [x0 - pad, z0 - pad, x1 + pad, z1 + pad];
}

// Integer-hash value noise. All integer ops are exact in doubles below 2^53;
// `| 0` and `>>> 0` keep intermediate values in 32-bit range.
function hash2(ix: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296; // [0,1)
}
export function valueNoise(x: number, z: number, scale: number, seed: number): number {
  const fx = x / scale, fz = z / scale;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = smooth(fx - ix), tz = smooth(fz - iz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  const top = a + (b - a) * tx, bot = c + (d - c) * tx;
  return (top + (bot - top) * tz) * 2 - 1; // [-1,1]
}
