// Hypothetical two prepared reading places; no historical participants or book.
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../api/registry.ts';
import { Spatial } from '../spatial/service.ts';
import { READING_SCENE } from './reading.ts';
import { emptyWorld, addAll, human, FIXTURE } from '../world/factory.ts';
import type { Entity } from '../world/types.ts';
import { itemEntity, surfaceSlot, placeOnSlot } from '../items/model.ts';
import type { LibraryReadingParams } from '../activities/library-reading.ts';
export const LIBRARY_READING_BINDING: LibraryReadingParams = {
  actor: 'reader',
  book: 'book',
  sourceSeat: 'chair-a#seat',
  destSeat: 'chair-b#seat',
  from: 'table-a#r0c0',
  to: 'table-b#r0c0',
  task: 'Quiet hypothetical book study',
  duration: 24,
  transferAfter: 7,
};
export function libraryReadingRuntime() {
  const fixture = (id: string, def: string, x: number, z: number): Entity => ({
    id,
    def,
    kind: 'fixture',
    pose: { p: [x, 0, z], yaw: 0 },
    support: { kind: 'ground' },
    provenance: FIXTURE,
  });
  const world = addAll(
    emptyWorld('library-reading', READING_SCENE),
    fixture('table-a', 'table-6ft', 0, 0),
    fixture('table-b', 'table-6ft', 4, 0),
    fixture('chair-a', 'camp-chair', -0.75, -0.85),
    fixture('chair-b', 'camp-chair', 3.25, -0.85),
    human('reader', -0.75, -3),
    human('visitor', -4, -4),
  );
  const book = itemEntity('book', 'reading-book', [0, 0, 0]),
    slot = surfaceSlot(world, LIBRARY_READING_BINDING.from);
  if ('code' in slot) throw new Error(`${slot.code}: ${slot.message}`);
  placeOnSlot(book, slot, 0);
  world.entities.book = book;
  const registry = createRegistry();
  return new Runtime(
    world,
    registry,
    { spatial: new Spatial(READING_SCENE) },
    ENGINE_INVARIANTS,
  );
}
