// hand_up — materials go up by hand (owner feedback 2026-09-28 §5 + §6), Mars assembly model v1,
// approximate. The Martian way of making floors: a ground crew lifts a sheet / board to the level above
// and two people already up there, standing on the rack beams, take it and lay it; or the forklift
// raises it to deck height and the two up there take it off the forks.
//
// Phases (published as human.activity every tick, with per-tick hand points, so a renderer can pose):
//   givers    walk → crouch (0.6 s) → lift (0.6 s, stand with the load) → walk-load (to below the edge)
//             → reach_up (arms overhead; the load's underside ≤ their floor + 2.06 m, BODY_MODEL.overheadMax) [→ push it in over
//             the edge while it is within their reach] → hold → let go once the receivers have it;
//   receivers walk → climb-up (frame) → beam-walk to their station beside the load's path → wait
//             → reach_down (bend at the hips; hands ≤ 0.5 m below their feet, ≤ 0.5 m from their edge)
//             → take → stand_with_load (lift it to just above the members) → lay (feed it in hand over
//             hand, never walking with it on a beam) → set_down: `staged` in place on the structure,
//             ready for install_joist / install_plywood (aloft.ts: those then only fasten it).
// via 'forklift': the load is already presented on the forks beside the edge (forklift_present); the
// receivers take it from there (no givers).
//
// Reach rules are engine rules, checked at plan time and every tick (invariants.ts
// liftHandsInReach covers both ends): a geometry that does not allow a genuine hand-off is refused
// (`handup.too-high`: "…use the forklift"), never interpolated.
import { z } from 'zod';
import { add2, angleDelta, datan2, dist2, dot2, obbOverlap, rot2, scale2, sub2, pointInObb, type OBB2, type Vec2, type Vec3, hypot } from '../core/math.ts';
import type { ActionDef, ActionRecord, Diagnostic, StepResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Link, Obstacle } from '../spatial/types.ts';
import type { Entity, Pose, WorldState } from '../world/types.ts';
import { def } from '../world/catalog.ts';
import { isRail } from '../world/catalog-solar.ts';
import { clearanceAt } from '../spatial/grid.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import { checkStations, walkCrew, childrenState, type Children } from './children.ts';
import { crewCheck, distToObb, f2, fail, lerpPose, smooth, spatialOf, STAGE_RADIUS, sweepPoses, sweptLiftPath, symmetricYaw, type Fail, type Hit } from './access.ts';
import { flatObb, isJoist, isPlywood, memberTop, sheetSupports } from './deck.ts';
import { isBeam } from './rules.ts';
import { beamWalkways, climbLinks, offWalkway, onWalkway, walkwayAtExit } from './frame.ts';
import { deckAt, deckOver } from './framemove.ts';
import { BODY_MODEL, postureGap, postureTop, proneAt, proneFrame, pronePoints, proneReachGap, restHands, sideOf, type Hand, type Posture, type ProneFrame } from '../body/model.ts';

// ---- rules (metres, seconds) ----
// reach rules: engine/body/model.ts (BODY_MODEL.md)
export const GIVE_MAX = BODY_MODEL.overheadMax; // givers' hands (the load's underside) never above their floor + this (2.06)
export const REACH_DOWN = BODY_MODEL.reachDownBelowFeet; // receivers' hands at most this far below their feet
export const EDGE_REACH = BODY_MODEL.edgeReach; // at the hand-off, a receiver's hands within this of the edge they stand on
/** … and they kneel at that edge: hands ≤ EDGE_REACH + KNEEL_BACK (= maxHorizontalFromFeet, 0.8 m) horizontally from their feet. */
export const KNEEL_BACK = BODY_MODEL.maxHorizontalFromFeet - BODY_MODEL.edgeReach;
export const EDGE_GAP = 0.08; // a load raised outside the edge clears the edge beam's face by this
export const SLIDE_CLEAR = 0.05; // the load is fed in this far above the members it will rest on
export const CARRY_Y = BODY_MODEL.restHand.up; // underside while the givers walk with it: hands hanging (0.72 m = shoulders 1.34 − arm 0.62; was 0.80, before that 0.75)
export const GIVER_OFF = 0.3; // givers stand this far beyond the load's outer end / edge
/** A one-end (lever) giver stands beside the end instead, the load passing their hip: this far to its side
 *  (body radius + 3 cm), level with the outer hand — so the inner hand is ≤ 0.47 m from the feet (a 0.62 m arm). */
export const LEVER_SIDE = HUMAN_PROFILE.radius + 0.03;
export const HAND_SPREAD = 0.15; // each hand this far either side of a grip point, along the gripped edge
export const BODY_GAP = HUMAN_PROFILE.radius + 0.02; // a load in someone's body band stays this far from them
export const RECEIVER_SEP = 0.6; // m between receivers
export const T = { crouch: 0.6, lift: 0.6, reachDown: 0.6, take: 0.4, stand: 0.4, setDown: 0.5, lieDown: 0.8, pushUp: 0.8, kneelUp: 0.6 } as const;
export const SPEED = { carry: 0.6, raise: 0.5, slide: 0.4 } as const;
export const FORK_LIFT_OFF = 0.03; // receivers lift the load this far off the forks before feeding it in
export const STEP = 0.05; // m: sampling of every planned motion
// long-load balance (owner feedback §5/§6 follow-up): one person holding a board / beam by one end
export const LEVER = 0.4; // m between the two hands of a one-end grip (outer hand at the end, inner hand toward the middle)
export const FREE_END_MAX = 1.5; // m: a load held by one end whose free end is farther than this from the grip is refused
const isLong = (e: Entity) => def(e.def).category === 'timber' || def(e.def).category === 'rack-beam';

// ---- body envelope: where hands can be for a posture (feet-relative shoulder cylinder + arm) ----
export const ARM_LEN = BODY_MODEL.armLength; // shoulder → hand centre
export const ENVELOPE_TOL = 0.1; // per-tick tolerance (the test's "within 0.1 m of the envelope")
export type { Posture };
const PZ = BODY_MODEL.posture;
export const POSTURE: Record<string, Posture> = {
  crouch: PZ.crouch,
  lift: PZ.crouch,
  'walk-load': PZ.upright,
  reach_up: PZ.upright,
  // bending at the hips / kneeling at the edge and leaning out over it
  reach_down: PZ.bentOver,
  take: PZ.bentOver,
  stand_with_load: PZ.bentOver,
  lay: PZ.bentOver,
  set_down: PZ.bentOver,
  // prone receiver (owner feedback §13): lying at the deck edge, then the rise (body/model.ts BODY_MODEL.prone)
  'prone-wait': BODY_MODEL.prone.posture.prone,
  'prone-reach': BODY_MODEL.prone.posture.prone,
  'push-up': BODY_MODEL.prone.posture.pushUp,
  'kneel-up': BODY_MODEL.prone.posture.kneelUp,
};
// ---- prone receiver (owner feedback §13; HANDUP.md "Prone receiver") ----
/** Receivers' hands at most this far below the deck they lie on (BODY_MODEL.prone.reachDown, 0.73: the measured rig). */
export const REACH_DOWN_PRONE = BODY_MODEL.prone.reachDown;
/** … and at the hand-off at most this far beyond the deck's outline (0.45). */
export const PRONE_EDGE_REACH = BODY_MODEL.prone.edgeReach;
/** A prone receiver's station S (their pose.p) is this far behind the deck lip, facing out over it. */
export const PRONE_BACK = BODY_MODEL.prone.back;
/** Standing receivers' hands go no lower than this above their feet (upright band bottom − arm: 0.60). */
export const STAND_REACH = PZ.upright.lo - BODY_MODEL.armLength;
/** Activities a prone receiver publishes, in order (then stand_with_load, lay, set_down as a kneeling one). */
export const PRONE_ACTIVITY = { lieDown: 'lie-down', wait: 'prone-wait', reach: 'prone-reach', pushUp: 'push-up', kneelUp: 'kneel-up' } as const;
/** The free hand reaches the deck by this fraction of push_up (then pushes); it goes back to the load over kneel_up. */
export const PUSH_HAND_K = 0.7;
export const HANDUP_SLOT_PREFIX = 'handup-';

/** How far a hand is outside the reach envelope of a person in `activity` standing at `feet` (≤ 0 = inside). */
export function envelopeGap(activity: string, feet: Vec3, hand: Vec3): number {
  return postureGap(POSTURE[activity] ?? POSTURE.reach_up, feet, hand);
}

// ---- geometry ----
const xz = (e: Entity): Vec2 => [e.pose.p[0], e.pose.p[2]];
const size = (e: Entity) => def(e.def).size;
const pose = (p: Vec2, y: number, yaw: number): Pose => ({ p: [p[0], y, p[1]], yaw });
const at = (q: Pose): Vec2 => [q.p[0], q.p[2]];

/** Nearest point of rectangle o to p, and the unit tangent of the edge it lies on. */
export function nearestOnRect(o: OBB2, p: Vec2): { q: Vec2; t: Vec2 } {
  const l = rot2(sub2(p, o.c), -o.yaw);
  const cx = Math.max(-o.half[0], Math.min(o.half[0], l[0])), cz = Math.max(-o.half[1], Math.min(o.half[1], l[1]));
  // which edge: the clamped coordinate that is at its limit with the larger overshoot
  const ox = Math.abs(l[0]) - o.half[0], oz = Math.abs(l[1]) - o.half[1];
  const tl: Vec2 = ox >= oz ? [0, 1] : [1, 0];
  return { q: add2(o.c, rot2([cx, cz], o.yaw)), t: rot2(tl, o.yaw) };
}
const clampInRect = (o: OBB2, p: Vec2): Vec2 => nearestOnRect(o, p).q;
const distRect = (o: OBB2, p: Vec2) => dist2(nearestOnRect(o, p).q, p);

/** Two hands either side of grip point g along tangent t (kept on the part), ordered [left, right] for someone at `from`. */
function handPair(o: OBB2, g: Vec2, t: Vec2, y: number, from: Vec2): [Vec3, Vec3] {
  return orderLR(clampInRect(o, add2(g, scale2(t, HAND_SPREAD))), clampInRect(o, sub2(g, scale2(t, HAND_SPREAD))), g, y, from);
}
/** One-end (lever) grip: one hand at grip point g, the other LEVER farther along `inward` (toward the middle). */
function leverPair(o: OBB2, g: Vec2, inward: Vec2, y: number, from: Vec2): [Vec3, Vec3] {
  const a = clampInRect(o, g), b = clampInRect(o, add2(g, scale2(inward, LEVER)));
  return orderLR(a, b, scale2(add2(a, b), 0.5), y, from);
}
function orderLR(a: Vec2, b: Vec2, g: Vec2, y: number, from: Vec2): [Vec3, Vec3] {
  const f = sub2(g, from);
  const left: Vec2 = [f[1], -f[0]]; // left of the facing direction (Y up)
  const [l, r] = dot2(sub2(a, b), left) >= 0 ? [a, b] : [b, a];
  return [[l[0], y, l[1]], [r[0], y, r[1]]];
}

/** Publish a person's hand points for this tick (the shared `human.hands` schema, world frame). */
export function setHands(h: Entity, hands: [Vec3, Vec3] | undefined) {
  if (!h.human) return;
  if (hands) h.human.hands = { left: [...hands[0]] as Vec3, right: [...hands[1]] as Vec3 };
  else delete h.human.hands;
}
export const handsOf = (h: Entity): [Vec3, Vec3] | undefined => (h.human?.hands?.left && h.human.hands.right ? [h.human.hands.left, h.human.hands.right] : undefined);

// ---- the part's rest ----
type Rest = { y: number; supports: string[] };
function restOn(w: WorldState, e: Entity, o: OBB2): Rest | Fail {
  if (isPlywood(e)) {
    const s = sheetSupports(w, e, o);
    if (!s.ok) return s;
    return { y: s.y, supports: s.supports };
  }
  const ms = Object.values(w.entities)
    .filter((m) => (isJoist(m) || isBeam(m) || isRail(m.def)) && m.phase === 'installed' && m.id !== e.id)
    .filter((m) => overlap(o, flatObb(m.pose, m)))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  if (ms.length < 2) return fail('handup.no-support', `${e.id} at (${f2(o.c[0])}, ${f2(o.c[1])}) would not rest on two installed members (${ms.map((m) => m.id).join(', ') || 'none'} under it)`, [e.id, ...ms.map((m) => m.id)]);
  const y = Math.max(...ms.map(memberTop));
  const sup = ms.filter((m) => memberTop(m) >= y - 0.01);
  if (sup.length < 2) return fail('handup.no-support', `${e.id} would rest on ${sup[0].id} alone at ${f2(y)} m`, [e.id, sup[0].id]);
  return { y, supports: sup.map((m) => m.id) };
}
function overlap(a: OBB2, b: OBB2) {
  // separating axis on the four rectangle axes
  const ax = [rot2([1, 0], a.yaw), rot2([0, 1], a.yaw), rot2([1, 0], b.yaw), rot2([0, 1], b.yaw)];
  const proj = (o: OBB2, n: Vec2) => {
    const u = rot2([1, 0], o.yaw), v = rot2([0, 1], o.yaw);
    const r = o.half[0] * Math.abs(dot2(u, n)) + o.half[1] * Math.abs(dot2(v, n));
    const c = dot2(o.c, n);
    return [c - r, c + r];
  };
  return ax.every((n) => { const [a0, a1] = proj(a, n), [b0, b1] = proj(b, n); return a1 > b0 + 0.005 && b1 > a0 + 0.005; });
}

// ---- params / program ----
type HP = {
  part: string;
  givers?: string[];
  receivers: string[];
  to: { x: number; z: number; yaw: number };
  edge?: string;
  via?: 'hand' | 'forklift';
  operator?: string;
  stations?: { x: number; z: number }[];
};

/** A receiver's station; `prone` only for a receiver lying at a deck edge (§13): feet = S (PRONE_BACK behind the lip,
 *  facing `out`), `hold` = the hand that keeps the load through the rise, `deckObb` = the deck they lie on, `frame` = the
 *  lying body (its axis through the grip: `frame.f`, world yaw `frame.yaw` = `human.proneYaw`), `tip` = how far (°) the
 *  torso tips over the lip to reach the grip. */
type Station = { actor: string; feet: Vec3; walkway: string | null; deck: number | null; prone?: ProneStation };
type ProneStation = { out: Vec2; hold: Hand; deckObb: OBB2; frame: ProneFrame; tip: number };
type Chain = { verb: string; params: Record<string, unknown> }[];
type Seg = { phase: string; from: Pose; to: Pose; dur: number };
export type HandupProgram = {
  mode: 'hand' | 'forklift';
  yaw: number;
  rest: Rest;
  edge: string; // walkway link id
  nOut: Vec2;
  /** Local grip points (part frame, x/z) and the local outward direction for each giver. */
  giverGrips: { g: Vec2; out: Vec2; tan: Vec2; lever?: true }[];
  pickup: { actor: string; p: Vec2; yaw: number }[];
  giverSegs: Seg[]; // crouch, lift, walk-load, reach_up, [push]
  receiverSegs: Seg[]; // reach_down, take, stand_with_load, lay, set_down
  stations: Station[];
  chains: Chain[];
  /** Receiver index that climbs first when both use one frame (-1: independent). */
  lead: number;
  transfer: Pose;
  final: Pose;
  vehicle?: string;
};

// ---- planning ----
const bad = (code: string, message: string, subjects: string[], at?: Vec3): Fail => fail(code, message, subjects, at);

function localOut(nLoc: Vec2, lx: number, lz: number, n: number): { g: Vec2; out: Vec2; tan: Vec2 }[] {
  if (Math.abs(nLoc[0]) >= Math.abs(nLoc[1])) {
    const sx = nLoc[0] >= 0 ? 1 : -1;
    const x = sx * 0.45 * lx;
    const zs = n === 1 ? [0] : lz >= 0.6 ? [-0.4 * lz, 0.4 * lz] : [0, 0];
    return zs.map((zz) => ({ g: [x, zz] as Vec2, out: [sx, 0] as Vec2, tan: [0, 1] as Vec2 }));
  }
  const sz = nLoc[1] >= 0 ? 1 : -1;
  const xs = n === 1 ? [0] : [-0.35 * lx, 0.35 * lx];
  return xs.map((xx) => ({ g: [xx, (sz * lz) / 2] as Vec2, out: [0, sz] as Vec2, tan: [1, 0] as Vec2 }));
}
const world = (q: Pose, l: Vec2): Vec2 => add2(at(q), rot2(l, q.yaw));
const dirW = (q: Pose, l: Vec2): Vec2 => rot2(l, q.yaw);

/** Givers' feet for grip i at part pose q (standing GIVER_OFF beyond the grip, on floor y). */
function giverFeet(prog: Pick<HandupProgram, 'giverGrips'>, i: number, q: Pose, y: number): Vec3 {
  const gg = prog.giverGrips[i];
  const p = add2(world(q, gg.g), giverOffset(q, gg));
  return [p[0], y, p[1]];
}
/** World offset grip → giver's feet: GIVER_OFF beyond the grip, or (lever grip) LEVER_SIDE beside it. */
function giverOffset(q: Pose, gg: { out: Vec2; lever?: true }): Vec2 {
  return gg.lever ? scale2(dirW(q, [-gg.out[1], gg.out[0]]), LEVER_SIDE) : scale2(dirW(q, gg.out), GIVER_OFF);
}
function giverHands(e: Entity, prog: Pick<HandupProgram, 'giverGrips'>, i: number, q: Pose, feet: Vec3): [Vec3, Vec3] {
  const gg = prog.giverGrips[i];
  if (gg.lever) return leverPair(flatObb(q, e), world(q, gg.g), dirW(q, scale2(gg.out, -1)), q.p[1], [feet[0], feet[2]]);
  return handPair(flatObb(q, e), world(q, gg.g), dirW(q, gg.tan), q.p[1], [feet[0], feet[2]]);
}
function receiverHands(e: Entity, q: Pose, feet: Vec3): [Vec3, Vec3] {
  const o = flatObb(q, e);
  const n = nearestOnRect(o, [feet[0], feet[2]]);
  return handPair(o, n.q, n.t, q.p[1] + size(e)[1], [feet[0], feet[2]]);
}

/**
 * Grip slot of a hand-up holder. Givers: `handup-give-<i>:<lx>:<lz>:<x|z>` = the grip point in the
 * part's local frame (x, z; on its underside) and the local axis the two hands spread along.
 * Receivers: `handup-take-<i>` = the part's top face, at its point nearest the receiver. Prone receivers (§13):
 * `handup-prone-<i>:<left|right>` = the same grip; the named hand never lets go during the rise (the other pushes
 * off the deck), so while `push-up` / `kneel-up` the free hand is only in `human.hands` (handupHands gives the grip).
 */
export function giverSlot(i: number, g: { g: Vec2; tan: Vec2; out?: Vec2; lever?: true }): string {
  if (g.lever) return `${HANDUP_SLOT_PREFIX}give-${i}:${g.g[0].toFixed(3)}:${g.g[1].toFixed(3)}:${Math.abs(g.out![0]) > 0.5 ? 'x' : 'z'}:lever`;
  return `${HANDUP_SLOT_PREFIX}give-${i}:${g.g[0].toFixed(3)}:${g.g[1].toFixed(3)}:${Math.abs(g.tan[0]) > 0.5 ? 'x' : 'z'}`;
}

/**
 * Both hand points [left, right] (world, m) of `holder` gripping `part` at pose `q` with a hand-up slot:
 * a pure function of the part pose, the holder's position and the slot, so a renderer can rebuild them
 * from a take (poses + grip) exactly as the engine publishes them in human.hands. null = not a hand-up slot.
 */
export function handupHands(part: Entity, q: Pose, holder: Entity, slot: string): [Vec3, Vec3] | null {
  const feet = holder.pose.p;
  if (/^handup-take-\d+$/.test(slot) || /^handup-prone-\d+:(left|right)$/.test(slot)) return receiverHands(part, q, feet);
  const m = /^handup-give-\d+:(-?[\d.]+):(-?[\d.]+):([xz])(:lever)?$/.exec(slot);
  if (!m) return null;
  const g: Vec2 = [Number(m[1]), Number(m[2])];
  if (m[4]) {
    // lever grip along axis m[3]: the second hand LEVER toward the part's middle
    const inward: Vec2 = m[3] === 'x' ? [g[0] > 0 ? -1 : 1, 0] : [0, g[1] > 0 ? -1 : 1];
    return leverPair(flatObb(q, part), world(q, g), dirW(q, inward), q.p[1], [feet[0], feet[2]]);
  }
  const tan: Vec2 = m[3] === 'x' ? [1, 0] : [0, 1];
  return handPair(flatObb(q, part), world(q, g), dirW(q, tan), q.p[1], [feet[0], feet[2]]);
}

/** Sample a pose segment every STEP m of the farthest point's motion. */
function samples(e: Entity, a: Pose, b: Pose): Pose[] {
  const ext = hypot(size(e)[0], size(e)[2]) / 2;
  const d = hypot(b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]) + ext * Math.abs(angleDelta(a.yaw, b.yaw));
  const n = Math.max(1, Math.ceil(d / STEP));
  return Array.from({ length: n + 1 }, (_, k) => lerpPose(a, b, k / n));
}
const segDur = (e: Entity, a: Pose, b: Pose, speed: number) => {
  const ext = hypot(size(e)[0], size(e)[2]) / 2;
  const d = hypot(b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]) + ext * Math.abs(angleDelta(a.yaw, b.yaw));
  return Math.max(0.2, d / speed);
};

type Cand = { feet: Vec3; walkway: string | null; deck: number | null; deckObb?: OBB2; first: number; edge: boolean; key: number; miss?: number };

export function planHandup(rt: Runtime, p: HP): { ok: true; program: HandupProgram } | Fail {
  const w = rt.world;
  const e = w.entities[p.part];
  if (!e || e.kind !== 'component' || !def(e.def).handling) return bad('handup.not-part', `${p.part} is not a component that can be handed up`, [p.part]);
  const mode = p.via ?? 'hand';
  const givers = p.givers ?? [];
  const hd = def(e.def).handling!;
  if (e.phase === 'installed') return bad('handup.installed', `${e.id} is already installed`, [e.id]);
  // ---- crew
  const everyone = [...givers, ...p.receivers];
  const cc = crewCheck(rt, everyone, 1, 4, `handing up ${e.id}`);
  if (cc) return cc;
  if (p.receivers.length < 1 || p.receivers.length > 2) return bad('crew.size', `a hand-up needs 1–2 receivers up top; ${p.receivers.length} assigned`, p.receivers);
  if (p.receivers.length < hd.carryCrew[0]) return bad('crew.size', `${def(e.def).label} ${e.id} needs ≥ ${hd.carryCrew[0]} receivers`, p.receivers);
  let vehicle: string | undefined;
  if (mode === 'hand') {
    if (givers.length < hd.carryCrew[0] || givers.length > Math.min(2, hd.carryCrew[1]))
      return bad('crew.size', `${def(e.def).label} ${e.id} is handed up by ${hd.carryCrew[0]}–${Math.min(2, hd.carryCrew[1])} givers on the ground; ${givers.length} assigned`, givers);
    for (const g of givers) {
      const h = w.entities[g];
      if (h.human!.on)
        return bad('handup.giver-aloft', `giver ${g} stands on ${h.human!.on}; givers work from a floor — nobody walks a beam with ${e.id} (${def(e.def).label}, ${def(e.def).massKg} kg): only small loads (≤ 10 kg) are carried on a beam`, [g, e.id, ...(h.human!.on.startsWith('beam:') ? [h.human!.on.slice(5)] : [])], h.pose.p);
    }
    if (!(e.phase === 'staged' || e.phase === 'stored') || e.support?.kind !== 'ground')
      return bad('handup.not-staged', `${e.id} must lie on the ground near the edge (it is ${e.phase ?? 'unplaced'}, support ${e.support?.kind ?? 'none'})`, [e.id]);
    for (const g of givers) if (w.entities[g].human!.level !== w.entities[givers[0]].human!.level) return bad('handup.giver-level', `the givers must stand on one floor`, givers);
  } else {
    if (givers.length) return bad('crew.size', `a forklift hand-up has no givers (the forks lift it)`, givers);
    const op = p.operator ? w.entities[p.operator] : undefined;
    vehicle = op?.human?.riding;
    if (!op?.human || !vehicle || w.entities[vehicle]?.def !== 'forklift')
      return bad('forklift.no-operator', `hand_up via forklift needs \`operator\`: a person driving a forklift (${p.operator ?? 'none given'})`, [p.operator ?? p.part]);
    if (e.support?.kind !== 'forks' || e.support.vehicle !== vehicle)
      return bad('handup.not-on-forks', `${e.id} is not on the forks of ${vehicle} (forklift_pick, then forklift_present it beside the edge)`, [e.id, vehicle]);
    if (op.human.task) return bad('handup.forklift-busy', `${op.id} on ${vehicle} is still busy (${op.human.task}); present the load and stop first`, [op.id]);
  }
  if (p.edge && !beamWalkways(w).some((l) => l.id === `beam:${p.edge}`))
    return bad('handup.no-walkway', `beam ${p.edge} is not a walkable beam (it needs its partner beam at the same seat and a supported assembly); nobody can stand on it to receive ${e.id}`, [p.edge, e.id]);
  // ---- where it goes
  const yawH = symmetricYaw(e.pose.yaw, p.to.yaw);
  const obbF: OBB2 = { c: [p.to.x, p.to.z], half: [size(e)[0] / 2, size(e)[2] / 2], yaw: yawH };
  const rest = restOn(w, e, obbF);
  if ('ok' in rest) return rest as Fail;
  const final = pose([p.to.x, p.to.z], rest.y, yawH);
  const ySlide = rest.y + SLIDE_CLEAR;
  for (const o of Object.values(w.entities))
    if (o.id !== e.id && o.kind === 'component' && (isPlywood(o) || isJoist(o)) && o.phase !== 'carried' && Math.abs(o.pose.p[1] - rest.y) < 0.05 && overlap(obbF, flatObb(o.pose, o)))
      return bad('handup.occupied', `${o.id} already lies where ${e.id} would go`, [e.id, o.id]);
  // ---- the edge it comes over
  const walks = beamWalkways(w).filter((l) => l.from.y <= rest.y + 0.02 && l.from.y >= rest.y - 0.3);
  const src = xz(e);
  let edge: Link | undefined;
  if (p.edge) {
    edge = beamWalkways(w).find((l) => l.id === `beam:${p.edge}`)!;
  } else {
    const scored = walks
      .map((l) => ({ l, u: dot2(sub2(src, l.from.p), outward(l, obbF.c)) }))
      .filter((s) => s.u > 0)
      .sort((a, b) => a.u - b.u || (a.l.id < b.l.id ? -1 : 1));
    edge = scored[0]?.l;
    if (!edge)
      return bad('handup.no-walkway', `no walkable beam pair at ${f2(rest.y)} m faces ${e.id}'s side (walkways: ${beamWalkways(w).map((l) => `${l.id} @ ${f2(l.from.y)} m`).join(', ') || 'none'}); receivers need beams to stand on — install both beams of the pair`, [e.id]);
  }
  const nOut = outward(edge, obbF.c);
  const beamT = def(w.entities[edge.members![0]].def).size[2] / 2;
  const u = (q: Vec2) => dot2(sub2(q, edge!.from.p), nOut);
  const cornersF = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([a, b]) => add2(obbF.c, rot2([a * obbF.half[0], b * obbF.half[1]], obbF.yaw)));
  const uMin = Math.min(...cornersF.map(u));
  let sOut = Math.max(0, beamT + EDGE_GAP - uMin);
  let O = add2(obbF.c, scale2(nOut, sOut));
  const at_s = (s: number, y: number) => pose(sub2(O, scale2(nOut, s)), y, yawH);
  const edgeY = edge.from.y;
  // ---- heights and the reach rule for a genuine hand-off
  const giverFloor = mode === 'hand' ? w.entities[givers[0]].pose.p[1] : 0;
  // the givers' grips (local to the part), and how high their hands go there: GIVE_MAX is a palm straight
  // overhead; hands out at the grips (GIVER_OFF ahead, HAND_SPREAD apart) reach a little less (body model
  // envelope, reach_up: ≈ 2.05 m with 1.34 m shoulders) — they raise it only that high
  const q3 = (v: Vec2): Vec2 => [Number(v[0].toFixed(3)), Number(v[1].toFixed(3))];
  const giverGrips: HandupProgram['giverGrips'] = mode === 'hand' ? localOut(rot2(nOut, -yawH), size(e)[0], size(e)[2], givers.length).map((g) => ({ ...g, g: q3(g.g) })) : [];
  if (mode === 'hand' && givers.length === 1 && isLong(e)) {
    const b = balance(e, giverGrips[0]);
    if (b.lever) giverGrips[0].lever = true;
    if (b.free > FREE_END_MAX + 1e-9)
      return bad('handup.unbalanced', `${def(e.def).label} ${e.id} (${f2(size(e)[0])} m) cannot be handed up by ${givers[0]} alone holding it by one end: its free end would be ${f2(b.free)} m from the grip (max ${FREE_END_MAX} m); hand it up side-on or with two givers`, [e.id, givers[0]], e.pose.p);
  }
  let gMax = giverFloor + GIVE_MAX;
  if (mode === 'hand') {
    const q = at_s(0, gMax);
    for (const [i] of givers.entries()) {
      const f = giverFeet({ giverGrips }, i, q, giverFloor);
      for (const hh of giverHands(e, { giverGrips }, i, q, f)) {
        const top = postureTop(POSTURE.reach_up, dist2([hh[0], hh[2]], [f[0], f[2]]));
        if (top > -Infinity) gMax = Math.min(gMax, giverFloor + top); // out of reach at any height: handup.giver-reach below
      }
    }
  }
  const th = size(e)[1];
  let transfer: Pose, lift0: Pose; // lift0: the pose the receivers first take it at
  let direct = false;
  let prone: ProneDeck | null = null; // set when kneeling cannot reach and receivers lie at a deck edge (§13)
  let riseHit: Hit | null = null; // the outermost thing the prone rise corridor had to clear
  if (mode === 'hand') {
    direct = ySlide <= gMax + 1e-9;
    const hT = direct ? ySlide : gMax;
    const handY = hT + th;
    // stand → kneel → prone (§13): kneeling reaches REACH_DOWN below the beam; lying on a deck over the edge, REACH_DOWN_PRONE below the deck
    if (edgeY - handY > REACH_DOWN + 1e-9) {
      prone = proneDeck(rt, edge);
      if (!prone || prone.y - handY > REACH_DOWN_PRONE + 1e-9)
        return bad('handup.too-high', `${e.id} cannot be handed up to people on ${edge.members![0]} at ${f2(edgeY)} m: the givers can raise it to ${f2(hT)} m (their floor + ${f2(hT - giverFloor)} m: hands out at the grips; ${GIVE_MAX} m straight overhead), so the receivers would have to reach ${f2(edgeY - handY)} m below their feet (${reachList(prone, handY, edge)}); use the forklift (hand_up via: 'forklift')`, [e.id, edge.members![0], ...givers, ...p.receivers], [O[0], hT, O[1]]);
    }
    // raised straight up outside the edge, clear of whatever sticks out past the beam (joist cantilevers …); unless the
    // givers raise it to slide height themselves, the receivers (kneeling or prone) then lift it straight up from the
    // hand-off to slide height, so that corridor must be clear too — of everything, the members it will rest on
    // included (their ends stick out past the edge beam; W30: the kneeling rise used to ignore them)
    for (let extra = 0; ; extra += STEP) {
      const Ox = add2(obbF.c, scale2(nOut, sOut + extra));
      const hit = sweepPoses(rt, e, [pose(Ox, giverFloor + CARRY_Y, yawH), pose(Ox, hT, yawH)], []);
      const hitR = !hit && !direct ? sweepPoses(rt, e, [pose(Ox, hT, yawH), pose(Ox, ySlide, yawH)], []) : null;
      if (!hit && !hitR) { sOut += extra; break; }
      if (hitR) riseHit = hitR;
      if (extra >= 1.0 - 1e-9) {
        if (hit) return bad('handup.path-blocked', `${e.id} cannot be raised beside ${edge.members![0]}: ${hit.o.label ?? hit.o.id} is in the way up to 1 m out from the edge`, [e.id, hit.o.id], hit.q.p);
        return riseBlocked(e, edge, hitR!, p.receivers, 'up to 1 m out from the edge', !prone);
      }
    }
    O = add2(obbF.c, scale2(nOut, sOut));
    transfer = at_s(0, hT);
    lift0 = transfer;
  } else {
    const fp = e.pose;
    const dy = Math.abs(angleDelta(fp.yaw, yawH));
    if (dy > 0.02 && Math.abs(dy - Math.PI) > 0.02)
      return bad('handup.forklift-orientation', `${e.id} sits on the forks at yaw ${f2(fp.yaw)} but goes in at ${f2(yawH)}: the receivers feed it straight in, they do not turn a sheet over the bay; present it parallel to where it goes`, [e.id]);
    transfer = { p: [...fp.p] as Vec3, yaw: yawH };
    lift0 = transfer;
    if (edgeY - (fp.p[1] + th) > REACH_DOWN + 1e-9) {
      prone = proneDeck(rt, edge);
      if (!prone || prone.y - (fp.p[1] + th) > REACH_DOWN_PRONE + 1e-9)
        return bad('handup.too-high', `${e.id} on the forks at ${f2(fp.p[1])} m is ${f2(edgeY - fp.p[1] - th)} m below the receivers' feet (${reachList(prone, fp.p[1] + th, edge)}); raise the forks`, [e.id], fp.p);
    }
    // the forks cannot move it out: its rise (prone: past the deck edge; kneeling: past the edge beam and the ends of
    // the members it will rest on) must be clear where it is
    const hitR = sweepPoses(rt, e, [transfer, { ...transfer, p: [transfer.p[0], Math.max(ySlide, transfer.p[1] + FORK_LIFT_OFF), transfer.p[2]] }], [vehicle!]);
    if (hitR) return riseBlocked(e, edge, hitR, p.receivers, 'where the forks hold it (present it clear of it)', !prone);
  }
  // ---- the part's path
  const giverSegs: Seg[] = [];
  const pickup: HandupProgram['pickup'] = [];
  const ignoreRest = [...rest.supports];
  let sT = 0;
  if (mode === 'hand') {
    const lying = e.pose;
    if (dist2(xz(e), O) > STAGE_RADIUS + 1e-9)
      return bad('handup.not-staged', `${e.id} lies ${f2(dist2(xz(e), O))} m from where it is lifted at the edge (${f2(O[0])}, ${f2(O[1])}); carry it within ${STAGE_RADIUS} m first`, [e.id]);
    // pickup: grip points at the lying pose (same local grips), givers GIVER_OFF beyond them
    const gl = localOut(rot2(nOut, -yawH), size(e)[0], size(e)[2], givers.length);
    for (const [i, g] of givers.entries()) {
      const gp = world(lying, gl[i].g), op = add2(gp, giverOffset(lying, { ...gl[i], ...(giverGrips[i]?.lever ? { lever: true as const } : {}) }));
      pickup.push({ actor: g, p: op, yaw: datan2(gp[1] - op[1], gp[0] - op[0]) });
    }
    const pk = checkStations(rt, pickup.map((m) => ({ actor: m.actor, p: m.p, level: w.entities[m.actor].human!.level })));
    if (pk) return { ok: false, diagnostic: { ...pk, code: 'handup.giver-unreachable' } };
    const up: Pose = { ...lying, p: [lying.p[0], giverFloor + CARRY_Y, lying.p[2]] };
    const carried = pose(O, giverFloor + CARRY_Y, yawH);
    const raised = at_s(0, transfer.p[1]);
    const first = sweptLiftPath(rt, e, lying, up, { ignore: [], liftOver: false, what: `${def(e.def).label} ${e.id}` });
    if (!first.ok) return first;
    const hit = sweepPoses(rt, e, [up, carried, raised], []);
    if (hit) return bad('handup.path-blocked', `${e.id} cannot be carried to the edge and raised: it would hit ${hit.o.label ?? hit.o.id} at (${f2(hit.q.p[0])}, ${f2(hit.q.p[1])}, ${f2(hit.q.p[2])})`, [e.id, hit.o.id], hit.q.p);
    giverSegs.push({ phase: 'crouch', from: lying, to: lying, dur: T.crouch });
    giverSegs.push({ phase: 'lift', from: lying, to: up, dur: T.lift });
    giverSegs.push({ phase: 'walk-load', from: up, to: carried, dur: segDur(e, up, carried, SPEED.carry) });
    giverSegs.push({ phase: 'reach_up', from: carried, to: raised, dur: segDur(e, carried, raised, SPEED.raise) });
    // givers must be able to stand where the grips put them, all along
    const g = spatialOf(rt).level(w.entities[givers[0]].human!.level);
    /** null = the givers can stand and reach; else what stops them (room, or hands outside the body model's envelope). */
    const unstandable = (q: Pose): { i: number; reach?: number } | null => {
      const fs = givers.map((_, i) => giverFeet({ giverGrips }, i, q, giverFloor));
      const k = fs.findIndex((f) => !g || clearanceAt(g, [f[0], f[2]]) < HUMAN_PROFILE.radius - 0.03);
      if (k >= 0) return { i: k };
      if (fs.length === 2 && dist2([fs[0][0], fs[0][2]], [fs[1][0], fs[1][2]]) < 2 * HUMAN_PROFILE.radius) return { i: 1 };
      for (const [i] of givers.entries()) {
        const gap = Math.max(...giverHands(e, { giverGrips }, i, q, fs[i]).map((hh) => envelopeGap('reach_up', fs[i], hh)));
        if (gap > 0) return { i, reach: gap };
      }
      return null;
    };
    const standable = (q: Pose) => unstandable(q) === null;
    for (const seg of giverSegs.slice(2))
      for (const q of samples(e, seg.from, seg.to)) {
        const u = unstandable(q);
        if (!u) continue;
        const f = giverFeet({ giverGrips }, u.i, q, giverFloor);
        if (u.reach !== undefined)
          return bad('handup.giver-reach', `${givers[u.i]} cannot hold ${e.id} ${giverGrips[u.i].lever ? 'by its end ' : ''}at ${f2(q.p[1] - giverFloor)} m above their floor standing at (${f2(f[0])}, ${f2(f[2])}) (${seg.phase}): a hand would be ${f2(u.reach)} m beyond their reach (arm ${ARM_LEN} m)`, [e.id, givers[u.i]], f);
        return bad('handup.giver-blocked', `the givers cannot walk ${e.id} to the edge: no room to stand at (${f2(f[0])}, ${f2(f[2])}) while holding it (${seg.phase})`, [e.id, ...givers], f);
      }
    // how far they can push it in over the edge (only when it already clears the members)
    let sMax = 0;
    if (direct) for (let s = STEP; s <= sOut + 1e-9; s += STEP) { if (!standable(at_s(s, ySlide))) break; sMax = s; }
    // ---- receivers
    const r = prone
      ? chooseProneStations(rt, e, p, edge, nOut, { at_s, sOut, ySlide, direct, sMax, rest, final, fixed: transfer }, riseHit, [])
      : chooseStations(rt, e, p, edge, { at_s, sOut, ySlide, direct, sMax, rest, final, ...(direct ? {} : { fixed: transfer }) });
    // kneeling: something sticking out past the edge pushed the rise corridor out of their reach: name it
    if ('ok' in r && !prone && riseHit && (r.diagnostic.code === 'handup.receiver-reach' || r.diagnostic.code === 'handup.no-receiver-station'))
      return riseBlocked(e, edge, riseHit, p.receivers, `close to the edge, and clear of it nobody kneeling on the beams reaches it (${r.diagnostic.message.replace(/^.*?: /, '')})`, true);
    if ('ok' in r) return r as Fail;
    sT = r.sT;
    transfer = at_s(sT, direct ? ySlide : transfer.p[1]);
    lift0 = transfer;
    if (sT > 0) giverSegs.push({ phase: 'push', from: raised, to: transfer, dur: segDur(e, raised, transfer, SPEED.slide) });
    const blocked = sweepPoses(rt, e, [raised, transfer], ignoreRest);
    if (blocked) return bad('handup.path-blocked', `${e.id} cannot be pushed in over ${edge.members![0]}: it would hit ${blocked.o.label ?? blocked.o.id}`, [e.id, blocked.o.id], blocked.q.p);
    return finishPlan(rt, e, p, mode, yawH, rest, edge, nOut, giverGrips, pickup, giverSegs, r.stations, lift0, transfer, final, ySlide, vehicle, (r as { mid?: Pose }).mid);
  }
  // forklift: receivers take it where the forks hold it
  const geo: Geo = { at_s, sOut, ySlide, direct: false, sMax: 0, rest, final, fixed: transfer };
  const r = prone ? chooseProneStations(rt, e, p, edge, nOut, geo, null, [vehicle!]) : chooseStations(rt, e, p, edge, geo);
  if ('ok' in r) return r as Fail;
  return finishPlan(rt, e, p, mode, yawH, rest, edge, nOut, giverGrips, pickup, giverSegs, r.stations, lift0, transfer, final, ySlide, vehicle, (r as { mid?: Pose }).mid);
}

/**
 * Balance of a long load held by one person at local grip g (the load's length is its local x): an end
 * grip (g beyond the middle along x) is a two-handed lever grip, and its free end is measured from the
 * inner hand; hands either side of the middle hold it balanced (free 0).
 */
export function balance(e: Entity, g: { g: Vec2; out: Vec2 }): { lever: boolean; free: number } {
  const lx = size(e)[0];
  if (Math.abs(g.out[0]) > 0.5) {
    const inner = Math.abs(g.g[0]) - LEVER; // |x| of the inner hand (toward the middle)
    return { lever: true, free: lx / 2 + inner };
  }
  const off = Math.abs(g.g[0]); // hands at g ± HAND_SPREAD along x: the middle between them = balanced
  return { lever: false, free: off <= HAND_SPREAD ? 0 : lx / 2 + off - HAND_SPREAD };
}

/** Unit horizontal normal of walkway l pointing away from point c (the part's final centre). */
function outward(l: Link, c: Vec2): Vec2 {
  const d = sub2(l.to.p, l.from.p);
  const len = hypot(d[0], d[1]) || 1;
  const n: Vec2 = [-d[1] / len, d[0] / len];
  return dot2(sub2(c, l.from.p), n) > 0 ? [-n[0], -n[1]] : n;
}

/** How far hand h is horizontally beyond the edge a receiver at candidate c kneels at (≤ 0: over it). */
function edgeOut(all: Link[], c: Cand, h: Vec3): number {
  const q: Vec2 = [h[0], h[2]];
  if (c.walkway) { const l = all.find((x) => x.id === c.walkway)!; return offWalkway(l, q) - l.width / 2; }
  if (c.deckObb) return dist2(nearestOnRect(c.deckObb, q).q, q);
  return 0;
}

type Geo = { at_s: (s: number, y: number) => Pose; sOut: number; ySlide: number; direct: boolean; sMax: number; rest: Rest; final: Pose; fixed?: Pose };

/** The receivers' part of the path from a transfer pose: [take pose, raised, slid in, set down]. */
function receiverPath(e: Entity, g: Geo, tr: Pose): Pose[] {
  const up = tr.p[1] < g.ySlide ? { ...tr, p: [tr.p[0], g.ySlide, tr.p[2]] as Vec3 } : tr;
  const slid = { ...g.final, p: [g.final.p[0], up.p[1], g.final.p[2]] as Vec3 };
  return [tr, up, slid, g.final];
}

function chooseStations(rt: Runtime, e: Entity, p: HP, edge: Link, g: Geo): { stations: Station[]; sT: number } | Fail {
  const w = rt.world;
  const th = size(e)[1];
  const all = beamWalkways(w).filter((l) => Math.abs(l.from.y - edge.from.y) <= 0.02);
  // candidate feet: explicit, or every STEP along the walkways at the edge's level
  const cands: Cand[] = [];
  const push = (feet: Vec3, walkway: string | null, deck: number | null, edgeOf: boolean, key: number, deckObb?: OBB2) => cands.push({ feet, walkway, deck, ...(deckObb ? { deckObb } : {}), first: Infinity, edge: edgeOf, key });
  if (p.stations) {
    if (p.stations.length !== p.receivers.length) return bad('handup.stations', `give one station per receiver (${p.receivers.length})`, p.receivers);
    for (const [i, s] of p.stations.entries()) {
      const q: Vec2 = [s.x, s.z];
      const l = all.find((x) => offWalkway(x, q) <= x.width / 2 + 0.01);
      if (l && deckOver(rt, l, q)) return bad('handup.receiver-not-aloft', `receiver station (${f2(s.x)}, ${f2(s.z)}) on ${l.id} is under a deck; stand on the deck instead`, [p.receivers[i]], [s.x, l.from.y, s.z]);
      if (l) { push([q[0], l.from.y, q[1]], l.id, null, l.id === edge.id, i); continue; }
      const d = deckAt(rt, edge, q);
      if (d && !('code' in d)) { push([q[0], d.y, q[1]], null, d.level, false, i, d.obb); continue; }
      return bad('handup.receiver-not-aloft', `receiver station (${f2(s.x)}, ${f2(s.z)}) is not on a walkable beam or a deck at ${f2(edge.from.y)} m${d && 'code' in d ? `: ${d.message}` : ''}`, [p.receivers[i]], [s.x, edge.from.y, s.z]);
    }
  } else {
    let k = 0;
    for (const l of [...all].sort((a, b) => (a.id === edge.id ? -1 : b.id === edge.id ? 1 : a.id < b.id ? -1 : 1))) {
      const len = dist2(l.from.p, l.to.p);
      for (let s = 0; s <= len + 1e-9; s += STEP) {
        const q = add2(l.from.p, scale2(sub2(l.to.p, l.from.p), s / len));
        if (!deckOver(rt, l, q)) push([q[0], l.from.y, q[1]], l.id, null, l.id === edge.id, k++);
      }
    }
  }
  // the transfer candidates: forklift / high = one fixed pose; direct = anywhere along the push
  const trs: { s: number; q: Pose }[] = [];
  if (g.fixed) trs.push({ s: 0, q: g.fixed });
  else for (let s = 0; s <= g.sMax + 1e-9; s += STEP) trs.push({ s, q: g.at_s(s, g.ySlide) });
  const bodyOk = (c: Cand, q: Pose) => {
    // a load in the body band (above the feet) keeps BODY_GAP from them
    if (q.p[1] + th < c.feet[1] + 0.02) return true;
    return distRect(flatObb(q, e), [c.feet[0], c.feet[2]]) >= BODY_GAP;
  };
  const reachOk = (c: Cand, q: Pose, act: string) => receiverHands(e, q, c.feet).every((h) => envelopeGap(act, c.feet, h) <= 0 && h[1] >= c.feet[1] - REACH_DOWN - 1e-9);
  // at the hand-off the load is within EDGE_REACH of the edge they kneel at (beam side face / deck outline)
  const outOf = (c: Cand, q: Pose) => Math.max(...receiverHands(e, q, c.feet).map((h) => Math.max(edgeOut(all, c, h), dist2([h[0], h[2]], [c.feet[0], c.feet[2]]) - KNEEL_BACK)));
  const edgeOk = (c: Cand, q: Pose) => outOf(c, q) <= EDGE_REACH + 1e-9;
  // the part's whole path from the first moment it is in the air beside the edge
  const before = g.fixed ? [g.fixed] : trs.map((t) => t.q);
  for (const c of cands) {
    if (!before.every((q) => bodyOk(c, q))) continue;
    for (const t of trs) {
      if (!reachOk(c, t.q, 'reach_down')) continue;
      if (!edgeOk(c, t.q)) { const d = outOf(c, t.q); c.miss = Math.min(c.miss ?? Infinity, d); continue; } // refused only by the edge rule
      const path = receiverPath(e, g, t.q);
      let ok = true;
      for (let i = 1; i < path.length && ok; i++)
        for (const q of samples(e, path[i - 1], path[i])) if (!bodyOk(c, q) || !reachOk(c, q, 'lay')) { ok = false; break; }
      if (ok) { c.first = t.s; break; }
    }
  }
  const good = cands.filter((c) => c.first < Infinity);
  const n = p.receivers.length;
  // prefer: taken earliest, on the edge beam, close to where the part ends up (so they can also fasten it)
  const oF = flatObb(g.final, e);
  const near = (c: Cand) => Math.round(distRect(oF, [c.feet[0], c.feet[2]]) * 20); // 5 cm bins
  const order = (a: Cand, b: Cand) => a.first - b.first || (a.edge === b.edge ? 0 : a.edge ? -1 : 1) || near(a) - near(b) || a.key - b.key;
  good.sort(order);
  let pick: Cand[] | null = null;
  if (p.stations) pick = cands.every((c) => c.first < Infinity) ? cands : null;
  else if (n === 1) pick = good.length ? [good[0]] : null;
  else {
    let best: { c: Cand[]; s: number; k: number } | null = null;
    for (let i = 0; i < good.length; i++)
      for (let j = i + 1; j < good.length; j++) {
        const a = good[i], b = good[j];
        if (dist2([a.feet[0], a.feet[2]], [b.feet[0], b.feet[2]]) < RECEIVER_SEP) continue;
        const s = Math.max(a.first, b.first), k = (a.edge ? 0 : 1) + (b.edge ? 0 : 1) + 0.01 * (near(a) + near(b));
        if (!best || s < best.s - 1e-9 || (Math.abs(s - best.s) < 1e-9 && k < best.k - 1e-9)) best = { c: [a, b], s, k };
      }
    pick = best ? best.c : null;
  }
  // the nearest hand-off refused only by the edge rule: an explicit station that failed, else (no station works) the best one
  const missed = p.stations ? cands.find((c) => c.first === Infinity && c.miss !== undefined && cands.every((o) => o.first < Infinity || o.miss !== undefined))
    : good.length ? undefined : [...cands].filter((c) => c.miss !== undefined).sort((a, b) => a.miss! - b.miss! || a.key - b.key)[0];
  const miss = missed ? { c: missed, d: missed.miss! } : null;
  if (!pick && miss) {
    const where = miss.c.walkway ? `beam ${miss.c.walkway.slice(5)}` : `the deck (level ${miss.c.deck})`;
    return bad('handup.receiver-reach', `${e.id} cannot be received over ${edge.members![0]}: at the hand-off the receivers' hands would be ${f2(miss.d)} m beyond the edge of ${where} they kneel at (max ${EDGE_REACH} m); bring it within ${EDGE_REACH} m of the edge`, [e.id, edge.members![0], ...p.receivers], [miss.c.feet[0], miss.c.feet[1], miss.c.feet[2]]);
  }
  if (!pick) {
    const why = p.stations ? `the given stations cannot reach it all the way in (hands within the reach envelope, ≤ ${REACH_DOWN} m below the feet, ≤ ${EDGE_REACH} m from their edge at the hand-off) without standing in its path` : `no ${n === 2 ? 'two places ≥ 0.6 m apart' : 'place'} on the beams at ${f2(edge.from.y)} m from which ${n === 2 ? 'both receivers' : 'a receiver'} can take it at the edge and feed it in without standing in its path`;
    return bad('handup.no-receiver-station', `${e.id} cannot be received over ${edge.members![0]}: ${why}`, [e.id, edge.members![0], ...p.receivers]);
  }
  // assign receivers (explicit: in order; else the nearer station to each, deterministic)
  let assign = pick;
  if (!p.stations && pick.length === 2) {
    const d = (a: string, c: Cand) => dist2(xz(w.entities[a]), [c.feet[0], c.feet[2]]);
    if (d(p.receivers[0], pick[1]) + d(p.receivers[1], pick[0]) < d(p.receivers[0], pick[0]) + d(p.receivers[1], pick[1]) - 1e-9) assign = [pick[1], pick[0]];
  }
  const stations = p.receivers.map((a, i) => ({ actor: a, feet: assign[i].feet, walkway: assign[i].walkway, deck: assign[i].deck }));
  return { stations, sT: Math.max(...assign.map((c) => c.first)) };
}

// ---- prone receivers (owner feedback §13) ----
type ProneDeck = { y: number };

/** The highest deck covering the edge walkway (people lie on it at the edge), or null. */
function proneDeck(rt: Runtime, edge: Link): ProneDeck | null {
  const len = dist2(edge.from.p, edge.to.p);
  let y = -Infinity;
  for (let s = 0; s <= len + 1e-9; s += STEP) {
    const d = deckOver(rt, edge, add2(edge.from.p, scale2(sub2(edge.to.p, edge.from.p), s / len)));
    if (d) y = Math.max(y, d.y);
  }
  return y > -Infinity ? { y } : null;
}

/** The three receiving postures' reach down, for `handup.too-high`. */
function reachList(prone: ProneDeck | null, handY: number, edge: Link): string {
  const pr = prone
    ? `lying prone at the edge of the deck at ${f2(prone.y)} m ≤ ${REACH_DOWN_PRONE} m below it, here ${f2(prone.y - handY)} m`
    : `lying prone ≤ ${REACH_DOWN_PRONE} m below a deck, but no deck covers ${edge.members![0]} to lie on`;
  return `receivers reach down standing to ${f2(STAND_REACH)} m above their feet, kneeling ≤ ${REACH_DOWN} m below them, ${pr}`;
}

/** `handup.rise-blocked`: the load's way up beside the edge (prone: past the deck edge; kneeling: past the edge beam and
 *  whatever rests on it, e.g. joist ends) is in the way of `hit` wherever the receivers could still reach it. */
function riseBlocked(e: Entity, edge: Link, hit: Hit, receivers: string[], where: string, kneel = false): Fail {
  const name = hit.o.label && hit.o.label !== hit.o.id ? `${hit.o.label} (${hit.o.id})` : hit.o.id;
  const past = kneel ? `the edge beam ${edge.members![0]} in the hands of receivers kneeling at it` : `the deck edge over ${edge.members![0]} in the hands of a receiver lying there`;
  return bad('handup.rise-blocked', `${e.id} cannot rise past ${past}: ${name} is in the way of its rise at (${f2(hit.q.p[0])}, ${f2(hit.q.p[1])}, ${f2(hit.q.p[2])}) ${where}`, [e.id, hit.o.id, edge.members![0], ...receivers], hit.q.p);
}

/** Distance from q (inside o) along unit n to o's outline. */
function exitAlong(o: OBB2, q: Vec2, n: Vec2): number {
  const l = rot2(sub2(q, o.c), -o.yaw), d = rot2(n, -o.yaw);
  let t = Infinity;
  for (const k of [0, 1]) if (Math.abs(d[k]) > 1e-9) t = Math.min(t, ((d[k] > 0 ? o.half[k] : -o.half[k]) - l[k]) / d[k]);
  return t;
}

const PR = BODY_MODEL.prone;
const handSide = (j: number) => (j === 0 ? sideOf('left') : sideOf('right'));
/** A prone receiver at S (feet) lying along the unit `heading` (the body's axis; `human.proneYaw`): hand j flat on the deck
 *  beside the chest (lying, and the push-up hand). */
export function proneDeckHand(feet: Vec3, heading: Vec2, j: number): Vec3 {
  const r: Vec2 = [-heading[1], heading[0]], k = handSide(j) * PR.deckHand.side;
  return [feet[0] + heading[0] * PR.deckHand.fwd + r[0] * k, feet[1], feet[2] + heading[1] * PR.deckHand.fwd + r[1] * k];
}
/** … and the point 0.1 m past the lip (the edge PRONE_BACK ahead of S along the edge normal `out`), 5 cm above the deck,
 *  that hand passes going over the edge along the heading (never through it). */
export function proneLipHand(feet: Vec3, heading: Vec2, j: number, out: Vec2 = heading): Vec3 {
  const r: Vec2 = [-heading[1], heading[0]], k = handSide(j) * PR.deckHand.side;
  const f = (PRONE_BACK - k * dot2(r, out)) / dot2(heading, out) + 0.1; // where that hand's line crosses the lip, + 0.1
  return [feet[0] + heading[0] * f + r[0] * k, feet[1] + 0.05, feet[2] + heading[1] * f + r[1] * k];
}
/** Point at fraction t of the polyline's length. */
function along(pts: Vec3[], t: number): Vec3 {
  const L = pts.slice(1).map((p, i) => hypot(p[0] - pts[i][0], p[1] - pts[i][1], p[2] - pts[i][2]));
  let d = t * L.reduce((a, b) => a + b, 0);
  for (let i = 0; i < L.length; i++) {
    if (d <= L[i] || i === L.length - 1) {
      const u = L[i] > 0 ? Math.min(1, d / L[i]) : 1, a = pts[i], b = pts[i + 1];
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
    }
    d -= L[i];
  }
  return [...pts[pts.length - 1]] as Vec3;
}

type LipHit = { msg: string; o: Obstacle; at: Vec3 };
/** A prone station; `lip` = it works but for its body past the lip passing through `lip.o` (then it is not used). */
type PC = { feet: Vec3; level: number; obb: OBB2; key: number; hold: Hand; yMid: number; frame: ProneFrame; tip: number; lip?: LipHit };
const DEG = Math.PI / 180;
const deg0 = (a: number) => Math.round(Math.abs(a) / DEG);

/** A body part sample: a cube of half-size r about p (world). */
type BodyBox = { part: string; p: Vec3; r: number };
/** First obstacle (not in `skip`) any body box meets, or null — the same prism test as a part sweep (1 cm / 5 mm slack). */
function bodyHit(obstacles: Obstacle[], boxes: BodyBox[], skip: Set<string>): { o: Obstacle; box: BodyBox } | null {
  for (const box of boxes) {
    const ob: OBB2 = { c: [box.p[0], box.p[2]], half: [box.r, box.r], yaw: 0 };
    for (const o of obstacles) {
      if (skip.has(o.id) || o.y1 <= box.p[1] - box.r + 0.005 || o.y0 >= box.p[1] + box.r - 0.005) continue;
      if (obbOverlap(ob, o.obb, -0.01)) return { o, box };
    }
  }
  return null;
}

/**
 * The lying body beyond the lip reaching the grips `hs` [left, right] (BODY_MODEL.md "Prone receiver"): the torso tipped
 * every 15° from flat to `tip` (tip joint → shoulders, ±0.15 m across, from 3 cm behind the spine line to the chest's
 * front 0.10 m ahead of it), the head (a 0.1 m ball 0.15 m on from the shoulders) and, at `tip`, each arm from its
 * shoulder joint to its grip (4 cm). The load itself is skipped (the hands are on it).
 */
export function proneBeyondLip(fr: ProneFrame, tip: number, hs: [Vec3, Vec3]): BodyBox[] {
  const out: BodyBox[] = [];
  const tips: number[] = [];
  for (let d = 0; d < tip - 1e-9; d += 15) tips.push(d);
  tips.push(tip);
  for (const d of tips) {
    const P = pronePoints(fr, d);
    for (let t = 0; t <= P.len + 1e-9; t += 0.04) for (const k of [0.01, 0.06]) for (const sd of [-0.11, -0.04, 0.04, 0.11]) out.push({ part: 'chest', p: P.torso(t, k, sd), r: 0.04 });
    out.push({ part: 'head', p: P.head, r: 0.09 });
  }
  const P = pronePoints(fr, tip);
  for (const j of [0, 1]) {
    const a = P.shoulders[j], b = hs[j], L = hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), n = Math.max(1, Math.ceil(L / 0.04));
    for (let i = 0; i <= n; i++) out.push({ part: j ? 'right arm' : 'left arm', p: [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, a[2] + ((b[2] - a[2]) * i) / n], r: 0.04 });
  }
  return out;
}

/** The first thing (not the load) the lying body beyond the lip meets reaching grips `hs` with the chest tipped `tip`°,
 *  or null (what hand_up plans against; tests re-check it per tick from the published proneYaw). */
export function proneBodyHit(rt: Runtime, fr: ProneFrame, tip: number, hs: [Vec3, Vec3], load: string): { id: string; part: string; at: Vec3 } | null {
  const h = bodyHit(spatialOf(rt).scene.obstacles, proneBeyondLip(fr, tip, hs), new Set([load]));
  return h ? { id: h.o.id, part: h.box.part, at: h.box.p } : null;
}

/** The lying body's footprint on the deck, toes → lip (half-width bodyHalf), and → the head's end (for two bodies). */
function lyingObb(fr: ProneFrame, head = false): OBB2 {
  const a0 = -PR.bodyBack, a1 = head ? fr.lip + PR.tipPast + PR.overEdge + PR.head.on + PR.head.r : fr.lip;
  const c = proneAt(fr, (a0 + a1) / 2, 0, 0);
  return { c: [c[0], c[2]], half: [(a1 - a0) / 2, PR.bodyHalf], yaw: fr.yaw };
}

/**
 * Stations for receivers lying prone at a deck edge over `edge` (§13), used only where kneeling cannot reach
 * (`handup.too-high` for the kneel rule). Each station S is PRONE_BACK behind the lip; the receiver lies with the body's
 * axis through the grip (`human.proneYaw`, ≤ turnMax off the edge normal); the body at that heading (toes → lip) lies on
 * the deck and clear of parts and people; at the take both hands are within reach of the tipped shoulders
 * (`proneReachGap`), ≤ REACH_DOWN_PRONE below the deck and ≤ PRONE_EDGE_REACH beyond its outline; the torso tipped as
 * far as that needs, the head and both arms clear everything beyond the lip (joist ends, beams, walls: else another
 * station, or `handup.rise-blocked` naming it); the rise (push-up on one hand, kneel up) keeps the grips inside the
 * push-up / kneel-up envelopes while the load comes straight up outside the edge (swept: `handup.rise-blocked`); from
 * slide height on they feed it in like kneeling receivers (bentOver envelope, body gap).
 */
function chooseProneStations(rt: Runtime, e: Entity, p: HP, edge: Link, nOut: Vec2, g: Geo, riseHit: Hit | null, ignore: string[]): { stations: Station[]; sT: number; mid: Pose } | Fail {
  const w = rt.world, sp = spatialOf(rt);
  const tr = g.fixed!;
  const th = size(e)[1];
  const path = receiverPath(e, g, tr); // [take, up (slide height), slid in, set down]
  const up = path[1];
  const atY = (y: number): Pose => ({ ...tr, p: [tr.p[0], y, tr.p[2]] });
  const inEnv = (act: string, feet: Vec3, q: Pose) => receiverHands(e, q, feet).every((h) => envelopeGap(act, feet, h) <= 1e-9);
  const skipLoad = new Set([e.id]);
  const onDeck = (q: Vec2, y: number) => sp.scene.surfaces.some((x) => Math.abs(x.y - y) < 0.02 && pointInObb(q, x.obb));
  const others = Object.values(w.entities).filter((h) => h.human && !p.receivers.includes(h.id) && !(p.givers ?? []).includes(h.id) && h.id !== p.operator);
  const oF = flatObb(g.final, e);
  const nearOf = (q: Vec2) => Math.round(distRect(oF, q) * 20); // 5 cm bins
  /** The body lying from S turned `turn` off the edge normal, reaching grips `hs`: its frame and the tip it needs, or why not. */
  const lying = (S: Vec2, feet: Vec3, d: { y: number; level: number; obb: OBB2 }, turn: number, hs: [Vec3, Vec3], where: string): { fr: ProneFrame; tip: number; lip?: LipHit } | string => {
    const fr = proneFrame(feet, nOut, rot2(nOut, turn));
    const turned = fr.turn ? ` turned ${deg0(fr.turn)}°` : '';
    // the body at that heading, toes → lip: on the deck (the axis and ±0.12 m across, wherever behind the lip line)
    for (let a = -PR.bodyBack; a <= fr.lip + 1e-9; a += 0.1)
      for (const sd of [-0.12, 0, 0.12]) {
        const b = proneAt(fr, a, sd, 0), q: Vec2 = [b[0], b[2]];
        if (dot2(sub2(q, S), nOut) > PRONE_BACK - 0.02) continue; // over the edge
        if (!onDeck(q, d.y)) return `lying down from ${where}${turned} their body would be off the deck at (${f2(q[0])}, ${f2(q[1])})`;
      }
    // … and clear (half-width bodyHalf, 0.3 m high) of everything standing on the deck, and of other people there
    const lo = lyingObb(fr);
    for (const o of sp.scene.obstacles) {
      if (o.id === e.id || o.y1 <= d.y + 0.02 || o.y0 >= d.y + 0.3) continue;
      if (obbOverlap(lo, o.obb, -0.01)) return `no room to lie down from ${where}${turned}: ${o.label && o.label !== o.id ? `${o.label} (${o.id})` : o.id} is in the way`;
    }
    for (const h of others)
      if (h.human!.level === d.level && distToObb([h.pose.p[0], h.pose.p[2]], lo) < HUMAN_PROFILE.radius) return `no room to lie down from ${where}${turned}: ${h.id} is there`;
    // reach at the take: each hand within arm + girdle of its shoulder joint, the torso tipped ≤ tipMax
    let tip = 0;
    for (const [j, h] of hs.entries()) {
      const r = proneReachGap(fr, h, j ? 'right' : 'left');
      if (r.gap > 1e-9) return `lying at ${where}${turned} their ${j ? 'right' : 'left'} hand would be ${f2(r.gap)} m beyond reach of the load (arm ${ARM_LEN} m + girdle ${PR.girdle} m from the shoulder, chest tipped ≤ ${PR.tipMax}°)`;
      tip = Math.max(tip, r.tip);
    }
    // beyond the lip: the chest tipped that far, the head, both arms to the grips — clear of everything but the load
    // (a hit is kept, not returned: whether it is the only thing wrong decides handup.rise-blocked vs no-receiver-station)
    const bh = bodyHit(sp.scene.obstacles, proneBeyondLip(fr, tip, hs), skipLoad);
    const name = bh ? (bh.o.label && bh.o.label !== bh.o.id ? `${bh.o.label} (${bh.o.id})` : bh.o.id) : '';
    const lip: LipHit | undefined = bh ? { msg: `lying at ${where}${turned} with the chest tipped ${tip}° over the lip, their ${bh.box.part} would pass through ${name} at (${f2(bh.box.p[0])}, ${f2(bh.box.p[1])}, ${f2(bh.box.p[2])})`, o: bh.o, at: bh.box.p } : undefined;
    // the free hand flat on the deck beside the chest
    for (const j of [0, 1]) {
      const dh = proneDeckHand(feet, fr.f, j);
      if (!onDeck([dh[0], dh[2]], d.y)) return `lying at ${where}${turned} a hand flat beside the chest would be off the deck at (${f2(dh[0])}, ${f2(dh[2])})`;
    }
    return { fr, tip, ...(lip ? { lip } : {}) };
  };
  const station = (S: Vec2, key: number): PC | string => {
    const where = `(${f2(S[0])}, ${f2(S[1])})`;
    const d = deckAt(rt, edge, S);
    if (!d) return `${where} is not on a deck at ${f2(edge.from.y)} m`;
    if ('code' in d) return d.message;
    const lip = exitAlong(d.obb, S, nOut);
    if (Math.abs(lip - PRONE_BACK) > 0.05 + 1e-9) return `${where} is ${f2(lip)} m from the deck edge facing out over ${edge.members![0]} (a prone receiver kneels ${PRONE_BACK} m from it and lies down over it)`;
    const feet: Vec3 = [S[0], d.y, S[1]];
    // the take: the grips (the load's top face nearest S); the lying heading: the body's axis through them if it fits,
    // else turned back toward straight out in 5° steps (the reach is from the shoulders, not the axis)
    const hs = receiverHands(e, tr, feet);
    const cv = sub2([(hs[0][0] + hs[1][0]) / 2, (hs[0][2] + hs[1][2]) / 2], S), cl = hypot(cv[0], cv[1]);
    const t0 = proneFrame(feet, nOut, cl > 1e-9 ? scale2(cv, 1 / cl) : nOut).turn;
    const turns = [Math.max(-PR.turnMax * DEG, Math.min(PR.turnMax * DEG, t0))];
    for (let t = Math.floor(Math.abs(turns[0]) / (5 * DEG) - 1e-9) * 5 * DEG; t >= -1e-9; t -= 5 * DEG) turns.push(Math.sign(t0) * Math.max(0, t));
    // the first heading that fits; else the first that fits but for the body past the lip (kept to name the member);
    // else why not — from the heading that got furthest (off the deck < parts < people < reach < deck hand)
    type Fit = { fr: ProneFrame; tip: number; lip?: LipHit };
    const stage = (m: string) => (/hand flat beside/.test(m) ? 5 : /beyond reach/.test(m) ? 4 : /is there$/.test(m) ? 3 : /is in the way$/.test(m) ? 2 : /off the deck/.test(m) ? 1 : 0);
    let first: string | null = null, fit: Fit | null = null, blocked: Fit | null = null;
    for (const t of turns) {
      const r = lying(S, feet, d, t, hs, where);
      if (typeof r === 'string') { if (first === null || stage(r) > stage(first)) first = r; }
      else if (r.lip) blocked ??= r;
      else { fit = r; break; }
    }
    fit ??= blocked;
    if (!fit) return first!;
    const { fr } = fit;
    const turned = fr.turn ? ` turned ${deg0(fr.turn)}°` : '';
    // the take's other limits: the bounding envelope (what the per-tick invariant checks), the depth cap, the edge
    for (const h of hs) {
      const gap = envelopeGap(PRONE_ACTIVITY.reach, feet, h);
      if (gap > 1e-9) return `lying at ${where} their hands would be ${f2(gap)} m beyond reach of the load (arm ${ARM_LEN} m)`;
      if (feet[1] - h[1] > REACH_DOWN_PRONE + 1e-9) return `lying at ${where} their hands would be ${f2(feet[1] - h[1])} m below the deck (max ${REACH_DOWN_PRONE} m)`;
      const out = dist2(nearestOnRect(d.obb, [h[0], h[2]]).q, [h[0], h[2]]);
      if (out > PRONE_EDGE_REACH + 1e-9) return `lying at ${where} their hands would be ${f2(out)} m beyond the deck edge (max ${PRONE_EDGE_REACH} m)`;
    }
    // the free hand's way over the lip and onto the deck: in reach in every phase
    for (const j of [0, 1]) {
      const dh = proneDeckHand(feet, fr.f, j);
      for (const act of [PRONE_ACTIVITY.reach, PRONE_ACTIVITY.pushUp, PRONE_ACTIVITY.kneelUp])
        for (const h of [dh, proneLipHand(feet, fr.f, j, nOut)])
          if (envelopeGap(act, feet, h) > 1e-9) return `lying at ${where} a hand on the deck would be out of reach (${act})`;
    }
    // the rise: from the lowest height the grips are in the kneel-up envelope all the way up (below it: push-up)
    if (!inEnv(PRONE_ACTIVITY.kneelUp, feet, up)) return `kneeling up at ${where} they could not hold it at slide height`;
    let yMid = up.p[1];
    for (let y = up.p[1] - STEP; y > tr.p[1] + 1e-9; y -= STEP) { if (!inEnv(PRONE_ACTIVITY.kneelUp, feet, atY(y))) break; yMid = y; }
    if (inEnv(PRONE_ACTIVITY.kneelUp, feet, tr) && yMid <= tr.p[1] + STEP + 1e-9) yMid = tr.p[1];
    // feeding it in from there: kneeling at S, hands in reach, the load clear of the body
    for (let i = 2; i < path.length; i++)
      for (const q of samples(e, path[i - 1], path[i])) {
        if (q.p[1] + th >= feet[1] + 0.02 && distRect(flatObb(q, e), S) < BODY_GAP) return `from ${where} the load would pass through them while it is fed in`;
        if (!inEnv('lay', feet, q)) return `from ${where} they could not feed it in (hands beyond reach kneeling)`;
      }
    const r0 = dist2([hs[0][0], hs[0][2]], S), r1 = dist2([hs[1][0], hs[1][2]], S);
    return { feet, level: d.level, obb: d.obb, key, hold: r0 < r1 - 1e-9 ? 'left' : 'right', yMid, frame: fr, tip: fit.tip, ...(fit.lip ? { lip: fit.lip } : {}) };
  };
  // candidates: explicit, or every STEP along the edge where a deck covers it (S straight behind the lip)
  const cands: PC[] = [];
  /** Why candidates failed: the most specific reason (reach, the body) from the station nearest the load is quoted. */
  const why: { rank: number; near: number; msg: string }[] = [];
  const rank = (m: string) => (/no room to stand|is not on a deck|m from the deck edge facing/.test(m) ? 2 : /off the deck|no room to lie/.test(m) ? 1 : 0);
  if (p.stations) {
    if (p.stations.length !== p.receivers.length) return bad('handup.stations', `give one station per receiver (${p.receivers.length})`, p.receivers);
    for (const [i, s] of p.stations.entries()) {
      const c = station([s.x, s.z], i);
      if (typeof c === 'string') return bad('handup.no-receiver-station', `${e.id} cannot be received over ${edge.members![0]} by ${p.receivers[i]} lying prone: ${c}`, [e.id, edge.members![0], p.receivers[i]], [s.x, edge.from.y, s.z]);
      if (c.lip) return bad('handup.rise-blocked', `${e.id} cannot be taken over the deck edge over ${edge.members![0]} by ${p.receivers[i]} lying prone: ${c.lip.msg}`, [e.id, c.lip.o.id, edge.members![0], p.receivers[i]], c.lip.at);
      cands.push(c);
    }
  } else {
    const len = dist2(edge.from.p, edge.to.p);
    let k = 0;
    for (let s = 0; s <= len + 1e-9; s += STEP) {
      const q = add2(edge.from.p, scale2(sub2(edge.to.p, edge.from.p), s / len));
      const d = deckOver(rt, edge, q);
      if (!d || !pointInObb(q, d.obb, 0.01)) continue; // (a deck edge often lies on the beam's centreline)
      const S = add2(q, scale2(nOut, exitAlong(d.obb, q, nOut) - PRONE_BACK));
      const c = station(S, k++);
      if (typeof c === 'string') why.push({ rank: rank(c), near: nearOf(S), msg: c });
      else cands.push(c); // (lip-blocked ones too: see `choose`)
    }
  }
  const n = p.receivers.length;
  const near = (c: PC) => nearOf([c.feet[0], c.feet[2]]);
  // a crew works when every grip stays in the push-up envelope from the take to the common kneel-up height
  const works = (cs: PC[]): Pose | null => {
    const yMid = Math.max(...cs.map((c) => c.yMid));
    for (let y = tr.p[1]; y <= yMid + 1e-9; y += STEP) for (const c of cs) if (!inEnv(PRONE_ACTIVITY.pushUp, c.feet, atY(Math.min(y, yMid)))) return null;
    for (const c of cs) if (!inEnv(PRONE_ACTIVITY.pushUp, c.feet, atY(yMid))) return null;
    return atY(yMid);
  };
  // two lying bodies (toes → head) never overlap
  const apart = (a: PC, b: PC) => dist2([a.feet[0], a.feet[2]], [b.feet[0], b.feet[2]]) >= RECEIVER_SEP && !obbOverlap(lyingObb(a.frame, true), lyingObb(b.frame, true));
  /** The best crew from `list` (explicit stations: all of them), and the kneel-up height their rise meets at. */
  const choose = (list: PC[]): { pick: PC[]; mid: Pose } | null => {
    if (p.stations) { const m = list.length === 2 && !apart(list[0], list[1]) ? null : works(list); return m ? { pick: list, mid: m } : null; }
    const good = [...list].sort((a, b) => near(a) - near(b) || a.key - b.key);
    if (n === 1) { for (const c of good) { const m = works([c]); if (m) return { pick: [c], mid: m }; } return null; }
    let best: { c: PC[]; k: number } | null = null;
    for (let i = 0; i < good.length; i++)
      for (let j = i + 1; j < good.length; j++) {
        const a = good[i], b = good[j];
        if (!apart(a, b)) continue;
        const k = near(a) + near(b);
        if (best && k >= best.k) continue;
        if (works([a, b])) best = { c: [a, b], k };
      }
    return best ? { pick: best.c, mid: works(best.c)! } : null;
  };
  const ch = choose(cands.filter((c) => !c.lip));
  if (!ch) {
    // a crew that works but for their bodies past the lip: that member is what blocks it — name it
    const lb = choose(cands)?.pick.filter((c) => c.lip).sort((a, b) => near(a) - near(b))[0];
    if (lb) return bad('handup.rise-blocked', `${e.id} cannot be taken over the deck edge over ${edge.members![0]} by receivers lying there: ${lb.lip!.msg}; nowhere else along the edge ${n === 2 ? 'can two of them' : 'can one'} lie and reach it`, [e.id, lb.lip!.o.id, edge.members![0], ...p.receivers], lb.lip!.at);
    const lw = cands.find((c) => c.lip);
    const w0 = [...why, ...(lw ? [{ rank: 0, near: near(lw), msg: lw.lip!.msg }] : [])].sort((a, b) => a.rank - b.rank || a.near - b.near)[0];
    // something sticking out past the edge pushed the load's way up out of their reach (the best reason is reach): name it
    if (riseHit && (!w0 || /beyond reach|below the deck \(max|beyond the deck edge/.test(w0.msg)))
      return riseBlocked(e, edge, riseHit, p.receivers, `close to the edge, and clear of it nobody lying at the edge reaches it (hands ≤ ${PRONE_EDGE_REACH} m beyond the deck edge, ≤ ${REACH_DOWN_PRONE} m below it)`);
    const reason = w0 ? `: e.g. ${w0.msg}` : '';
    return bad('handup.no-receiver-station', `${e.id} cannot be received over ${edge.members![0]}: no ${n === 2 ? 'two places ≥ 0.6 m apart' : 'place'} at the deck edge from which ${n === 2 ? 'both receivers' : 'a receiver'} lying prone can take it (hands ≤ ${REACH_DOWN_PRONE} m below the deck, ≤ ${PRONE_EDGE_REACH} m beyond its edge), get up holding it and feed it in${reason}`, [e.id, edge.members![0], ...p.receivers]);
  }
  const { pick, mid } = ch;
  // the take and the rise, swept against everything (the members it will rest on included: it passes their ends)
  const hit = sweepPoses(rt, e, [tr, mid, up], ignore);
  if (hit) return riseBlocked(e, edge, hit, p.receivers, 'beside the edge where they take it');
  // assign receivers (explicit: in order; else the nearer station to each, deterministic)
  let assign = pick;
  if (!p.stations && pick.length === 2) {
    const d = (a: string, c: PC) => dist2(xz(w.entities[a]), [c.feet[0], c.feet[2]]);
    if (d(p.receivers[0], pick[1]) + d(p.receivers[1], pick[0]) < d(p.receivers[0], pick[0]) + d(p.receivers[1], pick[1]) - 1e-9) assign = [pick[1], pick[0]];
  }
  const stations: Station[] = p.receivers.map((a, i) => ({ actor: a, feet: assign[i].feet, walkway: null, deck: assign[i].level, prone: { out: nOut, hold: assign[i].hold, deckObb: assign[i].obb, frame: assign[i].frame, tip: assign[i].tip } }));
  return { stations, sT: 0, mid };
}

function finishPlan(rt: Runtime, e: Entity, p: HP, mode: 'hand' | 'forklift', yaw: number, rest: Rest, edge: Link, nOut: Vec2, giverGrips: HandupProgram['giverGrips'], pickup: HandupProgram['pickup'],
  giverSegs: Seg[], stations: Station[], lift0: Pose, transfer: Pose, final: Pose, ySlide: number, vehicle?: string, mid?: Pose): { ok: true; program: HandupProgram } | Fail {
  const w = rt.world;
  // receivers' access: beam_walk on their walkway / climb a frame first / walk on a deck
  const chains: Chain[] = [];
  for (const st of stations) {
    const h = w.entities[st.actor];
    const ch: Chain = [];
    if (st.deck !== null) {
      if (h.human!.on || h.human!.level !== st.deck)
        return bad('handup.receiver-route', `receiver ${st.actor} must already be on the deck (level ${st.deck}) to take ${e.id} there`, [st.actor]);
      const face = st.prone ? datan2(st.prone.out[1], st.prone.out[0]) : faceTo(e, transfer, st.feet); // prone: facing out over the edge
      ch.push({ verb: 'walk_to', params: { actor: st.actor, x: st.feet[0], z: st.feet[2], level: st.deck, face } });
    } else if (h.human!.on === st.walkway) {
      if (dist2(xz(h), [st.feet[0], st.feet[2]]) > 0.01) ch.push({ verb: 'beam_walk', params: { actor: st.actor, x: st.feet[0], z: st.feet[2] } });
    } else if (h.human!.on) {
      return bad('handup.receiver-route', `receiver ${st.actor} is on ${h.human!.on}, not on ${st.walkway}; climb down and up the right frame first`, [st.actor]);
    } else {
      const climbs = climbLinks(w).filter((l) => walkwayAtExit(w, l)?.id === st.walkway && l.from.level === h.human!.level);
      if (!climbs.length)
        return bad('handup.receiver-not-aloft', `receiver ${st.actor} is on level ${h.human!.level} and no installed frame can be climbed onto ${st.walkway}`, [st.actor]);
      const l = climbs.map((c) => ({ c, d: dist2(c.to.p, [st.feet[0], st.feet[2]]) })).sort((a, b) => a.d - b.d || (a.c.id < b.c.id ? -1 : 1))[0].c;
      ch.push({ verb: 'climb_frame', params: { actor: st.actor, link: l.id, dir: 'up' } });
      ch.push({ verb: 'beam_walk', params: { actor: st.actor, x: st.feet[0], z: st.feet[2] } });
    }
    chains.push(ch);
  }
  // two receivers climbing the same frame: the one going farther along the beam goes first, the
  // other starts once the first stands at their station (one person per climb, no passing on a beam)
  const firstLink = (c: Chain) => (c[0]?.verb === 'climb_frame' ? String(c[0].params.link) : '');
  let lead = -1;
  if (chains.length === 2 && firstLink(chains[0]) && firstLink(chains[0]) === firstLink(chains[1])) {
    const exit = climbLinks(w).find((l) => l.id === firstLink(chains[0]))!.to.p;
    const d = stations.map((s) => dist2(exit, [s.feet[0], s.feet[2]]));
    lead = d[1] > d[0] ? 1 : 0;
  }
  // final segments (receivers)
  const path = receiverPath(e, { at_s: () => transfer, sOut: 0, ySlide, direct: false, sMax: 0, rest, final }, transfer);
  const off: Pose = mode === 'forklift' ? { ...transfer, p: [transfer.p[0], transfer.p[1] + FORK_LIFT_OFF, transfer.p[2]] } : transfer;
  const up = path[1].p[1] > off.p[1] ? { ...off, p: [off.p[0], path[1].p[1], off.p[2]] as Vec3 } : off;
  const slid: Pose = { ...final, p: [final.p[0], up.p[1], final.p[2]] };
  const receiverSegs: Seg[] = mid ? [
    // prone (§13): reach down lying at the edge, take, push up on one hand, kneel up (the load straight up outside the
    // edge in the holding hand), then kneeling with both hands on it as a kneeling receiver
    { phase: 'reach_down', from: transfer, to: transfer, dur: T.reachDown },
    { phase: 'take', from: transfer, to: transfer, dur: T.take },
    { phase: 'push_up', from: transfer, to: mid, dur: Math.max(T.pushUp, segDur(e, transfer, mid, SPEED.raise)) },
    { phase: 'kneel_up', from: mid, to: up, dur: Math.max(T.kneelUp, segDur(e, mid, up, SPEED.raise)) },
    { phase: 'stand_with_load', from: up, to: up, dur: T.stand },
    { phase: 'lay', from: up, to: slid, dur: segDur(e, up, slid, SPEED.slide) },
    { phase: 'set_down', from: slid, to: final, dur: T.setDown },
  ] : [
    { phase: 'reach_down', from: transfer, to: transfer, dur: T.reachDown },
    { phase: 'take', from: transfer, to: transfer, dur: T.take },
    { phase: 'stand_with_load', from: transfer, to: up, dur: Math.max(T.stand, segDur(e, transfer, up, SPEED.raise)) },
    { phase: 'lay', from: up, to: slid, dur: segDur(e, up, slid, SPEED.slide) },
    { phase: 'set_down', from: slid, to: final, dur: T.setDown },
  ];
  // sweeps of the receivers' part: the take, the rise and the feed-in clear everything (the members it will rest on
  // included: it passes their ends; W30), only the set-down may touch those members
  const vIgnore = vehicle ? [vehicle] : [];
  const rise = sweepPoses(rt, e, [off, up], vIgnore);
  if (rise) return riseBlocked(e, edge, rise, stations.map((s) => s.actor), mode === 'forklift' ? 'where the forks hold it (present it clear of it)' : 'beside the edge where they take it', !mid);
  const hit = sweepPoses(rt, e, [transfer, off], vIgnore) ?? sweepPoses(rt, e, [up, slid], vIgnore) ?? sweepPoses(rt, e, [slid, final], [...rest.supports, ...vIgnore]);
  if (hit) return bad('handup.path-blocked', `${e.id} cannot be fed in from the edge: it would hit ${hit.o.label ?? hit.o.id} at (${f2(hit.q.p[0])}, ${f2(hit.q.p[1])}, ${f2(hit.q.p[2])})`, [e.id, hit.o.id], hit.q.p);
  // route checks for receivers walking to a climb foot (plan-time, review H1)
  for (const [i, ch] of chains.entries()) {
    const c = ch[0];
    if (c?.verb !== 'climb_frame') continue;
    const l = climbLinks(w).find((x) => x.id === c.params.link)!;
    const r = checkStations(rt, [{ actor: stations[i].actor, p: l.from.p, level: l.from.level }]);
    if (r) return { ok: false, diagnostic: { ...r, code: 'handup.receiver-unreachable' } };
  }
  return { ok: true, program: { mode, yaw, rest, edge: edge.id, nOut, giverGrips, pickup, giverSegs, receiverSegs, stations, chains, lead, transfer, final, vehicle } };
}
const faceTo = (e: Entity, q: Pose, feet: Vec3) => { const h = nearestOnRect(flatObb(q, e), [feet[0], feet[2]]).q; return datan2(h[1] - feet[2], h[0] - feet[0]); };

// ---- execution ----
type Exec = {
  id: string; p: HP; prog: HandupProgram;
  gi: number; gt: number; // giver segment index / time in it
  ri: number; rt: number; // receiver segment index / time
  walk?: Children; chainAt: number[]; chainRec: (ActionRecord | null)[]; retry: number[];
  givingDone: boolean; receiversReady: boolean;
  /** Prone receivers: time spent lying down (T.lieDown; they lie down as soon as they are at their stations). */
  lie: number;
};

const phaseK = (s: Seg, t: number) => (s.dur > 0 ? Math.min(1, t / s.dur) : 1);
function poseAt(s: Seg, t: number): Pose {
  const k = s.dur > 0 ? Math.min(1, t / s.dur) : 1;
  return lerpPose(s.from, s.to, s.phase === 'lift' || s.phase === 'set_down' || s.phase === 'reach_up' || s.phase === 'stand_with_load' || s.phase === 'push_up' || s.phase === 'kneel_up' ? smooth(k) : k);
}

/**
 * Hands on their way to a grip (crouch: from hanging at the hips down to where they grip the part lying on the
 * ground; reach_down: from the hips down / out over the edge to the load): smoothstep from the rest hands to the
 * grip over the phase, k = phase fraction. Undefined k = at the grip. Lift / reach_up / stand_with_load need no
 * blend: the hands are on the part, which itself moves smoothly (poseAt). The segment rest → grip stays inside
 * the body envelope (a convex set) when both ends are.
 */
function approach(h: Entity, grip: [Vec3, Vec3], k: number | undefined): [Vec3, Vec3] {
  if (k === undefined || k >= 1) return grip;
  const r = restHands(h), s = smooth(k);
  const mix = (a: Vec3, b: Vec3): Vec3 => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
  return [mix(r[0], grip[0]), mix(r[1], grip[1])];
}

function holdGivers(rt: Runtime, ex: Exec, activity: string, q: Pose, feetFromPose: boolean, k?: number) {
  const e = rt.world.entities[ex.p.part];
  for (const [i, g] of (ex.p.givers ?? []).entries()) {
    const h = rt.world.entities[g];
    if (feetFromPose) {
      const f = giverFeet(ex.prog, i, q, h.pose.p[1]);
      h.pose.p = f;
    }
    const slot = giverSlot(i, ex.prog.giverGrips[i]);
    const hands = handupHands(e, q, h, slot)!;
    const c: Vec2 = [(hands[0][0] + hands[1][0]) / 2, (hands[0][2] + hands[1][2]) / 2];
    h.pose.yaw = datan2(c[1] - h.pose.p[2], c[0] - h.pose.p[0]);
    Object.assign(h.human!, { activity, task: ex.id, grip: { entity: e.id, slot } });
    setHands(h, approach(h, hands, k));
  }
}
function holdReceivers(rt: Runtime, ex: Exec, phase: string, q: Pose, k?: number, kp = 1) {
  const e = rt.world.entities[ex.p.part];
  for (const [i, st] of ex.prog.stations.entries()) {
    const h = rt.world.entities[st.actor];
    if (st.prone) { holdProne(h, e, ex.id, i, st.prone, phase, q, kp); continue; }
    // (a kneeling receiver beside a prone one holds on while the other gets up)
    const activity = phase === 'push_up' || phase === 'kneel_up' ? 'take' : phase;
    const slot = `${HANDUP_SLOT_PREFIX}take-${i}`;
    const hands = handupHands(e, q, h, slot)!;
    const c: Vec2 = [(hands[0][0] + hands[1][0]) / 2, (hands[0][2] + hands[1][2]) / 2];
    h.pose.yaw = datan2(c[1] - h.pose.p[2], c[0] - h.pose.p[0]);
    Object.assign(h.human!, { activity, task: ex.id, grip: { entity: e.id, slot } });
    setHands(h, approach(h, hands, k));
  }
}
/**
 * A prone receiver's hands and activity for a receiver phase (k = phase fraction; HANDUP.md "Prone receiver"):
 * reach_down → `prone-reach`, hands from flat on the deck over the lip down to the grip; take → `prone-reach` at the
 * grip; push_up → `push-up`, the `hold` hand on the load, the other back over the lip onto the deck (by PUSH_HAND_K);
 * kneel_up → `kneel-up`, that hand back over the lip onto the load; then stand_with_load / lay / set_down as kneeling
 * (both hands on the load), turning from facing out to facing the hands during stand_with_load.
 */
function holdProne(h: Entity, e: Entity, task: string, i: number, pr: ProneStation, phase: string, q: Pose, k: number) {
  const feet = h.pose.p;
  const grip = receiverHands(e, q, feet);
  const fi = pr.hold === 'left' ? 1 : 0; // the free hand
  const face = datan2(pr.out[1], pr.out[0]);
  const deck = (j: number) => proneDeckHand(feet, pr.frame.f, j), lip = (j: number) => proneLipHand(feet, pr.frame.f, j, pr.out);
  let hands: [Vec3, Vec3] = grip, activity = phase, yaw = face, lying = true;
  if (phase === 'reach_down') {
    activity = PRONE_ACTIVITY.reach;
    hands = [along([deck(0), lip(0), grip[0]], smooth(k)), along([deck(1), lip(1), grip[1]], smooth(k))];
  } else if (phase === 'take') activity = PRONE_ACTIVITY.reach;
  else if (phase === 'push_up') {
    activity = PRONE_ACTIVITY.pushUp;
    hands[fi] = along([grip[fi], lip(fi), deck(fi)], smooth(Math.min(1, k / PUSH_HAND_K)));
  } else if (phase === 'kneel_up') {
    activity = PRONE_ACTIVITY.kneelUp;
    hands[fi] = along([deck(fi), lip(fi), grip[fi]], smooth(k));
  } else {
    // kneeling up with it: from the lying heading (the knees stay where they lay) to facing the hands
    lying = false;
    const c: Vec2 = [(grip[0][0] + grip[1][0]) / 2, (grip[0][2] + grip[1][2]) / 2];
    const toward = datan2(c[1] - feet[2], c[0] - feet[0]);
    yaw = phase === 'stand_with_load' ? pr.frame.yaw + angleDelta(pr.frame.yaw, toward) * smooth(k) : toward;
  }
  h.pose.yaw = yaw;
  Object.assign(h.human!, { activity, task, grip: { entity: e.id, slot: `${HANDUP_SLOT_PREFIX}prone-${i}:${pr.hold}` }, phaseK: k });
  if (lying) h.human!.proneYaw = pr.frame.yaw;
  else delete h.human!.proneYaw;
  setHands(h, hands);
}

/** Prone receivers lying down at their stations (k = fraction of T.lieDown): hands from the hips to flat on the deck; the
 *  body turns from facing out (pose.yaw) to its lying heading (`human.proneYaw`) as it goes down. */
function lieDown(rt: Runtime, ex: Exec, k: number) {
  for (const st of ex.prog.stations) {
    if (!st.prone) continue;
    const h = rt.world.entities[st.actor];
    const rest = restHands(h), s = smooth(Math.min(1, k));
    const mix = (a: Vec3, b: Vec3): Vec3 => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
    const face = datan2(st.prone.out[1], st.prone.out[0]);
    h.pose.yaw = face;
    Object.assign(h.human!, { activity: k < 1 ? PRONE_ACTIVITY.lieDown : PRONE_ACTIVITY.wait, task: ex.id, grip: undefined, phaseK: Math.min(1, k), proneYaw: face + angleDelta(face, st.prone.frame.yaw) * s });
    setHands(h, [mix(rest[0], proneDeckHand(h.pose.p, st.prone.frame.f, 0)), mix(rest[1], proneDeckHand(h.pose.p, st.prone.frame.f, 1))]);
  }
}

function release(rt: Runtime, who: string[]) {
  for (const a of who) {
    const h = rt.world.entities[a];
    Object.assign(h.human!, { activity: 'idle', grip: undefined, task: undefined });
    delete h.human!.phaseK; // prone receivers only (never set on anyone else: pinned worlds are unchanged)
    delete h.human!.proneYaw;
    setHands(h, undefined);
  }
}

/** Receivers' access chains: submit each step as a child action once the previous one completed. */
function stepChains(rt: Runtime, ex: Exec): 'running' | 'done' | Diagnostic {
  let all = true;
  for (let i = 0; i < ex.prog.chains.length; i++) {
    const ch = ex.prog.chains[i];
    // sharing one frame: the other receiver starts once the lead stands at their station
    const lead = ex.prog.lead;
    if (lead >= 0 && i !== lead && ex.chainAt[i] === 0 && !ex.chainRec[i] && ex.chainAt[lead] < ex.prog.chains[lead].length) { all = false; continue; }
    const rec = ex.chainRec[i];
    if (rec) {
      if (rec.status === 'completed') { ex.chainAt[i]++; ex.chainRec[i] = null; }
      else if (rec.status === 'failed' || rec.status === 'cancelled') return rec.diagnostic ?? { code: 'handup.receiver-failed', message: `${rec.verb} for ${ex.prog.stations[i].actor} ended ${rec.status}` };
      else { all = false; continue; }
    }
    if (ex.chainAt[i] >= ch.length) continue;
    all = false;
    const step = ch[ex.chainAt[i]];
    const r = rt.submit(step.verb, step.params, { parent: ex.id });
    if (r.status === 'failed') {
      // someone briefly in the way on the beam: try again (for up to 10 s)
      if (r.diagnostic?.code === 'beam.occupied' && (ex.retry[i] += 1) < 200) continue;
      return { ...r.diagnostic!, message: `receiver ${ex.prog.stations[i].actor} cannot get to their station: ${r.diagnostic!.message}` };
    }
    ex.chainRec[i] = r;
  }
  return all ? 'done' : 'running';
}

function stepHandup(rt: Runtime, ex: Exec, dt: number): StepResult {
  const w = rt.world;
  const e = w.entities[ex.p.part];
  const prog = ex.prog;
  const givers = ex.p.givers ?? [];
  // receivers get up there (in parallel with everything the givers do)
  if (!ex.receiversReady) {
    const c = stepChains(rt, ex);
    if (typeof c === 'object') return { status: 'failed', diagnostic: c };
    if (c === 'done') {
      ex.receiversReady = true;
      for (const st of prog.stations) Object.assign(w.entities[st.actor].human!, { activity: 'wait', task: ex.id });
    }
  }
  // prone receivers lie down at the edge as soon as they are there (while the givers work)
  const prone = prog.stations.some((s) => s.prone);
  if (prone && ex.receiversReady && ex.ri === 0 && ex.rt === 0) {
    ex.lie = Math.min(T.lieDown, ex.lie + dt);
    lieDown(rt, ex, ex.lie / T.lieDown);
  }
  // givers: walk to the pickup, then their segments
  if (prog.mode === 'hand' && !ex.givingDone) {
    if (!ex.walk) {
      const r = walkCrew(rt, ex.id, prog.pickup.map((m) => ({ actor: m.actor, p: m.p, yaw: m.yaw, level: w.entities[m.actor].human!.level })));
      if ('code' in r) return { status: 'failed', diagnostic: { ...r, code: 'handup.giver-unreachable' } };
      ex.walk = r;
    }
    const s = ex.gi < 0 ? childrenState(ex.walk) : 'done';
    if (typeof s === 'object') return { status: 'failed', diagnostic: s };
    if (s === 'running') return { status: 'running', phase: 'approach' };
    if (ex.gi < 0) {
      ex.gi = 0;
      ex.gt = 0;
    }
    const seg = prog.giverSegs[ex.gi];
    if (seg) {
      ex.gt += dt;
      const q = poseAt(seg, ex.gt);
      if (seg.phase === 'lift' && e.phase !== 'carried') {
        e.phase = 'carried';
        e.support = { kind: 'held', by: [...givers] };
      }
      if (seg.phase !== 'crouch') e.pose = q;
      holdGivers(rt, ex, seg.phase === 'push' ? 'reach_up' : seg.phase, e.pose, seg.phase === 'walk-load' || seg.phase === 'push', seg.phase === 'crouch' ? phaseK(seg, ex.gt) : undefined);
      if (ex.gt >= seg.dur - 1e-9) { ex.gi++; ex.gt = 0; }
      return { status: 'running', phase: seg.phase };
    }
    // holding it up at the edge until the receivers are there and have it
    if (ex.ri < 2) holdGivers(rt, ex, 'reach_up', e.pose, false);
  }
  if (!ex.receiversReady) return { status: 'running', phase: prog.mode === 'hand' ? 'hold' : 'receivers' };
  if (prone && ex.lie < T.lieDown - 1e-9) return { status: 'running', phase: 'lie_down' };
  // receivers' segments
  const seg = prog.receiverSegs[ex.ri];
  ex.rt += dt;
  if (seg.phase === 'reach_down' && prog.mode === 'hand' && e.support?.kind === 'held' && !e.support.by.includes(prog.stations[0].actor))
    e.support = { kind: 'held', by: [...givers, ...prog.stations.map((s) => s.actor)] };
  if ((seg.phase === 'stand_with_load' || seg.phase === 'push_up') && e.support?.kind !== 'held') {
    e.phase = 'carried';
    e.support = { kind: 'held', by: prog.stations.map((s) => s.actor) };
  }
  if (seg.phase !== 'reach_down' && seg.phase !== 'take') e.pose = poseAt(seg, ex.rt);
  holdReceivers(rt, ex, seg.phase, e.pose, seg.phase === 'reach_down' ? phaseK(seg, ex.rt) : undefined, phaseK(seg, ex.rt));
  if (prog.mode === 'hand' && ex.ri < 2) holdGivers(rt, ex, 'reach_up', e.pose, false);
  if (ex.rt < seg.dur - 1e-9) return { status: 'running', phase: seg.phase };
  // segment done
  if (seg.phase === 'take' && prog.mode === 'hand') {
    // the receivers have it: the givers let go
    release(rt, givers);
    e.support = { kind: 'held', by: prog.stations.map((s) => s.actor) };
    ex.givingDone = true;
  }
  ex.ri++;
  ex.rt = 0;
  if (ex.ri < prog.receiverSegs.length) return { status: 'running', phase: seg.phase };
  // laid in place, staged on the structure
  e.pose = { ...prog.final, p: [...prog.final.p] as Vec3 };
  e.phase = 'staged';
  e.support = { kind: 'resting-on', on: prog.rest.supports[0] };
  release(rt, prog.stations.map((s) => s.actor));
  spatialOf(rt);
  return { status: 'completed', outputs: { part: e.id, at: [...e.pose.p], supports: prog.rest.supports, edge: prog.edge, stations: prog.stations.map((s) => [s.actor, s.walkway ?? `deck level ${s.deck}`, ...s.feet, ...(s.prone ? ['prone'] : [])]) } };
}

export const handUp: ActionDef<HP, HandupProgram, Exec> = {
  verb: 'hand_up',
  description: `Hand a sheet or board up to people standing on the rack beams (or a deck): 1–2 givers lift it off the ground and raise it overhead at the edge (underside ≤ their floor + ${GIVE_MAX} m), 1–2 receivers reach down (kneeling ≤ ${REACH_DOWN} m below their feet; where that is not enough, lying prone at a deck edge ≤ ${REACH_DOWN_PRONE} m below the deck, getting up holding it), take it and lay it in place, staged for install_*; via 'forklift' the receivers take it off the presented forks. Refused when the geometry allows no genuine hand-off.`,
  schema: z.strictObject({
    part: z.string().max(80),
    givers: z.array(z.string().max(80)).max(2).optional(),
    receivers: z.array(z.string().max(80)).min(1).max(2),
    to: z.strictObject({ x: z.number().min(-1e4).max(1e4), z: z.number().min(-1e4).max(1e4), yaw: z.number().min(-10).max(10) }),
    edge: z.string().max(80).optional(),
    via: z.enum(['hand', 'forklift']).optional(),
    operator: z.string().max(80).optional(),
    stations: z.array(z.strictObject({ x: z.number().min(-1e4).max(1e4), z: z.number().min(-1e4).max(1e4) })).max(2).optional(),
  }),
  reservations: (w, p) => [
    ...[...(p.givers ?? []), ...p.receivers].map((c) => ({ resource: `actor:${c}`, mode: 'exclusive' as const })),
    { resource: `entity:${p.part}`, mode: 'exclusive' },
    ...(p.operator && w.entities[p.operator]?.human?.riding ? [{ resource: `entity:${w.entities[p.operator].human!.riding}`, mode: 'exclusive' as const }] : []),
  ],
  resumable: 'hand_up drives child walks / climbs and holds a load in the air between two crews; its exec is not serialised',
  plan: planHandup,
  start(rt, p, prog, id) {
    const e = rt.world.entities[p.part];
    if (prog.mode === 'hand') e.phase = 'reserved';
    return { id, p, prog, gi: -1, gt: 0, ri: 0, rt: 0, chainAt: prog.chains.map(() => 0), chainRec: prog.chains.map(() => null), retry: prog.chains.map(() => 0), givingDone: prog.mode !== 'hand', receiversReady: false, lie: 0 };
  },
  step: stepHandup,
  cancel(rt, ex) {
    const e = rt.world.entities[ex.p.part];
    if (e.phase === 'carried' && e.support?.kind === 'held')
      return { ok: false, diagnostic: { code: 'handup.cancel-unsafe', message: `${e.id} is in the air between the crews; it cannot be abandoned`, subjects: [e.id] } };
    if (ex.prog.mode === 'hand' && e.phase === 'reserved') e.phase = 'staged';
    return { ok: true };
  },
};
