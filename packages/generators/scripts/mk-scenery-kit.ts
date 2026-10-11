import { writeFileSync } from 'node:fs';
// Regenerate packages/world-compiler/src/core-kit/scenery.json from the generator params (lane MARSLAND-FAR):
//   node packages/generators/scripts/mk-scenery-kit.ts packages/world-compiler/src/core-kit/scenery.json
import { GENERATORS } from '../src/index.ts';
const P = (gen: string) => structuredClone(GENERATORS[gen].params);
const defs = [
  { schema: 'def/1', name: 'core-far-land', version: 1, description: 'The land beyond the walkable edge, out to ~2.3 km: coarse low-poly ground painted from data (salt flats, beaches, scrub bands, washes, deltas, playa), roads with lines and pole lines, and a sea at a level. Place once at the world centre (no name needed); it replaces the green horizon ring. Nothing on it is walkable.', tags: ['scenery', 'horizon', 'terrain', 'ground'], form: 'point', layer: 'decor', make: { kind: 'gen', gen: 'far-land/1' }, size: { box: [10, 1, 10] }, params: P('far-land/1') },
  { schema: 'def/1', name: 'core-panorama', version: 1, description: 'Far mountain ranges at their real distances (5–50 km) around the horizon, hazed by the air, with far water to the horizon where there is a sea or lake. Bearings in compass degrees (0 = north = -z). Follows the camera like a sky; place once at the world centre (no name needed); it replaces the green horizon ring.', tags: ['scenery', 'horizon', 'terrain', 'mountain'], form: 'point', layer: 'decor', make: { kind: 'gen', gen: 'panorama/1' }, size: { box: [10, 1, 10] }, params: P('panorama/1') },
];
writeFileSync(process.argv[2] ?? 'scenery.json', JSON.stringify(defs, null, 1) + '\n');
