// Replay Walk clip weight, eased over time (Soul Actions entry 39, M04). Three-free and pure in take time, so a scrubbed
// replay and the live client draw the same weight at the same tick.
//
// Before: the weight was mapped from the ±0.15 s ground speed, clamp01((speed - 0.06) / 0.25). That map is full from
// 0.31 m/s, so when a full-speed walk ended in one tick the weight fell 0.94 → 0.055 in one 65 ms client sample and the
// striding legs and swung arms snapped to standing (entry 29, take 3); a walk start snapped the other way.
// Now: the same instantaneous map is averaged over a WALK_EASE window with the parabolic kernel 6u(1 − u), whose step
// response is exactly a smoothstep over the window. A walk start or stop blends over WALK_EASE seconds, centred on the
// moment the body starts or stops; at a steady speed the weight is what it was (the kernel integrates to 1).
import { POS_Q, type PoseSample } from '../../engine/take/types.ts';

/** Seconds a walk start or stop takes to blend the Walk clip in or out. */
export const WALK_EASE = 0.35;
/** The Walk weight of a full stride; the idle-variety onset clock restarts from the last moment the weight was above it. */
export const WALK_FULL = 0.98;
/** Instantaneous Walk share of a ground speed (m/s): the replay's per-sample map (engine WALK_MIN ~0.06; full from 0.31). */
export const walkShare = (v: number) => Math.max(0, Math.min(1, (v - 0.06) / 0.25));

/** A pose track's walking share as steps: segment k spans ticks t[k]..t[k + 1] at share g[k] (t has one more entry). */
export type GaitSegments = { t: number[]; g: number[]; peak: number };

/**
 * Walking-share steps of one person over the current take and, when given, its adjacent takes (a live client's take
 * windows), on the current take's tick axis. `parts`: each track with the offset (ticks) that moves it onto that axis.
 */
export function gaitSegments(parts: readonly { track: readonly PoseSample[]; offset: number }[], dt: number): GaitSegments {
  const pts: [number, number, number][] = [];
  for (const { track, offset } of parts) for (const s of track) pts.push([s[0] + offset, s[1], s[3]]);
  pts.sort((a, b) => a[0] - b[0]);
  const u: [number, number, number][] = [];
  for (const p of pts) { if (u.length && u[u.length - 1][0] === p[0]) u[u.length - 1] = p; else u.push(p); }
  const t: number[] = [], g: number[] = [];
  for (let i = 0; i + 1 < u.length; i++) {
    const a = u[i], b = u[i + 1], span = (b[0] - a[0]) * dt;
    t.push(a[0]);
    g.push(walkShare(Math.hypot(b[1] - a[1], b[2] - a[2]) / POS_Q / span));
  }
  if (u.length > 1) t.push(u[u.length - 1][0]);
  let peak = 0;
  for (const x of g) if (x > peak) peak = x;
  return { t, g, peak };
}

const F = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** Walk weight at `tick` (fractional): the kernel-weighted walking share over the WALK_EASE window around it. Outside the
 *  known steps the edge step holds (a take that ends mid-stride keeps striding; one that ends standing keeps standing). */
export function walkWeightAt(s: GaitSegments, tick: number, dt: number): number {
  const n = s.g.length;
  if (!n) return 0;
  const D = WALK_EASE / dt, lo = tick - D / 2, hi = tick + D / 2;
  let sum = 0;
  const add = (a: number, b: number, g: number) => {
    const a2 = Math.max(a, lo), b2 = Math.min(b, hi);
    if (b2 > a2 && g > 0) sum += g * (F((b2 - lo) / D) - F((a2 - lo) / D));
  };
  add(-Infinity, s.t[0], s.g[0]);
  add(s.t[n], Infinity, s.g[n - 1]);
  // first step that ends after the window opens
  let a = 0, b = n - 1;
  while (a < b) { const m = (a + b) >> 1; if (s.t[m + 1] <= lo) a = m + 1; else b = m; }
  for (let k = a; k < n && s.t[k] < hi; k++) add(s.t[k], s.t[k + 1], s.g[k]);
  return Math.max(0, Math.min(1, sum));
}

/** The last whole tick in [t0, t1] at which the Walk weight was at full stride (≥ WALK_FULL), looking back at most
 *  `maxBack` ticks; null when there is none within reach. A walk stretch longer than that which never reached a stride (a
 *  long slow shuffle) counts as moving until `maxBack` before its end (`longMoves`); a stretch of standing does not. */
export function lastFullStride(s: GaitSegments, t0: number, t1: number, dt: number, maxBack = 60, longMoves = true): number | null {
  const end = Math.floor(t1), stop = Math.max(Math.ceil(t0), end - maxBack);
  // the weight never exceeds the largest share (a body that only stood or shuffled): nothing to scan
  if (s.peak >= WALK_FULL) for (let k = end; k >= stop; k--) if (walkWeightAt(s, k, dt) >= WALK_FULL) return k;
  return longMoves && t1 - t0 > maxBack ? t1 - maxBack : null;
}
