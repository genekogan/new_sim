// Carrying on a stair flight (spec §7 "materials to upper levels"): the pure
// geometry shared by plan-time validation (validate.ts), the `carry` climb
// phase (actions.ts) and the per-tick invariant (invariants.ts).
//
// One carrier climbs the flight with the load in its carried pose, tilted
// about its lateral axis to follow the flight (as people carry a long board up
// a stair). The traversal follows the link's centreline polyline C(s) (3D arc
// length s), extended straight and level beyond both landings:
//   load  : its two ends ride carryHeight above C(s ± L/2), so it is level on a
//           landing and parallel to the flight on the steps; centre offset
//           laterally by oL;
//   carrier: on C(s + along), offset laterally by oC (hands beside the grip).
// oL/oC centre the load + carrier span on the flight. Clearance is checked
// against the flight's step profile (link.path points as tread centres).
import { datan2, obbOverlap, pointInObb, rot2, wrapAngle, type OBB2, type Vec2, type Vec3, hypot } from '../core/math.ts';
import type { Link, Obstacle } from '../spatial/types.ts';
import type { Pose } from '../world/types.ts';
import { def } from '../world/catalog.ts';
import { CARRIER_RADIUS, poseAt, REACH, toWorld, type Formation, type SE2 } from './formation.ts';

/** Required clear width each side of the load's cross-section on a flight (m). */
export const STAIR_SIDE_MARGIN = 0.1;
/** Tolerance of the step-profile clearance check (m). */
export const STAIR_CLEAR_TOL = 0.02;
/** Climbing speed along the flight (m/s of centreline arc length) — walk_to's CLIMB_SPEED. */
export const CARRY_CLIMB_SPEED = 0.45;

export type Line3 = { pts: Vec3[]; s: number[]; total: number };
export type ClimbGeom = {
  link: Link;
  ascending: boolean;
  /** Formation heading on the flight (ascending: link.heading). */
  face: number;
  line: Line3;
  /** Arc lengths of the first / last step point and of the exit landing point. */
  sFirst: number;
  sLast: number;
  sExit: number;
  /** Lateral offsets (along rot2([0, 1], face)) of the load centre and the carrier from the centreline. */
  oL: number;
  oC: number;
  /** Carrier's along-offset from the load centre (formation slot). */
  along: number;
};
export type ClimbPose = { q: SE2; y: number; tilt: number; load: Pose; carrier: Vec3 };

function line(pts: Vec3[]): Line3 {
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
  return { pts, s, total: s[s.length - 1] };
}

export function lineAt(l: Line3, at: number): Vec3 {
  const t0 = Math.max(0, Math.min(l.total, at));
  let i = 0;
  while (i < l.pts.length - 2 && l.s[i + 1] < t0) i++;
  const span = l.s[i + 1] - l.s[i];
  const t = span > 1e-12 ? (t0 - l.s[i]) / span : 1;
  const a = l.pts[i], b = l.pts[i + 1];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Traversal geometry of a link for formation f (single carrier), extended `ext` m beyond both landings. */
export function climbGeom(link: Link, ascending: boolean, f: Formation, ext = f.length + 3): ClimbGeom {
  const face = ascending ? link.heading : wrapAngle(link.heading + Math.PI);
  const dir = rot2([1, 0], face);
  const entry = ascending ? link.from : link.to, exit = ascending ? link.to : link.from;
  const steps = ascending ? link.path : [...link.path].reverse();
  const pts: Vec3[] = [
    [entry.p[0] - dir[0] * ext, entry.y, entry.p[1] - dir[1] * ext],
    [entry.p[0], entry.y, entry.p[1]],
    ...steps.map((q) => [q[0], q[1], q[2]] as Vec3),
    [exit.p[0], exit.y, exit.p[1]],
    [exit.p[0] + dir[0] * ext, exit.y, exit.p[1] + dir[1] * ext],
  ];
  const l = line(pts);
  const c = f.carriers[0];
  // centre the span (load far edge … carrier far edge) on the flight's centreline
  const oL = -c.side * (REACH + CARRIER_RADIUS) / 2;
  const oC = oL + c.side * (f.width / 2 + REACH);
  return { link, ascending, face, line: l, sFirst: l.s[2], sLast: l.s[1 + steps.length], sExit: l.s[pts.length - 2], oL, oC, along: c.along };
}

/** Load pose + carrier position at traversal parameter s (the load centre's arc length). */
export function climbPose(f: Formation, c: ClimbGeom, s: number): ClimbPose {
  const A = lineAt(c.line, s - f.length / 2), B = lineAt(c.line, s + f.length / 2), C = lineAt(c.line, s + c.along);
  const lat = rot2([0, 1], c.face);
  const tilt = datan2(B[1] - A[1], hypot(B[0] - A[0], B[2] - A[2]));
  const q: SE2 = { x: (A[0] + B[0]) / 2 + lat[0] * c.oL, z: (A[2] + B[2]) / 2 + lat[1] * c.oL, th: c.face };
  const y = (A[1] + B[1]) / 2 + f.carryHeight;
  const load = poseAt(f.defId, { pitch: f.carry.pitch, roll: f.carry.roll + tilt }, q, { centre: y });
  return { q, y, tilt, load, carrier: [C[0] + lat[0] * c.oC, C[1], C[2] + lat[1] * c.oC] };
}

/** The flight's plan footprint (first → last step point, link width). */
export function flightObb(link: Link): OBB2 {
  const a = link.path[0], b = link.path[link.path.length - 1];
  return { c: [(a[0] + b[0]) / 2, (a[2] + b[2]) / 2], half: [hypot(b[0] - a[0], b[2] - a[2]) / 2, link.width / 2], yaw: link.heading };
}

/** Step-profile height under along-coordinate u (from link.from.p along link.heading): nearest step point; landings beyond. */
function profile(link: Link) {
  const o = link.from.p, dir = rot2([1, 0], link.heading);
  const us = link.path.map((q) => (q[0] - o[0]) * dir[0] + (q[2] - o[1]) * dir[1]);
  const ys = link.path.map((q) => q[1]);
  const height = (u: number) => {
    if (u < us[0]) return link.from.y;
    if (u > us[us.length - 1]) return link.to.y;
    let best = 0;
    for (let i = 1; i < us.length; i++) if (Math.abs(us[i] - u) < Math.abs(us[best] - u)) best = i;
    return ys[best];
  };
  return { o, dir, height, u0: us[0], u1: us[us.length - 1] };
}

/** World points sampled every ≤ 5 cm along the 12 edges of a component box at `pose`. */
export function boxEdgeSamples(defId: string, pose: Pose, step = 0.05): Vec3[] {
  const [sx, sy, sz] = def(defId).size;
  const corner = (i: number): Vec3 => [(i & 1 ? 0.5 : -0.5) * sx, i & 2 ? sy : 0, (i & 4 ? 0.5 : -0.5) * sz];
  const out: Vec3[] = [];
  for (let i = 0; i < 8; i++)
    for (const bit of [1, 2, 4]) {
      if (i & bit) continue;
      const a = corner(i), b = corner(i | bit);
      const n = Math.max(1, Math.ceil(hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / step));
      for (let k = 0; k <= n; k++) out.push(toWorld(pose, [a[0] + (b[0] - a[0]) * (k / n), a[1] + (b[1] - a[1]) * (k / n), a[2] + (b[2] - a[2]) * (k / n)]));
    }
  return out;
}

export type StairClearanceIssue = { deficit: number; at: Vec3; surface: number };

/**
 * The load box stays above the flight's step profile: every sampled edge point
 * within the flight's lateral band has y ≥ step height under it − STAIR_CLEAR_TOL.
 * Returns the worst deficit or null.
 */
export function stairClearance(link: Link, defId: string, pose: Pose): StairClearanceIssue | null {
  const pr = profile(link);
  let worst: StairClearanceIssue | null = null;
  for (const p of boxEdgeSamples(defId, pose)) {
    const dx = p[0] - pr.o[0], dz = p[2] - pr.o[1];
    const u = dx * pr.dir[0] + dz * pr.dir[1], v = -dx * pr.dir[1] + dz * pr.dir[0];
    if (Math.abs(v) > link.width / 2 + 0.6) continue;
    const h = pr.height(u);
    const deficit = h - STAIR_CLEAR_TOL - p[1];
    if (deficit > 0 && (!worst || deficit > worst.deficit)) worst = { deficit, at: p, surface: h };
  }
  return worst;
}

/**
 * Scene obstacles the load may meet on the flight: everything except the flight's own body (the link's
 * id, or anything rising from the flight's base inside its footprint — its envelope is the step profile).
 * Overhead obstacles across the flight are kept.
 */
export function climbObstacles(obstacles: Obstacle[], link: Link, exclude: string[]): Obstacle[] {
  const fo = flightObb(link);
  const base = Math.min(link.from.y, link.to.y) + 0.05;
  return obstacles.filter((o) => !exclude.includes(o.id) && o.id !== link.id && !(o.y0 <= base && obbOverlap(o.obb, fo, -0.05)));
}

/** First obstacle a sampled edge point of the load box lies inside (plan-time; exact per sample). */
export function loadObstacleHit(defId: string, pose: Pose, obstacles: Obstacle[]): { o: Obstacle; at: Vec3 } | null {
  if (!obstacles.length) return null;
  for (const p of boxEdgeSamples(defId, pose, 0.1))
    for (const o of obstacles) if (p[1] > o.y0 + 0.01 && p[1] < o.y1 - 0.01 && pointInObb([p[0], p[2]] as Vec2, o.obb)) return { o, at: p };
  return null;
}

/** The link whose flight a climbing load is on: nearest centreline within its lateral band. */
export function linkUnder(links: Link[], at: Vec2, length: number): Link | null {
  let best: Link | null = null, bv = Infinity;
  for (const l of links) {
    const dir = rot2([1, 0], l.heading);
    const dx = at[0] - l.from.p[0], dz = at[1] - l.from.p[1];
    const u = dx * dir[0] + dz * dir[1], v = Math.abs(-dx * dir[1] + dz * dir[0]);
    const run = hypot(l.to.p[0] - l.from.p[0], l.to.p[1] - l.from.p[1]);
    if (v > l.width / 2 + 0.6 || u < -length - 1 || u > run + length + 1) continue;
    if (v < bv) { bv = v; best = l; }
  }
  return best;
}

