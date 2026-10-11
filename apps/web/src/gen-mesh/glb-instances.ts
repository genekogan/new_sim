// Lane PERF2: GLB instancing. Every copy of the same static GLB (same sha) shares one InstancedMesh per merged part, so
// 40 identical scanned chairs cost one chair's draws, not 40x. mesh.mesh.ts hands a loaded, static, look-free model
// here instead of adding it to its holder; the holder stays in the scene graph as the entity's anchor (easing, carrying,
// removal), and once per frame (scene.onBeforeRender: after three updates world matrices, before culling and the
// shadow pass) each pool copies its holders' world matrices into its instance buffer, only when one changed.
//   - Hidden holders (an ancestor invisible, detached) are drawn as nothing; removed holders free their slot (swap-remove,
//     so `count` is exact and the bounding sphere covers only live copies, which keeps per-pool frustum culling).
//   - The pool lives under the holder's top ancestor below the Scene (the entity layer's group), so the layer's raycasts
//     (CoverProbe) still see it.
//   - A pool's USE_INSTANCING shader variants are compiled in the background before it is first drawn.
// `?inst=0` turns it off for A/B measurement. Old worlds never reach this (mesh.mesh.ts is the entity layer's).
import * as THREE from 'three';
import { compileObject } from './texture-budget.ts';
import { trackShadowProxies } from './shadow-proxy.ts';

export const GLB_INSTANCING = typeof location === 'undefined' || new URLSearchParams(location.search).get('inst') !== '0';

// mirror: the part's node is mirrored (negative determinant). three picks the front face from the InstancedMesh's own matrix,
// not per instance, so such a part's InstancedMesh carries the mirror (scale.x = -1) and its instances undo it.
type Part = { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; castShadow: boolean; receiveShadow: boolean; mirror: boolean };
type Member = { holder: THREE.Object3D; locals: THREE.Matrix4[]; seen: Float32Array; shown: boolean; slot: number; plain?: THREE.Object3D };
type Pool = { key: string; parts: Part[]; meshes: THREE.InstancedMesh[]; members: Member[]; capacity: number; ready: boolean; dirty: boolean; host: Host };
type Host = { root: THREE.Object3D; group: THREE.Group; pools: Map<string, Pool>; solos: Map<string, { holder: THREE.Object3D; object: THREE.Object3D }>; frame: number };

const hosts = new WeakMap<THREE.Object3D, Host>();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0), MIRROR = new THREE.Matrix4().makeScale(-1, 1, 1);
const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _s = new THREE.Sphere(), _s2 = new THREE.Sphere();

/** Top ancestor below the Scene, and the Scene; null while the holder is not in a scene. */
function anchor(o: THREE.Object3D): { root: THREE.Object3D; scene: THREE.Scene } | null {
  let p: THREE.Object3D = o;
  for (let i = 0; i < 64 && p.parent; i++) { if ((p.parent as THREE.Scene).isScene) return { root: p, scene: p.parent as THREE.Scene }; p = p.parent; }
  return null;
}
function shownInScene(o: THREE.Object3D, root: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = o;
  for (let i = 0; p && i < 64; i++) { if (!p.visible) return false; if (p === root) return !!root.parent; p = p.parent; }
  return false;
}

function hostFor(root: THREE.Object3D, scene: THREE.Scene): Host {
  let h = hosts.get(root);
  if (h) return h;
  const group = new THREE.Group(); group.name = 'glb-instances';
  h = { root, group, pools: new Map(), solos: new Map(), frame: -1 };
  hosts.set(root, h); root.add(group);
  const host = h, prev = scene.onBeforeRender;
  scene.onBeforeRender = function (this: THREE.Object3D, ...args: Parameters<THREE.Object3D['onBeforeRender']>) {
    prev.apply(this, args);
    const renderer = args[0];
    const f = renderer.info.render.frame; if (f === host.frame) return; host.frame = f;
    if (host.root.parent !== scene) return;
    for (const pool of host.pools.values()) sync(pool);
  };
  return h;
}

/** Offer one static model copy (`object`, already added to `holder` and fitted in its frame) to its sha's pool. The first
 *  copy of a sha stays a plain mesh (no instancing shader variants for one-offs, exact per-object culling); when a
 *  second copy arrives both join a pool, and each copy's plain object stays drawn until the pool's shaders are
 *  compiled, then leaves the holder. A copy leaves its pool when its holder leaves its parent. */
export function adoptInstance(sha: string, holder: THREE.Object3D, object: THREE.Object3D): void {
  const at = anchor(holder); if (!at) return;
  const host = hostFor(at.root, at.scene);
  const meshes: THREE.Mesh[] = []; object.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  if (!meshes.length) return;
  const key = `${sha}:${meshes.length}`;
  let pool = host.pools.get(key);
  if (!pool) {
    const solo = host.solos.get(key);
    if (!solo) {
      const rec = { holder, object }; host.solos.set(key, rec);
      const gone = () => { holder.removeEventListener('removed', gone); if (host.solos.get(key) === rec) host.solos.delete(key); };
      holder.addEventListener('removed', gone);
      return;
    }
    host.solos.delete(key);
    holder.updateWorldMatrix(true, true);
    pool = { key, parts: meshes.map((m) => ({ geometry: m.geometry, material: m.material, castShadow: m.castShadow, receiveShadow: m.receiveShadow, mirror: m.matrixWorld.determinant() < 0 })), meshes: [], members: [], capacity: 0, ready: false, dirty: true, host };
    host.pools.set(key, pool); allPools.add(pool);
    for (const g of pool.parts) g.geometry.boundingSphere ?? g.geometry.computeBoundingSphere();
    grow(pool, 4);
    const p = pool, warm = new THREE.Group(); for (const m of p.meshes) warm.add(m);
    compileObject(warm).finally(() => {
      if (host.pools.get(key) !== p) return;
      for (const m of p.meshes) host.group.add(m);
      trackShadowProxies(host.group);
      for (const mem of p.members) { mem.plain?.removeFromParent(); mem.plain = undefined; }
      p.ready = true; p.dirty = true;
    });
    join(pool, solo.holder, solo.object);
  }
  join(pool, holder, object);
}

function join(pool: Pool, holder: THREE.Object3D, object: THREE.Object3D) {
  holder.updateWorldMatrix(true, true);
  const hinv = new THREE.Matrix4().copy(holder.matrixWorld).invert();
  const locals: THREE.Matrix4[] = []; object.traverse((o) => { if ((o as THREE.Mesh).isMesh) locals.push(new THREE.Matrix4().multiplyMatrices(hinv, o.matrixWorld)); });
  const member: Member = { holder, locals, seen: new Float32Array(16).fill(Number.NaN), shown: true, slot: pool.members.length };
  if (pool.ready) object.removeFromParent(); else member.plain = object;
  pool.members.push(member);
  if (pool.members.length > pool.capacity) grow(pool, pool.capacity * 2);
  pool.dirty = true;
  const release = () => {
    holder.removeEventListener('removed', release);
    const i = pool.members.indexOf(member); if (i < 0) return;
    const last = pool.members.pop()!;
    if (last !== member) { pool.members[i] = last; last.slot = i; last.seen.fill(Number.NaN); last.shown = true; }   // rewritten (or zeroed) at the next sync
    pool.dirty = true;
  };
  holder.addEventListener('removed', release);
}

function grow(pool: Pool, capacity: number) {
  const old = pool.meshes;
  pool.meshes = pool.parts.map((part, k) => {
    const m = new THREE.InstancedMesh(part.geometry, part.material, capacity);
    if (part.mirror) m.scale.x = -1;
    m.castShadow = part.castShadow; m.receiveShadow = part.receiveShadow; m.name = `glb-instances:${pool.key.slice(0, 8)}:${k}`;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0;
    if (old[k]) { old[k].removeFromParent(); old[k].dispose(); }
    if (pool.ready) { pool.host.group.add(m); trackShadowProxies(m); }
    return m;
  });
  pool.capacity = capacity;
  for (const mem of pool.members) { mem.seen.fill(Number.NaN); mem.shown = true; }   // new buffers start as identity: rewrite every slot
}

function sync(pool: Pool) {
  if (!pool.ready) return;
  const root = pool.host.root;
  _inv.copy(root.matrixWorld).invert();
  let changed = pool.dirty;
  for (const mem of pool.members) {
    const shown = shownInScene(mem.holder, root);
    if (!shown) { if (mem.shown) { for (const m of pool.meshes) m.setMatrixAt(mem.slot, ZERO); mem.shown = false; changed = true; } continue; }
    const e = mem.holder.matrixWorld.elements;
    let same = mem.shown;
    if (same) for (let i = 0; i < 16; i++) if (mem.seen[i] !== e[i]) { same = false; break; }
    if (same) continue;
    mem.seen.set(e); mem.shown = true; changed = true;
    for (let k = 0; k < pool.meshes.length; k++) { _m.multiplyMatrices(_inv, mem.holder.matrixWorld).multiply(mem.locals[k]); if (pool.parts[k].mirror) _m.premultiply(MIRROR); pool.meshes[k].setMatrixAt(mem.slot, _m); }
  }
  if (!changed) return;
  pool.dirty = false;
  for (let k = 0; k < pool.meshes.length; k++) {
    const mesh = pool.meshes[k], gs = pool.parts[k].geometry.boundingSphere!;
    mesh.count = pool.members.length; mesh.instanceMatrix.needsUpdate = true;
    // bounds of the shown copies only (three's own computeBoundingSphere would count hidden zero matrices at the origin)
    const bs = (mesh.boundingSphere ??= new THREE.Sphere()); bs.makeEmpty();
    for (const mem of pool.members) { if (!mem.shown) continue; mesh.getMatrixAt(mem.slot, _m); _s.copy(gs).applyMatrix4(_m); if (bs.isEmpty()) bs.copy(_s); else bs.union(_s); }
    if (bs.isEmpty()) bs.set(_s2.center.set(0, -1e6, 0), 0);
  }
}

const allPools = new Set<Pool>();
/** Debug and probe numbers: pools, copies, draws (one per part per non-empty pool), copies sharing a pool with another. */
export function glbInstanceStats() {
  let pools = 0, copies = 0, draws = 0, shared = 0;
  for (const pool of allPools) {
    if (!pool.host.root.parent) { allPools.delete(pool); continue; }   // a scene LiveWorld has since replaced
    if (!pool.members.length) continue;
    pools++; copies += pool.members.length; draws += pool.parts.length; if (pool.members.length > 1) shared += pool.members.length;
  }
  return { pools, copies, draws, shared };
}
(globalThis as { __glbInstances?: unknown }).__glbInstances = glbInstanceStats;
