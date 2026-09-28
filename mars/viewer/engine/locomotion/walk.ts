// walk_to: global route (spatial/path.ts) → corridor following → contextual
// stair traversal. Layers are separate as in Unity/Detour practice:
//   planning  : route legs with guaranteed clearance (replanned only on topology change)
//   smoothing : each walk leg's polyline becomes straight runs + circular fillets inside the
//               corridor clearance (locomotion/spline.ts), with a speed cap per vertex
//   steering  : arc-length progress along the smoothed corridor, curvature + look-ahead speed caps,
//               heading follows the path (turn in place only beyond 120°), lateral right-hand
//               passing offset bounded by local clearance
//   reaction  : a 1.5 s look-ahead stops short of standing people, carried loads and geometry; a
//               block is decided within 0.5 s (wait with a named reason, or replan around)
//               (docs/engineering/MOVEMENT.md)
//   traffic   : single-file passages are exclusive resources per direction (yield, never oscillate)
//   animation : consumers read pose + human.activity; they never write positions
import { z } from 'zod';
import { add2, angleDelta, clamp, dist2, heading, len2, norm2, rot2, scale2, sub2, wrapAngle, type OBB2, type Vec2 } from '../core/math.ts';
import type { ActionDef, Diagnostic, StepResult } from '../actions/types.ts';
import { DT, type Runtime } from '../runtime/runtime.ts';
import type { Entity } from '../world/types.ts';
import { entityFootprint, type AroundPerson, type Spatial } from '../spatial/service.ts';
import { cellOf, clearanceAt, nearestBlocker, segmentClearance, type LevelGrid } from '../spatial/grid.ts';
import { PLAN_MARGIN, type Leg, type LinkLeg, type Route, type WalkLeg } from '../spatial/path.ts';
import { smoothPolyline, type PathSeg } from './spline.ts';
import { HUMAN_PROFILE, type AgentProfile } from '../spatial/types.ts';

const ACCEL = 1.2; // m/s²
const BRAKE = 2 * ACCEL; // m/s² ordinary deceleration
const CLIMB_SPEED = 0.45; // m/s along the stair path
/** Heading error (rad) at and above which the walker cannot walk off: it turns in place (120°). */
export const TURN_IN_PLACE = 2.1;
const HEAD_FULL = 0.35; // rad heading error up to which full speed is allowed; linear down to 0 at TURN_IN_PLACE
const FACE_LOOK = 0.3; // m: heading aims along the chord to the path point this far ahead
/** Ground speed (m/s) below which a walker is not shown walking: activity 'walk' needs ≥ WALK_MIN. */
export const WALK_MIN = 0.08;
const LOOK_TIME = 1.5; // s of look-ahead along the corridor for standing people, loads, geometry
const STOP_GAP = 0.02; // m kept before the exact contact point of a hazard when stopping for it
const VEHICLE_GAP = 1.5; // m body gap to a vehicle being driven within which a walker slows (look-ahead included)
const VEHICLE_WALK = 0.5; // m/s walking speed near a vehicle that is being driven
/** Ticks (0.5 s) after which a walker still blocked by something that has not moved replans around it. */
export const DECIDE_TICKS = 10;
const PASS_OFFSET = 0.45; // m lateral offset when passing another walker
const PASS_SPEED = 0.7; // m/s cap while two walkers pass head-on with room for both (never a stop)
const STATIC_OFFSET = 0.8; // m sidestep around a standing person
const STUCK_TICKS = 80; // 4 s blocked by a person / load that keeps moving → replan around them anyway
const MAX_PEOPLE_REPLANS = 6; // after this, stay blocked (fail loudly via diagnostics) rather than churn grids
/** Construction replans per tick before walkers with a still-clear current segment wait their turn. */
export const REPLANS_PER_TICK = 4;
const REPLAN_MAX_WAIT = 10; // ticks a deferred walker may follow its old corridor before replanning regardless
const YIELD_OFFSET = 0.9; // m lateral offset while waiting for oncoming traffic
const LOOK = 2.5; // m look-ahead for conflicts
const MAX_CORRECTION = 0.55; // m per tick (below MAX_STEP_PER_TICK): larger corrections are spread over several ticks

export type WalkParams = { actor: string; x: number; z: number; level?: number; face?: number; speed?: number };

type Seg = PathSeg;
type Narrow = { res: string; s0: number; s1: number; entry: Vec2; dir: Vec2 };
type Exec = {
  id: string;
  actor: string;
  goal: { level: number; p: Vec2 };
  face?: number;
  speed: number;
  profile: AgentProfile;
  route: Route;
  leg: number;
  segs: Seg[];
  total: number;
  s: number;
  v: number;
  offset: number;
  narrows: Narrow[];
  held: Set<string>;
  climbT: number;
  epoch: number;
  replans: number;
  phase: string;
  side: number;
  /** The standing person the static sidestep (`side`) is for: latched until they are behind the walker. */
  sideFor?: string;
  /** The lateral offset chosen for that sidestep, and the person it was computed for. */
  sideTarget?: number;
  sideAt?: string;
  stuck: number;
  turning: boolean;
  /** What blocks this walker now, and where every blocker of this blocked stretch stood when last seen moving. */
  block?: { id: string; at: Record<string, Vec2> };
  /** Consecutive blocked ticks during which none of those blockers moved 0.1 m (DECIDE_TICKS). */
  still?: number;
  /** Ticks on which the hard separation layer (intrusion / loadIntrusion) had to cancel a step. */
  pushes: number;
  /** Navigation epoch the current smoothed segments were last verified against (geometry look-ahead runs only when stale). */
  segEpoch?: number;
  /** Standing people the current route was planned around (ignored by local encounters while they stay put). */
  plannedAround: Record<string, Vec2>;
  /** The temporary obstacles the current route was planned with (routeAround); its legs are smoothed on those grids. */
  around?: AroundPerson[];
  peopleReplans: number;
  /**
   * Head-on encounter decision, latched for the whole encounter (hysteresis): `room` = both walkers'
   * passing spots have clearance, so both keep walking at PASS_SPEED on PASS_OFFSET (side +1 = right)
   * instead of the later id stopping to give way. Cleared once that person is no longer a head-on walker ahead.
   */
  pass?: { id: string; side: 1 | -1; room: boolean };
  /** Ticks this walker has deferred a construction replan (planning budget); undefined = none pending. */
  replanWait?: number;
  /** Set by a cancel during a stair traversal: finish the flight at the nearer landing, then stop (review M2). */
  cancelTo?: 'entry' | 'exit';
  /**
   * Stepping aside for a directed task this blocked walker stands in the way of (a carry formation,
   * `makeWay` with `clearOf`): walk to `spot`, wait there until `clearOf(goal)` holds (the formation no
   * longer needs the goal), then replan to the goal.
   */
  detour?: { spot: Vec2; level: number; by: string; clearOf: (q: Vec2) => boolean; stage: 'pending' | 'going' | 'waiting' };
};

export const walkSchema = z.strictObject({
  actor: z.string().max(80),
  x: z.number().min(-500).max(500),
  z: z.number().min(-500).max(500),
  level: z.number().int().min(0).max(20).optional(),
  face: z.number().min(-7).max(7).optional(),
  speed: z.number().min(0.3).max(3).optional(),
});

const spatial = (rt: Runtime) => rt.services.spatial as Spatial;

/**
 * What a `walk_to` step reads about everyone else, read once per step (PLANNING_BUDGET.md §6):
 * - the world's entities in world order: the people scans (encounter, look-ahead, intrusion, vehicles,
 *   stairs) ran `Object.values` 4–6× per walker per tick, and `world.entities` is a V8 dictionary-mode
 *   object, where each call sorts and copies (~2 µs for 30; `entityList` ~0.5 µs);
 * - the carried-load discs (`services.loadDiscs`, rebuilt from every carried component on each call),
 *   on first use.
 * A walker's step never adds, removes or replaces an entity (it moves its own pose, read live through
 * these same objects), and never moves a load or changes a carry, so each snapshot is exactly what
 * every read in the step would return. Outside a step: fresh reads.
 */
let stepScope: { entities: Entity[]; discs?: LoadDiscView[] } | null = null;
/** Pure-performance switches (PLANNING_BUDGET.md §6). Each leaves every result bit-identical; tests turn them off to prove it. */
export const WALK_PERF = { stepSnapshot: true };
const entitiesOf = (rt: Runtime): Entity[] => stepScope?.entities ?? entityList(rt);
/** `Object.values(world.entities)`, same order (both follow OrdinaryOwnPropertyKeys), ~4× cheaper on a dictionary-mode map. */
function entityList(rt: Runtime): Entity[] {
  const ents = rt.world.entities;
  const ids = Object.keys(ents);
  const out = new Array<Entity>(ids.length);
  for (let i = 0; i < ids.length; i++) out[i] = ents[ids[i]];
  return out;
}
/** Where the current route leads: the goal, or the step-aside spot while walking to it. */
const targetOf = (ex: Exec) => (ex.detour?.stage === 'going' ? { level: ex.detour.level, p: ex.detour.spot } : ex.goal);
/** Live walk_to execs by action id (so `makeWay` can ask a blocked walker to step aside). */
const walkExecs = (rt: Runtime): Map<string, Exec> => (rt.services.walkExecs ??= new Map());
/** Traffic resources. `exclusive` (a carrier with a load on a flight): nobody else may enter, whatever their direction. */
export const traffic = (rt: Runtime): Map<string, { actors: Set<string>; entry: Vec2; dir: Vec2; exclusive?: boolean }> =>
  (rt.services.traffic ??= new Map());

function actorOf(rt: Runtime, id: string): Entity | Diagnostic {
  const e = rt.world.entities[id];
  if (!e) return { code: 'entity.unknown', message: `no actor "${id}"`, subjects: [id] };
  if (e.kind !== 'human' || !e.human) return { code: 'actor.not-human', message: `"${id}" is a ${e.kind}, not a person`, subjects: [id] };
  return e;
}

export function planWalk(rt: Runtime, actor: Entity, goal: { level: number; p: Vec2 }, profile = HUMAN_PROFILE) {
  return spatial(rt).route(rt.world, profile, { level: actor.human!.level, p: [actor.pose.p[0], actor.pose.p[2]] }, goal);
}

export const walkTo: ActionDef<WalkParams, Route, Exec> = {
  verb: 'walk_to',
  description:
    'Walk a person to (x, z) on a level (default: current level) along a planned corridor route, using completed stairs between levels. Fails with a diagnostic if no route exists.',
  schema: walkSchema,
  reservations: (_w, p) => [{ resource: `actor:${p.actor}`, mode: 'exclusive' }],
  plan(rt, p) {
    const a = actorOf(rt, p.actor);
    if ('code' in a) return { ok: false, diagnostic: a };
    if (a.human!.grip)
      return { ok: false, diagnostic: { code: 'actor.holding', message: `${p.actor} is holding ${a.human!.grip.entity} and cannot walk away until it is set down or stable`, subjects: [p.actor, a.human!.grip.entity] } };
    const r = planWalk(rt, a, { level: p.level ?? a.human!.level, p: [p.x, p.z] });
    return r.ok ? { ok: true, program: r.route } : { ok: false, diagnostic: { ...r.diagnostic, subjects: [p.actor, ...(r.diagnostic.subjects ?? [])] } };
  },
  start(rt, p, route, id) {
    const a = rt.world.entities[p.actor];
    a.human!.task = id;
    const ex: Exec = {
      id, actor: p.actor, goal: { level: p.level ?? a.human!.level, p: [p.x, p.z] }, face: p.face,
      speed: p.speed ?? HUMAN_PROFILE.speed, profile: HUMAN_PROFILE, route, leg: 0, segs: [], total: 0, s: 0, v: 0,
      offset: 0, narrows: [], held: new Set(), climbT: 0, epoch: spatial(rt).epoch, replans: 0, phase: 'walk', side: 0, stuck: 0, turning: false, plannedAround: {}, peopleReplans: 0, pushes: 0,
    };
    enterLeg(rt, ex);
    walkExecs(rt).set(id, ex);
    return ex;
  },
  step(rt, ex, dt) {
    const h = rt.world.entities[ex.actor];
    const x0 = h.pose.p[0], z0 = h.pose.p[2];
    const outer = stepScope;
    stepScope = WALK_PERF.stepSnapshot ? { entities: entityList(rt) } : null;
    let r: StepResult;
    try {
      r = stepWalk(rt, ex, dt);
    } finally {
      stepScope = outer;
    }
    if (r.status === 'completed' || r.status === 'failed') {
      walkExecs(rt).delete(ex.id);
      delete h.human!.speed;
    } else h.human!.speed = Math.round((dist2([x0, z0], [h.pose.p[0], h.pose.p[2]]) / dt) * 1000) / 1000;
    return r;
  },
  cancel(rt, ex) {
    // mid-flight on a stair: the body is between levels, so stopping here would leave it standing on
    // the flight. Defer: walk on to whichever landing is nearer along the path, then finish as cancelled.
    const leg = ex.route.legs[ex.leg];
    if (leg?.kind === 'link' && ex.phase === 'climb' && ex.climbT > 1e-9) {
      ex.cancelTo ??= ex.climbT >= linkGeometry(leg).total / 2 ? 'exit' : 'entry';
      return { ok: true, deferred: true };
    }
    releaseAll(rt, ex);
    walkExecs(rt).delete(ex.id);
    const a = rt.world.entities[ex.actor];
    a.human!.activity = 'idle';
    a.human!.task = undefined;
    delete a.human!.speed;
    return { ok: true };
  },
};

function enterLeg(rt: Runtime, ex: Exec) {
  const leg = ex.route.legs[ex.leg];
  ex.s = 0;
  // every leg starts at the body's actual position (replans start from the offset pose), so any
  // lateral passing offset of the previous corridor must not carry over (it would teleport the body)
  ex.offset = 0;
  ex.side = 0; // a new corridor: any static sidestep was for the old one
  ex.sideFor = undefined;
  ex.sideAt = undefined;
  ex.segs = [];
  ex.narrows = [];
  if (leg.kind === 'walk') {
    // smooth on the grid the route was planned on: with the people / loads it was routed around
    const sp = spatial(rt);
    const lg = (ex.around?.length ? sp.gridsAround(rt.world, ex.around).grids.levels.get(leg.level) : undefined) ?? sp.level(leg.level)!;
    const sm = smoothPolyline(lg, leg.points, { clearance: ex.profile.radius + PLAN_MARGIN, speed: ex.speed, turnRate: ex.profile.turnRate });
    ex.segs = sm.segs;
    ex.total = sm.total;
    ex.segEpoch = spatial(rt).epoch;
    ex.narrows = findNarrows(rt, ex, leg);
    ex.phase = 'walk';
    // a new corridor (replan, next leg) that leaves at an angle to where the body faces: the walker
    // cannot keep its momentum sideways or backwards; it slows at once to what the heading allows
    const a = rt.world.entities[ex.actor];
    if (ex.segs.length) ex.v = Math.min(ex.v, headingCap(angleDelta(a.pose.yaw, faceAt(ex, 0)), ex.speed));
  } else {
    ex.climbT = 0;
    ex.phase = 'align';
  }
}

/** Every point of the route's first `upTo` metres (sampled every 0.3 m on walk legs) passes `ok`. */
function routeHeadClear(route: Route, ok: (q: Vec2) => boolean, upTo: number): boolean {
  let s = 0;
  for (const leg of route.legs) {
    if (leg.kind !== 'walk') return true;
    for (let i = 1; i < leg.points.length; i++) {
      const a = leg.points[i - 1], b = leg.points[i], len = dist2(a, b);
      for (let t = 0; t <= len; t += 0.3) {
        if (!ok(add2(a, scale2(sub2(b, a), len > 0 ? t / len : 0)))) return false;
        if (s + t > upTo) return true;
      }
      s += len;
    }
  }
  return true;
}

/** Intervals of the leg that pass through single-file components. */
function findNarrows(rt: Runtime, ex: Exec, leg: WalkLeg): Narrow[] {
  const sp = spatial(rt);
  const g = sp.level(leg.level)!;
  const lab = sp.narrow(leg.level, ex.profile.radius);
  const out: Narrow[] = [];
  let cur: Narrow | null = null;
  for (let s = 0; s <= ex.total + 1e-9; s += g.cell * 0.5) {
    const p = pointAt(ex, s);
    const c = cellOf(g, p);
    const comp = c >= 0 ? lab[c] : -1;
    const res = comp >= 0 ? `narrow:${sp.epoch}:${leg.level}:${comp}` : null;
    if (res && (!cur || cur.res !== res)) {
      if (cur) out.push(cur);
      cur = { res, s0: s, s1: s, entry: p, dir: tangentAt(ex, s) };
    } else if (res && cur) cur.s1 = s;
    else if (!res && cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}

/** Index of the first segment whose end lies at or beyond s + tol (segs.length if none): binary search on s0 + len. */
function segAt(segs: Seg[], s: number, tol: number): number {
  let lo = 0, hi = segs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s + tol <= segs[mid].s0 + segs[mid].len) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
function pointAt(ex: Exec, s: number): Vec2 {
  if (!ex.segs.length) {
    const leg = ex.route.legs[ex.leg] as WalkLeg;
    return leg.points[leg.points.length - 1];
  }
  const i = segAt(ex.segs, s, 0);
  if (i >= ex.segs.length) return ex.segs[ex.segs.length - 1].b;
  const g = ex.segs[i];
  return add2(g.a, scale2(sub2(g.b, g.a), clamp((s - g.s0) / g.len, 0, 1)));
}
function tangentAt(ex: Exec, s: number): Vec2 {
  const i = segAt(ex.segs, s, 1e-9);
  const g = ex.segs[Math.min(i, ex.segs.length - 1)];
  return g ? norm2(sub2(g.b, g.a)) : [1, 0];
}
/**
 * Speed allowed now so that every upcoming vertex speed cap (fillet curvature, sharp corner) is met on
 * arrival there, braking at ACCEL: min over vertices b ahead of √(cap_b² + 2·ACCEL·d_b).
 */
function capAhead(ex: Exec): number {
  let v = Infinity;
  const horizon = (ex.speed * ex.speed) / (2 * ACCEL) + 0.5;
  for (const g of ex.segs) {
    const d = g.s0 + g.len - ex.s;
    if (d < -1e-9) continue;
    if (g.cap < Infinity) v = Math.min(v, Math.sqrt(g.cap * g.cap + 2 * ACCEL * Math.max(0, d)));
    if (d > horizon) break;
  }
  return v;
}
/** Heading the walker aims for at arc length s: along the chord to the path point FACE_LOOK ahead. */
function faceAt(ex: Exec, s: number): number {
  const p = pointAt(ex, s), q = pointAt(ex, Math.min(ex.total, s + FACE_LOOK));
  return dist2(p, q) > 1e-6 ? heading(sub2(q, p)) : heading(tangentAt(ex, s));
}
/** Speed allowed with heading error `err`: full up to HEAD_FULL, linear to 0 at TURN_IN_PLACE (turn in place beyond). */
export const headingCap = (err: number, speed: number) => speed * clamp((TURN_IN_PLACE - Math.abs(err)) / (TURN_IN_PLACE - HEAD_FULL), 0, 1);

function releaseAll(rt: Runtime, ex: Exec) {
  const t = traffic(rt);
  for (const r of ex.held) {
    const e = t.get(r);
    e?.actors.delete(ex.actor);
    if (e && !e.actors.size) t.delete(r);
  }
  ex.held.clear();
}

function tryEnter(rt: Runtime, ex: Exec, n: Narrow): string | null {
  const t = traffic(rt);
  const e = t.get(n.res);
  if (!e || !e.actors.size) {
    t.set(n.res, { actors: new Set([ex.actor]), entry: n.entry, dir: n.dir });
    ex.held.add(n.res);
    return null;
  }
  if (e.actors.has(ex.actor)) return null;
  // same-direction followers may share a single-file passage
  if (e.dir[0] * n.dir[0] + e.dir[1] * n.dir[1] > 0.5) {
    e.actors.add(ex.actor);
    ex.held.add(n.res);
    return null;
  }
  return [...e.actors][0];
}

function stepWalk(rt: Runtime, ex: Exec, dt: number): StepResult {
  const a = rt.world.entities[ex.actor];
  const sp = spatial(rt);
  // a holder never walks off, whichever path started the walk (walk_to plan, or a parent action
  // calling walkTo.start directly — review C2)
  if (a.human!.grip) {
    releaseAll(rt, ex);
    return { status: 'failed', diagnostic: { code: 'actor.holding', message: `${ex.actor} is holding ${a.human!.grip.entity} and cannot walk away until it is set down or stable`, subjects: [ex.actor, a.human!.grip.entity] } };
  }
  if (ex.cancelTo) return stepLinkCancel(rt, ex, a, ex.route.legs[ex.leg] as LinkLeg, dt);
  if (ex.detour?.stage === 'pending') {
    const r = planWalk(rt, a, { level: ex.detour.level, p: ex.detour.spot }, ex.profile);
    if (r.ok) {
      releaseAll(rt, ex);
      ex.route = r.route;
      ex.around = undefined;
      ex.leg = 0;
      ex.replans++;
      ex.stuck = 0;
      ex.v = 0;
      ex.detour.stage = 'going';
      enterLeg(rt, ex);
      return { status: 'running', phase: 'step-aside' };
    }
    ex.detour = undefined;
  }
  if (ex.detour?.stage === 'waiting') {
    // walk on once the goal and the first stretch of the way back to it are clear of the formation
    const d = ex.detour;
    const r = d.clearOf(ex.goal.p) ? planWalk(rt, a, ex.goal, ex.profile) : null;
    if (r && !r.ok) return { status: 'failed', diagnostic: { ...r.diagnostic, code: 'route.invalidated', message: `${ex.actor} cannot walk on after stepping aside: ${r.diagnostic.message}` } };
    if (!r || !routeHeadClear(r.route, d.clearOf, 4)) {
      a.human!.activity = 'wait';
      return { status: 'blocked', diagnostic: { code: 'traffic.stepped-aside', message: `${ex.actor} stepped aside for ${d.by} and waits for it to pass before walking on`, subjects: [ex.actor, d.by] } };
    }
    ex.detour = undefined;
    releaseAll(rt, ex);
    ex.route = r.route;
    ex.around = undefined;
    ex.leg = 0;
    ex.replans++;
    ex.stuck = 0;
    enterLeg(rt, ex);
    return { status: 'running', phase: 'replan' };
  }
  // topology changed (construction)? replan only if the remaining corridor is no longer valid
  sp.sync(rt.world);
  let moved = false;
  if (sp.epoch !== ex.epoch) {
    ex.epoch = sp.epoch;
    moved = true;
    if (remainingValid(rt, ex)) {
      ex.replanWait = undefined;
      ex.segEpoch = sp.epoch;
      if (ex.route.legs[ex.leg].kind === 'walk') ex.narrows = findNarrows(rt, ex, ex.route.legs[ex.leg] as WalkLeg);
    } else ex.replanWait ??= 0;
  }
  // construction replans are budgeted per tick (PLANNING_BUDGET.md): over budget, a walker whose
  // next stretch of corridor is still clear keeps following it for up to REPLAN_MAX_WAIT ticks; one
  // whose next stretch is blocked (or who has waited long enough) replans at once and still counts
  // against the budget. Deterministic: live actions step in submission order.
  if (ex.replanWait !== undefined) {
    if (takeReplan(rt, ex.replanWait >= REPLAN_MAX_WAIT || !prefixValid(rt, ex))) {
      ex.replanWait = undefined;
      releaseAll(rt, ex);
      const r = planWalk(rt, a, targetOf(ex), ex.profile);
      if (!r.ok) return { status: 'failed', diagnostic: { ...r.diagnostic, code: 'route.invalidated', message: `route invalidated by construction: ${r.diagnostic.message}` } };
      ex.route = r.route;
      ex.around = undefined;
      ex.leg = 0;
      ex.replans++;
      enterLeg(rt, ex);
    } else {
      // following the old corridor meanwhile: key its single-file passages to the new epoch
      if (moved && ex.route.legs[ex.leg].kind === 'walk') ex.narrows = findNarrows(rt, ex, ex.route.legs[ex.leg] as WalkLeg);
      ex.replanWait++;
    }
  }
  const leg = ex.route.legs[ex.leg];
  if (leg.kind === 'link') return stepLink(rt, ex, a, leg, dt);

  const g = sp.level(leg.level)!;
  const r = ex.profile.radius;
  // traffic: need the next narrow interval before entering it
  let yieldTo: string | null = null;
  for (const n of ex.narrows) {
    if (ex.s > n.s1 + r + 0.2) {
      if (ex.held.has(n.res)) {
        const e = traffic(rt).get(n.res);
        e?.actors.delete(ex.actor);
        if (e && !e.actors.size) traffic(rt).delete(n.res);
        ex.held.delete(n.res);
      }
      continue;
    }
    if (ex.s >= n.s0 - (r + 0.9)) { yieldTo = tryEnter(rt, ex, n); }
    break;
  }
  const tan = tangentAt(ex, ex.s);
  const arrived = ex.s >= ex.total - 1e-6;
  const enc: Encounter = arrived ? { kind: 'none' } : encounter(rt, ex, a, tan);
  // static sidestep, latched per standing person until they are behind us (no swinging back into
  // them while alongside, no flicker when they sit at the edge of the encounter band)
  if (arrived) { ex.side = 0; ex.sideFor = undefined; ex.sideAt = undefined; } // at the goal the body settles onto the corridor point
  else if (enc.kind === 'static') ex.sideFor = enc.id; // one side kept while passing a group (no flip-flop)
  else if (ex.side && !(ex.sideFor && alongside(rt, ex, a, tan, ex.sideFor))) { ex.side = 0; ex.sideFor = undefined; ex.sideAt = undefined; }
  // head-on with room for both: latch the decision per encounter (hysteresis); while the partner is
  // still ahead, keep passing even after the offsets have opened the lateral gap past `encounter`'s band.
  // The latch ends when the partner stops being a head-on walker (turns, stops, or is behind us).
  if (arrived) ex.pass = undefined; // at the goal the body settles onto the corridor point
  else if (ex.pass) {
    const same = enc.kind !== 'none' && enc.id === ex.pass.id;
    if (same ? enc.kind !== 'headon' : !stillPassing(rt, ex, a, tan, ex.pass.id)) ex.pass = undefined;
  }
  if (enc.kind === 'headon' && ex.pass?.id !== enc.id) {
    // keep right, unless the oncoming walker is already clearly on our right (then both pass on the
    // left: the test is symmetric, so both walkers pick the same way round)
    const o = rt.world.entities[enc.id].pose.p;
    const onRight = (o[0] - a.pose.p[0]) * tan[1] - (o[2] - a.pose.p[2]) * tan[0];
    const side = onRight > 0.1 ? -1 : 1;
    ex.pass = { id: enc.id, side, room: roomToPass(ex, g, tan, enc.along, side) };
  }
  const passing = !yieldTo && !!ex.pass?.room && ex.held.size === 0 && !holdsTraffic(rt, ex.pass.id) && (enc.kind === 'none' || enc.id === ex.pass.id);
  // lateral offset target (bounded by clearance below)
  let targetOffset = 0;
  let giveWay = false;
  if (yieldTo) targetOffset = -YIELD_OFFSET;
  else if (passing) targetOffset = -ex.pass!.side * PASS_OFFSET;
  else if (enc.kind === 'headon' || enc.kind === 'crossing') {
    const iHold = ex.held.size > 0;
    const oHolds = holdsTraffic(rt, enc.id);
    giveWay = (oHolds && !iHold) || (!iHold && !oHolds && enc.id < ex.actor);
    targetOffset = giveWay ? -YIELD_OFFSET : -PASS_OFFSET;
  } else if (enc.kind === 'static' || ex.side) {
    // where to pass standing people: the lateral offset with the most room at the encounter point
    // (grid clearance and every standing person there), recomputed when a new person is met
    if (!ex.side || (enc.kind === 'static' && enc.id !== ex.sideAt)) {
      ex.sideTarget = sidestepTarget(rt, ex, a, g, enc.kind === 'static' ? enc.along : 0);
      ex.side = ex.sideTarget >= 0 ? 1 : -1;
      ex.sideAt = enc.kind === 'static' ? enc.id : ex.sideAt;
    }
    targetOffset = ex.sideTarget ?? ex.side * STATIC_OFFSET;
  }
  ex.offset += clamp(targetOffset - ex.offset, -0.9 * dt, 0.9 * dt);
  // speed planning: curvature / sharp-corner caps of the smoothed path ahead (spline.ts), arrival
  let vmax = Math.min(ex.speed, capAhead(ex));
  vmax = Math.min(vmax, Math.sqrt(2 * ACCEL * Math.max(0, ex.total - ex.s)) + 0.05);
  if (yieldTo) {
    const narrow = ex.narrows.find((n) => ex.s <= n.s1 + r + 0.2)!;
    vmax = Math.min(vmax, Math.sqrt(2 * ACCEL * Math.max(0, narrow.s0 - (r + 1.0) - ex.s)));
  }
  let personBlock: string | null = null;
  if (passing) vmax = Math.min(vmax, PASS_SPEED);
  if (enc.kind !== 'none') {
    const tight = enc.lateral < 2 * r + 0.04;
    if (enc.kind === 'follow') {
      if (enc.along < 2 * r + 0.3) { vmax = 0; personBlock = enc.id; }
      else vmax = Math.min(vmax, 0.9);
    } else if (giveWay) {
      vmax = 0; // stand aside and let them pass
      personBlock = enc.id;
    } else if (tight && enc.along < 2 * r + 0.35 && enc.kind !== 'static') {
      vmax = 0;
      personBlock = enc.id;
    } else if (tight) vmax = Math.min(vmax, passing ? 0.5 : 0.45); // a pass slows but keeps walking
    // (a standing person close ahead is left to the look-ahead: it stops the walker exactly before
    // contact along the path it will really take, sidestep included, instead of 0.9 m short of them)
  }
  // carried loads (review C3): never step into one (loadIntrusion below): wait for it to pass
  let loadBlock: string | null = null;
  let geoBlock: string | null = null;
  let phase = 'walk';
  // heading follows the path; the heading error caps the speed (full up to 20°, none at 120°), so a
  // walker only turns in place when the path leaves at more than 120° from where it faces
  if (!arrived) {
    const hc = headingCap(angleDelta(a.pose.yaw, faceAt(ex, ex.s)), ex.speed);
    ex.turning = hc <= 0;
    if (ex.turning) phase = 'turn';
    vmax = Math.min(vmax, hc);
  } else ex.turning = false;
  // anticipation: standing people, carried loads (and stale-corridor geometry) within ~1.5 s ahead:
  // brake to stop STOP_GAP short of them instead of finding them by contact
  const hz = arrived ? null : hazardAhead(rt, ex, a, g, targetOffset);
  if (!arrived && nearDrivenVehicle(rt, ex, a)) vmax = Math.min(vmax, VEHICLE_WALK);
  if (hz) vmax = Math.min(vmax, Math.sqrt(2 * ACCEL * Math.max(0, hz.d - STOP_GAP)));
  // stopped by it already: hold, do not creep up to it, until the decision (or until it moves off)
  if (hz && ex.block?.at[hz.id]) vmax = 0;
  const prevS = ex.s, prevOffset = ex.offset;
  ex.v += clamp(vmax - ex.v, -BRAKE * dt, ACCEL * dt);
  if (ex.v < 0) ex.v = 0;
  let adv = ex.v * dt;
  let stoppedFor: Hazard | null = null;
  if (hz) {
    const room = Math.max(0, hz.d - STOP_GAP);
    // it appeared inside the comfortable stopping distance (placed / stepped in front of us: the
    // look-ahead sees everything else ≥ 1.5 s out): stop now, on this tick, rather than carry on
    // into it; otherwise never advance past the stop point
    if ((ex.v * ex.v) / (2 * ACCEL) > room + 1e-9) { adv = 0; ex.v = 0; stoppedFor = hz; }
    else if (adv > room) { adv = room; ex.v = room / dt; }
    // at its stop point, or already stopped by it (held until the decision or until it moves off)
    if (ex.v < 0.02 && (hz.d - STOP_GAP <= 0.05 || ex.block?.at[hz.id])) stoppedFor = hz;
  }
  ex.s = Math.min(ex.total, ex.s + adv);
  // facing: along the path chord ahead (anticipates curves by FACE_LOOK), at most turnRate
  if (!arrived) a.pose.yaw = turnToward(a.pose.yaw, faceAt(ex, ex.s), ex.profile.turnRate * dt);
  // position = corridor point + bounded lateral offset (never outside clearance)
  const cur: Vec2 = [a.pose.p[0], a.pose.p[2]];
  const place = (offset: number): { p: Vec2; off: number; lagging: boolean } => {
    const base = pointAt(ex, ex.s);
    const fq = pointAt(ex, Math.min(ex.total, ex.s + FACE_LOOK));
    const ahead: Vec2 = dist2(base, fq) > 1e-6 ? norm2(sub2(fq, base)) : tangentAt(ex, ex.s);
    const normal: Vec2 = rot2(ahead, -Math.PI / 2);
    let off = offset;
    let q = add2(base, scale2(normal, -off));
    for (let k = 0; k < 6 && (clearanceAt(g, q) < r || segmentClearance(g, base, q) < r); k++) {
      off *= 0.5;
      q = add2(base, scale2(normal, -off));
    }
    if (clearanceAt(g, q) < r) { q = base; off = 0; }
    // motion limit: a large correction (falling back onto the corridor when construction removed the
    // clearance at the offset spot) is spread over several ticks, never jumped (invariant motion.teleport)
    const jump = dist2(cur, q);
    const lagging = jump > MAX_CORRECTION + 1e-9;
    if (lagging) q = add2(cur, scale2(sub2(q, cur), MAX_CORRECTION / jump));
    return { p: q, off, lagging };
  };
  let pl = place(ex.offset);
  // hard separation guarantee (collision-enforcement layer, independent of the avoidance heuristics):
  // never take a step that brings this body inside another person's space or a carried load. The
  // look-ahead above normally stops the walker first. If only the sidestep would intrude, the step
  // is taken without it (the offset holds); a step cancelled outright is counted (`pushes`).
  let into = intrusion(rt, a, cur, pl.p, r) ?? loadIntrusion(rt, a, cur, pl.p, r);
  if (into && ex.offset !== prevOffset) {
    const keep = place(prevOffset);
    if (!(intrusion(rt, a, cur, keep.p, r) ?? loadIntrusion(rt, a, cur, keep.p, r))) { pl = keep; into = null; }
  }
  let p = pl.p;
  const lagging = pl.lagging;
  ex.offset = pl.off;
  if (into) {
    ex.s = prevS;
    ex.offset = prevOffset;
    ex.v = 0;
    p = cur;
    if (rt.world.entities[into]?.kind === 'human') personBlock ??= into;
    else loadBlock ??= into;
    ex.pushes++;
  }
  // stopped for a hazard (at its stop point, or at once because it appeared too close): that hazard
  // is what blocks us (named below)
  if (stoppedFor && ex.v < 0.02) {
    if (stoppedFor.kind === 'person') personBlock ??= stoppedFor.id;
    else if (stoppedFor.kind === 'load') loadBlock ??= stoppedFor.id;
    else geoBlock = stoppedFor.id;
  }
  a.pose.p = [p[0], g.y, p[1]];
  // animation signal: 'walk' only while the body actually covers ground (the renderer's Walk clip);
  // a stopped walker waits (named reason) or stands idle — it never walks on the spot
  const gs = dist2(cur, p) / dt;
  a.human!.activity = gs >= WALK_MIN ? 'walk' : yieldTo || personBlock || loadBlock || geoBlock ? 'wait' : 'idle';

  // decide within DECIDE_TICKS (0.5 s) of being stopped: a blocker that has not moved since (a
  // standing person, a parked load) is routed around (they become temporary obstacles); one that keeps
  // moving is waited for with a named reason, and routed around after STUCK_TICKS regardless
  // (one blocked stretch may alternate between two people, e.g. passing between them: it counts as one)
  const blocker = ex.v < 0.02 ? personBlock ?? loadBlock : null;
  if (blocker) {
    if (!ex.block) { ex.block = { id: blocker, at: {} }; ex.stuck = 0; ex.still = 0; }
    ex.block.id = blocker;
    ex.stuck++;
    let moved = false;
    for (const id of [...Object.keys(ex.block.at), ...(blocker in ex.block.at ? [] : [blocker])].sort()) {
      const at = blockerAt(rt, a, id);
      if (!at) continue;
      const was = ex.block.at[id];
      if (!was || dist2(at, was) >= 0.1) { ex.block.at[id] = at; if (was) moved = true; }
    }
    ex.still = moved ? 0 : (ex.still ?? 0) + 1;
  } else { ex.block = undefined; ex.stuck = 0; ex.still = 0; }
  // the first decision comes within DECIDE_TICKS; if routing around did not free the walker, each
  // further attempt waits twice as long (0.5, 1, 2, 4 … s), so a crowd that clears is waited for
  const decideAfter = DECIDE_TICKS * 2 ** Math.min(ex.peopleReplans, 5);
  if (ex.block && !arrived && ex.peopleReplans < MAX_PEOPLE_REPLANS && ((ex.still ?? 0) >= decideAfter || ex.stuck >= Math.max(STUCK_TICKS, decideAfter))) {
    ex.stuck = 0;
    ex.still = 0;
    ex.peopleReplans++;
    // a carried load in the way counts as an obstacle too: route around where it is now. In a crowd
    // (a fire ring filling up) every standing person as an obstacle can wall the walker in: then route
    // around just the people who blocked this stretch (and the loads)
    const loads = loadDiscsFor(rt, a).map((d, i) => ({ id: `${d.entity}#${i}`, p: d.p }));
    const blockers = Object.entries(ex.block.at).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).filter(([id]) => rt.world.entities[id]?.kind === 'human').map(([id, p]) => ({ id, p }));
    let others = [...standingPeople(rt, a), ...loads];
    for (const b of blockers) if (!others.some((o) => o.id === b.id)) others.push(b);
    const from = { level: a.human!.level, p: [a.pose.p[0], a.pose.p[2]] as Vec2 };
    let rr = sp.routeAround(rt.world, ex.profile, from, targetOf(ex), others);
    // (only when the failure names someone we added: a structural failure, e.g. an unfinished stair,
    // is not helped by fewer people, and a second failing search would double the cost)
    if (!rr.ok && blockers.length && (rr.diagnostic.subjects ?? []).some((id) => others.some((o) => o.id === id) && !blockers.some((b) => b.id === id))) {
      const fewer = [...blockers, ...loads];
      const r2 = sp.routeAround(rt.world, ex.profile, from, targetOf(ex), fewer);
      if (r2.ok) { rr = r2; others = fewer; }
    }
    ex.plannedAround = Object.fromEntries(others.map((o) => [o.id, o.p]));
    if (rr.ok) {
      releaseAll(rt, ex);
      ex.route = rr.route;
      ex.around = others;
      ex.leg = 0;
      ex.replans++;
      ex.block = undefined;
      enterLeg(rt, ex);
      return { status: 'running', phase: 'replan' };
    }
  }
  // the corridor ahead turned out blocked by geometry (a stale corridor while a construction replan
  // was deferred): replan on the next tick, whatever the budget
  if (geoBlock) {
    ex.replanWait = REPLAN_MAX_WAIT;
    return { status: 'blocked', diagnostic: { code: 'walk.obstacle', message: `${ex.actor} stops short of ${geoBlock} on its corridor and replans`, subjects: [ex.actor, geoBlock] } };
  }
  if (yieldTo && ex.v < 0.02)
    return { status: 'blocked', diagnostic: { code: 'traffic.yield', message: `${ex.actor} is waiting for ${yieldTo} to clear a single-file passage`, subjects: [ex.actor, yieldTo] } };
  if (loadBlock && ex.v < 0.02)
    return { status: 'blocked', diagnostic: { code: 'traffic.load', message: `${ex.actor} waits for the carried ${loadBlock} to pass`, subjects: [ex.actor, loadBlock] } };
  if (personBlock && ex.v < 0.02) {
    makeWay(rt, personBlock, pointAt(ex, ex.total));
    return { status: 'blocked', diagnostic: { code: 'traffic.person', message: `${ex.actor} is waiting for ${personBlock} to move out of the way`, subjects: [ex.actor, personBlock] } };
  }
  if (arrived) {
    if (lagging) return { status: 'running', phase: 'settle' }; // the body is still closing on the corridor point
    if (Math.abs(ex.offset) > 0.05) {
      const occ = occupant(rt, a, pointAt(ex, ex.total), ex.profile.radius);
      if (occ) {
        makeWay(rt, occ, pointAt(ex, ex.total));
        return { status: 'blocked', diagnostic: { code: 'walk.goal-occupied', message: `${ex.actor} cannot step onto its destination: ${occ} is standing there`, subjects: [ex.actor, occ] } };
      }
      return { status: 'running', phase: 'settle' };
    }
    if (ex.leg < ex.route.legs.length - 1) {
      ex.leg++;
      enterLeg(rt, ex);
      return { status: 'running', phase: ex.phase };
    }
    if (ex.detour?.stage === 'going') {
      releaseAll(rt, ex);
      ex.detour.stage = 'waiting';
      a.human!.activity = 'wait';
      return { status: 'running', phase: 'step-aside' };
    }
    if (ex.face !== undefined && Math.abs(angleDelta(a.pose.yaw, ex.face)) > 0.03) {
      a.pose.yaw = turnToward(a.pose.yaw, ex.face, ex.profile.turnRate * dt);
      return { status: 'running', phase: 'face' };
    }
    releaseAll(rt, ex);
    a.human!.activity = 'idle';
    a.human!.task = undefined;
    // snapped: how far the standable arrival point lies from the requested goal (0 = exact; review H2)
    const snapped = Math.round(dist2(pointAt(ex, ex.total), ex.goal.p) * 1000) / 1000;
    return { status: 'completed', outputs: { replans: ex.replans, length: ex.route.length, snapped, pushes: ex.pushes } };
  }
  return { status: 'running', phase };
}

/** Id of a person that moving from `from` to `to` would intrude on (closer than 2r and getting closer). */
function intrusion(rt: Runtime, me: Entity, from: Vec2, to: Vec2, r: number): string | null {
  for (const o of entitiesOf(rt)) {
    if (o.id === me.id || o.kind !== 'human' || o.human?.level !== me.human!.level) continue;
    if (Math.abs(o.pose.p[1] - me.pose.p[1]) > 1.0) continue;
    const dTo = Math.hypot(o.pose.p[0] - to[0], o.pose.p[2] - to[1]);
    if (dTo >= 2 * r - 0.02) continue;
    const dFrom = Math.hypot(o.pose.p[0] - from[0], o.pose.p[2] - from[1]);
    if (dTo < dFrom - 1e-9) return o.id;
  }
  return null;
}

/** Carried-load discs published by the carry action (`rt.services.loadDiscs`, see carry/actions.ts activeLoadDiscs). */
type LoadDiscView = { p: Vec2; r: number; entity: string; crew: string[]; level: number };
function loadDiscsFor(rt: Runtime, me: Entity): LoadDiscView[] {
  const read = () => (rt.services.loadDiscs?.() ?? []) as LoadDiscView[];
  const all = stepScope ? (stepScope.discs ??= read()) : read();
  return all.filter((d) => !d.crew.includes(me.id) && d.level === me.human!.level);
}

/** The carried load that moving from `from` to `to` would push this body into (and deeper). */
function loadIntrusion(rt: Runtime, me: Entity, from: Vec2, to: Vec2, r: number): string | null {
  for (const d of loadDiscsFor(rt, me)) {
    const dTo = dist2(to, d.p);
    if (dTo >= d.r + r - 0.02) continue;
    if (dTo < dist2(from, d.p) - 1e-9) return d.entity;
  }
  return null;
}

/** Where a blocker (person, or carried load by entity id) is now; null if it is gone. */
function blockerAt(rt: Runtime, me: Entity, id: string): Vec2 | null {
  const o = rt.world.entities[id];
  if (o?.kind === 'human') return [o.pose.p[0], o.pose.p[2]];
  const d = loadDiscsFor(rt, me).find((q) => q.entity === id);
  return d ? d.p : null;
}

/** Footprints of vehicles being driven right now (the rider's action executing, not stopped/blocked). */
function drivenVehicles(rt: Runtime, me: Entity): OBB2[] {
  const out: OBB2[] = [];
  for (const o of entitiesOf(rt)) {
    const vid = o.human?.riding, t = o.human?.task;
    if (!vid || !t || o.human!.level !== me.human!.level) continue;
    const rec = rt.records.get(t);
    const v = rt.world.entities[vid];
    if (!v || !rec || !rt.isActive(t) || rec.status === 'blocked') continue;
    out.push(entityFootprint(v).obb);
  }
  return out;
}
/** Body gap from p to an oriented rectangle (0 inside). */
function gapToObb(p: Vec2, o: OBB2): number {
  const l = rot2(sub2(p, o.c), -o.yaw);
  return len2([Math.max(Math.abs(l[0]) - o.half[0], 0), Math.max(Math.abs(l[1]) - o.half[1], 0)]);
}
/** People keep their distance from a moving truck or ride: the walker, or its path in the next LOOK_TIME, is within VEHICLE_GAP of one. */
function nearDrivenVehicle(rt: Runtime, ex: Exec, a: Entity): boolean {
  const vs = drivenVehicles(rt, a);
  if (!vs.length) return false;
  const r = ex.profile.radius;
  const horizon = Math.min(ex.total - ex.s, Math.max(1.0, ex.speed * LOOK_TIME));
  for (let dd = 0; ; dd = Math.min(horizon, dd + 0.25)) {
    const q = dd === 0 ? ([a.pose.p[0], a.pose.p[2]] as Vec2) : pointAt(ex, ex.s + dd);
    if (vs.some((o) => gapToObb(q, o) - r < VEHICLE_GAP)) return true;
    if (dd >= horizon) return false;
  }
}

type Hazard = { d: number; id: string; kind: 'person' | 'load' | 'geometry' };
const HAZARD_STEP = 0.1; // m between look-ahead samples
const NEAR_LOOK = 0.1; // m of look-ahead for a (momentarily blocked) walker: contact avoidance only

/**
 * The first thing within LOOK_TIME (≥ 1 m) ahead along the corridor that the body would touch: a
 * standing person (or a blocked walker), a carried load (intrusion thresholds, and only when getting
 * closer), or — while the corridor predates the current navigation epoch — geometry. Samples follow
 * the lateral offset as it moves toward `targetOffset`. `d` = arc length ahead of the walker.
 * Moving walkers are left to the encounter rules (follow / head-on / crossing) and the hard layer.
 */
function hazardAhead(rt: Runtime, ex: Exec, a: Entity, g: LevelGrid, targetOffset: number): Hazard | null {
  const r = ex.profile.radius;
  const horizon = Math.min(ex.total - ex.s, Math.max(1.0, ex.speed * LOOK_TIME));
  if (horizon <= 1e-6) return null;
  const me: Vec2 = [a.pose.p[0], a.pose.p[2]];
  const reach = horizon + 2 * r + 1.0;
  // `near`: only the next few centimetres matter (contact avoidance, no cancelled steps): a walker that
  // is momentarily blocked is still a walker, handled by the encounter rules (give way, pass, follow)
  const cands: { id: string; kind: 'person' | 'load'; p: Vec2; need: number; now: number; near?: boolean }[] = [];
  for (const o of entitiesOf(rt)) {
    if (o.id === a.id || o.kind !== 'human' || o.human?.level !== a.human!.level || Math.abs(o.pose.p[1] - a.pose.p[1]) > 1.0) continue;
    const q: Vec2 = [o.pose.p[0], o.pose.p[2]];
    const now = dist2(me, q);
    if (now > reach || isActiveWalker(rt, o)) continue;
    // (people the route was planned around stay candidates: the smoothed route keeps ≥ 0.58 m from
    // them so they never trigger, unless the start snapped close to one — then we stop, not push)
    const t = o.human!.task;
    const walker = !!t && rt.records.get(t)?.verb === 'walk_to' && rt.isActive(t);
    cands.push({ id: o.id, kind: 'person', p: q, need: 2 * r - 0.02, now, near: walker });
  }
  for (const d of loadDiscsFor(rt, a)) {
    const now = dist2(me, d.p);
    if (now <= reach + d.r) cands.push({ id: d.entity, kind: 'load', p: d.p, need: d.r + r - 0.02, now });
  }
  const stale = ex.segEpoch !== spatial(rt).epoch;
  if (!cands.length && !stale) return null;
  const hereClear = Math.min(r, clearanceAt(g, me));
  // the lateral offset keeps moving (0.9 m/s) however slowly the walker advances, so a slow walker
  // reaches a sample with more of its sidestep done: predict with the actual speed (floored at 0.1 m/s)
  const vref = Math.max(ex.v, 0.1);
  /** What the body would touch at arc length dd ahead (null = clear). */
  const probe = (dd: number): Hazard | null => {
    const s = ex.s + dd;
    const base = pointAt(ex, s);
    if (stale && clearanceAt(g, base) < hereClear) return { d: dd, id: nearestBlocker(g, base) ?? 'geometry', kind: 'geometry' };
    if (!cands.length) return null;
    const t = dd / vref;
    let off = ex.offset + clamp(targetOffset - ex.offset, -0.9 * t, 0.9 * t);
    const nrm = rot2(tangentAt(ex, s), -Math.PI / 2);
    let q = add2(base, scale2(nrm, -off));
    // the same clearance bound the position step applies (the offset halves where it would not fit)
    for (let h = 0; h < 6 && clearanceAt(g, q) < r; h++) {
      off *= 0.5;
      q = add2(base, scale2(nrm, -off));
    }
    for (const c of cands) {
      if (c.near && dd > NEAR_LOOK) continue;
      const dq = dist2(q, c.p);
      if (dq < c.need && dq < c.now - 1e-9) return { d: dd, id: c.id, kind: c.kind };
    }
    return null;
  };
  const n = Math.ceil(horizon / HAZARD_STEP - 1e-9);
  for (let k = 1; k <= n; k++) {
    const hit = probe(Math.min(k * HAZARD_STEP, horizon));
    if (!hit) continue;
    // refine the contact point between the last clear sample and this one (6 halvings: < 2 mm);
    // d = the last clear arc length, so stopping STOP_GAP before it never touches
    let lo = (k - 1) * HAZARD_STEP, hi = hit.d, best = hit;
    for (let i = 0; i < 6; i++) {
      const mid = (lo + hi) / 2, h = probe(mid);
      if (h) { hi = mid; best = h; } else lo = mid;
    }
    return { ...best, d: lo };
  }
  return null;
}

/** A person that moving from `from` to `to` on a flight would bring `me` within 2r of (and closer). Also used by the carry climb. */
export function stairBlocker(rt: Runtime, me: Entity, from: number[], to: number[], r: number): string | null {
  for (const o of entitiesOf(rt)) {
    if (o.id === me.id || o.kind !== 'human') continue;
    const dTo = Math.hypot(o.pose.p[0] - to[0], (o.pose.p[1] - to[1]) * 0.5, o.pose.p[2] - to[2]);
    if (dTo >= 2 * r - 0.02) continue;
    const dFrom = Math.hypot(o.pose.p[0] - from[0], (o.pose.p[1] - from[1]) * 0.5, o.pose.p[2] - from[2]);
    if (dTo < dFrom - 1e-9) return o.id;
  }
  return null;
}

/**
 * Directed tasks outrank ambient idleness (spec §17): an idle person who is in
 * the way is asked to step to the nearest free spot clear of the requester's
 * destination. People holding or carrying are never moved. A walker whose own
 * walk_to is blocked (e.g. its goal lies in a carry formation's path, so each
 * waits for the other) is moved only when the requester passes `clearOf`
 * (true where the requester no longer needs the ground): it steps aside to a spot
 * `clearOf` accepts, waits there until its goal is clear, then walks on.
 */
export function makeWay(rt: Runtime, who: string, keepClear: Vec2, clearOf?: { by: string; subjects: string[]; test: (q: Vec2) => boolean }) {
  const o = rt.world.entities[who];
  if (!o?.human || o.human.grip) return;
  let ex: Exec | undefined;
  if (o.human.task) {
    if (!clearOf) return;
    const rec = rt.records.get(o.human.task);
    ex = walkExecs(rt).get(o.human.task);
    if (!ex || rec?.verb !== 'walk_to' || rec.status !== 'blocked' || ex.detour || ex.cancelTo || ex.route.legs[ex.leg]?.kind !== 'walk') return;
    // only a mutual wait: the walker is blocked by the requester itself (its load or one of its crew)
    if (!rec.diagnostic?.subjects?.some((s) => s !== who && clearOf.subjects.includes(s))) return;
  }
  const sp = spatial(rt);
  const g = sp.level(o.human.level);
  if (!g) return;
  const from: Vec2 = [o.pose.p[0], o.pose.p[2]];
  const away = norm2(sub2(from, keepClear));
  const base = len2(away) > 0 ? away : [1, 0] as Vec2;
  let best: Vec2 | null = null, bestScore = -Infinity;
  for (let k = 0; k < 12; k++) {
    const dir = rot2(base, (k * Math.PI) / 6);
    for (const d of ex ? [1.2, 1.6, 2.2, 3.0] : [1.2, 1.6, 2.2]) {
      const q = add2(from, scale2(dir, d));
      if (dist2(q, keepClear) < 1.0) continue;
      const c = clearanceAt(g, q);
      if (c < HUMAN_PROFILE.radius + 0.1 || occupant(rt, o, q, HUMAN_PROFILE.radius + 0.2)) continue;
      if (ex && (!clearOf!.test(q) || !stepAwayClear(rt, o, from, q))) continue;
      const score = Math.min(c, 1.0) - 0.1 * d + 0.3 * (dir[0] * base[0] + dir[1] * base[1]);
      if (score > bestScore) { bestScore = score; best = q; }
    }
  }
  if (!best) return;
  if (ex) ex.detour = { spot: best, level: o.human.level, by: clearOf!.by, clearOf: clearOf!.test, stage: 'pending' };
  else rt.submit('walk_to', { actor: who, x: best[0], z: best[1] }, { id: `${who}:make-way:${rt.tick}` });
}

/** The straight way from `from` to `q` never brings `me` closer to a person or carried-load disc it is (or would be) touching. */
function stepAwayClear(rt: Runtime, me: Entity, from: Vec2, q: Vec2): boolean {
  const r = HUMAN_PROFILE.radius;
  const discs = [
    ...loadDiscsFor(rt, me).map((d) => ({ p: d.p, need: d.r + r + 0.05 })),
    ...entitiesOf(rt)
      .filter((o) => o.id !== me.id && o.kind === 'human' && o.human?.level === me.human!.level)
      .map((o) => ({ p: [o.pose.p[0], o.pose.p[2]] as Vec2, need: 2 * r + 0.05 })),
  ];
  const len = dist2(from, q);
  for (let t = 0.25; t <= len; t += 0.25) {
    const p = add2(from, scale2(sub2(q, from), t / len));
    for (const d of discs) if (dist2(p, d.p) < Math.min(d.need, dist2(from, d.p) - 1e-9)) return false;
  }
  return true;
}

function occupant(rt: Runtime, me: Entity, p: Vec2, r: number): string | null {
  for (const o of entitiesOf(rt))
    if (o.id !== me.id && o.kind === 'human' && o.human?.level === me.human!.level && Math.hypot(o.pose.p[0] - p[0], o.pose.p[2] - p[1]) < 2 * r) return o.id;
  return null;
}

const turnToward = (yaw: number, want: number, max: number) => wrapAngle(yaw + clamp(angleDelta(yaw, want), -max, max));

/**
 * The lateral offset (within ±STATIC_OFFSET, 0.1 m steps) at which to pass the standing people around
 * the corridor point `along` ahead: the one with the most room — min(grid clearance − r, distance to
 * each standing person − the separation 2r − 0.02) — reachable straight from the corridor. Ties go to
 * the smaller offset, then to the right (+). 0 if no offset beats staying on the corridor.
 */
function sidestepTarget(rt: Runtime, ex: Exec, a: Entity, g: LevelGrid, along: number): number {
  const r = ex.profile.radius;
  const s = Math.min(ex.total, ex.s + Math.max(0, along));
  const base = pointAt(ex, s);
  const n: Vec2 = rot2(tangentAt(ex, s), -Math.PI / 2);
  const people: Vec2[] = [];
  for (const o of entitiesOf(rt)) {
    if (o.id === a.id || o.kind !== 'human' || o.human?.level !== a.human!.level || isActiveWalker(rt, o)) continue;
    const q: Vec2 = [o.pose.p[0], o.pose.p[2]];
    if (dist2(q, base) < STATIC_OFFSET + 2 * r + 0.5) people.push(q);
  }
  const room = (off: number) => {
    const q = add2(base, scale2(n, -off));
    if (segmentClearance(g, base, q) < r) return -Infinity;
    let m = clearanceAt(g, q) - r;
    for (const o of people) m = Math.min(m, dist2(q, o) - (2 * r - 0.02));
    return m;
  };
  let best = 0, bestRoom = room(0);
  for (let k = 1; k <= Math.round(STATIC_OFFSET / 0.1); k++)
    for (const off of [k * 0.1, -k * 0.1]) {
      const m = room(off);
      if (m > bestRoom + 1e-9) { best = off; bestRoom = m; }
    }
  return best;
}

function standingPeople(rt: Runtime, me: Entity) {
  return entitiesOf(rt)
    .filter((o) => o.id !== me.id && o.kind === 'human' && o.human?.level === me.human!.level && !isActiveWalker(rt, o))
    .map((o) => ({ id: o.id, p: [o.pose.p[0], o.pose.p[2]] as Vec2 }));
}

/** A person whose walk is actually progressing. A blocked walker counts as standing (so others route around them). */
function isActiveWalker(rt: Runtime, o: Entity) {
  const t = o.human?.task;
  if (!t) return false;
  const rec = rt.records.get(t);
  return !!rec && rec.verb === 'walk_to' && rt.isActive(t) && rec.status !== 'blocked';
}

const holdsTraffic = (rt: Runtime, id: string) => [...traffic(rt).values()].some((t) => t.actors.has(id));

/**
 * Room for a head-on pass: my passing spot (corridor point + PASS_OFFSET to my `side`, +1 = right) and the
 * oncoming walker's (the corridor point level with them, PASS_OFFSET to the other side) both keep a body
 * radius (plus margin) of clearance, reachable straight from the corridor. In a 2.0 m corridor that holds
 * (centre clearance ≈ 0.95 m ≥ r + PASS_OFFSET); in the 1.0 m gap it does not, so the give-way applies.
 */
function roomToPass(ex: Exec, g: LevelGrid, tan: Vec2, along: number, side: number): boolean {
  const r = ex.profile.radius;
  const n: Vec2 = rot2(tan, -Math.PI / 2); // offset −PASS_OFFSET maps to base + n·PASS_OFFSET
  const ok = (base: Vec2, sgn: number) => {
    const q = add2(base, scale2(n, sgn * PASS_OFFSET));
    return clearanceAt(g, q) >= r + 0.04 && segmentClearance(g, base, q) >= r;
  };
  return ok(pointAt(ex, ex.s), side) && ok(pointAt(ex, Math.min(ex.total, ex.s + along)), -side);
}

/** A standing person we are stepping round is still level with or ahead of us, near our line. */
function alongside(rt: Runtime, ex: Exec, a: Entity, tan: Vec2, id: string): boolean {
  const o = rt.world.entities[id];
  if (!o || o.human?.level !== a.human!.level || isActiveWalker(rt, o)) return false;
  const pa = ex.plannedAround[o.id];
  if (pa && dist2(pa, [o.pose.p[0], o.pose.p[2]]) < 0.15) return false; // the route avoids them
  const d = sub2([o.pose.p[0], o.pose.p[2]], [a.pose.p[0], a.pose.p[2]]);
  const along = d[0] * tan[0] + d[1] * tan[1];
  const lateral = Math.abs(d[0] * -tan[1] + d[1] * tan[0]);
  return along > -(2 * ex.profile.radius + 0.1) && along < LOOK && lateral < 2 * ex.profile.radius + STATIC_OFFSET;
}

/** The pass partner is still an active walker ahead of us, near enough to our line to matter. */
function stillPassing(rt: Runtime, ex: Exec, a: Entity, tan: Vec2, id: string): boolean {
  const o = rt.world.entities[id];
  if (!o || o.human?.level !== a.human!.level || !isActiveWalker(rt, o)) return false;
  const d = sub2([o.pose.p[0], o.pose.p[2]], [a.pose.p[0], a.pose.p[2]]);
  const along = d[0] * tan[0] + d[1] * tan[1];
  const lateral = Math.abs(d[0] * -tan[1] + d[1] * tan[0]);
  return along > -ex.profile.radius && along < LOOK && lateral < 2 * PASS_OFFSET + 2 * ex.profile.radius;
}

type Encounter = { kind: 'none' } | { kind: 'follow' | 'headon' | 'crossing' | 'static'; id: string; along: number; lateral: number };

/** The most pressing person ahead within LOOK metres whose disc conflicts with our corridor. */
function encounter(rt: Runtime, ex: Exec, a: Entity, tan: Vec2): Encounter {
  let best: Encounter = { kind: 'none' };
  const me: Vec2 = [a.pose.p[0], a.pose.p[2]];
  for (const o of entitiesOf(rt)) {
    if (o.id === a.id || o.kind !== 'human' || o.human?.level !== a.human!.level) continue;
    const pa = ex.plannedAround[o.id];
    if (pa && Math.hypot(pa[0] - o.pose.p[0], pa[1] - o.pose.p[2]) < 0.15) continue; // route already avoids them
    const d = sub2([o.pose.p[0], o.pose.p[2]], me);
    const along = d[0] * tan[0] + d[1] * tan[1];
    if (along < 0 || along > LOOK) continue;
    const lateral = Math.abs(d[0] * -tan[1] + d[1] * tan[0]);
    if (lateral >= 2 * ex.profile.radius + 0.12) continue;
    if (best.kind !== 'none' && best.along <= along) continue;
    const walking = isActiveWalker(rt, o);
    const f = rot2([1, 0], o.pose.yaw);
    const dot = f[0] * tan[0] + f[1] * tan[1];
    const kind = !walking ? 'static' : dot > 0.3 ? 'follow' : dot < -0.3 ? 'headon' : 'crossing';
    best = { kind, id: o.id, along, lateral };
  }
  return best;
}

function stepLink(rt: Runtime, ex: Exec, a: Entity, leg: Extract<Leg, { kind: 'link' }>, dt: number): StepResult {
  const link = leg.link;
  if (!link.usable) return { status: 'failed', diagnostic: { code: 'route.link-unusable', message: `${link.kind} ${link.id} became unusable: ${link.reason ?? ''}`, subjects: [ex.actor, link.id] } };
  const face = leg.ascending ? link.heading : wrapAngle(link.heading + Math.PI);
  if (ex.phase === 'align') {
    const e = angleDelta(a.pose.yaw, face);
    if (Math.abs(e) > 0.05) {
      a.pose.yaw = wrapAngle(a.pose.yaw + clamp(e, -ex.profile.turnRate * dt, ex.profile.turnRate * dt));
      a.human!.activity = 'idle';
      return { status: 'running', phase: 'align' };
    }
    ex.phase = 'climb';
    // occupy the stair as a single-file resource
    const res = `link:${link.id}`;
    const t = traffic(rt).get(res);
    if (t && t.actors.size && !t.actors.has(ex.actor) && (t.exclusive || dist2(t.entry, leg.ascending ? link.from.p : link.to.p) > 0.5)) {
      ex.phase = 'align';
      return { status: 'blocked', diagnostic: { code: 'traffic.yield', message: `${ex.actor} waits for ${[...t.actors][0]} to finish using ${link.id}`, subjects: [ex.actor, link.id] } };
    }
    if (!t) traffic(rt).set(res, { actors: new Set([ex.actor]), entry: leg.ascending ? link.from.p : link.to.p, dir: rot2([1, 0], face) });
    else t.actors.add(ex.actor);
    ex.held.add(res);
  }
  const geo = linkGeometry(leg);
  const total = geo.total;
  ex.climbT = Math.min(total, ex.climbT + CLIMB_SPEED * dt);
  const next = pointOnLink(geo, ex.climbT);
  // someone standing on / at the end of the stair: wait rather than pass through them
  const blocker = stairBlocker(rt, a, a.pose.p, next, ex.profile.radius);
  if (blocker) {
    ex.climbT = Math.max(0, ex.climbT - CLIMB_SPEED * dt);
    a.human!.activity = 'climb-wait'; // still on the stair: stair geometry, not the floor grid, applies
    return { status: 'blocked', diagnostic: { code: 'traffic.person', message: `${ex.actor} waits on ${link.id} for ${blocker} to move`, subjects: [ex.actor, blocker, link.id] } };
  }
  a.pose.p = next;
  a.pose.yaw = face;
  a.human!.activity = leg.ascending ? 'climb-up' : 'climb-down';
  if (ex.climbT >= total - 1e-9) {
    const exit = leg.ascending ? link.to : link.from;
    a.pose.p = [exit.p[0], exit.y, exit.p[1]];
    a.human!.level = exit.level;
    const res = `link:${link.id}`;
    const e = traffic(rt).get(res);
    e?.actors.delete(ex.actor);
    if (e && !e.actors.size) traffic(rt).delete(res);
    ex.held.delete(res);
    ex.leg++;
    enterLeg(rt, ex);
    return { status: 'running', phase: ex.phase };
  }
  return { status: 'running', phase: 'climb' };
}

type LinkGeometry = { entry: LinkLeg['link']['from']; exit: LinkLeg['link']['from']; path: [number, number, number][]; lens: number[]; total: number };

/** Continuous traversal path of a link leg: from the standing entry point, along the steps, to the exit point (no end snaps). */
function linkGeometry(leg: LinkLeg): LinkGeometry {
  const link = leg.link;
  const entry = leg.ascending ? link.from : link.to, exit = leg.ascending ? link.to : link.from;
  const steps = leg.ascending ? link.path : [...link.path].reverse();
  const path: [number, number, number][] = [[entry.p[0], entry.y, entry.p[1]], ...steps, [exit.p[0], exit.y, exit.p[1]]];
  const lens = path.slice(1).map((q, i) => Math.hypot(q[0] - path[i][0], q[1] - path[i][1], q[2] - path[i][2]));
  return { entry, exit, path, lens, total: lens.reduce((s, x) => s + x, 0) };
}

function pointOnLink(g: LinkGeometry, at: number): [number, number, number] {
  let d = at, i = 0;
  while (i < g.lens.length - 1 && d > g.lens[i]) { d -= g.lens[i]; i++; }
  const t = g.lens[i] ? clamp(d / g.lens[i], 0, 1) : 1;
  const P = g.path[i], Q = g.path[i + 1] ?? g.path[i];
  return [P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t, P[2] + (Q[2] - P[2]) * t];
}

/**
 * Deferred cancel on a stair (review M2): continue (or back down) the flight at climbing speed to the
 * nearer landing, keep facing the stair, then stand there on that landing's level and complete (the
 * runtime records the action as `cancelled`). Waits, rather than passes through, anyone in the way.
 */
function stepLinkCancel(rt: Runtime, ex: Exec, a: Entity, leg: LinkLeg, dt: number): StepResult {
  const geo = linkGeometry(leg);
  const forward = ex.cancelTo === 'exit';
  const at = forward ? Math.min(geo.total, ex.climbT + CLIMB_SPEED * dt) : Math.max(0, ex.climbT - CLIMB_SPEED * dt);
  const next = pointOnLink(geo, at);
  const blocker = stairBlocker(rt, a, a.pose.p, next, ex.profile.radius);
  if (blocker) {
    a.human!.activity = 'climb-wait';
    return { status: 'blocked', diagnostic: { code: 'traffic.person', message: `${ex.actor} (cancelled) waits on ${leg.link.id} for ${blocker} to move before stepping off at the ${forward ? 'far' : 'near'} landing`, subjects: [ex.actor, blocker, leg.link.id] } };
  }
  ex.climbT = at;
  a.pose.p = next;
  a.human!.activity = leg.ascending === forward ? 'climb-up' : 'climb-down';
  if (forward ? at < geo.total - 1e-9 : at > 1e-9) return { status: 'running', phase: 'cancel-climb' };
  const end = forward ? geo.exit : geo.entry;
  a.pose.p = [end.p[0], end.y, end.p[1]];
  a.human!.level = end.level;
  releaseAll(rt, ex);
  a.human!.activity = 'idle';
  a.human!.task = undefined;
  return { status: 'completed', outputs: { cancelled: true, stoppedAt: forward ? 'exit' : 'entry', level: end.level, x: end.p[0], z: end.p[1], link: leg.link.id } };
}

/** Per-tick construction-replan budget (`services.planning.replansPerTick` overrides REPLANS_PER_TICK);
 *  `services.replanBudget` also keeps totals (replans, deferred walker-ticks, peak replans in one tick). */
export type ReplanBudget = { tick: number; used: number; peak: number; deferred: number; replans: number };
function takeReplan(rt: Runtime, forced: boolean): boolean {
  const b = (rt.services.replanBudget ??= { tick: -1, used: 0, peak: 0, deferred: 0, replans: 0 }) as ReplanBudget;
  if (b.tick !== rt.tick) { b.tick = rt.tick; b.used = 0; }
  const max = (rt.services.planning as { replansPerTick?: number } | undefined)?.replansPerTick ?? REPLANS_PER_TICK;
  if (!forced && b.used >= max) {
    b.deferred++;
    return false;
  }
  b.used++;
  b.replans++;
  if (b.used > b.peak) b.peak = b.used;
  return true;
}

/** Whether the walker can keep following its old corridor while it waits: the next stretch it could
 *  cover in REPLAN_MAX_WAIT ticks (+0.5 m) is clear, or its current link is still usable. */
function prefixValid(rt: Runtime, ex: Exec): boolean {
  const sp = spatial(rt);
  const leg = ex.route.legs[ex.leg];
  if (leg.kind === 'link') return sp.scene.links.some((l) => l.id === leg.link.id && l.usable);
  const g = sp.level(leg.level);
  if (!g) return false;
  const end = Math.min(ex.total, ex.s + ex.speed * REPLAN_MAX_WAIT * DT + 0.5);
  const pts = [pointAt(ex, ex.s), ...ex.segs.filter((q) => q.s0 > ex.s && q.s0 < end).map((q) => q.a), pointAt(ex, end)];
  for (let i = 1; i < pts.length; i++) if (segmentClearance(g, pts[i - 1], pts[i]) < ex.profile.radius) return false;
  return true;
}

function remainingValid(rt: Runtime, ex: Exec): boolean {
  const sp = spatial(rt);
  for (let k = ex.leg; k < ex.route.legs.length; k++) {
    const leg = ex.route.legs[k];
    if (leg.kind === 'link') {
      if (!sp.scene.links.some((l) => l.id === leg.link.id && l.usable)) return false;
      continue;
    }
    const g = sp.level(leg.level);
    if (!g) return false;
    // the current leg: what the walker actually follows (the smoothed segments ahead of it)
    const pts = k === ex.leg ? [pointAt(ex, ex.s), ...ex.segs.filter((q) => q.s0 + q.len > ex.s).map((q) => q.b)] : leg.points;
    for (let i = 1; i < pts.length; i++) if (segmentClearance(g, pts[i - 1], pts[i]) < ex.profile.radius) return false;
  }
  return true;
}
