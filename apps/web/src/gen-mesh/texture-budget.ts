// Lane PERF: textures of imported models, sized and uploaded so a world fills in without hitches.
// Measured on littlemartians-two (432 things, ~100 photogrammetry scans): 456 textures, 586 Mpx (2048² colour, normal,
// roughness and AO maps), ~3 GB of GPU memory with mipmaps, and 1.5 s of main-thread texSubImage2D in the first 15 s,
// most of it in single frames of 0.2–1.4 s as each batch of scans arrived.
//
//   - fit: colour maps are capped at 1024 px, the other PBR maps (normal, roughness, metalness, AO) at 512 px, resized
//     off the main thread by createImageBitmap before anything is uploaded (a 1024 map over a 5 m scan is ~200 px/m,
//     more than the screen shows from the usual 20+ m);
//   - compile: the model's shader programs are compiled in the background before it is shown;
//   - pace: textures are uploaded (renderer.initTexture) a few per frame within a small time budget, before the model is
//     added, so no frame takes the whole batch.
// `?tex=full` keeps the original sizes; the pacing still applies. Old worlds never come here (gen-mesh is the entity layer).
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { arrivalGate } from './lazy-assets.ts';

const FULL = typeof location !== 'undefined' && new URLSearchParams(location.search).get('tex') === 'full';
const CAP: Record<string, number> = { map: 1024, emissiveMap: 1024, normalMap: 512, roughnessMap: 512, metalnessMap: 512, aoMap: 512, bumpMap: 512, alphaMap: 1024 };
const SLOTS = Object.keys(CAP);

let renderer: THREE.WebGLRenderer | null = null, scene: THREE.Scene | null = null, camera: THREE.Camera | null = null;
/** LiveWorld hands over its renderer (and scene and camera, for shader compiles) so uploads and compiles can be paced;
 *  without one, three uploads and compiles on first draw as before. */
export function setTextureRenderer(r: THREE.WebGLRenderer | null, s: THREE.Scene | null = null, c: THREE.Camera | null = null) { renderer = r; scene = s; camera = c; }

/** Compile a model's shader programs in the background (KHR_parallel_shader_compile) before it is first drawn: a new
 *  material variant otherwise blocks the frame that first draws it (~0.3 s over LM's load). Not three's compileAsync: its
 *  readiness poll reads `properties.get(material).currentProgram.isReady()` in its own timer and threw an uncaught
 *  TypeError on production when LiveWorld re-mounted (the old renderer disposed, its properties gone) mid-compile. */
export async function compileModel(g: GLTF): Promise<void> {
  const r = renderer; if (!r || !scene || !camera) return;
  try { r.compile(g.scene, camera, scene); } catch { return; /* compiled on first draw instead */ }
  const mats = new Set<THREE.Material>();
  g.scene.traverse((o) => { const m = (o as THREE.Mesh).material; if (m) for (const x of Array.isArray(m) ? m : [m]) mats.add(x); });
  await waitForPrograms(r, mats, () => renderer === r);
}
/** Same for a loose object (not in the scene; compiled against the scene's lights), e.g. a new InstancedMesh pool whose
 *  USE_INSTANCING variant would otherwise compile on the frame that first draws it (lane PERF2). */
export async function compileObject(o: THREE.Object3D): Promise<void> {
  const r = renderer; if (!r || !scene || !camera) return;
  try { r.compile(o, camera, scene); } catch { return; }
  const mats = new Set<THREE.Material>();
  o.traverse((x) => { const m = (x as THREE.Mesh).material; if (m) for (const y of Array.isArray(m) ? m : [m]) mats.add(y); });
  await waitForPrograms(r, mats, () => renderer === r);
}
type ProgramsOf = { properties: { get(m: object): unknown } };
/** Resolve once every material's program reports ready, or when it cannot tell (no program: a disposed renderer), when
 *  the renderer is no longer current, or after `timeoutMs`. Never throws, never waits forever. */
export function waitForPrograms(r: ProgramsOf, mats: Set<object>, current: () => boolean, timeoutMs = 3000): Promise<void> {
  const t0 = performance.now();
  return new Promise((resolve) => {
    const check = () => {
      try {
        if (!current() || performance.now() - t0 > timeoutMs) return resolve();
        for (const m of mats) { const p = (r.properties.get(m) as { currentProgram?: { isReady?: () => boolean } } | undefined)?.currentProgram; if (!p || typeof p.isReady !== 'function' || p.isReady()) mats.delete(m); }
      } catch { return resolve(); }
      if (!mats.size) resolve(); else setTimeout(check, 16);
    };
    check();
  });
}

/** Downscale a loaded model's oversized textures (each texture once, even when shared by several materials). */
export async function fitTextures(g: GLTF): Promise<void> {
  if (FULL || typeof createImageBitmap === 'undefined') return;
  const want = new Map<THREE.Texture, number>();
  g.scene.traverse((o) => {
    const m = o as THREE.Mesh; if (!m.isMesh) return;
    for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as unknown as Record<string, THREE.Texture | null>[]) {
      for (const k of SLOTS) { const t = mat[k]; if (t?.isTexture) want.set(t, Math.max(want.get(t) ?? 0, CAP[k])); }
    }
  });
  await Promise.all([...want].map(async ([t, cap]) => {
    const im = t.image as ImageBitmap | HTMLImageElement | undefined;
    const w = im?.width ?? 0, h = im?.height ?? 0;
    if (!w || !h || Math.max(w, h) <= cap) return;
    const k = cap / Math.max(w, h);
    const rw = Math.max(1, Math.round(w * k)), rh = Math.max(1, Math.round(h * k));
    try {
      const small = im instanceof ImageBitmap && worker() ? await resizeInWorker(im, rw, rh) : await createImageBitmap(im as ImageBitmap, { resizeWidth: rw, resizeHeight: rh, resizeQuality: 'high', premultiplyAlpha: 'none' });
      if (im !== small && typeof (im as ImageBitmap).close === 'function') { try { (im as ImageBitmap).close(); } catch { /* transferred */ } }
      t.image = small; t.needsUpdate = true;
    } catch { /* keep the original */ }
  }));
}

// premultiplyAlpha 'none' as GLTFLoader's own bitmaps: a premultiplied bitmap makes every texSubImage2D un-premultiply
// on the CPU (it doubled the upload time). The resize runs in a worker: on the main thread createImageBitmap(bitmap, {resize…}) cost ~0.9 s over LM's load.
let w: Worker | null | undefined;
const pending = new Map<number, (b: ImageBitmap | null) => void>(); let nextId = 0;
function worker(): Worker | null {
  if (w !== undefined) return w;
  try {
    const src = `onmessage=async(e)=>{const{id,bmp,rw,rh}=e.data;try{const s=await createImageBitmap(bmp,{resizeWidth:rw,resizeHeight:rh,resizeQuality:'high',premultiplyAlpha:'none'});bmp.close();postMessage({id,bmp:s},[s]);}catch(err){postMessage({id,bmp:null});}}`;
    w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    w.onmessage = (e: MessageEvent<{ id: number; bmp: ImageBitmap | null }>) => { const f = pending.get(e.data.id); pending.delete(e.data.id); f?.(e.data.bmp); };
  } catch { w = null; }
  return w;
}
function resizeInWorker(bmp: ImageBitmap, rw: number, rh: number): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (b) => (b ? resolve(b) : reject(new Error('resize failed'))));
    worker()!.postMessage({ id, bmp, rw, rh }, [bmp]);
  });
}

// ---- paced upload ----
const queue: { tex: THREE.Texture; done: () => void }[] = [];
let scheduled = false;
// per frame: ~1 Mpx of texture (one 1024² map) and 6 ms of main thread, 4x that while the arrival card is up. The
// upload's real cost is in the GPU process (~5 ms/Mpx here), so a pixel budget is what keeps frames even.
const BUDGET_MS = 6, BUDGET_PX = 1.1e6;
function pump() {
  scheduled = false;
  const t0 = performance.now(), k = arrivalGate.pending() ? 4 : 1;
  let px = 0;
  while (queue.length && performance.now() - t0 < BUDGET_MS * k && px < BUDGET_PX * k) {
    const { tex, done } = queue.shift()!;
    const im = tex.image as { width?: number; height?: number } | undefined; px += (im?.width ?? 0) * (im?.height ?? 0);
    try { renderer?.initTexture(tex); } catch { /* uploaded on first draw instead */ }
    done();
  }
  if (queue.length) { scheduled = true; requestAnimationFrame(pump); }
}
/** Upload a model's textures a few per frame; resolves when all are on the GPU (immediately without a renderer). */
export function uploadTextures(g: GLTF): Promise<void> {
  if (!renderer) return Promise.resolve();
  const set = new Set<THREE.Texture>();
  g.scene.traverse((o) => {
    const m = o as THREE.Mesh; if (!m.isMesh) return;
    for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as unknown as Record<string, unknown>[]) for (const v of Object.values(mat)) if ((v as THREE.Texture)?.isTexture) set.add(v as THREE.Texture);
  });
  if (!set.size) return Promise.resolve();
  return new Promise((resolve) => {
    let left = set.size;
    for (const tex of set) queue.push({ tex, done: () => { if (--left === 0) resolve(); } });
    if (!scheduled) { scheduled = true; requestAnimationFrame(pump); }
  });
}

/** A whole scene's programs linked in parallel, as three's compileAsync, but through waitForPrograms: three's own poll
 *  threw `reading 'isReady'` from its timer when a material was disposed mid-compile (on 3.32/3.33 phones ~1 in 3 loads of
 *  a new world: the early layer replaces near-ring materials while LiveWorld compiles) and then never resolved, so the
 *  arrival waited for its 3 s fallback, or for good where there was none. Every whole-scene compile goes through this. */
export function compileSceneAsync(r: THREE.WebGLRenderer, scene: THREE.Object3D, camera: THREE.Camera, timeoutMs = 3000): Promise<void> {
  let mats: unknown;
  try { mats = r.compile(scene, camera); } catch { return Promise.resolve(); }
  return waitForPrograms(r, mats instanceof Set ? mats as Set<object> : new Set(), () => true, timeoutMs);
}

/** Link, in parallel, the programs a change to the scene will need before any frame draws it: `add` puts the change in
 *  (e.g. a light, which changes the program of every lit material), the whole scene is compiled against it, `remove` takes
 *  it out again at once, and the promise resolves once those programs have linked (or at `timeoutMs`). Adding it for real
 *  afterwards then links nothing on the frame. True when warmed; false without a renderer (nothing compiled). */
export function warmSceneChange(add: () => void, remove: () => void, timeoutMs = 10_000): Promise<boolean> {
  const r = renderer, s = scene, c = camera; if (!r || !s || !c) return Promise.resolve(false);
  let mats: unknown = null;
  add(); try { mats = r.compile(s, c); } catch { /* compiled on first draw instead */ } finally { remove(); }
  if (!(mats instanceof Set)) return Promise.resolve(false);
  return waitForPrograms(r, mats as Set<object>, () => renderer === r, timeoutMs).then(() => true);
}
