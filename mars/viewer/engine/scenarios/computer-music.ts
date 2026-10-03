// HYPOTHETICAL original electronic music at an ordinary usable computer.
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../api/registry.ts';
import { Spatial } from '../spatial/service.ts';
import { READING_SCENE } from './reading.ts';
import { emptyWorld, addAll, human, FIXTURE } from '../world/factory.ts';
import type { Entity } from '../world/types.ts';
import { rot2 } from '../core/math.ts';
import { type MusicParams } from '../activities/computer-music.ts';
export const MUSIC_BINDING: MusicParams = {
  performer: 'musician',
  station: 'music-computer',
  seat: 'music-chair#seat',
  listeners: [
    { actor: 'listener-a', seat: 'listener-chair-a#seat' },
    { actor: 'listener-b', seat: 'listener-chair-b#seat' },
  ],
  score: 'gentle',
  period: 0.5,
  duration: 24,
};
export function musicRuntime(yaw = 0) {
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
    emptyWorld('computer-music', READING_SCENE),
    fixture('music-computer', 'computer-workstation', 0, 0),
    fixture('music-chair', 'camp-chair', 0, -1.2),
    fixture('listener-chair-a', 'camp-chair', -2, -3, -0.5880026035475675),
    fixture('listener-chair-b', 'camp-chair', 2, -3, 0.5880026035475675),
    person('musician', -4, -4),
    person('listener-a', -4, -2),
    person('listener-b', 4, -5),
  );
  return new Runtime(
    world,
    createRegistry(),
    { spatial: new Spatial(READING_SCENE) },
    ENGINE_INVARIANTS,
  );
}
