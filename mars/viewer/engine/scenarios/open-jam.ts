// HYPOTHETICAL Open Jacks-inspired digital sound exchange, not a recreated event.
import {
  musicGatheringRuntime,
  musicGatheringBinding,
} from './music-gathering.ts';
import { human } from '../world/factory.ts';
import {
  OPEN_JAM_ACTIONS,
  type OpenJamParams,
} from '../activities/open-jam.ts';
import { rot2 } from '../core/math.ts';
import { canonicalEntityOrder } from '../runtime/runtime.ts';
export function openJamBinding(yaw = 0): OpenJamParams {
  const base = musicGatheringBinding(yaw);
  return {
    station: base.station,
    seat: base.seat,
    listeners: base.listeners,
    dancers: base.dancers,
    period: 0.5,
    rounds: [
      {
        actor: 'musician',
        score: 'bright',
        duration: 12,
        exit: rot2([5, 3], yaw),
      },
      {
        actor: 'guest-musician',
        score: 'gentle',
        duration: 14,
        exit: rot2([5, 0], yaw),
      },
    ],
  };
}
export function openJamRuntime(yaw = 0) {
  const rt = musicGatheringRuntime(yaw),
    p = rot2([4, 4], yaw);
  rt.world.entities['guest-musician'] = human('guest-musician', p[0], p[1]);
  canonicalEntityOrder(rt.world);
  for (const action of OPEN_JAM_ACTIONS)
    if (!rt.registry.has(action.verb)) rt.registry.set(action.verb, action);
  return rt;
}
