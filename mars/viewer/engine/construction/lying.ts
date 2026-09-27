// Geometry of a lying upright, independent of how its pose was encoded
// (carry lays frames with roll −π/2; raise works in a canonical pitch-π/2 form).
import { heading, type Vec2 } from '../core/math.ts';
import type { Entity, Pose } from '../world/types.ts';
import { def } from '../world/catalog.ts';
import { entityCorners } from '../spatial/service.ts';

/** Base-end centre and top-end centre (world) of a frame from its actual corners. */
export function frameEnds(u: Entity): { base: [number, number, number]; top: [number, number, number] } {
  // entityCorners iterates x∈{−,+} × y∈{0,h} × z∈{−,+}: indices with y=0 are 0,1,4,5
  const c = entityCorners(u);
  const avg = (ix: number[]) => [0, 1, 2].map((k) => ix.reduce((s, i) => s + c[i][k], 0) / ix.length) as [number, number, number];
  return { base: avg([0, 1, 4, 5]), top: avg([2, 3, 6, 7]) };
}

/** Is the frame lying (height axis horizontal)? */
export function isLying(u: Entity): boolean {
  const { base, top } = frameEnds(u);
  const h = def(u.def).size[1];
  return Math.abs(top[1] - base[1]) < 0.02 * h;
}

/**
 * Canonical lying pose (yaw', pitch π/2, roll 0) describing the same physical
 * placement: height along world heading φ = yaw' + π/2, base centre at `base`,
 * resting on the ground (origin raised by half the column thickness).
 */
export function canonicalLying(u: Entity, groundY: number, standNear?: Vec2): Pose {
  let { base, top } = frameEnds(u);
  // Frames are top/bottom symmetric in this model; the crew raises whichever end is
  // nearest the intended footing (choosing which end goes down is their call).
  if (standNear && Math.hypot(top[0] - standNear[0], top[2] - standNear[1]) < Math.hypot(base[0] - standNear[0], base[2] - standNear[1])) [base, top] = [top, base];
  const phi = heading([top[0] - base[0], top[2] - base[2]]);
  const t = def(u.def).size[2];
  return { p: [base[0], groundY + t / 2, base[2]], yaw: phi - Math.PI / 2, pitch: Math.PI / 2 };
}

/**
 * Carry target that lays an upright so its base lands at `standAt` and its
 * top points along heading `lieToward` (the frame will stand with its beam
 * normal along that heading).
 */
export function layTargetForStanding(defId: string, standAt: Vec2, lieToward: number) {
  const h = def(defId).size[1];
  // carry treats a symmetric load as end-agnostic; raise_upright { stand_at } picks the footing end.
  return { x: standAt[0] + Math.cos(lieToward) * (h / 2), z: standAt[1] + Math.sin(lieToward) * (h / 2), yaw: lieToward };
}
