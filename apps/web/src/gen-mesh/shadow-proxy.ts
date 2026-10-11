// Lane PERF2: one shadow caster per static model. After static-merge a Mars campus piece is still ~6 meshes (one per
// material) and each was drawn again into the shadow map (mars-two: ~330 shadow draws, ~0.6 ms CPU per frame). Once per
// loaded file (gltf-assets.ts `prepare`), the opaque casters' positions are merged into one geometry per shadow side; that
// proxy alone casts (three's default depth material) and the visible meshes stop casting.
// The proxy must not cost a main-pass draw: it is visible only during the shadow pass. A hook mesh, first child of the
// scene, turns the scene's proxies on in its onBeforeShadow (the shadow pass walks the scene graph in order, so it runs
// first) and off in its onBeforeRender (first in the main pass, whose render list was built while they were off).
// The proxy's own material clips every vertex, in case anything ever draws it in a colour pass.
// Left casting themselves: a `roof` group (hidden in the interior view, its shadow goes with it), alpha-mapped or
// displaced materials, and alpha-tested ones whose map really has transparent texels (the depth pass needs the map).
// Measured on mars-two: 257 of 262 alpha-tested casters had fully opaque maps (the exporter marks everything MASK).
// `?shadowproxy=0` for A/B.
import * as THREE from 'three';

const OFF = typeof location !== 'undefined' && new URLSearchParams(location.search).get('shadowproxy') === '0';
const nullMats = new Map<number, THREE.ShaderMaterial>();
/** Draws nothing in a colour pass (every vertex is clipped); the shadow pass uses three's depth material instead. */
/** key = side + 3 * shadowSide (3 = null): the depth pass takes shadowSide when set, else the mirror of side. */
function nullMaterial(key: number) {
  let m = nullMats.get(key);
  if (!m) {
    const side = (key % 3) as THREE.Side, shadow = Math.floor(key / 3);
    m = new THREE.ShaderMaterial({ vertexShader: 'void main() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }', fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }', side, colorWrite: false, depthWrite: false, depthTest: false });
    m.shadowSide = shadow === 3 ? null : (shadow as THREE.Side);
    m.name = 'shadow-proxy'; nullMats.set(key, m);
  }
  return m;
}

const opaque = new WeakMap<THREE.Texture, boolean>();
let probe: OffscreenCanvasRenderingContext2D | null = null;
export const alphaStats = { checked: 0, opaque: 0, ms: 0 };
/** True when a texture's alpha is 255 everywhere (sampled nearest at ≤ 256 px a side, so holes under ~4 texels of a 1024
 *  map can be missed: their shadow then comes out solid). Unknown images count as not opaque. */
function opaqueMap(t: THREE.Texture | null): boolean {
  if (!t) return true;
  const hit = opaque.get(t); if (hit !== undefined) return hit;
  let ok = false;
  const t0 = performance.now();
  try {
    const im = t.image as CanvasImageSource & { width: number; height: number };
    if (im && im.width && im.height && typeof OffscreenCanvas !== 'undefined') {
      const w = Math.min(256, im.width), h = Math.min(256, im.height);
      probe ??= new OffscreenCanvas(256, 256).getContext('2d', { willReadFrequently: true });
      if (probe) {
        probe.imageSmoothingEnabled = false; probe.clearRect(0, 0, w, h); probe.drawImage(im, 0, 0, w, h);
        const d = probe.getImageData(0, 0, w, h).data; ok = true;
        for (let i = 3; i < d.length; i += 4) if (d[i] < 250) { ok = false; break; }
      }
    }
  } catch { ok = false; }
  alphaStats.checked++; if (ok) alphaStats.opaque++; alphaStats.ms += performance.now() - t0;
  opaque.set(t, ok);
  return ok;
}

/** Add the proxy to a static model's scene (in place). Returns the casters merged, or 0 when skipped. */
export function addShadowProxy(root: THREE.Object3D): number {
  if (OFF) return 0;
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const bySide = new Map<number, { mesh: THREE.Mesh; rel: THREE.Matrix4 }[]>();
  let ok = true;
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh || (o as THREE.InstancedMesh).isInstancedMesh || o.name.startsWith('role:')) ok = false;
    const m = o as THREE.Mesh; if (!m.isMesh || !m.castShadow) return;
    for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (p.name === 'roof' || !p.visible) return;
    if (Array.isArray(m.material) || Object.keys(m.geometry.morphAttributes).length || !m.geometry.attributes.position) return;
    const mat = m.material as THREE.MeshStandardMaterial;
    if ((mat.alphaTest > 0 && !opaqueMap(mat.map)) || mat.alphaToCoverage || mat.wireframe || mat.alphaMap || mat.displacementMap || mat.clippingPlanes?.length || !mat.visible) return;
    const side = mat.side + 3 * (mat.shadowSide === null || mat.shadowSide === undefined ? 3 : mat.shadowSide);
    let list = bySide.get(side); if (!list) bySide.set(side, (list = []));
    list.push({ mesh: m, rel: new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld) });
  });
  const total = [...bySide.values()].reduce((a, l) => a + l.length, 0);
  if (!ok || total < 2) return 0;
  let merged = 0;
  for (const [side, list] of bySide) {
    // one position-only geometry in the model root's frame. Positions are read through getX (meshopt/quantized GLBs store
    // normalized int16 positions that their node matrix dequantizes); a mirrored node's triangles are rewound so the
    // shadow side stays the same.
    const ranges = list.map(({ mesh }) => { const g = mesh.geometry, n = g.index ? g.index.count : g.attributes.position.count, start = Math.min(n, g.drawRange.start), count = Math.min(n - start, Number.isFinite(g.drawRange.count) ? g.drawRange.count : n); return { start, count }; });
    const nv = list.reduce((a, { mesh }) => a + mesh.geometry.attributes.position.count, 0), ni = ranges.reduce((a, r) => a + r.count, 0);
    const pos = new Float32Array(nv * 3), idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni), v = new THREE.Vector3();
    let vo = 0, io = 0;
    list.forEach(({ mesh, rel }, k) => {
      const g = mesh.geometry, sp = g.attributes.position as THREE.BufferAttribute, flip = rel.determinant() < 0, { start, count } = ranges[k];
      for (let i = 0; i < sp.count; i++) { v.fromBufferAttribute(sp, i).applyMatrix4(rel); pos[(vo + i) * 3] = v.x; pos[(vo + i) * 3 + 1] = v.y; pos[(vo + i) * 3 + 2] = v.z; }
      for (let i = 0; i < count; i++) { const j = flip ? (i % 3 === 1 ? i + 1 : i % 3 === 2 ? i - 1 : i) : i; idx[io + i] = vo + (g.index ? g.index.getX(start + j) : start + j); }
      vo += sp.count; io += count;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    // (the CPU arrays stay: a cached asset is reused by the next renderer after a LiveWorld re-mount, which uploads again)
    const proxy = new THREE.Mesh(geo, nullMaterial(side));
    proxy.name = 'shadow-proxy'; proxy.castShadow = true; proxy.receiveShadow = false; proxy.userData.shadowProxy = true;
    proxy.matrixAutoUpdate = false;   // identity in the model root's frame
    root.add(proxy);
    for (const { mesh } of list) mesh.castShadow = false;
    merged += list.length;
  }
  return merged;
}

// ---------------------------------------------------------------- runtime: proxies are drawn only in the shadow pass
type Hub = { proxies: Set<THREE.Object3D>; scene: THREE.Scene };
const hubs = new WeakMap<THREE.Scene, Hub>();
const hookGeo = new THREE.BufferGeometry(); hookGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3)); hookGeo.setDrawRange(0, 0);
const hookMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
function attachedTo(o: THREE.Object3D, scene: THREE.Scene) { let p: THREE.Object3D | null = o; for (let i = 0; p && i < 64; i++) { if (p === scene) return true; p = p.parent; } return false; }

function hubFor(scene: THREE.Scene): Hub {
  let h = hubs.get(scene);
  if (h) return h;
  const hub: Hub = { proxies: new Set(), scene };
  const hook = new THREE.Mesh(hookGeo, hookMat); hook.name = 'shadow-proxy hook'; hook.frustumCulled = false; hook.castShadow = true; hook.renderOrder = -1e9;
  hook.onBeforeShadow = () => { for (const p of hub.proxies) { if (attachedTo(p, scene)) p.visible = true; else hub.proxies.delete(p); } };
  hook.onBeforeRender = () => { for (const p of hub.proxies) p.visible = false; };
  scene.add(hook); scene.children.splice(scene.children.indexOf(hook), 1); scene.children.unshift(hook);
  hubs.set(scene, hub);
  return hub;
}
function sceneOf(o: THREE.Object3D): THREE.Scene | null { let p: THREE.Object3D | null = o; for (let i = 0; p && i < 64; i++) { if ((p as THREE.Scene).isScene) return p as THREE.Scene; p = p.parent; } return null; }

/** Register the shadow proxies inside `obj` (a model clone, or an InstancedMesh pool part) with `obj`'s scene: they are
 *  hidden from the main pass from now on. Returns false when `obj` is not in a scene (its proxies then stay as they are). */
export function trackShadowProxies(obj: THREE.Object3D, scene = sceneOf(obj)): boolean {
  if (!scene) return false;
  const hub = hubFor(scene);
  obj.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh || !(o.userData.shadowProxy || ((o as THREE.Mesh).material as THREE.Material).name === 'shadow-proxy')) return;
    o.raycast = () => {};   // the visible meshes answer raycasts
    o.visible = false; hub.proxies.add(o);
  });
  return true;
}

(globalThis as { __shadowProxyAlpha?: unknown }).__shadowProxyAlpha = alphaStats;
