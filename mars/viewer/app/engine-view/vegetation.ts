// Original procedural Eden vegetation. Geometry is depiction, never a support/contact.
import * as THREE from 'three';
import { ThreeResources } from '../../lib/three-resources.ts';
export const VEGETATION_KINDS = ['canopy-tree', 'conifer', 'shrub', 'grass', 'reeds', 'vine'] as const;
export type VegetationKind = typeof VEGETATION_KINDS[number];
export type VegetationPlacement = {
  id: string; kind: VegetationKind; p: [number, number, number];
  size: [number, number, number]; yaw?: number; seed?: number;
};
export type VegetationDetail = 'near' | 'far';
export const MAX_VEGETATION_PLACEMENTS = 512;
const colors = { bark: '#70533b', leaf: '#52734a', light: '#78945c', dark: '#365540', grass: '#82915c', reed: '#a39062', flower: '#c9ab77' };
type Color = keyof typeof colors;
type Shape = 'ball' | 'stem' | 'cone' | 'blade';
type Piece = { shape: Shape; color: Color; p: THREE.Vector3; s: THREE.Vector3; q: THREE.Quaternion };
const Y = new THREE.Vector3(0, 1, 0);
const valid3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n));
/** Strict bounded preview input. Not a W manifest/schema extension. */
export function validVegetation(p: VegetationPlacement): boolean {
  return !!p && typeof p.id === 'string' && p.id.length > 0 && p.id.length <= 96 &&
    VEGETATION_KINDS.includes(p.kind) && valid3(p.p) && p.p.every(n => Math.abs(n) <= 10000) &&
    valid3(p.size) && p.size.every(n => n > 0 && n <= 20) &&
    (p.yaw === undefined || Number.isFinite(p.yaw)) && (p.seed === undefined || Number.isSafeInteger(p.seed));
}
function random(seed: number) {
  let n = seed >>> 0;
  return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; };
}
function pieces(kind: VegetationKind, seed: number, detail: VegetationDetail): Piece[] {
  const out: Piece[] = [], rand = random(seed);
  const add = (shape: Shape, color: Color, p: number[], s: number[], q = new THREE.Quaternion()) =>
    out.push({ shape, color, p: new THREE.Vector3(...p), s: new THREE.Vector3(...s), q });
  // Shapes remain within local x/z ±0.5, y 0..1; roots at local base centre.
  if (kind === 'canopy-tree') {
    add('stem', 'bark', [0, .34, 0], [.045, .68, .045]);
    const n = detail === 'near' ? 7 : 3;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2, r = i === 0 ? 0 : .19;
      add('ball', i % 2 ? 'light' : 'leaf', [Math.cos(a) * r, .64 + rand() * .09, Math.sin(a) * r], [.28, .25, .28]);
    }
  } else if (kind === 'conifer') {
    add('stem', 'bark', [0, .25, 0], [.035, .5, .035]);
    for (let i = 0; i < 3; i++) add('cone', i % 2 ? 'leaf' : 'dark', [0, .4 + .19 * i, 0], [.45 - .12 * i, .43, .45 - .12 * i]);
  } else if (kind === 'shrub') {
    const n = detail === 'near' ? 5 : 2;
    for (let i = 0; i < n; i++) {
      const a = i * 2.4;
      add('ball', i % 2 ? 'leaf' : 'light', [Math.cos(a) * .15, .35 + rand() * .23, Math.sin(a) * .15], [.32, .34, .32]);
    }
  } else if (kind === 'vine') {
    add('stem', 'bark', [0, .5, 0], [.012, 1, .012]);
    const n = detail === 'near' ? 12 : 5;
    for (let i = 0; i < n; i++) {
      const a = i * 2.4;
      add('ball', i % 2 ? 'light' : 'leaf', [Math.cos(a) * .23, .10 + i / n * .8, Math.sin(a) * .08], [.19, .08, .06]);
    }
  } else {
    const n = detail === 'near' ? 12 : 4;
    for (let i = 0; i < n; i++) {
      const x = (rand() - .5) * .66, z = (rand() - .5) * .66;
      const h = .45 + rand() * .4, a = rand() * Math.PI * 2;
      if (kind === 'reeds') {
        add('stem', 'grass', [x, h / 2, z], [.008, h, .008]);
        add('stem', 'reed', [x, h + .055, z], [.022, .11, .022]);
      } else add('blade', i % 3 ? 'grass' : 'light', [x, 0, z], [.13, h, .13], new THREE.Quaternion().setFromAxisAngle(Y, a));
    }
  }
  return out;
}

/** Static batched library: at most one draw call per geometry/material pair.
 * Positions/heights are supplied explicitly; no ground guessing, auto scatter,
 * selection IDs, walking obstacles, wind clock or scene-wire mutation. */
export class VegetationViews {
  readonly group = new THREE.Group();
  readonly rejected: string[] = [];
  private readonly resources = new ThreeResources();
  private readonly instances: THREE.InstancedMesh[] = [];
  private closed = false;
  constructor(placements: readonly VegetationPlacement[], detail: VegetationDetail = 'near') {
    this.group.name = 'decorative vegetation preview';
    const batches = new Map<string, { shape: Shape; color: Color; matrices: THREE.Matrix4[] }>();
    const ids = new Set<string>();
    placements.forEach((p, i) => {
      if (i >= MAX_VEGETATION_PLACEMENTS || !validVegetation(p) || ids.has(p.id)) { this.rejected.push(p?.id ?? '(invalid)'); return; }
      ids.add(p.id);
      const root = new THREE.Matrix4().compose(new THREE.Vector3(...p.p), new THREE.Quaternion().setFromAxisAngle(Y, -(p.yaw ?? 0)), new THREE.Vector3(...p.size));
      for (const part of pieces(p.kind, p.seed ?? 1, detail)) {
        const key = part.shape + ':' + part.color;
        let batch = batches.get(key);
        if (!batch) { batch = { shape: part.shape, color: part.color, matrices: [] }; batches.set(key, batch); }
        batch.matrices.push(root.clone().multiply(new THREE.Matrix4().compose(part.p, part.q, part.s)));
      }
    });
    const geos = new Map<Shape, THREE.BufferGeometry>(), mats = new Map<string, THREE.MeshStandardMaterial>();
    for (const batch of batches.values()) {
      let geo = geos.get(batch.shape);
      if (!geo) {
        geo = batch.shape === 'ball' ? new THREE.IcosahedronGeometry(1, 0) : batch.shape === 'stem' ? new THREE.CylinderGeometry(1, 1, 1, 6) : batch.shape === 'cone' ? new THREE.ConeGeometry(1, 1, 7) : new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-.5, 0, 0, .5, 0, 0, 0, 1, .25], 3));
        geo.computeVertexNormals(); geos.set(batch.shape, geo);
      }
      const side = batch.shape === 'blade' ? THREE.DoubleSide : THREE.FrontSide, materialKey = batch.color + ':' + side;
      let mat = mats.get(materialKey);
      if (!mat) { mat = new THREE.MeshStandardMaterial({ color: colors[batch.color], roughness: 1, side }); mats.set(materialKey, mat); }
      const mesh = new THREE.InstancedMesh(geo, mat, batch.matrices.length);
      batch.matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingBox(); mesh.computeBoundingSphere();
      mesh.castShadow = batch.shape !== 'blade'; mesh.receiveShadow = true;
      mesh.name = 'vegetation:' + batch.shape + ':' + batch.color;
      this.instances.push(mesh); this.group.add(mesh);
    }
    this.resources.object(this.group);
  }
  dispose() {
    if (this.closed) return;
    this.closed = true; this.group.removeFromParent();
    this.instances.forEach(mesh => mesh.dispose()); this.resources.dispose(); this.group.clear();
  }
}
