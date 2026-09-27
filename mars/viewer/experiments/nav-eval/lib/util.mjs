import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const OUT = path.resolve(here, '../out');

export const now = () => performance.now();
export function time(fn) { const t = now(); const r = fn(); return [r, now() - t]; }
export function bench(fn, n) { fn(); const t = now(); for (let i = 0; i < n; i++) fn(i); return (now() - t) / n; }
export const sha = (u8) => createHash('sha256').update(u8).digest('hex').slice(0, 16);
export const mb = (b) => +(b / 1048576).toFixed(1);
export const r2 = (x) => Math.round(x * 100) / 100;
export const r3 = (x) => Math.round(x * 1000) / 1000;
export const v = ([x, y, z]) => ({ x, y, z });
export const pathLen = (p) => p.reduce((s, q, i) => i ? s + Math.hypot(q.x - p[i - 1].x, q.y - p[i - 1].y, q.z - p[i - 1].z) : 0, 0);

// segment vs AABB (slab test); p,q {x,y,z}; box [x0,y0,z0,x1,y1,z1]
export function segHitsBox(p, q, b, grow = 0) {
  let t0 = 0, t1 = 1;
  const P = [p.x, p.y, p.z], D = [q.x - p.x, q.y - p.y, q.z - p.z];
  for (let k = 0; k < 3; k++) {
    const lo = b[k] - (k === 1 ? 0 : grow), hi = b[k + 3] + (k === 1 ? 0 : grow);
    if (Math.abs(D[k]) < 1e-12) { if (P[k] < lo || P[k] > hi) return false; continue; }
    let a = (lo - P[k]) / D[k], c = (hi - P[k]) / D[k];
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    if (t0 > t1) return false;
  }
  return true;
}

const SOLID = /wall|u-|barrier|corridor|post|passage-side/;
// Check a polyline (lifted to waist height) against proving-ground solids, grown by `grow`.
export function penetrations(pathPts, boxes, { lift = 0.9, grow = 0 } = {}) {
  const hits = new Set();
  for (let i = 1; i < pathPts.length; i++) {
    const a = { ...pathPts[i - 1], y: pathPts[i - 1].y + lift }, b = { ...pathPts[i], y: pathPts[i].y + lift };
    for (const bx of boxes) if (SOLID.test(bx[6]) && segHitsBox(a, b, bx, grow)) hits.add(bx[6]);
  }
  return [...hits];
}

export function save(name, obj) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 2));
}
export function mem() {
  const m = process.memoryUsage();
  return { rssMB: mb(m.rss), heapMB: mb(m.heapUsed), arrayBuffersMB: mb(m.arrayBuffers) };
}
