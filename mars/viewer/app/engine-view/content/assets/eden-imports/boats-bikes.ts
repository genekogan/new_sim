import * as THREE from 'three';
import {loadPack,modelGeometry,PackSoup,decorationGround} from './assets.ts';
/** Boats moored on Eden's waters and bicycles parked by houses, the café and the harbour (static scenery; CC0: Kenney
 * Watercraft + Nature canoe, Quaternius Ships + Public Transport). Ids and poses are the starting `parked` poses of the
 * carriers proposal (team/CONTRACTS/proposals/IMPORTS-boats-bikes-carriers.md). One merged mesh, one draw. Boats sit on
 * their water body’s surface (hull bottoms 0.15 m under it) (gently bobbing is left to a later carrier pass: static today). */
export type Parked = { id: string; model: string; at: [number, number]; yaw: number; y?: number; tilt?: number; roll?: number };
/** Model frames: yaw 0 = the hull / frame length along z. Water surfaces (Eden landscape + regions): the pond and its
 * channel −2.0, the park pond −0.45, the canal −0.70. */
export const BOATS: readonly Parked[] = [
  // the pond, either side of the west-lake dock (deck −98…−90 × 0.2…1.8; the original hull is parked at (−90, 3))
  { id: 'imports-rowboat-pond-1', model: 'rowboat', at: [-94.2, -0.9], yaw: Math.PI / 2, y: -2.15 },
  { id: 'imports-canoe-pond-1', model: 'canoe', at: [-95.6, 2.8], yaw: Math.PI / 2 + .05, y: -2.15 },
  // the park pond: one at the little jetty, one out on the water
  { id: 'imports-rowboat-park-1', model: 'rowboat', at: [3.6, 113.2], yaw: Math.PI / 2 + .2, y: -0.6 },
  { id: 'imports-dinghy-park-1', model: 'dinghy', at: [-11.5, 109.0], yaw: .9, y: -0.6 },
  // the canal, moored along both quays (bridges at z 0…4 and 27…31)
  { id: 'imports-canoe-canal-1', model: 'canoe', at: [134.0, -18], yaw: 0, y: -0.85 },
  { id: 'imports-dinghy-canal-1', model: 'dinghy', at: [139.0, -6], yaw: Math.PI, y: -0.85 },
  { id: 'imports-canoe-canal-2', model: 'canoe', at: [139.1, 14], yaw: Math.PI, y: -0.85 },
  { id: 'imports-dinghy-canal-2', model: 'dinghy', at: [134.1, 40], yaw: 0, y: -0.85 },
  { id: 'imports-canoe-canal-3', model: 'canoe', at: [134.0, 46.5], yaw: 0, y: -0.85 },
];
/** Bicycles leaning (roll) on their stand by the café, the canal quays, the old-town plaza and the harbour boardwalk. */
export const BIKES: readonly Parked[] = [
  { id: 'imports-bike-cafe-1', model: 'bicycle', at: [104.9, 23.2], yaw: 0, roll: .12 },
  { id: 'imports-bike-cafe-2', model: 'bicycle-square', at: [104.9, 24.4], yaw: Math.PI, roll: -.12 },
  { id: 'imports-bike-quay-1', model: 'bicycle', at: [129.6, -12.5], yaw: .05, roll: .12 },
  { id: 'imports-bike-quay-2', model: 'bicycle-square', at: [144.8, 20.5], yaw: Math.PI, roll: .12 },
  { id: 'imports-bike-quay-3', model: 'bicycle', at: [144.8, 21.6], yaw: Math.PI, roll: .12 },
  { id: 'imports-bike-oldtown-1', model: 'bicycle', at: [118.5, 89.6], yaw: Math.PI / 2, roll: .12 },
  { id: 'imports-bike-boardwalk-1', model: 'bicycle-square', at: [-21.5, 137.2], yaw: Math.PI / 2, y: .55, roll: .12 },
  { id: 'imports-bike-boardwalk-2', model: 'bicycle', at: [26.0, 137.2], yaw: Math.PI / 2, y: .55, roll: .12 },
];
export function createEdenBoatsBikes(ground: (x: number, z: number) => number | null, boats: readonly Parked[] = BOATS, bikes: readonly Parked[] = BIKES) {
  const group = new THREE.Group(); group.name = 'Eden boats and bikes (scenery only)';
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .7, metalness: .05 }); mat.name = 'Eden boats and bikes';
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat); mesh.name = 'boats and bikes'; mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
  let closed = false, triangles = 0;
  loadPack('eden-boats-bikes.glb').then((gltf) => {
    if (closed) return;
    const soup = new PackSoup(), geos = new Map<string, THREE.BufferGeometry | null>();
    const geo = (n: string) => { if (!geos.has(n)) geos.set(n, modelGeometry(gltf, n)); return geos.get(n)!; };
    for (const p of [...boats, ...bikes]) { const g = geo(p.model),y=decorationGround(ground,p.at[0],p.at[1],p.y);if(!g||y===null)continue;soup.add(g,[p.at[0],y,p.at[1]],p.yaw,1,undefined,p.tilt??0,p.roll??0); }
    for (const g of geos.values()) g?.dispose();
    mesh.geometry.dispose(); mesh.geometry = soup.geometry(); triangles = soup.triangles;
  }).catch((e) => console.warn('Eden boats and bikes unavailable', e));
  return { group, stats: () => ({ boatBikeTriangles: triangles }), dispose() { if (closed) return; closed = true; group.removeFromParent(); mesh.geometry.dispose(); mat.dispose(); } };
}
