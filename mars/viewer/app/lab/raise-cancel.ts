// Hypothetical, explicitly selected cancellation proof fixture; not a historical build.
import type { Scenario } from './scenarios.ts';
import { Runtime } from '../../engine/runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../../engine/runtime/invariants.ts';
import { Spatial } from '../../engine/spatial/service.ts';
import { addAll, component, emptyWorld, human } from '../../engine/world/factory.ts';
import { def } from '../../engine/world/catalog.ts';
import { raiseUpright } from '../../engine/construction/raise.ts';
import { uprightsSupported } from '../../engine/construction/invariants.ts';
import { walkTo } from '../../engine/locomotion/walk.ts';
import type { ActionDef } from '../../engine/actions/types.ts';
import type { SpatialScene } from '../../engine/spatial/types.ts';

const ground = (): SpatialScene => ({ bounds: [-10, -10, 10, 10], levels: [{ id: 0, y: 0, label: 'ground' }], surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [10, 10], yaw: 0 } }], obstacles: [], links: [] });
export const raiseCancel: Scenario = {
  name: 'raise-cancel-proof', title: 'Hypothetical raise cancellation proof',
  description: 'A two-person crew raises a 12 ft frame. Cancel through the runtime to retrace the actual lift and place it safely back on the ground.',
  scene: ground, humans: () => [],
  build() {
    const base = ground();
    const world = addAll(emptyWorld('raise-cancel-proof', base), component('A', 'upright-12ft', [0, def('upright-12ft').size[2] / 2, 0], Math.PI, { phase: 'staged', pose: { p: [0, def('upright-12ft').size[2] / 2, 0], yaw: Math.PI, pitch: Math.PI / 2 } }), human('p1', -5, -6), human('p2', -3, -6));
    return new Runtime(world, new Map<string, ActionDef>([['walk_to', walkTo], ['raise_upright', raiseUpright]]), { spatial: new Spatial(base) }, [...DEFAULT_INVARIANTS, uprightsSupported]);
  },
  start: (rt) => { rt.submit('raise_upright', { item: 'A', crew: ['p1', 'p2'] }); },
  maxTicks: 2000, focus: [0, -1.5, 5, -40],
  expect: (rt) => [{ ok: rt.violations.length === 0, message: 'zero violations' }],
};
