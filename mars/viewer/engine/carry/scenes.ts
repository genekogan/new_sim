// Carry proving scene: two enclosed yard + L-corridor compounds.
//   A: yard A x∈[0,8] z∈[0,8] → 2.5 m corridor east along z≈4, turning north at x≈18 to a dead end at z=14.
//   B: yard B x∈[0,8] z∈[18,26] → 1.5 m corridor east along z≈22, turning north at x≈18 into yard B2 x∈[14,22] z∈[32,40].
// Floors exist only inside the compounds (everything else is void), and every
// edge is a labelled wall so diagnostics can name what a load would hit.
import type { OBB2 } from '../core/math.ts';
import type { Obstacle, SpatialScene, Surface } from '../spatial/types.ts';

const T = 0.2; // wall thickness
const rect = (x0: number, z0: number, x1: number, z1: number, pad = 0): OBB2 => ({
  c: [(x0 + x1) / 2, (z0 + z1) / 2],
  half: [(x1 - x0) / 2 + pad, (z1 - z0) / 2 + pad],
  yaw: 0,
});
/** Wall along x at centre-line z. */
const wx = (id: string, label: string, z: number, x0: number, x1: number): Obstacle => ({ id, label, kind: 'wall', y0: 0, y1: 2.4, obb: rect(x0, z - T / 2, x1, z + T / 2) });
/** Wall along z at centre-line x. */
const wz = (id: string, label: string, x: number, z0: number, z1: number): Obstacle => ({ id, label, kind: 'wall', y0: 0, y1: 2.4, obb: rect(x - T / 2, z0, x + T / 2, z1) });

export const CORRIDOR_A = { width: 2.5, yard: [0, 0, 8, 8], armZ: 4, turnX: 18, endZ: 14 } as const;
export const CORRIDOR_B = { width: 1.5, yard: [0, 18, 8, 26], armZ: 22, turnX: 18, yard2: [14, 32, 22, 40] } as const;

export function carryCorridors(): SpatialScene {
  const floor = (id: string, x0: number, z0: number, x1: number, z1: number): Surface => ({ id, level: 0, y: 0, obb: rect(x0, z0, x1, z1, T), label: id });
  const a = CORRIDOR_A, b = CORRIDOR_B;
  const ha = a.width / 2, hb = b.width / 2;
  return {
    bounds: [-1, -1, 23, 41],
    levels: [{ id: 0, y: 0, label: 'ground' }],
    surfaces: [
      floor('yard-a', 0, 0, 8, 8),
      floor('corridor-a-east', 8, a.armZ - ha, a.turnX + ha, a.armZ + ha),
      floor('corridor-a-north', a.turnX - ha, a.armZ - ha, a.turnX + ha, a.endZ),
      floor('yard-b', 0, 18, 8, 26),
      floor('corridor-b-east', 8, b.armZ - hb, b.turnX + hb, b.armZ + hb),
      floor('corridor-b-north', b.turnX - hb, b.armZ - hb, b.turnX + hb, 32),
      floor('yard-b2', 14, 32, 22, 40),
    ],
    obstacles: [
      // yard A
      wx('ya-s', 'yard A south wall', -T / 2, -T, 8 + T),
      wx('ya-n', 'yard A north wall', 8 + T / 2, -T, 8 + T),
      wz('ya-w', 'yard A west wall', -T / 2, -T, 8 + T),
      wz('ya-e1', 'yard A east wall', 8 + T / 2, -T, a.armZ - ha),
      wz('ya-e2', 'yard A east wall', 8 + T / 2, a.armZ + ha, 8 + T),
      // corridor A (2.5 m)
      wx('ca-s', 'corridor A south wall', a.armZ - ha - T / 2, 8 + T, a.turnX + ha + T),
      wx('ca-n', 'corridor A inner (north) wall', a.armZ + ha + T / 2, 8 + T, a.turnX - ha),
      wz('ca-w', 'corridor A inner (west) wall', a.turnX - ha - T / 2, a.armZ + ha, a.endZ + T),
      wz('ca-e', 'corridor A outer (east) wall', a.turnX + ha + T / 2, a.armZ - ha - T, a.endZ + T),
      wx('ca-end', 'corridor A end wall', a.endZ + T / 2, a.turnX - ha - T, a.turnX + ha + T),
      // yard B
      wx('yb-s', 'yard B south wall', 18 - T / 2, -T, 8 + T),
      wx('yb-n', 'yard B north wall', 26 + T / 2, -T, 8 + T),
      wz('yb-w', 'yard B west wall', -T / 2, 18 - T, 26 + T),
      wz('yb-e1', 'yard B east wall', 8 + T / 2, 18 - T, b.armZ - hb),
      wz('yb-e2', 'yard B east wall', 8 + T / 2, b.armZ + hb, 26 + T),
      // corridor B (1.5 m)
      wx('cb-s', 'corridor B south wall', b.armZ - hb - T / 2, 8 + T, b.turnX + hb + T),
      wx('cb-n', 'corridor B inner (north) wall', b.armZ + hb + T / 2, 8 + T, b.turnX - hb),
      wz('cb-w', 'corridor B inner (west) wall', b.turnX - hb - T / 2, b.armZ + hb, 32),
      wz('cb-e', 'corridor B outer (east) wall', b.turnX + hb + T / 2, b.armZ - hb - T, 32),
      // yard B2
      wx('yb2-s1', 'yard B2 south wall', 32 - T / 2, 14 - T, b.turnX - hb),
      wx('yb2-s2', 'yard B2 south wall', 32 - T / 2, b.turnX + hb, 22 + T),
      wx('yb2-n', 'yard B2 north wall', 40 + T / 2, 14 - T, 22 + T),
      wz('yb2-w', 'yard B2 west wall', 14 - T / 2, 32 - T, 40 + T),
      wz('yb2-e', 'yard B2 east wall', 22 + T / 2, 32 - T, 40 + T),
    ],
    links: [],
  };
}
