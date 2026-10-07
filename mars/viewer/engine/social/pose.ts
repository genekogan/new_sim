// activities/1 (team/CONTRACTS/proposals/ACTIVITIES-v1.md): a body takes a generic activity pose where it is for a
// number of seconds — reading, painting, playing the piano, lying on the grass, napping — and then returns to its
// base posture. Pure body state (human.activity / baseActivity / prop / seatHeight); no items, needs or economy.
// Overlays keep a native seat that is already held (they are submitted after it, so their write wins each tick,
// the same convention as items/drink.ts).
import { z } from 'zod';
import type { ActionDef, Diagnostic } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import { heading, type Vec2 } from '../core/math.ts';
import { HUMAN_RADIUS } from '../world/catalog.ts';
import type { Spatial } from '../spatial/service.ts';
import { clearanceAt } from '../spatial/grid.ts';

/** Overlay activities (upper body; drawn on top of baseActivity). */
export const POSE_OVERLAYS = ['read', 'browse', 'write', 'play-piano', 'play-music', 'paint', 'eat', 'drink', 'cook', 'play-game', 'craft', 'post-letter', 'wave'] as const;
/** Whole-body postures on open ground (the body point stays; the viewer lays the body out along pose.yaw). */
export const POSE_POSTURES = ['sit-ground', 'lie', 'nap', 'pushups', 'situps', 'yoga'] as const;
/** Standing whole-body exercise/expression poses (cyclic; the viewer animates them from the tick). */
export const POSE_MOVES = ['dance', 'jump', 'stretch', 'jumping-jacks'] as const;
export const POSE_ACTIVITIES: readonly string[] = [...POSE_OVERLAYS, ...POSE_POSTURES, ...POSE_MOVES];
export const POSE_PROPS = ['book', 'brush', 'pen', 'letter', 'cup', 'plate', 'tool', 'cards'] as const;
const OVERLAY = new Set<string>(POSE_OVERLAYS), POSTURE = new Set<string>([...POSE_POSTURES, ...POSE_MOVES]), LYING = new Set(['lie', 'nap', 'pushups', 'situps', 'yoga']);
/** Open ground a lying body needs around its point (m). */
export const LIE_CLEARANCE = 0.9;

type Params = { actor: string; activity: string; seconds: number; prop?: string; base?: 'sit' | 'idle'; seatHeight?: number; face?: Vec2 };
type Exec = { id: string; p: Params; base: string; at: number[]; t: number; yaw: number | null };
const issue = (code: string, message: string, subjects: string[]): Diagnostic => ({ code: 'pose.' + code, message, subjects });

function admission(rt: Runtime, p: Params): Diagnostic | null {
  const a = rt.world.entities[p.actor], h = a?.human;
  if (!h || a.kind !== 'human') return issue('not-human', `${p.actor} is not a person`, [p.actor]);
  if (h.grip || h.riding || h.on || h.shore || h.carrier || h.sleepPose || (h as { boatPassenger?: unknown }).boatPassenger) return issue('occupied-support', 'Leave the climb, load, water, ride or mat first.', [p.actor]);
  if (rt.holder('actor:' + p.actor).some((id) => rt.records.get(id)?.verb === 'walk_to')) return issue('not-still', 'Finish walking first.', [p.actor]);
  const seated = h.activity === 'sit' || (h.baseActivity === 'sit' && OVERLAY.has(h.activity));
  if (POSTURE.has(p.activity)) {
    if (seated) return issue('seated', 'Stand up before lying or sitting on the ground.', [p.actor]);
    const sp = rt.services.spatial as Spatial | undefined, g = sp?.level(h.level);
    if (sp && g) { sp.sync(rt.world); if (clearanceAt(sp.level(h.level)!, [a.pose.p[0], a.pose.p[2]]) < (LYING.has(p.activity) ? LIE_CLEARANCE : HUMAN_RADIUS + 0.1)) return issue('no-room', 'There is not enough open ground here to lie down; step onto open grass first.', [p.actor]); }
  }
  return null;
}
const restore = (rt: Runtime, ex: Exec) => {
  const h = rt.world.entities[ex.p.actor]?.human; if (!h) return;
  if (h.activity === ex.p.activity) h.activity = ex.base === 'sit' && !held(rt, ex.p.actor) ? 'idle' : ex.base;
  delete h.baseActivity; delete h.prop; delete h.seatHeight;
};
/** A native seat (sit / take_slot) this actor still holds. */
const held = (rt: Runtime, actor: string) => rt.holder('actor:' + actor).some((id) => ['sit', 'take_slot'].includes(rt.records.get(id)?.verb ?? ''));

export const poseV1: ActionDef<Params, true, Exec> = {
  verb: 'pose_v1',
  description: 'activities/1: take a generic activity pose where you are (read, browse, write, play-piano, play-music, paint, eat, drink, cook, play-game, craft, post-letter, wave over a seat or standing; sit-ground, lie, nap, pushups, situps, yoga on open ground; dance, jump, stretch, jumping-jacks standing) for a number of seconds, optionally holding a prop and facing a point, then return to the base posture.',
  schema: z.object({ actor: z.string().min(1).max(80), activity: z.enum(POSE_ACTIVITIES as [string, ...string[]]), seconds: z.number().min(0.5).max(3600), prop: z.enum(POSE_PROPS).optional(), base: z.enum(['sit', 'idle']).optional(), seatHeight: z.number().min(0.2).max(1.2).optional(), face: z.tuple([z.number(), z.number()]).optional() }).strict(),
  reservations: (_w, p) => [{ resource: 'hand:' + p.actor + ':left', mode: 'exclusive' }, { resource: 'hand:' + p.actor + ':right', mode: 'exclusive' }, { resource: 'pose:' + p.actor, mode: 'exclusive' }],
  plan(rt, p) { const d = admission(rt, p); return d ? { ok: false, diagnostic: d } : { ok: true, program: true }; },
  start(rt, p, _plan, id) {
    const a = rt.world.entities[p.actor], h = a.human!;
    const base = POSTURE.has(p.activity) ? 'idle' : h.activity === 'sit' || (h.baseActivity === 'sit' && OVERLAY.has(h.activity)) || p.base === 'sit' ? 'sit' : 'idle';
    const yaw = p.face && Math.hypot(p.face[0] - a.pose.p[0], p.face[1] - a.pose.p[2]) > 0.05 ? heading([p.face[0] - a.pose.p[0], p.face[1] - a.pose.p[2]]) : null;
    return { id, p: structuredClone(p), base, at: [...a.pose.p], t: 0, yaw };
  },
  step(rt, ex, dt) {
    const a = rt.world.entities[ex.p.actor], h = a?.human;
    if (!h) return { status: 'failed', diagnostic: issue('not-human', 'the body is gone', [ex.p.actor]) };
    if (a.pose.p.some((n, i) => Math.abs(n - ex.at[i]) > 1e-6)) { restore(rt, ex); return { status: 'failed', diagnostic: issue('moved', 'The body moved; the activity ended.', [ex.p.actor]) }; }
    if (ex.yaw !== null && !held(rt, ex.p.actor)) a.pose.yaw = ex.yaw;  // a body on a native seat keeps the seat's facing
    h.activity = ex.p.activity;
    if (OVERLAY.has(ex.p.activity)) h.baseActivity = ex.base; else delete h.baseActivity;
    if (ex.p.prop) h.prop = ex.p.prop; else delete h.prop;
    if (ex.base === 'sit' && ex.p.seatHeight !== undefined && !held(rt, ex.p.actor)) h.seatHeight = ex.p.seatHeight; else delete h.seatHeight;
    ex.t += dt;
    if (ex.t + 1e-9 < ex.p.seconds) return { status: 'running', phase: 'posing' };
    restore(rt, ex);
    return { status: 'completed', outputs: { seconds: ex.p.seconds } };
  },
  cancel(rt, ex) { restore(rt, ex); return { ok: true }; },
  resumable: true,
};
