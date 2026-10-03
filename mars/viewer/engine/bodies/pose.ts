// The drawn pose of a floater: its ground pose lifted by hoverHeight, plus a bob, a forward tilt with
// speed, a small sway and a yaw drift — all pure functions of (entity id, sampled tick, sampled speed).
// No wall clock and no frame-to-frame state, so a replay at the same tick draws the same head (and a
// paused take holds still unless the caller advances the tick). Deterministic trig (core/math dsin).
import { clamp, dsin, type Vec3 } from '../core/math.ts';
import type { FloaterBody } from './body.ts';

export type FloaterPose = { p: Vec3; yaw: number; pitch: number; roll: number };

/** Motion constants (amplitudes in m / rad, periods in seconds of sim time). */
export const BOB = { amp: 0.045, periodMin: 3.2, periodMax: 4.6, swayRoll: 0.035, swayPitch: 0.025, yawDrift: 0.05, leanPerMps: 0.12, leanMax: 0.16 };

/** FNV-1a of the id → [0, 1): a stable per-entity phase/period so heads never bob in unison. */
export function idPhase(id: string, salt = 0): number {
  let h = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return h / 0x100000000;
}

const TWO_PI = 2 * Math.PI;

/**
 * Floater pose at sampled tick `tick` (may be fractional — sampleTake's frame.tick) with step `dt` (s).
 * `ground` is the sampled entity pose (p on the walkable surface; yaw/pitch/roll as recorded);
 * `speed` the sampled ground speed (m/s) if published.
 */
export function floaterPose(id: string, ground: { p: Vec3; yaw: number; pitch?: number; roll?: number }, body: FloaterBody, tick: number, dt: number, speed = 0): FloaterPose {
  const t = tick * dt;
  const period = BOB.periodMin + (BOB.periodMax - BOB.periodMin) * idPhase(id, 1);
  const ph = TWO_PI * idPhase(id, 2);
  const w = TWO_PI / period;
  const bob = BOB.amp * dsin(w * t + ph);
  const lean = clamp(Math.abs(speed) * BOB.leanPerMps, 0, BOB.leanMax);
  return {
    p: [ground.p[0], ground.p[1] + body.hoverHeight + bob, ground.p[2]],
    yaw: ground.yaw + BOB.yawDrift * dsin(w * 0.37 * t + ph * 1.7),
    // nose dips into travel (+pitch = forward in the renderer), with a slow nod out of phase with the bob
    pitch: (ground.pitch ?? 0) + lean + BOB.swayPitch * dsin(w * t + ph + Math.PI / 2),
    roll: (ground.roll ?? 0) + BOB.swayRoll * dsin(w * 0.61 * t + ph * 2.3),
  };
}
