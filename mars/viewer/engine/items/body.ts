// Body landmarks for hand points (ITEMS.md "Hand points"). A person's frame is their ground point
// `pose.p` (body axis, level height), forward f = (cos yaw, sin yaw) and right r = (−sin yaw, cos yaw)
// in (x, z); heights are above the ground point, lowered by `drop` while seated (SEAT_DROP). The numbers
// are engine/body/model.ts (BODY_MODEL, the one body model; BODY_MODEL.md) — this file only names the
// landmarks the item verbs use.
import type { Vec3 } from '../core/math.ts';
import { BODY_MODEL } from '../body/model.ts';

export { HANDS, otherHand, sideOf, bodyFrame, at, chestPoint, shoulderPoint, mouthPoint, restHand, carryHand, type Hand, type BodyFrame } from '../body/model.ts';
import { at, sideOf, type BodyFrame, type Hand } from '../body/model.ts';

/** Named landmark numbers (BODY_MODEL) as the item verbs have always read them. */
export const BODY = {
  chest: BODY_MODEL.chestHeight, // sternum height, standing
  chestFwd: BODY_MODEL.chestFwd, // sternum ahead of the body axis
  shoulder: BODY_MODEL.shoulderHeight,
  shoulderHalf: BODY_MODEL.shoulderHalf, // shoulder joint off the body axis
  mouth: BODY_MODEL.mouthHeight,
  mouthFwd: BODY_MODEL.mouthFwd, // mouth point in front of the head (the spoon hand's target)
  armReach: BODY_MODEL.armLength, // shoulder → hand envelope
} as const;
/** Heights drop this much when seated on a chair / bench. */
export const SEAT_DROP = BODY_MODEL.seatedDrop;

// ---- eat cycle landmarks ----
/** Bowl hand: 0.25 m in front of the chest, a little below it. */
export const bowlHand = (b: BodyFrame) => at(b, BODY.chestFwd + 0.25, 0, BODY.chest - 0.1);
/** Spoon hand just above the bowl's rim, on the spoon side. */
export const rimHand = (b: BodyFrame, spoon: Hand) => at(b, BODY.chestFwd + 0.25, sideOf(spoon) * 0.07, BODY.chest + 0.02);
/** Spoon hand at the bottom of the dip (inside the bowl). */
export const dipHand = (b: BodyFrame, spoon: Hand) => at(b, BODY.chestFwd + 0.25, sideOf(spoon) * 0.02, BODY.chest - 0.04);

export const lerp3 = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
export const dist3 = (a: Vec3, b: Vec3) => {
  const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2];
  return Math.sqrt(x * x + y * y + z * z);
};
/** Cubic ease (smoothstep). */
export const smooth = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
