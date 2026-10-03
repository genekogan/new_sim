// HYPOTHETICAL same-world work/shared-food example. Plain bindings only: hosts
// explicitly submit ordinary registered actions and wait for physical completion.
import { classroomWorld } from './classroom.ts';
import { itemEntity, placeOnSlot, surfaceSlot } from '../items/model.ts';
import type { Vec2 } from '../core/math.ts';
import type { StowPlacement } from '../activities/stow.ts';
import type { WorkAtParams } from '../objects/workstation.ts';
import type { Entity, Provenance } from '../world/types.ts';

const provenance: Provenance = {
  origin: 'test-fixture',
  confidence: 'hypothetical',
  note: 'authored communal work/food break; not historical',
};
export interface WorkBreakParticipant {
  actor: string;
  bowl: string;
  spoon: string;
  service: Vec2;
  returns: StowPlacement[];
}
export interface WorkBreakBinding {
  work: WorkAtParams;
  table: string;
  pot: string;
  people: [WorkBreakParticipant, WorkBreakParticipant];
  conversation: { actors: string[]; at: Vec2 };
}
/** Fixed author-approved destinations; no automatic serving, next activity or resume. */
export const WORK_BREAK_BINDING: WorkBreakBinding = {
  work: {
    actor: 'worker',
    station: 'workstation',
    seat: 'work-chair#seat',
    task: 'Sketch notes',
    duration: 30,
  },
  table: 'serving-table',
  pot: 'shared-pot',
  people: [
    {
      actor: 'worker',
      bowl: 'worker-bowl',
      spoon: 'worker-spoon',
      service: [-5.45, -5.85],
      returns: [
        { item: 'worker-bowl', surfaceSlot: 'serving-table#r2c0' },
        { item: 'worker-spoon', surfaceSlot: 'serving-table#r2c1' },
      ],
    },
    {
      actor: 'visitor',
      bowl: 'visitor-bowl',
      spoon: 'visitor-spoon',
      service: [-4.55, -5.85],
      returns: [
        { item: 'visitor-bowl', surfaceSlot: 'serving-table#r2c4' },
        { item: 'visitor-spoon', surfaceSlot: 'serving-table#r2c5' },
      ],
    },
  ],
  conversation: { actors: ['worker', 'visitor'], at: [-5, -2] },
};
/** Retains every original classroom fixture/actor and its initial state. */
export function workBreakWorld(audienceCount: 4 | 8 = 4) {
  const world = classroomWorld(audienceCount);
  const table: Entity = {
    id: WORK_BREAK_BINDING.table,
    def: 'table-6ft',
    kind: 'fixture',
    pose: { p: [-5, 0, -5], yaw: 0 },
    support: { kind: 'ground' },
    provenance,
  };
  world.entities[table.id] = table;
  for (const [id, def, slot, fraction] of [
    [WORK_BREAK_BINDING.pot, 'pot', 'r0c2', 1],
    [WORK_BREAK_BINDING.people[0].bowl, 'bowl', 'r0c0', 0],
    [WORK_BREAK_BINDING.people[0].spoon, 'spoon', 'r0c1', undefined],
    [WORK_BREAK_BINDING.people[1].bowl, 'bowl', 'r0c4', 0],
    [WORK_BREAK_BINDING.people[1].spoon, 'spoon', 'r0c5', undefined],
  ] as const) {
    const item = itemEntity(id, def, [0, 0, 0], 0, {
      provenance,
      ...(fraction !== undefined
        ? { contents: { food: 'stew', fraction } }
        : {}),
    });
    const support = surfaceSlot(world, `${table.id}#${slot}`);
    if ('code' in support)
      throw new Error(`${support.code}: ${support.message}`);
    placeOnSlot(item, support, table.pose.yaw);
    world.entities[id] = item;
  }
  return world;
}
