// HYPOTHETICAL wellness-inspired warm-up; the 2021 yoga was neighbouring
// Bombay community practice, not Mars-organized or reconstructed here.
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../api/registry.ts';
import { Spatial } from '../spatial/service.ts';
import { READING_SCENE } from './reading.ts';
import { emptyWorld, addAll, human } from '../world/factory.ts';
import { heading, rot2, sub2 } from '../core/math.ts';
import {
  GROUP_WARMUP_ACTIONS,
  type GroupWarmupParams,
} from '../activities/group-warmup.ts';
export function groupWarmupBinding(yaw = 0): GroupWarmupParams {
  const center = rot2([2, 0], yaw);
  return {
    instructor: { actor: 'guide', at: center, face: Math.PI + yaw },
    followers: [
      [-2, -3],
      [-2, -1],
      [-2, 1],
      [-2, 3],
    ].map((xy, i) => {
      const at = rot2(xy as [number, number], yaw);
      return {
        actor: `follower-${i + 1}`,
        at,
        face: heading(sub2(center, at)),
        joinAfter: i * 1.2,
        lag: 0.2 + i * 0.2,
      };
    }),
    phaseDuration: 2,
    cycles: 3,
  };
}
export function groupWarmupRuntime(yaw = 0) {
  const person = (id: string, x: number, z: number) => {
    const at = rot2([x, z], yaw);
    return human(id, at[0], at[1]);
  };
  const world = addAll(
    emptyWorld('hypothetical-warmup', READING_SCENE),
    person('guide', 5, 0),
    ...[-3, -1, 1, 3].map((z, i) => person(`follower-${i + 1}`, -6, z)),
  );
  const common = createRegistry();
  return new Runtime(
    world,
    createRegistry(GROUP_WARMUP_ACTIONS.filter((a) => !common.has(a.verb))),
    { spatial: new Spatial(READING_SCENE) },
    ENGINE_INVARIANTS,
  );
}
