// Hypothetical raised ground planters; no imported assets or historical placement.
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { classroomScene } from './classroom.ts';
import { mealRegistry } from './meal.ts';
import { addAll, emptyWorld, human } from '../world/factory.ts';
import type { Entity } from '../world/types.ts';
import { itemEntity, placeOnSlot, surfaceSlot } from '../items/model.ts';
import { gardenState, type GardenEntity } from '../objects/garden.ts';
import { gardenCare, type GardenCareParams } from '../activities/garden-care.ts';

export { GARDEN_PLANTER_ASSET } from '../world/catalog-garden.ts';
export const GARDEN_PLANTS = ['plant-a', 'plant-b'] as const;
export const gardenCareParams = (plant: string = 'plant-a'): GardenCareParams => ({ actor: 'carer', plant, water: 'water-bowl', returnSlot: 'water-table#r0c2' });
export const gardenCareScene = classroomScene;
export function gardenCareWorld() {
  const fixture = (id: string, def: string, x: number, z: number): Entity => ({ id, def, kind: 'fixture', pose: { p: [x, 0, z], yaw: 0 }, support: { kind: 'ground' }, provenance: { origin: 'test-fixture', confidence: 'hypothetical' } });
  const w = addAll(emptyWorld('classroom', gardenCareScene(), 'garden-care'), human('carer', 0, -4), fixture('water-table', 'table-6ft', 0, -1.5));
  for (const [id, x] of [['plant-a', -2], ['plant-b', 2]] as const) { const e = fixture(id, 'garden-planter', x, 2) as GardenEntity; e.gardenCare = gardenState(); w.entities[id] = e; }
  const water = itemEntity('water-bowl', 'bowl', [0, 0, 0], 0, { contents: { food: 'water', fraction: 1 }, label: 'Finite water bowl' });
  w.entities[water.id] = water;
  const slot = surfaceSlot(w, 'water-table#r0c2'); if ('code' in slot) throw Error(slot.message);
  placeOnSlot(water, slot, 0); return w;
}
export function gardenCareRuntime() { const registry = mealRegistry(); registry.set(gardenCare.verb, gardenCare); return new Runtime(gardenCareWorld(), registry, { spatial: new Spatial(gardenCareScene()) }, DEFAULT_INVARIANTS); }
