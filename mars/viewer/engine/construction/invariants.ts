// Construction invariants: a standing upright is always either held by enough
// people or part of a stable assembly (no magically free-standing frames).
import type { Diagnostic } from '../actions/types.ts';
import type { Invariant } from '../runtime/runtime.ts';
import { isStanding, isSupported, isUpright } from './rules.ts';
import { HAND_REACH, handPoint, LIFT_APEX_MAX } from './liftcrew.ts';

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

/**
 * While a construction lift holds a part (support held, holders in activity 'lift'), each holder
 * with a follow grip slot (liftcrew.ts) stands within HAND_REACH ground distance of its hand point,
 * and that point is at most LIFT_APEX_MAX above the holder's floor. Slot `lift-station` (a holder
 * working from a level above the part) is not checked: hand-up from below is not modelled.
 */
export const liftHandsInReach: Invariant = (rt) => {
  const out: Diagnostic[] = [];
  const ents = rt.world.entities;
  for (const e of Object.values(ents)) {
    if (e.kind !== 'component' || e.phase !== 'carried' || e.support?.kind !== 'held') continue;
    for (const id of e.support.by) {
      const h = ents[id];
      const grip = h?.human?.activity === 'lift' ? h.human.grip : undefined;
      const hand = grip?.entity === e.id ? handPoint(e, e.pose, grip.slot) : null;
      if (!hand) continue;
      const d = Math.hypot(h.pose.p[0] - hand.p[0], h.pose.p[2] - hand.p[2]);
      const up = hand.p[1] - h.pose.p[1];
      if (d > HAND_REACH + 1e-6 || up > LIFT_APEX_MAX + 1e-6)
        out.push({
          code: 'lift.hands-out-of-reach',
          message: `${id} holds ${e.id} at ${grip!.slot}: hand point ${d.toFixed(2)} m away (max ${HAND_REACH} m) and ${up.toFixed(2)} m above their floor (max ${LIFT_APEX_MAX} m)`,
          subjects: [e.id, id],
          at: hand.p,
        });
    }
  }
  return out;
};
