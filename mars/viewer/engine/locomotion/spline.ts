// Path smoothing for walk_to (owner feedback 2026-09-28 §2): the string-pulled corridor polyline
// becomes a dense polyline of straight runs and circular fillets, so people turn while walking.
//
// Per interior vertex V (incoming from the end of the previous fillet A, outgoing to the next raw
// vertex N), candidates are tried largest radius first; for each radius the vertex may also be
// pushed outward along the external bisector (wide turn around a corner the path hugs):
//   radius R ∈ RADII (1.2 … 0.2 m), shift δ ∈ SHIFTS (0 … 0.3 m)
// A candidate is accepted only when every sample of the pieces it changes keeps the clearance the
// raw corridor had there (min(plan clearance, raw local clearance), sampled every 2 cm on the grid).
// If none fits, the vertex stays sharp (the raw polyline, locally) and the walker slows to SHARP_CAP.
// Every output vertex carries a speed cap (m/s) the walker must be down to on arrival there:
// on a fillet min(speed, √(LAT_ACCEL·R), 0.8·turnRate·R); so R ≥ 0.6 m at walking speed, tighter
// only when slow. Pure, deterministic arithmetic (dsin/dcos/datan2), no host transcendentals.
import { add2, clamp, cross2, datan2, dcos, dist2, dot2, dsin, norm2, scale2, sub2, type Vec2 } from '../core/math.ts';
import { clearanceAt, type LevelGrid } from '../spatial/grid.ts';

/** One straight piece of the smoothed path; `cap` = speed limit (m/s) on reaching `b` (Infinity = none). */
export type PathSeg = { a: Vec2; b: Vec2; s0: number; len: number; cap: number };
/** How a raw vertex was turned: `radius` 0 = kept sharp (no fillet fitted the clearance). */
export type Corner = { vertex: number; turn: number; radius: number; shift: number };
export type SmoothPath = { segs: PathSeg[]; total: number; corners: Corner[] };

export const RADII = [1.2, 0.9, 0.6, 0.45, 0.3, 0.2] as const;
export const SHIFTS = [0, 0.1, 0.2, 0.3] as const;
export const LAT_ACCEL = 1.5; // m/s² lateral acceleration budget on a curve
const SAMPLE = 0.1; // m arc length between fillet samples
const MAX_STEP_ANGLE = 0.15; // rad of heading between fillet samples
const COLLINEAR = 2e-4; // 1 − cos(turn) below this (≈ 1.1°): no fillet needed
/** Speed through a vertex kept sharp; a turn sharper than SHARP_STOP stops (turn in place). */
export const SHARP_CAP = 0.35;
export const SHARP_STOP = 2.5; // rad

export const filletCap = (radius: number, speed: number, turnRate: number) => Math.min(speed, Math.sqrt(LAT_ACCEL * radius), 0.8 * turnRate * radius);
export const sharpCap = (turn: number) => (turn > SHARP_STOP ? 0 : SHARP_CAP);

type Fillet = { P: Vec2; T1: Vec2; T2: Vec2; arc: Vec2[]; turn: number };

/** Circular fillet of radius R at vertex V (pushed outward by `shift`), between A→V and V→N; null if it does not fit the legs. */
function fillet(A: Vec2, V: Vec2, N: Vec2, R: number, shift: number, last: boolean): Fillet | null {
  let u = norm2(sub2(V, A)), w = norm2(sub2(N, V));
  let P = V;
  if (shift > 0) {
    const out = norm2(sub2(u, w)); // external bisector: away from the centre of the turn
    P = add2(V, scale2(out, shift));
    u = norm2(sub2(P, A));
    w = norm2(sub2(N, P));
  }
  const c = dot2(u, w), x = cross2(u, w), s = Math.abs(x);
  if (1 + c < 1e-6 || 1 - c < COLLINEAR) return null; // reversal / no turn left
  const t = (R * s) / (1 + c); // R·tan(θ/2)
  const lin = dist2(A, P), lout = dist2(P, N);
  if (t > lin - 1e-6 || t > (last ? lout - 1e-6 : 0.5 * lout)) return null;
  const T1 = sub2(P, scale2(u, t)), T2 = add2(P, scale2(w, t));
  const sgn = x > 0 ? 1 : -1;
  const C = add2(T1, scale2([-u[1] * sgn, u[0] * sgn], R));
  const turn = datan2(s, c);
  const m = Math.max(2, Math.ceil((turn * R) / SAMPLE), Math.ceil(turn / MAX_STEP_ANGLE));
  const cs = dcos((sgn * turn) / m), sn = dsin((sgn * turn) / m);
  let r = sub2(T1, C);
  const arc: Vec2[] = [];
  for (let k = 1; k < m; k++) {
    r = [r[0] * cs - r[1] * sn, r[0] * sn + r[1] * cs];
    arc.push(add2(C, r));
  }
  return { P, T1, T2, arc, turn };
}

/** Dense clearance sampling step (m): finer than `segmentClearance`'s half cell, so a smoothed piece and
 *  the raw piece it replaces are measured alike (sub-segments sample different points of a cell). */
export const DENSE = 0.02;
/** Minimum grid clearance over points every DENSE metres along a→b (both ends included). */
export function denseClearance(g: LevelGrid, a: Vec2, b: Vec2): number {
  const n = Math.max(1, Math.ceil(dist2(a, b) / DENSE));
  let m = Infinity;
  for (let k = 0; k <= n; k++) {
    const c = clearanceAt(g, [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    if (c < m) m = c;
  }
  return m;
}
function chainClear(g: LevelGrid, pts: Vec2[], need: number): boolean {
  for (let i = 1; i < pts.length; i++) if (denseClearance(g, pts[i - 1], pts[i]) < need) return false;
  return true;
}

/**
 * Smooth a walk leg's polyline on grid `g`. `clearance` is the clearance the planner kept (profile
 * radius + PLAN_MARGIN); no sample of the result has less clearance than the raw polyline had at that
 * corner, capped at `clearance`. Endpoints are preserved exactly.
 */
export function smoothPolyline(g: LevelGrid, raw: Vec2[], opts: { clearance: number; speed: number; turnRate: number }): SmoothPath {
  const pts = raw.filter((p, i) => i === 0 || dist2(p, raw[i - 1]) > 1e-9);
  const out: { p: Vec2; cap: number }[] = [{ p: pts[0], cap: Infinity }];
  const corners: Corner[] = [];
  let A = pts[0];
  for (let i = 1; i < pts.length - 1; i++) {
    const V = pts[i], N = pts[i + 1];
    const u = norm2(sub2(V, A)), w = norm2(sub2(N, V));
    const c = clamp(dot2(u, w), -1, 1);
    if (1 - c < COLLINEAR) {
      out.push({ p: V, cap: Infinity });
      A = V;
      continue;
    }
    const need = Math.min(opts.clearance, denseClearance(g, A, V), denseClearance(g, V, N)) - 1e-9;
    const last = i === pts.length - 2;
    let done = false;
    for (const R of RADII) {
      for (const d of SHIFTS) {
        const f = fillet(A, V, N, R, d, last);
        if (!f) continue;
        if (!chainClear(g, [A, f.T1, ...f.arc, f.T2, N], need)) continue;
        const cap = filletCap(R, opts.speed, opts.turnRate);
        out.push({ p: f.T1, cap }, ...f.arc.map((p) => ({ p, cap })), { p: f.T2, cap });
        corners.push({ vertex: i, turn: f.turn, radius: R, shift: d });
        A = f.T2;
        done = true;
        break;
      }
      if (done) break;
    }
    if (!done) {
      const turn = datan2(Math.abs(cross2(u, w)), c);
      out.push({ p: V, cap: sharpCap(turn) });
      corners.push({ vertex: i, turn, radius: 0, shift: 0 });
      A = V;
    }
  }
  if (pts.length > 1) out.push({ p: pts[pts.length - 1], cap: Infinity });
  const segs: PathSeg[] = [];
  let s0 = 0;
  for (let k = 1; k < out.length; k++) {
    const a = out[k - 1].p, b = out[k].p, len = dist2(a, b);
    if (len < 1e-9) {
      if (segs.length) segs[segs.length - 1].cap = Math.min(segs[segs.length - 1].cap, out[k].cap);
      continue;
    }
    segs.push({ a, b, s0, len, cap: out[k].cap });
    s0 += len;
  }
  return { segs, total: s0, corners };
}
