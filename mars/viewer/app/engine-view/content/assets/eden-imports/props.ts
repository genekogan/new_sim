import * as THREE from 'three';
import {hash01,loadPack,modelGeometry,PackSoup} from './assets.ts';
import {FIXTURES} from './interior-plan.ts';
/** Food and table settings and house fixtures (Quaternius Ultimate Food + House Interior, Kenney Food
 * Kit; CC0). Decorative only: these are not engine items (Souls' own food, cups and plates stay the engine's and are
 * drawn by the hands layer and the items feed), so they sit on picnic and garden tables and the dining table, never on
 * the commons kitchen stations. One merged mesh per pack (one draw each). */
export type Setting = { id: string; at: [number, number]; y: number; yaw?: number; items: readonly [string, number, number, number?][] };
/** A table setting: [model, dx, dz, yaw?] in the table's frame (x along the table). */
const PICNIC: Setting['items'] = [['kfood-plate-dinner', -.45, -.2], ['food-croissant', -.45, -.2], ['kfood-cup-tea', -.25, -.27], ['kfood-plate-dinner', .45, .2], ['food-apple', .42, .2], ['food-orange', .5, .16], ['kfood-cup-coffee', .25, .27], ['kfood-loaf', 0, 0, .4], ['kfood-glass-wine', .1, -.25]];
const GARDEN: Setting['items'] = [['kfood-cup-tea', .22, .1], ['kfood-cup-tea', -.12, .2], ['kfood-pie', .05, -.22], ['kfood-plate-dinner', -.2, -.1]];
const DINING: Setting['items'] = [['kfood-bowl', -.2, 0], ['food-apple', -.24, .03], ['food-orange', -.16, -.04], ['food-banana', -.2, .02, .6], ['kfood-loaf', .35, 0, .2], ['kfood-cutting-board', .35, .05]];
export const SETTINGS: readonly Setting[] = [
  // eden-street-props picnic tables (top 0.765 m) and garden tables with parasols (top 0.74 m; pole at the centre)
  ...([[55.0, -22.4, 0], [59.5, -22.3, .12], [84.6, 77.2, .3]] as const).map(([x, z, yaw], i): Setting => ({ id: `picnic-${i + 1}`, at: [x, z], y: .765, yaw, items: PICNIC })),
  ...([[50.26, 19.71, .3], [97.35, 7.17, .8], [51, -22.67, .4]] as const).map(([x, z, yaw], i): Setting => ({ id: `garden-table-${i + 1}`, at: [x, z], y: .74, yaw, items: GARDEN })),
  // the social Eden dining table (table-6ft, top 0.75 m): a fruit bowl and bread in the middle only
  { id: 'dining-table', at: [23, 6], y: .75, yaw: 0, items: DINING },
];
export function createEdenProps(ground: (x: number, z: number) => number | null, settings: readonly Setting[] = SETTINGS) {
  const group = new THREE.Group(); group.name = 'Eden food and table props (scenery only)';
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .6, metalness: 0 }); mat.name = 'Eden table props';
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat); mesh.name = 'table settings and produce'; mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
  let closed = false, triangles = 0;
  const gy = (x: number, z: number) => { const y = ground(x, z); return y !== null && Number.isFinite(y) ? y : 0; };
  loadPack('eden-food.glb').then((gltf) => {
    if (closed) return;
    const soup = new PackSoup(), geos = new Map<string, THREE.BufferGeometry | null>();
    const geo = (n: string) => { if (!geos.has(n)) geos.set(n, modelGeometry(gltf, n)); return geos.get(n)!; };
    for (const s of settings) {
      const yaw = s.yaw ?? 0, c = Math.cos(yaw), sn = Math.sin(yaw), base = gy(s.at[0], s.at[1]) + s.y;
      // stacked items (a croissant on its plate) rest on what is already there at that spot
      const tops = new Map<string, number>();
      for (const [model, dx, dz, ry] of s.items) {
        const g = geo(model); if (!g) continue;
        const x = s.at[0] + dx * c + dz * sn, z = s.at[1] - dx * sn + dz * c, k = `${dx.toFixed(2)}:${dz.toFixed(2)}`, y = tops.get(k) ?? base;
        soup.add(g, [x, y, z], yaw + (ry ?? hash01(s.id + model + k, 1) * Math.PI * 2));
        g.computeBoundingBox(); tops.set(k, y + Math.min(.03, (g.boundingBox!.max.y - g.boundingBox!.min.y) * .5));
      }
    }
    for (const g of geos.values()) g?.dispose();
    mesh.geometry.dispose(); mesh.geometry = soup.geometry(); triangles = soup.triangles;
  }).catch((e) => console.warn('Eden food props unavailable', e));
  // house fixtures (hearth, rugs): their own pack and mesh
  const fixtures = new THREE.Mesh(new THREE.BufferGeometry(), mat); fixtures.name = 'house fixtures'; fixtures.castShadow = true; fixtures.receiveShadow = true; group.add(fixtures);
  loadPack('eden-interior.glb').then((gltf) => {
    if (closed) return;
    const soup = new PackSoup(), geos = new Map<string, THREE.BufferGeometry | null>();
    for (const f of FIXTURES) { if (!geos.has(f.model)) geos.set(f.model, modelGeometry(gltf, f.model)); const g = geos.get(f.model); if (g) soup.add(g, [f.at[0], f.y, f.at[1]], f.yaw, f.scale ?? 1); }
    for (const g of geos.values()) g?.dispose();
    fixtures.geometry.dispose(); fixtures.geometry = soup.geometry(); triangles += soup.triangles;
  }).catch((e) => console.warn('Eden house fixtures unavailable', e));
  return { group, stats: () => ({ propTriangles: triangles }), dispose() { if (closed) return; closed = true; group.removeFromParent(); mesh.geometry.dispose(); fixtures.geometry.dispose(); mat.dispose(); } };
}
