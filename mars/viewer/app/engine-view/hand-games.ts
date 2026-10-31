// Entry 35 (packet 44): the drawn side of holding hands and rock-paper-scissors. Pure functions of the recorded body
// state (social/hand-hold.ts `handHold`, social/rps.ts `rps`), the take tick and the two drawn roots, so scrubbing,
// replay and live play agree. Each layer IKs one arm onto its goal, turns the wrist to the pose's palm and finger
// directions (the rig's own palm frame, as flatHand does), shapes the fingers on the rig's finger bones
// (Index/Middle/Ring/Pinky 1–4, Thumb 1–3), then blends every arm, hand and finger bone from the pose the arm had
// (clip, idle, walk) by the layer's weight, so the arm travels in and back out without a pop.
import * as THREE from 'three';
import { BODY_MODEL, UP, armTo, clamp01, palm, setWorldQuat, smooth, swing, turn, type Arm } from './rig.ts';
import { RPS, type RpsState, type RpsShape } from '../../engine/social/rps.ts';
import { JOIN_SECONDS, OFFER_SECONDS, RELEASE_SECONDS, type HandHoldState } from '../../engine/social/hand-hold.ts';

/** Seconds over which idle gestures fade out as a hand game begins, and back in once it is over (humans.ts GESTURE_FADE). */
const FADE = 1.4;
/** Palm centre to palm surface (half a hand's thickness, humans.ts PALM_LIFT). */
export const PALM_HALF = 0.02;
/** Joined hands: palm height above the feet, and how far ahead of the pair's shoulders they hang. */
const HOLD_Y = 0.9, HOLD_AHEAD = 0.07;
/** RPS fist: ahead of the shoulder, below it (ready, at the top of a pump), and the pump's height. */
const FIST_AHEAD = 0.34, FIST_DOWN = 0.34, PUMP = 0.13, FIST_IN = 0.05;
/** Finger joint curls per unit (rig.ts CURL / THUMB), the per-finger shapes and their thumb. */
const CURL = [0.1, 1.0, 1.15, 0.7], THUMB = [0.15, 0.35, 0.45];
type Shape = { fingers: [number, number, number, number]; thumb: number; spread: number };
const FIST: Shape = { fingers: [1, 1, 1, 1], thumb: 1.6, spread: 0 };
const SHAPES: Record<RpsShape, Shape> = {
  rock: FIST,
  // flat and together: every finger straightened along its own metacarpal (a negative value straightens, see shapeFingers)
  paper: { fingers: [-1, -1, -1, -1], thumb: 0.15, spread: 0 },
  scissors: { fingers: [-1, -1, 1, 1], thumb: 1.6, spread: 0.2 },
};
const GRIP: Shape = { fingers: [0.62, 0.6, 0.58, 0.56], thumb: 0.55, spread: 0 };
const OPEN: Shape = { fingers: [0.12, 0.12, 0.14, 0.16], thumb: 0.2, spread: 0 };

export type HandGameView = {
  handHold?: HandHoldState; rps?: RpsState;
  /** The take tick drawn now (fractional) and the take's tick length. */
  hgTick?: number; hgDt?: number;
  /** The hand partner's drawn root (handHold.with), when it is in this frame. */
  holdP?: THREE.Vector3;
};
export type HandGameDiag = { kind: 'hold' | 'offer' | 'rps'; w: number; side: 'left' | 'right'; shape?: string; beat?: number;
  /** Total drawn curl (rad) of each finger (index, middle, ring, pinky) and the thumb of the layered hand. */
  curl: number[]; palm: number[];
  /** The palm's outward normal as drawn, and how far the index fingertip joint lies to that side of its knuckle (m): a
   *  closed hand's fingers curl toward its palm, so this is positive for a fist when the palm frame is the right way up. */
  normal: number[]; curlSide: number };

const S = (x: number) => smooth(clamp01(x));
const V = () => new THREE.Vector3();
const holdWeight = (hh: HandHoldState, tick: number, dt: number) => {
  const at = (k: number) => {
    const offer = hh.offered !== undefined ? S((k - hh.offered) * dt / OFFER_SECONDS) : 0;
    if (hh.since === undefined || k < hh.since) return { w: offer, mix: 0, grip: 0 };
    const base = hh.offered !== undefined ? S((hh.since - hh.offered) * dt / OFFER_SECONDS) : 0, j = S((k - hh.since) * dt / JOIN_SECONDS);
    return { w: base + (1 - base) * j, mix: j, grip: S(((k - hh.since) * dt - JOIN_SECONDS * 0.55) / (JOIN_SECONDS * 0.45)) };
  };
  if (hh.release === undefined || tick < hh.release) return at(tick);
  const r = at(hh.release), u = (tick - hh.release) * dt;
  return { w: r.w * (1 - S(u / RELEASE_SECONDS)), mix: r.mix, grip: r.grip * (1 - S(u / (RELEASE_SECONDS * 0.4))) };
};
/** How far idle gestures are held off now (0..1): faded out from the game's start, back in after it. */
export function handGameSuppress(v: HandGameView): number {
  const t = v.hgTick, dt = v.hgDt ?? 0.05; if (t === undefined) return 0;
  const hh = v.handHold;
  if (hh) {
    const start = hh.offered ?? hh.since; if (start === undefined) return 0;
    const end = hh.release !== undefined ? hh.release + RELEASE_SECONDS / dt : Infinity;
    return t < end ? S((t - start) * dt / FADE) : 1 - S((t - end) * dt / FADE);
  }
  if (v.rps) return S((t - v.rps.start) * dt / FADE);
  return 0;
}
/** Is a hand-game layer drawn this frame (so humans.ts layers the body even when nothing else would)? */
export const handGameActive = (v: HandGameView) => !!(v.hgTick !== undefined && (v.rps || v.handHold));

/** The rig's palm frame in the wrist's local frame: finger direction, palm normal (out of the palm), and their cross. */
function palmFrame(arm: Arm) {
  const fl = V().copy(arm.palmLocal).normalize(), nl = V().crossVectors(arm.curlAxis!, fl).normalize(), bl = V().crossVectors(fl, nl);
  return { fl, nl, bl };
}
/** The wrist's world rotation that points the fingers along F and the palm along N (F ⟂ N assumed after Gram-Schmidt). */
function handQuat(arm: Arm, F: THREE.Vector3, N: THREE.Vector3) {
  const f = V().copy(F).normalize(), n = V().copy(N).addScaledVector(f, -N.dot(f)).normalize(), b = V().crossVectors(f, n);
  const { fl, nl, bl } = palmFrame(arm);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(f, n, b).multiply(new THREE.Matrix4().makeBasis(fl, nl, bl).transpose()));
}
/** IK the palm onto `goal`, turn the wrist to `q`, and again (the palm centre moves as the wrist turns). */
function placeHand(arm: Arm, holder: THREE.Object3D, goal: THREE.Vector3, q: THREE.Quaternion, pole: THREE.Vector3) {
  for (let it = 0; it < 3; it++) { armTo(arm, goal, 1, BODY_MODEL.maxExtension, holder, pole); setWorldQuat(arm.hand, q); }
}
/** Shape the fingers on the rig's bones: each finger curls about the hand's own curl axis; scissors spread two apart. */
function shapeFingers(arm: Arm, s: Shape) {
  if (!arm.curlAxis || arm.fingers.length < 16) return;
  const hq = arm.hand.getWorldQuaternion(new THREE.Quaternion()), axis = V().copy(arm.curlAxis).applyQuaternion(hq);
  for (let f = 0; f < 4; f++) {
    const c = s.fingers[f], chain = arm.fingers.slice(f * 4, f * 4 + 4);
    if (c >= 0) { for (let j = 0; j < 4; j++) turn(chain[j], axis, CURL[j] * c); continue; }
    // straighten by -c: each joint swings its segment onto the line of the one before (the finger's own axis, not the
    // middle finger's curl axis, so a pinky that bends a little sideways in the clip still comes out straight)
    for (let j = 1; j < 3; j++) {
      const a = chain[j - 1].getWorldPosition(V()), b = chain[j].getWorldPosition(V()), q = chain[j + 1].getWorldPosition(V());
      swing(chain[j], q, V().copy(b).addScaledVector(V().subVectors(b, a).normalize(), b.distanceTo(q)), -c);
    }
  }
  if (s.spread) {
    // index toward the thumb side, middle away from it, about the palm normal at the knuckles
    const { nl } = palmFrame(arm), n = V().copy(nl).applyQuaternion(hq);
    const kI = arm.fingers[1].getWorldPosition(V()), kM = arm.fingers[5].getWorldPosition(V()), lateral = V().subVectors(kI, kM).normalize();
    const along = V().subVectors(arm.fingers[6].getWorldPosition(V()), kM).normalize(), sign = Math.sign(V().crossVectors(n, along).dot(lateral)) || 1;
    turn(arm.fingers[1], n, sign * s.spread); turn(arm.fingers[5], n, -sign * s.spread * 0.6);
  }
  if (arm.thumbAxis && arm.thumb.length === 3) { const ta = V().copy(arm.thumbAxis).applyQuaternion(hq); arm.thumb.forEach((t, j) => turn(t, ta, THUMB[j] * s.thumb)); }
}
const mixShape = (a: Shape, b: Shape, k: number): Shape => ({ fingers: a.fingers.map((x, i) => x + (b.fingers[i] - x) * k) as Shape['fingers'], thumb: a.thumb + (b.thumb - a.thumb) * k, spread: a.spread + (b.spread - a.spread) * k });
/** Total bend (rad) of each finger chain and the thumb, as drawn (diagnostics and the acceptance read-out). */
function facing(arm: Arm) {
  const n = V().copy(palmFrame(arm).nl).applyQuaternion(arm.hand.getWorldQuaternion(new THREE.Quaternion())), side = arm.fingers.length >= 16 ? V().subVectors(arm.fingers[3].getWorldPosition(V()), arm.fingers[1].getWorldPosition(V())).dot(n) : 0;
  return { normal: n.toArray().map((x) => +x.toFixed(3)), curlSide: +side.toFixed(4) };
}
export function fingerCurls(arm: Arm): number[] {
  const bend = (bones: THREE.Object3D[]) => { const p = bones.map((b) => b.getWorldPosition(V())); let s = 0; for (let i = 0; i + 2 < p.length; i++) s += V().subVectors(p[i + 1], p[i]).normalize().angleTo(V().subVectors(p[i + 2], p[i + 1]).normalize()); return +s.toFixed(3); };
  return arm.fingers.length < 16 ? [] : [0, 1, 2, 3].map((f) => bend(arm.fingers.slice(f * 4, f * 4 + 4))).concat(arm.thumb.length === 3 ? [bend(arm.thumb)] : []);
}
/** Blend one arm's bones (and its fingers) from `from` (the pose before this layer) to their pose now by w. */
function blendArm(arm: Arm, from: { o: THREE.Object3D; q: THREE.Quaternion; p: THREE.Vector3 }[], w: number, holder: THREE.Object3D) {
  for (const b of from) { b.o.quaternion.copy(b.q.clone().slerp(b.o.quaternion.clone(), w)); b.o.position.copy(b.p.clone().lerp(b.o.position.clone(), w)); }
  holder.updateMatrixWorld(true);
}
const bonesOf = (arm: Arm) => [...(arm.shoulder ? [arm.shoulder] : []), arm.upper, arm.lower, arm.hand, ...arm.fingers, ...arm.thumb].map((o) => ({ o, q: o.quaternion.clone(), p: o.position.clone() }));

/**
 * Draw this body's hand game over its arms (after every other arm layer). `side(i)` names arm i; `fwd`/`right` are the
 * body's drawn forward and right; `floor` its feet. Returns a read-out, or null when nothing is drawn.
 */
export function poseHandGames(v: HandGameView, arms: Arm[], side: (i: number) => 'left' | 'right', holder: THREE.Object3D, fwd: THREE.Vector3, right: THREE.Vector3, floor: number, head?: THREE.Object3D): HandGameDiag | null {
  const tick = v.hgTick, dt = v.hgDt ?? 0.05; if (tick === undefined) return null;
  const P = holder.position;
  // ---- holding hands (and an offered hand)
  if (v.handHold && v.holdP) {
    const hh = v.handHold, i = arms.findIndex((_, k) => side(k) === hh.hand), arm = arms[i]; if (!arm?.curlAxis) return null;
    const { w, mix, grip } = holdWeight(hh, tick, dt); if (w <= 1e-4) return null;
    const Q = v.holdP, u = V().set(Q.x - P.x, 0, Q.z - P.z); if (u.lengthSq() < 1e-6) return null; u.normalize();
    // the pair's forward: mine, square to the line between us (both bodies face the same way when holding hands)
    const fp = V().copy(fwd).addScaledVector(u, -fwd.dot(u)); if (fp.lengthSq() < 1e-6) fp.set(-u.z, 0, u.x); fp.normalize();
    const front = hh.hand === 'right';   // the body on the left holds in front, palm back; the other behind, palm forward
    const Nh = V().copy(fp).multiplyScalar(front ? -1 : 1), M = V().set((P.x + Q.x) / 2, floor + HOLD_Y, (P.z + Q.z) / 2).addScaledVector(fp, HOLD_AHEAD);
    const holdGoal = V().copy(M).addScaledVector(Nh, -PALM_HALF), holdF = V().copy(UP).multiplyScalar(-0.8).addScaledVector(u, 0.55);
    // an offered hand: out toward them, low, palm up and a little toward them, fingers forward and toward them
    const offerGoal = V().copy(P).addScaledVector(u, 0.36).addScaledVector(fwd, 0.2).setY(floor + 0.96), offerN = V().copy(UP).multiplyScalar(0.85).addScaledVector(u, 0.5), offerF = V().copy(fwd).multiplyScalar(0.75).addScaledVector(u, 0.6);
    const goal = V().copy(offerGoal).lerp(holdGoal, mix), q = handQuat(arm, offerF, offerN).slerp(handQuat(arm, holdF, Nh), mix);
    const pole = V().copy(fp).multiplyScalar(-0.7).addScaledVector(UP, -0.5).addScaledVector(u, -0.15);
    const from = bonesOf(arm);
    placeHand(arm, holder, goal, q, pole);
    shapeFingers(arm, mixShape(OPEN, GRIP, grip));
    blendArm(arm, from, w, holder);
    return { kind: hh.since === undefined ? 'offer' : 'hold', w: +w.toFixed(3), side: hh.hand, curl: fingerCurls(arm), palm: palm(arm, V()).toArray().map((x) => +x.toFixed(4)), ...facing(arm) };
  }
  // ---- rock-paper-scissors (the right hand)
  if (v.rps) {
    const r = v.rps, t = (tick - r.start) * dt; if (t < 0) return null;
    const w = t < RPS.RAISE ? S(t / RPS.RAISE) : t < RPS.HOLD_END ? 1 : 1 - S((t - RPS.HOLD_END) / (RPS.DOWN_END - RPS.HOLD_END)); if (w <= 1e-4) return null;
    const i = arms.findIndex((_, k) => side(k) === 'right'), arm = arms[i]; if (!arm?.curlAxis) return null;
    const shoulder = arm.upper.getWorldPosition(V());
    // pumps: the fist is up between beats and down on each (FIRST, +BEAT, +2·BEAT) and on the shoot; then stays down
    const phi = (t - RPS.FIRST) / RPS.BEAT, up = t < RPS.FIRST - RPS.BEAT / 2 ? 1 : t >= RPS.SHOOT ? 0 : (1 - Math.cos(2 * Math.PI * phi)) / 2;
    const goal = V().copy(shoulder).addScaledVector(fwd, FIST_AHEAD + 0.03 * (1 - up)).addScaledVector(right, -FIST_IN).addScaledVector(UP, -FIST_DOWN - PUMP + PUMP * up);
    const shootK = r.shape ? S((t - RPS.SHOOT + 0.04) / 0.16) : 0, shape = r.shape ? SHAPES[r.shape] : FIST;
    // the fist pumps palm in and down; paper turns palm down, scissors palm in, fingers forward
    const F = V().copy(fwd).addScaledVector(UP, -0.12), Nfist = V().copy(right).multiplyScalar(-0.75).addScaledVector(UP, -0.55);
    const Nshape = r.shape === 'paper' ? V().copy(UP).multiplyScalar(-1).addScaledVector(right, -0.15) : r.shape === 'scissors' ? V().copy(right).multiplyScalar(-1).addScaledVector(UP, -0.2) : Nfist;
    const q = handQuat(arm, F, Nfist).slerp(handQuat(arm, V().copy(fwd).addScaledVector(UP, -0.04), Nshape), shootK);
    const pole = V().copy(right).multiplyScalar(0.45).addScaledVector(UP, -0.6).addScaledVector(fwd, -0.25);
    const from = bonesOf(arm);
    placeHand(arm, holder, goal, q, pole);
    shapeFingers(arm, mixShape(FIST, shape, shootK));
    blendArm(arm, from, w, holder);
    // look at the hands while they count and throw
    if (head) { const axis = right.clone().applyQuaternion(head.parent!.getWorldQuaternion(new THREE.Quaternion()).invert()); head.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, -0.22 * w)); holder.updateMatrixWorld(true); }
    return { kind: 'rps', w: +w.toFixed(3), side: 'right', ...(r.shape ? { shape: r.shape } : {}), beat: +phi.toFixed(3), curl: fingerCurls(arm), palm: palm(arm, V()).toArray().map((x) => +x.toFixed(4)), ...facing(arm) };
  }
  return null;
}
