// Hypothetical finite staging, not historical placement or botanical growth.
import { gardenCareWorld, gardenCareScene } from './garden-care.ts';
import { itemEntity, placeOnSlot, surfaceSlot } from '../items/model.ts';
import { gardenState, type GardenEntity } from '../objects/garden.ts';
import { Runtime } from '../runtime/runtime.ts';
import { Spatial } from '../spatial/service.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../api/registry.ts';
import {
  GARDEN_CIRCUIT_ACTIONS,
  type GardenCircuitParams,
} from '../activities/garden-circuit.ts';
export const gardenCircuitScene = gardenCareScene;
export const gardenCircuitBinding = (): GardenCircuitParams => ({
  actor: 'carer',
  water: 'water-bowl',
  source: 'water-pot',
  returnSlot: 'water-table#r0c2',
  plants: ['plant-a', 'plant-b', 'plant-c'],
});
export function gardenCircuitWorld() {
  const w = gardenCareWorld();
  w.entities['water-bowl'].contents = { food: 'water', fraction: 0 };
  const plant: GardenEntity = {
    ...structuredClone(w.entities['plant-a']),
    id: 'plant-c',
    pose: { p: [0, 0, 4.5], yaw: 0 },
    gardenCare: gardenState(),
  };
  w.entities[plant.id] = plant;
  const pot = itemEntity('water-pot', 'pot', [0, 0, 0], 0, {
    contents: { food: 'water', fraction: 0.5 },
    label: 'Hypothetical finite resupply: .5 pot = two full bowls',
  });
  w.entities[pot.id] = pot;
  const s = surfaceSlot(w, 'water-table#r1c2');
  if ('code' in s) throw Error(s.message);
  placeOnSlot(pot, s, 0);
  return w;
}
export function gardenCircuitRuntime() {
  const common = createRegistry();
  return new Runtime(
    gardenCircuitWorld(),
    createRegistry(GARDEN_CIRCUIT_ACTIONS.filter((a) => !common.has(a.verb))),
    { spatial: new Spatial(gardenCircuitScene()) },
    ENGINE_INVARIANTS,
  );
}
