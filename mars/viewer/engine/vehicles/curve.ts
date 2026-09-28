// Vehicle route planning: the existing grid planner (spatial/path.ts findRoute) on the vehicle's
// level with an inflated radius and no links, then a curvature-limited reference curve through
// its corridor, then a speed profile. The curve is a chain of tangent lines and circular arcs
// (a Dubins-style "taut string"): at each corridor corner the arc is either a fillet inside the
// corner or, when that would cut into the obstacle the corner wraps, an arc centred on that
// obstacle's nearest cell swinging wide of the corner. Every arc radius is ≥ the profile's slow
// turn radius × HEADROOM; every sample keeps clearance ≥ radius + TRACK_TOL. Pure and deterministic.
import { angleDelta, dcos, dist2, dsin, heading, norm2, sub2, add2, scale2, cross2, dot2, type Vec2 } from '../core/math.ts';
import type { Diagnostic } from '../actions/types.ts';
import { cellOf, centreOf, clearanceAt, gridsWithObstacles, type GridSet, type LevelGrid } from '../spatial/grid.ts';
import { findRoute, type Place, type WalkLeg } from '../spatial/path.ts';
import type { Spatial, AroundPerson } from '../spatial/service.ts';
import type { Obstacle, SpatialScene } from '../spatial/types.ts';
import type { WorldState } from '../world/types.ts';
import { speedForRadius, type VehicleProfile } from './profiles.ts';

/** Curvature headroom: arcs are planned at ≥ 1.1 × the turn radius so the follower can correct. */
export const HEADROOM = 1.1;
/** Clearance kept beyond the body radius along the reference curve (follower cross-track allowance). */
export const TRACK_TOL = 0.08;
/** Sample spacing along the curve (m). */
export const SAMPLE = 0.1;
/** Walking step height used by the grids (spatial/grid.ts STEP): obstacles below it do not block walkers. */
const WALK_STEP = 0.22;

export type Sample = { p: Vec2; s: number; k: number };
export type Curve = { level: number; samples: Sample[]; length: number; vmax: number[]; minRadius: number; kerbs: string[] };
export type CurveResult = { ok: true; curve: Curve } | { ok: false; diagnostic: Diagnostic };

const left = (v: Vec2): Vec2 => [-v[1], v[0]];
const fmt = (p: Vec2) => `(${p[0].toFixed(2)}, ${p[1].toFixed(2)})`;

/** Obstacles a walker steps over but this vehicle cannot (kerbs), raised to block it. */
function kerbsFor(scene: SpatialScene, pr: VehicleProfile, floor: number): Obstacle[] {
  const out: Obstacle[] = [];
  for (const o of scene.obstacles) {
    const h = o.y1 - floor;
    if (h > pr.stepHeight && h <= WALK_STEP && o.y0 <= floor + pr.stepHeight)
      out.push({ ...o, y0: floor, y1: floor + 1, label: `${o.label ?? o.id} (${h.toFixed(2)} m kerb > ${pr.id} step ${pr.stepHeight} m)` });
  }
  return out;
}

const gridMemo = new WeakMap<Spatial, Map<string, { grids: GridSet; kerbs: string[] }>>();
/** The spatial grids with this vehicle's kerbs added (memoised per navigation epoch). */
export function vehicleGrids(sp: Spatial, world: WorldState, pr: VehicleProfile, level: number, around?: AroundPerson[]): { grids: GridSet; scene: SpatialScene; kerbs: string[] } {
  sp.sync(world);
  const base = around?.length ? sp.gridsAround(world, around) : { grids: sp.grids, scene: sp.scene };
  const floor = sp.level(level)?.y ?? 0;
  const key = `${sp.epoch}|${pr.id}|${level}`;
  let m = gridMemo.get(sp);
  if (!m) gridMemo.set(sp, (m = new Map()));
  let hit = around?.length ? undefined : m.get(key);
  if (!hit) {
    const kerbs = kerbsFor(sp.scene, pr, floor);
    hit = { grids: kerbs.length ? gridsWithObstacles(base.grids, kerbs) : base.grids, kerbs: kerbs.map((o) => o.id) };
    if (!around?.length) {
      for (const k of [...m.keys()]) if (!k.startsWith(`${sp.epoch}|`)) m.delete(k);
      m.set(key, hit);
    }
  }
  return { grids: hit.grids, scene: base.scene, kerbs: hit.kerbs };
}

/** Distinct obstacle ids blocking cells within `radius` of p, nearest first. */
export function blockersNear(g: LevelGrid, p: Vec2, radius: number): string[] {
  const c = cellOf(g, p);
  if (c < 0) return [];
  const k = Math.ceil(radius / g.cell), ci = c % g.nx, cj = Math.floor(c / g.nx);
  const best = new Map<string, number>();
  for (let j = Math.max(0, cj - k); j <= Math.min(g.nz - 1, cj + k); j++)
    for (let i = Math.max(0, ci - k); i <= Math.min(g.nx - 1, ci + k); i++) {
      const id = g.blockers.get(j * g.nx + i);
      if (!id) continue;
      const d = (i - ci) ** 2 + (j - cj) ** 2;
      if (d <= k * k && d < (best.get(id) ?? Infinity)) best.set(id, d);
    }
  return [...best.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)).map((e) => e[0]);
}

/** Nearest blocked cell centre to v on the inside of a corner (dot with `inward` > 0), within `radius`. */
function insideBlocker(g: LevelGrid, v: Vec2, inward: Vec2, radius: number): Vec2 | null {
  const c = cellOf(g, v);
  if (c < 0) return null;
  const k = Math.ceil(radius / g.cell), ci = c % g.nx, cj = Math.floor(c / g.nx);
  let best: Vec2 | null = null, bd = Infinity;
  for (let j = Math.max(0, cj - k); j <= Math.min(g.nz - 1, cj + k); j++)
    for (let i = Math.max(0, ci - k); i <= Math.min(g.nx - 1, ci + k); i++) {
      const n = j * g.nx + i;
      if (g.free[n]) continue;
      const q = centreOf(g, n);
      const d = sub2(q, v);
      if (dot2(d, inward) <= 0) continue;
      const dd = d[0] * d[0] + d[1] * d[1];
      if (dd < bd) { bd = dd; best = q; }
    }
  return best;
}

type Node = { c: Vec2; r: number; s: number; theta: number; kind: 'point' | 'fillet' | 'wrap' };
type Tangent = { a: Vec2; b: Vec2; d: Vec2 };

/** Tangent line leaving node A and arriving on node B, travelling round each in its sense s (+1 = left). */
function tangent(A: Node, B: Node): Tangent | null {
  const D = sub2(B.c, A.c);
  const k = B.s * B.r - A.s * A.r;
  const DD = D[0] * D[0] + D[1] * D[1];
  const L2 = DD - k * k;
  if (L2 <= 1e-9) return null;
  const L = Math.sqrt(L2);
  const lD = left(D);
  const d: Vec2 = [(L * D[0] - k * lD[0]) / DD, (L * D[1] - k * lD[1]) / DD];
  const ld = left(d);
  return { a: sub2(A.c, scale2(ld, A.s * A.r)), b: sub2(B.c, scale2(ld, B.s * B.r)), d };
}

/** Sweep (rad, ≥ 0) round node n from entry point e to exit point x in its sense. */
function sweepOf(n: Node, e: Vec2, x: Vec2): number {
  const a0 = heading(sub2(e, n.c)), a1 = heading(sub2(x, n.c));
  let w = n.s * (a1 - a0);
  const TAU = 2 * Math.PI;
  w -= TAU * Math.floor(w / TAU);
  if (w > TAU - 1e-9) w = 0;
  return w;
}

type Piece = { kind: 'line'; a: Vec2; b: Vec2 } | { kind: 'arc'; n: Node; e: Vec2; sweep: number };

function arcPoint(n: Node, e: Vec2, t: number): Vec2 {
  const a0 = heading(sub2(e, n.c)) + n.s * t;
  return [n.c[0] + n.r * dcos(a0), n.c[1] + n.r * dsin(a0)];
}

type Check = { ok: true } | { ok: false; at: Vec2; clearance: number };

/** Clearance check of one piece: every sample ≥ need(p). */
function checkPiece(g: LevelGrid, pc: Piece, need: (p: Vec2) => number): Check {
  if (pc.kind === 'line') {
    const len = dist2(pc.a, pc.b);
    const n = Math.max(1, Math.ceil(len / (g.cell * 0.5)));
    for (let i = 0; i <= n; i++) {
      const p: Vec2 = [pc.a[0] + ((pc.b[0] - pc.a[0]) * i) / n, pc.a[1] + ((pc.b[1] - pc.a[1]) * i) / n];
      const c = clearanceAt(g, p);
      if (c < need(p)) return { ok: false, at: p, clearance: c };
    }
    return { ok: true };
  }
  const len = pc.n.r * pc.sweep;
  const n = Math.max(1, Math.ceil(len / (g.cell * 0.5)));
  for (let i = 0; i <= n; i++) {
    const p = arcPoint(pc.n, pc.e, (pc.sweep * i) / n);
    const c = clearanceAt(g, p);
    if (c < need(p)) return { ok: false, at: p, clearance: c };
  }
  return { ok: true };
}

/**
 * Plan a vehicle route from `start` through `targets` (in order) on one level and turn it into a
 * curvature-limited reference curve with a speed profile. `cruise` caps the profile speed.
 */
export function planCurve(
  sp: Spatial, world: WorldState, pr: VehicleProfile, who: string, level: number, start: Vec2, targets: Vec2[], cruise: number, around?: AroundPerson[],
): CurveResult {
  const { grids, scene, kerbs } = vehicleGrids(sp, world, pr, level, around);
  const g = grids.levels.get(level);
  if (!g) return fail('route.unknown-level', `level ${level} does not exist`, who);
  const noLinks: SpatialScene = { ...scene, links: [] };
  const plan = { ...pr, radius: pr.radius + pr.trackMargin };
  const width = 2 * (plan.radius + 0.06);
  // corridor polyline through every target
  const pts: Vec2[] = [start];
  let from: Place = { level, p: start };
  for (const t of targets) {
    const r = findRoute(grids, noLinks, plan, from, { level, p: t });
    if (!r.ok) return refuse(grids, noLinks, pr, who, level, from.p, t, r.diagnostic, width);
    const leg = r.route.legs[0] as WalkLeg;
    for (const q of leg.points.slice(1)) if (dist2(q, pts[pts.length - 1]) > 1e-6) pts.push(q);
    from = { level, p: pts[pts.length - 1] };
  }
  if (pts.length < 2) pts.push(start);
  return smooth(g, pr, who, level, pts, cruise, kerbs);
}

/** Corridor polyline → tangent-arc curve (see header) → samples + speed profile. */
export function smooth(g: LevelGrid, pr: VehicleProfile, who: string, level: number, raw: Vec2[], cruise: number, kerbs: string[] = []): CurveResult {
  // drop collinear vertices
  const pts: Vec2[] = [raw[0]];
  for (let i = 1; i < raw.length - 1; i++) {
    const a = pts[pts.length - 1], b = raw[i], c = raw[i + 1];
    if (dist2(a, b) < 1e-6) continue;
    const th = Math.abs(angleDelta(heading(sub2(b, a)), heading(sub2(c, b))));
    if (th > 0.02) pts.push(b);
  }
  pts.push(raw[raw.length - 1]);
  const S = pts[0], E = pts[pts.length - 1];
  const r = pr.radius;
  const need = (p: Vec2) => (dist2(p, S) < 0.6 || dist2(p, E) < 0.6 ? r : r + TRACK_TOL);
  const rmin = pr.minTurnRadius * HEADROOM;
  const radii = [...new Set([pr.turnRadius * HEADROOM, ((pr.turnRadius + pr.minTurnRadius) / 2) * HEADROOM, rmin])];
  const point = (p: Vec2): Node => ({ c: p, r: 0, s: 0, theta: 0, kind: 'point' });
  const candidates = (i: number): Node[] => {
    const a = pts[i - 1], v = pts[i], b = pts[i + 1];
    const din = norm2(sub2(v, a)), dout = norm2(sub2(b, v));
    const theta = Math.abs(angleDelta(heading(din), heading(dout)));
    const s = cross2(din, dout) > 0 ? 1 : -1;
    const inward = norm2(sub2(dout, din));
    const O = insideBlocker(g, v, inward, clearanceAt(g, v) + 3 * g.cell);
    const out: Node[] = [];
    for (const rho of radii) {
      if (theta < 2.6) out.push({ c: add2(v, scale2(inward, rho / dcos(theta / 2))), r: rho, s, theta, kind: 'fillet' });
      if (O) out.push({ c: O, r: Math.max(rho, dist2(v, O)), s, theta, kind: 'wrap' });
    }
    return out;
  };
  // sequential choice with one step of backtracking: node i is accepted when the stretch from node
  // i-1's arc (re-exited toward node i) to node i's arc (exiting toward the next corridor vertex) is clear
  const n = pts.length;
  const cands: Node[][] = [[point(S)]];
  for (let i = 1; i < n - 1; i++) cands.push(candidates(i));
  cands.push([point(E)]);
  const choice = new Array<number>(n).fill(0);
  const nodeAt = (i: number) => cands[i][choice[i]];
  let fault: { at: Vec2; clearance: number; corner: number } | null = null;
  /**
   * Validated pieces from node i-1's entry point through node i's arc and on to the first candidate
   * of node i+1 that closes the geometry (the look-ahead); `bad` = the clearance fault, null = degenerate.
   */
  type Stretch = { pieces: Piece[]; entry: Vec2 } | { bad: Check | null };
  const stretch = (i: number, prevEntry: Vec2 | null): Stretch => {
    const P = nodeAt(i - 1), N = nodeAt(i);
    const t1 = tangent(P, N);
    if (!t1) return { bad: null };
    const head: Piece[] = [];
    if (P.kind !== 'point' && prevEntry) {
      const w = sweepOf(P, prevEntry, t1.a);
      if (w > P.theta + 0.8) return { bad: null };
      head.push({ kind: 'arc', n: P, e: prevEntry, sweep: w });
    }
    head.push({ kind: 'line', a: t1.a, b: t1.b });
    const firstBad = (ps: Piece[]): Check | null => {
      for (const pc of ps) {
        const c = checkPiece(g, pc, need);
        if (!c.ok) return c;
      }
      return null;
    };
    const hb = firstBad(head);
    if (hb) return { bad: hb };
    if (N.kind === 'point' || i + 1 >= n) return { pieces: head, entry: t1.b };
    let fault: Check | null = null;
    for (const X of cands[i + 1]) {
      const t2 = tangent(N, X);
      if (!t2) continue;
      const w = sweepOf(N, t1.b, t2.a);
      if (w > N.theta + 0.8) continue;
      const tail: Piece[] = [{ kind: 'arc', n: N, e: t1.b, sweep: w }, { kind: 'line', a: t2.a, b: t2.b }];
      const tb = firstBad(tail);
      if (!tb) return { pieces: [...head, ...tail], entry: t1.b };
      fault ??= tb;
    }
    return { bad: fault };
  };
  const entries: (Vec2 | null)[] = new Array(n).fill(null);
  const tryAt = (i: number): boolean => {
    for (let k = 0; k < cands[i].length; k++) {
      choice[i] = k;
      const st = stretch(i, entries[i - 1]);
      if ('pieces' in st) {
        entries[i] = st.entry;
        return true;
      }
      if (st.bad && !st.bad.ok && (!fault || i >= fault.corner)) fault = { at: st.bad.at, clearance: st.bad.clearance, corner: i };
    }
    return false;
  };
  for (let i = 1; i < n; i++) {
    if (tryAt(i)) continue;
    // backtrack once: another choice at the previous corner
    let fixed = false;
    if (i >= 2) {
      const start = choice[i - 1] + 1;
      for (let k = start; k < cands[i - 1].length && !fixed; k++) {
        choice[i - 1] = k;
        const st = stretch(i - 1, entries[i - 2]);
        if (!('pieces' in st)) continue;
        entries[i - 1] = st.entry;
        fixed = tryAt(i);
      }
    }
    if (!fixed) {
      const f = fault as { at: Vec2; clearance: number; corner: number } | null;
      const at = f ? f.at : pts[i];
      const near = blockersNear(g, at, (f?.clearance ?? 0) + 0.5);
      return fail(
        'vehicle.turn-too-tight',
        `${who} (${pr.id}, min turn radius ${pr.minTurnRadius} m, radius ${r} m) cannot make the turn at corner ${fmt(pts[Math.min(i, n - 1)])}: every curve it can steer passes ${fmt(at)} with ${(f?.clearance ?? 0).toFixed(2)} m clearance${near.length ? ` next to ${near.slice(0, 2).join(' and ')}` : ''}`,
        who, near.slice(0, 2), at,
      );
    }
  }
  // assemble final pieces
  const pieces: Piece[] = [];
  let entry: Vec2 | null = null;
  for (let i = 1; i < n; i++) {
    const P = nodeAt(i - 1), N = nodeAt(i);
    const t = tangent(P, N)!;
    if (P.kind !== 'point' && entry) pieces.push({ kind: 'arc', n: P, e: entry, sweep: sweepOf(P, entry, t.a) });
    pieces.push({ kind: 'line', a: t.a, b: t.b });
    entry = t.b;
  }
  // samples
  const samples: Sample[] = [];
  let s = 0;
  let minRadius = Infinity;
  const push = (p: Vec2, k: number) => {
    if (samples.length) s += dist2(samples[samples.length - 1].p, p);
    samples.push({ p, s, k });
  };
  for (const pc of pieces) {
    if (pc.kind === 'line') {
      const len = dist2(pc.a, pc.b);
      const m = Math.max(1, Math.ceil(len / SAMPLE));
      for (let i = samples.length ? 1 : 0; i <= m; i++) push([pc.a[0] + ((pc.b[0] - pc.a[0]) * i) / m, pc.a[1] + ((pc.b[1] - pc.a[1]) * i) / m], 0);
    } else {
      if (pc.sweep < 1e-9) continue;
      minRadius = Math.min(minRadius, pc.n.r);
      const len = pc.n.r * pc.sweep;
      const m = Math.max(1, Math.ceil(len / SAMPLE));
      for (let i = 1; i <= m; i++) push(arcPoint(pc.n, pc.e, (pc.sweep * i) / m), pc.n.s / pc.n.r);
    }
  }
  // speed profile: curvature limits, then braking backwards to a stop at the end
  const vmax = samples.map((q) => Math.min(cruise, q.k ? speedForRadius(pr, 1 / Math.abs(q.k) / HEADROOM) : cruise));
  vmax[vmax.length - 1] = 0;
  for (let i = vmax.length - 2; i >= 0; i--) vmax[i] = Math.min(vmax[i], Math.sqrt(vmax[i + 1] * vmax[i + 1] + 2 * pr.accel * (samples[i + 1].s - samples[i].s)));
  return { ok: true, curve: { level, samples, length: s, vmax, minRadius: minRadius === Infinity ? 0 : minRadius, kerbs } };
}

/** A refused vehicle route, with a diagnostic naming the geometry that stops this vehicle. */
function refuse(grids: GridSet, scene: SpatialScene, pr: VehicleProfile, who: string, level: number, from: Vec2, to: Vec2, d: Diagnostic, width: number): CurveResult {
  const g = grids.levels.get(level)!;
  const need = `${pr.id} radius ${pr.radius} m + ${pr.trackMargin} m tracking margin needs ${width.toFixed(2)} m clear width`;
  if (d.code === 'route.goal-blocked' || d.code === 'route.start-blocked') {
    const p = d.code === 'route.goal-blocked' ? to : from;
    const c = clearanceAt(g, p);
    const near = blockersNear(g, p, c + 0.5);
    return fail('vehicle.too-narrow', `${who} cannot ${d.code === 'route.goal-blocked' ? 'ride to' : 'start from'} ${fmt(p)}: the ${need}, but clearance there is ${c.toFixed(2)} m${near.length ? ` between ${near.slice(0, 2).join(' and ')}` : ''}`, who, near.slice(0, 2), p);
  }
  if (d.code === 'route.unreachable') {
    // where does the walking route squeeze below the vehicle's width?
    const walk = findRoute(grids, scene, { id: 'probe', radius: 0.28, height: 1.8, speed: 1, turnRate: 1, stepHeight: 0.22 }, { level, p: from }, { level, p: to });
    if (walk.ok && walk.route.legs[0].kind === 'walk') {
      const ptsW = (walk.route.legs[0] as WalkLeg).points;
      let worst: Vec2 = to, wc = Infinity;
      for (let i = 1; i < ptsW.length; i++) {
        const len = dist2(ptsW[i - 1], ptsW[i]);
        for (let t = 0; t <= len; t += g.cell * 0.5) {
          const p = add2(ptsW[i - 1], scale2(sub2(ptsW[i], ptsW[i - 1]), len ? t / len : 0));
          const c = clearanceAt(g, p);
          if (c < wc) { wc = c; worst = p; }
        }
      }
      const near = blockersNear(g, worst, wc + 0.5);
      return fail('vehicle.too-narrow', `${who} has no ${pr.id} route from ${fmt(from)} to ${fmt(to)}: the ${need}; the only way (walkable) squeezes to ${wc.toFixed(2)} m clearance at ${fmt(worst)}${near.length ? ` between ${near.slice(0, 2).join(' and ')}` : ''}`, who, near.slice(0, 2), worst);
    }
  }
  return { ok: false, diagnostic: { ...d, message: `${who} (${pr.id}): ${d.message}`, subjects: [who, ...(d.subjects ?? [])] } };
}

function fail(code: string, message: string, who: string, subjects: string[] = [], at?: Vec2): CurveResult {
  return { ok: false, diagnostic: { code, message, subjects: [who, ...subjects], at: at ? [at[0], 0, at[1]] : undefined } };
}
