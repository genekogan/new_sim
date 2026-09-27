// Seed worlds for a fresh engine room (preview). Campus-year SpatialScenes are
// not extracted yet (ENGINEERING.md §6.3), so every room/year starts with the
// synthetic proving ground and the carry corridors as protected canonical
// workspaces. Agents fork them before executing.
import { WorldHistory } from '../history/store.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import { carryCorridors } from '../carry/scenes.ts';
import type { SpatialScene } from '../spatial/types.ts';
import { addAll, component, emptyWorld, human } from '../world/factory.ts';
import type { WorldState } from '../world/types.ts';
import { ENGINE_RULES_VERSION } from './registry.ts';

export const ENGINE_SCENES: Record<string, SpatialScene> = {
  'proving-ground': provingGround(),
  'carry-yard': carryCorridors(),
};

export function provingGroundWorld(): WorldState {
  return addAll(
    emptyWorld('proving-ground', ENGINE_SCENES['proving-ground']),
    human('n1', 15, -20, { yaw: Math.PI / 2 }),
    human('s1', 15, -10, { yaw: -Math.PI / 2 }),
    human('p1', 3.5, 12.5),
    component('panel', 'plywood-4x8', [-25, 0, 25], 0, { phase: 'staged', pose: { p: [-25, 0, 25], yaw: 0, roll: Math.PI / 2 } }),
  );
}

export function carryYardWorld(): WorldState {
  return addAll(emptyWorld('carry-yard', ENGINE_SCENES['carry-yard']), component('b1', 'beam-12ft', [4, 0, 4], 0), human('p1', 2, 6.5), human('p2', 6, 1.5));
}

export function seedHistory(rulesVersion = ENGINE_RULES_VERSION): WorldHistory {
  const h = new WorldHistory(rulesVersion);
  h.publishCanonical('proving-ground', 'Proving ground (canonical, synthetic)', provingGroundWorld(), 'engine preview seed');
  h.publishCanonical('carry-yard', 'Carry corridors (canonical, synthetic)', carryYardWorld(), 'engine preview seed');
  return h;
}
