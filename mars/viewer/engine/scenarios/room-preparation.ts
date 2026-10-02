// Hypothetical classroom derivative; original classroom staging remains untouched.
import { Runtime } from '../runtime/runtime.ts';
import {
  createRegistry,
  ENGINE_INVARIANTS,
  servicesFor,
} from '../api/registry.ts';
import {
  classroomScene,
  classroomWorld,
  classroomParams,
} from './classroom.ts';
import { placeOnSlot, surfaceSlot } from '../items/model.ts';
import {
  ROOM_PREPARATION_ACTIONS,
  type RoomPreparationParams,
} from '../activities/room-preparation.ts';
export const roomPreparationScene = classroomScene;
export function roomPreparationWorld() {
  const w = classroomWorld(4);
  w.entities['storage-table'] = {
    ...structuredClone(w.entities['belongings-table']),
    id: 'storage-table',
    pose: { p: [12, 0, 4], yaw: 0 },
  };
  // Initial authored support, before execution: bowl's original edge slot overhangs
  // tidy_table's footprint envelope. Do not weaken it or move props during runtime.
  for (const [id, slot] of [
    ['break-bowl', 'r1c1'],
    ['break-spoon', 'r1c2'],
  ]) {
    const s = surfaceSlot(w, `belongings-table#${slot}`);
    if ('code' in s) throw Error(`${s.code}: ${s.message}`);
    placeOnSlot(w.entities[id], s, 0);
  }
  return w;
}
export function roomPreparationBinding(): RoomPreparationParams {
  return {
    tidy: {
      actor: 'worker',
      transfers: [
        {
          item: 'break-bowl',
          from: 'belongings-table#r1c1',
          to: 'storage-table#r1c1',
        },
        {
          item: 'break-spoon',
          from: 'belongings-table#r1c2',
          to: 'storage-table#r1c2',
        },
      ],
    },
    setup: {
      layout: 'side',
      moves: [
        {
          actor: 'guest1',
          helpers: ['guest2'],
          fixture: 'belongings-table',
          to: { x: 12, z: -2, yaw: 0 },
        },
        {
          actor: 'guest3',
          fixture: 'seat8',
          to: { x: 7.5, z: 3, yaw: -Math.PI },
        },
      ],
    },
    session: classroomParams(4),
    late: { actor: 'visitor', departure: [-7, 12] },
  };
}
export function roomPreparationRuntime() {
  const w = roomPreparationWorld(),
    common = createRegistry();
  return new Runtime(
    w,
    createRegistry(ROOM_PREPARATION_ACTIONS.filter((a) => !common.has(a.verb))),
    servicesFor({ classroom: roomPreparationScene() })(w),
    ENGINE_INVARIANTS,
  );
}
