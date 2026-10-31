// Soul Actions entry 34: a watering can held by its handle, filled under a garden tap and poured on a planter.
// One finite native timeline per stage (`wateringFrame`, pure): the engine drives the hands from it and marks the moments
// the world changes (the left hand on the tap's valve, the stream running onto the soil); viewers draw the can's tilt, the
// stream and the free arm's blend from the SAME timeline, so what is seen and what is committed cannot drift apart.
import { z } from 'zod';
import type { ActionDef, Diagnostic, StepResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import { dcos, dsin, type Vec3 } from '../core/math.ts';
import { bodyFrame, lerp3, restHand, smooth } from './body.ts';
import { carryPoint, followHand } from './model.ts';

const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const vec2 = z.tuple([z.number().finite(), z.number().finite()]);
export const wateringParams = z.object({
  actor: z.string().min(1).max(80), item: z.string().min(1).max(80), target: z.string().min(1).max(80),
  stage: z.enum(['fill', 'pour']),
  /** Engine heading the body faces while it works. */
  face: z.number().finite(),
  /** Where the handle grip goes: under the tap's spout (fill), or over the soil at the start of the pour. */
  hold: vec3,
  /** fill: the tap's valve, for the free (left) hand. */
  valve: vec3.optional(),
  /** pour: half the sweep of the hand along the bed (world x, z). */
  sweep: vec2.optional(),
  /** fill: seconds the water runs; pour: seconds the stream runs. */
  seconds: z.number().min(0.5).max(20),
  /** The can's level after this stage (0..1): a full can is carried a little lower. */
  levelAfter: z.number().min(0).max(1),
  /** Litres this stage moves (the server's book-keeping; the motion does not read it). */
  litres: z.number().min(0).max(30).optional(),
}).strict();
export type WateringParams = z.infer<typeof wateringParams>;
export type WateringMotion = Omit<WateringParams, 'actor'> & { startTick: number; actionId?: string; abortedAt?: number };

/** Timeline constants (s). The free hand on the valve uses the contact faculty's own reach and release times. */
export const W = { fillIn: 0.9, valveReach: 0.65, valveHold: 0.35, valveRelease: 0.7, fullOut: 1.15, pourIn: 1.0, tiltIn: 0.8, untilt: 0.7, pourOut: 0.95, abortOut: 0.9 } as const;
/** Spout tilt while pouring (rad): 50°, rising 6° as the can empties; the rose runs from 25°, fully from 35°. */
export const TILT = 50 * Math.PI / 180, TILT_MORE = 6 * Math.PI / 180, FLOW_FROM = 25 * Math.PI / 180, FLOW_FULL = 35 * Math.PI / 180;
/** A full can rides this much lower in the hand (m). */
export const FULL_DROP = 0.035;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export type WateringFrame = {
  /** 0 = the carry point, 1 = the hold point (under the spout / over the soil). */
  right: number;
  /** pour: sweep phase −1..1 along `sweep`. */
  sweepK: number;
  /** The free hand: 0 = hanging (the clip), 1 = on the valve. It is also that arm's blend weight. */
  left: number;
  /** The can's spout tilt (rad, down) and the stream's strength 0..1. */
  tilt: number; flow: number;
  /** Times (s) of the world moments: valve contacts (fill); the stream's start, thirds and end (pour). */
  done: boolean; end: number;
};
/** fill: the two valve contacts (s). */
export function fillContacts(m: Pick<WateringMotion, 'seconds'>) { const on = W.fillIn + W.valveReach; return { on, off: on + m.seconds }; }
/** pour: when the tilt starts back and when the stream window is (s). */
export function pourWindow(m: Pick<WateringMotion, 'seconds' | 'abortedAt'>) {
  const tilt0 = W.pourIn, start = tilt0 + W.tiltIn, natural = start + m.seconds, u0 = Math.min(m.abortedAt ?? Infinity, natural);
  return { tilt0, start, natural, untilt: u0, out: u0 + W.untilt, end: Math.max(u0, tilt0) + (u0 > tilt0 ? W.untilt : 0) + W.pourOut };
}
function rawTilt(m: WateringMotion, s: number) {
  const w = pourWindow({ seconds: m.seconds });
  if (s <= w.tilt0) return 0;
  if (s <= w.start) return TILT * smooth((s - w.tilt0) / W.tiltIn);
  return TILT + TILT_MORE * clamp01((s - w.start) / m.seconds);
}
/** The whole visible timeline of one stage at `s` seconds after its start. */
export function wateringFrame(m: WateringMotion, s: number): WateringFrame {
  if (m.stage === 'fill') {
    const c = fillContacts(m), r1 = c.on - W.valveReach, r2 = c.off - W.valveReach, out = c.off + W.valveHold;
    // first reach, hold, release; the second reach starts from wherever the first release has got to (continuous)
    const valve = (t: number) => { const rel1 = t - (c.on + W.valveHold), rel2 = t - (c.off + W.valveHold);
      if (t < c.on) return smooth((t - r1) / W.valveReach);
      const first = 1 - smooth(rel1 / W.valveRelease);
      if (t < c.off) return Math.max(first, smooth((t - r2) / W.valveReach));
      return 1 - smooth(rel2 / W.valveRelease); };
    const right = (t: number) => (t < out ? smooth(t / W.fillIn) : 1 - smooth((t - out) / W.fullOut));
    const end = Math.max(out + W.fullOut, c.off + W.valveHold + W.valveRelease);
    if (m.abortedAt !== undefined && m.abortedAt < c.on) { // before the first contact: nothing happens; the hands come back
      const a = m.abortedAt, k = 1 - smooth((s - a) / W.abortOut), e = a + W.abortOut;
      return { right: right(Math.min(s, a)) * (s > a ? k : 1), left: valve(Math.min(s, a)) * (s > a ? k : 1), sweepK: 0, tilt: 0, flow: 0, done: s >= e, end: e };
    }
    return { right: right(s), left: valve(s), sweepK: 0, tilt: 0, flow: 0, done: s >= end, end };
  }
  const w = pourWindow(m), aborted = m.abortedAt !== undefined && m.abortedAt < w.natural;
  const tiltAtUntilt = rawTilt(m, w.untilt);
  const tilt = s <= w.untilt ? rawTilt(m, s) : tiltAtUntilt * (1 - smooth((s - w.untilt) / W.untilt));
  const outStart = aborted && w.untilt <= w.tilt0 ? w.untilt : w.out;
  const inK = smooth(Math.min(s, aborted ? w.untilt : Infinity) / W.pourIn);
  const right = s <= outStart ? inK : inK * (1 - smooth((s - outStart) / W.pourOut));
  const u = clamp01((Math.min(s, w.untilt) - w.start) / m.seconds);
  const end = outStart + W.pourOut;
  return { right, left: 0, sweepK: Math.sin(2 * Math.PI * u), tilt, flow: smooth((tilt - FLOW_FROM) / (FLOW_FULL - FLOW_FROM)), done: s >= end, end };
}

const smoothAt = (y: number) => { let lo = 0, hi = 1; for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (smooth(mid) < y) lo = mid; else hi = mid; } return (lo + hi) / 2; };
export type WateringEvent = { key: string; at: number; data: Record<string, unknown> };
/** The moments one stage changes the world, with their times (s), on the path the motion actually takes (an interrupted
 *  fill before the valve, or a pour tipped back early, has fewer). The engine marks them; the server commits them. */
export function wateringEvents(m: WateringMotion): WateringEvent[] {
  if (m.stage === 'fill') {
    const c = fillContacts(m);
    if (m.abortedAt !== undefined && m.abortedAt < c.on) return [];
    return [{ key: 'valve-on', at: c.on, data: { on: true } }, { key: 'valve-off', at: c.off, data: { on: false, level: m.levelAfter } }];
  }
  const w = pourWindow(m), flowAt = w.tilt0 + smoothAt(FLOW_FROM / TILT) * W.tiltIn;
  if (w.untilt <= flowAt) return [];
  const out: WateringEvent[] = [{ key: 'pour-start', at: flowAt, data: {} }];
  let done = 0;
  for (const k of [1, 2, 3]) { const at = w.start + k / 3 * m.seconds; if (at <= w.untilt + 1e-9) { out.push({ key: 'pour-' + k, at, data: { fraction: 1 / 3 } }); done = k; } }
  const reached = Math.max(0, Math.min(1, (w.untilt - w.start) / m.seconds));
  if (done < 3) out.push({ key: 'pour-abort', at: w.untilt, data: { fraction: Math.max(0, reached - done / 3) } });
  const tu = rawTilt(m, w.untilt), endAt = w.untilt + (tu > FLOW_FROM ? smoothAt(1 - FLOW_FROM / tu) * W.untilt : 0);
  out.push({ key: 'pour-end', at: endAt, data: { level: done === 3 ? m.levelAfter : undefined, poured: done === 3 ? 1 : reached } });
  return out;
}

/** The can's pose for a hand at `grip` holding it by the handle: local +x (the spout) along the heading, tipped `tilt`
 *  about the lateral axis. World point of a can-local point (x forward, y up, z right of the spout). */
export function canPoint(grip: Vec3, gripLocal: Vec3, yaw: number, tilt: number, local: Vec3): Vec3 {
  const dx = local[0] - gripLocal[0], dy = local[1] - gripLocal[1], dz = local[2] - gripLocal[2];
  const c = Math.cos(tilt), s = Math.sin(tilt), fx = dx * c + dy * s, fy = -dx * s + dy * c;
  const cy = dcos(yaw), sy = dsin(yaw);
  return [grip[0] + cy * fx - sy * dz, grip[1] + fy, grip[2] + sy * fx + cy * dz];
}

const issue = (code: string, message: string, subjects: string[]): Diagnostic => ({ code: 'watering.' + code, message, subjects });
type Exec = { p: WateringParams; motion: WateringMotion; t: number; from?: Vec3; yaw0: number; fired: Set<string> };
function clearBody(rt: Runtime, ex: Exec) {
  const h = rt.world.entities[ex.p.actor]?.human; if (!h) return;
  delete h.wateringV1;
  if (h.hands) { delete h.hands.left; if (!h.hands.right) delete h.hands; }
  if (h.activity === 'operate') h.activity = 'idle';
}
export const watering: ActionDef<WateringParams, true, Exec> = {
  verb: 'watering_can_v1',
  description: 'With a watering can held by its handle in the right hand: fill it under a garden tap (the left hand turns the valve on and off) or tilt it and pour through the rose over a planter. Finite, recorded timeline; the world changes at its marks.',
  schema: wateringParams,
  reservations: (_w, p) => [`actor:${p.actor}`, `hand:${p.actor}:right`, `hand:${p.actor}:left`, `entity:${p.item}`, `entity:${p.target}`].map((resource) => ({ resource, mode: 'exclusive' as const })),
  plan(rt, p) {
    const a = rt.world.entities[p.actor], it = rt.world.entities[p.item];
    if (!a?.human) return { ok: false, diagnostic: issue('actor', `${p.actor} is not a person`, [p.actor]) };
    if (it?.support?.kind !== 'in-hand' || it.support.by !== p.actor || it.support.hand !== 'right') return { ok: false, diagnostic: issue('not-held', `${p.actor} must hold ${p.item} in the right hand`, [p.actor, p.item]) };
    if (!rt.world.entities[p.target]) return { ok: false, diagnostic: issue('target', `${p.target} is gone`, [p.target]) };
    if (p.stage === 'fill' && !p.valve) return { ok: false, diagnostic: issue('valve', 'Filling needs the tap valve', [p.target]) };
    if (Math.hypot(p.hold[0] - a.pose.p[0], p.hold[2] - a.pose.p[2]) > 1.1) return { ok: false, diagnostic: issue('too-far', `${p.actor} is not standing at ${p.target}`, [p.actor, p.target]) };
    return { ok: true, program: true };
  },
  start(rt, p, _plan, id) {
    const a = rt.world.entities[p.actor];
    const { actor: _a, ...rest } = p;
    return { p: structuredClone(p), motion: { ...structuredClone(rest), startTick: rt.tick, actionId: id }, t: 0, yaw0: a.pose.yaw, fired: new Set() };
  },
  step(rt, ex, dt): StepResult {
    const a = rt.world.entities[ex.p.actor], h = a?.human, it = rt.world.entities[ex.p.item];
    if (!h || !it) return { status: 'failed', diagnostic: issue('gone', 'The body or the can is gone', [ex.p.actor, ex.p.item]) };
    if (it.support?.kind !== 'in-hand' || it.support.by !== ex.p.actor) { clearBody(rt, ex); return { status: 'failed', diagnostic: issue('dropped', `${ex.p.item} left ${ex.p.actor}'s hand`, [ex.p.item]) }; }
    ex.t += dt;
    const m = ex.motion, s = ex.t, f = wateringFrame(m, s);
    // face the work over the first 0.4 s (the walk usually arrives facing it already)
    const turn = ((ex.p.face - ex.yaw0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    a.pose.yaw = ex.yaw0 + turn * smooth(s / 0.4);
    const b = bodyFrame(a);
    ex.from ??= h.hands?.right ? [...h.hands.right] as Vec3 : carryPoint(it, b, 'right');
    // the moments the world changes, once each, on the path the motion takes
    for (const e of wateringEvents(m)) if (s >= e.at && !ex.fired.has(e.key)) {
      ex.fired.add(e.key);
      rt.mark('watering.' + e.key, { actor: ex.p.actor, item: ex.p.item, target: ex.p.target, actionId: m.actionId, ...e.data });
      if (e.key === 'valve-off' || e.key === 'pour-end') it.carryDropV1 = FULL_DROP * (typeof e.data.level === 'number' ? e.data.level : Math.max(0, ex.p.levelAfter));
    }
    let hold: Vec3 = ex.p.hold;
    if (m.stage === 'pour') { const sw = ex.p.sweep ?? [0, 0]; hold = [hold[0] + sw[0] * f.sweepK, hold[1], hold[2] + sw[1] * f.sweepK]; }
    const carry = carryPoint(it, b, 'right');
    // in from where the hand was; out to the carry point (a full can's is lower)
    const goingOut = m.stage === 'fill' ? s >= fillContacts(m).off : s >= pourWindow(m).untilt;
    const right = goingOut ? lerp3(carry, hold, f.right) : lerp3(ex.from, hold, f.right);
    h.hands = { ...(h.hands ?? {}), right: [...right] };
    followHand(it, right, a.pose.yaw);
    if (ex.p.valve && f.left > 1e-4) h.hands.left = [...lerp3(restHand(b, 'left'), ex.p.valve, f.left)];
    else delete h.hands.left;
    h.activity = 'operate';
    h.wateringV1 = m;
    if (f.done) { clearBody(rt, ex); h.hands = { ...(h.hands ?? {}), right: [...carry] }; return { status: 'completed', outputs: { stage: m.stage, level: ex.p.levelAfter } }; }
    return { status: 'running', phase: m.stage === 'fill' ? (s < fillContacts(m).on ? 'reaching' : s < fillContacts(m).off ? 'filling' : 'lifting') : (f.flow > 0 ? 'pouring' : s < pourWindow(m).start ? 'raising' : 'lowering') };
  },
  cancel(rt, ex) {
    // Before any contact the hands come back and nothing changes. A running tap is still turned off (the fill is cut
    // short); a running stream is tipped back up. The body is free only once the can is back at the carry point.
    const m = ex.motion;
    if (m.abortedAt === undefined) {
      if (m.stage === 'fill') { const c = fillContacts(m); if (ex.t < c.on) m.abortedAt = ex.t; else if (ex.t < c.off - W.valveReach) { m.seconds = Math.max(0.5, ex.t - c.on + W.valveReach); } }
      else m.abortedAt = ex.t;
      ex.motion = { ...m };
    }
    return { ok: true, deferred: true };
  },
  resumable: 'A watering stage is a few seconds of hand motion; a logical reload restarts it from the carry point.',
};
