import * as THREE from 'three';
import { disposeSkeletons } from '../../lib/three-resources';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import {
  eucPose,
  perimeter,
  riderPose,
  type SimState,
} from '../../simulation/shared';

type BonePose = {
  bone: THREE.Object3D;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
};

function shoeBounds(model: THREE.Object3D, foot: THREE.Object3D): THREE.Box3 {
  const bounds = new THREE.Box3();
  model.updateMatrixWorld(true);
  model.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    const boneIndex = object.skeleton.bones.indexOf(foot as THREE.Bone);
    if (boneIndex < 0) return;
    const positions = object.geometry.getAttribute('position');
    const indices = object.geometry.getAttribute('skinIndex');
    const weights = object.geometry.getAttribute('skinWeight');
    for (let i = 0; i < positions.count; i++) {
      let footWeight = 0;
      for (let j = 0; j < 4; j++)
        if (indices.getComponent(i, j) === boneIndex)
          footWeight += weights.getComponent(i, j);
      if (footWeight < 0.5) continue;
      const point = new THREE.Vector3().fromBufferAttribute(positions, i);
      object.applyBoneTransform(i, point);
      bounds.expandByPoint(object.localToWorld(point));
    }
  });
  return bounds;
}

function fitRidingStance(model: THREE.Object3D): BonePose[] {
  const bones = ['UpperLegL', 'UpperLegR', 'FootL', 'FootR']
    .map((name) => model.getObjectByName(name))
    .filter((bone): bone is THREE.Object3D => !!bone);
  const idle = bones.map((bone) => ({
    bone,
    position: bone.position.clone(),
    quaternion: bone.quaternion.clone(),
  }));
  if (bones.length !== 4) return idle;

  // The source Idle pose is a walking stance: its shoes are about 34 cm apart
  // fore/aft, while the EUC pedals are only 26 cm long. Place both shoes above
  // the pedals and bring the knees back over them before freezing the pose.
  for (const side of ['L', 'R'] as const) {
    const upper = model.getObjectByName(`UpperLeg${side}`)!;
    const knee = model.getObjectByName(`LowerLeg${side}`)!;
    const foot = model.getObjectByName(`Foot${side}`)!;
    const original = upper.quaternion.clone();
    const parentQuaternion = new THREE.Quaternion();
    upper.parent!.getWorldQuaternion(parentQuaternion);
    const localPitchAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(
      parentQuaternion.invert(),
    );
    let bestAngle = 0;
    let bestError = Infinity;
    for (let step = -65; step <= 65; step++) {
      const angle = step * 0.01;
      upper.quaternion
        .copy(original)
        .premultiply(
          new THREE.Quaternion().setFromAxisAngle(localPitchAxis, angle),
        );
      model.updateMatrixWorld(true);
      const error = Math.abs(
        knee.getWorldPosition(new THREE.Vector3()).z - 0.025,
      );
      if (error < bestError) {
        bestError = error;
        bestAngle = angle;
      }
    }
    upper.quaternion
      .copy(original)
      .premultiply(
        new THREE.Quaternion().setFromAxisAngle(localPitchAxis, bestAngle),
      );
    model.updateMatrixWorld(true);
    if (side === 'L') {
      const parentRotation = foot.parent!.getWorldQuaternion(
        new THREE.Quaternion(),
      );
      const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(
        parentRotation.invert(),
      );
      foot.quaternion.premultiply(
        new THREE.Quaternion().setFromAxisAngle(localUp, -1.25),
      );
    }
    model.updateMatrixWorld(true);
    for (let attempt = 0; attempt < 4; attempt++) {
      const shoe = shoeBounds(model, foot);
      if (shoe.isEmpty()) break;
      const center = shoe.getCenter(new THREE.Vector3());
      const pedalFoot = foot.getWorldPosition(new THREE.Vector3());
      pedalFoot.x += (side === 'L' ? 0.16 : -0.16) - center.x;
      pedalFoot.y += 0.14 - shoe.min.y;
      pedalFoot.z -= center.z;
      foot.position.copy(foot.parent!.worldToLocal(pedalFoot));
    }
    model.updateMatrixWorld(true);
  }
  const riding = bones.map((bone) => ({
    bone,
    position: bone.position.clone(),
    quaternion: bone.quaternion.clone(),
  }));
  idle.forEach(({ bone, position, quaternion }) => {
    bone.position.copy(position);
    bone.quaternion.copy(quaternion);
  });
  model.updateMatrixWorld(true);
  return riding;
}

export function createEucRiders(
  scene: THREE.Scene,
  root: THREE.Group,
  vehicle: GLTF,
  people: GLTF[],
  additions?: THREE.Group,
  count = 6,
) {
  const group = new THREE.Group();
  group.name = 'Electric unicycle perimeter riders';
  scene.add(group);
  let path: ReturnType<typeof perimeter>;
  function rebuildRoute() {
    const bounds = new THREE.Box3();
    for (const source of [root, ...(additions ? [additions] : [])]) {
      source.updateMatrixWorld(true);
      source.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        let p: THREE.Object3D | null = o;
        while (p) {
          if (
            p.userData.layer === 'Aerial reference' ||
            p.userData.kind === 'context_person' || p.userData.kind === 'site_context'
          )
            return;
          p = p.parent;
        }
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        bounds.union(
          o.geometry.boundingBox!.clone().applyMatrix4(o.matrixWorld),
        );
      });
    }
    path = perimeter([bounds.min.toArray(), bounds.max.toArray()]);
  }
  rebuildRoute();
  const riders = Array.from({ length: 6 }, (_, i) => {
    const holder = new THREE.Group(),
      bike = vehicle.scene.clone(true),
      model = clone(people[i % people.length].scene);
    // The wheel was the only part animated independently of the rider. Its
    // spinning mesh read as a periodic hop against the fixed shell at this
    // scale, so keep the visible assembly rigid.
    holder.add(bike, model);
    group.add(holder);
    const mixer = new THREE.AnimationMixer(model),
      idle = THREE.AnimationClip.findByName(
        people[i % people.length].animations,
        'Idle',
      );
    if (idle) mixer.clipAction(idle).play();
    mixer.update(0.01);
    const b = new THREE.Box3().setFromObject(model),
      scale = 1.75 / (b.max.y - b.min.y);
    model.scale.setScalar(scale);
    model.position.set(
      (-(b.min.x + b.max.x) * scale) / 2,
      0.132 - b.min.y * scale,
      (-(b.min.z + b.max.z) * scale) / 2,
    );
    holder.updateMatrixWorld(true);
    const idleBones = ['UpperLegL', 'UpperLegR', 'FootL', 'FootR']
      .map((name) => model.getObjectByName(name))
      .filter((bone): bone is THREE.Object3D => !!bone)
      .map((bone) => ({
        bone,
        position: bone.position.clone(),
        quaternion: bone.quaternion.clone(),
      }));
    const ridingBones = fitRidingStance(model);
    // Keep the rider planted on the side pedals as the wheel spins below them.
    holder.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
      }
    });
    return {
      holder,
      model,
      idleBones,
      ridingBones,
      mixer,
      base: model.position.clone(),
    };
  });
  let settings = { enabled: true, count: Math.min(count, 3), speed: 3 },
    elapsed = 0;
  return {
    rebuildRoute,
    configure(value: Partial<SimState['euc']>) {
      settings = { ...settings, ...value };
    },
    position: () =>
      group.visible && settings.enabled && settings.count > 0
        ? riders[0].holder.position.clone()
        : undefined,
    update(
      _dt: number,
      time: number,
      enabled: boolean,
      distanceOverride?: number,
      remote?: SimState,
      remoteNow = 0,
    ) {
      group.visible = enabled && settings.enabled;
      if (!group.visible) return;
      elapsed = time;
      riders.forEach(({ holder, model, idleBones, ridingBones, base }, i) => {
        holder.visible = i < settings.count;
        if (!holder.visible) return;
        const distance = distanceOverride ?? elapsed * settings.speed,
          pose = remote
            ? riderPose(remote, remoteNow, path, i)
            : { ...eucPose(path, distance, i), dismounted: false };
        holder.position.fromArray(pose.position);
        holder.rotation.y = pose.yaw;
        model.position.copy(base);
        model.position.x += pose.dismounted ? 0.7 : 0;
        model.position.y -= pose.dismounted ? 0.132 : 0;
        model.rotation.x = pose.dismounted ? 0 : 0.025;
        model.rotation.z = 0;
        for (const { bone, position, quaternion } of pose.dismounted
          ? idleBones
          : ridingBones) {
          bone.position.copy(position);
          bone.quaternion.copy(quaternion);
        }
      });
    },
    dispose() {
      riders.forEach((r) => {
        r.mixer.stopAllAction();
        r.mixer.uncacheRoot(r.mixer.getRoot());
        disposeSkeletons(r.holder);
      });
      scene.remove(group);
    },
  };
}
