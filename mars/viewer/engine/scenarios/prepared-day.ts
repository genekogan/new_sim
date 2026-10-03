// Explicit hypothetical composition of existing worlds and ordinary activities.
import { classroomScene } from './classroom.ts';
import { workBreakWorld, WORK_BREAK_BINDING } from './work-break.ts';
import { designStudioWorld, designStudioScene, designStudioBindings } from './design-studio.ts';
import { groundSleepFixture } from './sleep.ts';
import { itemEntity, surfaceSlot, placeOnSlot, slotOccupant } from '../items/model.ts';
import type { PrepareFoodParams } from '../activities/prepare-food.ts';
import type { SleepParams } from '../activities/sleep.ts';
import type { WorldState } from '../world/types.ts';

export const PREPARED_DAY_NAMES = ['prepared-day-4', 'prepared-day-8', 'prepared-day-studio'] as const;
export type PreparedDayScenario = typeof PREPARED_DAY_NAMES[number];
export interface PreparedDayBindings { preparation: PrepareFoodParams; sleep: SleepParams }
export function isPreparedDayScenario(name: string): name is PreparedDayScenario {
  return PREPARED_DAY_NAMES.some(candidate => candidate === name);
}
/** Fresh plain bindings; submitting actions remains the host's responsibility. */
export function preparedDayBindings(name: string): PreparedDayBindings | undefined {
  if (!isPreparedDayScenario(name)) return;
  const b = name === 'prepared-day-studio' ? designStudioBindings().workBreak : WORK_BREAK_BINDING;
  return {
    preparation: { actor: b.work.actor, pot: b.pot, spoon: b.people[0].spoon, ingredients: ['day-beans', 'day-greens'] },
    sleep: { actor: b.work.actor, mat: 'mat', duration: 18 },
  };
}
export function preparedDayScene(name: PreparedDayScenario) {
  return name === 'prepared-day-studio' ? designStudioScene() : classroomScene();
}
/** Preserve base factories; only this variant starts with finite ingredients and an empty pot. */
export function preparedDayWorld(name: PreparedDayScenario): WorldState {
  const world = name === 'prepared-day-studio' ? designStudioWorld() : workBreakWorld(name === 'prepared-day-8' ? 8 : 4);
  const b = name === 'prepared-day-studio' ? designStudioBindings().workBreak : WORK_BREAK_BINDING;
  const bindings = preparedDayBindings(name)!;
  world.entities[b.pot].contents = { food: 'hypothetical cold shared dish', fraction: 0 };
  const place = (id: string, slot: string) => {
    const target = surfaceSlot(world, `${b.table}#${slot}`);
    if ('code' in target) throw new Error(`${target.code}: ${target.message}`);
    const occupant = slotOccupant(world, b.table, slot);
    if (occupant && occupant.id !== id) throw new Error(`prepared-day.occupied-slot: ${target.id} holds ${occupant.id}`);
    placeOnSlot(world.entities[id], target, world.entities[b.table].pose.yaw);
  };
  // Both source tables share the actual 3x6 lattice. Free r0c1 for the first
  // ingredient; r1c0 and r0c3 are empty in both authored base worlds.
  place(bindings.preparation.spoon, 'r1c0');
  for (const [id, food, slot] of [['day-beans', 'beans', 'r0c1'], ['day-greens', 'greens', 'r0c3']] as const) {
    world.entities[id] = itemEntity(id, 'bowl', [0, 0, 0], 0, {
      contents: { food, fraction: 1 },
      provenance: { origin: 'test-fixture', confidence: 'hypothetical', note: 'finite ingredient for the authored cold shared dish; not historical' },
    });
    place(id, slot);
  }
  // The same bounded mat lies on the existing east ground, away from the
  // authored classroom/studio fixtures. Runtime checks the real full envelope.
  world.regions.mat = groundSleepFixture([12, 3]).world.regions.mat;
  return world;
}
