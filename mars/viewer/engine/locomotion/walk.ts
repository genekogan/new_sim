// walk_to: global route (spatial/path.ts) → corridor following → contextual
// stair traversal. Layers are separate as in Unity/Detour practice:
//   planning  : route legs with guaranteed clearance (replanned only on topology change)
//   steering  : arc-length progress along the corridor, speed ramps, turn-in-place,
//               lateral right-hand passing offset bounded by local clearance
//   traffic   : single-file passages are exclusive resources per direction (yield, never oscillate)
//   animation : consumers read pose + human.activity; they never write positions
import { z } from 'zod';
import { add2, angleDelta, clamp, dist2, heading, len2, norm2, rot2, scale2, sub2, wrapAngle, type Vec2 } from '../core/math.ts';
import type { ActionDef, Diagnostic, StepResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity } from '../world/types.ts';
import type { Spatial } from '../spatial/service.ts';
import { cellOf, clearanceAt, segmentClearance, type LevelGrid } from '../spatial/grid.ts';
import type { Leg, Route, WalkLeg } from '../spatial/path.ts';
import { HUMAN_PROFILE, type AgentProfile } from '../spatial/types.ts';

const ACCEL = 1.2; // m/s²
const CLIMB_SPEED = 0.45; // m/s along the stair path
const TURN_IN_PLACE = 1.0; // rad heading error above which the walker stops and turns
const TURN_DONE = 0.25; // rad: turn-in-place ends once this aligned
const PASS_OFFSET = 0.45; // m lateral offset when passing another walker
const STATIC_OFFSET = 0.8; // m sidestep around a standing person
const STUCK_TICKS = 80; // 4 s blocked by a moving person → replan around standing people
const STUCK_STATIC_TICKS = 30; // 1.5 s blocked by someone standing still → replan around them
const MAX_PEOPLE_REPLANS = 6; // after this, stay blocked (fail loudly via diagnostics) rather than churn grids
const YIELD_OFFSET = 0.9; // m lateral offset while waiting for oncoming traffic
const LOOK = 2.5; // m look-ahead for conflicts

export type WalkParams = { actor: string; x: number; z: number; level?: number; face?: number; speed?: number };

type Seg = { a: Vec2; b: Vec2; s0: number; len: number };
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
  stuck: number;
  turning: boolean;
  /** Standing people the current route was planned around (ignored by local encounters while they stay put). */
  plannedAround: Record<string, Vec2>;
  peopleReplans: number;
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
export const traffic = (rt: Runtime): Map<string, { actors: Set<string>; entry: Vec2; dir: Vec2 }> =>
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
      offset: 0, narrows: [], held: new Set(), climbT: 0, epoch: spatial(rt).epoch, replans: 0, phase: 'walk', side: 0, stuck: 0, turning: false, plannedAround: {}, peopleReplans: 0,
    };
    enterLeg(rt, ex);
    return ex;
  },
  step: stepWalk,
  cancel(rt, ex) {
    releaseAll(rt, ex);
    const a = rt.world.entities[ex.actor];
    a.human!.activity = 'idle';
    a.human!.task = undefined;
    return { ok: true };
  },
};

function enterLeg(rt: Runtime, ex: Exec) {
  const leg = ex.route.legs[ex.leg];
  ex.s = 0;
  ex.segs = [];
  ex.narrows = [];
  if (leg.kind === 'walk') {
    let s0 = 0;
    for (let i = 1; i < leg.points.length; i++) {
      const len = dist2(leg.points[i - 1], leg.points[i]);
      if (len < 1e-9) continue;
      ex.segs.push({ a: leg.points[i - 1], b: leg.points[i], s0, len });
      s0 += len;
    }
    ex.total = s0;
    ex.narrows = findNarrows(rt, ex, leg);
    ex.phase = 'walk';
  } else {
    ex.climbT = 0;
    ex.phase = 'align';
  }
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

function pointAt(ex: Exec, s: number): Vec2 {
  if (!ex.segs.length) {
    const leg = ex.route.legs[ex.leg] as WalkLeg;
    return leg.points[leg.points.length - 1];
  }
  for (const g of ex.segs) if (s <= g.s0 + g.len) return add2(g.a, scale2(sub2(g.b, g.a), clamp((s - g.s0) / g.len, 0, 1)));
  return ex.segs[ex.segs.length - 1].b;
}
function tangentAt(ex: Exec, s: number): Vec2 {
  for (const g of ex.segs) if (s < g.s0 + g.len - 1e-9) return norm2(sub2(g.b, g.a));
  const last = ex.segs[ex.segs.length - 1];
  return last ? norm2(sub2(last.b, last.a)) : [1, 0];
}
/** Distance to the next corner and the turn angle there. */
function nextCorner(ex: Exec): { d: number; angle: number } {
  for (let i = 0; i < ex.segs.length; i++) {
    const g = ex.segs[i];
    if (ex.s < g.s0 + g.len - 1e-9) {
      const n = ex.segs[i + 1];
      if (!n) return { d: g.s0 + g.len - ex.s, angle: Math.PI };
      return { d: g.s0 + g.len - ex.s, angle: Math.abs(angleDelta(heading(sub2(g.b, g.a)), heading(sub2(n.b, n.a)))) };
    }
  }
  return { d: 0, angle: Math.PI };
}

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
  // topology changed (construction)? replan only if the remaining corridor is no longer valid
  sp.sync(rt.world);
  if (sp.epoch !== ex.epoch) {
    ex.epoch = sp.epoch;
    if (!remainingValid(rt, ex)) {
      releaseAll(rt, ex);
      const r = planWalk(rt, a, ex.goal, ex.profile);
      if (!r.ok) return { status: 'failed', diagnostic: { ...r.diagnostic, code: 'route.invalidated', message: `route invalidated by construction: ${r.diagnostic.message}` } };
      ex.route = r.route;
      ex.leg = 0;
      ex.replans++;
      enterLeg(rt, ex);
    } else if (ex.route.legs[ex.leg].kind === 'walk') ex.narrows = findNarrows(rt, ex, ex.route.legs[ex.leg] as WalkLeg);
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
  const err = angleDelta(a.pose.yaw, heading(tan));
  const arrived = ex.s >= ex.total - 1e-6;
  const enc: Encounter = arrived ? { kind: 'none' } : encounter(rt, ex, a, tan);
  if (enc.kind !== 'static') ex.side = 0;
  // lateral offset target (bounded by clearance below)
  let targetOffset = 0;
  let giveWay = false;
  if (yieldTo) targetOffset = -YIELD_OFFSET;
  else if (enc.kind === 'headon' || enc.kind === 'crossing') {
    const iHold = ex.held.size > 0;
    const oHolds = [...traffic(rt).values()].some((t) => t.actors.has(enc.id));
    giveWay = (oHolds && !iHold) || (!iHold && !oHolds && enc.id < ex.actor);
    targetOffset = giveWay ? -YIELD_OFFSET : -PASS_OFFSET;
  } else if (enc.kind === 'static') {
    if (!ex.side) ex.side = sideWithRoom(g, pointAt(ex, ex.s), tan, r);
    targetOffset = ex.side * STATIC_OFFSET;
  }
  ex.offset += clamp(targetOffset - ex.offset, -0.9 * dt, 0.9 * dt);
  // speed planning
  let vmax = ex.speed;
  const c = nextCorner(ex);
  const cornerV = c.angle > 2.5 ? 0 : Math.max(0.35, ex.speed * (1 - c.angle / Math.PI));
  vmax = Math.min(vmax, Math.sqrt(cornerV * cornerV + 2 * ACCEL * c.d));
  vmax = Math.min(vmax, Math.sqrt(2 * ACCEL * Math.max(0, ex.total - ex.s)) + 0.05);
  if (yieldTo) {
    const narrow = ex.narrows.find((n) => ex.s <= n.s1 + r + 0.2)!;
    vmax = Math.min(vmax, Math.sqrt(2 * ACCEL * Math.max(0, narrow.s0 - (r + 1.0) - ex.s)));
  }
  let personBlock: string | null = null;
  if (enc.kind !== 'none') {
    const tight = enc.lateral < 2 * r + 0.04;
    if (enc.kind === 'follow') {
      if (enc.along < 2 * r + 0.3) { vmax = 0; personBlock = enc.id; }
      else vmax = Math.min(vmax, 0.9);
    } else if (giveWay) {
      vmax = 0; // stand aside and let them pass
      personBlock = enc.id;
    } else if (tight && enc.along < 2 * r + 0.35) {
      vmax = 0;
      personBlock = enc.id;
    } else if (tight) vmax = Math.min(vmax, 0.45);
  }
  let phase = 'walk';
  // hysteresis: start turning in place above TURN_IN_PLACE, stop only once nearly aligned
  if (!arrived && !ex.turning && Math.abs(err) > TURN_IN_PLACE && ex.v < 0.3) ex.turning = true;
  if (ex.turning && (arrived || Math.abs(err) < TURN_DONE)) ex.turning = false;
  if (ex.turning) {
    vmax = 0;
    phase = 'turn';
  }
  const prevS = ex.s, prevOffset = ex.offset;
  ex.v += clamp(vmax - ex.v, -ACCEL * 2 * dt, ACCEL * dt);
  if (ex.v < 0) ex.v = 0;
  ex.s = Math.min(ex.total, ex.s + ex.v * dt);
  // facing: look slightly ahead so corners are anticipated; arrival facing handled below
  const ahead = tangentAt(ex, Math.min(ex.total, ex.s + 0.35));
  if (!arrived) {
    // turning in place aims at the current segment (the same reference as the error), walking looks ahead
    const faceWant = phase === 'turn' ? heading(tan) : ex.v > 0.05 ? heading(ahead) : a.pose.yaw;
    a.pose.yaw = turnToward(a.pose.yaw, faceWant, ex.profile.turnRate * dt);
  }
  // position = corridor point + bounded lateral offset (never outside clearance)
  const base = pointAt(ex, ex.s);
  const normal: Vec2 = rot2(ahead, -Math.PI / 2);
  let off = ex.offset;
  let p = add2(base, scale2(normal, -off));
  for (let k = 0; k < 6 && (clearanceAt(g, p) < r || segmentClearance(g, base, p) < r); k++) {
    off *= 0.5;
    p = add2(base, scale2(normal, -off));
  }
  if (clearanceAt(g, p) < r) { p = base; off = 0; }
  ex.offset = off;
  // hard separation guarantee (collision-enforcement layer, independent of the avoidance heuristics):
  // never take a step that brings this body inside another person's space
  const cur: Vec2 = [a.pose.p[0], a.pose.p[2]];
  const intruded = intrusion(rt, a, cur, p, r);
  if (intruded) {
    ex.s = prevS;
    ex.offset = prevOffset;
    ex.v = 0;
    p = cur;
    personBlock ??= intruded;
  }
  a.pose.p = [p[0], g.y, p[1]];
  a.human!.activity = ex.v > 0.05 ? 'walk' : yieldTo || personBlock ? 'wait' : 'idle';

  // stuck behind a person for too long → replan around them (they become temporary obstacles)
  ex.stuck = ex.v < 0.02 && personBlock ? ex.stuck + 1 : 0;
  if (ex.stuck > (enc.kind === 'static' ? STUCK_STATIC_TICKS : STUCK_TICKS) && !arrived && ex.peopleReplans < MAX_PEOPLE_REPLANS) {
    ex.stuck = 0;
    ex.peopleReplans++;
    const others = standingPeople(rt, a);
    ex.plannedAround = Object.fromEntries(others.map((o) => [o.id, o.p]));
    const rr = sp.routeAround(rt.world, ex.profile, { level: a.human!.level, p: [a.pose.p[0], a.pose.p[2]] }, ex.goal, others);
    if (rr.ok) {
      releaseAll(rt, ex);
      ex.route = rr.route;
      ex.leg = 0;
      ex.replans++;
      enterLeg(rt, ex);
      return { status: 'running', phase: 'replan' };
    }
  }
  if (yieldTo && ex.v < 0.02)
    return { status: 'blocked', diagnostic: { code: 'traffic.yield', message: `${ex.actor} is waiting for ${yieldTo} to clear a single-file passage`, subjects: [ex.actor, yieldTo] } };
  if (personBlock && ex.v < 0.02) {
    makeWay(rt, personBlock, pointAt(ex, ex.total));
    return { status: 'blocked', diagnostic: { code: 'traffic.person', message: `${ex.actor} is waiting for ${personBlock} to move out of the way`, subjects: [ex.actor, personBlock] } };
  }
  if (arrived) {
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
    if (ex.face !== undefined && Math.abs(angleDelta(a.pose.yaw, ex.face)) > 0.03) {
      a.pose.yaw = turnToward(a.pose.yaw, ex.face, ex.profile.turnRate * dt);
      return { status: 'running', phase: 'face' };
    }
    releaseAll(rt, ex);
    a.human!.activity = 'idle';
    a.human!.task = undefined;
    return { status: 'completed', outputs: { replans: ex.replans, length: ex.route.length } };
  }
  return { status: 'running', phase };
}

/** Id of a person that moving from `from` to `to` would intrude on (closer than 2r and getting closer). */
function intrusion(rt: Runtime, me: Entity, from: Vec2, to: Vec2, r: number): string | null {
  for (const o of Object.values(rt.world.entities)) {
    if (o.id === me.id || o.kind !== 'human' || o.human?.level !== me.human!.level) continue;
    if (Math.abs(o.pose.p[1] - me.pose.p[1]) > 1.0) continue;
    const dTo = Math.hypot(o.pose.p[0] - to[0], o.pose.p[2] - to[1]);
    if (dTo >= 2 * r - 0.02) continue;
    const dFrom = Math.hypot(o.pose.p[0] - from[0], o.pose.p[2] - from[1]);
    if (dTo < dFrom - 1e-9) return o.id;
  }
  return null;
}

function stairBlocker(rt: Runtime, me: Entity, from: number[], to: number[], r: number): string | null {
  for (const o of Object.values(rt.world.entities)) {
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
 * destination. People with a task (holding, carrying, walking) are never moved.
 */
export function makeWay(rt: Runtime, who: string, keepClear: Vec2) {
  const o = rt.world.entities[who];
  if (!o?.human || o.human.task || o.human.grip) return;
  const sp = spatial(rt);
  const g = sp.level(o.human.level);
  if (!g) return;
  const from: Vec2 = [o.pose.p[0], o.pose.p[2]];
  const away = norm2(sub2(from, keepClear));
  const base = len2(away) > 0 ? away : [1, 0] as Vec2;
  let best: Vec2 | null = null, bestScore = -Infinity;
  for (let k = 0; k < 12; k++) {
    const dir = rot2(base, (k * Math.PI) / 6);
    for (const d of [1.2, 1.6, 2.2]) {
      const q = add2(from, scale2(dir, d));
      if (dist2(q, keepClear) < 1.0) continue;
      const c = clearanceAt(g, q);
      if (c < HUMAN_PROFILE.radius + 0.1 || occupant(rt, o, q, HUMAN_PROFILE.radius + 0.2)) continue;
      const score = Math.min(c, 1.0) - 0.1 * d + 0.3 * (dir[0] * base[0] + dir[1] * base[1]);
      if (score > bestScore) { bestScore = score; best = q; }
    }
  }
  if (best) rt.submit('walk_to', { actor: who, x: best[0], z: best[1] }, { id: `${who}:make-way:${rt.tick}` });
}

function occupant(rt: Runtime, me: Entity, p: Vec2, r: number): string | null {
  for (const o of Object.values(rt.world.entities))
    if (o.id !== me.id && o.kind === 'human' && o.human?.level === me.human!.level && Math.hypot(o.pose.p[0] - p[0], o.pose.p[2] - p[1]) < 2 * r) return o.id;
  return null;
}

const turnToward = (yaw: number, want: number, max: number) => wrapAngle(yaw + clamp(angleDelta(yaw, want), -max, max));

/** Choose the side (±1 in offset units) with more room to step around a standing person. */
function sideWithRoom(g: LevelGrid, base: Vec2, tan: Vec2, r: number): number {
  const n: Vec2 = rot2(tan, -Math.PI / 2);
  const room = (sgn: number) => clearanceAt(g, add2(base, scale2(n, sgn * STATIC_OFFSET)));
  // offset o maps to base + n * (-o): side +1 ⇒ point at −n
  return room(-1) >= room(1) && room(-1) >= r ? 1 : -1;
}

function standingPeople(rt: Runtime, me: Entity) {
  return Object.values(rt.world.entities)
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

type Encounter = { kind: 'none' } | { kind: 'follow' | 'headon' | 'crossing' | 'static'; id: string; along: number; lateral: number };

/** The most pressing person ahead within LOOK metres whose disc conflicts with our corridor. */
function encounter(rt: Runtime, ex: Exec, a: Entity, tan: Vec2): Encounter {
  let best: Encounter = { kind: 'none' };
  const me: Vec2 = [a.pose.p[0], a.pose.p[2]];
  for (const o of Object.values(rt.world.entities)) {
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
    if (t && t.actors.size && !t.actors.has(ex.actor) && dist2(t.entry, leg.ascending ? link.from.p : link.to.p) > 0.5) {
      ex.phase = 'align';
      return { status: 'blocked', diagnostic: { code: 'traffic.yield', message: `${ex.actor} waits for ${[...t.actors][0]} to finish using ${link.id}`, subjects: [ex.actor, link.id] } };
    }
    if (!t) traffic(rt).set(res, { actors: new Set([ex.actor]), entry: leg.ascending ? link.from.p : link.to.p, dir: rot2([1, 0], face) });
    else t.actors.add(ex.actor);
    ex.held.add(res);
  }
  // continuous traversal: from the standing entry point, along the steps, to the exit point (no end snaps)
  const entry = leg.ascending ? link.from : link.to, exit0 = leg.ascending ? link.to : link.from;
  const steps = leg.ascending ? link.path : [...link.path].reverse();
  const path: [number, number, number][] = [[entry.p[0], entry.y, entry.p[1]], ...steps, [exit0.p[0], exit0.y, exit0.p[1]]];
  const lens = path.slice(1).map((q, i) => Math.hypot(q[0] - path[i][0], q[1] - path[i][1], q[2] - path[i][2]));
  const total = lens.reduce((s, x) => s + x, 0);
  ex.climbT = Math.min(total, ex.climbT + CLIMB_SPEED * dt);
  let d = ex.climbT, i = 0;
  while (i < lens.length - 1 && d > lens[i]) { d -= lens[i]; i++; }
  const t = lens[i] ? clamp(d / lens[i], 0, 1) : 1;
  const P = path[i], Q = path[i + 1] ?? path[i];
  const next: [number, number, number] = [P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t, P[2] + (Q[2] - P[2]) * t];
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
    const pts = k === ex.leg ? [pointAt(ex, ex.s), ...leg.points.filter((_, i) => i > 0 && ex.segs[i - 1] && ex.segs[i - 1].s0 + ex.segs[i - 1].len > ex.s)] : leg.points;
    for (let i = 1; i < pts.length; i++) if (segmentClearance(g, pts[i - 1], pts[i]) < ex.profile.radius) return false;
  }
  return true;
}
