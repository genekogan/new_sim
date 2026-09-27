// Construction invariants: a standing upright is always either held by enough
// people or part of a stable assembly (no magically free-standing frames).
import type { Diagnostic } from '../actions/types.ts';
import type { Invariant } from '../runtime/runtime.ts';
import { isStanding, isSupported, isUpright } from './rules.ts';

export const uprightsSupported: Invariant = (rt) => {
  const out: Diagnostic[] = [];
  for (const e of Object.values(rt.world.entities)) {
    if (!isUpright(e) || e.phase === 'carried') continue;
    if (isStanding(e) || e.phase === 'raising') {
      if (!isSupported(rt.world, e) && e.support?.kind !== 'held')
        out.push({ code: 'support.upright-unsupported', message: `${e.id} is standing without enough holders or stabilizing beams`, subjects: [e.id], at: e.pose.p });
    }
  }
  return out;
};
