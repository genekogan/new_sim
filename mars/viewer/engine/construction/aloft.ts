// Parts staged aloft (Mars assembly model v1, approximate). A hand-up (handup.ts) lays a joist or a
// sheet exactly where it goes, resting on the members under it (phase `staged`, support
// `resting-on`): install_joist / install_plywood then only *fasten* it — the crew must already be up
// there within reach (on a beam walkway or a deck), nobody lifts it again. Parts lying on the ground
// keep the original staged → lift path (access.ts stagedCheck), so older scenarios are unchanged.
import { dist2, type Vec2 } from '../core/math.ts';
import type { StepResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity, Pose } from '../world/types.ts';
import { angleDelta } from '../core/math.ts';
import { ARM_REACH, distToObb, f2, fail, type Fail, type LiftExec } from './access.ts';
import { flatObb } from './deck.ts';

export const ALOFT_POS_TOL = 0.02; // m: a part staged aloft must already lie at its install pose
export const ALOFT_REACH_DOWN = 1.0; // m below a fastener's feet
export const ALOFT_REACH_UP = 2.1; // m above a fastener's feet
export const FASTEN_SLOT = 'fasten';

/** Staged on the structure (by a hand-up), not lying on a floor. */
export const isAloft = (e: Entity) => e.phase === 'staged' && e.support?.kind === 'resting-on';

/** The part lies at its install pose and every crew member can reach it from where they stand. */
export function aloftCheck(rt: Runtime, e: Entity, to: Pose, crew: string[], code: string): Fail | null {
  const d = dist2([e.pose.p[0], e.pose.p[2]], [to.p[0], to.p[2]]);
  const dyaw = Math.abs(angleDelta(e.pose.yaw, to.yaw));
  const yawOk = dyaw < 0.01 || Math.abs(dyaw - Math.PI) < 0.01;
  if (d > ALOFT_POS_TOL || Math.abs(e.pose.p[1] - to.p[1]) > ALOFT_POS_TOL || !yawOk)
    return fail(code, `${e.id} is staged aloft at (${f2(e.pose.p[0])}, ${f2(e.pose.p[1])}, ${f2(e.pose.p[2])}), not at its place (${f2(to.p[0])}, ${f2(to.p[1])}, ${f2(to.p[2])}); hand it up to where it goes (hand_up) — sliding it along the structure is not modelled`, [e.id]);
  const obb = flatObb(to, e);
  for (const c of crew) {
    const h = rt.world.entities[c];
    const p: Vec2 = [h.pose.p[0], h.pose.p[2]];
    const dh = distToObb(p, obb), up = to.p[1] - h.pose.p[1];
    if (dh > ARM_REACH || up < -ALOFT_REACH_DOWN || up > ALOFT_REACH_UP)
      return fail(code, `${c} cannot reach ${e.id} to fasten it: ${f2(dh)} m away (max ${ARM_REACH} m) and ${f2(up)} m above their feet (−${ALOFT_REACH_DOWN}…${ALOFT_REACH_UP} m); stand on the structure beside it first (climb_frame / beam_walk)`, [e.id, c], h.pose.p);
  }
  return null;
}

/** One tick of fastening: the crew hold the part where it lies; null when done (ex.t ≥ 1). */
export function fastenStep(rt: Runtime, ex: LiftExec, dt: number): StepResult | null {
  for (const c of ex.crew) Object.assign(rt.world.entities[c].human!, { activity: 'fasten', grip: { entity: ex.item, slot: FASTEN_SLOT }, task: ex.id });
  ex.t = Math.min(1, ex.t + dt / ex.duration);
  return ex.t >= 1 ? null : { status: 'running', phase: 'fasten' };
}
