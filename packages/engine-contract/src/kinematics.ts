// Shared kinematics: positions are a pure function of a timed path and a tick.
// Server (coarse truth) and clients (local display) both use this, so no
// per-tick pose streaming is needed. Arithmetic only (+ - * / sqrt, round):
// bit-identical across JS engines.
import type { PoseSample } from './engine.ts';

export const POS_Q = 1000; // mm per metre
export const ANG_Q = 1000; // mrad per radian

/** atan2 in milliradians using only IEEE arithmetic (no Math.atan2 drift). */
export function atan2mrad(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  const ax = Math.abs(x), ay = Math.abs(y);
  const a = Math.min(ax, ay) / Math.max(ax, ay);
  const s = a * a;
  let r = ((-0.0464964749 * s + 0.15931422) * s - 0.327622764) * s * a + a;
  if (ay > ax) r = 1.57079637 - r;
  if (x < 0) r = 3.14159274 - r;
  if (y < 0) r = -r;
  return Math.round(r * ANG_Q);
}

/** Build a timed straight-line path through waypoints (mm) at speed mm/s, starting at startTick. */
export function timedPath(points: [number, number][], startTick: number, speedMmPerSec: number, ticksPerSec: number): PoseSample[] {
  const out: PoseSample[] = [];
  let t = startTick;
  for (let i = 0; i < points.length; i++) {
    const [x, z] = points[i];
    let yaw = 0;
    if (i + 1 < points.length) yaw = atan2mrad(points[i + 1][0] - x, points[i + 1][1] - z);
    else if (i > 0) yaw = out[i - 1][4];
    if (i > 0) {
      const dx = x - points[i - 1][0], dz = z - points[i - 1][1];
      const len = Math.sqrt(dx * dx + dz * dz);
      t += Math.max(1, Math.ceil((len * ticksPerSec) / speedMmPerSec));
    }
    out.push([t, x, 0, z, yaw]);
  }
  return out;
}

/** Position on a timed path at a tick: [tick, x mm, y mm, z mm, yaw mrad]. Clamps to the ends. */
export function samplePath(samples: PoseSample[], tick: number): PoseSample {
  const first = samples[0], last = samples[samples.length - 1];
  if (tick <= first[0]) return [tick, first[1], first[2], first[3], first[4]];
  if (tick >= last[0]) return [tick, last[1], last[2], last[3], last[4]];
  let i = 1;
  while (samples[i][0] < tick) i++;
  const a = samples[i - 1], b = samples[i];
  const f = (tick - a[0]) / (b[0] - a[0]);
  return [tick, Math.round(a[1] + (b[1] - a[1]) * f), 0, Math.round(a[3] + (b[3] - a[3]) * f), a[4]];
}
