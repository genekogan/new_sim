/** C1 (Gene 2026-10-20: "broadcast doesn't show the horizon enough… don't overcorrect"). Every Broadcast pose (the
 * director's Soul shots, the ride shot, the town/god tours) and the arrival poster that previews it look this
 * fraction less steeply down: the eye stays, the aim turns up about its horizontal axis at the same distance.
 * One tunable. 0 = the old framing; pitch' = pitch × (1 − BROADCAST_HORIZON_LIFT) for a downward look, so a −25° shot
 * becomes −20° and a near-level shot barely moves. Upward looks are unchanged. */
export const BROADCAST_HORIZON_LIFT = .2;

type V3 = readonly number[];
/** The aim point of a pose lifted toward the horizon (same eye, same eye-to-aim distance). */
export function liftHorizon(position: V3, target: V3, lift = BROADCAST_HORIZON_LIFT): [number, number, number] {
  const dx = target[0] - position[0], dy = target[1] - position[1], dz = target[2] - position[2];
  const h = Math.hypot(dx, dz), d = Math.hypot(h, dy);
  if (!(lift > 0) || !(d > 1e-6) || !(h > 1e-6) || dy >= 0) return [target[0], target[1], target[2]];
  const pitch = Math.atan2(dy, h) * (1 - Math.min(1, lift)), k = d * Math.cos(pitch) / h;
  return [position[0] + dx * k, position[1] + d * Math.sin(pitch), position[2] + dz * k];
}
