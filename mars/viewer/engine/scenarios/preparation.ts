// Explicitly hypothetical cold dish on an ordinary ground table; no historical recipe.
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { classroomScene } from './classroom.ts';
import { mealRegistry } from './meal.ts';
import { addAll, emptyWorld, human } from '../world/factory.ts';
import { itemEntity, placeOnSlot, surfaceSlot } from '../items/model.ts';
import { rot2 } from '../core/math.ts';
import {
  prepareFood,
  type PrepareFoodParams,
} from '../activities/prepare-food.ts';
export const preparationParams = (): PrepareFoodParams => ({
  actor: 'cook',
  spoon: 'spoon',
  pot: 'pot',
  ingredients: ['beans', 'greens'],
});
export function preparationWorld(yaw = 0, x = 0, z = 0) {
  const scene = classroomScene(),
    start = rot2([0, -3], yaw);
  const w = addAll(
    emptyWorld('classroom', scene, 'cold-preparation'),
    {
      id: 'table',
      def: 'table-6ft',
      kind: 'fixture',
      pose: { p: [x, 0, z], yaw },
      support: { kind: 'ground' },
      provenance: { origin: 'test-fixture', confidence: 'hypothetical' },
    },
    human('cook', x + start[0], z + start[1]),
  );
  for (const [id, def, slot, food, fraction] of [
    ['beans', 'bowl', 'r0c1', 'beans', 1],
    ['greens', 'bowl', 'r0c3', 'greens', 1],
    ['pot', 'pot', 'r0c2', 'hypothetical cold shared dish', 0],
    ['spoon', 'spoon', 'r0c4', '', 0],
  ] as const) {
    const e = itemEntity(
      id,
      def,
      [0, 0, 0],
      yaw,
      food ? { contents: { food, fraction } } : {},
    );
    w.entities[id] = e;
    const s = surfaceSlot(w, `table#${slot}`);
    if ('code' in s) throw new Error(s.message);
    placeOnSlot(e, s, yaw);
  }
  return w;
}
export function preparationRuntime(yaw = 0, x = 0, z = 0) {
  const world = preparationWorld(yaw, x, z),
    registry = mealRegistry();
  registry.set(prepareFood.verb, prepareFood);
  return new Runtime(
    world,
    registry,
    { spatial: new Spatial(classroomScene()) },
    DEFAULT_INVARIANTS,
  );
}
