// HYPOTHETICAL quiet reading arrangement, reusable outside Mars.
// Four compressed sections, no claimed historical book or participant.
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../api/registry.ts';
import { Spatial } from '../spatial/service.ts';
import type { SpatialScene } from '../spatial/types.ts';
import { emptyWorld, addAll, human, FIXTURE } from '../world/factory.ts';
import type { Entity } from '../world/types.ts';
import { itemEntity, placeOnSlot, surfaceSlot } from '../items/model.ts';
import { rot2 } from '../core/math.ts';
import type { ReadBookParams } from '../objects/reading.ts';
export const READING_SCENE: SpatialScene = {
  bounds: [-8, -8, 8, 8],
  levels: [{ id: 0, y: 0, label: 'ground' }],
  surfaces: [
    { id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [8, 8], yaw: 0 } },
  ],
  obstacles: [],
  links: [],
};
export const READING_BINDING: ReadBookParams = {
  actor: 'reader',
  book: 'book',
  seat: 'reading-chair#seat',
  duration: 24,
  task: 'Quiet reading',
};
export function readingRuntime(yaw = 0) {
  const fixture = (id: string, def: string, x: number, z: number): Entity => {
    const p = rot2([x, z], yaw);
    return {
      id,
      def,
      kind: 'fixture',
      pose: { p: [p[0], 0, p[1]], yaw },
      provenance: FIXTURE,
      support: { kind: 'ground' },
    };
  };
  const start = rot2([-0.15, -3], yaw);
  const world = addAll(
    emptyWorld('quiet-reading', READING_SCENE),
    fixture('reading-table', 'table-6ft', 0, 0),
    fixture('reading-chair', 'camp-chair', -0.15, -0.85),
    human('reader', start[0], start[1]),
    human('visitor', -4, -4),
  );
  const book = itemEntity('book', 'reading-book', [0, 0, 0]);
  const slot = surfaceSlot(world, 'reading-table#r0c2');
  if ('code' in slot) throw new Error(`${slot.code}: ${slot.message}`);
  placeOnSlot(book, slot, yaw);
  world.entities.book = book;
  return new Runtime(
    world,
    createRegistry(),
    { spatial: new Spatial(READING_SCENE) },
    ENGINE_INVARIANTS,
  );
}
