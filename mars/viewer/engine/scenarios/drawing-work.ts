// General low-pressure communal drawing practice inspired by Drawing Klerb.
// Staging, anonymous participant, equipment and output are entirely hypothetical.
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../api/registry.ts';
import { Spatial } from '../spatial/service.ts';
import { classroomScene } from './classroom.ts';
import { addAll, emptyWorld, human, FIXTURE } from '../world/factory.ts';
import type { Entity } from '../world/types.ts';
import { itemEntity, placeOnSlot, surfaceSlot } from '../items/model.ts';
import {
  DRAWING_ACTIONS,
  type DrawingWorkParams,
} from '../activities/drawing.ts';
export const drawingWorkParams = (): DrawingWorkParams => ({
  actor: 'sketcher',
  pad: 'sketch-pad',
  pencil: 'sketch-pencil',
  returnSlot: 'sketch-table#r0c3',
  task: 'Shelter study',
});
export const drawingWorkScene = classroomScene;
export function drawingWorkWorld() {
  const table: Entity = {
    id: 'sketch-table',
    def: 'table-6ft',
    kind: 'fixture',
    pose: { p: [0, 0, 0], yaw: 0 },
    support: { kind: 'ground' },
    provenance: FIXTURE,
  };
  const w = addAll(
    emptyWorld('drawing-work', drawingWorkScene(), 'hypothetical-drawing'),
    table,
    human('sketcher', 0, -3),
  );
  for (const [id, def, slot] of [
    ['sketch-pad', 'drawing-pad', 'r0c2'],
    ['sketch-pencil', 'drawing-pencil', 'r0c3'],
  ]) {
    const e = itemEntity(id, def, [0, 0, 0]);
    const s = surfaceSlot(w, `sketch-table#${slot}`);
    if ('code' in s) throw Error(s.message);
    placeOnSlot(e, s, 0);
    w.entities[id] = e;
  }
  return w;
}
export function drawingWorkRuntime() {
  const common = createRegistry();
  return new Runtime(
    drawingWorkWorld(),
    createRegistry(
      DRAWING_ACTIONS.filter((action) => !common.has(action.verb)),
    ),
    { spatial: new Spatial(drawingWorkScene()) },
    ENGINE_INVARIANTS,
  );
}
