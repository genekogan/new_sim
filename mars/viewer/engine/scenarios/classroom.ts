// HYPOTHETICAL, generic classroom. No historical Mars reconstruction.
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity } from '../world/types.ts';
import type { SpatialScene } from '../spatial/types.ts';
import { emptyWorld, human, addAll, FIXTURE } from '../world/factory.ts';
import { itemEntity, placeOnSlot, surfaceSlot } from '../items/model.ts';
import type { ClassroomParams } from '../activities/index.ts';

export function classroomScene(): SpatialScene {
  return {
    bounds: [-16, -16, 16, 16], levels: [{ id: 0, y: 0, label: 'classroom ground' }],
    surfaces: [{ id: 'floor', level: 0, y: 0, obb: { c: [0, 0], half: [16, 16], yaw: 0 } }],
    obstacles: [
      { id: 'back-wall', obb: { c: [0, -9], half: [10, 0.12], yaw: 0 }, y0: 0, y1: 2.8, kind: 'wall' },
      { id: 'left-wall', obb: { c: [-10, -1], half: [0.12, 8], yaw: 0 }, y0: 0, y1: 2.8, kind: 'wall' },
    ], links: [],
  };
}
export function classroomWorld(audienceCount: 4 | 8 = 4) {
  const scene = classroomScene();
  const actors = ['host', 'presenter1', 'presenter2', ...Array.from({ length: audienceCount }, (_, i) => `guest${i + 1}`)];
  const count = audienceCount === 4 ? 8 : 12;
  const fixture = (id: string, def: string, x: number, z: number, yaw = 0): Entity => ({ id, def, kind: 'fixture', pose: { p: [x, 0, z], yaw }, support: { kind: 'ground' }, provenance: FIXTURE });
  const chairs = Array.from({ length: count }, (_, i) => fixture(`seat${i + 1}`, 'camp-chair', (i % 4 - 1.5) * 3, Math.floor(i / 4) * 3, -Math.PI));
  // Camp-chair local seat heading is +z; yaw pi faces the presenter (-z).
  const w = addAll(emptyWorld('classroom', scene), ...chairs,
    fixture('screen', 'standing-display', 0, -7), fixture('lectern', 'speaker-lectern', 0, -4),
    fixture('workstation', 'computer-workstation', 6, -5), fixture('work-chair', 'camp-chair', 6, -6.2),
    fixture('belongings-table', 'table-6ft', 10, -5),
    human('visitor', -7, 10), human('worker', 8, -6),
    ...actors.map((a, i) => human(a, (i - (actors.length - 1) / 2) * 1.15, 9)));
  // A small usable object example; return slots are authored choices, not inferred history.
  for (const [id, def, slot] of [['break-bowl', 'bowl', 'r0c1'], ['break-spoon', 'spoon', 'r0c2']]) {
    const item = itemEntity(id, def, [0, 0, 0]);
    const support = surfaceSlot(w, `belongings-table#${slot}`);
    if ('code' in support) throw new Error(`${support.code}: ${support.message}`);
    placeOnSlot(item, support, 0);
    w.entities[id] = item;
  }
  w.entities.screen.equipment = { kind: 'display', config: { available: true, mode: 'off', content: 'Lightning talks · hypothetical classroom' } };
  return w;
}
export function classroomParams(audienceCount: 4 | 8 = 4): ClassroomParams {
  const actors = ['host', 'presenter1', 'presenter2', ...Array.from({ length: audienceCount }, (_, i) => `guest${i + 1}`)];
  return {
    host: 'host', presenters: ['presenter1', 'presenter2'], audience: actors.slice(3),
    seats: Array.from({ length: audienceCount === 4 ? 8 : 12 }, (_, i) => `seat${i + 1}#seat`), presenterStation: 'lectern#presenter',
    displayId: 'screen', requireDisplay: true,
    departure: Object.fromEntries(actors.map((a, i) => [a, [(i - (actors.length - 1) / 2) * 1.2, 12]])),
    conversationPoints: [[-7, 6], [7, 6], [8, -1]], arrivalStaggerSeconds: 0.45, talkSeconds: 18, questionSeconds: 6, conversationSeconds: 18, maxPhaseSeconds: 120,
  };
}
export function classroomSessionId(rt: Runtime): string | undefined {
  return [...rt.records.values()].filter((r) => r.verb === 'classroom_session').at(-1)?.id;
}
