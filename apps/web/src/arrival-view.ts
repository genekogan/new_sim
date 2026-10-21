// t4-phone-new: what the arrival camera can see, on the ground plane. A phone's first build (WorldEntityLayer) and its
// arrival GLBs (gen-mesh/lazy-assets.ts) were chosen by distance only: everything within 35 m of the arrival eye or target,
// though a portrait phone's 45° view is ~25° wide and the disc around the eye lies mostly behind it. The view here is the
// ground wedge every ray of that camera falls in (its four corner rays projected onto the ground, so a camera tilted down
// counts its wider footprint at the bottom of the screen); it ignores height, so it holds whatever the frustum holds.
// A thing is in view when it comes within `margin` metres of the wedge (its own size, the shadow it casts into view).
// No wedge (null) when the camera looks steeply down or the pose is degenerate: then everything counts, as before.

export type ViewWedge = { ax: number; az: number; dx: number; dz: number; cos: number; sin: number };
type P2 = readonly [number, number] | readonly number[];

/** The ground wedge of a camera at `eye` looking at `target` with a vertical `fovDeg` and `aspect` (width / height),
 *  widened by `slackDeg` on each side. */
export function viewWedge(eye: readonly number[], target: readonly number[], fovDeg: number, aspect: number, slackDeg = 3): ViewWedge | null {
  let fx = target[0] - eye[0], fy = target[1] - eye[1], fz = target[2] - eye[2];
  const fl = Math.hypot(fx, fy, fz); if (!(fl > 1e-6)) return null;
  fx /= fl; fy /= fl; fz /= fl;
  const hl = Math.hypot(fx, fz); if (hl < 0.2) return null;   // looking almost straight down
  // right = forward x world up (0,1,0), up = right x forward
  let rx = -fz, rz = fx; const rl = Math.hypot(rx, rz); rx /= rl; rz /= rl;
  const ux = -rz * fy, uz = rx * fy;   // the ground part of up = right x forward
  const tv = Math.tan((fovDeg * Math.PI) / 360), th = tv * Math.max(1e-3, aspect);
  const dx = fx / hl, dz = fz / hl;
  let half = 0;
  for (const a of [-th, th]) for (const b of [-tv, tv]) {
    const x = fx + a * rx + b * ux, z = fz + a * rz + b * uz;
    const f = x * dx + z * dz, s = Math.abs(x * -dz + z * dx);
    if (f <= 1e-3) return null;   // a corner ray points behind the eye on the ground
    half = Math.max(half, Math.atan2(s, f));
  }
  half += (slackDeg * Math.PI) / 180;
  if (half >= (80 * Math.PI) / 180) return null;
  return { ax: eye[0], az: eye[2], dx, dz, cos: Math.cos(half), sin: Math.sin(half) };
}

/** Ground distance from (x, z) to the wedge (0 inside). */
export function wedgeDistance(w: ViewWedge, x: number, z: number): number {
  const px = x - w.ax, pz = z - w.az, f = px * w.dx + pz * w.dz, s = Math.abs(px * -w.dz + pz * w.dx);
  const out = s * w.cos - f * w.sin;   // signed distance beyond the nearer edge line
  if (out <= 0 && f >= 0) return 0;
  if (f * w.cos + s * w.sin > 0) return Math.max(0, out);   // nearest point on the edge ray
  return Math.hypot(px, pz);   // behind: nearest the apex
}

const cross = (ax: number, az: number, bx: number, bz: number) => ax * bz - az * bx;
/** Does segment a-b cross the ray from the apex along (rx, rz)? */
function crossesRay(w: ViewWedge, rx: number, rz: number, a: P2, b: P2): boolean {
  const ex = b[0] - a[0], ez = b[1] - a[1], qx = a[0] - w.ax, qz = a[1] - w.az, den = cross(rx, rz, ex, ez);
  if (Math.abs(den) < 1e-12) return false;
  const t = cross(qx, qz, ex, ez) / den, u = cross(qx, qz, rx, rz) / den;
  return t >= 0 && u >= 0 && u <= 1;
}
export function segmentDistance(w: ViewWedge, a: P2, b: P2): number {
  const da = wedgeDistance(w, a[0], a[1]), db = wedgeDistance(w, b[0], b[1]);
  if (da === 0 || db === 0) return 0;
  // the two edge rays: forward rotated by +-half
  const lx = w.dx * w.cos - w.dz * w.sin, lz = w.dx * w.sin + w.dz * w.cos, rx = w.dx * w.cos + w.dz * w.sin, rz = -w.dx * w.sin + w.dz * w.cos;
  if (crossesRay(w, lx, lz, a, b) || crossesRay(w, rx, rz, a, b)) return 0;
  const ex = b[0] - a[0], ez = b[1] - a[1], L = ex * ex + ez * ez, t = L > 0 ? Math.max(0, Math.min(1, ((w.ax - a[0]) * ex + (w.az - a[1]) * ez) / L)) : 0;
  return Math.min(da, db, Math.hypot(w.ax - a[0] - t * ex, w.az - a[1] - t * ez));
}
/** Ground distance from a path (open) or area (closed polygon) to the wedge (0 when they meet). */
export function shapeWedgeDistance(w: ViewWedge, pts: readonly P2[], closed: boolean): number {
  if (!pts.length) return Infinity;
  if (pts.length === 1) return wedgeDistance(w, pts[0][0], pts[0][1]);
  let best = Infinity, inside = false;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], n = pts[i + 1] ?? (closed ? pts[0] : null); if (!n) break;
    best = Math.min(best, segmentDistance(w, p, n)); if (best === 0) return 0;
    if (closed && (p[1] > w.az) !== (n[1] > w.az) && w.ax < p[0] + ((w.az - p[1]) / (n[1] - p[1])) * (n[0] - p[0])) inside = !inside;
  }
  return inside ? 0 : best;
}

type ViewKey = readonly [number, number] | { path: readonly P2[] } | { area: readonly P2[] } | null;
/** Is a thing at `key` (a point, a path or an area on the ground) within `r` of the wedge, or its shadow? `shadow` is the
 *  ground offset of the shadow of its top (the sun's direction times its height): a point's shadow is the segment to
 *  there, a shape's is the shape swept along it (checked at five steps, each widened by the gap between them). */
export function keySeen(w: ViewWedge, key: ViewKey, r: number, shadow: readonly [number, number] = [0, 0]): boolean {
  if (key === null) return true;
  const [sx, sz] = shadow;
  if (!('path' in key) && !('area' in key)) {
    const p = key as readonly number[];
    return wedgeDistance(w, p[0], p[1]) <= r || ((sx || sz) ? segmentDistance(w, [p[0], p[1]], [p[0] + sx, p[1] + sz]) <= r : false);
  }
  const pts = 'path' in key ? key.path : key.area, closed = 'area' in key, gap = Math.hypot(sx, sz) / 8;
  for (const t of sx || sz ? [0, 0.25, 0.5, 0.75, 1] : [0]) {
    const moved = t ? pts.map((q) => [q[0] + t * sx, q[1] + t * sz] as const) : pts;
    if (shapeWedgeDistance(w, moved, closed) <= r + (t ? gap : 0)) return true;
  }
  return false;
}
/** The first `n` things of `list` (the near ones) that `seen` keeps come first; then the other near things, then the
 *  rest, each part in its old order. `first` = how many are seen. */
export function viewFirst<T>(list: readonly T[], n: number, seen: (e: T) => boolean): { list: T[]; first: number } {
  const shown: T[] = [], hidden: T[] = [];
  for (let i = 0; i < n; i++) (seen(list[i]) ? shown : hidden).push(list[i]);
  return { list: [...shown, ...hidden, ...list.slice(n)], first: shown.length };
}
