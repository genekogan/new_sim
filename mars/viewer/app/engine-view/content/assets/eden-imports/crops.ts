import * as THREE from 'three';
import {hash01,loadPack,modelGeometry,PackSoup,decorationGround} from './assets.ts';
/** Crops growing in Eden's garden beds (Quaternius Ultimate Crops, CC0; scenery only, no food or stock truth). Each bed
 * grows one crop at a time through its four growth stages, is harvested and replanted with another crop; the cycle runs
 * on the Eden clock (one world day per real hour, UTC), so every viewer sees the same stage. Winter beds rest (only
 * hardy crops). All crops are one merged vertex-coloured mesh (one draw), rebuilt only when a stage changes. */
export type Bed = { id: string; c: [number, number]; size: [number, number]; yaw?: number; top?: number; crops?: readonly string[] };
const DEFAULT_CROPS = ['carrot', 'lettuce', 'tomato', 'corn', 'pumpkin', 'beet', 'wheat', 'watermelon', 'berries', 'flowers'] as const;
/** Plant spacing (m) per crop: big plants stand further apart. */
const SPACING: Record<string, number> = { carrot: .45, lettuce: .75, beet: .45, wheat: .32, tomato: .8, corn: .7, pumpkin: 1.4, watermelon: 1.4, berries: 1.0, flowers: .5 };
const HARDY = new Set(['lettuce', 'beet', 'carrot']);
/** Eden beds (world metres). The eden-gardens cultivated plots are 6 × 2.6 m soil boxes 0.12 m high (landscape.mjs). */
export const BEDS: readonly Bed[] = Array.from([44, 48].flatMap((z) => [37, 45, 64, 72].map((x): Bed => ({ id: `garden-${x}-${z}`, c: [x, z], size: [5.6, 2.2], top: 0.12 }))));
export const WORLD_DAY_MS = 3600_000; // Eden: one world day per real hour
const CYCLE_DAYS = 4;
/** Growth stage of a bed at time `ms` (UTC): its crop and stage 0 (bare soil) … 4 (ripe), 5 (harvested). */
export function bedStage(bed: Bed, ms: number): { crop: string; stage: number } {
  const days = ms / WORLD_DAY_MS + hash01(bed.id, 1) * CYCLE_DAYS, cycle = Math.floor(days / CYCLE_DAYS), u = days / CYCLE_DAYS - cycle;
  const list = bed.crops ?? DEFAULT_CROPS;
  let crop = list[Math.floor(hash01(bed.id, 100 + cycle) * list.length)];
  // world season from the day of the (365-world-day) year: winter beds grow only hardy crops
  const doy = Math.floor(ms / WORLD_DAY_MS) % 365, winter = doy < 59 || doy >= 335;
  if (winter && !HARDY.has(crop)) crop = [...HARDY][Math.floor(hash01(bed.id, 200 + cycle) * HARDY.size)];
  const stage = u < 0.1 ? 0 : u < 0.3 ? 1 : u < 0.5 ? 2 : u < 0.7 ? 3 : u < 0.93 ? 4 : 5;
  return { crop, stage };
}
const MODEL: Record<string, string> = { carrot: 'Carrot', lettuce: 'Lettuce', tomato: 'Tomato', corn: 'Corn', pumpkin: 'Pumpkin', beet: 'Beet', wheat: 'Wheat', watermelon: 'Watermelon', berries: 'BushBerries', flowers: 'Flower' };
const modelName = (crop: string, stage: number) => stage >= 1 && stage <= 4 ? `crop-${crop}-${stage}` : stage === 5 ? `crop-${crop}-harvested` : null;

export function createEdenCrops(ground: (x: number, z: number) => number | null, beds: readonly Bed[] = BEDS) {
  const group = new THREE.Group(); group.name = 'Eden crops (garden beds, scenery only)';
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .85, metalness: 0 }); mat.name = 'Eden crops';
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat); mesh.name = 'crops: all beds'; mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
  let gltf: Awaited<ReturnType<typeof loadPack>> | null = null, key = '', closed = false, triangles = 0;
  const geos = new Map<string, THREE.BufferGeometry | null>();
  const geo = (name: string) => { if (!gltf) return null; if (!geos.has(name)) geos.set(name, modelGeometry(gltf, name)); return geos.get(name)!; };
  function rebuild(ms: number) {
    if (!gltf) return;
    const st = beds.map((b) => bedStage(b, ms)), k = st.map((s) => s.crop + s.stage).join('|');
    if (k === key) return; key = k;
    const soup = new PackSoup();
    beds.forEach((b, i) => {
      const { crop, stage } = st[i], name = modelName(crop, stage), g = name ? geo(name) : null;
      if (!g) return;
      const sp = SPACING[crop] ?? .6, yaw = b.yaw ?? 0, c = Math.cos(yaw), s = Math.sin(yaw);
      const nx = Math.max(1, Math.floor(b.size[0] / sp)), nz = Math.max(1, Math.floor(b.size[1] / sp));
      for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
        const id = `${b.id}:${ix}:${iz}`, jx = (hash01(id, 3) - .5) * sp * .25, jz = (hash01(id, 4) - .5) * sp * .25;
        const lx = (ix + .5) * b.size[0] / nx - b.size[0] / 2 + jx, lz = (iz + .5) * b.size[1] / nz - b.size[1] / 2 + jz;
        const x = b.c[0] + lx * c + lz * s, z = b.c[1] - lx * s + lz * c;
        const y=decorationGround(ground,x,z);if(y===null)continue;
        soup.add(g, [x,y+(b.top??0),z],hash01(id,5)*Math.PI*2,.85+.3*hash01(id,6));
      }
    });
    mesh.geometry.dispose(); mesh.geometry = soup.empty ? new THREE.BufferGeometry() : soup.geometry(); triangles = soup.triangles;
  }
  const timer = setInterval(() => { if (!closed) rebuild(Date.now()); }, 10_000);
  loadPack('eden-crops.glb').then((g) => { if (closed) return; gltf = g; rebuild(Date.now()); }).catch((e) => console.warn('Eden crops unavailable', e));
  return {
    group, stages: (ms = Date.now()) => beds.map((b) => ({ id: b.id, ...bedStage(b, ms) })),
    stats: () => ({ draws: 1, triangles }),
    dispose() { if (closed) return; closed = true; clearInterval(timer); group.removeFromParent(); mesh.geometry.dispose(); mat.dispose(); for (const g of geos.values()) g?.dispose(); },
  };
}
export const CROP_MODELS = Object.entries(MODEL);
