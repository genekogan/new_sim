// Take parts as sight occluders (readability only, never camera collision).
// Each placed / carried / installed component contributes kind-aware oriented
// boxes that match what the studio draws (app/engine-view/components.ts):
//   rack uprights → the two 3 in posts (thin braces ignored: a solid frame box
//                   would hide everything behind a see-through lattice),
//   stair flights → the two stringers (treads are their own entities),
//   everything else (beams, joists, 2x4s, treads, plywood slabs) → its catalog box.
// Orientation follows entityCorners(): roll about Z, pitch about X, yaw about Y.
import { datan2, dcos, dsin, type Vec3, hypot } from '../core/math.ts';
import { CATALOG } from '../world/catalog.ts';

/** Oriented box: centre, unit axes, half extents along them, plus its world AABB for broadphase. */
export type OccBox = { c: Vec3; ax: [Vec3, Vec3, Vec3]; h: Vec3; min: Vec3; max: Vec3 };
export type PartPose = { p: Vec3; yaw: number; pitch?: number; roll?: number };

/** Local (base-centre frame) → world direction, same rotation order as entityCorners(). */
export function rotateLocal(pose: PartPose, v: Vec3): Vec3 {
  const cr = dcos(pose.roll ?? 0), sr = dsin(pose.roll ?? 0);
  const cp = dcos(pose.pitch ?? 0), sp = dsin(pose.pitch ?? 0);
  const cy = dcos(pose.yaw), sy = dsin(pose.yaw);
  const X = v[0] * cr - v[1] * sr, Y = v[0] * sr + v[1] * cr, Z = v[2];
  const Y2 = Y * cp - Z * sp, Z2 = Y * sp + Z * cp;
  return [X * cy - Z2 * sy, Y2, X * sy + Z2 * cy];
}
export const localToWorld = (pose: PartPose, v: Vec3): Vec3 => {
  const r = rotateLocal(pose, v);
  return [pose.p[0] + r[0], pose.p[1] + r[1], pose.p[2] + r[2]];
};

function box(pose: PartPose, lc: Vec3, h: Vec3, lax: [Vec3, Vec3, Vec3] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]): OccBox {
  const c = localToWorld(pose, lc);
  const ax = lax.map((a) => rotateLocal(pose, a)) as [Vec3, Vec3, Vec3];
  const e = [0, 1, 2].map((j) => Math.abs(ax[0][j]) * h[0] + Math.abs(ax[1][j]) * h[1] + Math.abs(ax[2][j]) * h[2]);
  return { c, ax, h, min: [c[0] - e[0], c[1] - e[1], c[2] - e[2]], max: [c[0] + e[0], c[1] + e[1], c[2] + e[2]] };
}

/** Sight-blocking boxes of a component with catalog def `defId` at `pose` ([] for people / unknown defs). */
export function partOccluders(defId: string, pose: PartPose): OccBox[] {
  const d = CATALOG[defId];
  if (!d || d.category === 'human') return [];
  const [sx, sy, sz] = d.size;
  if (d.category === 'rack-upright') {
    // two columns t × h × t at local x = ±(depth − t)/2 (t = the catalog face thickness, 3 in)
    const t = sz;
    return [-1, 1].map((s) => box(pose, [(s * (sx - t)) / 2, sy / 2, 0], [t / 2, sy / 2, t / 2]));
  }
  if (d.category === 'stair' && d.stair) {
    // two 2x12 stringers (0.24 m deep, 0.04 m thick) whose top edge runs through the tread tops
    const run = sx, rise = sy, width = sz, going = run / d.stair.treads, riser = rise / (d.stair.treads + 1);
    const top = (x: number) => riser * ((x + run / 2) / going + 0.5);
    const a = datan2(riser, going), ca = dcos(a), sa = dsin(a);
    const x0 = -run / 2, y0 = top(x0), x1 = run / 2, y1 = top(x1);
    const L = hypot(x1 - x0, y1 - y0);
    const mid: Vec3 = [(x0 + x1) / 2 + sa * 0.12, (y0 + y1) / 2 - ca * 0.12, 0];
    const lax: [Vec3, Vec3, Vec3] = [[ca, sa, 0], [-sa, ca, 0], [0, 0, 1]];
    return [-1, 1].map((s) => box(pose, [mid[0], mid[1], (s * (width - 0.04)) / 2], [L / 2, 0.12, 0.02], lax));
  }
  return [box(pose, [0, sy / 2, 0], [sx / 2, sy / 2, sz / 2])];
}

/** World position of grip slot `slot` on a component (slot tables tried for `crew` first, then all). */
export function gripPoint(defId: string, pose: PartPose, slot: string, crew?: number): Vec3 | null {
  const grips = CATALOG[defId]?.handling?.grips;
  if (!grips) return null;
  const tables = Object.keys(grips).map(Number).sort((a, b) => (a === crew ? -1 : b === crew ? 1 : a - b));
  for (const n of tables) {
    const g = grips[n].find((q) => q.id === slot);
    if (g) return localToWorld(pose, g.local);
  }
  return null;
}

/** Entry parameter of segment a→b into an oriented box (0 if a is inside), or null if it misses. */
export function segmentBox(a: Vec3, b: Vec3, q: OccBox): number | null {
  if (Math.max(a[0], b[0]) < q.min[0] || Math.min(a[0], b[0]) > q.max[0]) return null;
  if (Math.max(a[1], b[1]) < q.min[1] || Math.min(a[1], b[1]) > q.max[1]) return null;
  if (Math.max(a[2], b[2]) < q.min[2] || Math.min(a[2], b[2]) > q.max[2]) return null;
  const r: Vec3 = [a[0] - q.c[0], a[1] - q.c[1], a[2] - q.c[2]];
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  let t0 = 0, t1 = 1;
  for (let k = 0; k < 3; k++) {
    const u = q.ax[k];
    const p = r[0] * u[0] + r[1] * u[1] + r[2] * u[2];
    const v = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
    const h = q.h[k];
    if (Math.abs(v) < 1e-12) {
      if (p < -h || p > h) return null;
      continue;
    }
    let e = (-h - p) / v, f = (h - p) / v;
    if (e > f) { const w = e; e = f; f = w; }
    if (e > t0) t0 = e;
    if (f < t1) t1 = f;
    if (t0 > t1) return null;
  }
  return t0;
}
