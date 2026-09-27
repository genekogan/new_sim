import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { isVisible } from './three-resources';
/** Render-only geometry. Original nodes remain available for picking, exports and edits. */
export function createRenderBatches(scene: THREE.Scene, root: THREE.Group) {
  const group = new THREE.Group();
  group.name = 'Static render batches';
  scene.add(group);
  const originals: THREE.Mesh[] = [];
  let excluded: THREE.Object3D | null = null;
  let dirty = true,
    active = false,
    disposed = false;
  const clear = () => {
    for (const o of group.children.slice()) {
      (o as THREE.Mesh).geometry.dispose();
      group.remove(o);
    }
  };
  function rebuild() {
    clear();
    originals.forEach((o) => o.layers.enable(0));
    originals.length = 0;
    root.updateMatrixWorld(true);
    const buckets = new Map<
      string,
      { meshes: THREE.Mesh[]; material: THREE.Material }
    >();
    root.traverse((o) => {
      if (
        !(o instanceof THREE.Mesh) ||
        o instanceof THREE.SkinnedMesh ||
        o instanceof THREE.InstancedMesh ||
        o.userData.dynamicScreen ||
        Array.isArray(o.material) ||
        o.material.transparent ||
        !isVisible(o) ||
        o.matrixWorld.determinant() < 0 ||
        Object.keys(o.geometry.morphAttributes).length
      )
        return;
      let p: THREE.Object3D | null = o;
      while (p) {
        if (
          p === excluded ||
          p.userData.kind === 'context_person' ||
          p.userData.layer === 'Aerial reference'
        )
          return;
        p = p.parent;
      }
      const attributes = Object.entries(
        o.geometry.attributes as Record<string, THREE.BufferAttribute>,
      )
        .map(
          ([name, a]) =>
            `${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`,
        )
        .sort()
        .join(',');
      const center = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld),
        key = `${o.material.uuid}:${Math.floor(center.x / 24)},${Math.floor(center.z / 24)}:${attributes}:${!!o.geometry.index}`;
      const bucket: { meshes: THREE.Mesh[]; material: THREE.Material } =
        buckets.get(key) || { meshes: [], material: o.material };
      bucket.meshes.push(o);
      buckets.set(key, bucket);
    });
    for (const { meshes, material } of buckets.values()) {
      if (meshes.length < 2) continue;
      const copies = meshes.map((o) => {
        const geometry = o.geometry.clone();
        geometry.applyMatrix4(o.matrixWorld);
        return geometry;
      });
      const geometry = mergeGeometries(copies, false);
      copies.forEach((g) => g.dispose());
      if (!geometry) continue;
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      originals.push(...meshes);
    }
    dirty = false;
  }
  return {
    setExcluded(value: THREE.Object3D | null) {
      if (excluded !== value) {
        excluded = value;
        dirty = true;
      }
    },
    setActive(value: boolean) {
      if (disposed || (active === value && (!value || !dirty))) return;
      if (value && dirty) rebuild();
      active = value;
      group.visible = value;
      originals.forEach((o) => {
        o.layers.enable(1);
        if (value) o.layers.disable(0);
        else o.layers.enable(0);
      });
    },
    invalidate() {
      dirty = true;
    },
    get active() {
      return active;
    },
    get count() {
      return group.children.length;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      originals.forEach((o) => o.layers.enable(0));
      clear();
      scene.remove(group);
    },
  };
}
