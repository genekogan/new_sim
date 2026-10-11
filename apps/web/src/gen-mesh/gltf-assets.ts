// Loading content-addressed GLB assets for mesh halves, and playing their clips deterministically.
// Owner: L5 (spec <eden4>/29 WP1b). Used by mesh.mesh.ts (every `make: {kind:'mesh'}` def) and
// available to any lane that wants a pack model inside its own builder (L4: pack animals in herds):
//
//   import { loadAsset, instantiate, frameHook } from './gltf-assets.ts';
//   const gltf = await loadAsset(def.make.asset);              // cached per sha; Draco/meshopt/WebP decode
//   const m = instantiate(gltf, { height: def.size.box[1] });  // skinned-safe clone, base-centred, scaled
//   group.add(m.object);
//   m.play('Walk', Date.now() / 1000);                         // or 'Idle'; deterministic from world time
//   group.add(frameHook(() => m.play(moving ? 'Walk' : 'Idle', Date.now() / 1000)));  // per frame, only when drawn
//
// Clip names of the core pack animals: cow/horse/llama/pig/sheep/pug/dog/cat `Idle`, `Walk`; fox `Walk`;
// bird `Fly`; koi `Swim`. Every core pack model faces +z at yaw 0, stands on y = 0, real size in metres.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { apiPath } from '../world-path.ts';
import { BASE } from '../base-path.ts';

let shared: GLTFLoader | null = null;
/** LiveWorld may hand over its own loader (download progress, one Draco worker pool). */
export function setAssetLoader(loader: GLTFLoader) { shared = loader; }
function loader(): GLTFLoader {
  return (shared ??= new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath(BASE + '/mars-assets/draco/')).setMeshoptDecoder(MeshoptDecoder));
}
/** URL of a stored asset (served immutable by the world's server). */
export const assetUrl = (sha: string, ext = 'glb') => apiPath(`/assets/${sha}.${ext}`);

const cache = new Map<string, { p: Promise<GLTF>; by: GLTFLoader; settled: boolean }>();
const failed = new Set<string>();
/** Load (once) and parse a GLB by sha. Rejects on 404 or a parse error; a failure is retried after 30 s.
 *  A load still in flight on a loader that has since been replaced (LiveWorld re-mounts its scene on a new welcome and
 *  aborts the old scene's LoadingManager) is not reused, and its abort is not a failure: the new scene loads it again. */
export function loadAsset(sha: string): Promise<GLTF> {
  const l = loader();
  const hit = cache.get(sha);
  if (hit && (hit.settled || hit.by === l)) return hit.p;
  const entry = { p: l.loadAsync(assetUrl(sha)).then((g) => { prepare(g); return g; }), by: l, settled: false };
  cache.set(sha, entry);
  entry.p.then(() => { entry.settled = true; }, (e: unknown) => {
    if (cache.get(sha) !== entry) return;
    if ((e as { name?: string })?.name === 'AbortError' || entry.by !== loader()) { cache.delete(sha); return; }
    entry.settled = true; failed.add(sha); setTimeout(() => { if (cache.get(sha) === entry) cache.delete(sha); failed.delete(sha); }, 30_000);
  });
  return entry.p;
}
export function assetFailed(sha: string) { return failed.has(sha); }

/** Once per loaded file: shadows, and the vertex-coloured CC0 packs get a matte look (glTF defaults metalness to 1). */
function prepare(g: GLTF) {
  g.scene.traverse((o) => {
    const m = o as THREE.Mesh; if (!m.isMesh) return;
    m.castShadow = true; m.receiveShadow = true;
    for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) {
      if (!mat || mat.userData.edenAsset) continue;
      mat.userData.edenAsset = true;
      if (m.geometry.attributes.color) { mat.vertexColors = true; if (!mat.metalnessMap) mat.metalness = 0; if (!mat.roughnessMap) mat.roughness = Math.max(mat.roughness, 0.8); mat.needsUpdate = true; }
    }
  });
  const box = new THREE.Box3().setFromObject(g.scene, true);
  g.userData.bounds = box.isEmpty() ? new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5)) : box;
}

export type ModelInstance = {
  /** Base-centred and scaled: add this to your entity group. */
  object: THREE.Group;
  /** The clone's own root (inside `object`), for traversal. */
  model: THREE.Object3D;
  clips: string[];
  /** Show clip `name` (or the closest: Walk→Fly/Swim→first) at time `t` seconds, phase-shifted by `phase`. Cheap; call per frame. */
  play(name: string, t: number, opts?: { rate?: number; phase?: number }): string | null;
  dispose(): void;
};

/**
 * A clone of a loaded asset (SkeletonUtils clone, so skinned meshes animate independently), fitted to the
 * def's frame: bounds centred on x/z, standing on y = 0, uniformly scaled so its height is `height`
 * (or, with `box`, so its largest extent matches the box on that axis). Materials and geometry are shared with the source.
 */
export function instantiate(gltf: GLTF, opts: { height?: number; box?: [number, number, number] } = {}): ModelInstance {
  const src = gltf.userData.bounds as THREE.Box3;
  const size = src.getSize(new THREE.Vector3());
  // With a box, fit the model's LARGEST extent to the box on that axis: defs clamp every side to ≥ 5 cm,
  // so a flat thing (a rug 2 cm thick, a plate) scaled by height came out 1.5–2.5× too big.
  const ext = [size.x, size.y, size.z], a = opts.box && opts.height === undefined ? ext.indexOf(Math.max(...ext)) : 1;
  const want = opts.height ?? opts.box?.[a] ?? ext[a];
  const k = ext[a] > 1e-6 ? want / ext[a] : 1;
  const model = cloneSkinned(gltf.scene);
  const centre = src.getCenter(new THREE.Vector3());
  model.position.set(-centre.x, -src.min.y, -centre.z);
  const object = new THREE.Group(); object.name = 'asset'; object.scale.setScalar(k); object.add(model);
  const clips = gltf.animations.map((a) => a.name);
  let mixer: THREE.AnimationMixer | null = null;
  const actions = new Map<string, THREE.AnimationAction>();
  let current: string | null = null;
  const pick = (name: string): string | null => {
    if (!clips.length) return null;
    const lower = name.toLowerCase(), byName = (n: string) => clips.find((c) => c.toLowerCase() === n);
    return byName(lower) ?? (lower === 'walk' ? byName('fly') ?? byName('swim') ?? byName('run') : lower === 'idle' ? byName('swim') ?? byName('fly') ?? null : null) ?? clips[0];
  };
  return {
    object, model, clips,
    play(name, t, o = {}) {
      const clip = pick(name); if (!clip) return null;
      mixer ??= new THREE.AnimationMixer(model);
      let act = actions.get(clip);
      if (!act) { act = mixer.clipAction(gltf.animations.find((a) => a.name === clip)!); act.play(); act.setEffectiveWeight(0); actions.set(clip, act); }
      if (current !== clip) { for (const [n, a] of actions) a.setEffectiveWeight(n === clip ? 1 : 0); current = clip; }
      const dur = act.getClip().duration || 1;
      act.time = (((t * (o.rate ?? 1) + (o.phase ?? 0)) % dur) + dur) % dur;
      mixer.update(0);
      return clip;
    },
    dispose() { mixer?.stopAllAction(); if (mixer) mixer.uncacheRoot(model); object.removeFromParent(); },
  };
}

const hookGeo = new THREE.BufferGeometry(); hookGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3)); hookGeo.setDrawRange(0, 0);
const hookMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
/** An invisible, never-culled object whose `onBeforeRender` runs `fn` once per frame while its parent is drawn (no triangles). */
export function frameHook(fn: (camera: THREE.Camera) => void): THREE.Mesh {
  const hook = new THREE.Mesh(hookGeo, hookMat); hook.name = 'asset frame hook'; hook.frustumCulled = false; hook.renderOrder = -1;
  let last = -1;
  hook.onBeforeRender = (renderer, _scene, camera) => { const f = renderer.info.render.frame; if (f === last) return; last = f; fn(camera); };
  return hook;
}
