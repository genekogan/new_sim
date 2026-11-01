// Soul Actions entry 44: a mug held in one hand is drunk from, or rinsed under a tap. One finite native timeline per stage
// (`cupFrame`, pure), like entry 34's watering can: the engine drives the hand from it and marks the moments the world
// changes; viewers draw the mug, the hand on it, the tap's water in it and the rinse water leaving it from the SAME
// timeline, so what is seen and what is committed cannot drift apart.
//   drink  the hand moves from under the mug to its side, raises it to the lips, tilts it, holds (a sip), tips it back,
//          lowers it to a chest hold, pauses, and again; after the last sip the mug goes back to the carry point and the
//          hand back under it. The tea left is `drinkTea(m, s)`: a pure function of the drink record and its time.
//   wash   the hand moves to the mug's side, holds it under the tap's spout; the free hand turns the valve on (the tap
//          runs into the mug) and off; a small swirl; the mug is tipped forward over the basin (the water runs out); upright,
//          back to the carry point, the hand back under it. The mug is clean from the moment the rinse water has left it.
import { z } from 'zod';
import type { ActionDef, Diagnostic, StepResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import { datan, datan2, dcos, dsin, hypot, type Vec3 } from '../core/math.ts';
import { at, bodyFrame, carryHand, sideOf, smooth, type BodyFrame, type Hand } from './body.ts';
import { followHand } from './model.ts';

const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export const cupParams = z.object({
  actor: z.string().min(1).max(80), item: z.string().min(1).max(80),
  stage: z.enum(['drink', 'wash']),
  /** Engine heading the body faces while it works. */
  face: z.number().finite(),
  /** drink: how many sips, the tea in the mug at the start (0..1) and the tea one sip takes. */
  sips: z.number().int().min(1).max(8).optional(),
  from: z.number().min(0).max(1).optional(),
  sip: z.number().min(0.01).max(1).optional(),
  /** wash: the tap, where the mug's base goes (under the spout), and the valve for the free hand. */
  target: z.string().min(1).max(80).optional(),
  hold: vec3.optional(),
  valve: vec3.optional(),
  /** wash: seconds the tap runs into the mug. */
  seconds: z.number().min(0.5).max(6).optional(),
}).strict();
export type CupParams = z.infer<typeof cupParams>;
/** `cupYaw`: the mug's engine yaw at the start; `spin`: the turn it is given on the palm over the first grip change, so its
 *  handle is neither under the palm nor toward the face (handleSpin). */
export type CupMotion = Omit<CupParams, 'actor'> & { hand: Hand; startTick: number; actionId?: string; abortedAt?: number; cupYaw: number; spin: number };

/** The mug (core-cup@2, local: y up, origin at the base centre): rim height and outer radius, the inside floor, the full
 *  tea height; where the palm sits on its side (up from the base, out from the axis: a hand's half thickness off it). */
export const MUG = { h: 0.1, r: 0.044, rIn: 0.04, floor: 0.014, full: 0.088, wrapUp: 0.05, wrapOut: 0.058 } as const;
/** The lips in the body frame of a 1.75 m body (engine only; viewers use the drawn head): 7 cm behind and 3.5 cm under
 *  the engine's mouth landmark (0.15 ahead at 1.58 m), as humans.ts measured for the spoon. */
export const ENGINE_LIPS = { fwd: 0.085, up: 1.545 } as const;
/** The chest hold between sips, from the lips (m): ahead, down, to the hand's side (the mug's base). */
export const CHEST_HOLD = { fwd: 0.2, down: 0.36, side: 0.05 } as const;
/** Timeline constants (s). */
export const C = {
  grip: 0.7, raise1: 1.4, tiltIn: 1.15, hold: 0.7, tiltOut: 0.9, lower: 1.1, pause: 1.8, raise: 1.1, toCarry: 1.2,
  washIn: 1.1, valveReach: 0.9, valveHold: 0.35, valveRelease: 0.7, run: 1.6, swirl: 1.4, tipIn: 1.2, tipHold: 0.8, tipOut: 0.9, washOut: 1.1,
  abortOut: 1.0,
} as const;
/** The rim's lean toward the lips while it comes up (rad), and the tip-out over the basin (rad, top forward). */
export const APPROACH_TILT = 10 * Math.PI / 180, TIP_OUT = 115 * Math.PI / 180;
/** The rinse: the swirl's radius (m) and turns. */
const SWIRL_R = 0.012, SWIRL_TURNS = 2;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const wrap = (a: number) => datan2(dsin(a), dcos(a));
const DEG = Math.PI / 180;
/** The turn (rad, engine yaw) a mug needs so its handle is clear of the palm and of the face: the handle's angle from the
 *  body's forward (+ toward the palm's side) must be within [−130°, 50°]; otherwise it goes to the nearer of 40° / −120°. */
export function handleSpin(cupYaw: number, bodyYaw: number, side: number) {
  const phi = wrap(side * (cupYaw - bodyYaw));
  if (phi >= -130 * DEG && phi <= 50 * DEG) return 0;
  const to = [40 * DEG, -120 * DEG].map((t) => wrap(t - phi)).sort((a, b) => Math.abs(a) - Math.abs(b))[0];
  return side * to;
}
/** The mug's yaw `s` seconds into a stage: turned on the palm over the first grip change, then kept. */
export const cupYawAt = (m: Pick<CupMotion, 'cupYaw' | 'spin'>, s: number) => m.cupYaw + m.spin * smooth(clamp01(s / C.grip));
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** The tilt (rad, top toward the face) a sip needs with `tea` (0..1) in the mug: the tea reaches the rim, plus a little. */
export function sipTilt(tea: number) {
  const h = MUG.floor + (MUG.full - MUG.floor) * clamp01(tea);
  return Math.max(25 * Math.PI / 180, Math.min(80 * Math.PI / 180, datan((MUG.h - h) / MUG.rIn) + 14 * Math.PI / 180));
}
/** The tea left after `k` sips of a drink. */
export const teaAfter = (m: Pick<CupMotion, 'from' | 'sip'>, k: number) => r3(Math.max(0, (m.from ?? 0) - k * (m.sip ?? 0)));

/** Where the mug is (pose keys the viewer and the engine resolve with their own landmarks) and how it is held. */
export type CupPoseKey = 'carry' | 'chest' | 'lips' | 'hold';
export type CupFrame = {
  /** blend from pose `a` to pose `b` by `k` (0..1); the mug's tilt (rad): + top toward the face, − top forward. */
  a: CupPoseKey; b: CupPoseKey; k: number; tilt: number;
  /** the hand on the mug: 0 = palm under the base (as carried), 1 = palm on its side. */
  grip: number;
  /** wash: the free hand's blend to the valve (0..1); the rinse's swirl offset (m, in the body frame: fwd, side). */
  left: number; swirl: [number, number];
  /** wash: the water in the mug (0..1 of a rinse), and the stream leaving its rim (0..1). */
  water: number; outflow: number;
  /** drink: the sip under way (0-based) and whether the mug is at the lips. */
  sip: number; atLips: boolean;
  /** stopped early: the pose above blends to the carry point by this much (0..1). */
  back?: number;
  done: boolean; end: number;
};
type Seg = { t0: number; t1: number; a: CupPoseKey; b: CupPoseKey; th0: number; th1: number; g0: number; g1: number; sip: number; lips: boolean };

/** drink: the segments, and the sip moments (the middle of each hold). */
function drinkPlan(m: CupMotion) {
  const n = m.sips ?? 1, segs: Seg[] = [], sips: number[] = []; let t = 0;
  const seg = (d: number, a: CupPoseKey, b: CupPoseKey, th0: number, th1: number, g0 = 1, g1 = 1, sip = 0, lips = false) => { segs.push({ t0: t, t1: t + d, a, b, th0, th1, g0, g1, sip, lips }); t += d; };
  seg(C.grip, 'carry', 'carry', 0, 0, 0, 1);
  for (let i = 0; i < n; i++) {
    const th = sipTilt((m.from ?? 0) - i * (m.sip ?? 0));
    if (i === 0) seg(C.raise1, 'carry', 'lips', 0, APPROACH_TILT); else seg(C.raise, 'chest', 'lips', 0, APPROACH_TILT, 1, 1, i);
    seg(C.tiltIn, 'lips', 'lips', APPROACH_TILT, th, 1, 1, i, true);
    sips.push(t + C.hold / 2);
    seg(C.hold, 'lips', 'lips', th, th, 1, 1, i, true);
    seg(C.tiltOut, 'lips', 'lips', th, APPROACH_TILT, 1, 1, i, true);
    seg(C.lower, 'lips', 'chest', APPROACH_TILT, 0, 1, 1, i);
    if (i < n - 1) seg(C.pause, 'chest', 'chest', 0, 0, 1, 1, i);
  }
  seg(C.toCarry, 'chest', 'carry', 0, 0, 1, 1, n - 1);
  seg(C.grip, 'carry', 'carry', 0, 0, 1, 0, n - 1);
  return { segs, sips, end: t };
}
/** wash: the timeline's moments (s). */
export function washTimes(m: Pick<CupMotion, 'seconds'>) {
  const on = C.grip + C.washIn + C.valveReach - 0.2, off = on + (m.seconds ?? C.run);
  const swirl0 = off + 0.2, tip0 = swirl0 + C.swirl + 0.1, tipped = tip0 + C.tipIn, up0 = tipped + C.tipHold, up1 = up0 + C.tipOut;
  const flow0 = tip0 + C.tipIn * 0.45, washed = tipped + C.tipHold * 0.75, out1 = up1 + C.washOut, end = out1 + C.grip;
  return { on, off, swirl0, tip0, tipped, up0, up1, flow0, washed, out1, end };
}
const valveBlend = (on: number, off: number, t: number) => {
  const rel1 = t - (on + C.valveHold), rel2 = t - (off + C.valveHold);
  if (t < on) return smooth((t - (on - C.valveReach)) / C.valveReach);
  const first = 1 - smooth(rel1 / C.valveRelease);
  if (t < off) return Math.max(first, smooth((t - (off - C.valveReach)) / C.valveReach));
  return 1 - smooth(rel2 / C.valveRelease);
};
function segFrame(segs: Seg[], s: number) {
  const x = segs.find((q) => s < q.t1) ?? segs[segs.length - 1], k = smooth(clamp01((s - x.t0) / Math.max(1e-6, x.t1 - x.t0)));
  return { x, k, tilt: x.th0 + (x.th1 - x.th0) * k, grip: x.g0 + (x.g1 - x.g0) * k };
}
const still = (key: CupPoseKey, tilt = 0, grip = 1) => ({ a: key, b: key, k: 1, tilt, grip });

/** The whole visible timeline of one stage at `s` seconds after its start. */
export function cupFrame(m: CupMotion, s: number): CupFrame {
  const none = { left: 0, swirl: [0, 0] as [number, number], water: 0, outflow: 0, sip: 0, atLips: false };
  if (m.stage === 'drink') {
    const p = drinkPlan(m);
    if (m.abortedAt !== undefined && m.abortedAt < p.end) {
      // stopped: no further sip; from where it was, the mug comes back to the carry point and the hand under it
      const a = segFrame(p.segs, m.abortedAt), u = s - m.abortedAt, back = smooth(clamp01(u / C.abortOut)), g = u < C.abortOut ? a.grip : a.grip * (1 - smooth(clamp01((u - C.abortOut) / C.grip)));
      const end = m.abortedAt + C.abortOut + C.grip;
      if (s < m.abortedAt) { const f = segFrame(p.segs, s); return { a: f.x.a, b: f.x.b, k: f.k, tilt: f.tilt, grip: f.grip, ...none, sip: f.x.sip, atLips: f.x.lips, done: false, end }; }
      return { a: a.x.a, b: a.x.b, k: a.k, tilt: a.tilt * (1 - back), grip: g, ...none, sip: a.x.sip, atLips: false, back, done: s >= end, end };
    }
    const f = segFrame(p.segs, s);
    return { a: f.x.a, b: f.x.b, k: f.k, tilt: f.tilt, grip: f.grip, ...none, sip: f.x.sip, atLips: f.x.lips && s < p.end, done: s >= p.end, end: p.end };
  }
  const w = washTimes(m), end = w.end;
  if (m.abortedAt !== undefined && m.abortedAt < w.on) {
    const a = m.abortedAt, f = cupFrame({ ...m, abortedAt: undefined }, a), u = s - a, back = smooth(clamp01(u / C.abortOut)), e = a + C.abortOut + C.grip;
    if (s < a) return { ...cupFrame({ ...m, abortedAt: undefined }, s), end: e };
    return { a: f.a, b: f.b, k: f.k, tilt: 0, grip: u < C.abortOut ? f.grip : f.grip * (1 - smooth(clamp01((u - C.abortOut) / C.grip))), left: f.left * (1 - back), swirl: [0, 0], water: 0, outflow: 0, sip: 0, atLips: false, back, done: s >= e, end: e };
  }
  const left = valveBlend(w.on, w.off, s);
  const water = s < w.on + 0.15 ? 0 : s < w.off ? 0.45 * clamp01((s - w.on - 0.15) / (w.off - w.on - 0.15)) : s < w.flow0 ? 0.45 : 0.45 * (1 - clamp01((s - w.flow0) / (w.washed - w.flow0)));
  const outflow = s < w.flow0 || s > w.washed + 0.25 ? 0 : Math.min(smooth((s - w.flow0) / 0.25), 1 - smooth((s - w.washed) / 0.25));
  const sw = s > w.swirl0 && s < w.swirl0 + C.swirl ? (() => { const u = (s - w.swirl0) / C.swirl, amp = SWIRL_R * dsin(Math.PI * u), ph = 2 * Math.PI * SWIRL_TURNS * u; return [amp * dsin(ph), amp * (1 - dcos(ph)) * 0.5] as [number, number]; })() : [0, 0] as [number, number];
  const base = { left, swirl: sw, water, outflow, sip: 0, atLips: false, done: s >= end, end };
  if (s < C.grip) return { ...still('carry', 0, smooth(s / C.grip)), ...base };
  if (s < C.grip + C.washIn) return { a: 'carry', b: 'hold', k: smooth((s - C.grip) / C.washIn), tilt: 0, grip: 1, ...base };
  if (s < w.tip0) return { ...still('hold'), ...base };
  if (s < w.up0) return { ...still('hold', -TIP_OUT * smooth((s - w.tip0) / C.tipIn)), ...base };
  if (s < w.up1) return { ...still('hold', -TIP_OUT * (1 - smooth((s - w.up0) / C.tipOut))), ...base };
  if (s < w.out1) return { a: 'hold', b: 'carry', k: smooth((s - w.up1) / C.washOut), tilt: 0, grip: 1, ...base };
  return { ...still('carry', 0, 1 - smooth((s - w.out1) / C.grip)), ...base };
}

export type CupEvent = { key: string; at: number; data: Record<string, unknown> };
/** The moments one stage changes the world, with their times (s), on the path the motion takes. */
export function cupEvents(m: CupMotion): CupEvent[] {
  if (m.stage === 'drink') {
    const p = drinkPlan(m), out: CupEvent[] = [];
    p.sips.forEach((at, i) => { if (m.abortedAt === undefined || at <= m.abortedAt) out.push({ key: 'sip-' + (i + 1), at, data: { tea: teaAfter(m, i + 1) } }); });
    return out;
  }
  const w = washTimes(m);
  if (m.abortedAt !== undefined && m.abortedAt < w.on) return [];
  return [{ key: 'valve-on', at: w.on, data: { on: true } }, { key: 'valve-off', at: w.off, data: { on: false } }, { key: 'washed', at: w.washed, data: {} }];
}
/** The tea in the mug `s` seconds into a drink: a pure function of the record and the time (the sips taken by then). */
export function drinkTea(m: CupMotion, s: number) { let k = 0; for (const e of cupEvents(m)) if (s >= e.at) k++; return teaAfter(m, k); }

/** Landmarks a pose is resolved with: the body frame (origin at the feet, forward, right, up = +y), the lips, the mug's base
 *  at the carry point (palm under it), the wash hold, the hand's side (+1 right, −1 left). All world, m. */
export type CupMarks = { o: Vec3; f: Vec3; r: Vec3; lips: Vec3; carry: Vec3; hold?: Vec3; side: number };
export type CupPose = { base: Vec3; axis: Vec3; side: Vec3; palm: Vec3; rimNear: Vec3 };
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const UP: Vec3 = [0, 1, 0];
/** The mug's base for a pose key at tilt `tilt` (the lips: its near rim touches them, at any tilt). */
function baseOf(key: CupPoseKey, tilt: number, L: CupMarks): Vec3 {
  if (key === 'carry') return L.carry;
  if (key === 'hold') return L.hold ?? L.carry;
  if (key === 'chest') return add(add(add(L.lips, L.f, CHEST_HOLD.fwd), UP, -CHEST_HOLD.down), L.r, L.side * CHEST_HOLD.side);
  // a = cos t · up − sin t · f (top toward the face); n = −cos t · f − sin t · up (toward the face, across the rim)
  const c = dcos(tilt), s = dsin(tilt), a: Vec3 = add([0, c, 0], L.f, -s), n: Vec3 = add([0, -s, 0], L.f, -c);
  const lip = add(L.lips, L.f, 0.012);
  return add(add(lip, a, -MUG.h), n, -MUG.r);
}
/** The mug's pose for a frame: its base, axis, the palm's side direction, the palm and the rim's point nearest the face. */
export function cupPose(f: Pick<CupFrame, 'a' | 'b' | 'k' | 'tilt' | 'grip' | 'swirl' | 'back'>, L: CupMarks): CupPose {
  const ba = baseOf(f.a, f.tilt, L), bb = baseOf(f.b, f.tilt, L), K = f.back ?? 0;
  let base: Vec3 = [ba[0] + (bb[0] - ba[0]) * f.k, ba[1] + (bb[1] - ba[1]) * f.k, ba[2] + (bb[2] - ba[2]) * f.k];
  if (K > 0) base = [base[0] + (L.carry[0] - base[0]) * K, base[1] + (L.carry[1] - base[1]) * K, base[2] + (L.carry[2] - base[2]) * K];
  base = add(add(base, L.f, f.swirl[0]), L.r, f.swirl[1]);
  const c = dcos(f.tilt), s = dsin(f.tilt), axis: Vec3 = add([0, c, 0], L.f, -s), side: Vec3 = [L.r[0] * L.side, L.r[1] * L.side, L.r[2] * L.side];
  // a tip-out turns about the palm's side: the base swings so the mug's middle stays where it was
  if (f.tilt < 0) { const mid = add(base, [0, 1, 0], MUG.h / 2); base = add(mid, axis, -MUG.h / 2); }
  // the palm: under the base (as carried) → out to its edge → up its side (two halves of the grip change)
  const g = clamp01(f.grip), out = smooth(clamp01(g * 2)) * MUG.wrapOut, up = smooth(clamp01(g * 2 - 1)) * MUG.wrapUp;
  const palm = add(add(base, side, out), axis, up);
  const n: Vec3 = add([0, -s, 0], L.f, -c), rimNear = add(add(base, axis, MUG.h), n, MUG.r);
  return { base, axis, side, palm, rimNear };
}
/** Engine landmarks from the body frame (the viewer has its own, from the drawn head). */
export function engineMarks(b: BodyFrame, hand: Hand, hold?: Vec3): CupMarks {
  const o = b.o, f: Vec3 = [b.f[0], 0, b.f[1]], r: Vec3 = [b.r[0], 0, b.r[1]];
  return { o, f, r, lips: at(b, ENGINE_LIPS.fwd, 0, ENGINE_LIPS.up), carry: carryHand(b, hand), hold, side: sideOf(hand) };
}

const issue = (code: string, message: string, subjects: string[]): Diagnostic => ({ code: 'cup.' + code, message, subjects });
type Exec = { p: CupParams; motion: CupMotion; t: number; yaw0: number; fired: Set<string> };
function clearBody(rt: Runtime, ex: Exec) {
  const h = rt.world.entities[ex.p.actor]?.human; if (!h) return;
  delete h.cupV1;
  if (h.hands && ex.p.stage === 'wash') delete h.hands[ex.motion.hand === 'right' ? 'left' : 'right'];
  if (h.activity === 'reach') h.activity = 'idle';
}
export const cupAction: ActionDef<CupParams, true, Exec> = {
  verb: 'cup_v1',
  description: 'With a mug held in one hand: drink from it in sips (raised to the lips, tilted, lowered to a chest hold between sips), or rinse it under a tap (the free hand turns the valve on and off, a swirl, tipped out over the basin). Finite, recorded timeline; the world changes at its marks.',
  schema: cupParams,
  reservations: (_w, p) => [`actor:${p.actor}`, `hand:${p.actor}:right`, `hand:${p.actor}:left`, `entity:${p.item}`, ...(p.target ? [`entity:${p.target}`] : [])].map((resource) => ({ resource, mode: 'exclusive' as const })),
  plan(rt, p) {
    const a = rt.world.entities[p.actor], it = rt.world.entities[p.item];
    if (!a?.human) return { ok: false, diagnostic: issue('actor', `${p.actor} is not a person`, [p.actor]) };
    if (it?.support?.kind !== 'in-hand' || it.support.by !== p.actor) return { ok: false, diagnostic: issue('not-held', `${p.actor} must hold ${p.item}`, [p.actor, p.item]) };
    if (p.stage === 'drink' && (!p.sips || p.from === undefined || !p.sip)) return { ok: false, diagnostic: issue('sips', 'A drink needs its sips', [p.item]) };
    if (p.stage === 'wash' && (!p.hold || !p.valve || !p.target || !rt.world.entities[p.target])) return { ok: false, diagnostic: issue('tap', 'Washing needs the tap, its valve and the hold under it', [p.item]) };
    if (p.hold && hypot(p.hold[0] - a.pose.p[0], p.hold[2] - a.pose.p[2]) > 1.1) return { ok: false, diagnostic: issue('too-far', `${p.actor} is not standing at the tap`, [p.actor]) };
    return { ok: true, program: true };
  },
  start(rt, p, _plan, id) {
    const a = rt.world.entities[p.actor], it = rt.world.entities[p.item];
    const { actor: _a, ...rest } = p;
    const hand = (it.support as { hand: Hand }).hand, face = p.face;
    return { p: structuredClone(p), motion: { ...structuredClone(rest), hand, startTick: rt.tick, actionId: id, cupYaw: it.pose.yaw, spin: handleSpin(it.pose.yaw, face, sideOf(hand)) }, t: 0, yaw0: a.pose.yaw, fired: new Set() };
  },
  step(rt, ex, dt): StepResult {
    const a = rt.world.entities[ex.p.actor], h = a?.human, it = rt.world.entities[ex.p.item];
    if (!h || !it) return { status: 'failed', diagnostic: issue('gone', 'The body or the mug is gone', [ex.p.actor, ex.p.item]) };
    if (it.support?.kind !== 'in-hand' || it.support.by !== ex.p.actor) { clearBody(rt, ex); return { status: 'failed', diagnostic: issue('dropped', `${ex.p.item} left ${ex.p.actor}'s hand`, [ex.p.item]) }; }
    ex.t += dt;
    const m = ex.motion, s = ex.t, f = cupFrame(m, s);
    const turn = ((ex.p.face - ex.yaw0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    a.pose.yaw = ex.yaw0 + turn * smooth(s / 0.4);
    for (const e of cupEvents(m)) if (s >= e.at && !ex.fired.has(e.key)) { ex.fired.add(e.key); rt.mark('cup.' + e.key, { actor: ex.p.actor, item: ex.p.item, target: ex.p.target, actionId: m.actionId, ...e.data }); }
    const q = cupPose(f, engineMarks(bodyFrame(a), m.hand, ex.p.hold));
    h.hands = { ...(h.hands ?? {}), [m.hand]: [...q.palm] };
    // the mug's native pose: its base where the frame puts it (the engine has no tilt; viewers draw it)
    const yaw = cupYawAt(m, s);
    followHand(it, q.base, yaw);
    // the mug keeps the turn it was given relative to the hand that holds it (hold_items reads support.turn)
    (it.support as { turn?: number }).turn = wrap(yaw - a.pose.yaw);
    const other = m.hand === 'right' ? 'left' : 'right';
    if (ex.p.valve && f.left > 1e-4) h.hands[other] = [...ex.p.valve]; else if (ex.p.stage === 'wash') delete h.hands[other];
    h.activity = 'reach';
    h.cupV1 = m;
    if (f.done) { clearBody(rt, ex); h.hands = { ...(h.hands ?? {}), [m.hand]: [...carryHand(bodyFrame(a), m.hand)] }; return { status: 'completed', outputs: { stage: m.stage } }; }
    return { status: 'running', phase: m.stage === 'drink' ? (f.atLips ? 'sipping' : 'holding') : s < washTimes(m).on ? 'reaching' : s < washTimes(m).off ? 'rinsing' : 'tipping' };
  },
  cancel(rt, ex) {
    // A drink stops sipping and lowers the mug; a rinse before the tap ran comes back; a running tap is still turned off
    // and the rinse finishes (a few seconds). The body is free only once the mug is back at the carry point.
    const m = ex.motion;
    if (m.abortedAt === undefined && (m.stage === 'drink' || ex.t < washTimes(m).on)) { m.abortedAt = ex.t; ex.motion = { ...m }; }
    return { ok: true, deferred: true };
  },
  resumable: 'A cup stage is a few seconds of hand motion; a logical reload restarts it from the carry point.',
};
