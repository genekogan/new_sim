// Bone chains and IK helpers for the Quaternius rigs (people.ts), shared by the pose layers of
// humans.ts / posture.ts. Rig facts (animated-{casual,punk,woman}.glb): Root → Body (pelvis) →
// {Hips → Abdomen → Torso → Chest → Shoulder/UpperArm/LowerArm/Wrist, UpperLeg → LowerLeg};
// the Foot bones are children of Root (baked IK targets), not of LowerLeg, so moving the pelvis
// leaves the feet where they are and a leg IK must place the Foot bone at the shin end itself.
// All rotations are applied in world space on top of the clip pose; bone lengths never change.
import * as THREE from 'three';
import type { Rig } from './people.ts';

export type Arm = { upper: THREE.Object3D; lower: THREE.Object3D; hand: THREE.Object3D; knuckle?: THREE.Object3D; shoulder?: THREE.Object3D; side: number };
/** Leg chain. The Foot bones are children of Root (baked IK targets), not of LowerLeg. */
export type Leg = { upper: THREE.Object3D; lower: THREE.Object3D; foot: THREE.Object3D; side: number };
export type Spine = { body: THREE.Object3D; hips?: THREE.Object3D; abdomen: THREE.Object3D; torso: THREE.Object3D; head?: THREE.Object3D };

export function bone(rig: Rig, name: string) {
  let out: THREE.Object3D | undefined;
  rig.model.traverse((o) => {
    if (!out && (o as THREE.Bone).isBone && o.name === name) out = o;
  });
  return out;
}

/** Arms, left (side +1 = the person's left) first. */
export function armsOf(rig: Rig): Arm[] {
  const out: Arm[] = [];
  for (const [k, side] of [['L', 1], ['R', -1]] as const) {
    const upper = bone(rig, `UpperArm${k}`), lower = bone(rig, `LowerArm${k}`), hand = bone(rig, `Wrist${k}`);
    if (upper && lower && hand) out.push({ upper, lower, hand, knuckle: bone(rig, `Middle2${k}`), shoulder: bone(rig, `Shoulder${k}`), side });
  }
  return out;
}

/** Legs, left first. */
export function legsOf(rig: Rig): Leg[] {
  const out: Leg[] = [];
  for (const [k, side] of [['L', 1], ['R', -1]] as const) {
    const upper = bone(rig, `UpperLeg${k}`), lower = bone(rig, `LowerLeg${k}`), foot = bone(rig, `Foot${k}`);
    if (upper && lower && foot) out.push({ upper, lower, foot, side });
  }
  return out;
}

export function spineOf(rig: Rig): Spine | undefined {
  const body = bone(rig, 'Body'), abdomen = bone(rig, 'Abdomen'), torso = bone(rig, 'Torso');
  return body && abdomen && torso ? { body, hips: bone(rig, 'Hips'), abdomen, torso, head: bone(rig, 'Head') } : undefined;
}

const V = () => new THREE.Vector3();
export const UP = new THREE.Vector3(0, 1, 0);
const _s = V(), _e = V(), _w = V(), _t = V(), _d = V(), _n = V(), _pole = V(), _c = V(), _elbow = V(), _end = V(), _goal = V(), _tmp = V(), _pp = V();
const _q = new THREE.Quaternion(), _qs = new THREE.Quaternion(), _qw = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _id = new THREE.Quaternion();
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const smooth = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));

/** Rotate `bone` (world space) so the direction from its origin to `from` turns toward `to`, by `weight`. */
export function swing(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, weight: number) {
  bone.getWorldPosition(_c);
  const a = _d.subVectors(from, _c).normalize(), b = _n.subVectors(to, _c).normalize();
  if (a.lengthSq() < 1e-8 || b.lengthSq() < 1e-8) return;
  _q.setFromUnitVectors(a, b);
  _qs.slerpQuaternions(_id, _q, weight); // (not in place: slerpQuaternions copies its first argument into `this`)
  applyWorld(bone, _qs);
}

/** Pre-multiply a world-space rotation onto `bone`. */
export function applyWorld(bone: THREE.Object3D, q: THREE.Quaternion) {
  bone.getWorldQuaternion(_qw);
  bone.parent!.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(_qa.copy(q).multiply(_qw)));
  bone.updateMatrixWorld(true);
}

/** Rotate `bone` by `angle` about a world axis. */
export function turn(bone: THREE.Object3D, axis: THREE.Vector3, angle: number) {
  applyWorld(bone, _qs.setFromAxisAngle(axis, angle));
}

/** Set `bone`'s world rotation (its parent stays). */
export function setWorldQuat(bone: THREE.Object3D, q: THREE.Quaternion) {
  bone.parent!.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(q));
  bone.updateMatrixWorld(true);
}

/** Move `bone`'s origin to a world point (keeps its world rotation: its parent does not change). */
export function place(bone: THREE.Object3D, world: THREE.Vector3) {
  _tmp.copy(world);
  bone.parent!.worldToLocal(_tmp);
  bone.position.copy(_tmp);
  bone.updateMatrixWorld(true);
}

/**
 * Two-bone IK: rotate `upper` then `lower` so `end` (a world point rigidly attached to `lower`)
 * moves onto `goal`, the middle joint bending toward `poleDir`. Reach is clamped to `maxExt` of the
 * chain length (no locked-straight joint); bone lengths never change. Leaves the achieved end in `end`.
 */
export function ik(upper: THREE.Object3D, lower: THREE.Object3D, end: THREE.Vector3, goal: THREE.Vector3, poleDir: THREE.Vector3, weight: number, maxExt: number) {
  lower.updateMatrixWorld(true);
  const endLocal = lower.worldToLocal(_tmp.copy(end)).clone();
  upper.getWorldPosition(_s);
  lower.getWorldPosition(_e);
  const a = _s.distanceTo(_e), b = _e.distanceTo(end), len = a + b;
  const c = Math.max(Math.abs(a - b) + 0.02, Math.min(len * maxExt, _s.distanceTo(goal)));
  _t.subVectors(goal, _s).normalize();
  const cosA = Math.max(-1, Math.min(1, (a * a + c * c - b * b) / (2 * a * c)));
  _pole.copy(poleDir).addScaledVector(_t, -poleDir.dot(_t));
  if (_pole.lengthSq() < 1e-6) _pole.set(0, -1, 0).addScaledVector(_t, _t.y);
  _pole.normalize();
  _elbow.copy(_s).addScaledVector(_t, a * cosA).addScaledVector(_pole, a * Math.sqrt(1 - cosA * cosA));
  swing(upper, _e, _elbow, weight);
  end.copy(endLocal);
  lower.localToWorld(end);
  _goal.copy(_s).addScaledVector(_t, c);
  swing(lower, end, _goal, weight);
  end.copy(endLocal);
  lower.localToWorld(end);
}

/**
 * Palm centre (midway wrist → finger base): the point that touches a part. It rides rigidly on the
 * forearm (the wrist keeps its clip rotation), so the IK end effector is the palm, not the wrist.
 */
export function palm(arm: Arm, out: THREE.Vector3) {
  arm.hand.getWorldPosition(out);
  if (arm.knuckle) out.lerp(arm.knuckle.getWorldPosition(_pp), 0.5);
  return out;
}

/** Arm chain length (shoulder→elbow→palm) in world metres. */
export function armLen(arm: Arm) {
  arm.upper.getWorldPosition(_s);
  arm.lower.getWorldPosition(_e);
  palm(arm, _w);
  return _s.distanceTo(_e) + _e.distanceTo(_w);
}

/** Elbow pole: down plus outward from the body centre (plus `back` × the person's backward direction). */
export function elbowPole(arm: Arm, body: THREE.Object3D, out: THREE.Vector3, fwd?: THREE.Vector3, back = 0) {
  arm.upper.getWorldPosition(_s);
  body.getWorldPosition(_c);
  out.set(_s.x - _c.x, 0, _s.z - _c.z).normalize().multiplyScalar(0.5);
  out.y = -1;
  if (fwd && back) out.addScaledVector(fwd, -back);
  return out;
}

/** Arm IK onto `goal` by `weight` (palm = end effector). */
export function armTo(arm: Arm, goal: THREE.Vector3, weight: number, maxExt: number, body: THREE.Object3D, pole?: THREE.Vector3) {
  palm(arm, _end);
  ik(arm.upper, arm.lower, _end, goal, pole ?? elbowPole(arm, body, V()), weight, maxExt);
}

/**
 * Contact weight for a gripped point at `dist` from the shoulder: full within 1.02 arm lengths (the
 * hand lands within a few cm, reach clamped below full extension), fading to none by 1.25 — beyond
 * that the part is out of reach and the arm hangs as the clip has it (no reaching toward it).
 */
export const contact = (dist: number, len: number) => clamp01((len * 1.25 - dist) / (len * 0.23));

/**
 * Leg IK: put the ankle (Foot bone origin, carried rigidly on the shin) on `goal`, knee toward `pole`,
 * then move the Foot bone there (it is not a child of the shin) and optionally set its world rotation.
 */
export function legTo(leg: Leg, ankleLocal: THREE.Vector3, goal: THREE.Vector3, pole: THREE.Vector3, maxExt: number, footQuat?: THREE.Quaternion) {
  leg.lower.updateMatrixWorld(true);
  const end = leg.lower.localToWorld(ankleLocal.clone());
  ik(leg.upper, leg.lower, end, goal, pole, 1, maxExt);
  place(leg.foot, end);
  if (footQuat) setWorldQuat(leg.foot, footQuat);
  return end;
}

/** The ankle (Foot bone origin) in the shin's frame, from the current pose (call before moving the pelvis). */
export function ankleLocal(leg: Leg, out = V()) {
  leg.foot.getWorldPosition(out);
  leg.lower.updateMatrixWorld(true);
  return leg.lower.worldToLocal(out);
}
