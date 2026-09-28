// One body model (OWNER_DECISIONS 2026-09-28 "One body model"; docs/engineering/BODY_MODEL.md).
// The single source of truth for where a Mars person's hands can be: hand-up (construction/handup.ts),
// hand-held items and eating (items/body.ts), solar (construction/solar.ts), fastening aloft
// (construction/aloft.ts), paint (work/paint.ts) and station reach (construction/access.ts) import
// these numbers; the renderer scales the rig's arm bones to `armLength` from `shoulderHeight` once per
// template (W9) and a Playwright test pins measured rig reach to this model within 2 cm. Since
// 2026-09-28 ("Body model = the measured rig") the model IS the measured rig: a 1.75 m person with the
// rigs' 1.34 m shoulders; test/body-model.test.ts checks it is internally consistent. Heights are above the feet (the person's ground point, `pose.p`), horizontal
// distances from the body axis. Anything outside is refused by the engine, never interpolated.
import { dcos, dsin, type Vec3 } from '../core/math.ts';
import type { Entity } from '../world/types.ts';

/** Shoulder-height band above the feet for a posture, and how far the shoulders may lean out horizontally. */
export type Posture = { lo: number; hi: number; lean: number };

// Measured rig (W9, e2e/poses.spec.ts "body model", POSES.md "Body model"; OWNER_DECISIONS 2026-09-28
// "Body model = the measured rig"): the three Quaternius templates scaled to 1.75 m.
const shoulderHeight = 1.34; // shoulder joints standing (the rigs' big heads: a real adult's are ≈ 1.42)
const shrug = 0.05; // shoulder rise with a hand ≥ 0.5 m above it (clavicle, then the girdle)
const heelRaise = 0.06;
const armLength = 0.62;
/** Every posture's shoulder band tops out here: shoulders + shrug + heels (1.45 m) — so an arm straight up
 *  reaches 2.07 m ≥ overheadMax (the stated 2.06 cap binds, not the envelope). */
const shoulderTop = shoulderHeight + shrug + heelRaise;
/** Rig proportions the posture bands are derived from (POSES.md: measured once per rig, casual / punk). */
const RIG = {
  hip: 0.89, // hip joints standing
  torso: 0.45, // hip joints → shoulder joints (1.34 − 0.89)
  squatHip: 0.42, // deepest squat: hip joints above the floor (rig.ts)
  squatBend: 80, // ° torso bend lifting from the knees (rig.ts bendMax.knees)
  kneelHip: 0.46, // one-knee kneel: hip joints above the floor (casual / punk; woman 0.51)
  kneelBend: 150, // ° torso bend kneeling over an edge (rig.ts bendMax.kneel)
} as const;

/**
 * Prone receiver (owner feedback §13, Gene 2026-09-29: "lies on their stomach at the edge of the upper floor … then
 * gets up without letting go"). Geometry, all from numbers above (BODY_MODEL.md "Prone receiver"):
 * - the receiver kneels at station S on the deck, `back` 0.35 m behind the lip (a standable point: the spatial body
 *   radius 0.28 m, read on the 0.1 m clearance raster — 0.30 m from an edge reads 0.25 m), and lies down forward,
 *   perpendicular to the edge, head over it;
 * - the lower ribs rest on the lip; the torso beyond them (`overEdge` = RIG.torso × 2/3 = 0.30 m) tips down over the
 *   edge up to `tipMax` 60°; lying flat the shoulder joints are `chest` (= chestFwd 0.08) above the deck, so at
 *   the full tip they are 0.08 cos 60° − 0.30 sin 60° = −0.22 m, and the girdle reaching down (2 × shrug) takes
 *   them to −0.32 m: the band's bottom; the arm then reaches 0.32 + 0.62 = 0.94 m below the deck (`reachDown`;
 *   the §13 "≈ 1.0 m");
 * - shoulders at most `back` + `overEdge` = 0.65 m from S horizontally (the band's lean; at the full tip they are
 *   0.22 m past the lip); hands at the hand-off at most `edgeReach` (= reachDownOut 0.45) beyond the deck outline;
 * - the body lies from the lip back to its toes: hips torso/3 behind the lip, legs RIG.hip + a 6 cm foot, so the
 *   toes are `bodyBack` = 0.75 m behind S; half-width `bodyHalf` = shoulderHalf + 5 cm.
 */
const PRONE_BACK = 0.35;
const PRONE_OVER = (RIG.torso * 2) / 3; // 0.30
const PRONE_TIP = 60; // °
const PRONE_CHEST = 0.08; // = chestFwd: the sternum on the deck, the shoulder joints this far above it
const proneShoulderLo = PRONE_CHEST * dcos((PRONE_TIP * Math.PI) / 180) - PRONE_OVER * dsin((PRONE_TIP * Math.PI) / 180) - 2 * shrug; // −0.3198
const PRONE = {
  back: PRONE_BACK,
  overEdge: PRONE_OVER,
  tipMax: PRONE_TIP,
  chest: PRONE_CHEST,
  /** Hands flat on the deck beside the chest (lying, and the push-up hand): 0.15 m behind the lip, 0.25 m to each side. */
  deckHand: { fwd: PRONE_BACK - 0.15, side: 0.25 },
  /** S → toes, lying (hips torso/3 behind the lip; legs RIG.hip + 0.06 m foot). */
  bodyBack: RIG.hip + 0.06 - (PRONE_BACK - RIG.torso / 3),
  bodyHalf: 0.15 + 0.05,
  /** Hands at most this far below the deck (= the prone band's bottom − arm, rounded to the cm). */
  reachDown: Math.round((armLength - proneShoulderLo) * 100) / 100, // 0.94
  /** At the hand-off, hands at most this far beyond the deck outline (= reachDownOut). */
  edgeReach: 0.45,
  /** Shoulder bands (feet = S) per phase of the rise; `hip` = hip-joint heights above the deck at the phase's end. */
  posture: {
    /** lying at the edge, reaching down over it (hi: lying flat = chest; lo: the full tip + girdle, rounded to the cm) */
    prone: { lo: Math.round(proneShoulderLo * 100) / 100, hi: PRONE_CHEST, lean: PRONE_BACK + PRONE_OVER },
    /** push-up on one straight arm (the other holds the load): shoulders from the prone bottom to an arm above the deck */
    pushUp: { lo: Math.round(proneShoulderLo * 100) / 100, hi: armLength, lean: PRONE_BACK + PRONE_OVER },
    /** knees → kneeling upright, still bent over the edge: bentOver's bottom to kneelHip + torso (0.91) */
    kneelUp: { lo: Math.round((RIG.kneelHip + RIG.torso * dcos((RIG.kneelBend * Math.PI) / 180)) * 100) / 100, hi: RIG.kneelHip + RIG.torso, lean: 0.35 },
  } satisfies Record<string, Posture>,
  /** Hip-joint heights above the deck through the rise: lying (≈ half the pelvis), on the knees (thigh vertical =
   *  RIG.kneelHip), standing (RIG.hip). */
  hip: { prone: 0.1, pushUp: RIG.kneelHip, kneelUp: RIG.kneelHip, stand: RIG.hip },
} as const;

export const BODY_MODEL = {
  height: 1.75,
  shoulderHeight, // shoulder joints, standing (measured rig 1.340)
  shoulderHalf: 0.15, // each shoulder joint off the body axis (measured 0.116–0.146)
  armLength, // shoulder joint → palm centre (measured 0.620)
  shrug,
  heelRaise, // up on the toes
  rig: RIG,
  /** Palm centre straight overhead, heels down (measured 1.997: shoulders + shrug + 0.97 × arm, the elbow never locks). */
  overheadReach: 2.0,
  /** overheadReach + heelRaise: the highest a hand (a load's underside) goes above the floor — the §5 "standing reach" (measured 2.057). */
  overheadMax: 2.0 + heelRaise,
  /** Lowest a standing painter's brush goes above the floor (lower bands are not modelled). */
  lowReach: 0.5,
  /** Kneeling on one knee at a deck / beam edge, bent over it: hands at most this far below the feet.
   *  Measured 0.35 (woman) – 0.54 m (casual, punk) with the hands reachDownOut ahead of the feet; the spec's
   *  ≈ 1.0 m is superseded (OWNER_DECISIONS "Body model = the measured rig"): deeper hand-offs → the forklift. */
  reachDownBelowFeet: 0.5,
  reachDownOut: 0.45,
  /** Horizontal: hands at most this far from the feet when working a part from a station — the kneel rule at a
   *  hand-off. Physical basis: a kneeling body reaches 0.78 (woman) – 0.96 m (casual, punk) out at
   *  kneelOutBelow below its feet (measured); 0.8 m is what every template reaches. */
  maxHorizontalFromFeet: 0.8,
  kneelOutBelow: 0.1,
  /** At a hand-off, a receiver's hands at most this far beyond the edge they kneel at (owner feedback §6 ≈ 0.5 m). */
  edgeReach: 0.5,
  /** Hand-held items: hands this far beyond the edge of the table a person stands at (bending at the hips). */
  tableReach: 0.6,
  /** Shoulder band + lean per posture family (the envelope: a shoulder cylinder above the feet + the arm).
   *  Tops: shoulderTop (1.45). Bottoms from the rig: the standing / painting knee-bend offsets below the
   *  shoulders (0.12 / 0.52 m), the squat and the kneel from RIG hips + torso × cos(bend). */
  posture: {
    /** standing / walking with a load / reaching up (knees soft: shoulders ≥ 1.22) */
    upright: { lo: shoulderHeight - 0.12, hi: shoulderTop, lean: 0.2 },
    /** crouching / squatting to grip or lift from the knees: squatHip 0.42 + 0.45 × cos 80° = 0.50 */
    crouch: { lo: 0.5, hi: shoulderTop, lean: 0.35 },
    /** kneeling at an edge, bent over it: kneelHip 0.46 + 0.45 × cos 150° = 0.07 (shoulders stay above the
     *  deck); lean 0.35 — with the arm this reproduces the measured casual / punk reach (0.54 m down at
     *  0.45 m out, 0.95 m out at 0.1 m below), so the reachDownBelowFeet / maxHorizontalFromFeet caps bind */
    bentOver: { lo: 0.07, hi: shoulderTop, lean: 0.35 },
    /** painting a vertical face in front of them (a half squat: shoulders ≥ 0.82) */
    painting: { lo: shoulderHeight - 0.52, hi: shoulderTop, lean: 0.35 },
  } satisfies Record<string, Posture>,
  /** Prone receiver + rise (owner feedback §13): see PRONE above and BODY_MODEL.md "Prone receiver". Not in `posture`
   *  (its bands do not top out at shoulders + shrug + heels: a lying / kneeling body cannot reach overhead). */
  prone: PRONE,
  /** Seated on a chair / bench: landmark heights drop this much (pelvis on a ~0.45 m seat). */
  seatedDrop: 0.45,
  chestHeight: shoulderHeight - 0.12, // sternum, standing (1.22)
  chestFwd: 0.08, // sternum ahead of the body axis
  mouthHeight: 1.58, // the renderer's measured mouth point (humans.ts) at 1.75 m
  mouthFwd: 0.15, // the spoon hand's target, in front of the head
  /** Empty hands hanging at the hips (shoulderHeight − armLength = 0.72 m, just off the shoulders' line): where a crouch / reach starts from. */
  restHand: { up: 0.72, side: 0.18, fwd: 0.02 }, // up = shoulderHeight − armLength (written out: the float difference is 0.7200…01)
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

/** Highest a hand `r` m out horizontally from the feet reaches in posture `pz`, above the feet, floored to the mm
 *  (so `postureGap` there is ≤ 0); −Infinity when r is beyond lean + arm. Straight up (r ≤ lean) it is hi + arm. */
export function postureTop(pz: Posture, r: number): number {
  const dh = Math.max(0, r - pz.lean);
  if (dh > BODY_MODEL.armLength) return -Infinity;
  return Math.floor((pz.hi + Math.sqrt(BODY_MODEL.armLength * BODY_MODEL.armLength - dh * dh)) * 1000) / 1000;
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
