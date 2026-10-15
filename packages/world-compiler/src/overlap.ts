import type { Entity } from './schemas.ts';
import { obbOverlap, type OBB, type WorldModel } from './model.ts';

/** Exact intersection volume of the compiler's yaw boxes. */
function volume(a: OBB, b: OBB): number {
  if (!obbOverlap(a, b)) return 0;
  const c = Math.cos(a.yaw), s = Math.sin(a.yaw), bc = Math.cos(b.yaw), bs = Math.sin(b.yaw);
  let p = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => {
    const x = a.c[0] + i * a.half[0] * c + j * a.half[1] * s - b.c[0], z = a.c[1] - i * a.half[0] * s + j * a.half[1] * c - b.c[1];
    return [x * bc - z * bs, x * bs + z * bc];
  });
  for (const [axis, bound, sign] of [[0, -b.half[0], 1], [0, b.half[0], -1], [1, -b.half[1], 1], [1, b.half[1], -1]]) {
    const out: number[][] = [];
    for (let i = 0; i < p.length; i++) {
      const u = p[i], v = p[(i + 1) % p.length], du = (u[axis] - bound) * sign, dv = (v[axis] - bound) * sign;
      if (du >= 0) out.push(u);
      if ((du < 0) !== (dv < 0)) { const t = du / (du - dv); out.push([u[0] + t * (v[0] - u[0]), u[1] + t * (v[1] - u[1])]); }
    }
    p = out;
  }
  const area = Math.abs(p.reduce((sum, u, i) => { const v = p[(i + 1) % p.length]; return sum + u[0] * v[1] - v[0] * u[1]; }, 0)) / 2;
  return area * (Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
}
const total = (a: OBB[], b: OBB[]) => a.reduce((sum, x) => sum + b.reduce((n, y) => n + volume(x, y), 0), 0);

/** Only an existing pair with no greater penetration is grandfathered; new pairs never are. */
export function overlapNotWorse(before: WorldModel | undefined, e: Entity, other: string, a: OBB[], b: OBB[]): boolean {
  const old = before?.entities.get(e.id), oldOther = before?.entities.get(other);
  if (!before || !old || !oldOther) return false;
  const previous = total(before.footprint(old), before.footprint(oldOther));
  return previous > 1e-9 && total(a, b) <= previous + 1e-7;
}
