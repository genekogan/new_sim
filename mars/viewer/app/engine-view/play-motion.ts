import * as THREE from 'three';
// todo (leisure): playground seats that move with the people on them. The engine keeps a rider seated at the spot (pose.p,
// seatHeight); the viewer swings the rider about the swing's top bar, or lifts and lowers them with the see-saw plank, and
// the scenery seat (decorative-motion.ts kinds 'swing-seat' / 'seesaw') turns by the same angle in the same frame.
// An empty seat hangs at rest. Seats are Eden's playground (eden-regions/south.ts); a rider elsewhere only leans.

/** [left swing, right swing, see-saw, unused] angles (rad) this frame; read by the scenery shader. */
export const PLAY_MOTION = { value: new THREE.Vector4(0, 0, 0, 0) };
export type PlaySeat = { kind: 'swing' | 'seesaw'; slot: 0 | 1 | 2;
  /** where a rider sits (x, z) and the pivot (x, height above the ground, z); swings turn about world x, the see-saw about z */
  at: readonly [number, number]; pivot: readonly [number, number, number] };
/** Swing frame top bar 2.3 m over seats 0.5 m high; see-saw pivot 0.55 m, ends ±1.45 m. */
export const SWING_TOP = 2.3, SWING_SEAT = 0.5, SEESAW_PIVOT = 0.55, SEESAW_HALF = 1.45;
export const EDEN_PLAY_SEATS: readonly PlaySeat[] = [
  { kind: 'swing', slot: 0, at: [13.3, 100], pivot: [13.3, SWING_TOP, 100] },
  { kind: 'swing', slot: 1, at: [14.7, 100], pivot: [14.7, SWING_TOP, 100] },
  { kind: 'seesaw', slot: 2, at: [15 - SEESAW_HALF, 106], pivot: [15, SEESAW_PIVOT, 106] },
  { kind: 'seesaw', slot: 2, at: [15 + SEESAW_HALF, 106], pivot: [15, SEESAW_PIVOT, 106] },
];
/** A rider's seat: the nearest of this kind within 0.6 m of the body point. */
export function playSeatAt(kind: 'swing' | 'seesaw', x: number, z: number, seats: readonly PlaySeat[] = EDEN_PLAY_SEATS): PlaySeat | null {
  let best: PlaySeat | null = null, bd = 0.6;
  for (const s of seats) { const d = Math.hypot(s.at[0] - x, s.at[1] - z); if (s.kind === kind && d < bd) { best = s; bd = d; } }
  return best;
}
/** Swing: about 2.7 s a beat (a 1.8 m pendulum), ±0.45 rad, each rider at their own phase. */
export const swingAngle = (t: number) => 0.45 * Math.sin((t * 2 * Math.PI) / 2.7);
/** See-saw: one shared rhythm (world seconds, no per-person phase) so both ends agree: ±0.2 rad over 3.2 s. */
export const seesawAngle = (seconds: number) => 0.2 * Math.sin((seconds * 2 * Math.PI) / 3.2);

const _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _axis = new THREE.Vector3();
/** Move a seated rider (holder at its ground point, already posed) with its seat: a swing turns the whole body about the top
 *  bar (about world x); a see-saw end rises or falls with the plank (about world z) while the rider stays upright. */
export function rideSeat(holder: THREE.Object3D, seat: PlaySeat, angle: number) {
  const ground = holder.position.y, pivot = _p.set(seat.pivot[0], ground + seat.pivot[1], seat.pivot[2]);
  _axis.set(seat.kind === 'swing' ? 1 : 0, 0, seat.kind === 'swing' ? 0 : 1);
  _q.setFromAxisAngle(_axis, angle);
  if (seat.kind === 'swing') { holder.position.sub(pivot).applyQuaternion(_q).add(pivot); holder.quaternion.premultiply(_q); }
  else { const dx = seat.at[0] - seat.pivot[0]; holder.position.y += dx * Math.sin(angle); }
  PLAY_MOTION.value.setComponent(seat.slot, angle);
}
