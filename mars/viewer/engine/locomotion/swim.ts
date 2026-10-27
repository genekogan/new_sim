// Swimming on ground worlds (lane L8, spec <eden4>/31 B1). Walking refuses
// water deeper than a body wades (`ground.deep-water`); `swim_to` crosses it:
// a coarse 1 m route through the water (the shallows and the shore to step in),
// followed at swimming pace, the root on the bed in the shallows and 1.2 m under
// the surface where deeper (as the shore controller), activity 'wade' / 'swim'
// while moving and 'tread' when stopped in deep water. Only worlds in ground
// mode (Spatial.ground) offer it; it is registered by the ground bridge.
import { z } from 'zod';
import type { ActionDef, Diagnostic, StepResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Spatial } from '../spatial/service.ts';
import { SWIM_COST, rectOf } from '../spatial/tiled.ts';
import { G_STEEP, G_OUTSIDE, G_SWIM, G_WADE, G_WALK, coarseMedium, swimRootY, type GroundField } from '../spatial/ground.ts';
import { angleDelta, heading, hypot, wrapAngle, pointInObb, type Vec2 } from '../core/math.ts';
import { HUMAN_RADIUS } from '../world/catalog.ts';
import { creatureOf } from '../bodies/creatures.ts';
import type { Body } from '../world/types.ts';
import { HUMAN_PROFILE, MAX_LEVEL_ID, type SpatialScene } from '../spatial/types.ts';

/** m/s while swimming (the shallows: wading pace). */
export const SWIM_SPEED = 0.8;
export const WADE_SPEED = 0.9;
const TURN_RATE = 4;
/** Dry ground a swim route may cross to step into the water (m from the start). */
const STEP_IN_M = 6;
type Params = { actor: string; x: number; z: number; landing?: boolean };
type Exec = { actor: string; id: string; points: Vec2[]; index: number };
// Derived validation only; restore rechecks against its newly rebuilt scene.
const swimScenes = new WeakMap<Exec, SpatialScene>();

/** A body's swimming pace: SWIM_SPEED for humanoids, a creature's own (never faster than SWIM_SPEED). */
export function swimSpeedOf(body: Body | undefined): number { const c = creatureOf(body)?.swimSpeed; return c ? Math.min(c, SWIM_SPEED) : SWIM_SPEED; }
const fail = (code: string, message: string, subjects?: string[]): Diagnostic => ({ code: `swim.${code}`, message, subjects });
const fmt = (p: Vec2) => `${p[0].toFixed(1)}, ${p[1].toFixed(1)}`;

/** Water is the recipe's (`base`): a deck (pier, bridge) over it is walked on, not swum under or climbed onto from below. */
function groundOf(rt: Runtime): { sp: Spatial; f: GroundField } | null {
  const sp = rt.services.spatial as Spatial | undefined;
  return sp?.ground ? { sp, f: sp.ground.base } : null;
}
/** A deck's height over (x, z) when the body's root is at or above it (it stands on the deck), else null. */
function onDeck(rt: Runtime, actor: string): boolean {
  const sp = rt.services.spatial as Spatial | undefined, e = rt.world.entities[actor], nav = sp?.ground;
  if (!nav || !e || nav.field === nav.base) return false;
  const x = e.pose.p[0], z = e.pose.p[2];
  return nav.field.medium(x, z) !== G_SWIM && nav.base.medium(x, z) === G_SWIM && e.pose.p[1] >= nav.field.height(x, z) - 0.5;
}
function bodyIssue(rt: Runtime, actor: string): Diagnostic | null {
  const e = rt.world.entities[actor];
  if (!e?.human || e.kind !== 'human') return fail('actor', `${actor} is not a person`, [actor]);
  // humanoids swim; of the other bodies only creatures whose species swims (bodies/creatures.ts: duck, dog)
  if (e.body && e.body.family !== 'humanoid' && !creatureOf(e.body)?.swimSpeed) return fail('body-family', creatureOf(e.body)?.cannot.swim ?? `${actor}'s body does not swim`, [actor]);
  if (e.human.grip || e.human.on || e.human.riding || e.human.carrier || e.human.sleepPose || e.human.hands?.left || e.human.hands?.right
    || Object.values(rt.world.entities).some((it) => it.support?.kind === 'in-hand' && it.support.by === actor))
    return fail('occupied-body', `${actor} must put things down and be on their feet before swimming`, [actor]);
  if (e.human.activity.startsWith('sit') || e.human.activity.startsWith('stand-up') || (e.human.level ?? 0) !== 0) return fail('occupied-body', `${actor} must stand on the ground before swimming`, [actor]);
  if (onDeck(rt, actor)) return fail('on-deck', `${actor} stands on a deck over the water; walk to the shore to get in`, [actor]);
  return null;
}
/** Medium-aware pose: root height and activity at a point. */
function poseAt(f: GroundField, p: Vec2, moving: boolean): { y: number; activity: string } {
  const m = f.medium(p[0], p[1]);
  if (m === G_SWIM) return { y: swimRootY(f, p[0], p[1]), activity: moving ? 'swim' : 'tread' };
  return { y: f.height(p[0], p[1]), activity: moving ? (m === G_WADE ? 'wade' : 'walk') : 'idle' };
}
/** Another body within reach of `p` (swimmers keep 0.6 m apart). */
function crowd(rt: Runtime, actor: string, p: Vec2): string | null {
  for (const o of Object.values(rt.world.entities)) {
    if (o.id === actor || o.kind !== 'human' || !o.human) continue;
    if (hypot(o.pose.p[0] - p[0], o.pose.p[2] - p[1]) < 2 * HUMAN_RADIUS + 0.04) return o.id;
  }
  return null;
}

/** Swim routes use actual body-band obstacles, including thin walls that the ordinary
 * land coarse search leaves to its fine planner. Bucket once per plan, not once per tick. */
function waterPath(rt: Runtime, sp: Spatial, f: GroundField, from: Vec2, to: Vec2) {
  sp.sync(rt.world);
  const buckets = new Map<string, typeof sp.scene.obstacles>();
  const x0 = Math.floor((Math.min(from[0], to[0]) - 49) / 8), x1 = Math.floor((Math.max(from[0], to[0]) + 49) / 8);
  const z0 = Math.floor((Math.min(from[1], to[1]) - 49) / 8), z1 = Math.floor((Math.max(from[1], to[1]) + 49) / 8);
  for (const o of sp.scene.obstacles) {
    const r = hypot(...o.obb.half) + HUMAN_RADIUS + .8;
    for (let x = Math.max(x0, Math.floor((o.obb.c[0] - r) / 8)); x <= Math.min(x1, Math.floor((o.obb.c[0] + r) / 8)); x++)
      for (let z = Math.max(z0, Math.floor((o.obb.c[1] - r) / 8)); z <= Math.min(z1, Math.floor((o.obb.c[1] + r) / 8)); z++) {
        const key = `${x},${z}`, b = buckets.get(key); if (b) b.push(o); else buckets.set(key, [o]);
      }
  }
  return sp.ground!.coarsePath(from, to, SWIM_COST, 48, 600_000, (x, z) => {
    const y = poseAt(f, [x, z], true).y;
    return !!buckets.get(`${Math.floor(x / 8)},${Math.floor(z / 8)}`)?.some(o => o.y0 < y + 1.8 && o.y1 > y + .05 && pointInObb([x, z], o.obb, HUMAN_RADIUS + .75));
  });
}

/** Plan a swim from where the actor is to (x, z): a route through water (pure; also used to find the shore). */
export function planSwim(rt: Runtime, actor: string, to: Vec2, landing = false): { ok: true; points: Vec2[] } | { ok: false; diagnostic: Diagnostic } {
  const g = groundOf(rt);
  if (!g) return { ok: false, diagnostic: fail('no-water', 'there is no water to swim in here') };
  const { sp, f } = g, e = rt.world.entities[actor], from: Vec2 = [e.pose.p[0], e.pose.p[2]];
  const gm = f.medium(to[0], to[1]);
  if (gm === G_OUTSIDE) return { ok: false, diagnostic: fail('outside', `(${fmt(to)}) lies beyond the edge of the world`, [actor]) };
  if (gm !== G_SWIM && gm !== G_WADE && !landing) return { ok: false, diagnostic: fail('not-water', `(${fmt(to)}) is not water; walk there instead`, [actor]) };
  const path = waterPath(rt, sp, f, from, to);
  if (!path) return { ok: false, diagnostic: fail('unreachable', `no water connects (${fmt(from)}) to (${fmt(to)})`, [actor]) };
  // dry ground only to step in: within STEP_IN_M of the start
  let s = 0;
  for (let k = 1; k < path.length; k++) {
    s += hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]);
    const m = coarseMedium(f, path[k][0], path[k][1]);
    if (m === G_STEEP) return { ok: false, diagnostic: fail('steep', `the bank at (${fmt(path[k])}) is too steep to climb in or out`, [actor]) };
    if (m === G_WALK && s > STEP_IN_M && k < path.length - 1) return { ok: false, diagnostic: fail('not-connected', `that water is not connected to where you are: dry ground at (${fmt(path[k])}) lies between`, [actor]) };
  }
  // straight runs between turns (the 1 m staircase of cell centres collapses to its corners)
  const pts: Vec2[] = [from];
  for (let k = 1; k < path.length - 1; k++) {
    const a = path[k - 1], b = path[k], c = path[k + 1];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) pts.push(b);
  }
  pts.push([to[0], to[1]]);
  // The media grid alone does not see thin walls or piers. Refuse any segment whose
  // swept body meets one rather than allowing a new composed journey to cross solids.
  sp.sync(rt.world);
  const blocked = swimBlocker(sp, f, pts);
  if (blocked) return {ok: false, diagnostic: fail('blocked', `the swim meets ${blocked.label ?? blocked.id}; choose a clear water route`, [actor, blocked.id])};
  if (!sp.groundInclude(rt.world, rectOf(pts))) return { ok: false, diagnostic: fail('too-far', `(${fmt(to)}) is too far to swim to in one go`, [actor]) };
  return { ok: true, points: pts };
}

/** Conservative swept body check on the short native swim legs, including edited thin barriers. */
function swimBlocker(sp: Spatial, f: GroundField, points: Vec2[]) {
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1], b = points[k], n = Math.max(1, Math.ceil(hypot(b[0] - a[0], b[1] - a[1]) / .15));
    const near = sp.scene.obstacles.filter(o => {
      const r = hypot(...o.obb.half) + HUMAN_RADIUS;
      return o.obb.c[0] + r >= Math.min(a[0], b[0]) && o.obb.c[0] - r <= Math.max(a[0], b[0]) && o.obb.c[1] + r >= Math.min(a[1], b[1]) && o.obb.c[1] - r <= Math.max(a[1], b[1]);
    });
    for (let i = 0; i <= n; i++) {
      const q: Vec2 = [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n], y = poseAt(f, q, true).y;
      const hit = near.find(o => o.y0 < y + 1.8 && o.y1 > y + .05 && pointInObb(q, o.obb, HUMAN_RADIUS + .075));
      if (hit) return hit;
    }
  }
  return null;
}

/** Where a swimmer reaches the shore heading for `to`: the first dry or shallow 1 m cell on its water route (null: none). */
export function shoreToward(rt: Runtime, actor: string, to: Vec2): Vec2 | null {
  const g = groundOf(rt); if (!g) return null;
  const e = rt.world.entities[actor], path = waterPath(rt, g.sp, g.f, [e.pose.p[0], e.pose.p[2]], to);
  if (!path) return null;
  for (const q of path) { const m = coarseMedium(g.f, q[0], q[1]); if (m === G_WALK) return q; }
  // the destination is on a deck over the water (a pier's end): head for where the deck meets dry ground instead
  const land = deckLanding(g.sp, to);
  return land && (land[0] !== to[0] || land[1] !== to[1]) ? shoreToward(rt, actor, land) : null;
}
/** Where a deck over water at `at` meets dry ground: breadth-first over the deck's 1 m cells (bounded); null: not on a deck. */
function deckLanding(sp: Spatial, at: Vec2): Vec2 | null {
  const nav = sp.ground; if (!nav || nav.field === nav.base) return null;
  const key = (x: number, z: number) => `${x},${z}`, start: Vec2 = [Math.floor(at[0]) + 0.5, Math.floor(at[1]) + 0.5];
  if (coarseMedium(nav.field, start[0], start[1]) !== G_WALK || coarseMedium(nav.base, start[0], start[1]) === G_WALK) return null;
  const seen = new Set([key(start[0], start[1])]), queue: Vec2[] = [start];
  for (let k = 0; k < queue.length && k < 4000; k++) {
    const [x, z] = queue[k];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const q: Vec2 = [x + dx, z + dz], id = key(q[0], q[1]); if (seen.has(id)) continue; seen.add(id);
      if (coarseMedium(nav.field, q[0], q[1]) !== G_WALK) continue;
      if (coarseMedium(nav.base, q[0], q[1]) === G_WALK) return q;
      queue.push(q);
    }
  }
  return null;
}

export const swimTo: ActionDef<Params, Vec2[], Exec> = {
  verb: 'swim_to',
  description: 'Swim (or wade) to (x, z) in water, from the shore or from in the water, on worlds with terrain; refuses dry destinations, unconnected water, loads and seats.',
  schema: z.object({ actor: z.string().min(1).max(80), x: z.number().min(-10000).max(10000), z: z.number().min(-10000).max(10000), landing: z.boolean().optional() }).strict(),
  resumable: true,
  reservations: (_w, p) => [{ resource: `actor:${p.actor}`, mode: 'exclusive' }],
  plan(rt, p) {
    const issue = bodyIssue(rt, p.actor); if (issue) return { ok: false, diagnostic: issue };
    const r = planSwim(rt, p.actor, [p.x, p.z], p.landing === true);
    return r.ok ? { ok: true, program: r.points } : r;
  },
  start(rt, p, points, id) { rt.world.entities[p.actor].human!.task = id; return { actor: p.actor, id, points: points.map((q) => [q[0], q[1]] as Vec2), index: 1 }; },
  step(rt, ex, dt): StepResult {
    const g = groundOf(rt), e = rt.world.entities[ex.actor];
    if (!g || !e?.human) return { status: 'failed', diagnostic: fail('no-water', 'the ground under this swim is gone', [ex.actor]) };
    const f = g.f, h = e.human, cur: Vec2 = [e.pose.p[0], e.pose.p[2]];
    while (ex.index < ex.points.length && hypot(cur[0] - ex.points[ex.index][0], cur[1] - ex.points[ex.index][1]) < 1e-6) ex.index++;
    if (ex.index >= ex.points.length) {
      const at = poseAt(f, cur, false);
      e.pose.p = [cur[0], at.y, cur[1]]; h.activity = at.activity; delete h.speed; delete h.task;
      return { status: 'completed', outputs: { position: [...e.pose.p], medium: at.activity === 'tread' ? 'swim' : at.activity === 'idle' ? 'ground' : at.activity } };
    }
    const target = ex.points[ex.index], d = hypot(target[0] - cur[0], target[1] - cur[1]);
    const turn = angleDelta(e.pose.yaw, heading([target[0] - cur[0], target[1] - cur[1]]));
    e.pose.yaw = wrapAngle(e.pose.yaw + Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, turn)));
    if (Math.abs(turn) > 0.6) { const at = poseAt(f, cur, false); h.activity = at.activity; h.speed = 0; return { status: 'running', phase: 'turning' }; }
    const speed = f.medium(cur[0], cur[1]) === G_SWIM ? swimSpeedOf(e.body) : WADE_SPEED, step = Math.min(d, speed * dt);
    const next: Vec2 = [cur[0] + ((target[0] - cur[0]) * step) / d, cur[1] + ((target[1] - cur[1]) * step) / d];
    g.sp.sync(rt.world);
    if (swimScenes.get(ex) !== g.sp.scene) {
      const blocked = swimBlocker(g.sp, f, [cur, ...ex.points.slice(ex.index)]);
      if (blocked) { const at = poseAt(f, cur, false); h.activity = at.activity; delete h.speed; delete h.task; return {status: 'failed', diagnostic: fail('blocked', `the swim meets ${blocked.label ?? blocked.id}`, [ex.actor, blocked.id])}; }
      swimScenes.set(ex, g.sp.scene);
    }
    const who = crowd(rt, ex.actor, next);
    if (who) { const at = poseAt(f, cur, false); h.activity = at.activity; h.speed = 0; return { status: 'blocked', diagnostic: fail('occupied', `${ex.actor} waits for ${who} in the water`, [ex.actor, who]) }; }
    const at = poseAt(f, next, true);
    e.pose.p = [next[0], at.y, next[1]]; h.activity = at.activity; h.speed = Math.round((step / dt) * 1000) / 1000;
    return { status: 'running', phase: at.activity };
  },
  cancel(rt, ex) {
    const e = rt.world.entities[ex.actor], g = groundOf(rt);
    if (e?.human) { if (g) { const at = poseAt(g.f, [e.pose.p[0], e.pose.p[2]], false); e.human.activity = at.activity; } delete e.human.speed; delete e.human.task; }
    return { ok: true };
  },
};

type TravelParams = { actor: string; x: number; z: number; level?: number };
type TravelOp = { verb: 'swim_to' | 'walk_to'; params: Record<string, unknown> };
type TravelExec = { id: string; actor: string; ops: TravelOp[]; index: number; child?: string; stopping?: boolean };
/** Whether the actor's root is in water too deep to stand in. */
export function inDeepWater(rt: Runtime, actor: string): boolean {
  const g = groundOf(rt), e = rt.world.entities[actor];
  return !!g && !!e?.human && (e.human.level ?? 0) === 0 && g.f.medium(e.pose.p[0], e.pose.p[2]) === G_SWIM && !onDeck(rt, actor);
}
/** The destination lies in deep water, rather than on a bridge above it. */
export function destinationInDeepWater(rt: Runtime, x: number, z: number): boolean {
  const sp = rt.services.spatial as Spatial | undefined;
  return !!sp?.ground && sp.ground.field.medium(x, z) === G_SWIM;
}

/** Native walk to a reachable bank, then native swim. The coarse media path chooses the bank;
 * the ordinary fine walk planner validates the approach and the swim replans from the actual
 * arrival pose. Bounded candidates prevent a long shoreline from causing unbounded fine searches. */
function enterWater(rt: Runtime, p: TravelParams): {ok: true; program: TravelOp[]} | {ok: false; diagnostic: Diagnostic} {
  const issue = bodyIssue(rt, p.actor); if (issue) return {ok: false, diagnostic: issue};
  const {sp, f} = groundOf(rt)!, e = rt.world.entities[p.actor], from: Vec2 = [e.pose.p[0], e.pose.p[2]], to: Vec2 = [p.x, p.z];
  const path = waterPath(rt, sp, f, from, to);
  if (!path) return {ok: false, diagnostic: fail('unreachable', `no traversable bank connects (${fmt(from)}) to (${fmt(to)})`, [p.actor])};
  // Already at a bank: preserve the existing short step-in behaviour.
  const direct = planSwim(rt, p.actor, to);
  if (direct.ok) return {ok: true, program: [{verb: 'swim_to', params: {actor: p.actor, x: p.x, z: p.z}}]};
  const wet = path.findIndex(q => coarseMedium(f, q[0], q[1]) === G_SWIM);
  if (wet < 0) return {ok: false, diagnostic: fail('no-shore', `no usable bank toward (${fmt(to)})`, [p.actor])};
  let tried = 0;
  for (let k = wet - 1; k >= 0 && tried < 6; k--) {
    const q = path[k], m = coarseMedium(f, q[0], q[1]);
    if (m !== G_WALK && m !== G_WADE) continue;
    // A water-side approach must be within the swim action's existing step-in range.
    if (hypot(q[0] - path[wet][0], q[1] - path[wet][1]) > STEP_IN_M - 1) break;
    tried++;
    const walk = rt.registry.get('walk_to')!.plan(rt, {actor: p.actor, x: q[0], z: q[1], level: 0});
    if (!walk.ok) continue;
    return {ok: true, program: [
      {verb: 'walk_to', params: {actor: p.actor, x: q[0], z: q[1], level: 0}},
      {verb: 'swim_to', params: {actor: p.actor, x: p.x, z: p.z}},
    ]};
  }
  return {ok: false, diagnostic: fail('no-shore', `no reachable bank toward (${fmt(to)}); the land approach is blocked`, [p.actor])};
}
/**
 * Going somewhere on foot from the water (ground worlds): swim to where the water route toward the destination
 * reaches dry ground, then walk. Each part is the native action (swim_to, walk_to) as a child; on land it is walk_to.
 */
export const groundTravel: ActionDef<TravelParams, TravelOp[], TravelExec> = {
  verb: 'ground_travel',
  description: 'Go to (x, z) on a terrain world: walk to a reachable bank and swim into deep water, or swim to shore and walk onto land.',
  schema: z.object({ actor: z.string().min(1).max(80), x: z.number().min(-10000).max(10000), z: z.number().min(-10000).max(10000), level: z.number().int().min(0).max(MAX_LEVEL_ID).optional() }).strict(),
  resumable: true,
  reservations: (_w, p) => [{ resource: `actor:${p.actor}`, mode: 'exclusive' }],
  plan(rt, p) {
    const walk = rt.registry.get('walk_to')!, swim = rt.registry.get('swim_to')!;
    if (destinationInDeepWater(rt, p.x, p.z) && (p.level ?? 0) === 0) return enterWater(rt, p);
    if (!inDeepWater(rt, p.actor)) { const r = walk.plan(rt, p); return r.ok ? { ok: true, program: [{ verb: 'walk_to', params: { ...p } }] } : r; }
    const issue = bodyIssue(rt, p.actor); if (issue) return { ok: false, diagnostic: issue };
    const shore = shoreToward(rt, p.actor, [p.x, p.z]);
    if (!shore) return { ok: false, diagnostic: fail('no-shore', `no shore toward (${fmt([p.x, p.z])}) from this water`, [p.actor]) };
    const sp = groundOf(rt)!.sp, e = rt.world.entities[p.actor];
    const onward = sp.route(rt.world, HUMAN_PROFILE, { level: 0, p: shore }, { level: p.level ?? 0, p: [p.x, p.z] });
    if (!onward.ok) return { ok: false, diagnostic: { ...onward.diagnostic, subjects: [p.actor, ...(onward.diagnostic.subjects ?? [])] } };
    const first = swim.plan(rt, { actor: p.actor, x: shore[0], z: shore[1], landing: true });
    if (!first.ok) return first;
    void e;
    return { ok: true, program: [{ verb: 'swim_to', params: { actor: p.actor, x: shore[0], z: shore[1], landing: true } }, { verb: 'walk_to', params: { ...p } }] };
  },
  start(_rt, p, ops, id) { return { id, actor: p.actor, ops: structuredClone(ops), index: 0 }; },
  step(rt, ex) {
    if (ex.child) {
      const r = rt.records.get(ex.child);
      if (!r) return { status: 'failed', diagnostic: fail('child-missing', 'the movement child is missing', [ex.actor]) };
      if (rt.isActive(r.id)) return r.status === 'blocked' ? { status: 'blocked', diagnostic: r.diagnostic ?? fail('waiting', 'movement is waiting', [ex.actor]) } : { status: 'running', phase: ex.stopping ? 'stopping' : r.verb };
      if (ex.stopping) return { status: 'completed' };
      if (r.status !== 'completed') return { status: 'failed', diagnostic: r.diagnostic ?? fail('child-failed', 'movement did not complete', [ex.actor]) };
      ex.child = undefined; ex.index++;
    }
    if (ex.stopping || ex.index >= ex.ops.length) return { status: 'completed', outputs: { position: [...rt.world.entities[ex.actor].pose.p] } };
    const op = ex.ops[ex.index], child = rt.submit(op.verb, op.params, { parent: ex.id, preempt: false });
    ex.child = child.id;
    if (child.status === 'failed') return { status: 'failed', diagnostic: child.diagnostic! };
    return { status: 'running', phase: op.verb };
  },
  cancel(rt, ex) { ex.stopping = true; if (ex.child && rt.isActive(ex.child)) { rt.cancel(ex.child, { code: 'ground.stopped', message: 'stopping where the body is' }); return { ok: true, deferred: rt.isActive(ex.child) }; } return { ok: true }; },
};
