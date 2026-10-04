// Canonical installed dry commons/1. Source layout: World's9b6db72 physical
// proposal (all units metres). Original Greenfield/history stays immutable.
import { emptyWorld } from '../world/factory.ts';
import type { SpatialScene, Obstacle } from '../spatial/types.ts';
import type { Entity } from '../world/types.ts';

export const COMMONS_PHYSICAL_VERSION = 'commons/1';
export const COMMONS_LAYOUT = [
  { id: 'commons-pavilion', kind: 'pavilion', def: 'eden-commons-pavilion', p: [9, 0, -5], yaw: 0 },
  { id: 'commons-platform', kind: 'presentation-platform', def: 'eden-commons-platform', p: [9, 0, -1.8], yaw: 0 },
  { id: 'commons-bench-west', kind: 'bench', def: 'eden-commons-bench', p: [6, 0, 3], yaw: Math.PI },
  { id: 'commons-bench-east', kind: 'bench', def: 'eden-commons-bench', p: [12, 0, 3], yaw: Math.PI },
  { id: 'commons-table', kind: 'table', def: 'eden-commons-table', p: [12, 0, -5], yaw: 0 },
] as const;

const obstacles: Obstacle[] = [];
// Each post envelope includes its .38m foot and .20m collar. This is an
// explicit conservative collider, not a per-part geometry/contact claim.
for (const [i, x, z] of [[0, -2.75, -1.75], [1, 2.75, -1.75], [2, -2.75, 1.75], [3, 2.75, 1.75]])
  obstacles.push({ id: `commons-pavilion-post-${i}`, obb: { c: [9 + x, -5 + z], half: [.19, .19], yaw: 0 }, y0: 0, y1: 2.6, kind: 'solid' });
for (const z of [-1.75, 1.75]) obstacles.push({ id: `commons-pavilion-eave-${z}`, obb: { c: [9, -5 + z], half: [2.9, .09], yaw: 0 }, y0: 2.46, y1: 2.68, kind: 'solid' });
for (const x of [-2.75, 2.75]) obstacles.push({ id: `commons-pavilion-cross-${x}`, obb: { c: [9 + x, -5], half: [.09, 1.85], yaw: 0 }, y0: 2.46, y1: 2.68, kind: 'solid' });
obstacles.push({ id: 'commons-pavilion-roof', obb: { c: [9, -5], half: [3, 2], yaw: 0 }, y0: 2.67, y1: 2.9, kind: 'solid' });
obstacles.push({ id: 'commons-platform-solid', obb: { c: [9, -1.8], half: [1.5, 1], yaw: 0 }, y0: 0, y1: .24, kind: 'solid' });

export const EDEN_COMMONS_SCENE: SpatialScene = {
  bounds: [-30, -30, 30, 30],
  levels: [{ id: 0, y: 0, label: 'Commons ground' }, { id: 1, y: .24, label: 'Presentation deck' }],
  surfaces: [
    { id: 'commons-ground', level: 0, y: 0, obb: { c: [0, 0], half: [30, 30], yaw: 0 } },
    { id: 'commons-deck', level: 1, y: .24, obb: { c: [9, -1.8], half: [1.5, 1], yaw: 0 } },
  ], obstacles,
  // Deliberate low climb: .24m is above ordinary .22m step height. Both
  // landings and their .7m approaches are supported with body clearance.
  // No ramp, staircase, arbitrary climbing or terrain projection is implied.
  links: [{ id: 'commons-platform-front', kind: 'climb',
    from: { level: 0, p: [9, -.4], y: 0 }, to: { level: 1, p: [9, -1.4], y: .24 },
    width: 1, heading: -Math.PI / 2,
    path: [[9, 0, -.4], [9, .24, -.8], [9, .24, -1.4]], usable: true }],
};

export function edenCommonsWorld(seed = 'eden-commons') {
  const w = emptyWorld('eden-commons', EDEN_COMMONS_SCENE, seed);
  const provenance = { origin: 'design-edit' as const, confidence: 'hypothetical' as const };
  w.regions.field = { id: 'field', label: 'Commons ground', kind: 'walkable', level: 0,
    polygon: [[-30, -30], [30, -30], [30, 30], [-30, 30]], provenance };
  w.regions.commons = { id: 'commons', label: 'Commons gathering lawn', kind: 'place', level: 0,
    polygon: [[4, 4.3], [14, 4.3], [14, 5.7], [4, 5.7]], provenance };
  w.regions['commons-deck'] = { id: 'commons-deck', label: 'Presentation deck', kind: 'place', level: 1,
    polygon: [[7.5, -2.8], [10.5, -2.8], [10.5, -.8], [7.5, -.8]], provenance };
  for (const a of COMMONS_LAYOUT) w.entities[a.id] = {
    id: a.id, def: a.def, kind: 'fixture', label: a.id,
    pose: { p: [...a.p], yaw: a.yaw }, support: { kind: 'ground' }, provenance,
  } satisfies Entity;
  return w;
}
