// activities/1 (team/CONTRACTS/proposals/ACTIVITIES-v1.md): a body takes a generic activity pose where it is for a
// number of seconds — reading, painting, playing the piano, lying on the grass, napping — and then returns to its
// base posture. Pure body state (human.activity / baseActivity / prop / seatHeight); no items, needs or economy.
// Overlays keep a native seat that is already held (they are submitted after it, so their write wins each tick,
// the same convention as items/drink.ts).
// together/1 (core-next4): a pose with a `group` waits (up to waitSeconds) for the other bodies posing with the same group,
// then all start together and end at one shared tick; with `gap` the two step in to face each other at that distance
// (hug, handshake, high-five, dance together, give/take). `hold`/`release` set or clear the item carried in the hand
// (`human.holding`, drawn as `human.prop` whenever no activity prop is shown) when the pose completes.
import { z } from 'zod';
import type { ActionDef, Diagnostic } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import { heading, hypot, type Vec2 } from '../core/math.ts';
import { HUMAN_RADIUS } from '../world/catalog.ts';
import type { Spatial } from '../spatial/service.ts';
import { clearanceAt } from '../spatial/grid.ts';

/** Overlay activities (upper body; drawn on top of baseActivity). */
export const POSE_OVERLAYS = ['read', 'browse', 'write', 'play-piano', 'play-music', 'paint', 'eat', 'drink', 'cook', 'play-game', 'craft', 'post-letter', 'wave',
  // gestures (core-next4): solo, and the hand-over pair give/take; pick-up/put-down an item
  'bow', 'clap', 'nod', 'shake-head', 'point', 'cheer', 'give', 'take', 'pick-up', 'put-down'] as const;
/** Whole-body postures on open ground (the body point stays; the viewer lays the body out along pose.yaw). */
export const POSE_POSTURES = ['sit-ground', 'lie', 'nap', 'pushups', 'situps', 'yoga'] as const;
/** Standing whole-body exercise/expression poses (cyclic; the viewer animates them from the tick). */
export const POSE_MOVES = ['dance', 'jump', 'stretch', 'jumping-jacks',
  // paired touch gestures (core-next4): both bodies face each other at `gap` and share one start and end
  'hug', 'high-five', 'handshake'] as const;
export const POSE_ACTIVITIES: readonly string[] = [...POSE_OVERLAYS, ...POSE_POSTURES, ...POSE_MOVES];
export const POSE_PROPS = ['book', 'brush', 'pen', 'letter', 'cup', 'plate', 'tool', 'cards', 'flower', 'food', 'frisbee'] as const;
/** together/1: speed of the short step-in to the paired distance (m/s). */
const STEP_IN_SPEED = 0.6;
/** together/1: partners further apart than this never pair (m). */
const PAIR_REACH = 4;
const OVERLAY = new Set<string>(POSE_OVERLAYS), POSTURE = new Set<string>([...POSE_POSTURES, ...POSE_MOVES]), LYING = new Set(['lie', 'nap', 'pushups', 'situps', 'yoga']);
/** Open ground a lying body needs around its point (m). */
export const LIE_CLEARANCE = 0.9;

type Params = { actor: string; activity: string; seconds: number; prop?: string; base?: 'sit' | 'idle'; seatHeight?: number; face?: Vec2;
  group?: string; waitSeconds?: number; alone?: 'start' | 'fail'; gap?: number; need?: number; hold?: string; release?: boolean };
type Exec = { id: string; p: Params; base: string; at: number[]; t: number; yaw: number | null;
  /** together/1: 'waiting' for partners, then 'active' until the shared end tick. */
  phase?: 'waiting' | 'active'; waited?: number; until?: number; mobile?: boolean; close?: boolean };
/** together/1 public body state while a grouped pose runs (the viewer may draw open arms while waiting). */
export type TogetherState = { group: string; phase: 'waiting' | 'active'; until?: number; mobile: boolean };
const issue = (code: string, message: string, subjects: string[]): Diagnostic => ({ code: 'pose.' + code, message, subjects });

function admission(rt: Runtime, p: Params): Diagnostic | null {
  const a = rt.world.entities[p.actor], h = a?.human;
  if (!h || a.kind !== 'human') return issue('not-human', `${p.actor} is not a person`, [p.actor]);
  if (h.grip || h.riding || h.on || h.shore || h.carrier || h.sleepPose || (h as { boatPassenger?: unknown }).boatPassenger) return issue('occupied-support', 'Leave the climb, load, water, ride or mat first.', [p.actor]);
  // together/1: a grouped pose may start while someone's make-way nudge steps this body aside (it settles first)
  if (rt.holder('actor:' + p.actor).some((id) => rt.records.get(id)?.verb === 'walk_to' && !(p.group && nudge(id)))) return issue('not-still', 'Finish walking first.', [p.actor]);
  const seated = h.activity === 'sit' || (h.baseActivity === 'sit' && OVERLAY.has(h.activity));
  if (POSTURE.has(p.activity)) {
    if (seated) return issue('seated', 'Stand up before lying or sitting on the ground.', [p.actor]);
    const sp = rt.services.spatial as Spatial | undefined, g = sp?.level(h.level);
    // together/1: a standing gesture done with someone (hug, dance together…) needs only the ground the body already stands on
    const standingTogether = !!p.group && !LYING.has(p.activity);
    if (sp && g && !standingTogether) { sp.sync(rt.world); if (clearanceAt(sp.level(h.level)!, [a.pose.p[0], a.pose.p[2]]) < (LYING.has(p.activity) ? LIE_CLEARANCE : HUMAN_RADIUS + 0.1)) return issue('no-room', 'There is not enough open ground here to lie down; step onto open grass first.', [p.actor]); }
  }
  return null;
}
/** walk.ts makeWay: a transient courtesy step aside, not a new owner of the body. */
const nudge = (id: string) => /:make-way:\d+$/.test(id) || id.includes(':make-way:');
/** together/1: a courtesy step aside is moving this body right now (the grouped pose waits, writing nothing). */
const nudged = (rt: Runtime, actor: string) => rt.holder('actor:' + actor).some((id) => rt.records.get(id)?.verb === 'walk_to' && nudge(id));
const restore = (rt: Runtime, ex: Exec) => {
  const h = rt.world.entities[ex.p.actor]?.human; if (!h) return;
  if (h.activity === ex.p.activity || (ex.phase && h.activity === 'walk')) h.activity = ex.base === 'sit' && !held(rt, ex.p.actor) ? 'idle' : ex.base;
  delete h.baseActivity; delete h.seatHeight; delete h.partner; delete h.together; if (ex.phase) delete h.speed;
  // together/1: a carried item stays in the hand between activities
  if (h.holding) h.prop = h.holding; else delete h.prop;
};
/** together/1: the other bodies posing with this group (sorted by id: deterministic), nearest first for the paired one. */
const partnersOf = (rt: Runtime, ex: Exec) => {
  const me = rt.world.entities[ex.p.actor];
  return Object.values(rt.world.entities).filter((e) => e.id !== ex.p.actor && e.kind === 'human' && e.human?.together?.group === ex.p.group && (e.human.level ?? 0) === (me.human!.level ?? 0)
    && hypot(e.pose.p[0] - me.pose.p[0], e.pose.p[2] - me.pose.p[2]) <= PAIR_REACH * (ex.p.gap ? 1 : 3))
    .sort((a, b) => hypot(a.pose.p[0] - me.pose.p[0], a.pose.p[2] - me.pose.p[2]) - hypot(b.pose.p[0] - me.pose.p[0], b.pose.p[2] - me.pose.p[2]) || (a.id < b.id ? -1 : 1));
};
/** A native seat (sit / take_slot) this actor still holds. */
const held = (rt: Runtime, actor: string) => rt.holder('actor:' + actor).some((id) => ['sit', 'take_slot'].includes(rt.records.get(id)?.verb ?? ''));

export const poseV1: ActionDef<Params, true, Exec> = {
  verb: 'pose_v1',
  description: 'activities/1: take a generic activity pose where you are (read, browse, write, play-piano, play-music, paint, eat, drink, cook, play-game, craft, post-letter, wave over a seat or standing; sit-ground, lie, nap, pushups, situps, yoga on open ground; dance, jump, stretch, jumping-jacks standing) for a number of seconds, optionally holding a prop and facing a point, then return to the base posture.',
  schema: z.object({ actor: z.string().min(1).max(80), activity: z.enum(POSE_ACTIVITIES as [string, ...string[]]), seconds: z.number().min(0.5).max(3600), prop: z.enum(POSE_PROPS).optional(), base: z.enum(['sit', 'idle']).optional(), seatHeight: z.number().min(0.2).max(1.2).optional(), face: z.tuple([z.number(), z.number()]).optional(),
    group: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).optional(), waitSeconds: z.number().min(0).max(180).optional(), alone: z.enum(['start', 'fail']).optional(),
    gap: z.number().min(0.5).max(2.5).optional(), need: z.number().int().min(1).max(8).optional(), hold: z.enum(POSE_PROPS).optional(), release: z.boolean().optional() }).strict(),
  reservations: (_w, p) => [{ resource: 'hand:' + p.actor + ':left', mode: 'exclusive' }, { resource: 'hand:' + p.actor + ':right', mode: 'exclusive' }, { resource: 'pose:' + p.actor, mode: 'exclusive' }],
  plan(rt, p) { const d = admission(rt, p); return d ? { ok: false, diagnostic: d } : { ok: true, program: true }; },
  start(rt, p, _plan, id) {
    const a = rt.world.entities[p.actor], h = a.human!;
    const base = POSTURE.has(p.activity) ? 'idle' : h.activity === 'sit' || (h.baseActivity === 'sit' && OVERLAY.has(h.activity)) || p.base === 'sit' ? 'sit' : 'idle';
    const yaw = p.face && hypot(p.face[0] - a.pose.p[0], p.face[1] - a.pose.p[2]) > 0.05 ? heading([p.face[0] - a.pose.p[0], p.face[1] - a.pose.p[2]]) : null;
    return { id, p: structuredClone(p), base, at: [...a.pose.p], t: 0, yaw, ...(p.group ? { phase: 'waiting' as const, waited: 0, mobile: !held(rt, p.actor) } : {}) };
  },
  step(rt, ex, dt) {
    const a = rt.world.entities[ex.p.actor], h = a?.human;
    if (!h) return { status: 'failed', diagnostic: issue('not-human', 'the body is gone', [ex.p.actor]) };
    if (ex.phase && nudged(rt, ex.p.actor)) { ex.at = [...a.pose.p]; return { status: 'running', phase: 'settling' }; }
    if (ex.phase && ex.phase === 'waiting' && a.pose.p.some((n, i) => Math.abs(n - ex.at[i]) > 1e-6)) ex.at = [...a.pose.p];   // nudged aside while waiting: wait from there
    if (a.pose.p.some((n, i) => Math.abs(n - ex.at[i]) > 1e-6)) { restore(rt, ex); return { status: 'failed', diagnostic: issue('moved', 'The body moved; the activity ended.', [ex.p.actor]) }; }
    if (ex.phase) return together(rt, ex, a, h, dt);
    if (ex.yaw !== null && !held(rt, ex.p.actor)) a.pose.yaw = ex.yaw;  // a body on a native seat keeps the seat's facing
    h.activity = ex.p.activity;
    if (OVERLAY.has(ex.p.activity)) h.baseActivity = ex.base; else delete h.baseActivity;
    if (ex.p.prop) h.prop = ex.p.prop; else if (h.holding) h.prop = h.holding; else delete h.prop;
    if (ex.base === 'sit' && ex.p.seatHeight !== undefined && !held(rt, ex.p.actor)) h.seatHeight = ex.p.seatHeight; else delete h.seatHeight;
    ex.t += dt;
    if (ex.t + 1e-9 < ex.p.seconds) return { status: 'running', phase: 'posing' };
    return finish(rt, ex);
  },
  cancel(rt, ex) { restore(rt, ex); return { ok: true }; },
  resumable: true,
};

/** Completed: the hand item changes (hold/release), then the base posture returns. */
function finish(rt: Runtime, ex: Exec) {
  const h = rt.world.entities[ex.p.actor]?.human;
  if (h && ex.p.release) delete h.holding;
  if (h && ex.p.hold) h.holding = ex.p.hold;
  restore(rt, ex);
  return { status: 'completed' as const, outputs: { seconds: ex.p.seconds, ...(ex.p.group ? { group: ex.p.group } : {}) } };
}

/** together/1: wait for the group, start together, step in to `gap` facing the partner, end at the shared tick. */
function together(rt: Runtime, ex: Exec, a: NonNullable<Runtime['world']['entities'][string]>, h: NonNullable<typeof a.human>, dt: number) {
  const tick = rt.tick, ticks = (s: number) => Math.round(s / dt);
  const others = partnersOf(rt, ex), partner = others[0];
  const faceTo = (q: number[]) => { if (!held(rt, ex.p.actor) && hypot(q[0] - a.pose.p[0], q[2] - a.pose.p[2]) > 0.05) a.pose.yaw = heading([q[0] - a.pose.p[0], q[2] - a.pose.p[2]]); };
  if (h.prop === undefined || ex.p.prop) { if (ex.p.prop) h.prop = ex.p.prop; else if (h.holding) h.prop = h.holding; }
  if (ex.phase === 'waiting') {
    const going = others.find((o) => o.human!.together!.phase === 'active' && (o.human!.together!.until ?? 0) > tick);
    if (going) { ex.phase = 'active'; ex.until = going.human!.together!.until!; }
    else if (others.length >= (ex.p.need ?? 1)) { ex.phase = 'active'; ex.until = tick + ticks(ex.p.seconds); }
    else if ((ex.waited = (ex.waited ?? 0) + 1) > ticks(ex.p.waitSeconds ?? 30)) {
      if (ex.p.alone !== 'start') { restore(rt, ex); return { status: 'failed' as const, diagnostic: issue('partner-absent', 'Nobody came to do it with you in time.', [ex.p.actor]) }; }
      ex.phase = 'active'; ex.until = tick + ticks(ex.p.seconds);
    } else {
      h.together = { group: ex.p.group!, phase: 'waiting', mobile: !!ex.mobile };
      if (partner) faceTo(partner.pose.p); else if (ex.yaw !== null && !held(rt, ex.p.actor)) a.pose.yaw = ex.yaw;
      if (h.activity !== ex.base) h.activity = ex.base === 'sit' && !held(rt, ex.p.actor) ? 'idle' : ex.base;
      return { status: 'running' as const, phase: 'waiting-for-partner' };
    }
  }
  h.together = { group: ex.p.group!, phase: 'active', until: ex.until, mobile: !!ex.mobile };
  if (ex.p.gap) {
    // a paired gesture ends when its partner has gone (no hugging the air)
    if (!partner) { if (ex.close) return finish(rt, ex); }
    else {
      h.partner = partner.id; faceTo(partner.pose.p);
      const d = hypot(partner.pose.p[0] - a.pose.p[0], partner.pose.p[2] - a.pose.p[2]), left = d - ex.p.gap;
      if (left > 0.03 && ex.mobile) {
        // step in: share the distance with a mobile partner; stay on clear ground
        const share = partner.human!.together?.mobile ? 2 : 1, move = Math.min(STEP_IN_SPEED * dt, left / share), ux = (partner.pose.p[0] - a.pose.p[0]) / d, uz = (partner.pose.p[2] - a.pose.p[2]) / d;
        const nx = a.pose.p[0] + ux * move, nz = a.pose.p[2] + uz * move, sp = rt.services.spatial as Spatial | undefined, g = sp?.level(h.level);
        // never closer to a wall or bench than the body already is (people may stand near furniture)
        const clear = (x: number, z: number) => g ? clearanceAt(g, [x, z]) : Infinity, next = clear(nx, nz);
        if (next >= HUMAN_RADIUS - 0.02 || next >= clear(a.pose.p[0], a.pose.p[2])) {
          a.pose.p = [nx, a.pose.p[1], nz]; ex.at = [...a.pose.p]; h.activity = 'walk'; h.speed = Math.round(move / dt * 1000) / 1000;
          return tick >= ex.until! ? finish(rt, ex) : { status: 'running' as const, phase: 'stepping-in' };
        }
      }
      ex.close = true;
    }
    delete h.speed;
  } else if (partner && !held(rt, ex.p.actor) && ex.yaw === null && !POSTURE.has(ex.p.activity)) faceTo(partner.pose.p);
  else if (ex.yaw !== null && !held(rt, ex.p.actor)) a.pose.yaw = ex.yaw;
  h.activity = ex.p.activity;
  if (OVERLAY.has(ex.p.activity)) h.baseActivity = ex.base; else delete h.baseActivity;
  if (ex.p.prop) h.prop = ex.p.prop; else if (h.holding) h.prop = h.holding; else delete h.prop;
  if (tick >= ex.until!) return finish(rt, ex);
  return { status: 'running' as const, phase: 'together' };
}
