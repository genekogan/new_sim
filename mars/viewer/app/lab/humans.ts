// Engine humans → animated rigs. Renderers only read world state (guide):
// after every fixed tick we snapshot pose + derive clip state; frames
// interpolate between the last two ticks, so visuals are a deterministic
// function of sim history (not of frame rate).
import * as THREE from 'three';
import type { WorldState } from '../../engine/world/types.ts';
import { DT } from '../../engine/runtime/runtime.ts';
import { createRig, type Rig, type Template } from './people.ts';

type Snap = { p: [number, number, number]; yaw: number; walkW: number; walkT: number; idleT: number };
type Arm = { upper: THREE.Object3D; lower: THREE.Object3D; hand: THREE.Object3D; side: number };
type View = { rig: Rig; prev: Snap; cur: Snap; speed: number; activity: string; grip?: string; arms: Arm[] };
/** Nearest point of a gripped entity to a world point (components.ts nearestPoint). */
export type Reach = (entity: string, from: THREE.Vector3, out: THREE.Vector3) => boolean;

const BLEND = DT / 0.3; // Walk↔Idle crossfade 0.3 s, as in the studio
const lerpAngle = (a: number, b: number, t: number) => a + (((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * t;

/** Stable template choice per actor id. */
function templateFor(id: string, ts: Template[]) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ts[h % ts.length];
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

  /** Call after every engine tick. Pure function of (previous snapshot, world). */
  onTick(world: WorldState) {
    if (!this.templates.length) return;
    for (const e of Object.values(world.entities)) {
      if (e.kind !== 'human' || !e.human) continue;
      let v = this.views.get(e.id);
      if (!v) {
        const rig = createRig(templateFor(e.id, this.templates));
        rig.holder.name = e.id;
        this.group.add(rig.holder);
        const s: Snap = { p: [...e.pose.p], yaw: e.pose.yaw, walkW: 0, walkT: 0, idleT: (e.id.length * 0.37) % 1 };
        v = { rig, prev: s, cur: { ...s }, speed: 0, activity: e.human.activity, grip: e.human.grip?.entity, arms: armsOf(rig) };
        this.views.set(e.id, v);
        continue;
      }
      const c = v.cur;
      // Horizontal ground speed → walk clip rate (feet speed-matched); smoothed against tick noise.
      const inst = Math.hypot(e.pose.p[0] - c.p[0], e.pose.p[2] - c.p[2]) / DT;
      v.speed += (inst - v.speed) * 0.5;
      const act = e.human.activity;
      v.activity = act;
      v.grip = e.human.grip?.entity;
      // Only Idle/Walk clips exist. Honest mapping: anyone translating over the ground plays Walk
      // speed-matched (walk, climb, carry on the move, a crew gathering); anyone standing plays Idle
      // (support/hold, lift, set-down, release, waiting, turning in place).
      const walking = act === 'walk' || act.startsWith('climb') || v.speed > 0.08;
      const walkW = Math.max(0, Math.min(1, c.walkW + (walking ? BLEND : -BLEND)));
      const rate = walking ? Math.max(0.35, v.speed / v.rig.template.walkSpeed) : 1;
      const dur = v.rig.walk.getClip().duration;
      v.prev = c;
      v.cur = {
        p: [...e.pose.p],
        yaw: e.pose.yaw,
        walkW,
        walkT: walkW > 0 ? (c.walkT + DT * rate) % dur : 0,
        idleT: (c.idleT + DT) % v.rig.idle.getClip().duration,
      };
    }
    for (const [id, v] of this.views)
      if (!world.entities[id]) {
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
      h.rotation.y = -lerpAngle(a.yaw, b.yaw, alpha);
      const w = a.walkW + (b.walkW - a.walkW) * alpha;
      const { walk, idle, mixer } = v.rig;
      const wt = b.walkT >= a.walkT ? a.walkT + (b.walkT - a.walkT) * alpha : b.walkT;
      walk.time = wt;
      idle.time = b.idleT;
      walk.setEffectiveWeight(w);
      idle.setEffectiveWeight(1 - w);
      mixer.update(0);
      if (reach && v.grip && v.arms.length) {
        h.updateMatrixWorld(true);
        for (const arm of v.arms) handOn(arm, v.grip, reach, h);
      }
    }
  }

  /** Interpolated world positions (for labels/discs) keyed by actor id. */
  positions() {
    return new Map([...this.views].map(([id, v]) => [id, v.rig.holder.position]));
  }

  info() {
    return [...this.views].map(([id, v]) => ({ id, template: v.rig.template.name, clipSpeed: +v.rig.template.walkSpeed.toFixed(3), forward: v.rig.template.forward, speed: +v.speed.toFixed(3), walkWeight: +v.cur.walkW.toFixed(2), activity: v.activity, grip: v.grip ?? null, arms: v.arms.length }));
  }
}

function armsOf(rig: Rig): Arm[] {
  const out: Arm[] = [];
  for (const [k, side] of [['L', 1], ['R', -1]] as const) {
    const upper = rig.model.getObjectByName(`UpperArm${k}`), lower = rig.model.getObjectByName(`LowerArm${k}`), hand = rig.model.getObjectByName(`Wrist${k}`);
    if (upper && lower && hand) out.push({ upper, lower, hand, side });
  }
  return out;
}

const V = () => new THREE.Vector3();
const _s = V(), _e = V(), _w = V(), _t = V(), _d = V(), _n = V(), _goal = V(), _pole = V(), _c = V();
const _q = new THREE.Quaternion(), _qs = new THREE.Quaternion(), _qw = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _id = new THREE.Quaternion();

/** Rotate `bone` (world space) so the direction from its origin to `from` turns toward `to`, by `weight`. */
function swing(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, weight: number) {
  bone.getWorldPosition(_c);
  const a = _d.subVectors(from, _c).normalize(), b = _n.subVectors(to, _c).normalize();
  if (a.lengthSq() < 1e-8 || b.lengthSq() < 1e-8) return;
  _q.setFromUnitVectors(a, b);
  _qs.slerpQuaternions(_id, _q, weight); // (not in place: slerpQuaternions copies its first argument into `this`)
  bone.getWorldQuaternion(_qw);
  bone.parent!.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(_qs.multiply(_qw)));
  bone.updateMatrixWorld(true);
}

/** Two-bone IK: shoulder→elbow→wrist onto the nearest point of the gripped part; elbow down and out. */
function handOn(arm: Arm, grip: string, reach: Reach, body: THREE.Object3D) {
  arm.upper.getWorldPosition(_s);
  arm.lower.getWorldPosition(_e);
  arm.hand.getWorldPosition(_w);
  if (!reach(grip, _s, _goal)) return;
  const a = _s.distanceTo(_e), b = _e.distanceTo(_w), len = a + b;
  const dist = _s.distanceTo(_goal);
  // full contact within reach (+10 % for shoulder/hand slack), fading out by 1.8x; beyond that the part is out of reach
  const weight = Math.max(0, Math.min(1, (len * 1.8 - dist) / (len * 0.7)));
  if (weight <= 0) return;
  const c = Math.max(0.05, Math.min(len * 0.999, dist));
  _t.subVectors(_goal, _s).normalize();
  const cosA = Math.max(-1, Math.min(1, (a * a + c * c - b * b) / (2 * a * c)));
  // pole: down plus outward from the body centre
  body.getWorldPosition(_c);
  _pole.set(_s.x - _c.x, 0, _s.z - _c.z).normalize().multiplyScalar(0.5);
  _pole.y = -1;
  _pole.addScaledVector(_t, -_pole.dot(_t)).normalize();
  const elbow = V().copy(_s).addScaledVector(_t, a * cosA).addScaledVector(_pole, a * Math.sqrt(1 - cosA * cosA));
  swing(arm.upper, _e, elbow, weight);
  arm.lower.getWorldPosition(_e);
  arm.hand.getWorldPosition(_w);
  const hand = V().copy(_s).addScaledVector(_t, c);
  swing(arm.lower, _w, hand, weight);
}
