import * as THREE from 'three';
import {hash01,loadPack,modelGeometry,PackSoup,decorationGround} from './assets.ts';
/** Ground cover and tree variety (Quaternius Ultimate Nature + Kenney Nature Kit, CC0): flower drifts in the gardens,
 * the park and the meadows, ferns and mushrooms at the woodland floor, lily pads on still water, and groves of birch,
 * willow and broadleaf at the lake and river edges that turn to their autumn colours in the Eden autumn (one world day
 * per real hour, UTC). The existing trees stay dominant: these are few and placed where there were none. Everything is
 * merged per 60 m cell (one draw per cell), drawn within DRAW_M of the camera. */
export type Patch = { id: string; rect: readonly [number, number, number, number]; count: number; models: readonly string[]; scale?: [number, number]; y?: number; autumn?: readonly string[] };
const CELL = 60, DRAW_M = 150;
export const WORLD_DAY_MS = 3600_000;
export function isAutumn(ms: number) { const doy = Math.floor(ms / WORLD_DAY_MS) % 365; return doy >= 244 && doy < 335; }
export function createEdenGroundCover(ground: (x: number, z: number) => number | null, patches: readonly Patch[], avoid: (x: number, z: number) => boolean = () => false, file = 'eden-nature.glb') {
  const group = new THREE.Group(); group.name = 'Eden ground cover and trees (scenery only)';
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, metalness: 0 }); mat.name = 'Eden ground cover';
  const cells = new Map<string, THREE.Mesh>(); let closed = false, triangles = 0, season = '';
  let gltf: Awaited<ReturnType<typeof loadPack>> | null = null;
  const geos = new Map<string, THREE.BufferGeometry | null>();
  const geo = (n: string) => { if (!gltf) return null; if (!geos.has(n)) geos.set(n, modelGeometry(gltf, n)); return geos.get(n)!; };
  function build() {
    if (!gltf) return;
    const autumn = isAutumn(Date.now()), key = autumn ? 'autumn' : 'green';
    if (key === season) return; season = key;
    for (const m of cells.values()) { group.remove(m); m.geometry.dispose(); } cells.clear(); triangles = 0;
    const soups = new Map<string, PackSoup>();
    for (const p of patches) {
      const models = autumn && p.autumn ? p.autumn : p.models;
      for (let i = 0; i < p.count; i++) {
        const id = `${p.id}:${i}`, x = p.rect[0] + (p.rect[2] - p.rect[0]) * hash01(id, 1), z = p.rect[1] + (p.rect[3] - p.rect[1]) * hash01(id, 2);
        if (avoid(x, z)) continue;
        const g = geo(models[Math.floor(hash01(id, 3) * models.length)]); if (!g) continue;
        const [s0, s1] = p.scale ?? [.8, 1.2], k = `${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`;
        let soup = soups.get(k); if (!soup) soups.set(k, (soup = new PackSoup()));
        const y=decorationGround(ground,x,z,p.y);if(y===null)continue;
        soup.add(g, [x,p.y===undefined?y-.02:y,z], hash01(id, 4) * Math.PI * 2, s0 + (s1 - s0) * hash01(id, 5));
      }
    }
    for (const [k, soup] of soups) {
      const m = new THREE.Mesh(soup.geometry(), mat); m.name = 'ground cover cell ' + k; m.castShadow = true; m.receiveShadow = true;
      triangles += soup.triangles; cells.set(k, m); group.add(m);
    }
  }
  // distance culling from the camera (the hook runs on an always-drawn empty mesh)
  const hookGeo = new THREE.BufferGeometry(); hookGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3)); hookGeo.setDrawRange(0, 0);
  const hook = new THREE.Mesh(hookGeo, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })); hook.frustumCulled = false; group.add(hook);
  const cam = new THREE.Vector3(), c = new THREE.Vector3();
  hook.onBeforeRender = (_r, _s, camera) => { camera.getWorldPosition(cam); for (const m of cells.values()) { const b = m.geometry.boundingSphere; if (!b) continue; c.copy(b.center); m.visible = c.distanceTo(cam) - b.radius < DRAW_M; } };
  const timer = setInterval(() => { if (!closed) build(); }, 60_000);
  loadPack(file).then((g) => { if (closed) return; gltf = g; build(); }).catch((e) => console.warn('Eden ground cover unavailable', e));
  return {
    group, stats: () => ({ groundCoverCells: cells.size, groundCoverTriangles: triangles }),
    dispose() { if (closed) return; closed = true; clearInterval(timer); group.removeFromParent(); for (const m of cells.values()) m.geometry.dispose(); for (const g of geos.values()) g?.dispose(); hookGeo.dispose(); mat.dispose(); },
  };
}
