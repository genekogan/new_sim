// The studio's animated people (Quaternius CC0 GLBs, clips Idle/Walk/Wave),
// loaded the same way as app/studio/campus-life.ts: clone per actor, scale to
// 1.75 m, feet on y=0. Minimal copy so studio behaviour is untouched.
import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { ThreeResources, loadGltf } from '../../lib/three-resources';

export const PEOPLE = ['casual', 'punk', 'woman'] as const;
export const PERSON_HEIGHT = 1.75;

export type Template = {
  name: string;
  gltf: GLTF;
  /** Ground speed (m/s) the Walk clip implies at timeScale 1, measured from the stance foot. */
  walkSpeed: number;
  /** Model-space forward sign along Z (+1: faces +Z) inferred from stance-foot motion. */
  forward: number;
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
      return { name, gltf, ...measureWalk(gltf) };
    }),
  );
}

function clip(gltf: GLTF, name: string) {
  const c = THREE.AnimationClip.findByName(gltf.animations, name);
  if (!c) throw Error(`Missing ${name} animation`);
  return c;
}

/** Clone, scale to 1.75 m, centre on x/z, feet at y=0 (campus-life.ts 139–177). */
function fit(gltf: GLTF) {
  const model = clone(gltf.scene);
  const mixer = new THREE.AnimationMixer(model);
  const idle = mixer.clipAction(clip(gltf, 'Idle'));
  const walk = mixer.clipAction(clip(gltf, 'Walk'));
  idle.play();
  mixer.update(0.01);
  const b = new THREE.Box3().setFromObject(model);
  const scale = PERSON_HEIGHT / (b.max.y - b.min.y);
  model.scale.setScalar(scale);
  model.position.set(-(b.min.x + b.max.x) * 0.5 * scale, -b.min.y * scale, -(b.min.z + b.max.z) * 0.5 * scale);
  return { model, mixer, idle, walk, scale };
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
