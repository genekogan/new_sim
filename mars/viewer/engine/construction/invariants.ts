// Construction invariants: a standing upright is always either held by enough
// people or part of a stable assembly (no magically free-standing frames).
import type { Diagnostic } from '../actions/types.ts';
import type { Invariant } from '../runtime/runtime.ts';
import { isStanding, isSupported, isUpright } from './rules.ts';
import { HAND_REACH, handPoint, LIFT_APEX_MAX } from './liftcrew.ts';
import { EDGE_REACH, ENVELOPE_TOL, envelopeGap, GIVE_MAX, HANDUP_SLOT_PREFIX, handsOf, KNEEL_BACK, REACH_DOWN } from './handup.ts';
import { hypot } from '../core/math.ts';
import { entityList } from '../world/entity-list.ts';
import type { Entity } from '../world/types.ts';

/** isUpright by def id (it reads only the def; catalog entries are never replaced); an unknown def throws as before. */
const UPRIGHT_DEFS = new Map<string, boolean>();
const uprightDef = (e: Entity) => { let v = UPRIGHT_DEFS.get(e.def); if (v === undefined) { v = isUpright(e); UPRIGHT_DEFS.set(e.def, v); } return v; };

export const uprightsSupported: Invariant = (rt) => {
  const out: Diagnostic[] = [];
  for (const e of entityList(rt.world)) {
    if (!uprightDef(e) || e.phase === 'carried') continue;
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
 * and that point is at most LIFT_APEX_MAX above the holder's floor. Slot `lift-station` (a deck worker
 * of the older lifts) is not checked.
 * Both ends of a hand-up (handup.ts, slots `handup-give-*` / `handup-take-*`): every tick each holder
 * publishes both hand points (human.hands), each within the reach envelope of their posture
 * (+ ENVELOPE_TOL); a giver's hands never above their floor + GIVE_MAX, a receiver's never more than
 * REACH_DOWN below their feet.
 */
export const liftHandsInReach: Invariant = (rt) => {
  const out: Diagnostic[] = [];
  const ents = rt.world.entities;
  for (const e of entityList(rt.world)) {
    if (e.kind !== 'component' || e.phase !== 'carried' || e.support?.kind !== 'held') continue;
    for (const id of e.support.by) {
      const h = ents[id];
      const grip = h?.human?.activity === 'lift' ? h.human.grip : undefined;
      const hand = grip?.entity === e.id ? handPoint(e, e.pose, grip.slot) : null;
      if (!hand) continue;
      const d = hypot(h.pose.p[0] - hand.p[0], h.pose.p[2] - hand.p[2]);
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
  for (const h of entityList(rt.world)) {
    const slot = h.human?.grip?.slot;
    if (!slot?.startsWith(HANDUP_SLOT_PREFIX)) continue;
    const part = h.human!.grip!.entity;
    const hands = handsOf(h);
    const act = h.human!.activity;
    const bad = (why: string, at: [number, number, number]) =>
      out.push({ code: 'lift.hands-out-of-reach', message: `${h.id} (${slot.includes('give') ? 'giver' : 'receiver'}, ${act}) holds ${part}: ${why}`, subjects: [part, h.id], at });
    if (!hands) { bad('no hand points published', h.pose.p); continue; }
    for (const [k, p] of hands.entries()) {
      const g = envelopeGap(act, h.pose.p, p);
      if (g > ENVELOPE_TOL + 1e-9) bad(`${k ? 'right' : 'left'} hand ${g.toFixed(2)} m beyond the reach envelope`, p);
      const up = p[1] - h.pose.p[1];
      if (slot.includes('give') && up > GIVE_MAX + 1e-6) bad(`hands ${up.toFixed(2)} m above their floor (max ${GIVE_MAX} m)`, p);
      if (slot.includes('take') && -up > REACH_DOWN + 1e-6) bad(`hands ${(-up).toFixed(2)} m below their feet (max ${REACH_DOWN} m)`, p);
      // the hand-off: kneeling at the edge, hands ≤ EDGE_REACH + KNEEL_BACK horizontally from the feet
      const hz = Math.sqrt((p[0] - h.pose.p[0]) ** 2 + (p[2] - h.pose.p[2]) ** 2);
      if (slot.includes('take') && (act === 'reach_down' || act === 'take') && hz > EDGE_REACH + KNEEL_BACK + ENVELOPE_TOL + 1e-6)
        bad(`hands ${hz.toFixed(2)} m out from their feet at the hand-off (kneeling at the edge: max ${EDGE_REACH + KNEEL_BACK} m)`, p);
    }
  }
  return out;
};
