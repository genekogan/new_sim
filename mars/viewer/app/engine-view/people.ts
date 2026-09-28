// The studio's animated people (Quaternius CC0 GLBs, clips Idle/Walk/Wave),
// loaded the same way as app/studio/campus-life.ts: clone per actor, scale to
// 1.75 m, feet on y=0. Minimal copy so studio behaviour is untouched.
import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { ThreeResources, loadGltf } from '../../lib/three-resources';
import { BODY_MODEL } from './rig.ts';

export const PEOPLE = ['casual', 'punk', 'woman'] as const;
export const PERSON_HEIGHT = 1.75;

export type Template = {
  name: string;
  gltf: GLTF;
  /** Ground speed (m/s) the Walk clip implies at timeScale 1, measured from the stance foot. */
  walkSpeed: number;
  /** Model-space forward sign along Z (+1: faces +Z) inferred from stance-foot motion. */
  forward: number;
  /** Arm fit (fitArms): length factor applied to UpperArm / LowerArm, left then right, and the arm length before it. */
  arms: { k: number; before: number }[];
};

export type Rig = {
  holder: THREE.Group; // engine pose goes here (position, rotation.y = -yaw)
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  idle: THREE.AnimationAction;
  walk: THREE.AnimationAction;
  template: Template;
};

export async function loadTemplates(signal: AbortSignal, resources: ThreeResources): Promise<Template[]> {
  return Promise.all(
    PEOPLE.map(async (name) => {
      const gltf = await loadGltf(`/modular/environment/animated-${name}.glb?v=mirror-baked-2`, signal, resources);
      const arms = fitArms(gltf);
      return { name, gltf, arms, ...measureWalk(gltf) };
    }),
  );
}

function clip(gltf: GLTF, name: string) {
  const c = THREE.AnimationClip.findByName(gltf.animations, name);
  if (!c) throw Error(`Missing ${name} animation`);
  return c;
}

/**
 * Clone, centre on x/z, feet at y=0 (campus-life.ts 139–177), scaled uniformly so the shoulder joints
 * stand at BODY_MODEL.shoulderHeight (the body model; POSES.md). The bounding box alone (1.75 m to the
 * top) would make the punk rig's body 7 % smaller than the others (its hair spikes count as height):
 * fitted by shoulders, the crowns are at ≈ 1.75 (woman), 1.77 (casual) and 1.88 m (punk, hair tips).
 */
function fit(gltf: GLTF) {
  const model = clone(gltf.scene);
  const mixer = new THREE.AnimationMixer(model);
  const idle = mixer.clipAction(clip(gltf, 'Idle'));
  const walk = mixer.clipAction(clip(gltf, 'Walk'));
  idle.play();
  mixer.update(0.01);
  const b = new THREE.Box3().setFromObject(model);
  let scale = PERSON_HEIGHT / (b.max.y - b.min.y);
  const place = () => {
    model.scale.setScalar(scale);
    model.position.set(-(b.min.x + b.max.x) * 0.5 * scale, -b.min.y * scale, -(b.min.z + b.max.z) * 0.5 * scale);
    model.updateMatrixWorld(true);
  };
  place();
  const sh = ['UpperArmL', 'UpperArmR'].map((n) => model.getObjectByName(n)?.getWorldPosition(new THREE.Vector3()).y);
  if (sh[0] !== undefined && sh[1] !== undefined) {
    scale *= BODY_MODEL.shoulderHeight / ((sh[0] + sh[1]) / 2);
    place();
  }
  return { model, mixer, idle, walk, scale };
}

/**
 * The body model's arm (BODY_MODEL.armLength, shoulder joint → elbow → palm centre), once per loaded
 * template, before any clone: the upper arm and forearm are lengthened by one factor k per side,
 * solved exactly from the Idle pose (palm = midway wrist → middle-finger base, as rig.ts `palm`):
 *   k·|shoulder→elbow| + |k·(wrist − elbow) + (palm − wrist)| = armLength.
 * - the LowerArm / Wrist rest offsets and every clip's translation track for them are scaled by k (the
 *   clips key them each frame), so the elbow and the wrist move out along the bones;
 * - the skin of UpperArm / LowerArm is stretched along the bone axis only (their bind inverses get a
 *   one-axis scale in bone space, direction = the child joint), so girth is unchanged and nothing
 *   shears; hands and fingers keep their size (their bones only move with the wrist).
 * Bone lengths never change after this: poses still never stretch an arm.
 */
function fitArms(gltf: GLTF) {
  const { model, mixer } = fit(gltf);
  model.updateMatrixWorld(true);
  const w = (n: string) => model.getObjectByName(n)?.getWorldPosition(new THREE.Vector3());
  const out: { k: number; before: number }[] = [];
  const scale = new Map<string, number>();
  for (const side of ['L', 'R']) {
    const [s, e, wr, m] = [`UpperArm${side}`, `LowerArm${side}`, `Wrist${side}`, `Middle2${side}`].map(w);
    if (!s || !e || !wr || !m) continue;
    const a = s.distanceTo(e), fw = wr.clone().sub(e), h = m.clone().sub(wr).multiplyScalar(0.5);
    const len = (k: number) => k * a + fw.clone().multiplyScalar(k).add(h).length();
    let lo = 0.5, hi = 3;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (len(mid) < BODY_MODEL.armLength) lo = mid;
      else hi = mid;
    }
    const k = (lo + hi) / 2;
    out.push({ k: +k.toFixed(4), before: +len(1).toFixed(4) });
    scale.set(`LowerArm${side}`, k).set(`Wrist${side}`, k);
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(model);
  // bone rest offsets (and the skin stretch axis: the child joint, in the parent bone's frame)
  const axis = new Map<string, [THREE.Vector3, number]>();
  gltf.scene.traverse((o) => {
    const k = scale.get(o.name);
    if (!k || !o.parent) return;
    axis.set(o.parent.name, [o.position.clone().normalize(), k]);
    o.position.multiplyScalar(k);
  });
  const scaled = new Set<ArrayLike<number>>(); // clips may share one accessor (constant tracks): scale each buffer once
  for (const clip of gltf.animations)
    for (const t of clip.tracks) {
      const dot = t.name.lastIndexOf('.');
      const k = scale.get(t.name.slice(0, dot));
      if (!k || t.name.slice(dot + 1) !== 'position' || scaled.has(t.values)) continue;
      scaled.add(t.values);
      for (let i = 0; i < t.values.length; i++) t.values[i] *= k;
    }
  const done = new Set<THREE.Matrix4>();
  gltf.scene.traverse((o) => {
    const sk = (o as THREE.SkinnedMesh).isSkinnedMesh ? (o as THREE.SkinnedMesh).skeleton : undefined;
    sk?.bones.forEach((b, i) => {
      const ax = axis.get(b.name), inv = sk.boneInverses[i];
      if (!ax || done.has(inv)) return;
      done.add(inv);
      const [d, k] = ax, x = k - 1;
      // I + (k − 1) d dᵀ: stretch along d about the joint, in the bone's own frame
      const st = new THREE.Matrix4().set(1 + x * d.x * d.x, x * d.x * d.y, x * d.x * d.z, 0, x * d.y * d.x, 1 + x * d.y * d.y, x * d.y * d.z, 0, x * d.z * d.x, x * d.z * d.y, 1 + x * d.z * d.z, 0, 0, 0, 0, 1);
      inv.premultiply(st);
    });
  });
  return out;
}

/**
 * Speed-match data: sample the Walk clip, take the lower foot each sample
 * (the stance foot) and measure how fast it slides backwards relative to the
 * body. That velocity is the ground speed at which feet would not slide.
 */
function measureWalk(gltf: GLTF): { walkSpeed: number; forward: number } {
  const { model, mixer, idle, walk } = fit(gltf);
  idle.stop();
  walk.play();
  const feet = ['FootL', 'FootR'].map((n) => model.getObjectByName(n));
  if (feet.some((f) => !f)) return { walkSpeed: 1, forward: 1 };
  const dur = walk.getClip().duration, N = 120, dt = dur / N;
  const v: number[] = [];
  let prev: { foot: number; z: number } | null = null;
  const p = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    walk.time = i * dt;
    mixer.update(0);
    model.updateMatrixWorld(true);
    const ys = feet.map((f) => f!.getWorldPosition(p).y);
    const foot = ys[0] < ys[1] ? 0 : 1;
    const z = feet[foot]!.getWorldPosition(p).z;
    if (prev && prev.foot === foot) v.push((z - prev.z) / dt);
    prev = { foot, z };
  }
  v.sort((a, b) => a - b);
  const med = v[Math.floor(v.length / 2)] ?? 0;
  const speed = Math.abs(med);
  mixer.stopAllAction();
  // Stance foot moves opposite to facing.
  return speed > 0.2 ? { walkSpeed: speed, forward: med < 0 ? 1 : -1 } : { walkSpeed: 1, forward: 1 };
}

export function createRig(t: Template): Rig {
  const { model, mixer, idle, walk } = fit(t.gltf);
  model.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
    }
  });
  // Engine yaw 0 faces +x; the model faces ±Z. Turn it so its front is local +x.
  const inner = new THREE.Group();
  inner.rotation.y = t.forward > 0 ? Math.PI / 2 : -Math.PI / 2;
  inner.add(model);
  const holder = new THREE.Group();
  holder.add(inner);
  idle.play();
  walk.play();
  walk.setEffectiveWeight(0);
  return { holder, model, mixer, idle, walk, template: t };
}
