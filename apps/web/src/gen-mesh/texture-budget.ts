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

const FULL = typeof location !== 'undefined' && new URLSearchParams(location.search).get('tex') === 'full';
const CAP: Record<string, number> = { map: 1024, emissiveMap: 1024, normalMap: 512, roughnessMap: 512, metalnessMap: 512, aoMap: 512, bumpMap: 512, alphaMap: 1024 };
const SLOTS = Object.keys(CAP);

let renderer: THREE.WebGLRenderer | null = null, scene: THREE.Scene | null = null, camera: THREE.Camera | null = null;
/** LiveWorld hands over its renderer (and scene and camera, for shader compiles) so uploads and compiles can be paced;
 *  without one, three uploads and compiles on first draw as before. */
export function setTextureRenderer(r: THREE.WebGLRenderer | null, s: THREE.Scene | null = null, c: THREE.Camera | null = null) { renderer = r; scene = s; camera = c; }

/** Compile a model's shader programs in the background (KHR_parallel_shader_compile) before it is first drawn: a new
 *  material variant otherwise blocks the frame that first draws it (~0.3 s over LM's load). */
export async function compileModel(g: GLTF): Promise<void> {
  if (!renderer || !scene || !camera) return;
  try { await renderer.compileAsync(g.scene, camera, scene); } catch { /* compiled on first draw instead */ }
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
      const small = im instanceof ImageBitmap && worker() ? await resizeInWorker(im, rw, rh) : await createImageBitmap(im as ImageBitmap, { resizeWidth: rw, resizeHeight: rh, resizeQuality: 'high' });
      if (im !== small && typeof (im as ImageBitmap).close === 'function') { try { (im as ImageBitmap).close(); } catch { /* transferred */ } }
      t.image = small; t.needsUpdate = true;
    } catch { /* keep the original */ }
  }));
}

// The resize runs in a worker: on the main thread createImageBitmap(bitmap, {resize…}) cost ~0.9 s over LM's load.
let w: Worker | null | undefined;
const pending = new Map<number, (b: ImageBitmap | null) => void>(); let nextId = 0;
function worker(): Worker | null {
  if (w !== undefined) return w;
  try {
    const src = `onmessage=async(e)=>{const{id,bmp,rw,rh}=e.data;try{const s=await createImageBitmap(bmp,{resizeWidth:rw,resizeHeight:rh,resizeQuality:'high'});bmp.close();postMessage({id,bmp:s},[s]);}catch(err){postMessage({id,bmp:null});}}`;
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
const BUDGET_MS = 6;
function pump() {
  scheduled = false;
  const t0 = performance.now();
  while (queue.length && performance.now() - t0 < BUDGET_MS) {
    const { tex, done } = queue.shift()!;
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
