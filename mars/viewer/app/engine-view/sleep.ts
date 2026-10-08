// A small adapter for the current prone body helper. No alternative rig/IK.
// Ground sleep has no deck edge: use a flat chest and engine-owned rise rather
// than solveProne's construction grip/edge search.
import type { SleepPose } from '../../engine/activities/sleep.ts';
import { proneFrame, LIP, type ProneState } from './prone.ts';
import type { Dims, Target } from './posture.ts';

export function sleepGoal(pose: SleepPose, yaw: number): ProneState {
  // Existing prone helper uses knots 0=lying, 1=kneeling, 2=upright knees,
  // 3=standing. That rig coordinate is private to the renderer.
  const rise = Math.max(0, Math.min(1, pose.standingFraction)) * 3;
  const smooth = (k: number) => k * k * (3 - 2 * k);
  const r = rise <= 1 ? smooth(rise) : rise <= 2 ? 1 + smooth(rise - 1) : 2 + smooth(rise - 2);
  const bend = r < 1 ? (1 - r * r * (3 - 2 * r)) * Math.PI / 2 : 0;
  return { r, bend, turn: 0, yaw, w: 1, slide: 0 };
}
/** Slight chin lift for ground rest: the existing flat prone head faces into
 * the floor. Fade this current-rig expression out before upright kneeling. */
export function sleepHeadPitch(pr: ProneState): number {
  const k = Math.max(0, Math.min(1, pr.r));
  return 0.2 * (1 - k * k * (3 - 2 * k)) * pr.w;
}
/** A resting cheek, rather than a face pressed into the floor. Rise restores the head. */
export function sleepRestWeight(pr: ProneState): number {
  const k = Math.max(0, Math.min(1, pr.r));
  return (1 - k * k * (3 - 2 * k)) * pr.w;
}
/** Small authored clearance for the original measured rigs, in world metres.
 * Seven actual sleepers need <=5.14mm punk /7.94mm casual for a 2mm margin.
 * The actual woman sleep/wake sample is already clear. Unknown rigs retain
 * their existing pose; no per-frame skin scan or native root lift is needed. */
export function sleepHeadRestLift(pr:ProneState,template:string):number{
  const lift=template==='punk'?.006:template==='casual'?.008:0,rest=sleepRestWeight(pr);
  return Number.isFinite(rest)?lift*Math.max(0,Math.min(1,rest)):0;
}
/** Renderer-only free palm contacts on the ground, smoothly raised with the
 * shoulders during waking. These are not grips or authoritative hand leases.
 * Existing armTo + flatHand handle the current rigs; fingers remain approximate. */
export function sleepHands(d: Dims, pr: ProneState): Target[] {
  const sh = proneFrame(d, pr.r, pr.bend, LIP).spine[3];
  const rest = sleepRestWeight(pr);
  return [-1, 1].map(side => ({
    f: sh.f + (0.22 - 0.96 * rest) * d.armLen,
    lat: side * (d.shHalf + (0.24 - 0.12 * rest) * d.armLen),
    up: Math.max(0.04, sh.up - 0.65 * d.armLen),
  }));
}
