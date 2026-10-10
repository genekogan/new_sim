// Creature behaviour as a pure function of (seed, world time, home, surroundings): every viewer
// computes the same walk with no sync traffic. Owner: L4. Spec <eden4>/33 §3.2.
//
// Model: time is cut into legs of fixed length T per animal. Leg k walks from waypoint A_k to
// A_{k+1} (a turn on the spot, an eased walk, then a pause: graze, peck, look around). A waypoint
// depends only on (seed, k) and the surroundings, so the pose at any t is computed directly — no
// history, no drift between viewers. Routes avoid solids: direct, else via a side point, else via
// home. Swimmers keep to water, walkers keep out of it, herds keep inside their area.

export type V2 = [number, number];
export type Surroundings = {
  /** Is a disc of radius r at (x, z) free of solids (and of water for walkers / of land for swimmers)? */
  free(x: number, z: number, r: number): boolean;
  /** Herd area (or undefined: a disc of `radius` around home). */
  area?: V2[];
};
export type BehaviorKind = 'wander' | 'graze' | 'swim' | 'perch' | 'sleep' | 'fly' | 'follow' | 'idle';
export type Plan = { kind: BehaviorKind; speed: number; radius: number; size: number; seed: number; home: V2 };
export type Pose = {
  x: number; z: number; yaw: number;
  /** current speed (m/s) and distance walked in this leg (drives the stride phase) */
  speed: number; dist: number;
  /** 0 walking … 1 resting; what the creature does while resting */
  rest: number; activity: 'walk' | 'turn' | 'graze' | 'look' | 'sleep' | 'fly' | 'perch';
  /** flight altitude above the ground (fly) */
  alt: number;
  /** leg progress 0..1 (flight arc) */
  u: number;
};

export function hash32(a: number, b = 0, c = 0): number {
  let h = (a | 0) ^ Math.imul(b | 0, 0x9e3779b1) ^ Math.imul(c | 0, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b); h ^= h >>> 16;
  return h >>> 0;
}
export const rand = (a: number, b = 0, c = 0) => hash32(a, b, c) / 4294967296;
export function seedOf(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

function pointInPoly(px: number, pz: number, poly: V2[]) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside; } return inside; }

/** Leg length in seconds for a plan (constant per animal so legs index directly from time). */
export function legSeconds(p: Plan): number {
  const pause = p.kind === 'graze' ? 7 : p.kind === 'swim' ? 3 : p.kind === 'fly' ? 4 : 3.5;
  return 0.8 + (p.radius * 1.5) / Math.max(0.05, p.speed) + pause + rand(p.seed, 7) * 3;
}

/** Waypoint k: a free point near home (inside the herd area), else home. */
export function waypoint(p: Plan, k: number, s: Surroundings): V2 {
  for (let j = 0; j < 8; j++) {
    const a = rand(p.seed, k, j * 2 + 1) * Math.PI * 2, r = p.radius * Math.sqrt(rand(p.seed, k, j * 2 + 2));
    const x = p.home[0] + Math.cos(a) * r, z = p.home[1] + Math.sin(a) * r;
    if (s.area && !pointInPoly(x, z, s.area)) continue;
    if (s.free(x, z, p.size)) return [x, z];
  }
  return p.home;
}

function segFree(a: V2, b: V2, r: number, s: Surroundings): boolean {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(len / Math.max(0.25, r)));
  for (let i = 1; i < n; i++) { const t = i / n; if (!s.free(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, r)) return false; }
  return true;
}
/** The path of leg k: A_k → A_{k+1}, around solids when the straight line is blocked. */
export function route(p: Plan, k: number, s: Surroundings): V2[] {
  const a = waypoint(p, k, s), b = waypoint(p, k + 1, s);
  if (segFree(a, b, p.size, s)) return [a, b];
  const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1;
  for (const off of [0.6, -0.6, 1.2, -1.2]) {
    const m: V2 = [mx - (dz / len) * off * len, mz + (dx / len) * off * len];
    if (s.free(m[0], m[1], p.size) && segFree(a, m, p.size, s) && segFree(m, b, p.size, s)) return [a, m, b];
  }
  if (segFree(a, p.home, p.size, s) && segFree(p.home, b, p.size, s)) return [a, p.home, b];
  return [a, b];   // boxed in: walk straight (rare; better than a jump, since leg k+1 starts at b)
}
function pathLen(r: V2[]) { let l = 0; for (let i = 1; i < r.length; i++) l += Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]); return l; }
function at(r: V2[], s: number): V2 {
  for (let i = 1; i < r.length; i++) { const l = Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]); if (s <= l || i === r.length - 1) { const k = l ? Math.min(1, Math.max(0, s / l)) : 0; return [r[i - 1][0] + (r[i][0] - r[i - 1][0]) * k, r[i - 1][1] + (r[i][1] - r[i - 1][1]) * k]; } s -= l; }
  return r[r.length - 1];
}
const headingOf = (from: V2, to: V2, fallback: number) => (Math.hypot(to[0] - from[0], to[1] - from[1]) > 1e-4 ? Math.atan2(to[0] - from[0], to[1] - from[1]) : fallback);
const lerpAngle = (a: number, b: number, t: number) => { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; };
const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

/** Final heading of leg k (used as the starting heading of leg k+1). */
function endHeading(p: Plan, k: number, s: Surroundings, cache: RouteCache): number {
  const r = cache.get(p, k, s); const n = r.length;
  return headingOf(r[Math.max(0, n - 2)], r[n - 1], rand(p.seed, k, 99) * Math.PI * 2);
}

/** Routes are recomputed only when the leg index changes (cheap per frame). */
export class RouteCache {
  private m = new Map<number, V2[]>(); private stamp = 0;
  version = 0;
  get(p: Plan, k: number, s: Surroundings): V2[] {
    if (this.stamp !== this.version) { this.m.clear(); this.stamp = this.version; }
    let r = this.m.get(k); if (!r) { r = route(p, k, s); this.m.set(k, r); if (this.m.size > 8) this.m.delete(this.m.keys().next().value!); }
    return r;
  }
}

const TURN_S = 0.8, ACCEL_S = 0.6;
/** Where the creature is and what it does at world time t (seconds). */
export function pose(p: Plan, t: number, s: Surroundings, cache: RouteCache): Pose {
  if (p.kind === 'idle' || p.kind === 'perch' || p.kind === 'sleep') {
    const yaw = rand(p.seed, 3) * Math.PI * 2 + (p.kind === 'perch' ? Math.round(Math.sin(t / 7 + p.seed) * 2) * 0.6 : 0);
    return { x: p.home[0], z: p.home[1], yaw, speed: 0, dist: 0, rest: 1, activity: p.kind === 'sleep' ? 'sleep' : p.kind === 'perch' ? 'perch' : 'look', alt: 0, u: 0 };
  }
  const T = legSeconds(p), off = rand(p.seed, 11) * T, tt = t + off;
  const k = Math.floor(tt / T), u = tt - k * T;
  const r = cache.get(p, k, s), len = pathLen(r);
  const fly = p.kind === 'fly';
  const prevYaw = endHeading(p, k - 1, s, cache);
  const firstYaw = len > 1e-3 ? headingOf(r[0], at(r, Math.min(len, 0.5)), prevYaw) : prevYaw;
  // walking time at the plan speed; never longer than the leg allows
  const move = Math.max(0, T - TURN_S - 1.2);
  let v = p.speed, walk = len / Math.max(1e-3, v);
  if (walk > move) { walk = move; v = len / Math.max(1e-3, move); }
  const turnT = fly ? 0.3 : TURN_S;
  if (len < 1e-3 || u >= turnT + walk) {
    // resting at the end of the leg
    const end = r[r.length - 1], yaw = len < 1e-3 ? prevYaw : headingOf(r[Math.max(0, r.length - 2)], end, prevYaw);
    const act = p.kind === 'graze' ? 'graze' : p.kind === 'swim' ? 'look' : fly ? 'perch' : 'look';
    return { x: end[0], z: end[1], yaw, speed: 0, dist: len, rest: smooth((u - turnT - walk) / 0.6), activity: act, alt: 0, u: 1 };
  }
  if (u < turnT) {
    const st = r[0];
    return { x: st[0], z: st[1], yaw: lerpAngle(prevYaw, firstYaw, smooth(u / turnT)), speed: 0, dist: 0, rest: 0.3, activity: 'turn', alt: 0, u: 0 };
  }
  // trapezoidal speed profile: ease in and out over ACCEL_S
  const w = u - turnT, a = Math.min(ACCEL_S, walk / 2), vmax = len / Math.max(1e-3, walk - a);
  let d: number, sp: number;
  if (w < a) { sp = vmax * (w / a); d = 0.5 * sp * w; }
  else if (w > walk - a) { const q = walk - w; sp = vmax * (q / a); d = len - 0.5 * sp * q; }
  else { sp = vmax; d = 0.5 * vmax * a + vmax * (w - a); }
  d = Math.min(len, Math.max(0, d));
  const here = at(r, d), ahead = at(r, Math.min(len, d + Math.max(0.3, p.size * 2)));
  const yaw = lerpAngle(firstYaw, headingOf(here, ahead, firstYaw), smooth((w) / 0.4));
  const prog = len ? d / len : 1;
  const alt = fly ? Math.min(9, 0.25 * len + 1.5) * Math.sin(Math.PI * prog) : 0;
  return { x: here[0], z: here[1], yaw, speed: sp, dist: d, rest: 0, activity: fly ? 'fly' : 'walk', alt, u: prog };
}
