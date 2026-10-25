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
import { mergeStatic } from './static-merge.ts';
import { preciseBounds } from './fast-geometry.ts';
import { addShadowProxy } from './shadow-proxy.ts';
import { captureTexturePreparation, compileModel, fitTextures, uploadTextures } from './texture-budget.ts';
import { decodedImagesOf, fetchInWorker, warmAssetWorker } from './asset-fetch.ts';

let shared: GLTFLoader | null = null;
/** LiveWorld may hand over its own loader (download progress, one Draco worker pool). */
export function setAssetLoader(loader: GLTFLoader) { shared = loader; warmAssetWorker(); }
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
  // lane PERF (texture-budget.ts): oversized textures are fitted before upload, and uploads are paced across frames
  const G = globalThis as unknown as { __assetStages?: Record<string, string>; __assetTimes?: Record<string, Record<string, number>> };
  const st = (G.__assetStages ??= {}), times: Record<string, number> = ((G.__assetTimes ??= {})[sha] = { start: performance.now() });   // probes (tools/speed)
  const stage = (s: string) => { st[sha] = s; times[s] = performance.now(); };
  // A download/resize may outlive its view. It may populate the shared asset cache, but must not prepare GPU work in
  // whichever unrelated world happens to be current when it finishes.
  const preparation = captureTexturePreparation();
  const entry = { p: download(l, assetUrl(sha)).then(async (g) => { stage('fit'); await fitTextures(g); stage('prepare'); prepare(g); stage('compile'); await compileModel(g, preparation); stage('upload'); await uploadTextures(g, preparation); stage('done'); return g; }), by: l, settled: false };
  cache.set(sha, entry);
  entry.p.then(() => { entry.settled = true; }, (e: unknown) => {
    if (cache.get(sha) !== entry) return;
    if ((e as { name?: string })?.name === 'AbortError' || entry.by !== loader()) { cache.delete(sha); return; }
    entry.settled = true; failed.add(sha); setTimeout(() => { if (cache.get(sha) === entry) cache.delete(sha); failed.delete(sha); }, 30_000);
  });
  return entry.p;
}
/** loadAsync, with the bytes downloaded in a worker when one is available (asset-fetch.ts); the loader's manager sees
 *  the same itemStart / itemEnd (and itemError) as FileLoader gives it. */
function download(l: GLTFLoader, url: string): Promise<GLTF> {
  const bytes = fetchInWorker(url);
  if (!bytes) return l.loadAsync(url);
  l.manager.itemStart(url);
  return bytes.then(
    (buffer) => parseWithImages(l, buffer, THREE.LoaderUtils.extractUrlBase(url)).then((g) => { l.manager.itemEnd(url); return g; }, (e: unknown) => { l.manager.itemError(url); l.manager.itemEnd(url); throw e; }),
    (e: { unavailable?: boolean }) => { l.manager.itemEnd(url); if (e?.unavailable) return l.loadAsync(url); l.manager.itemError(url); throw e; });
}
// Phone arrival round 2 (lane L3): images the download worker already decoded (asset-fetch.ts) become the parser's image
// sources, as GLTFLoader's own ImageBitmapLoader path would make them (Texture(bitmap), needsUpdate, the source's extras
// and mimeType; one source shared as clones). Anything else, or a non-ImageBitmap loader, takes three's path.
type Parser = { json: { images?: { mimeType?: string; extras?: unknown }[] }; sourceCache: Record<number, Promise<THREE.Texture>>; loadImageSource(i: number, loader: { isImageBitmapLoader?: boolean }): Promise<THREE.Texture> };
let pendingImages: Map<number, ImageBitmap> | null = null;
const withImagePlugin = new WeakSet<GLTFLoader>();
function parseWithImages(l: GLTFLoader, buffer: ArrayBuffer, path: string): Promise<GLTF> {
  const images = decodedImagesOf(buffer);
  if (!images) return l.parseAsync(buffer, path);
  if (!withImagePlugin.has(l)) {
    withImagePlugin.add(l);
    l.register((parser) => {
      const pre = pendingImages, p = parser as unknown as Parser;
      if (pre) {
        const own = p.loadImageSource.bind(p);
        p.loadImageSource = (i, loader) => {
          const bmp = pre.get(i);
          if (!bmp || loader.isImageBitmapLoader !== true) return own(i, loader);
          if (p.sourceCache[i] !== undefined) return p.sourceCache[i].then((t) => t.clone());
          pre.delete(i);
          const def = p.json.images![i];
          const t = new THREE.Texture(bmp); t.needsUpdate = true;
          if (def.extras !== undefined && typeof def.extras === 'object') Object.assign(t.userData, def.extras);
          t.userData.mimeType = def.mimeType;
          return (p.sourceCache[i] = Promise.resolve(t));
        };
      }
      return { name: 'EDEN_worker_images' } as never;
    });
  }
  pendingImages = images;
  let parsed: Promise<GLTF>;
  try { parsed = l.parseAsync(buffer, path); } finally { pendingImages = null; }
  // bitmaps the parse did not take (an unused image, a texture through another loader) are released
  const release = () => { for (const b of images.values()) b.close(); images.clear(); };
  return parsed.then((g) => { release(); return g; }, (e: unknown) => { release(); throw e; });
}
export function assetFailed(sha: string) { return failed.has(sha); }
/** W1: shot readiness includes parsing, texture upload and attached GLBs, without a fixed delay. */
export async function whenAssetsSettled() {
  for (;;) {
    const pending = [...cache.values()].filter(e => !e.settled).map(e => e.p);
    if (!pending.length) return;
    await Promise.allSettled(pending);
  }
}

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
  // lane PERF: a static model's many nodes/materials become a few merged meshes (static-merge.ts)
  try { const r = mergeStatic(g.scene, g.animations.length > 0); if (r) g.userData.merged = r; } catch (e) { console.warn('static merge skipped', e); }
  const box = preciseBounds(g.scene) ?? new THREE.Box3().setFromObject(g.scene, true);   // same box, typed-array loop (fast-geometry.ts)
  g.userData.bounds = box.isEmpty() ? new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5)) : box;
  // lane PERF2: and its opaque casters become one shadow-only proxy (shadow-proxy.ts); after the bounds, which fit the model
  if (!g.animations.length) try { g.userData.shadowCasters = addShadowProxy(g.scene); } catch (e) { console.warn('shadow proxy skipped', e); }
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
