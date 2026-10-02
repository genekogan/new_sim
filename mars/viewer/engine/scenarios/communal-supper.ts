// Hypothetical interior staging; no historical supper or recipe is claimed.
import { preparationWorld, preparationParams } from './preparation.ts';
import { classroomScene } from './classroom.ts';
import { human } from '../world/factory.ts';
import { itemEntity, placeOnSlot, surfaceSlot } from '../items/model.ts';
import { Runtime } from '../runtime/runtime.ts';
import {
  createRegistry,
  ENGINE_INVARIANTS,
  servicesFor,
} from '../api/registry.ts';
import {
  COMMUNAL_SUPPER_ACTIONS,
  type CommunalSupperParams,
} from '../activities/communal-supper.ts';
export const communalSupperScene = classroomScene;
export function communalSupperBinding(): CommunalSupperParams {
  const mealSlots = ['r1c0', 'r1c1', 'r1c4', 'r1c5'];
  const mealItems = ['cook-bowl', 'spoon', 'guest-bowl', 'guest-spoon'];
  return {
    preparation: preparationParams(),
    meal: {
      pot: 'pot',
      at: [2.5, 3],
      participants: [
        {
          actor: 'cook',
          bowl: 'cook-bowl',
          spoon: 'spoon',
          service: [-0.45, -0.85],
          returns: mealItems.slice(0, 2).map((item, i) => ({
            item,
            surfaceSlot: `meal-table#${mealSlots[i]}`,
          })),
        },
        {
          actor: 'guest',
          bowl: 'guest-bowl',
          spoon: 'guest-spoon',
          service: [0.45, -0.85],
          returns: mealItems.slice(2).map((item, i) => ({
            item,
            surfaceSlot: `meal-table#${mealSlots[i + 2]}`,
          })),
        },
      ],
    },
    cleanup: [
      {
        actor: 'cook',
        transfers: mealItems.map((item, i) => ({
          item,
          from: `meal-table#${mealSlots[i]}`,
          to: `ware-store#${mealSlots[i]}`,
        })),
      },
      {
        actor: 'guest',
        transfers: ['beans', 'pot', 'greens'].map((item, i) => ({
          item,
          from: `table#r1c${i + 1}`,
          to: `prep-store#r1c${i + 1}`,
        })),
      },
    ],
  };
}
export function communalSupperWorld() {
  const w = preparationWorld();
  w.entities.guest = human('guest', 5, -3);
  for (const [id, x, z] of [
    ['meal-table', 5, 0],
    ['ware-store', 0, 6],
    ['prep-store', 5, 6],
  ] as const)
    w.entities[id] = {
      ...structuredClone(w.entities.table),
      id,
      pose: { p: [x, 0, z], yaw: 0 },
    };
  for (const [id, def, slot] of [
    ['cook-bowl', 'bowl', 'r1c0'],
    ['guest-bowl', 'bowl', 'r1c4'],
    ['guest-spoon', 'spoon', 'r1c5'],
  ] as const) {
    const e = itemEntity(
      id,
      def,
      [0, 0, 0],
      0,
      def === 'bowl'
        ? { contents: { food: 'hypothetical cold shared dish', fraction: 0 } }
        : {},
    );
    w.entities[id] = e;
    const s = surfaceSlot(w, `meal-table#${slot}`);
    if ('code' in s) throw new Error(s.message);
    placeOnSlot(e, s, 0);
  }
  for (const [id, slot] of [
    ['beans', 'r1c1'],
    ['greens', 'r1c3'],
    ['pot', 'r1c2'],
    ['spoon', 'r1c4'],
  ] as const) {
    const s = surfaceSlot(w, `table#${slot}`);
    if ('code' in s) throw new Error(s.message);
    placeOnSlot(w.entities[id], s, 0);
  }
  return w;
}
export function communalSupperRuntime() {
  const w = communalSupperWorld();
  const registered = new Set(createRegistry().keys());
  return new Runtime(
    w,
    createRegistry(
      COMMUNAL_SUPPER_ACTIONS.filter((a) => !registered.has(a.verb)),
    ),
    servicesFor({ classroom: communalSupperScene() })(w),
    ENGINE_INVARIANTS,
  );
}
