// Hypothetical finite seed bowl and two raised ground planters, without plant growth.
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../api/registry.ts';
import { Spatial } from '../spatial/service.ts';
import { classroomScene } from './classroom.ts';
import { addAll, emptyWorld, human, FIXTURE } from '../world/factory.ts';
import type { Entity } from '../world/types.ts';
import { itemEntity, placeOnSlot, surfaceSlot } from '../items/model.ts';
import { plantingState, type PlantingEntity } from '../objects/planting.ts';
import { gardenState, type GardenEntity } from '../objects/garden.ts';
import { rot2 } from '../core/math.ts';
import {
  SEED_PLANTING_ACTIONS,
  type SeedPlantingParams,
} from '../activities/seed-planting.ts';
export const seedPlantingScene = classroomScene;
export const seedPlantingBinding = (
  _angle = 0,
  plant = 'planter-a',
): SeedPlantingParams => ({
  actor: 'planter',
  plant,
  seeds: 'seed-bowl',
  returnSlot: 'seed-table#r0c2',
});
export function seedPlantingWorld(angle = 0) {
  const fixture = (id: string, def: string, x: number, z: number): Entity => {
    const p = rot2([x, z], angle);
    return {
      id,
      def,
      kind: 'fixture',
      pose: { p: [p[0], 0, p[1]], yaw: angle },
      support: { kind: 'ground' },
      provenance: FIXTURE,
    };
  };
  const start = rot2([0, -4], angle),
    w = addAll(
      emptyWorld(
        'classroom',
        seedPlantingScene(),
        'hypothetical-seed-planting',
      ),
      human('planter', start[0], start[1]),
      fixture('seed-table', 'table-6ft', 0, -1.5),
    );
  for (const [id, x] of [
    ['planter-a', -2],
    ['planter-b', 2],
  ] as const) {
    const p = fixture(id, 'garden-planter', x, 2) as GardenEntity &
      PlantingEntity;
    p.gardenCare = gardenState();
    p.planting = plantingState();
    w.entities[id] = p;
  }
  const seeds = itemEntity('seed-bowl', 'bowl', [0, 0, 0], angle, {
    contents: { food: 'seeds', fraction: 0.5 },
    label: 'Hypothetical finite seed bowl',
  });
  w.entities[seeds.id] = seeds;
  const slot = surfaceSlot(w, 'seed-table#r0c2');
  if ('code' in slot) throw Error(slot.message);
  placeOnSlot(seeds, slot, angle);
  return w;
}
export function seedPlantingRuntime(angle = 0) {
  const common = createRegistry();
  return new Runtime(
    seedPlantingWorld(angle),
    createRegistry(SEED_PLANTING_ACTIONS.filter((a) => !common.has(a.verb))),
    { spatial: new Spatial(seedPlantingScene()) },
    ENGINE_INVARIANTS,
  );
}
