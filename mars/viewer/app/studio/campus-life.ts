import * as THREE from 'three';
import {
  ThreeResources,
  loadGltf,
  disposeSkeletons,
} from '../../lib/three-resources';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { CampusPaths, GROUND } from './ambience-math';
import { createScenery } from './scenery';
import { createEucRiders } from './euc-riders';
import {
  eucDistance,
  motionPose,
  simTime,
  type SimState,
} from '../../simulation/shared';

type Actor = {
  source: THREE.Object3D;
  group: THREE.Group;
  mixer: THREE.AnimationMixer;
  idle: THREE.AnimationAction;
  walk: THREE.AnimationAction;
  wave: THREE.AnimationAction;
  walking: boolean;
  cell: number;
  route: number[];
  pause: number;
  seed: number;
  roaming: boolean;
  blockedTime: number;
};
export function createCampusLife(
  scene: THREE.Scene,
  root: THREE.Group,
  onError: (message: string) => void,
  additions?: THREE.Group,
  riderCount = 6,
) {
  const group = new THREE.Group();
  group.name = 'Animated campus visitors';
  scene.add(group);
  const actors: Actor[] = [],
    sources: THREE.Object3D[] = [],
    boxes: THREE.Box3[] = [];
  let disposed = false,
    editing = false,
    enabled = true,
    paths: CampusPaths,
    scenery: ReturnType<typeof createScenery>,
    dirty = true,
    remote: SimState | null = null,
    remoteNow = 0,
    cut = 'complete',
    riders: ReturnType<typeof createEucRiders> | null = null;
  root.traverse((o) => {
    if (o.userData.kind === 'context_person') sources.push(o);
  });
  function rebuild() {
    boxes.length = 0;
    root.updateMatrixWorld(true);
    const collect = (o: THREE.Object3D) => {
      if (!(o instanceof THREE.Mesh)) return;
      let parent: THREE.Object3D | null = o;
      while (parent) {
        if (
          parent.userData.kind === 'context_person' ||
          parent.userData.kind === 'site_context' ||
          parent.userData.layer === 'Aerial reference'
        )
          return;
        parent = parent.parent;
      }
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const box = o.geometry.boundingBox!.clone().applyMatrix4(o.matrixWorld);
      if (box.max.y > GROUND + 0.3 && box.min.y < GROUND + 1.85)
        boxes.push(box);
    };
    root.traverse(collect);
    additions?.updateMatrixWorld(true);
    additions?.traverse(collect);
    paths = new CampusPaths(boxes);
    scenery?.dispose();
    scenery = createScenery(scene, paths);
    // Reserve the fire ring in all modes so visitors never step through its logs.
    if (scenery.firePosition) {
      const b = new THREE.Box3().setFromCenterAndSize(
        scenery.firePosition,
        new THREE.Vector3(2, 4, 2),
      );
      paths = new CampusPaths([...boxes, b]);
    }
    for (const a of actors) {
      a.source.getWorldPosition(a.group.position);
      a.source.getWorldQuaternion(a.group.quaternion);
      a.cell = paths.nearest(a.group.position, 6);
      a.route = [];
      a.pause = 1 + (a.seed % 7);
      if (a.roaming && a.cell >= 0) a.group.position.copy(paths.point(a.cell));
    }
    riders?.rebuildRoute();
    dirty = false;
  }
  rebuild();
  const resources = new ThreeResources(),
    abort = new AbortController();
  const templates = Promise.all(
    ['casual', 'punk', 'woman'].map(async (name) => ({
      name,
      g: await loadGltf(
        `/modular/environment/animated-${name}.glb?v=mirror-baked-2`,
        abort.signal,
        resources,
      ),
    })),
  );
  void templates
    .then((loaded) => {
      if (disposed) return;
      void loadGltf(
        '/modular/environment/electric-unicycle.glb?v=1',
        abort.signal,
        resources,
      )
        .then((vehicle) => {
          if (!disposed)
            riders = createEucRiders(
              scene,
              root,
              vehicle,
              loaded.map((t) => t.g),
              additions,
              riderCount,
            );
        })
        .catch((e) => {
          if (!disposed) onError(`EUC riders could not load: ${e.message}`);
        });
      sources.forEach((source, index) => {
        const name = String(
            source.userData.definition_id || 'person_casual',
          ).replace('person_', ''),
          template = loaded.find((t) => t.name === name) || loaded[0];
        const model = clone(template.g.scene),
          holder = new THREE.Group();
        holder.add(model);
        group.add(holder);
        const mixer = new THREE.AnimationMixer(model),
          get = (name: string) => {
            const clip = THREE.AnimationClip.findByName(
              template.g.animations,
              name,
            );
            if (!clip) throw Error(`Missing ${name} animation`);
            return mixer.clipAction(clip);
          };
        const idle = get('Idle'),
          walk = get('Walk'),
          wave = get('Wave');
        idle.play();
        mixer.update(0.01);
        const bounds = new THREE.Box3().setFromObject(model),
          height = bounds.max.y - bounds.min.y,
          scale = 1.75 / height;
        model.scale.setScalar(scale);
        model.position.set(
          -(bounds.min.x + bounds.max.x) * 0.5 * scale,
          -bounds.min.y * scale,
          -(bounds.min.z + bounds.max.z) * 0.5 * scale,
        );
        model.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            o.frustumCulled = false;
          }
        });
        actors.push({
          source,
          group: holder,
          mixer,
          idle,
          walk,
          wave,
          walking: false,
          cell: -1,
          route: [],
          pause: index * 0.8,
          seed: index * 171 + 31,
          blockedTime: 0,
          roaming: source.userData.assembly_id === 'people' && index % 4 !== 0,
        });
      });
      dirty = true;
    })
    .catch((e) => {
      if (disposed) return;
      onError(
        `Animated visitors could not load: ${e.message}. The static people are still available.`,
      );
      actors.forEach((a) => {
        a.source.visible = true;
        a.mixer.stopAllAction();
        a.mixer.uncacheRoot(a.mixer.getRoot());
        disposeSkeletons(a.group);
      });
      actors.length = 0;
      group.clear();
      abort.abort();
      resources.dispose();
      group.visible = false;
      enabled = false;
    });
  function parentVisible(o: THREE.Object3D) {
    const layer = o.userData.layer;
    if (
      layer &&
      (cut === 'frame' ||
        (cut === 'inside' &&
          ['Roofs and upper floors', 'Walls and screens'].includes(layer)))
    )
      return false;
    let p = o.parent;
    while (p) {
      if (!p.visible) return false;
      p = p.parent;
    }
    return true;
  }
  function restore() {
    actors.forEach((a) => (a.source.visible = true));
    group.visible = false;
  }
  return {
    setCut: (value: string) => {
      cut = value;
    },
    firePosition: () => scenery.firePosition,
    riderPosition: () => riders?.position(),
    setRemote(state: SimState | null, now = 0) {
      if (remote && !state) {
        riders?.configure({ enabled: true, count: Math.min(riderCount,3), speed: 3 });
        dirty = true;
      }
      remote = state;
      remoteNow = now;
    },
    setEuc(value: { enabled?: boolean; count?: number; speed?: number }) {
      riders?.configure(value);
    },
    setEnabled(value: boolean) {
      enabled = value;
      if (!value) restore();
    },
    setEditing(value: boolean) {
      editing = value;
      if (value) restore();
    },
    invalidate() {
      dirty = true;
    },
    /** Source people stay in all saved/exported layouts, never animation poses. */
    async withOriginals<T>(fn: () => Promise<T>) {
      restore();
      try {
        return await fn();
      } finally {
        group.visible = enabled && !editing;
        actors.forEach((a) => (a.source.visible = !group.visible));
      }
    },
    update(dt: number, time: number, night: number, fireMode: string) {
      if (dirty && !editing) rebuild();
      scenery.update(time, night, enabled, fireMode, remote?.weather);
      if (remote) riders?.configure(remote.euc);
      riders?.update(
        dt,
        remote
          ? (simTime(remote, remoteNow) - remote.motionEpoch) / 1000
          : time,
        enabled && !editing,
        remote ? eucDistance(remote, remoteNow) : undefined,
        remote ?? undefined,
        remoteNow,
      );
      const active = enabled && !editing;
      group.visible = active;
      if (!active) return;
      for (const a of actors) {
        a.source.visible = false;
        a.group.visible = parentVisible(a.source);
        if (!a.group.visible) continue;
        let moving = false;
        const command =
          remote?.people[
            String(a.source.userData.component_id || a.source.name)
          ];
        if (command) {
          const pose = motionPose(command, simTime(remote!, remoteNow));
          a.group.position.fromArray(pose.position);
          a.group.rotation.set(0, pose.yaw, 0);
          moving = pose.moving;
        }
        if (!command && a.roaming && a.cell >= 0) {
          if (!a.route.length) {
            a.pause -= dt;
            if (a.pause <= 0) {
              a.seed = (a.seed * 16807) % 2147483647;
              a.route = paths.route(a.cell, a.seed).slice(1);
              a.pause = 4 + (a.seed % 9);
            }
          }
          if (a.route.length) {
            const target = paths.point(a.route[0]),
              delta = target.clone().sub(a.group.position),
              distance = delta.length(),
              step = dt * 0.85;
            // Yield to other visitors rather than stacking on a narrow path.
            const blocked = actors.some(
              (b) =>
                b !== a &&
                b.group.visible &&
                b.group.position.distanceTo(a.group.position) < 0.8 &&
                b.group.position.clone().sub(a.group.position).dot(delta) >
                  0.05,
            );
            if (blocked) {
              a.blockedTime += dt;
              if (a.blockedTime > 2) {
                a.route = [];
                a.pause = 0.5;
                a.blockedTime = 0;
              }
            } else {
              a.blockedTime = 0;
              moving = true;
              if (distance <= step) {
                a.group.position.copy(target);
                a.cell = a.route.shift()!;
              } else a.group.position.addScaledVector(delta, step / distance);
              if (distance > 0.001) {
                const yaw = Math.atan2(delta.x, delta.z);
                const targetQ = new THREE.Quaternion().setFromAxisAngle(
                  new THREE.Vector3(0, 1, 0),
                  yaw,
                );
                a.group.quaternion.slerp(targetQ, 1 - Math.exp(-dt * 9));
              }
            }
          }
        }
        if (moving !== a.walking) {
          const from = a.walking ? a.walk : a.idle,
            to = moving ? a.walk : a.idle;
          to.reset().play();
          from.crossFadeTo(to, 0.3, false);
          a.walking = moving;
        }
        // Idle clips include breathing and weight shifts; occasional friendly waves.
        if (!moving) {
          const wavePhase = (time + (a.seed % 30)) % 34;
          const weight = command
            ? command.activity === 'wave'
              ? 0.9
              : command.activity === 'talk'
                ? 0.35
                : 0
            : !a.roaming && wavePhase < 3
              ? Math.sin((wavePhase / 3) * Math.PI) * 0.7
              : 0;
          a.wave.play().setEffectiveWeight(weight);
          a.idle.setEffectiveWeight(1 - weight);
        }
        if (moving) a.wave.setEffectiveWeight(0);
        a.walk.timeScale = 0.85;
        a.mixer.update(dt);
      }
    },
    dispose() {
      disposed = true;
      abort.abort();
      restore();
      actors.forEach((a) => {
        disposeSkeletons(a.group);
        a.mixer.stopAllAction();
        a.mixer.uncacheRoot(a.mixer.getRoot());
      });
      scenery.dispose();
      riders?.dispose();
      resources.dispose();
      scene.remove(group);
    },
  };
}
