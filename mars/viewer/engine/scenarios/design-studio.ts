// Hypothetical independent design studio: authored data, ordinary activities.
// No reconstruction claim, imported asset dependency or alternative execution.
import type { SpatialScene } from '../spatial/types.ts';
import type { Entity, Provenance } from '../world/types.ts';
import type { Vec2 } from '../core/math.ts';
import { emptyWorld, human, addAll } from '../world/factory.ts';
import { itemEntity, placeOnSlot, surfaceSlot } from '../items/model.ts';
import type { ClassroomParams } from '../activities/types.ts';
import type { WorkBreakBinding } from './work-break.ts';
import type { PurposefulRoutineParams } from '../activities/purposeful-routine.ts';
import type { WorkContinuationBinding, DiscussionContinuationBinding, GatheringContinuationParams } from '../activities/gathering-continuation.ts';

export interface DesignStudioBindings {
  roles: { host: string; presenters: [string, string]; audience: string[]; worker: string; companion: string };
  workBreak: WorkBreakBinding;
  session: ClassroomParams;
  rest: { seat: string; seconds: number };
  departure: Vec2;
  followUpWork: Omit<WorkContinuationBinding, 'prerequisite'>;
  followUpDiscussion: DiscussionContinuationBinding;
}
const provenance: Provenance = { origin: 'test-fixture', confidence: 'hypothetical', note: 'independent design studio critique/lunch; authored example, not historical Mars' };
const roles: DesignStudioBindings['roles'] = {
  host: 'studio-facilitator', presenters: ['ceramic-designer', 'print-designer'],
  audience: ['material-reviewer', 'form-reviewer', 'colour-reviewer', 'visitor-reviewer'],
  worker: 'project-editor', companion: 'studio-neighbour',
};
const attendees = [roles.host, ...roles.presenters, ...roles.audience];
const binding: DesignStudioBindings = {
  roles,
  workBreak: {
    work: { actor: roles.worker, station: 'studio-computer', seat: 'studio-task-chair#seat', task: 'Prototype project notes', duration: 30 },
    table: 'lunch-table', pot: 'studio-soup',
    people: [
      { actor: roles.worker, bowl: 'editor-bowl', spoon: 'editor-spoon', service: [-6.45, -5.85],
        returns: [{ item: 'editor-bowl', surfaceSlot: 'lunch-table#r2c0' }, { item: 'editor-spoon', surfaceSlot: 'lunch-table#r2c1' }] },
      { actor: roles.companion, bowl: 'neighbour-bowl', spoon: 'neighbour-spoon', service: [-5.55, -5.85],
        returns: [{ item: 'neighbour-bowl', surfaceSlot: 'lunch-table#r2c4' }, { item: 'neighbour-spoon', surfaceSlot: 'lunch-table#r2c5' }] },
    ],
    conversation: { actors: [roles.worker, roles.companion], at: [-6, -2.5] },
  },
  session: {
    host: roles.host, presenters: [...roles.presenters], audience: [...roles.audience],
    seats: Array.from({ length: 8 }, (_, i) => `studio-seat${i + 1}#seat`),
    presenterStation: 'critique-lectern#presenter', displayId: 'critique-display', requireDisplay: true,
    departure: Object.fromEntries(attendees.map((actor, i) => [actor, [(i - 3) * 1.2, 11]])),
    conversationPoints: [[-8, 6], [7, 6], [10, 0]], arrivalStaggerSeconds: 0.45,
    talkSeconds: 18, questionSeconds: 6, conversationSeconds: 18, maxPhaseSeconds: 120,
  },
  rest: { seat: 'studio-seat8#seat', seconds: 3 }, departure: [11, 11],
  followUpWork: { kind: 'work', actor: roles.presenters[0], work: { station: 'studio-computer', seat: 'studio-task-chair#seat', task: 'Record critique decisions', duration: 12 } },
  followUpDiscussion: { kind: 'discussion', actors: [roles.audience[0], roles.audience[1]], at: [-8, 6], duration: 20 },
};
/** Fresh data so a preset/control cannot mutate the source used by the next reset. */
export function designStudioBindings(): DesignStudioBindings { return structuredClone(binding); }
export function designStudioScene(): SpatialScene {
  return {
    bounds: [-18, -14, 18, 14], levels: [{ id: 0, y: 0, label: 'design studio ground' }],
    surfaces: [{ id: 'studio-floor', level: 0, y: 0, obb: { c: [0, 0], half: [18, 14], yaw: 0 } }],
    obstacles: [
      { id: 'studio-back-wall', obb: { c: [0, -10], half: [12, 0.12], yaw: 0 }, y0: 0, y1: 2.8, kind: 'wall' },
      { id: 'studio-west-wall', obb: { c: [-13, -1], half: [0.12, 9], yaw: 0 }, y0: 0, y1: 2.8, kind: 'wall' },
    ], links: [],
  };
}
export function designStudioWorld() {
  const fixture = (id: string, def: string, x: number, z: number, yaw = 0): Entity => ({
    id, def, kind: 'fixture', pose: { p: [x, 0, z], yaw }, support: { kind: 'ground' }, provenance: { ...provenance },
  });
  const chairs = Array.from({ length: 8 }, (_, i) => fixture(`studio-seat${i + 1}`, 'camp-chair', (i % 4) * 3 - 6, Math.floor(i / 4) * 3, -Math.PI));
  const world = addAll(emptyWorld('design-studio', designStudioScene()), ...chairs,
    fixture('critique-display', 'standing-display', -1, -8), fixture('critique-lectern', 'speaker-lectern', -1, -4.5),
    fixture('studio-computer', 'computer-workstation', 8, -4), fixture('studio-task-chair', 'camp-chair', 8, -5.2),
    fixture('lunch-table', 'table-6ft', -6, -5),
    human(roles.worker, 10, -6, { label: 'Project editor', provenance: { ...provenance } }),
    human(roles.companion, -9, 10, { label: 'Studio neighbour', provenance: { ...provenance } }),
    ...attendees.map((id, i) => human(id, (i - 3) * 1.2, 9, { label: id.replaceAll('-', ' '), provenance: { ...provenance } })));
  world.entities['critique-display'].equipment = { kind: 'display', config: { available: true, mode: 'off', content: 'Prototype critique · hypothetical independent design studio' } };
  const items = [
    [binding.workBreak.pot, 'pot', 'r0c2', 1],
    ['editor-bowl', 'bowl', 'r0c0', 0], ['editor-spoon', 'spoon', 'r0c1', undefined],
    ['neighbour-bowl', 'bowl', 'r0c4', 0], ['neighbour-spoon', 'spoon', 'r0c5', undefined],
  ] as const;
  for (const [id, def, slot, fraction] of items) {
    const item = itemEntity(id, def, [0, 0, 0], 0, { provenance: { ...provenance }, ...(fraction !== undefined ? { contents: { food: 'soup', fraction } } : {}) });
    const support = surfaceSlot(world, `${binding.workBreak.table}#${slot}`);
    if ('code' in support) throw new Error(`${support.code}: ${support.message}`);
    placeOnSlot(item, support, 0); world.entities[id] = item;
  }
  return world;
}
/** Bind only explicit action identities; these helpers submit no actions. */
export function designStudioRoutineParams(session: string): PurposefulRoutineParams {
  const b = designStudioBindings(), { actor, ...work } = b.workBreak.work;
  return { actor, session, work: { ...work, task: work.task! },
    food: { pot: b.workBreak.pot, participants: b.workBreak.people, at: b.workBreak.conversation.at! }, rest: b.rest, departure: b.departure };
}
export function designStudioContinuationParams(session: string, routine: string): { work: GatheringContinuationParams; discussion: GatheringContinuationParams } {
  const b = designStudioBindings(), w = b.workBreak.work;
  return {
    work: { session, binding: { ...b.followUpWork, prerequisite: { routine, actor: w.actor, station: w.station, task: w.task!, duration: w.duration } } },
    discussion: { session, binding: b.followUpDiscussion },
  };
}
