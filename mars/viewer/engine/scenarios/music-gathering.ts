// HYPOTHETICAL four-person digital music + grounded dance, not a historical Mars event.
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../api/registry.ts';
import { Spatial } from '../spatial/service.ts';
import { READING_SCENE } from './reading.ts';
import { emptyWorld, addAll, human, FIXTURE } from '../world/factory.ts';
import type { Entity } from '../world/types.ts';
import { heading, rot2, sub2 } from '../core/math.ts';
import {
  MUSIC_GATHERING_ACTIONS,
  type MusicGatheringParams,
} from '../activities/music-gathering.ts';
export function musicGatheringBinding(yaw = 0): MusicGatheringParams {
  return {
    performer: 'musician',
    station: 'music-computer',
    seat: 'music-chair#seat',
    listeners: [{ actor: 'listener', seat: 'listener-chair#seat' }],
    score: 'bright',
    period: 0.5,
    duration: 36,
    dancers: [
      { actor: 'dancer-a', at: rot2([-2, 0], yaw), face: yaw },
      { actor: 'dancer-b', at: rot2([-2, 2], yaw), face: yaw, join: false },
    ],
  };
}
export const MUSIC_GATHERING_BINDING = musicGatheringBinding();
export function musicGatheringRuntime(yaw = 0) {
  const fixture = (
    id: string,
    def: string,
    x: number,
    z: number,
    localYaw = 0,
  ): Entity => {
    const p = rot2([x, z], yaw);
    return {
      id,
      def,
      kind: 'fixture',
      pose: { p: [p[0], 0, p[1]], yaw: yaw + localYaw },
      support: { kind: 'ground' },
      provenance: FIXTURE,
    };
  };
  const person = (id: string, x: number, z: number) => {
    const p = rot2([x, z], yaw);
    return human(id, p[0], p[1]);
  };
  const world = addAll(
    emptyWorld('music-dance', READING_SCENE),
    fixture('music-computer', 'computer-workstation', 0, 0),
    fixture('music-chair', 'camp-chair', 0, -1.2),
    fixture(
      'listener-chair',
      'camp-chair',
      2,
      -3,
      heading(sub2([0, 0], [2, -3])) - Math.PI / 2,
    ),
    person('musician', -4, -4),
    person('listener', 4, -5),
    person('dancer-a', -5, 0),
    person('dancer-b', -5, 3),
  );
  const registry = createRegistry();
  for (const action of MUSIC_GATHERING_ACTIONS)
    if (!registry.has(action.verb)) registry.set(action.verb, action);
  return new Runtime(
    world,
    registry,
    { spatial: new Spatial(READING_SCENE) },
    ENGINE_INVARIANTS,
  );
}
