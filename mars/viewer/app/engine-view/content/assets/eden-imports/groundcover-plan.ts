import {createEdenGroundCover,type Patch} from './groundcover.ts';
import {AVOID} from './animal-plan.ts';
/** Where the imported ground cover and trees go (world metres; see the Eden map in the Imports proofs). Flowers and
 * ferns fill open lawns and woodland floors that had none; lily pads float on the two still ponds; a few groves add
 * willow and birch where the existing broadleaf trees thin out. */
const FLOWERS = ['nat-flowers', 'nat-plant-1', 'nat-plant-2', 'nat-grass', 'nat-flowers', 'nat-grass-short'] as const;
const FLOOR = ['nat-plant-3', 'nat-plant-4', 'nat-plant-5', 'knat-mushroom-red', 'knat-mushroom-tan', 'knat-mushroom-redgroup', 'knat-mushroom-tangroup', 'nat-grass-short'] as const;
export const PATCHES: readonly Patch[] = [
  // park lawns west and south-east of the pond
  { id: 'park-west', rect: [-42, 96, -24, 133], count: 28, models: FLOWERS },
  { id: 'park-east', rect: [6, 123, 32, 134], count: 15, models: FLOWERS },
  // the landscape meadows south-west of the commons and along the lake path
  { id: 'meadow-sw', rect: [-90, 40, -40, 80], count: 40, models: FLOWERS },
  { id: 'meadow-w', rect: [-60, 15, -36, 38], count: 18, models: FLOWERS },
  // woodland floors: the northern woods and the strip west of them
  { id: 'woods-north', rect: [-20, -64, 30, -34], count: 36, models: FLOOR, scale: [.9, 1.3] },
  { id: 'woods-west', rect: [-62, -60, -22, -42], count: 24, models: FLOOR, scale: [.9, 1.3] },
  { id: 'woods-logs', rect: [-60, -64, 28, -36], count: 10, models: ['nat-treestump-moss', 'nat-woodlog-moss', 'nat-rock-moss-1', 'nat-rock-moss-3'], scale: [.8, 1.1] },
  // lily pads on the still ponds (water surfaces −0.45 and −2.0)
  { id: 'lilies-park', rect: [-12, 109.5, 0, 116], count: 16, models: ['nat-lilypad'], y: -0.44, scale: [.8, 1.4] },
  { id: 'lilies-pond', rect: [-90, -6, -75, 2], count: 14, models: ['nat-lilypad'], y: -1.99, scale: [.8, 1.4] },
  // groves: willows by the park pond and on the west river bank, birches on the north meadow
  { id: 'willows-park', rect: [-26, 99, -21, 104], count: 2, models: ['nat-willow-1', 'nat-willow-2'], scale: [.9, 1.1] },
  { id: 'willows-river', rect: [-222, -40, -218, 60], count: 8, models: ['nat-willow-1', 'nat-willow-2'], scale: [.85, 1.15] },
  { id: 'birch-north', rect: [-112, -205, -94, -186], count: 7, models: ['nat-birchtree-1', 'nat-birchtree-2'], autumn: ['nat-birchtree-autumn-1'], scale: [.85, 1.15] },
  { id: 'broadleaf-north', rect: [-70, -235, -50, -222], count: 5, models: ['nat-commontree-1', 'nat-commontree-2', 'nat-commontree-3'], autumn: ['nat-commontree-autumn-1', 'nat-commontree-autumn-2'], scale: [.85, 1.15] },
];
/** Ground cover keeps off buildings, beds and paths in AVOID, except the two ponds (where the lily pads float). */
const inPond = (x: number, z: number) => (z > 100 && z < 120 && x > -20 && x < 8) || (x > -96 && x < -66 && z > -11 && z < 6);
export const coverAvoid = (x: number, z: number) => !inPond(x, z) && AVOID.some((r) => x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]);
export const createEdenGroundCoverPlanned = (ground: (x: number, z: number) => number | null) => createEdenGroundCover(ground, PATCHES, coverAvoid);
