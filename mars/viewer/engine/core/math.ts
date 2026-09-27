// Minimal deterministic vector/pose math. World frame matches the studio:
// metres, Y up, ground plane X/Z. Yaw is rotation about +Y (radians,
// counter-clockwise seen from above, 0 = facing +X).
export type Vec3 = [number, number, number];
export type Vec2 = [number, number]; // (x, z)

export const FT = 0.3048;
export const IN = 0.0254;

export const v2 = (x: number, z: number): Vec2 => [x, z];
export const add2 = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const sub2 = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const scale2 = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
export const dot2 = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
export const cross2 = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
export const len2 = (a: Vec2) => Math.hypot(a[0], a[1]);
export const dist2 = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
export const norm2 = (a: Vec2): Vec2 => {
  const l = len2(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l] : [0, 0];
};
/** Rotate (x, z) by yaw about +Y (counter-clockwise from above). */
export const rot2 = (a: Vec2, yaw: number): Vec2 => {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [a[0] * c - a[1] * s, a[0] * s + a[1] * c];
};
export const heading = (d: Vec2) => Math.atan2(d[1], d[0]);
export const wrapAngle = (a: number) => {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
};
export const angleDelta = (from: number, to: number) => wrapAngle(to - from);
/** Round to 1e-6 so hashed/recorded state is stable across float noise. */
export const q6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Oriented rectangle footprint on the ground plane. */
export type OBB2 = { c: Vec2; half: Vec2; yaw: number };

export function obbCorners(o: OBB2): Vec2[] {
  const [hx, hz] = o.half;
  return ([[hx, hz], [-hx, hz], [-hx, -hz], [hx, -hz]] as Vec2[]).map((p) => add2(o.c, rot2(p, o.yaw)));
}

/** Separating-axis test between two oriented rectangles (touching = overlap). */
export function obbOverlap(a: OBB2, b: OBB2, margin = 0): boolean {
  const ca = obbCorners(a), cb = obbCorners(b);
  const axes: Vec2[] = [rot2([1, 0], a.yaw), rot2([0, 1], a.yaw), rot2([1, 0], b.yaw), rot2([0, 1], b.yaw)];
  for (const ax of axes) {
    let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
    for (const p of ca) { const d = dot2(p, ax); amin = Math.min(amin, d); amax = Math.max(amax, d); }
    for (const p of cb) { const d = dot2(p, ax); bmin = Math.min(bmin, d); bmax = Math.max(bmax, d); }
    if (amax + margin < bmin || bmax + margin < amin) return false;
  }
  return true;
}

export function pointInObb(p: Vec2, o: OBB2, margin = 0): boolean {
  const l = rot2(sub2(p, o.c), -o.yaw);
  return Math.abs(l[0]) <= o.half[0] + margin && Math.abs(l[1]) <= o.half[1] + margin;
}

/** Distance from point to segment ab. */
export function distPointSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub2(b, a);
  const t = clamp(dot2(sub2(p, a), ab) / Math.max(dot2(ab, ab), 1e-12), 0, 1);
  return dist2(p, add2(a, scale2(ab, t)));
}
