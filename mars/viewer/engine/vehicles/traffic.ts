// Vehicle–vehicle traffic (VEHICLES.md "Vehicle–vehicle collision"): footprints, lanes, right of
// way, the `collision.vehicle-vehicle` invariant and the plan-time `vehicle.path-conflict` check.
//
// - Footprint: a vehicle's catalog box, its rider's body (ridden), any load on its forks, plus
//   per-def extras registered in FOOTPRINT_PARTS (forklift.ts adds the fork tines). Boxes are kept
//   in the vehicle's local frame so a footprint can be placed at any pose along a path.
// - Lane: every ride (ride_to / ride_loop / the forklift's drive) publishes, each tick, its
//   remaining path ahead (a horizon of LANE_T seconds at its speed, plus stopping distance and its
//   front overhang) in `services.vehicleLanes` — plain data, so it snapshots; not world state, so
//   it never touches a state hash.
// - Right of way: the smaller vehicle yields (profile radius: EUC 0.35 < bicycle 0.40 < forklift
//   1.4); between equals the ride that started earlier keeps its way, then the lower vehicle id.
// Everything here engages only when a second ridden vehicle is on the level: single-vehicle scenes
// never reach it.
import { add2, dist2, dot2, heading, norm2, obbCorners, obbOverlap, rot2, sub2, wrapAngle, type OBB2, type Vec2 } from '../core/math.ts';
import type { Diagnostic } from '../actions/types.ts';
import type { Invariant, Runtime } from '../runtime/runtime.ts';
import type { Entity, WorldState } from '../world/types.ts';
import type { AroundPerson, Spatial } from '../spatial/service.ts';
import { clearanceAt } from '../spatial/grid.ts';
import { def, HUMAN_RADIUS } from '../world/catalog.ts';
import { vehicleProfile, type VehicleProfile } from './profiles.ts';
import { planCurve, vehicleGrids, type Curve } from './curve.ts';
import { entityList } from '../world/entity-list.ts';

/** Body gap (m) a yielding vehicle keeps from the right-of-way vehicle's lane (its path ± half-width). */
export const YIELD_GAP = 1.0;
/** A vehicle stops this body gap (m) short of another vehicle's footprint lying on its path. */
export const V_STOP_GAP = 1.0;
/** Another vehicle's footprint within this body gap (m) of the swept path is "on the path". */
export const V_ON_PATH = 0.25;
/** Lane horizon: seconds of travel at the current speed published ahead of a riding vehicle. */
export const LANE_T = 4;
/** Minimum published lane length (m) beyond the vehicle's front. */
export const LANE_MIN = 3;
const LANE_STEP = 0.5;
const BODY_H = 1.8;
const HR = HUMAN_RADIUS;

export type LocalBox = { c: Vec2; half: Vec2; yaw: number; y0: number; y1: number; part: string };
export type Box = { obb: OBB2; y0: number; y1: number; part: string };
/** A vehicle's footprint in its own frame: boxes, reach (farthest corner from the centre), lateral half-width, front overhang. */
export type Footprint = { vehicle: string; boxes: LocalBox[]; reach: number; half: number; front: number };

/** Extra footprint parts per vehicle def, in the vehicle's local frame (forklift.ts registers the tines). */
export const FOOTPRINT_PARTS: Record<string, (w: WorldState, v: Entity) => LocalBox[]> = {};

export const riderOf = (w: WorldState, v: Entity): Entity | undefined => (v.support?.kind === 'ridden-by' ? w.entities[v.support.by] : undefined);

export function footprintOf(w: WorldState, v: Entity): Footprint {
  const d = def(v.def);
  const y = v.pose.p[1];
  const vp: Vec2 = [v.pose.p[0], v.pose.p[2]];
  const boxes: LocalBox[] = [{ c: [0, 0], half: [d.size[0] / 2, d.size[2] / 2], yaw: 0, y0: y, y1: y + d.size[1], part: v.id }];
  const r = riderOf(w, v);
  if (r?.human) boxes.push({ c: [0, 0], half: [HR, HR], yaw: 0, y0: r.pose.p[1], y1: r.pose.p[1] + BODY_H, part: r.id });
  boxes.push(...(FOOTPRINT_PARTS[v.def]?.(w, v) ?? []));
  for (const e of entityList(w)) {
    if (e.support?.kind !== 'forks' || e.support.vehicle !== v.id) continue;
    const ld = def(e.def);
    boxes.push({ c: rot2(sub2([e.pose.p[0], e.pose.p[2]], vp), -v.pose.yaw), half: [ld.size[0] / 2, ld.size[2] / 2], yaw: wrapAngle(e.pose.yaw - v.pose.yaw), y0: e.pose.p[1], y1: e.pose.p[1] + ld.size[1], part: e.id });
  }
  let reach = 0, half = 0, front = 0;
  for (const b of boxes)
    for (const q of obbCorners({ c: b.c, half: b.half, yaw: b.yaw })) {
      reach = Math.max(reach, Math.sqrt(q[0] * q[0] + q[1] * q[1]));
      half = Math.max(half, Math.abs(q[1]));
      front = Math.max(front, q[0]);
    }
  return { vehicle: v.id, boxes, reach, half, front };
}

/** Footprint boxes placed at (p, yaw). */
export const place = (fp: Footprint, p: Vec2, yaw: number): Box[] =>
  fp.boxes.map((b) => ({ obb: { c: add2(p, rot2(b.c, yaw)), half: b.half, yaw: wrapAngle(yaw + b.yaw) }, y0: b.y0, y1: b.y1, part: b.part }));

export const distToObb = (p: Vec2, o: OBB2) => {
  const l = rot2(sub2(p, o.c), -o.yaw);
  const dx = Math.max(Math.abs(l[0]) - o.half[0], 0), dz = Math.max(Math.abs(l[1]) - o.half[1], 0);
  return Math.sqrt(dx * dx + dz * dz);
};

/** Ground-plan gap between two sets of boxes (0 when any pair overlaps). Exact for convex boxes: a closest pair always has a corner of one. */
export function boxGap(a: OBB2[], b: OBB2[]): number {
  let g = Infinity;
  for (const x of a)
    for (const y of b) {
      if (obbOverlap(x, y)) return 0;
      for (const q of obbCorners(x)) g = Math.min(g, distToObb(q, y));
      for (const q of obbCorners(y)) g = Math.min(g, distToObb(q, x));
    }
  return g;
}

function distToSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub2(b, a), l2 = dot2(ab, ab);
  const t = l2 > 1e-12 ? Math.max(0, Math.min(1, dot2(sub2(p, a), ab) / l2)) : 0;
  return dist2(p, add2(a, [ab[0] * t, ab[1] * t]));
}
export function distToPath(p: Vec2, path: Vec2[]): number {
  if (path.length === 1) return dist2(p, path[0]);
  let d = Infinity;
  for (let i = 0; i + 1 < path.length; i++) d = Math.min(d, distToSeg(p, path[i], path[i + 1]));
  return d;
}

// ─── lanes (services.vehicleLanes) ─────────────────────────────────────────────────────────────

export type Lane = {
  vehicle: string; actor: string; def: string; level: number; tick: number; since: number;
  v: number; cruise: number; brake: number; rank: number;
  /** Path ahead from the vehicle centre (world x, z), LANE_STEP apart. */
  path: Vec2[];
  half: number; reach: number;
};

const lanes = (rt: Runtime): Record<string, Lane> => (rt.services.vehicleLanes ??= {}) as Record<string, Lane>;

/** Publish a ride's lane: `samples` from `idx` on, up to LANE_T s at `v` + stopping distance + the footprint's front. */
export function publishLane(rt: Runtime, o: { vehicle: Entity; actor: string; level: number; since: number; v: number; cruise: number; pr: VehicleProfile; samples: { p: Vec2; s: number }[]; idx: number }) {
  const fp = footprintOf(rt.world, o.vehicle);
  const S = o.samples;
  const s0 = S[o.idx].s;
  const horizon = s0 + Math.max(LANE_MIN, o.v * LANE_T) + (o.v * o.v) / (2 * o.pr.brake) + fp.front;
  const path: Vec2[] = [[o.vehicle.pose.p[0], o.vehicle.pose.p[2]]];
  let next = s0 + LANE_STEP;
  for (let j = o.idx; j < S.length && S[j].s <= horizon; j++)
    if (S[j].s >= next || j === S.length - 1) { path.push(S[j].p); next = S[j].s + LANE_STEP; }
  lanes(rt)[o.vehicle.id] = { vehicle: o.vehicle.id, actor: o.actor, def: o.vehicle.def, level: o.level, tick: rt.tick, since: o.since, v: o.v, cruise: o.cruise, brake: o.pr.brake, rank: o.pr.radius, path, half: fp.half, reach: fp.reach };
}
export function dropLane(rt: Runtime, vehicle: string) {
  const l = rt.services.vehicleLanes as Record<string, Lane> | undefined;
  if (l && l[vehicle]) delete l[vehicle];
}
/** A lane published this tick or the last (rides step in submission order), by a vehicle still ridden. */
export function freshLane(rt: Runtime, v: Entity): Lane | undefined {
  const l = (rt.services.vehicleLanes as Record<string, Lane> | undefined)?.[v.id];
  return l && l.tick >= rt.tick - 1 && v.support?.kind === 'ridden-by' ? l : undefined;
}

// ─── others, right of way ──────────────────────────────────────────────────────────────────────

export type Other = { v: Entity; rider: Entity; fp: Footprint; boxes: Box[]; lane?: Lane };

/** Ridden vehicles other than `self` whose riders are on `level`, in canonical entity order. */
export function othersOnLevel(rt: Runtime, self: string, level: number): Other[] {
  const out: Other[] = [];
  const w = rt.world;
  for (const v of entityList(w)) {
    if (v.kind !== 'vehicle' || v.id === self || v.support?.kind !== 'ridden-by') continue;
    const r = w.entities[v.support.by];
    if (!r?.human || r.human.level !== level || !vehicleProfile(v.def)) continue;
    const fp = footprintOf(w, v);
    out.push({ v, rider: r, fp, boxes: place(fp, [v.pose.p[0], v.pose.p[2]], v.pose.yaw), lane: freshLane(rt, v) });
  }
  return out;
}

export type Rank = { rank: number; since: number; id: string };
/** True when `a` has the right of way over `b`: larger vehicle, then the earlier ride, then the lower id. */
export function outranks(a: Rank, b: Rank): boolean {
  if (Math.abs(a.rank - b.rank) > 1e-9) return a.rank > b.rank;
  if (a.since !== b.since) return a.since < b.since;
  return a.id < b.id;
}

/** Body gap from a disc (centre c, radius reach) to another vehicle's lane band (path ± half) and its current footprint. */
export function bandGap(c: Vec2, reach: number, lane: Lane, boxes: Box[]): number {
  let g = distToPath(c, lane.path) - lane.half;
  for (const b of boxes) g = Math.min(g, distToObb(c, b.obb));
  return g - reach;
}

/** Other ridden vehicles as avoidance discs for planCurve (tiles of their footprint boxes, 0.4 m apart; octagons of half 0.3). */
export function vehicleAround(others: Other[]): AroundPerson[] {
  const out: AroundPerson[] = [];
  for (const o of others)
    for (const b of o.boxes) {
      if (b.part === o.rider.id) continue; // the rider stands inside the vehicle's own box
      const nx = Math.max(1, Math.ceil((2 * b.obb.half[0]) / 0.4)), nz = Math.max(1, Math.ceil((2 * b.obb.half[1]) / 0.4));
      for (let i = 0; i <= nx; i++)
        for (let k = 0; k <= nz; k++) {
          const l: Vec2 = [-b.obb.half[0] + (2 * b.obb.half[0] * i) / nx, -b.obb.half[1] + (2 * b.obb.half[1] * k) / nz];
          out.push({ id: `${o.v.id}#${out.length}`, p: add2(b.obb.c, rot2(l, b.obb.yaw)), half: 0.3 });
        }
    }
  return out;
}

const f2 = (x: number) => x.toFixed(2);
const fmt = (p: Vec2) => `(${f2(p[0])}, ${f2(p[1])})`;
export const describe = (o: { v: Entity; rider: Entity }) => `${o.rider.id} on ${o.v.id} (${o.v.def})`;

// ─── pull over ─────────────────────────────────────────────────────────────────────────────────

/**
 * A spot beside `lane` (on the side the vehicle already is; both sides, left first, when it is on
 * the lane's line) whose body gap to the lane band is ≥ YIELD_GAP + 0.1, with static clearance for
 * the vehicle and a drivable curve to it from `from`. Candidates: straight out from the nearest lane
 * point, then 1.5 / 3 m along the lane away from and toward the other vehicle. Null if none.
 */
export function pullOverSpot(rt: Runtime, me: { v: Entity; pr: VehicleProfile; fp: Footprint; level: number; who: string }, o: Other & { lane: Lane }, from: Vec2, around: AroundPerson[]): { spot: Vec2; curve: Curve } | null {
  const sp = rt.services.spatial as Spatial;
  const P = o.lane.path;
  let bi = 0, bd = Infinity;
  for (let i = 0; i + 1 < P.length; i++) {
    const d = distToSeg(from, P[i], P[i + 1]);
    if (d < bd - 1e-9) { bd = d; bi = i; }
  }
  const t = P.length > 1 ? norm2(sub2(P[bi + 1], P[bi])) : norm2(sub2(from, P[0]));
  const n: Vec2 = [-t[1], t[0]];
  const lat = dot2(sub2(from, P[bi]), n);
  const sides = Math.abs(lat) < 0.05 ? [1, -1] : [lat > 0 ? 1 : -1];
  // along the lane: "away" from the other vehicle = direction of travel of the lane
  const alongs = [0, 1.5, -1.5, 3, -3];
  const D = o.lane.half + YIELD_GAP + me.fp.reach + 0.15;
  const g = vehicleGrids(sp, rt.world, me.pr, me.level, around).grids.levels.get(me.level);
  if (!g) return null;
  const u = dot2(sub2(from, P[bi]), t);
  const base = add2(P[bi], [t[0] * u, t[1] * u]); // from's foot on the nearest lane segment's line
  for (const side of sides)
    for (const along of alongs)
      for (const extra of [0, 0.5, 1.0]) {
        const spot = add2(add2(base, [t[0] * along, t[1] * along]), [n[0] * side * (D + extra), n[1] * side * (D + extra)]);
        if (clearanceAt(g, spot) < me.pr.radius + me.pr.trackMargin) continue;
        if (bandGap(spot, me.fp.reach, o.lane, o.boxes) < YIELD_GAP + 0.1) continue;
        const r = planCurve(sp, rt.world, me.pr, me.who, me.level, from, [spot], Math.min(me.pr.speed, 1.5), around);
        if (r.ok) return { spot, curve: r.curve };
      }
  return null;
}

// ─── plan-time conflict ────────────────────────────────────────────────────────────────────────

/** Time at each curve sample, from standstill: v(s) = min(vmax, cruise, √(2·accel·s)). */
function sampleTimes(c: Curve, pr: VehicleProfile, cruise: number): number[] {
  const S = c.samples;
  const out = [0];
  for (let j = 1; j < S.length; j++) {
    const ds = S[j].s - S[j - 1].s;
    const v = Math.max(0.2, Math.min(c.vmax[j] ?? cruise, cruise, Math.sqrt(2 * pr.accel * S[j].s)));
    out.push(out[j - 1] + ds / v);
  }
  return out;
}
/** Point at arc length d along a polyline (clamped to its end). */
function alongPath(P: Vec2[], d: number): Vec2 {
  for (let i = 0; i + 1 < P.length; i++) {
    const l = dist2(P[i], P[i + 1]);
    if (d <= l) return l > 1e-9 ? add2(P[i], [((P[i + 1][0] - P[i][0]) * d) / l, ((P[i + 1][1] - P[i][1]) * d) / l]) : P[i];
    d -= l;
  }
  return P[P.length - 1];
}

/**
 * Plan-time `vehicle.path-conflict`: does the curve a vehicle is about to ride (from standstill)
 * bring it within YIELD_GAP of another riding vehicle's lane in the same time window (both
 * advanced along their paths, 0.1 s steps over 10 s, discs of their footprint reach) with no way
 * for the one that must yield to do so? The yielder can yield when it can wait outside the other's
 * lane (for the planner: its start is outside it), stop short of the other's footprint within its
 * braking distance, or pull over. Null when there is no conflict or a yield option exists.
 */
export function pathConflict(rt: Runtime, me: { actor: string; v: Entity; pr: VehicleProfile; level: number }, curve: Curve, cruise: number): Diagnostic | null {
  const others = othersOnLevel(rt, me.v.id, me.level).filter((o): o is Other & { lane: Lane } => !!o.lane && o.lane.path.length > 1);
  if (!others.length) return null;
  const fp = footprintOf(rt.world, me.v);
  const start: Vec2 = [me.v.pose.p[0], me.v.pose.p[2]];
  const T = sampleTimes(curve, me.pr, cruise);
  const S = curve.samples;
  const mine: Rank = { rank: me.pr.radius, since: rt.tick, id: me.v.id };
  const around = vehicleAround(others);
  for (const o of others) {
    const L = o.lane;
    const vo = L.v > 0.2 ? L.v : Math.max(0.5 * L.cruise, 0.2);
    let hit: { t: number; p: Vec2 } | null = null;
    for (let t = 0, j = 0; t <= 10 + 1e-9 && !hit; t += 0.1) {
      while (j + 1 < S.length && T[j + 1] <= t) j++;
      const p = S[j].p, q = alongPath(L.path, vo * t);
      if (dist2(p, q) - fp.reach - L.reach < YIELD_GAP) hit = { t, p };
    }
    if (!hit) continue;
    const who = `${me.actor} on ${me.v.id}`;
    const them = describe(o);
    const startGap = bandGap(start, fp.reach, L, o.boxes);
    if (!outranks(mine, { rank: L.rank, since: L.since, id: o.v.id })) {
      if (startGap >= YIELD_GAP) continue; // it waits outside their lane (the follower stops it there)
      if (pullOverSpot(rt, { v: me.v, pr: me.pr, fp, level: me.level, who }, o, start, around)) continue;
      return conflict(me, o, hit, `${who} must give way to ${them} but starts ${f2(Math.max(0, startGap))} m from its lane (keeps ${YIELD_GAP} m) with no room to pull over`);
    }
    if (startGap >= YIELD_GAP) continue; // it has the right of way, and can still wait where it is
    // it stands in their lane: they must stop short of it (V_STOP_GAP) within their braking distance, or pull over
    let dStop = Infinity, acc = 0;
    const mineBoxes = place(fp, start, me.v.pose.yaw);
    for (let i = 0; i + 1 < L.path.length && dStop === Infinity; i++) {
      const a = L.path[i], b = L.path[i + 1], l = dist2(a, b);
      for (let k = 0; k <= 10; k++) {
        const q = add2(a, [((b[0] - a[0]) * k) / 10, ((b[1] - a[1]) * k) / 10]);
        const theirs = place(o.fp, q, heading(sub2(b, a)));
        if (boxGap(theirs.map((x) => x.obb), mineBoxes.map((x) => x.obb)) < V_STOP_GAP) { dStop = acc + (l * k) / 10; break; }
      }
      acc += l;
    }
    if (dStop - 0.1 >= (L.v * L.v) / (2 * L.brake)) continue;
    const opr = vehicleProfile(o.v.def);
    if (opr && pullOverSpot(rt, { v: o.v, pr: opr, fp: o.fp, level: me.level, who: them }, { ...o, lane: { ...L, path: S.filter((_, i) => i % 5 === 0).map((s) => s.p), half: fp.half, reach: fp.reach } }, [o.v.pose.p[0], o.v.pose.p[2]], vehicleAround(othersOnLevel(rt, o.v.id, me.level)))) continue;
    return conflict(me, o, hit, `${them} cannot stop short of ${who} (it needs ${f2((L.v * L.v) / (2 * L.brake))} m, has ${f2(Math.max(0, dStop))} m) and has no room to pull over`);
  }
  return null;
}

function conflict(me: { actor: string; v: Entity }, o: Other, hit: { t: number; p: Vec2 }, why: string): Diagnostic {
  return {
    code: 'vehicle.path-conflict',
    message: `${me.actor} on ${me.v.id} (${me.v.def}) would meet ${describe(o)} near ${fmt(hit.p)} ${hit.t.toFixed(1)} s from now: ${why}`,
    subjects: [me.actor, me.v.id, o.rider.id, o.v.id],
    at: [hit.p[0], me.v.pose.p[1], hit.p[1]],
  };
}

// ─── invariant ─────────────────────────────────────────────────────────────────────────────────

/**
 * collision.vehicle-vehicle: no two vehicles' footprints (catalog box, rider body, fork tines, a
 * carried / raised load) overlap in plan by more than 1 cm where their height bands overlap by
 * more than 1 cm. Parked and ridden vehicles alike; one violation per pair per tick.
 */
export const vehicleCollision: Invariant = (rt: Runtime) => {
  const w = rt.world;
  const vs: Entity[] = [];
  for (const e of entityList(w)) if (e.kind === 'vehicle' && vehicleProfile(e.def)) vs.push(e);
  if (vs.length < 2) return [];
  const placed = vs.map((v) => ({ v, boxes: place(footprintOf(w, v), [v.pose.p[0], v.pose.p[2]], v.pose.yaw) }));
  const out: Diagnostic[] = [];
  for (let i = 0; i < placed.length; i++)
    for (let k = i + 1; k < placed.length; k++) {
      const A = placed[i], B = placed[k];
      const hits: [Box, Box][] = [];
      for (const a of A.boxes)
        for (const b of B.boxes)
          if (Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.01 && obbOverlap(a.obb, b.obb, -0.01)) hits.push([a, b]);
      if (!hits.length) continue;
      // name the most specific pair: a load or rider over a vehicle body
      const score = (h: [Box, Box]) => (h[0].part !== A.v.id ? 1 : 0) + (h[1].part !== B.v.id ? 1 : 0);
      const [a, b] = hits.reduce((x, h) => (score(h) > score(x) ? h : x));
      const part = (x: Box, v: Entity) => (x.part === v.id ? `${v.id} (${v.def})` : `${v.id}'s ${x.part}`);
      const c: Vec2 = [(a.obb.c[0] + b.obb.c[0]) / 2, (a.obb.c[1] + b.obb.c[1]) / 2];
      const parts = new Set<string>();
      for (const [x, y] of hits) for (const q of [x.part, y.part]) if (q !== A.v.id && q !== B.v.id) parts.add(q);
      out.push({
        code: 'collision.vehicle-vehicle',
        message: `${part(a, A.v)} overlaps ${part(b, B.v)} near ${fmt(c)} (vehicle footprints, ${f2(Math.max(a.y0, b.y0))}–${f2(Math.min(a.y1, b.y1))} m up)`,
        subjects: [A.v.id, B.v.id, ...parts],
        at: [c[0], Math.max(a.y0, b.y0), c[1]],
      });
    }
  return out;
};
