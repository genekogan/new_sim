// Prone receiver (owner feedback §13; engine HANDUP.md "Prone receiver", BODY_MODEL.md "Prone receiver + rise"; docs
// POSES.md "Prone receiver"): the body of a receiver who lies on their stomach at a deck edge, reaches down, takes the
// load and gets up holding it — push-up on one hand, knees, feet. Pure numbers (no three.js objects), like posture.ts;
// humans.ts applies the result to the rig and runs the arm IK on the engine's hand points (reach honesty unchanged).
//
// One rise coordinate r through the whole thing, the engine's hip heights at its knots:
//   r = 0  lying on the stomach, pelvis pitched 90°, hips `lieHip` above the deck (the front of the body on it), the
//          body perpendicular to the edge with the chest over the lip and the head beyond it (the tip joint just past
//          the lip, so tipping the chest down over the edge never cuts the deck corner);
//   r = 1  on both knees (knees at S, hip joints KNEE_Y + thigh ≈ 0.46 m up), bent forward: a hand on the deck;
//   r = 2  kneeling up (the torso as upright as the hands allow);
//   r = 3  standing (the clip's legs).
// lie-down runs 3 → 0, push-up 0 → 1, kneel-up 1 → 2; stand_with_load hands over to the posture solver (humans.ts
// blends the bones over 0.4 s). Per tick a small grid search picks the torso pitch (flat … a 60° tip over the edge
// lying, anything to 150° kneeling) and a turn of the whole body about S (≤ 35°: the renderer's reading, as the stance
// turn toward a load in frame-gait.ts) that bring the shoulders within reach of the engine's hand points, keeping every
// spine point over the deck at least the body's front depth above it.
import { BEND_SHARE, KNEE_Y, type Dims, type Target } from './posture.ts';
import { PRONE_ACTIVITY, PRONE_BACK, T as PHASE_T } from '../../engine/construction/handup.ts';
import { DT } from '../../engine/runtime/runtime.ts';

const DEG = Math.PI / 180;
/** Activities with the prone layer (engine PRONE_ACTIVITY). */
export const PRONE_ACTS: ReadonlySet<string> = new Set(Object.values(PRONE_ACTIVITY));
/** Torso tip over the edge while lying (engine BODY_MODEL.prone.tipMax). */
export const TIP_MAX = 60 * DEG;
/** Torso pitch from vertical: lying flat, most bent (lying tipped, or kneeling over the edge). */
const FLAT = 90 * DEG, BEND_HI = 150 * DEG;
/** The whole body may turn about S toward the hands by at most this, lying on the deck (renderer; the engine keeps pose.yaw). */
export const TURN_MAX = 45 * DEG;
/** Deck lip ahead of S along the facing (engine PRONE_BACK). */
export const LIP = PRONE_BACK;
/** Getting up, r rises at most this much per tick (a unit in 0.35 s). */
export const RISE_STEP = DT / 0.35;
/** Plan reach (fraction of the arm): as posture.ts. */
const PLAN_REACH = 0.92;
/** Share of the lying spine bend (the tip) per joint, cumulative (Hips, Abdomen, Torso): all at the Torso joint. */
const LIE_SHARE = [0, 0, 1];
/** The tip joint lies this far beyond the lip (≥ its height · (sin 60° − tan 30° cos 60°) ≈ 0.58 × 0.13 m keeps a 60° tip off the deck corner). */
const TIP_PAST_LIP = 0.08;

/**
 * Pose of the prone layer: rise coordinate, torso pitch from vertical (rad), body turn about S relative to the engine's
 * yaw (rad), the rendered yaw (engine yaw + turn; kept while the layer fades out, so the body does not swing), weight.
 */
export type ProneState = { r: number; bend: number; turn: number; yaw: number; w: number };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/**
 * Rise coordinate for a prone activity, `age` ticks after it began (the engine's phase clocks: T.lieDown 0.8 s,
 * push-up ≥ T.pushUp 0.8 s, kneel-up ≥ T.kneelUp 0.6 s; a phase lasting longer — the load rising at ≤ 0.5 m/s — ends
 * with the body waiting at the knot while the hands keep rising).
 */
export function riseOf(activity: string, age: number): number {
  const k = (t: number) => smooth(Math.min(1, ((age + 1) * DT) / t));
  if (activity === PRONE_ACTIVITY.lieDown) return 3 * (1 - k(PHASE_T.lieDown));
  if (activity === PRONE_ACTIVITY.pushUp) return k(PHASE_T.pushUp);
  if (activity === PRONE_ACTIVITY.kneelUp) return 1 + k(PHASE_T.kneelUp);
  return 0; // prone-wait, prone-reach
}

/**
 * Where the lip is along a body turned by `turn` from facing straight out: 0.35 m / cos(turn) on its axis, and the
 * chest's near side (half a chest, shoulder half-width + 3 cm, across) reaches it that much earlier — so the tip joint
 * goes that much further out, and a turned chest tipping over the edge stays off the deck corner on both sides.
 */
export function lipAlong(d: Dims, turn: number) {
  return LIP / Math.cos(turn) + (d.shHalf + 0.03) * Math.abs(Math.tan(turn));
}

/** Hip joints (f, up above the deck) lying flat: the tip joint TIP_PAST_LIP beyond the lip at `lip` (along the body). */
function lieHipF(d: Dims, lip: number) {
  // lying flat (everything pitched 90°), a standing vector (f, up) points (up, −f): the tip joint is this far ahead
  const toTip = d.pivotUp + d.chain[0].up + d.chain[1].up;
  return lip + TIP_PAST_LIP - toTip;
}

export type ProneFrame = {
  /** Hip-joint midpoint (f, up above the deck). */
  hip: { f: number; up: number };
  /** Pelvis pitch (rad, forward). */
  pitch: number;
  /** Cumulative share of the spine bend (bend − pitch) at the Hips, Abdomen, Torso joints. */
  share: number[];
  /** Spine points (f, up): pivot, abdomen, torso joint, shoulder midpoint, head (a neck + head length on). */
  spine: { f: number; up: number }[];
};

/** Body frame for rise `r` and torso pitch `bend` (the lip `lip` m ahead along the body). */
export function proneFrame(d: Dims, r: number, bend: number, lip: number): ProneFrame {
  const kneelHip = KNEE_Y + d.thigh;
  let hip: { f: number; up: number }, pitch = 0, share = BEND_SHARE;
  if (r >= 2) hip = { f: 0, up: lerp(kneelHip, d.hipH, smooth(r - 2)) };
  else if (r >= 1) hip = { f: 0, up: kneelHip };
  else {
    const k = smooth(r);
    hip = { f: lerp(lieHipF(d, lip), 0, k), up: lerp(d.lieHip, kneelHip, k) };
    pitch = (1 - k) * FLAT;
    share = LIE_SHARE.map((s, i) => lerp(s, BEND_SHARE[i], k));
  }
  const b = bend - pitch;
  const rot = (v: { f: number; up: number }, a: number) => ({ f: v.f * Math.cos(a) + v.up * Math.sin(a), up: v.up * Math.cos(a) - v.f * Math.sin(a) });
  const piv = rot({ f: d.pivotF, up: d.pivotUp }, pitch);
  const pts = [{ f: hip.f + piv.f, up: hip.up + piv.up }];
  d.chain.forEach((sg, i) => {
    const s = rot(sg, pitch + share[i] * b), q = pts[pts.length - 1];
    pts.push({ f: q.f + s.f, up: q.up + s.up });
  });
  // the head: 0.25 m on along the last segment's direction
  const last = rot({ f: 0, up: 0.25 }, pitch + share[2] * b), sh = pts[pts.length - 1];
  pts.push({ f: sh.f + last.f, up: sh.up + last.up });
  return { hip, pitch, share, spine: pts };
}

/** Pushing up, the spine may arch back (the chest raised on a straight arm, the hips still down) this far. */
const ARCH = 25 * DEG;
/** Pitch range (from vertical) and natural pitch for rise r: lying the spine tips forward over the edge (≤ 60°), pushing
 *  up it may arch back a little; kneeling anything to 150° (bent over the edge, as the engine's kneel-up envelope). */
function bendRange(r: number): [number, number, number] {
  if (r < 1) {
    const k = smooth(r);
    return [Math.max(0, (1 - k) * FLAT - ARCH * Math.min(1, r * 4)), lerp(FLAT + TIP_MAX, BEND_HI, k), lerp(FLAT, 100 * DEG, k)];
  }
  if (r < 2) return [0, BEND_HI, lerp(100 * DEG, 20 * DEG, r - 1)];
  return [0, BEND_HI, lerp(20 * DEG, 0, r - 2)];
}

/** Shoulder girdle reach toward a hand lying prone (engine BODY_MODEL.prone: "girdle reaching down 2 × shrug"). */
export const GIRDLE = 0.1;
/** The deck edge in the body's (f, up) plane: the slab behind the lip, the edge beam under it (face 2.5 cm out, 0.21 m down). */
const BEAM_OUT = 0.025, BEAM_DOWN = 0.21;
/** Distance from (f, up) to the deck slab + edge beam (0 inside). */
export function edgeGap(f: number, up: number, lip: number) {
  const box = (f0: number, f1: number, u0: number, u1: number) => Math.hypot(Math.max(f0 - f, 0, f - f1), Math.max(u0 - up, 0, up - u1));
  return Math.min(box(-Infinity, lip, -Infinity, 0), box(lip, lip + BEAM_OUT, -BEAM_DOWN, 0));
}

/**
 * Rise, torso pitch and body turn that bring the shoulders within reach of `ts` (targets relative to S, in the
 * engine's facing frame: f ahead, lat right, up above the deck): grid search, deterministic. r lies in [rLo, rHi]
 * (the engine's clock is rHi: getting up, the body may wait for the load it holds, never go back down); within reach
 * first (the girdle's 0.1 m last), then every spine / head point a chest depth off the deck slab and the edge beam
 * (not through the deck), then r close to the clock, the torso near its natural pitch for r, the body straight, and
 * both near where they were (`prev`: no turning back and forth).
 */
export function solveProne(d: Dims, ts: Target[], rLo: number, rHi: number, onDeck?: (f: number, lat: number) => boolean, prev?: { bend: number; turn: number }): { r: number; bend: number; turn: number } {
  const NR = rHi - rLo > 1e-6 ? 8 : 0, NT = Math.round((2 * TURN_MAX) / (5 * DEG));
  let best = { r: rHi, bend: bendRange(rHi)[2], turn: 0 }, bc = Infinity;
  for (let m = 0; m <= NR; m++) {
    const r = NR ? rLo + ((rHi - rLo) * m) / NR : rHi;
    const [lo, hi, nom] = bendRange(r);
    const NB = Math.max(1, Math.round((hi - lo) / (2.5 * DEG)));
    for (let i = 0; i <= NT; i++) {
      const turn = -TURN_MAX + (2 * TURN_MAX * i) / NT, c = Math.cos(turn), s = Math.sin(turn);
      const lip = lipAlong(d, turn);
      // turned, the body (hips → toes lying, knees and feet kneeling) must still lie on the deck
      if (turn && onDeck && !bodyOnDeck(d, r, lip, c, s, onDeck)) continue;
      const local = ts.map((t) => ({ f: t.f * c + t.lat * s, lat: -t.f * s + t.lat * c, up: t.up }));
      for (let j = 0; j <= NB; j++) {
        const bend = lo + ((hi - lo) * j) / NB;
        const fr = proneFrame(d, r, bend, lip);
        const sh = fr.spine[3];
        let err = 0, girdle = 0, close = 0, deck = 0;
        for (const t of local) {
          const side = t.lat >= 0 ? 1 : -1;
          const dist = Math.hypot(t.f - sh.f, t.up - sh.up, t.lat - side * d.shHalf);
          err += Math.max(0, dist - PLAN_REACH * d.armLen);
          girdle += Math.max(0, dist - PLAN_REACH * d.armLen - GIRDLE);
          close += Math.max(0, 0.4 * d.armLen - dist);
        }
        // the spine and the head keep a body depth off the deck slab and the edge beam
        for (let k = 1; k < fr.spine.length; k++) {
          const a = fr.spine[k - 1], b = fr.spine[k];
          for (let u = 0.25; u <= 1; u += 0.25) deck += Math.max(0, d.chestDepth - 0.005 - edgeGap(lerp(a.f, b.f, u), lerp(a.up, b.up, u), lip));
        }
        const cost = 40 * err + 400 * girdle + 30 * close + 300 * deck + 4 * (rHi - r) + Math.abs(bend - nom) + 0.3 * Math.abs(turn) + (prev ? 2 * Math.abs(turn - prev.turn) + 0.5 * Math.abs(bend - prev.bend) : 0);
        if (cost < bc - 1e-9) [best, bc] = [{ r, bend, turn }, cost];
      }
    }
  }
  return best;
}

/** The body's points on the deck (hips, knees, toes lying; knees, feet kneeling; ±0.12 m across) all over a deck. */
function bodyOnDeck(d: Dims, r: number, lip: number, c: number, s: number, onDeck: (f: number, lat: number) => boolean) {
  const hf = proneFrame(d, Math.min(r, 1), FLAT, lip).hip.f;
  const along = r < 1 ? [hf, hf - d.thigh, hf - d.legLen - 0.1] : [0, -0.45];
  for (const f of along) for (const lat of [-0.12, 0.12]) if (!onDeck(f * c - lat * s, f * s + lat * c)) return false;
  return true;
}

/** Move `cur` toward `goal` at ≤ 1.6 rad (pitch) / 0.5 rad (turn) per 0.4 s; r is rate-limited by the solve's range. */
export function approachProne(cur: ProneState | null, goal: ProneState, k: number): ProneState {
  if (!cur) return goal;
  const step = (a: number, b: number, max: number) => a + clamp(b - a, -max, max);
  return { ...goal, bend: step(cur.bend, goal.bend, 1.6 * k), turn: step(cur.turn, goal.turn, 0.5 * k) };
}

const lerpAngle = (a: number, b: number, t: number) => a + (((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * t;
/** Between two ticks (a layer starting or ending at b / a: that one's pose at weight 0). */
export const lerpProne = (a: ProneState | null, b: ProneState | null, t: number): ProneState | null => {
  if (!a && !b) return null;
  const p = a ?? { ...b!, w: 0 }, q = b ?? { ...a!, w: 0 };
  return { r: lerp(p.r, q.r, t), bend: lerp(p.bend, q.bend, t), turn: lerp(p.turn, q.turn, t), yaw: lerpAngle(p.yaw, q.yaw, t), w: lerp(p.w, q.w, t) };
};
