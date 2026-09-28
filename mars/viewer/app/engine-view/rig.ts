// Bone chains and IK helpers for the Quaternius rigs (people.ts), shared by the pose layers of
// humans.ts / posture.ts. Rig facts (animated-{casual,punk,woman}.glb): Root → Body (pelvis) →
// {Hips → Abdomen → Torso → Chest → Shoulder/UpperArm/LowerArm/Wrist, UpperLeg → LowerLeg};
// the Foot bones are children of Root (baked IK targets), not of LowerLeg, so moving the pelvis
// leaves the feet where they are and a leg IK must place the Foot bone at the shin end itself.
// All rotations are applied in world space on top of the clip pose; bone lengths never change.
import * as THREE from 'three';
import type { Rig } from './people.ts';

/**
 * The one body model (OWNER_DECISIONS "One body model", POSES.md "Body model"): the renderer's copy.
 * The engine mirrors these numbers in engine/body/model.ts; e2e/poses.spec.ts measures the loaded rig
 * through the lab `bones()` / `probe()` hooks and pins it to them within 2 cm. Metres above the soles.
 */
export const BODY_MODEL = {
  /** Standing height, soles → crown (people.ts scales every template to it). */
  height: 1.75,
  /**
   * Shoulder joints (UpperArm origins), standing: people.ts scales every template uniformly to put them
   * here. The Quaternius rigs are stylised (large heads): scaled to 1.75 m overall their shoulders were
   * at 1.32 (casual), 1.25 (punk: its hair spikes count as height) and 1.34 m (woman), eyes ≈ 1.6 m. A
   * real 1.75 m adult's are ≈ 1.42 m, but raising these rigs' shoulders to 1.42 would make them 1.87 m
   * tall with eyes at ≈ 1.72 m, so the model keeps 1.34 m (crowns then at ≈ 1.75–1.77 m, punk's hair
   * tips 1.88 m) and meets the reach numbers below, which are what the engine's rules check.
   */
  shoulderHeight: 1.34,
  /** Shoulder joint → elbow → palm centre, arm straight (people.ts lengthens UpperArm / LowerArm to it). */
  armLength: 0.62,
  /** The elbow never locks: a palm reaches at most this fraction of armLength from its shoulder. */
  maxExtension: 0.97,
  /** Shoulder rise (clavicle turn, then the girdle) when the hand goes ≥ 0.5 m above the shoulder (m). */
  shrug: 0.05,
  /** Highest palm centre, standing flat, arm straight up: shoulderHeight + shrug + maxExtension × armLength. */
  overheadReach: 2.0,
  /** Heels up (toes down) to reach higher still: overheadReach + heelRise. */
  heelRise: 0.06,
  /**
   * Deepest palm centre below the feet that EVERY rig reaches, kneeling on one knee at a deck / beam
   * edge and bending over it (to bendMax.kneel), with the hands reachDownOut ahead of the feet. Measured:
   * casual / punk 0.525, woman 0.35 (longer legs, shorter torso). NOT the 1.0 m the engine's hand-up
   * currently allows (construction/handup.ts REACH_DOWN, POSTURE.reach_down lo −0.15 m): a kneeling
   * body's shoulders stay above the deck, and 0.62 m of arm below them ends ≈ 0.35–0.55 m down.
   */
  reachDown: 0.35,
  /** Horizontal distance from the feet (body point) to the hands for that reach-down. */
  reachDownOut: 0.45,
  /** Hip joints above the floor kneeling on one knee (thigh vertical, knee on the floor): 0.46 (casual, punk) – 0.51 m (woman). */
  kneelHip: 0.47,
  /** Deepest squat: hip joints above the floor. */
  squatHip: 0.42,
  /** Torso bend limits (rad) at the hips: lifting from the knees, bending at the hips standing, kneeling. */
  bendMax: { knees: (80 * Math.PI) / 180, hips: (100 * Math.PI) / 180, kneel: (150 * Math.PI) / 180 },
} as const;

export type Arm = {
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  hand: THREE.Object3D;
  /** Palm centre in the wrist's frame (midway wrist → middle-finger base, from the clip pose at rig creation). */
  palmLocal: THREE.Vector3;
  shoulder?: THREE.Object3D;
  side: number;
  /** Index / Middle / Ring / Pinky joints 1–4 (4 per finger), thumb joints 1–3. */
  fingers: THREE.Object3D[];
  thumb: THREE.Object3D[];
  /** Natural curl axes of the fingers / thumb in the wrist's frame (curlHand); null = no curl. */
  curlAxis: THREE.Vector3 | null;
  thumbAxis: THREE.Vector3 | null;
};
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
    if (!(upper && lower && hand)) continue;
    // Finger bones 1–4: 1 is the metacarpal inside the palm (Middle2 is the knuckle, see palm below)
    const fingers = ['Index', 'Middle', 'Ring', 'Pinky'].flatMap((f) => [1, 2, 3, 4].map((j) => bone(rig, `${f}${j}${k}`))).filter((o): o is THREE.Object3D => !!o);
    const thumb = [1, 2, 3].map((j) => bone(rig, `Thumb${j}${k}`)).filter((o): o is THREE.Object3D => !!o);
    rig.model.updateMatrixWorld(true);
    // the palm point is fixed in the wrist frame, so closing the fingers (curlHand) never moves it
    const knuckle = bone(rig, `Middle2${k}`), p = hand.getWorldPosition(V());
    if (knuckle) p.lerp(knuckle.getWorldPosition(V()), 0.5);
    const hq = hand.getWorldQuaternion(new THREE.Quaternion()).invert();
    out.push({ upper, lower, hand, palmLocal: hand.worldToLocal(p), shoulder: bone(rig, `Shoulder${k}`), side, fingers, thumb, curlAxis: fingers.length === 16 ? bendAxis(fingers.slice(4, 8), hq) : null, thumbAxis: thumb.length === 3 ? bendAxis(thumb, hq) : null });
  }
  return out;
}

/**
 * The axis a finger chain already bends about in the clip pose (its natural curl toward the palm):
 * (b − a) × (c − b) over its joints, the most bent pair; in the hand's frame (`hq` = inverse wrist
 * world rotation), so it follows the hand. A positive turn about it closes the finger further.
 */
function bendAxis(chain: THREE.Object3D[], hq: THREE.Quaternion) {
  const p = chain.map((o) => o.getWorldPosition(V()));
  let best: THREE.Vector3 | null = null;
  for (let i = 0; i + 2 < p.length; i++) {
    const n = V().subVectors(p[i + 1], p[i]).normalize().cross(V().subVectors(p[i + 2], p[i + 1]).normalize());
    if (!best || n.lengthSq() > best.lengthSq()) best = n;
  }
  return best && best.lengthSq() > 1e-6 ? best.normalize().applyQuaternion(hq) : null;
}

/** Closed grip: curl (rad) of finger joints 1 (metacarpal), 2 (knuckle), 3, 4; thumb joints 1, 2, 3. */
const CURL = [0.1, 1.0, 1.15, 0.7], THUMB = [0.15, 0.35, 0.45];

/**
 * Close the hand around a grip by `w` (0 = the clip's open hand, 1 = closed): each finger joint turns
 * about the axis its finger already bends about in the clip pose (bendAxis: toward the palm), the thumb
 * likewise about its own. One world axis per chain, so turning a parent joint leaves its children's
 * axis unchanged. World-space rotations on top of the clip; composes with the arm IK.
 */
export function curlHand(arm: Arm, w: number) {
  if (w <= 0 || !arm.curlAxis || arm.fingers.length < 16) return;
  const hq = arm.hand.getWorldQuaternion(_qh); // (turn() uses the other scratch quaternions)
  const axis = _ca.copy(arm.curlAxis).applyQuaternion(hq), ta = arm.thumbAxis ? _ta.copy(arm.thumbAxis).applyQuaternion(hq) : null;
  for (let f = 0; f < 4; f++)
    for (let j = 0; j < 4; j++) turn(arm.fingers[f * 4 + j], axis, CURL[j] * w);
  if (ta) arm.thumb.forEach((t, j) => turn(t, ta, THUMB[j] * w));
}
const _qh = new THREE.Quaternion(), _ca = new THREE.Vector3(), _ta = new THREE.Vector3();

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
const _s = V(), _e = V(), _w = V(), _t = V(), _d = V(), _n = V(), _pole = V(), _c = V(), _elbow = V(), _end = V(), _goal = V(), _tmp = V();
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
  return arm.hand.localToWorld(out.copy(arm.palmLocal));
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
