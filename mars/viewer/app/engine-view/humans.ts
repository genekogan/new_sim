// Engine humans → animated rigs. Renderers only read world state (guide):
// after every fixed tick we snapshot pose + derive clip state; frames
// interpolate between the last two ticks, so visuals are a deterministic
// function of sim history (not of frame rate).
//
// Only Idle/Walk clips exist, so activities without a clip get a procedural pose layer on top of
// the clip (after mixer.update, every frame, nothing accumulates):
// - sit: body lowered onto the seat, thighs forward, shins down, hands on the thighs;
// - grip (support/hold/lift/carry): two-bone arm IK onto the gripped part within reach, plus a
//   slight forward lean and shoulder raise/drop toward it; carriers keep their elbows bent;
// - warm: forearms held out toward the fire when its edge is within 1.2 m.
// All of it is a pure function of (world history, entity id): no randomness.
import * as THREE from 'three';
import type { WorldState } from '../../engine/world/types.ts';
import { CATALOG } from '../../engine/world/catalog.ts';
import { DT } from '../../engine/runtime/runtime.ts';
import { createRig, type Rig, type Template } from './people.ts';
import { seatHeight } from './fixtures.ts';

type Snap = { p: [number, number, number]; yaw: number; walkW: number; walkT: number; idleT: number; sitW: number; warmW: number };
type Arm = { upper: THREE.Object3D; lower: THREE.Object3D; hand: THREE.Object3D; shoulder?: THREE.Object3D; side: number };
/** Leg chain. The Quaternius rig's Foot bones are children of Root (baked IK targets), not of LowerLeg. */
type Leg = { upper: THREE.Object3D; lower: THREE.Object3D; foot: THREE.Object3D };
type Spine = { body: THREE.Object3D; abdomen: THREE.Object3D; torso: THREE.Object3D };
type View = {
  rig: Rig;
  prev: Snap;
  cur: Snap;
  speed: number;
  activity: string;
  grip?: string;
  arms: Arm[];
  legs: Leg[];
  spine?: Spine;
  /** Sitting-surface height of the occupied seat (m). */
  seat: number;
  /** Nearest campfire (centre x, z and ring radius) for `warm`. */
  fire?: [number, number, number];
  /** Per-person variation in [0, 1), from the id. */
  vary: number;
  /** Bones the pose layers touch, with their clip-local transforms from the last mixer apply. */
  saved: { o: THREE.Object3D; p: THREE.Vector3; q: THREE.Quaternion }[];
  layered: boolean;
};
/**
 * One person in a random-access frame (take replay / scrubbing). `walk` is the Walk clip weight
 * (0–1) and `walkDist` the metres walked along the track so far, so the Walk phase is a pure
 * function of take time: clip seconds = metres / clip ground speed (feet speed-matched).
 */
export type SampledHuman = { id: string; p: [number, number, number]; yaw: number; walk: number; walkDist: number; activity?: string; grip?: string };
/** Nearest point of a gripped entity to a world point (components.ts nearestPoint). */
export type Reach = (entity: string, from: THREE.Vector3, out: THREE.Vector3) => boolean;

const BLEND = DT / 0.3; // Walk↔Idle crossfade 0.3 s, as in the studio
const POSE_BLEND = DT / 0.4; // sit / warm in and out over 0.4 s
const SEAT_DEFAULT = 0.45; // m, when the seat fixture is unknown (take replay)
const SEAT_MATCH = 0.8; // m, body point to nearest seat point (covers the sit-down / stand-up approach line)
const SEATED = new Set(['sit', 'sit-down', 'stand-up']);
const PELVIS = 0.09; // m from the hip joints down to the sitting surface (thigh/buttock thickness)
const LEAN = (13 * Math.PI) / 180; // forward lean into a gripped part
const WARM_REACH = 1.2; // m from the fire's edge within which people hold their hands out
const lerpAngle = (a: number, b: number, t: number) => a + (((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * t;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function hashId(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/** Stable template choice per actor id. */
function templateFor(id: string, ts: Template[]) {
  return ts[hashId(id) % ts.length];
}

type Fixtures = { seats: [number, number, number][]; fires: [number, number, number][] };

/** Seat points (x, z, sitting height) and campfires (x, z, ring radius) from the world's fixtures. */
function fixturesOf(world: WorldState): Fixtures {
  const out: Fixtures = { seats: [], fires: [] };
  for (const e of Object.values(world.entities)) {
    if (e.kind !== 'fixture') continue;
    const d = CATALOG[e.def];
    if (e.def === 'campfire') out.fires.push([e.pose.p[0], e.pose.p[2], (d?.size[0] ?? 1) / 2]);
    const h = seatHeight(e.def);
    if (h === undefined) continue;
    const c = Math.cos(e.pose.yaw), s = Math.sin(e.pose.yaw);
    for (const sl of d?.slots ?? [])
      if (sl.kind === 'seat') out.seats.push([e.pose.p[0] + sl.local[0] * c - sl.local[1] * s, e.pose.p[2] + sl.local[0] * s + sl.local[1] * c, e.pose.p[1] + h]);
  }
  return out;
}

function nearest(list: [number, number, number][], x: number, z: number) {
  let best: [number, number, number] | undefined, bd = Infinity;
  for (const f of list) {
    const d = Math.hypot(f[0] - x, f[1] - z);
    if (d < bd) [best, bd] = [f, d];
  }
  return { f: best, d: bd };
}

export class HumanViews {
  readonly group = new THREE.Group();
  private views = new Map<string, View>();
  private templates: Template[] = [];

  constructor() {
    this.group.name = 'engine humans';
  }

  setTemplates(ts: Template[]) {
    this.templates = ts;
  }

  clear() {
    for (const v of this.views.values()) {
      v.rig.mixer.stopAllAction();
      v.rig.mixer.uncacheRoot(v.rig.model);
    }
    this.views.clear();
    this.group.clear();
  }

  /** Create/destroy rigs to match the world and take a first snapshot. */
  reset(world: WorldState) {
    this.clear();
    this.onTick(world);
  }

  private make(id: string, s: Snap, activity: string): View {
    const rig = createRig(templateFor(id, this.templates));
    rig.holder.name = id;
    this.group.add(rig.holder);
    const arms = armsOf(rig), legs = legsOf(rig), spine = spineOf(rig);
    const touched = [...arms.flatMap((a) => [a.upper, a.lower, a.shoulder]), ...legs.flatMap((l) => [l.upper, l.lower, l.foot]), spine?.body, spine?.abdomen, spine?.torso];
    const saved = touched.filter((o): o is THREE.Object3D => !!o).map((o) => ({ o, p: o.position.clone(), q: o.quaternion.clone() }));
    const v: View = { rig, prev: s, cur: { ...s }, speed: 0, activity, arms, legs, spine, seat: SEAT_DEFAULT, vary: (hashId(id) % 1000) / 1000, saved, layered: false };
    this.views.set(id, v);
    return v;
  }

  /** Call after every engine tick. Pure function of (previous snapshot, world). */
  onTick(world: WorldState) {
    if (!this.templates.length) return;
    let fx: Fixtures | undefined;
    for (const e of Object.values(world.entities)) {
      if (e.kind !== 'human' || !e.human) continue;
      const act = e.human.activity;
      let v = this.views.get(e.id);
      if (!v) {
        const s: Snap = { p: [...e.pose.p], yaw: e.pose.yaw, walkW: 0, walkT: 0, idleT: (e.id.length * 0.37) % 1, sitW: act === 'sit' ? 1 : 0, warmW: act === 'warm' ? 1 : 0 };
        v = this.make(e.id, s, act);
        v.grip = e.human.grip?.entity;
        continue;
      }
      const c = v.cur;
      // Horizontal ground speed → walk clip rate (feet speed-matched); smoothed against tick noise.
      const inst = Math.hypot(e.pose.p[0] - c.p[0], e.pose.p[2] - c.p[2]) / DT;
      v.speed += (inst - v.speed) * 0.5;
      v.activity = act;
      v.grip = e.human.grip?.entity;
      // Honest clip mapping: anyone translating over the ground plays Walk speed-matched (walk,
      // climb, carry on the move, a crew gathering); anyone standing plays Idle, with the pose
      // layers of render() on top (sit, warm, hold/support/lift/carry grips).
      // sit-down / stand-up (0.6 s, engine/social) slide the body point between the seat's approach
      // point and the seat: that is the sit pose blending in/out, not walking
      const seated = SEATED.has(act);
      const walking = !seated && (act === 'walk' || act.startsWith('climb') || v.speed > 0.08);
      if (seated || act === 'warm') {
        fx ??= fixturesOf(world);
        if (seated) {
          const n = nearest(fx.seats, e.pose.p[0], e.pose.p[2]);
          v.seat = n.f && n.d <= SEAT_MATCH ? n.f[2] - e.pose.p[1] : SEAT_DEFAULT;
        } else v.fire = nearest(fx.fires, e.pose.p[0], e.pose.p[2]).f;
      }
      const sitting = (act === 'sit' || act === 'sit-down') && !walking;
      const walkW = clamp01(c.walkW + (walking ? BLEND : -BLEND));
      const rate = walking ? Math.max(0.35, v.speed / v.rig.template.walkSpeed) : 1;
      const dur = v.rig.walk.getClip().duration;
      v.prev = c;
      v.cur = {
        p: [...e.pose.p],
        yaw: e.pose.yaw,
        walkW,
        walkT: walkW > 0 ? (c.walkT + DT * rate) % dur : 0,
        idleT: (c.idleT + DT) % v.rig.idle.getClip().duration,
        sitW: clamp01(c.sitW + (sitting ? POSE_BLEND : -POSE_BLEND)),
        warmW: clamp01(c.warmW + (act === 'warm' && !walking ? POSE_BLEND : -POSE_BLEND)),
      };
    }
    for (const [id, v] of this.views)
      if (!world.entities[id]) {
        this.group.remove(v.rig.holder);
        this.views.delete(id);
      }
  }

  /**
   * Random-access pose for take replay: set every rig straight from a sampled frame (no tick
   * history, so scrubbing backwards or jumping gives the same picture as playing through; sit is
   * therefore fully in or out, at the default seat height — takes carry no fixtures).
   * Rigs for ids missing from `frame` are removed. Follow with `render(1, reach)`.
   */
  setFrame(frame: SampledHuman[], t: number) {
    if (!this.templates.length) return;
    const seen = new Set<string>();
    for (const f of frame) {
      seen.add(f.id);
      const act = f.activity ?? 'idle';
      let v = this.views.get(f.id);
      if (!v) v = this.make(f.id, { p: [...f.p], yaw: f.yaw, walkW: 0, walkT: 0, idleT: 0, sitW: 0, warmW: 0 }, act);
      const walkDur = v.rig.walk.getClip().duration, idleDur = v.rig.idle.getClip().duration;
      const snap: Snap = {
        p: [...f.p],
        yaw: f.yaw,
        walkW: SEATED.has(act) ? 0 : f.walk,
        walkT: (f.walkDist / v.rig.template.walkSpeed) % walkDur,
        idleT: (t + (f.id.length * 0.37) % 1) % idleDur,
        sitW: act === 'sit' ? 1 : SEATED.has(act) ? 0.5 : 0, // sit-down / stand-up: halfway (no timing here)
        warmW: 0, // no fire position in a take frame
      };
      v.prev = v.cur = snap;
      v.activity = act;
      v.grip = f.grip;
      v.seat = SEAT_DEFAULT;
    }
    for (const [id, v] of this.views)
      if (!seen.has(id)) {
        v.rig.mixer.stopAllAction();
        this.group.remove(v.rig.holder);
        this.views.delete(id);
      }
  }

  /**
   * Apply interpolated pose/animation. alpha ∈ [0,1] = fraction of the next tick elapsed.
   * `reach`: people gripping a part (carry, raise/hold, lift) get a two-bone arm IK on top of the
   * clip so their hands land on the nearest point of that part — only when it is within arm's
   * reach; otherwise the arms stay as the clip has them (no stretching to fake contact).
   */
  render(alpha: number, reach?: Reach) {
    for (const v of this.views.values()) {
      const a = v.prev, b = v.cur, h = v.rig.holder;
      h.position.set(a.p[0] + (b.p[0] - a.p[0]) * alpha, a.p[1] + (b.p[1] - a.p[1]) * alpha, a.p[2] + (b.p[2] - a.p[2]) * alpha);
      const yaw = lerpAngle(a.yaw, b.yaw, alpha);
      h.rotation.y = -yaw;
      const w = a.walkW + (b.walkW - a.walkW) * alpha;
      const { walk, idle, mixer } = v.rig;
      const wt = b.walkT >= a.walkT ? a.walkT + (b.walkT - a.walkT) * alpha : b.walkT;
      walk.time = wt;
      idle.time = b.idleT;
      walk.setEffectiveWeight(w);
      idle.setEffectiveWeight(1 - w);
      // The mixer only writes a bone when its clip value changed since the last apply, so undo last
      // frame's pose layers first (back to that clip value) or they would accumulate while paused.
      if (v.layered) for (const b of v.saved) b.o.position.copy(b.p), b.o.quaternion.copy(b.q);
      v.layered = false;
      mixer.update(0);
      const sitW = a.sitW + (b.sitW - a.sitW) * alpha, warmW = a.warmW + (b.warmW - a.warmW) * alpha;
      const gripping = !!(reach && v.grip && v.arms.length);
      if (!(sitW > 0 || warmW > 0 || gripping)) continue;
      for (const b of v.saved) b.p.copy(b.o.position), b.q.copy(b.o.quaternion);
      v.layered = true;
      h.updateMatrixWorld(true);
      _fwd.set(Math.cos(yaw), 0, Math.sin(yaw)); // engine yaw 0 faces +x; holder.rotation.y = -yaw
      if (sitW > 0) sitPose(v, sitW, h.position.y);
      if (gripping) holdPose(v, reach!, v.grip!);
      else if (sitW > 0) handsOnThighs(v, sitW);
      if (warmW > 0 && v.fire && !gripping) warmHands(v, warmW, h.position);
    }
  }

  /** Interpolated world positions (for labels/discs) keyed by actor id. */
  positions() {
    return new Map([...this.views].map(([id, v]) => [id, v.rig.holder.position]));
  }

  info() {
    return [...this.views].map(([id, v]) => ({ id, template: v.rig.template.name, clipSpeed: +v.rig.template.walkSpeed.toFixed(3), forward: v.rig.template.forward, speed: +v.speed.toFixed(3), walkWeight: +v.cur.walkW.toFixed(2), activity: v.activity, grip: v.grip ?? null, arms: v.arms.length, sit: +v.cur.sitW.toFixed(2), seat: v.cur.sitW > 0 ? +v.seat.toFixed(2) : null }));
  }
}

function bone(rig: Rig, name: string) {
  let out: THREE.Object3D | undefined;
  rig.model.traverse((o) => {
    if (!out && (o as THREE.Bone).isBone && o.name === name) out = o;
  });
  return out;
}

function armsOf(rig: Rig): Arm[] {
  const out: Arm[] = [];
  for (const [k, side] of [['L', 1], ['R', -1]] as const) {
    const upper = bone(rig, `UpperArm${k}`), lower = bone(rig, `LowerArm${k}`), hand = bone(rig, `Wrist${k}`);
    if (upper && lower && hand) out.push({ upper, lower, hand, shoulder: bone(rig, `Shoulder${k}`), side });
  }
  return out;
}

function legsOf(rig: Rig): Leg[] {
  const out: Leg[] = [];
  for (const k of ['L', 'R']) {
    const upper = bone(rig, `UpperLeg${k}`), lower = bone(rig, `LowerLeg${k}`), foot = bone(rig, `Foot${k}`);
    if (upper && lower && foot) out.push({ upper, lower, foot });
  }
  return out;
}

function spineOf(rig: Rig): Spine | undefined {
  const body = bone(rig, 'Body'), abdomen = bone(rig, 'Abdomen'), torso = bone(rig, 'Torso');
  return body && abdomen && torso ? { body, abdomen, torso } : undefined;
}

const V = () => new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const _s = V(), _e = V(), _w = V(), _t = V(), _d = V(), _n = V(), _pole = V(), _c = V(), _elbow = V(), _end = V(), _goal = V(), _fwd = V(), _ax = V(), _tmp = V(), _hip = V(), _knee = V();
const _ends: THREE.Vector3[] = [V(), V()];
const _goals: THREE.Vector3[] = [V(), V()];
const _q = new THREE.Quaternion(), _qs = new THREE.Quaternion(), _qw = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _id = new THREE.Quaternion();

/** Rotate `bone` (world space) so the direction from its origin to `from` turns toward `to`, by `weight`. */
function swing(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, weight: number) {
  bone.getWorldPosition(_c);
  const a = _d.subVectors(from, _c).normalize(), b = _n.subVectors(to, _c).normalize();
  if (a.lengthSq() < 1e-8 || b.lengthSq() < 1e-8) return;
  _q.setFromUnitVectors(a, b);
  _qs.slerpQuaternions(_id, _q, weight); // (not in place: slerpQuaternions copies its first argument into `this`)
  applyWorld(bone, _qs);
}

/** Pre-multiply a world-space rotation onto `bone`. */
function applyWorld(bone: THREE.Object3D, q: THREE.Quaternion) {
  bone.getWorldQuaternion(_qw);
  bone.parent!.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(q.clone().multiply(_qw)));
  bone.updateMatrixWorld(true);
}

/** Rotate `bone` by `angle` about a world axis. */
function turn(bone: THREE.Object3D, axis: THREE.Vector3, angle: number) {
  applyWorld(bone, _qs.setFromAxisAngle(axis, angle));
}

/** Move `bone`'s origin to a world point (keeps its world rotation: its parent does not change). */
function place(bone: THREE.Object3D, world: THREE.Vector3) {
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
function ik(upper: THREE.Object3D, lower: THREE.Object3D, end: THREE.Vector3, goal: THREE.Vector3, poleDir: THREE.Vector3, weight: number, maxExt: number) {
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

/** Arm chain length (shoulder→elbow→wrist) in world metres. */
function armLen(arm: Arm) {
  arm.upper.getWorldPosition(_s);
  arm.lower.getWorldPosition(_e);
  arm.hand.getWorldPosition(_w);
  return _s.distanceTo(_e) + _e.distanceTo(_w);
}

/** Elbow pole: down plus outward from the body centre. */
function elbowPole(arm: Arm, body: THREE.Object3D, out: THREE.Vector3) {
  arm.upper.getWorldPosition(_s);
  body.getWorldPosition(_c);
  out.set(_s.x - _c.x, 0, _s.z - _c.z).normalize().multiplyScalar(0.5);
  out.y = -1;
  return out;
}

/** Arm IK onto `goal` by `weight`. */
function armTo(arm: Arm, goal: THREE.Vector3, weight: number, maxExt: number, body: THREE.Object3D) {
  arm.hand.getWorldPosition(_end);
  ik(arm.upper, arm.lower, _end, goal, elbowPole(arm, body, _n.clone()), weight, maxExt);
}

/**
 * Contact weight for a gripped point at `dist` from the shoulder: full within 1.02 arm lengths (the
 * hand lands within a few cm, reach clamped below full extension), fading to none by 1.25 — beyond
 * that the part is out of reach and the arm hangs as the clip has it (no reaching toward it).
 */
const contact = (dist: number, len: number) => clamp01((len * 1.25 - dist) / (len * 0.23));

/**
 * Seated: lower the body so the hip joints sit PELVIS above the seat, then leg IK — thighs forward,
 * feet on the ground under the knees (the Foot bones are moved to the shin ends). Weight blends the
 * whole thing in/out (a crouch-down on the way).
 */
function sitPose(v: View, w: number, ground: number) {
  if (!v.spine || v.legs.length < 2) return;
  const legs = v.legs;
  // leg geometry from the clip pose, before anything moves
  const ends = legs.map((l, i) => l.foot.getWorldPosition(_ends[i]));
  const lens = legs.map((l) => {
    l.upper.getWorldPosition(_hip);
    l.lower.getWorldPosition(_knee);
    return _hip.distanceTo(_knee);
  });
  const hipY = legs.reduce((s, l) => s + l.upper.getWorldPosition(_hip).y, 0) / legs.length;
  const drop = Math.max(0, hipY - (ground + v.seat + PELVIS)) * w;
  // the shin ends ride on the lower legs as the body drops (the Foot bones would stay on the ground)
  const local = legs.map((l, i) => l.lower.worldToLocal(_tmp.copy(ends[i])).clone());
  v.spine.body.getWorldPosition(_c);
  _c.y -= drop;
  place(v.spine.body, _c.clone());
  _pole.copy(_fwd).addScaledVector(UP, 0.3); // knees forward
  const pole = _pole.clone();
  legs.forEach((l, i) => {
    const end = l.lower.localToWorld(local[i].clone());
    const foot0 = ends[i];
    l.upper.getWorldPosition(_hip);
    // sitting target: under the knee of a horizontal thigh, at the clip's ankle height
    const sitGoal = _goals[i].copy(_hip).addScaledVector(_fwd, lens[i] * 0.95);
    sitGoal.y = foot0.y;
    const goal = foot0.clone().lerp(sitGoal, w);
    ik(l.upper, l.lower, end, goal, pole, 1, 0.995);
    place(l.foot, end);
  });
}

/** Seated hands resting on the thighs (unless gripping). */
function handsOnThighs(v: View, w: number) {
  v.arms.forEach((arm, i) => {
    const leg = v.legs[i];
    if (!leg) return;
    leg.upper.getWorldPosition(_hip);
    leg.lower.getWorldPosition(_knee);
    const goal = _hip.clone().lerp(_knee, 0.6).addScaledVector(UP, 0.1);
    armTo(arm, goal, w * 0.9, 0.97, v.rig.holder);
  });
}

/**
 * Hold / support / lift / carry: lean slightly into the part and raise or drop the shoulders toward
 * it (both scaled by how much of it is within reach), then put the hands on it by arm IK. Carriers
 * keep their elbows bent. Out of reach: no lean, arms as the clip has them.
 */
function holdPose(v: View, reach: Reach, grip: string) {
  const carry = v.activity === 'carry';
  const lens = v.arms.map(armLen);
  let lean = 0;
  v.arms.forEach((arm, i) => {
    arm.upper.getWorldPosition(_s);
    if (!reach(grip, _s, _goals[i])) return;
    const k = contact(_s.distanceTo(_goals[i]), lens[i]);
    _d.subVectors(_goals[i], _s).setY(0);
    const ahead = _d.lengthSq() > 1e-6 ? clamp01(_d.normalize().dot(_fwd) + 0.3) : 0;
    lean = Math.max(lean, k * ahead);
  });
  if (lean > 0 && v.spine) {
    _ax.crossVectors(UP, _fwd).normalize(); // rotating up about up×fwd tips it forward
    const ang = (carry ? 0.6 : 1) * LEAN * lean;
    turn(v.spine.abdomen, _ax, ang * 0.5);
    turn(v.spine.torso, _ax, ang * 0.5);
  }
  v.arms.forEach((arm, i) => {
    arm.upper.getWorldPosition(_s);
    if (!reach(grip, _s, _goals[i])) return;
    const k = contact(_s.distanceTo(_goals[i]), lens[i]);
    if (k <= 0) return;
    if (arm.shoulder) {
      // shrug up to ±2.5 cm at the shoulder joint toward the grip height
      const dy = Math.max(-1, Math.min(1, (_goals[i].y - _s.y) / 0.4)) * 0.025 * k;
      swing(arm.shoulder, _s.clone(), _s.clone().addScaledVector(UP, dy), 1);
      arm.upper.getWorldPosition(_s);
      reach(grip, _s, _goals[i]);
    }
    armTo(arm, _goals[i], k, carry ? 0.88 : 0.97, v.rig.holder);
  });
}

/** Warming: hands held out, a little down, toward the fire when its edge is within WARM_REACH. */
function warmHands(v: View, w: number, at: THREE.Vector3) {
  const [fx, fz, r] = v.fire!;
  const edge = Math.hypot(fx - at.x, fz - at.z) - r;
  const k = w * clamp01((WARM_REACH - edge) / 0.2);
  if (k <= 0) return;
  const dir = new THREE.Vector3(fx - at.x, 0, fz - at.z).normalize();
  const ext = 0.6 + 0.12 * v.vary; // per-person, seeded by id
  v.arms.forEach((arm) => {
    const len = armLen(arm);
    arm.upper.getWorldPosition(_s);
    const goal = _s.clone().addScaledVector(dir, len * ext).addScaledVector(UP, -len * 0.38);
    armTo(arm, goal, k * 0.85, 0.95, v.rig.holder);
  });
}
