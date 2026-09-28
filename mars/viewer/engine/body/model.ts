// One body model (OWNER_DECISIONS 2026-09-28 "One body model"; docs/engineering/BODY_MODEL.md).
// The single source of truth for where a Mars person's hands can be: hand-up (construction/handup.ts),
// hand-held items and eating (items/body.ts), solar (construction/solar.ts), fastening aloft
// (construction/aloft.ts), paint (work/paint.ts) and station reach (construction/access.ts) import
// these numbers; the renderer scales the rig's arm bones to `armLength` from `shoulderHeight` once per
// template (W9) and a Playwright test pins measured rig reach to this model within 2 cm.
// A real ~1.75 m adult. Heights are above the feet (the person's ground point, `pose.p`), horizontal
// distances from the body axis. Anything outside is refused by the engine, never interpolated.
import { dcos, dsin, type Vec3 } from '../core/math.ts';
import type { Entity } from '../world/types.ts';

/** Shoulder-height band above the feet for a posture, and how far the shoulders may lean out horizontally. */
export type Posture = { lo: number; hi: number; lean: number };

const shoulderHeight = 1.42;
const heelRaise = 0.06;
const armLength = 0.62;

export const BODY_MODEL = {
  height: 1.75,
  shoulderHeight, // shoulder joints, standing
  shoulderHalf: 0.19, // each shoulder joint off the body axis
  armLength, // shoulder joint → palm centre
  heelRaise, // up on the toes
  /** Palm centre straight overhead, heels down (hands in front of the head, so < shoulder + arm). */
  overheadReach: 2.0,
  /** overheadReach + heelRaise: the highest a hand (a load's underside) goes above the floor — the §5 "standing reach". */
  overheadMax: 2.0 + heelRaise,
  /** Lowest a standing painter's brush goes above the floor (lower bands are not modelled). */
  lowReach: 0.5,
  /** Kneeling at a deck / beam edge: hands at most this far below the feet (owner feedback §6). */
  reachDownBelowFeet: 1.0,
  /** Horizontal: hands at most this far from the feet when working a part from a station (the kneel rule at a hand-off). */
  maxHorizontalFromFeet: 0.8,
  /** At a hand-off, a receiver's hands at most this far beyond the edge they kneel at (owner feedback §6 ≈ 0.5 m). */
  edgeReach: 0.5,
  /** Hand-held items: hands this far beyond the edge of the table a person stands at (bending at the hips). */
  tableReach: 0.6,
  /** Shoulder band + lean per posture family (the envelope: a shoulder cylinder above the feet + the arm). */
  posture: {
    /** standing / walking with a load / reaching up: shoulders ≤ shoulderHeight + heelRaise */
    upright: { lo: 1.3, hi: shoulderHeight + heelRaise, lean: 0.2 },
    /** crouching / squatting to grip or lift from the knees */
    crouch: { lo: 0.55, hi: shoulderHeight + heelRaise, lean: 0.35 },
    /** kneeling at an edge / bent over it at the hips: shoulders down to 0.15 m below the feet */
    bentOver: { lo: -0.15, hi: shoulderHeight + heelRaise, lean: 0.45 },
    /** painting a vertical face in front of them */
    painting: { lo: 0.9, hi: shoulderHeight + heelRaise, lean: 0.35 },
  } satisfies Record<string, Posture>,
  /** Seated on a chair / bench: landmark heights drop this much (pelvis on a ~0.45 m seat). */
  seatedDrop: 0.45,
  chestHeight: 1.3, // sternum, standing
  chestFwd: 0.08, // sternum ahead of the body axis
  mouthHeight: 1.58,
  mouthFwd: 0.15, // the spoon hand's target, in front of the head
  /** Empty hands hanging at the hips (shoulderHeight − armLength = 0.80 m): where a crouch / reach starts from. */
  restHand: { up: 0.8, side: 0.22, fwd: 0.02 }, // up = shoulderHeight − armLength (written out: the float difference is 0.7999…)
  /** Hand carrying a small item (walking, sitting): in front of the hip. */
  carryHand: { up: 1.0, side: 0.16, fwd: 0.28 },
} as const;

/** How far a hand is outside the envelope of `pz` for a person standing at `feet` (≤ 0 = inside): the
 *  horizontal distance beyond the shoulders' lean and the height outside their band, against the arm. */
export function postureGap(pz: Posture, feet: readonly number[], hand: readonly number[]): number {
  const dx = hand[0] - feet[0], dz = hand[2] - feet[2];
  const dh = Math.max(0, Math.sqrt(dx * dx + dz * dz) - pz.lean);
  const rel = hand[1] - feet[1];
  const dv = Math.max(0, pz.lo - rel, rel - pz.hi);
  return Math.sqrt(dh * dh + dv * dv) - BODY_MODEL.armLength;
}

// ---- body frame and landmarks (world points) ----
// A person's frame is their ground point `pose.p` (body axis, level height), forward f = (cos yaw, sin yaw)
// and right r = (−sin yaw, cos yaw) in (x, z); heights are above the ground point, lowered by `drop` while seated.
export type Hand = 'left' | 'right';
export const HANDS: readonly Hand[] = ['left', 'right'];
export const otherHand = (h: Hand): Hand => (h === 'left' ? 'right' : 'left');
/** +1 right, −1 left (along r). */
export const sideOf = (h: Hand) => (h === 'right' ? 1 : -1);

export type BodyFrame = { o: Vec3; f: [number, number]; r: [number, number]; drop: number };

export function bodyFrame(e: Entity, drop = 0): BodyFrame {
  const c = dcos(e.pose.yaw), s = dsin(e.pose.yaw);
  return { o: e.pose.p, f: [c, s], r: [-s, c], drop };
}

/** World point `fwd` ahead, `right` to the right and `up` above the ground point (seated drop applied). */
export function at(b: BodyFrame, fwd: number, right: number, up: number): Vec3 {
  return [b.o[0] + b.f[0] * fwd + b.r[0] * right, b.o[1] + up - b.drop, b.o[2] + b.f[1] * fwd + b.r[1] * right];
}

const M = BODY_MODEL;
export const chestPoint = (b: BodyFrame) => at(b, M.chestFwd, 0, M.chestHeight);
export const shoulderPoint = (b: BodyFrame, h: Hand) => at(b, 0, sideOf(h) * M.shoulderHalf, M.shoulderHeight);
export const mouthPoint = (b: BodyFrame) => at(b, M.mouthFwd, 0, M.mouthHeight);
/** Empty hand hanging at the side. */
export const restHand = (b: BodyFrame, h: Hand) => at(b, M.restHand.fwd, sideOf(h) * M.restHand.side, M.restHand.up);
/** Hand carrying a small item (walking, sitting): in front of the hip. */
export const carryHand = (b: BodyFrame, h: Hand) => at(b, M.carryHand.fwd, sideOf(h) * M.carryHand.side, M.carryHand.up);
/** Both empty hands [left, right] hanging at the hips of person `e` (where the renderer puts hands no engine point drives). */
export const restHands = (e: Entity): [Vec3, Vec3] => { const b = bodyFrame(e); return [restHand(b, 'left'), restHand(b, 'right')]; };
