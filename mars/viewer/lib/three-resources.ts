import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
/** One owner per asset lifetime. Clones share geometry/materials; skeletons do not. */
export class ThreeResources {
  private geometries = new Set<THREE.BufferGeometry>();
  private materials = new Set<THREE.Material>();
  private textures = new Set<THREE.Texture>();
  private skeletons = new Set<THREE.Skeleton>();
  private shadows = new Set<THREE.LightShadow>();
  private closed = false;
  material(material: THREE.Material) {
    if (this.closed) {
      material.dispose();
      return material;
    }
    this.materials.add(material);
    for (const value of Object.values(material))
      if (value instanceof THREE.Texture) this.textures.add(value);
    if (material instanceof THREE.ShaderMaterial)
      for (const uniform of Object.values(material.uniforms)) {
        if (uniform.value instanceof THREE.Texture)
          this.textures.add(uniform.value);
      }
    return material;
  }
  object<T extends THREE.Object3D>(root: T): T {
    if (this.closed) {
      const late = new ThreeResources();
      late.object(root);
      late.dispose();
      return root;
    }
    root.traverse((o) => {
      if (
        o instanceof THREE.Mesh ||
        o instanceof THREE.Points ||
        o instanceof THREE.Line
      ) {
        this.geometries.add(o.geometry);
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
          this.material(m),
        );
      }
      if (o instanceof THREE.SkinnedMesh) this.skeletons.add(o.skeleton);
      if (
        o instanceof THREE.DirectionalLight ||
        o instanceof THREE.PointLight ||
        o instanceof THREE.SpotLight
      )
        this.shadows.add(o.shadow);
    });
    return root;
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.skeletons.forEach((s) => s.dispose());
    this.shadows.forEach((s) => s.dispose());
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    const images = new Set<ImageBitmap>();
    this.textures.forEach((t) => {
      t.dispose();
      const image = t.source?.data;
      if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap)
        images.add(image);
    });
    images.forEach((i) => i.close());
    this.geometries.clear();
    this.materials.clear();
    this.textures.clear();
    this.skeletons.clear();
    this.shadows.clear();
  }
}
export async function loadGltf(
  url: string,
  signal: AbortSignal,
  resources: ThreeResources,
): Promise<GLTF> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw Error(`Model unavailable (${response.status})`);
  const bytes = await response.arrayBuffer();
  signal.throwIfAborted();
  const gltf = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(bytes, new URL('.', new URL(url, location.href)).href);
  resources.object(gltf.scene);
  signal.throwIfAborted();
  return gltf;
}
export function disposeSkeletons(root: THREE.Object3D) {
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh) skeletons.add(o.skeleton);
  });
  skeletons.forEach((s) => s.dispose());
}
export function isVisible(object: THREE.Object3D) {
  let o: THREE.Object3D | null = object;
  while (o) {
    if (!o.visible) return false;
    o = o.parent;
  }
  return true;
}
