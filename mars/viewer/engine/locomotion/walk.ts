// walk_to: global route (spatial/path.ts) → corridor following → contextual
// stair traversal. Layers are separate as in Unity/Detour practice:
//   planning  : route legs with guaranteed clearance (replanned only on topology change)
//   steering  : arc-length progress along the corridor, speed ramps, turn-in-place,
//               lateral right-hand passing offset bounded by local clearance
//   traffic   : single-file passages are exclusive resources per direction (yield, never oscillate)
//   animation : consumers read pose + human.activity; they never write positions
import { z } from 'zod';
import { add2, angleDelta, clamp, dist2, heading, norm2, rot2, scale2, sub2, wrapAngle, type Vec2 } from '../core/math.ts';
import type { ActionDef, Diagnostic, StepResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity } from '../world/types.ts';
import type { Spatial } from '../spatial/service.ts';
import { cellOf, clearanceAt, segmentClearance } from '../spatial/grid.ts';
import type { Leg, Route, WalkLeg } from '../spatial/path.ts';
import { HUMAN_PROFILE, type AgentProfile } from '../spatial/types.ts';

const ACCEL = 1.2; // m/s²
const CLIMB_SPEED = 0.45; // m/s along the stair path
const TURN_IN_PLACE = 1.0; // rad heading error above which the walker stops and turns
const PASS_OFFSET = 0.45; // m lateral offset when passing another walker
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
    const r = planWalk(rt, a, { level: p.level ?? a.human!.level, p: [p.x, p.z] });
    return r.ok ? { ok: true, program: r.route } : { ok: false, diagnostic: { ...r.diagnostic, subjects: [p.actor, ...(r.diagnostic.subjects ?? [])] } };
  },
  start(rt, p, route, id) {
    const a = rt.world.entities[p.actor];
    a.human!.task = id;
    const ex: Exec = {
      id, actor: p.actor, goal: { level: p.level ?? a.human!.level, p: [p.x, p.z] }, face: p.face,
      speed: p.speed ?? HUMAN_PROFILE.speed, profile: HUMAN_PROFILE, route, leg: 0, segs: [], total: 0, s: 0, v: 0,
      offset: 0, narrows: [], held: new Set(), climbT: 0, epoch: spatial(rt).epoch, replans: 0, phase: 'walk',
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
  const want = heading(tan);
  const err = angleDelta(a.pose.yaw, want);
  // conflict ahead with another walker? → right-hand passing offset
  const others = conflicts(rt, ex, a, tan);
  let targetOffset = 0;
  if (yieldTo) targetOffset = -YIELD_OFFSET;
  else if (others.length) targetOffset = -PASS_OFFSET; // consistent side relative to travel direction
  ex.offset += clamp(targetOffset - ex.offset, -0.8 * dt, 0.8 * dt);
  // speed planning
  let vmax = ex.speed;
  const c = nextCorner(ex);
  const cornerV = c.angle > 2.5 ? 0 : Math.max(0.35, ex.speed * (1 - c.angle / Math.PI));
  vmax = Math.min(vmax, Math.sqrt(cornerV * cornerV + 2 * ACCEL * c.d));
  vmax = Math.min(vmax, Math.sqrt(2 * ACCEL * Math.max(0, ex.total - ex.s)) + 0.05);
  const blocked = others.find((o) => o.close);
  if (yieldTo) {
    const narrow = ex.narrows.find((n) => ex.s <= n.s1 + r + 0.2)!;
    const stopAt = narrow.s0 - (r + 1.0);
    vmax = Math.min(vmax, Math.sqrt(2 * ACCEL * Math.max(0, stopAt - ex.s)));
  }
  // right of way: whoever holds a single-file passage, else the other if it is not moving, else lower id
  if (blocked) {
    const o = rt.world.entities[blocked.id];
    const oHolds = [...traffic(rt).values()].some((t) => t.actors.has(blocked.id));
    const iHold = ex.held.size > 0;
    const oMoving = o.human?.activity === 'walk';
    const giveWay = (oHolds && !iHold) || (!iHold && !oMoving) || (!iHold && !oHolds && blocked.id < ex.actor);
    vmax = giveWay ? 0 : Math.min(vmax, 0.25);
  }
  let phase = 'walk';
  if (Math.abs(err) > TURN_IN_PLACE && ex.v < 0.3) {
    vmax = 0;
    phase = 'turn';
  }
  ex.v += clamp(vmax - ex.v, -ACCEL * 2 * dt, ACCEL * dt);
  if (ex.v < 0) ex.v = 0;
  ex.s = Math.min(ex.total, ex.s + ex.v * dt);
  // facing: look slightly ahead so corners are anticipated
  const ahead = tangentAt(ex, Math.min(ex.total, ex.s + 0.35));
  const faceWant = ex.v > 0.05 || phase === 'turn' ? heading(ahead) : a.pose.yaw;
  a.pose.yaw = wrapAngle(a.pose.yaw + clamp(angleDelta(a.pose.yaw, faceWant), -ex.profile.turnRate * dt, ex.profile.turnRate * dt));
  // position = corridor point + bounded lateral offset (never outside clearance)
  const base = pointAt(ex, ex.s);
  const normal: Vec2 = rot2(ahead, -Math.PI / 2); // yaw is CCW from above; right-hand side of travel
  let off = ex.offset;
  let p = add2(base, scale2(normal, -off));
  for (let k = 0; k < 6 && (clearanceAt(g, p) < r || segmentClearance(g, base, p) < r); k++) {
    off *= 0.5;
    p = add2(base, scale2(normal, -off));
  }
  if (clearanceAt(g, p) < r) p = base;
  a.pose.p = [p[0], g.y, p[1]];
  a.human!.activity = ex.v > 0.05 ? 'walk' : yieldTo ? 'wait' : 'idle';

  if (yieldTo && ex.v < 0.02)
    return {
      status: 'blocked',
      diagnostic: { code: 'traffic.yield', message: `${ex.actor} is waiting for ${yieldTo} to clear a single-file passage`, subjects: [ex.actor, yieldTo] },
    };
  if (ex.s >= ex.total - 1e-6 && Math.abs(ex.offset) < 0.05) {
    if (ex.leg < ex.route.legs.length - 1) {
      ex.leg++;
      enterLeg(rt, ex);
      return { status: 'running', phase: ex.phase };
    }
    if (ex.face !== undefined && Math.abs(angleDelta(a.pose.yaw, ex.face)) > 0.03) {
      a.pose.yaw = wrapAngle(a.pose.yaw + clamp(angleDelta(a.pose.yaw, ex.face), -ex.profile.turnRate * dt, ex.profile.turnRate * dt));
      return { status: 'running', phase: 'face' };
    }
    releaseAll(rt, ex);
    a.human!.activity = 'idle';
    a.human!.task = undefined;
    return { status: 'completed', outputs: { replans: ex.replans, length: ex.route.length } };
  }
  return { status: 'running', phase };
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
  const path = leg.ascending ? link.path : [...link.path].reverse();
  const lens = path.slice(1).map((q, i) => Math.hypot(q[0] - path[i][0], q[1] - path[i][1], q[2] - path[i][2]));
  const total = lens.reduce((s, x) => s + x, 0);
  ex.climbT = Math.min(total, ex.climbT + CLIMB_SPEED * dt);
  let d = ex.climbT, i = 0;
  while (i < lens.length - 1 && d > lens[i]) { d -= lens[i]; i++; }
  const t = lens[i] ? clamp(d / lens[i], 0, 1) : 1;
  const P = path[i], Q = path[i + 1] ?? path[i];
  a.pose.p = [P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t, P[2] + (Q[2] - P[2]) * t];
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

/** Other people ahead within LOOK metres whose discs would conflict with our corridor. */
function conflicts(rt: Runtime, ex: Exec, a: Entity, tan: Vec2) {
  const out: { id: string; close: boolean }[] = [];
  const me: Vec2 = [a.pose.p[0], a.pose.p[2]];
  for (const o of Object.values(rt.world.entities)) {
    if (o.id === a.id || o.kind !== 'human' || o.human?.level !== a.human!.level) continue;
    const op: Vec2 = [o.pose.p[0], o.pose.p[2]];
    const d = sub2(op, me);
    const along = d[0] * tan[0] + d[1] * tan[1];
    if (along < 0 || along > LOOK) continue;
    const lateral = Math.abs(d[0] * -tan[1] + d[1] * tan[0]);
    if (lateral < 2 * ex.profile.radius + 0.12) out.push({ id: o.id, close: along < 2 * ex.profile.radius + 0.45 });
  }
  return out;
}
