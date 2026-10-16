// Procedurally built and procedurally animated creatures (R11a): a duck, a snail and a dog, drawn for creature
// bodies (engine/bodies/creatures.ts). No downloaded meshes, no clips and no licence questions: each creature is a
// small hierarchy of three.js primitives whose groups act as bones, posed every frame from the sampled ground
// pose, speed and activity:
//   idle   — breathing, head and tail life (duck: head bob and tail wag; snail: eye stalks sway; dog: tail wag, ear flick)
//   walk   — the species' gait, its cadence following the sampled speed (waddle, foot-wave slide, diagonal trot)
//   swim   — body at the waterline, paddling (duck, dog)
//   settle — the species' rest (duck sits, snail withdraws into its shell, dog lies down), eased in and out
// Model space: +X forward (the engine's yaw-0 direction), +Y up, ground at y = 0.
import * as THREE from 'three';
import type { CreatureId } from '../../engine/bodies/creatures.ts';
import { SWIM_ROOT_BELOW } from '../../engine/spatial/ground.ts';

export type CreatureMode = 'idle' | 'walk' | 'swim' | 'settle';
export type CreatureFrame = { mode: CreatureMode; speed: number; t: number; dt: number };

export interface CreatureRig {
  readonly species: CreatureId;
  readonly root: THREE.Group;
  /** Advance the animation to sim time `t` (s) by `dt` (s) of sim time since the last frame. */
  animate(f: CreatureFrame): void;
  /** Height of the drawn root above the sampled ground pose (the waterline offset while swimming). */
  lift(mode: CreatureMode): number;
  dispose(): void;
}

/** The drawing mode for a sampled activity and speed. */
export function creatureMode(activity: string | undefined, speed: number | undefined): CreatureMode {
  if (activity === 'swim' || activity === 'tread') return 'swim';
  if (activity === 'settle' || activity === 'sit' || activity === 'sleep') return 'settle';
  if ((speed ?? 0) > 0.03 || activity === 'walk' || activity === 'wade') return 'walk';
  return 'idle';
}

const mat = (color: number, rough = 0.7, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra });
function mesh(geo: THREE.BufferGeometry, m: THREE.Material, at: [number, number, number] = [0, 0, 0], scale?: [number, number, number]) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(...at);
  if (scale) o.scale.set(...scale);
  o.castShadow = true;
  return o;
}
function group(at: [number, number, number] = [0, 0, 0], ...kids: THREE.Object3D[]) {
  const g = new THREE.Group();
  g.position.set(...at);
  for (const k of kids) g.add(k);
  return g;
}
const approach = (from: number, to: number, rate: number, dt: number) => from + (to - from) * (1 - Math.exp(-rate * dt));

/** Shared base for the three rigs: owned geometry/materials, a settle weight and a gait phase that integrate frame to frame. */
abstract class Rig implements CreatureRig {
  abstract readonly species: CreatureId;
  readonly root = new THREE.Group();
  protected settle = 0;
  protected swim = 0;
  protected phase = 0;
  protected readonly owned: { dispose(): void }[] = [];
  protected own<T extends { dispose(): void }>(x: T): T { this.owned.push(x); return x; }
  abstract lift(mode: CreatureMode): number;
  protected abstract pose(f: CreatureFrame, gait: number, amp: number): void;
  /** Steps per metre of travel (a short-legged animal takes more). */
  protected abstract readonly stride: number;
  animate(f: CreatureFrame) {
    const dt = Math.min(Math.max(f.dt, 0), 0.25);
    this.settle = approach(this.settle, f.mode === 'settle' ? 1 : 0, 4, dt);
    this.swim = approach(this.swim, f.mode === 'swim' ? 1 : 0, 5, dt);
    const moving = f.mode === 'walk' || f.mode === 'swim' ? Math.max(f.speed, 0) : 0;
    this.phase = (this.phase + 2 * Math.PI * moving * this.stride * dt + (f.mode === 'swim' ? 2 * Math.PI * 1.2 * dt : 0)) % (2 * Math.PI * 1000);
    this.pose(f, this.phase, Math.min(1, moving / 0.3));
  }
  dispose() { for (const x of this.owned) x.dispose(); this.owned.length = 0; this.root.removeFromParent(); }
}

// --------------------------------------------------------------------------------------------- duck
class DuckRig extends Rig {
  readonly species = 'duck' as const;
  protected readonly stride = 5.5;
  private readonly body: THREE.Group; private readonly neck: THREE.Group; private readonly head: THREE.Group; private readonly tail: THREE.Object3D;
  private readonly legs: THREE.Group[]; private readonly wings: THREE.Object3D[];
  constructor() {
    super();
    const white = this.own(mat(0xf3efe4, 0.85)), orange = this.own(mat(0xf08a24, 0.55)), dark = this.own(mat(0x14110f, 0.3)), wingMat = this.own(mat(0xe4ddcd, 0.85));
    const sphere = this.own(new THREE.SphereGeometry(1, 24, 16)), cone = this.own(new THREE.ConeGeometry(1, 1, 16)), leg = this.own(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 8));
    const foot = this.own(new THREE.ConeGeometry(0.035, 0.06, 3));
    this.tail = mesh(cone, white, [-0.19, 0.03, 0], [0.045, 0.09, 0.05]); this.tail.rotation.z = Math.PI / 2 + 0.6;
    this.wings = [1, -1].map((side) => { const w = mesh(sphere, wingMat, [-0.02, 0.02, side * 0.105], [0.14, 0.075, 0.03]); w.rotation.z = -0.15; return w; });
    this.head = group([0, 0.13, 0],
      mesh(sphere, white, [0, 0, 0], [0.07, 0.065, 0.06]),
      mesh(sphere, orange, [0.08, -0.012, 0], [0.05, 0.016, 0.035]),
      mesh(sphere, dark, [0.035, 0.02, 0.048], [0.011, 0.011, 0.011]),
      mesh(sphere, dark, [0.035, 0.02, -0.048], [0.011, 0.011, 0.011]));
    this.neck = group([0.13, 0.05, 0], mesh(sphere, white, [0, 0.06, 0], [0.045, 0.08, 0.045]), this.head);
    this.body = group([0, 0.2, 0], mesh(sphere, white, [0, 0, 0], [0.2, 0.12, 0.13]), this.tail, ...this.wings, this.neck);
    this.legs = [1, -1].map((side) => {
      const f = mesh(foot, orange, [0.025, -0.1, 0], [1, 1, 1]); f.rotation.z = -Math.PI / 2; f.scale.set(1, 1, 0.35);
      return group([0.01, 0.1, side * 0.055], mesh(leg, orange, [0, -0.05, 0]), f);
    });
    this.root.add(this.body, ...this.legs);
  }
  lift(mode: CreatureMode) { return mode === 'swim' ? SWIM_ROOT_BELOW - 0.14 : 0; }
  protected pose(f: CreatureFrame, g: number, amp: number) {
    const s = this.settle, w = this.swim, t = f.t;
    const breathe = 1 + 0.015 * Math.sin(t * 2.4);
    // waddle: the body rolls over the planted foot, the feet alternate, the neck pumps
    this.body.position.y = 0.2 - 0.09 * s + 0.012 * amp * Math.abs(Math.sin(g)) * (1 - w);
    this.body.rotation.x = 0.16 * amp * Math.sin(g) * (1 - w) + 0.04 * w * Math.sin(t * 1.7);
    this.body.rotation.z = -0.05 * amp * (1 - w) + 0.03 * w * Math.sin(t * 1.3);
    this.body.scale.set(1, breathe, 1);
    this.legs.forEach((l, i) => {
      const k = Math.sin(g + i * Math.PI);
      l.rotation.z = 0.55 * amp * k * (1 - w) + w * 0.8 * Math.sin(g * 1.8 + i * Math.PI);
      l.position.y = 0.1 + 0.025 * amp * Math.max(0, k) * (1 - w);
      l.visible = s < 0.6 && w < 0.7;
    });
    const peck = f.mode === 'idle' ? Math.max(0, Math.sin(t * 0.9) - 0.85) * 4 : 0; // an occasional dip of the head
    this.neck.rotation.z = -0.25 * amp * Math.sin(2 * g) * (1 - w) - 0.5 * peck + 0.25 * s;
    this.head.rotation.y = f.mode === 'idle' ? 0.5 * Math.sin(t * 0.37) * Math.sin(t * 0.11) : 0;
    this.head.rotation.z = -0.3 * peck - 0.35 * s;
    this.tail.rotation.x = 0.35 * Math.sin(t * (f.mode === 'idle' ? 6 : 3)) * (f.mode === 'idle' ? Math.max(0, Math.sin(t * 0.5)) : 0.5);
    this.wings.forEach((wg, i) => { wg.rotation.x = (i ? -1 : 1) * (0.06 * amp * Math.sin(g)); });
  }
}

// --------------------------------------------------------------------------------------------- snail
class SnailRig extends Rig {
  readonly species = 'snail' as const;
  protected readonly stride = 9;
  private readonly foot: THREE.Group; private readonly shell: THREE.Group; private readonly stalks: THREE.Group[]; private readonly feelers: THREE.Group[];
  constructor() {
    super();
    const skin = this.own(mat(0x9d8f78, 0.45, { emissive: 0x1b1408, emissiveIntensity: 0.25 })), dark = this.own(mat(0x111111, 0.3));
    const sphere = this.own(new THREE.SphereGeometry(1, 24, 16)), stalk = this.own(new THREE.CylinderGeometry(0.006, 0.009, 1, 6));
    // the foot: a long low body, rising into the head at the front
    const capsule = this.own(new THREE.CapsuleGeometry(0.045, 0.3, 6, 16)); capsule.rotateZ(Math.PI / 2);
    const head = mesh(sphere, skin, [0.17, 0.05, 0], [0.05, 0.05, 0.045]);
    this.stalks = [1, -1].map((side) => { const g = group([0.19, 0.08, side * 0.022], mesh(stalk, skin, [0, 0.07, 0], [1, 0.14, 1]), mesh(sphere, dark, [0, 0.14, 0], [0.012, 0.012, 0.012])); g.rotation.x = side * 0.25; g.rotation.z = -0.25; return g; });
    this.feelers = [1, -1].map((side) => { const g = group([0.21, 0.05, side * 0.025], mesh(stalk, skin, [0, 0.025, 0], [0.8, 0.05, 0.8])); g.rotation.x = side * 0.6; g.rotation.z = -0.9; return g; });
    this.foot = group([0, 0.035, 0], mesh(capsule, skin, [0, 0, 0], [1, 0.7, 1]), head, ...this.stalks, ...this.feelers);
    // the shell: a tube along a shrinking logarithmic spiral, banded from rim to apex
    const pts: THREE.Vector3[] = [], n = 120, turns = 2.6;
    for (let i = 0; i <= n; i++) { const a = (i / n) * turns * 2 * Math.PI, r = 0.1 * Math.exp(-0.21 * a); pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0.02 * (i / n))); }
    const curve = new THREE.CatmullRomCurve3(pts), tube = this.own(new THREE.TubeGeometry(curve, 240, 1, 16, false));
    // taper the tube with the spiral and colour it in bands
    const pos = tube.attributes.position as THREE.BufferAttribute, colors = new Float32Array(pos.count * 3), c = new THREE.Color(), radial = 17;
    for (let i = 0; i < pos.count; i++) {
      const ring = Math.floor(i / radial), u = ring / 240, centre = curve.getPointAt(Math.min(u, 1)), a = u * turns * 2 * Math.PI, r = 0.07 * Math.exp(-0.21 * a) + 0.004;
      const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).sub(centre).normalize().multiplyScalar(r).add(centre);
      pos.setXYZ(i, v.x, v.y, v.z);
      c.setHSL(0.07, 0.55, 0.22 + 0.2 * (0.5 + 0.5 * Math.sin(u * 60)) * (1 - u * 0.5)); c.toArray(colors, i * 3);
    }
    tube.setAttribute('color', new THREE.BufferAttribute(colors, 3)); tube.computeVertexNormals();
    const shellMat = this.own(mat(0xffffff, 0.35, { vertexColors: true }));
    const cap = mesh(sphere, shellMat, [0, 0, 0.005], [0.03, 0.03, 0.03]);
    this.shell = group([-0.04, 0.14, 0], mesh(tube, shellMat), cap);
    this.root.add(this.foot, this.shell);
  }
  lift() { return 0; }
  protected pose(f: CreatureFrame, g: number, amp: number) {
    const s = this.settle, t = f.t;
    // the slide: a wave of the foot (stretch and gather), the shell rocking a little behind it
    const wave = Math.sin(g);
    const out = 1 - 0.75 * s; // withdrawn: the foot draws in under the shell
    this.foot.scale.set(out * (1 + 0.07 * amp * wave), 1 - 0.3 * s, 1 - 0.3 * s);
    this.foot.position.x = 0.02 * amp * wave - 0.03 * s;
    this.shell.position.set(-0.04 + 0.008 * amp * Math.sin(g - 0.8), 0.14 - 0.035 * s + 0.004 * Math.sin(t * 1.3), 0);
    this.shell.rotation.z = 0.04 * amp * Math.sin(g - 0.8) + 0.1 * s;
    for (const [i, st] of this.stalks.entries()) {
      st.scale.setScalar(Math.max(0.02, 1 - s));
      st.rotation.z = -0.25 + 0.18 * Math.sin(t * 0.8 + i * 1.7) + 0.1 * amp * wave;
      st.rotation.x = (i ? -1 : 1) * (0.25 + 0.12 * Math.sin(t * 0.6 + i));
    }
    for (const fe of this.feelers) fe.scale.setScalar(Math.max(0.02, 1 - s));
  }
}

// --------------------------------------------------------------------------------------------- dog
class DogRig extends Rig {
  readonly species = 'dog' as const;
  protected readonly stride = 1.7;
  private readonly body: THREE.Group; private readonly head: THREE.Group; private readonly tail: THREE.Group; private readonly ears: THREE.Object3D[];
  private readonly legs: { hip: THREE.Group; knee: THREE.Group; front: boolean; side: number }[];
  constructor() {
    super();
    const coat = this.own(mat(0xc58a46, 0.8)), darker = this.own(mat(0x7a4f25, 0.8)), cream = this.own(mat(0xead2a8, 0.85)), dark = this.own(mat(0x121010, 0.35));
    const sphere = this.own(new THREE.SphereGeometry(1, 24, 16)), seg = this.own(new THREE.CylinderGeometry(0.03, 0.026, 0.2, 10));
    const torso = this.own(new THREE.CapsuleGeometry(0.11, 0.3, 6, 16)); torso.rotateZ(Math.PI / 2);
    this.ears = [1, -1].map((side) => { const e = mesh(sphere, darker, [-0.01, 0.02, side * 0.07], [0.035, 0.07, 0.018]); e.rotation.x = side * 0.25; return e; });
    this.head = group([0.25, 0.1, 0],
      mesh(sphere, coat, [0, 0.03, 0], [0.085, 0.08, 0.075]),
      mesh(sphere, cream, [0.085, 0.0, 0], [0.065, 0.042, 0.045]),
      mesh(sphere, dark, [0.145, 0.01, 0], [0.016, 0.014, 0.018]),
      mesh(sphere, dark, [0.055, 0.06, 0.042], [0.012, 0.012, 0.012]),
      mesh(sphere, dark, [0.055, 0.06, -0.042], [0.012, 0.012, 0.012]),
      ...this.ears);
    this.tail = group([-0.24, 0.05, 0], mesh(seg, coat, [0, 0.1, 0], [0.55, 1, 0.55]));
    this.tail.rotation.z = 0.7;
    const neck = mesh(sphere, coat, [0.2, 0.05, 0], [0.07, 0.09, 0.065]); neck.rotation.z = -0.6;
    this.body = group([0, 0.42, 0], mesh(torso, coat, [0, 0, 0], [1, 0.95, 0.85]), mesh(sphere, cream, [0.12, -0.04, 0], [0.12, 0.08, 0.08]), neck, this.head, this.tail);
    this.legs = [[true, 1], [true, -1], [false, 1], [false, -1]].map(([front, side]) => {
      const knee = group([0, -0.2, 0], mesh(seg, coat, [0, -0.1, 0], [0.85, 1, 0.85]), mesh(sphere, cream, [0.015, -0.2, 0], [0.034, 0.022, 0.03]));
      const hip = group([front ? 0.17 : -0.17, 0.0, (side as number) * 0.075], mesh(seg, coat, [0, -0.1, 0]), knee);
      this.body.add(hip);
      return { hip, knee, front: front as boolean, side: side as number };
    });
    this.root.add(this.body);
  }
  lift(mode: CreatureMode) { return mode === 'swim' ? SWIM_ROOT_BELOW - 0.42 : 0; }
  protected pose(f: CreatureFrame, g: number, amp: number) {
    const s = this.settle, w = this.swim, t = f.t;
    // trot: diagonal pairs (front-left with hind-right) swing together; the knee folds as the leg comes forward
    this.body.position.y = 0.42 - 0.27 * s + 0.012 * amp * Math.cos(2 * g) * (1 - w);
    this.body.rotation.z = 0.03 * amp * Math.sin(2 * g) * (1 - w) + 0.05 * w;
    this.body.scale.set(1, 1 + 0.02 * Math.sin(t * (f.mode === 'walk' ? 6 : 2.2)), 1);
    for (const l of this.legs) {
      const diag = (l.front ? 1 : -1) * l.side > 0 ? 0 : Math.PI, k = Math.sin(g + diag);
      const swing = 0.55 * amp * k * (1 - w) + w * 0.9 * Math.sin(g * 2 + diag);
      // lying down: front legs stretch forward, hind legs tuck under
      l.hip.rotation.z = swing * (1 - s) + s * (l.front ? 1.45 : -1.2);
      l.knee.rotation.z = (l.front ? -1 : 1) * 0.7 * amp * Math.max(0, Math.cos(g + diag)) * (1 - s) + s * (l.front ? 0.1 : 2.2) * (l.front ? 1 : 1);
    }
    const wag = f.mode === 'walk' ? 0.35 : f.mode === 'swim' ? 0.15 : 0.6;
    this.tail.rotation.x = wag * Math.sin(t * (f.mode === 'idle' ? 9 : 7));
    this.tail.rotation.z = 0.7 - 0.5 * s + 0.15 * amp;
    this.head.rotation.y = f.mode === 'idle' ? 0.45 * Math.sin(t * 0.31) * Math.max(0, Math.sin(t * 0.13)) : 0;
    this.head.rotation.z = -0.08 * amp * Math.sin(2 * g) * (1 - w) - 0.45 * s + 0.25 * w;
    this.head.position.y = 0.1 - 0.06 * s;
    this.ears.forEach((e, i) => { e.rotation.z = 0.15 * Math.max(0, Math.sin(t * 1.9 + i * 2.3) - 0.8) * 5 + 0.2 * amp * Math.sin(2 * g); });
  }
}

export function buildCreature(species: CreatureId): CreatureRig {
  const rig = species === 'duck' ? new DuckRig() : species === 'snail' ? new SnailRig() : new DogRig();
  rig.root.name = `creature:${species}`;
  return rig;
}
