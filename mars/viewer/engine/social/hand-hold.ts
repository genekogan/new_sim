// Entry 35 (packet 44): two Souls holding hands. Consent lives in the edge ledger (an offer, then an acceptance); this is
// the body side. Public body state `human.handHold` on BOTH bodies (take field `handHold`, never controller context):
//   with    the other body
//   hand    which of MY hands holds (the inner one: the body on the left holds with its right hand)
//   offered the tick an offered hand began to go out (the host waiting for an answer)
//   since   the tick the two hands began to meet (both bodies get the same tick); joined from since + JOIN_SECONDS
//   release the tick letting go began (both bodies); the state is removed RELEASE_SECONDS later (stepHandHolds)
// The viewer draws the inner arms to one shared point between the two drawn bodies, so the palms meet whatever the bodies
// do; the engine only places the bodies (side by side, GAP apart) and keeps them so while one of them walks:
//   - the walker's own walk_to step moves its partner beside it in the same tick (followHand, called from walk.ts), so the
//     follower never lags a tick behind; it publishes its own walk speed, so both strides and walk eases match;
//   - a turn before a walk turns the pair about its middle (mode 'turn'), so neither walks into the other.
// A pair that stops being a pair (a body gone or seated, asleep, riding, too far apart) is let go by stepHandHolds.
import { z } from 'zod';
import type { ActionDef, Diagnostic } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity } from '../world/types.ts';
import { angleDelta, datan2, dcos, dsin, hypot, wrapAngle, type Vec2 } from '../core/math.ts';
import { HUMAN_RADIUS } from '../world/catalog.ts';
import type { Spatial } from '../spatial/service.ts';
import { clearanceAt } from '../spatial/grid.ts';

/** Body points side by side (m): shoulder to shoulder with a hand's width between (the walk planner keeps 2r = 0.56 m). */
export const HAND_GAP = 0.62;
/** The inner hands travel to each other (the viewer's reach), then hold. */
export const JOIN_SECONDS = 0.9;
/** The hands part and both arms come back down. */
export const RELEASE_SECONDS = 0.9;
/** An offered hand goes out this far (the viewer), and waits. */
export const OFFER_SECONDS = 0.8;
/** The state stays this long after the arms are down, so the viewer can fade idle gestures back in (no pop). */
export const HAND_STATE_TAIL = 1.5;
const STEP_SPEED = 0.55, TURN_RATE = 2.2, PAIR_TURN_RATE = 1.3, WALK_CAP = 1.4 * 1.04, WALK_MIN = 0.08;
/** A held pair farther apart than this has let go (m). */
const BREAK_GAP = 0.95;

export type HandHoldState = { with: string; hand: 'left' | 'right'; offered?: number; since?: number; release?: number; why?: string };
const schema = z.object({
  actor: z.string().min(1).max(80),
  mode: z.enum(['join', 'release', 'turn']),
  partner: z.string().min(1).max(80).optional(),
  group: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).optional(),
  hand: z.enum(['left', 'right']).optional(),
  /** join: the offerer holds its hand out while it waits (the guest's join does not). */
  offer: z.boolean().optional(),
  waitSeconds: z.number().min(0).max(120).optional(),
  /** turn: the point the pair turns to face. */
  toward: z.tuple([z.number(), z.number()]).optional(),
}).strict();
export type HandHoldParams = z.infer<typeof schema>;
type Exec = { p: HandHoldParams; t: number; phase: 'waiting' | 'stepping' | 'joining' | 'releasing' | 'turning' | 'done'; until?: number;
  /** turn: the pair's start heading, the angle to turn and the middle it turns about. */
  turn?: { from: number; by: number; mid: Vec2; seconds: number; lead: number; follow: number } };

const issue = (code: string, message: string, subjects: string[]): Diagnostic => ({ code: 'hand-hold.' + code, message, subjects });
const ticks = (s: number, dt: number) => Math.max(1, Math.round(s / dt));
const fwd = (yaw: number): Vec2 => [dcos(yaw), dsin(yaw)];
/** The person's right in the native frame (viewer: _right = (−sin yaw, cos yaw)). */
const rightOf = (yaw: number): Vec2 => [-dsin(yaw), dcos(yaw)];
const at = (e: Entity): Vec2 => [e.pose.p[0], e.pose.p[2]];
const turnToward = (yaw: number, want: number, max: number) => wrapAngle(yaw + Math.max(-max, Math.min(max, angleDelta(yaw, want))));
const smooth = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));

/** Bodies with a hand-hold state, kept as plain data for the per-tick guard (no scan of the whole entity table). */
const holders = (rt: Runtime): string[] => (rt.services.handHolders ??= []) as string[];
function track(rt: Runtime, id: string) { const l = holders(rt); if (!l.includes(id)) { l.push(id); l.sort(); } }
/** Joined (hands met), not letting go. */
export const joined = (h: Entity['human'] | undefined, tick?: number) => !!h?.handHold && h.handHold.since !== undefined && h.handHold.release === undefined && (tick === undefined || tick >= h.handHold.since);
/** The body this one walks hand in hand with (its partner), when they are joined; the walk planner ignores it as an obstacle. */
export function handPartnerOf(rt: Runtime, a: Entity): string | null {
  const h = a.human?.handHold; if (!h || h.since === undefined || h.release !== undefined) return null;
  const b = rt.world.entities[h.with]; return b?.human?.handHold?.with === a.id ? b.id : null;
}
function letGo(rt: Runtime, a: Entity | undefined, why?: string) {
  const h = a?.human?.handHold; if (!h || h.release !== undefined) return;
  h.release = rt.tick; if (why) h.why = why;
  const b = rt.world.entities[h.with], bh = b?.human?.handHold;
  if (bh?.with === a!.id && bh.release === undefined) { bh.release = rt.tick; if (why) bh.why = why; }
}
/** Speed and gait of a body moved here (not by its own walk_to). */
function publish(e: Entity, moved: number, dt: number) {
  const h = e.human!, v = Math.round(moved / dt * 1000) / 1000;
  if (v >= WALK_MIN) { h.activity = 'walk'; h.speed = v; }
  else { if (h.activity === 'walk') h.activity = 'idle'; delete h.speed; }
}
function clear(rt: Runtime, e: Entity, p: Vec2) {
  const sp = rt.services.spatial as Spatial | undefined, g = sp?.level(e.human?.level ?? 0);
  if (!sp || !g) return true; sp.sync(rt.world); return clearanceAt(g, p) >= HUMAN_RADIUS - 0.03;
}

/** Where the two stand to hold hands: side by side GAP apart about their middle, facing the way they mostly face. */
function sideBySide(a: Entity, b: Entity): { pa: Vec2; pb: Vec2; yaw: number; handA: 'left' | 'right' } {
  const A = at(a), B = at(b), d = hypot(B[0] - A[0], B[1] - A[1]) || 1, u: Vec2 = [(B[0] - A[0]) / d, (B[1] - A[1]) / d];
  const fa = fwd(a.pose.yaw), fb = fwd(b.pose.yaw);
  let f: Vec2 = [fa[0] + fb[0], fa[1] + fb[1]];
  const along = f[0] * u[0] + f[1] * u[1]; f = [f[0] - along * u[0], f[1] - along * u[1]];
  if (hypot(f[0], f[1]) < 0.2) f = [-u[1], u[0]];
  const yaw = datan2(f[1], f[0]), mid: Vec2 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const pa: Vec2 = [mid[0] - u[0] * HAND_GAP / 2, mid[1] - u[1] * HAND_GAP / 2], pb: Vec2 = [mid[0] + u[0] * HAND_GAP / 2, mid[1] + u[1] * HAND_GAP / 2];
  const r = rightOf(yaw), bOnRight = (pb[0] - pa[0]) * r[0] + (pb[1] - pa[1]) * r[1] > 0;
  return { pa, pb, yaw, handA: bOnRight ? 'right' : 'left' };
}

export const handHold: ActionDef<HandHoldParams, true, Exec> = {
  verb: 'hand_hold_v1',
  description: 'Hold hands with someone who agreed (join: step side by side and let the inner hands meet; release: let go; turn: turn the pair together toward a point).',
  schema, drivesReservedHands: false,
  reservations: (_w, p) => [{ resource: 'actor:' + p.actor, mode: 'exclusive' }, { resource: 'pose:' + p.actor, mode: 'exclusive' }],
  plan(rt, p) {
    const a = rt.world.entities[p.actor], h = a?.human;
    if (!h || a.kind !== 'human' || a.body?.family === 'floater') return { ok: false, diagnostic: issue('no-hands', 'This body has no humanoid hands to hold.', [p.actor]) };
    if (h.grip || h.holding || h.hands || h.on || h.riding || h.carrier || h.shore || h.sleepPose || h.activity === 'sit' || h.baseActivity === 'sit') return { ok: false, diagnostic: issue('body-busy', 'Stand with both hands free first.', [p.actor]) };
    if (p.mode === 'join') {
      if (!p.partner || !p.group) return { ok: false, diagnostic: issue('params', 'join needs a partner and a group.', [p.actor]) };
      const b = rt.world.entities[p.partner]; if (!b?.human) return { ok: false, diagnostic: issue('partner-gone', 'They are not here any more.', [p.actor, p.partner]) };
      if (h.handHold && h.handHold.release === undefined && h.handHold.with !== p.partner) return { ok: false, diagnostic: issue('hands-full', 'You are already holding someone else’s hand.', [p.actor]) };
    }
    if ((p.mode === 'release' || p.mode === 'turn') && !h.handHold) return { ok: false, diagnostic: issue('not-holding', 'You are not holding anyone’s hand.', [p.actor]) };
    return { ok: true, program: true };
  },
  start(rt, p) { return { p: structuredClone(p), t: 0, phase: p.mode === 'release' ? 'releasing' : p.mode === 'turn' ? 'turning' : 'waiting' }; },
  step(rt, ex, dt) {
    const a = rt.world.entities[ex.p.actor], h = a?.human, tick = rt.tick;
    if (!h) return { status: 'failed', diagnostic: issue('body-gone', 'The body is gone.', [ex.p.actor]) };
    ex.t += dt;
    if (ex.p.mode === 'release') {
      letGo(rt, a);
      const r = h.handHold?.release; if (r === undefined || tick >= r + ticks(RELEASE_SECONDS, dt)) return { status: 'completed' };
      return { status: 'running', phase: 'letting-go' };
    }
    if (ex.p.mode === 'turn') return turnPair(rt, ex, a, dt);
    // join
    const b = rt.world.entities[ex.p.partner!], bh = b?.human;
    const fail = (code: string, message: string) => { letGo(rt, a, code); return { status: 'failed' as const, diagnostic: issue(code, message, [ex.p.actor, ex.p.partner!]) }; };
    if (!bh) return fail('partner-gone', 'They are not here any more.');
    if (!h.handHold || h.handHold.release !== undefined) { h.handHold = { with: b.id, hand: ex.p.hand ?? 'right', ...(ex.p.offer ? { offered: tick } : {}) }; track(rt, a.id); }
    const mine = h.handHold, theirs = bh.handHold;
    if (mine.since !== undefined) return tick >= mine.since + ticks(JOIN_SECONDS, dt) ? { status: 'completed', outputs: { joined: true } } : { status: 'running', phase: 'joining' };
    // the partner's join for this same group is running (it holds a hand-hold state toward me): plan the spots once
    const plans = (rt.services.handJoins ??= {}) as Record<string, { a: string; b: string; at: Record<string, [number, number, number]>; hands: Record<string, 'left' | 'right'> }>;
    const ready = theirs?.with === a.id && theirs.release === undefined && rt.holder('actor:' + b.id).some((id) => { const r = rt.records.get(id); return r?.verb === 'hand_hold_v1' && (r.params as HandHoldParams).group === ex.p.group; });
    if (!ready) {
      if (ex.t > (ex.p.waitSeconds ?? 30)) { delete plans[ex.p.group!]; return fail('no-answer', 'Nobody took your hand in time.'); }
      // face the one we wait for, slowly (an offered hand goes out toward them)
      const want = datan2(b.pose.p[2] - a.pose.p[2], b.pose.p[0] - a.pose.p[0]);
      if (ex.p.offer && hypot(b.pose.p[0] - a.pose.p[0], b.pose.p[2] - a.pose.p[2]) > 1.6) a.pose.yaw = turnToward(a.pose.yaw, want, TURN_RATE * dt * 0.5);
      return { status: 'running', phase: ex.p.offer ? 'offering' : 'waiting' };
    }
    let plan = plans[ex.p.group!];
    if (!plan) {
      const [lo, hi] = a.id < b.id ? [a, b] : [b, a], s = sideBySide(lo, hi);
      if (hypot(s.pa[0] - lo.pose.p[0], s.pa[1] - lo.pose.p[2]) > 1.2 || hypot(s.pb[0] - hi.pose.p[0], s.pb[1] - hi.pose.p[2]) > 1.2) return fail('too-far', 'Stand next to them first.');
      if (!clear(rt, lo, s.pa) || !clear(rt, hi, s.pb)) return fail('no-room', 'There is no room to stand side by side here.');
      plan = plans[ex.p.group!] = { a: lo.id, b: hi.id, at: { [lo.id]: [s.pa[0], s.pa[1], s.yaw], [hi.id]: [s.pb[0], s.pb[1], s.yaw] }, hands: { [lo.id]: s.handA, [hi.id]: s.handA === 'right' ? 'left' : 'right' } };
    }
    ex.phase = 'stepping';
    const goal = plan.at[a.id]; if (!goal) return fail('plan', 'The pair changed.');
    mine.hand = plan.hands[a.id];
    const dx = goal[0] - a.pose.p[0], dz = goal[1] - a.pose.p[2], d = hypot(dx, dz), step = Math.min(d, STEP_SPEED * dt);
    if (d > 1e-6) { a.pose.p = [a.pose.p[0] + dx / d * step, a.pose.p[1], a.pose.p[2] + dz / d * step]; }
    a.pose.yaw = turnToward(a.pose.yaw, goal[2], TURN_RATE * dt);
    publish(a, step, dt);
    const settled = (e: Entity) => { const g = plan!.at[e.id]; return hypot(g[0] - e.pose.p[0], g[1] - e.pose.p[2]) < 0.005 && Math.abs(angleDelta(e.pose.yaw, g[2])) < 0.02; };
    if (settled(a) && settled(b) && theirs!.since === undefined) {
      // both in place: the hands begin to meet on this tick, for both
      mine.since = tick; theirs!.since = tick; delete h.speed; if (h.activity === 'walk') h.activity = 'idle';
      delete plans[ex.p.group!];
      if (!Object.keys(plans).length) delete rt.services.handJoins;
      return { status: 'running', phase: 'joining' };
    }
    return { status: 'running', phase: 'stepping' };
  },
  cancel(rt, ex) {
    const a = rt.world.entities[ex.p.actor], h = a?.human;
    // an offer or a join stopped before the hands met: lower the hand (a join that has met stays held; a release finishes)
    if (ex.p.mode === 'join' && h?.handHold && h.handHold.since === undefined) letGo(rt, a, 'cancelled');
    if (ex.p.mode === 'turn' && h) { delete h.speed; if (h.activity === 'walk') h.activity = 'idle'; const b = h.handHold ? rt.world.entities[h.handHold.with] : undefined; if (b?.human) { delete b.human.speed; if (b.human.activity === 'walk') b.human.activity = 'idle'; } }
    return { ok: true };
  },
  resumable: true,
};

/** Turn a held pair about its middle until it faces `toward` (a smoothstep over the angle, at most PAIR_TURN_RATE). */
function turnPair(rt: Runtime, ex: Exec, a: Entity, dt: number) {
  const h = a.human!, b = h.handHold ? rt.world.entities[h.handHold.with] : undefined;
  if (!b?.human || !joined(h) || b.human.handHold?.with !== a.id) return { status: 'completed' as const };
  if (!ex.turn) {
    const mid: Vec2 = [(a.pose.p[0] + b.pose.p[0]) / 2, (a.pose.p[2] + b.pose.p[2]) / 2], to = ex.p.toward ?? mid;
    const want = datan2(to[1] - mid[1], to[0] - mid[0]), from = a.pose.yaw, by = angleDelta(from, want);
    const r = rightOf(from), side = (p: Entity) => ((p.pose.p[0] - mid[0]) * r[0] + (p.pose.p[2] - mid[1]) * r[1]) >= 0 ? 1 : -1;
    ex.turn = { from, by, mid, seconds: Math.max(0.8, Math.abs(by) / PAIR_TURN_RATE * 1.5), lead: side(a), follow: side(b) };
    if (Math.abs(by) < 0.3) return { status: 'completed' as const };
  }
  const T = ex.turn, k = smooth(ex.t / T.seconds), yaw = wrapAngle(T.from + T.by * k), r = rightOf(yaw);
  for (const [e, s] of [[a, T.lead], [b, T.follow]] as const) {
    const p: Vec2 = [T.mid[0] + r[0] * s * HAND_GAP / 2, T.mid[1] + r[1] * s * HAND_GAP / 2], moved = hypot(p[0] - e.pose.p[0], p[1] - e.pose.p[2]);
    e.pose.p = [p[0], e.pose.p[1], p[1]]; e.pose.yaw = yaw; publish(e, moved, dt);
  }
  if (ex.t >= T.seconds) { for (const e of [a, b]) { delete e.human!.speed; if (e.human!.activity === 'walk') e.human!.activity = 'idle'; } return { status: 'completed' as const }; }
  return { status: 'running' as const, phase: 'turning-together' };
}

/** walk.ts, after the walker's own step: keep its hand partner beside it (same tick, so no lag), at most a walk's speed. */
export function followHand(rt: Runtime, a: Entity, dt: number) {
  const b = rt.world.entities[handPartnerOf(rt, a) ?? ''], bh = b?.human; if (!b || !bh) return;
  // the partner doing something of its own (its owner told it to) is never moved: the guard lets go instead
  if (rt.holder('actor:' + b.id).length) return;
  const A = at(a), B = at(b), r = rightOf(a.pose.yaw), side = (B[0] - A[0]) * r[0] + (B[1] - A[1]) * r[1] >= 0 ? 1 : -1;
  const goal: Vec2 = [A[0] + r[0] * side * HAND_GAP, A[1] + r[1] * side * HAND_GAP];
  if (!clear(rt, b, goal)) { letGo(rt, a, 'narrow'); publish(b, 0, dt); return; }
  const dx = goal[0] - B[0], dz = goal[1] - B[1], d = hypot(dx, dz), step = Math.min(d, WALK_CAP * dt);
  if (d > 1e-6) b.pose.p = [B[0] + dx / d * step, b.pose.p[1], B[1] + dz / d * step];
  b.pose.yaw = turnToward(b.pose.yaw, a.pose.yaw, 4 * dt);
  publish(b, step, dt);
}

/** Before each tick: finish letting go, and let go of a pair that is no longer one. Plain data; cheap with no holds. */
export function stepHandHolds(rt: Runtime) {
  const list = rt.services.handHolders as string[] | undefined; if (!list?.length) return;
  const dt = 0.05, tick = rt.tick + 1;
  for (const id of [...list]) {
    const e = rt.world.entities[id], h = e?.human, hh = h?.handHold;
    if (!hh) { list.splice(list.indexOf(id), 1); continue; }
    if (hh.release !== undefined) { if (tick >= hh.release + ticks(RELEASE_SECONDS + HAND_STATE_TAIL, dt)) { delete h!.handHold; list.splice(list.indexOf(id), 1); } continue; }
    const o = rt.world.entities[hh.with], oh = o?.human;
    if (!oh) { letGo(rt, e, 'partner-gone'); continue; }
    const live = (x: Entity) => rt.holder('actor:' + x.id).some((r) => rt.records.get(r)?.verb === 'hand_hold_v1');
    if (hh.since === undefined) { if (!live(e)) letGo(rt, e, 'no-answer'); continue; }   // an offer whose join ended
    if (oh.handHold?.with !== id) { letGo(rt, e, 'partner-let-go'); continue; }
    const apart = hypot(o.pose.p[0] - e.pose.p[0], o.pose.p[2] - e.pose.p[2]);
    const busy = (x: Entity) => !!(x.human!.sleepPose || x.human!.riding || x.human!.carrier || x.human!.grip || x.human!.activity === 'sit' || x.human!.baseActivity === 'sit');
    if (apart > BREAK_GAP || Math.abs(o.pose.p[1] - e.pose.p[1]) > 0.3 || (oh.level ?? 0) !== (h!.level ?? 0) || busy(e) || busy(o)) letGo(rt, e, 'apart');
  }
  if (!list.length) delete rt.services.handHolders;
}
