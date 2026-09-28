// Body landmarks for hand points (ITEMS.md "Hand points"). A person's frame is their ground point
// `pose.p` (body axis, level height), forward f = (cos yaw, sin yaw) and right r = (−sin yaw, cos yaw)
// in (x, z); heights are above the ground point, lowered by `drop` while seated (SEAT_DROP). The numbers
// are engine/body/model.ts (BODY_MODEL, the one body model; BODY_MODEL.md) — this file only names the
// landmarks the item verbs use.
import { dcos, dsin, type Vec3 } from '../core/math.ts';
import type { Entity } from '../world/types.ts';
import { BODY_MODEL } from '../body/model.ts';

export type Hand = 'left' | 'right';
export const HANDS: readonly Hand[] = ['left', 'right'];
export const otherHand = (h: Hand): Hand => (h === 'left' ? 'right' : 'left');
/** +1 right, −1 left (along r). */
export const sideOf = (h: Hand) => (h === 'right' ? 1 : -1);

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

export type BodyFrame = { o: Vec3; f: [number, number]; r: [number, number]; drop: number };

export function bodyFrame(e: Entity, drop = 0): BodyFrame {
  const c = dcos(e.pose.yaw), s = dsin(e.pose.yaw);
  return { o: e.pose.p, f: [c, s], r: [-s, c], drop };
}

/** World point `fwd` ahead, `right` to the right and `up` above the ground point (seated drop applied). */
export function at(b: BodyFrame, fwd: number, right: number, up: number): Vec3 {
  return [b.o[0] + b.f[0] * fwd + b.r[0] * right, b.o[1] + up - b.drop, b.o[2] + b.f[1] * fwd + b.r[1] * right];
}

export const chestPoint = (b: BodyFrame) => at(b, BODY.chestFwd, 0, BODY.chest);
export const shoulderPoint = (b: BodyFrame, h: Hand) => at(b, 0, sideOf(h) * BODY.shoulderHalf, BODY.shoulder);
export const mouthPoint = (b: BodyFrame) => at(b, BODY.mouthFwd, 0, BODY.mouth);
/** Empty hand hanging at the side. */
export const restHand = (b: BodyFrame, h: Hand) => at(b, BODY_MODEL.restHand.fwd, sideOf(h) * BODY_MODEL.restHand.side, BODY_MODEL.restHand.up);
/** Hand carrying a small item (walking, sitting): in front of the hip. */
export const carryHand = (b: BodyFrame, h: Hand) => at(b, 0.28, sideOf(h) * 0.16, 1.0);

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
