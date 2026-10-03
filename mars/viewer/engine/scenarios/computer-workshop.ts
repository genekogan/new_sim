// Minimal anonymous hypothetical workshop; no historical classroom/asset values altered.
import { classroomScene } from './classroom.ts';
import { emptyWorld, addAll, human, FIXTURE } from '../world/factory.ts';
import type { Entity } from '../world/types.ts';
import { Runtime } from '../runtime/runtime.ts';
// IEEE-754 pi constant; no host transcendental calls.
const PI = 3.141592653589793;
import {
  createRegistry,
  ENGINE_INVARIANTS,
  servicesFor,
} from '../api/registry.ts';
import {
  COMPUTER_WORKSHOP_ACTIONS,
  type ComputerWorkshopParams,
} from '../activities/computer-workshop.ts';
export const computerWorkshopScene = classroomScene;
export function computerWorkshopBinding(): ComputerWorkshopParams {
  const common = {
    seats: [
      'gather-chair-a#seat',
      'gather-chair-b#seat',
      'gather-chair-c#seat',
    ],
    presenterStation: 'workshop-lectern#presenter',
    displayId: 'workshop-screen',
    requireDisplay: true,
    departure: {
      facilitator: [-4, 8] as [number, number],
      'learner-a': [0, 8] as [number, number],
      'learner-b': [4, 8] as [number, number],
    },
    conversationPoints: [[0, 4] as [number, number]],
    arrivalStaggerSeconds: 0.25,
    talkSeconds: 4,
    questionSeconds: 2,
    conversationSeconds: 3,
    maxPhaseSeconds: 90,
  };
  return {
    facilitator: 'facilitator',
    learners: [
      {
        actor: 'learner-a',
        station: 'computer-a',
        seat: 'computer-chair-a#seat',
        task: 'Compare prompt variants',
        duration: 12,
      },
      {
        actor: 'learner-b',
        station: 'computer-b',
        seat: 'computer-chair-b#seat',
        task: 'Draft a small image study',
        duration: 18,
      },
    ],
    demonstration: {
      ...common,
      host: 'learner-a',
      presenters: ['facilitator'],
      audience: ['learner-b'],
    },
    review: {
      ...structuredClone(common),
      host: 'facilitator',
      presenters: ['learner-a'],
      audience: ['learner-b'],
    },
  };
}
export function computerWorkshopWorld() {
  const scene = computerWorkshopScene();
  const fixture = (
    id: string,
    def: string,
    x: number,
    z: number,
    yaw = 0,
  ): Entity => ({
    id,
    def,
    kind: 'fixture',
    pose: { p: [x, 0, z], yaw },
    support: { kind: 'ground' },
    provenance: FIXTURE,
  });
  const w = addAll(
    emptyWorld('classroom', scene, 'computer-workshop'),
    human('facilitator', -4, 9),
    human('learner-a', 0, 9),
    human('learner-b', 4, 9),
    fixture('gather-chair-a', 'camp-chair', -3, 0, -PI),
    fixture('gather-chair-b', 'camp-chair', 0, 0, -PI),
    fixture('gather-chair-c', 'camp-chair', 3, 0, -PI),
    fixture('workshop-lectern', 'speaker-lectern', 0, -4),
    fixture('workshop-screen', 'standing-display', 0, -7),
    fixture('computer-a', 'computer-workstation', -6, -5),
    fixture('computer-chair-a', 'camp-chair', -6, -6.2),
    fixture('computer-b', 'computer-workstation', 6, -5),
    fixture('computer-chair-b', 'camp-chair', 6, -6.2),
  );
  w.entities['workshop-screen'].equipment = {
    kind: 'display',
    config: {
      available: true,
      mode: 'off',
      content:
        'Hypothetical computer workshop: demonstration and learner review',
    },
  };
  return w;
}
export function computerWorkshopRuntime() {
  const common = createRegistry(),
    world = computerWorkshopWorld();
  return new Runtime(
    world,
    createRegistry(
      COMPUTER_WORKSHOP_ACTIONS.filter((a) => !common.has(a.verb)),
    ),
    servicesFor({ classroom: computerWorkshopScene() })(world),
    ENGINE_INVARIANTS,
  );
}
