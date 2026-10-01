import * as THREE from 'three';

/** Explicit first-person access semantics; never inferred from a name or layer. */
export interface SteppedAccessMetadata {
  kind: 'stepped-access';
  id: string;
  axis: [number, number]; // local horizontal direction of ascent
  maxRise: number; // actual world support difference, metres
  maxDrop: number;
  maxGap: number;
  profile?: 'authored-rectangle'; // measured Float32 CAD corners, explicit axis basis
}
export interface SteppedAccess {
  id: string;
  axis: THREE.Vector3;
  maxRise: number;
  maxDrop: number;
  maxGap: number;
  start: number;
  end: number;
  top: number;
  precision: number;
  entry: boolean;
}
// Only the exact authored landing adapter registers an entry after checking its
// source identity and full positions/index signature. This is not a polygon profile.
const entries = new WeakMap<THREE.Mesh, () => boolean>();
export function registerSteppedEntry(mesh: THREE.Mesh, verify: () => boolean) { entries.set(mesh, verify); }

/** Deliberately bounded profile: six complete outward box faces, two triangles each.
 * Loaded CAD BufferGeometry can qualify; hollow/tessellated/irregular meshes cannot.
 */
export function rectangularSupport(geometry: THREE.BufferGeometry, axis = new THREE.Vector3(1, 0, 0), precision = 1e-6) {
  const positions = geometry.getAttribute('position'), index = geometry.index;
  if (!positions || !index || index.count !== 36) return false;
  const across = new THREE.Vector3(-axis.z, 0, axis.x);
  const points = Array.from({ length: positions.count }, (_, i) => {
    const p = new THREE.Vector3().fromBufferAttribute(positions, i);
    return new THREE.Vector3(p.dot(axis), p.y, p.dot(across));
  });
  const bounds = new THREE.Box3().setFromPoints(points);
  if (bounds.isEmpty()) return false;
  const size = bounds.getSize(new THREE.Vector3());
  if (!size.toArray().every(v => Number.isFinite(v) && v > 1e-6)) return false;
  const corners: number[] = [];
  for (let i = 0; i < positions.count; i++) {
    const p = points[i];
    let corner = 0;
    for (const [bit, axis] of ['x', 'y', 'z'].entries()) {
      const at = axis as 'x' | 'y' | 'z';
      if (Math.abs(p[at] - bounds.min[at]) <= precision) continue;
      if (Math.abs(p[at] - bounds.max[at]) > precision) return false;
      corner |= 1 << bit;
    }
    corners.push(corner);
  }
  const faces = new Map<number, number[][]>();
  for (let i = 0; i < index.count; i += 3) {
    const ids = [0, 1, 2].map(k => index.getX(i + k));
    const triangle = ids.map(id => corners[id]);
    if (new Set(triangle).size !== 3 || triangle.some(v => v === undefined)) return false;
    const constant = [0, 1, 2].filter(bit => triangle.every(v => (v & (1 << bit)) === (triangle[0] & (1 << bit))));
    if (constant.length !== 1) return false;
    const bit = constant[0], side = (triangle[0] >> bit) & 1;
    const trianglePoints = ids.map(id => points[id]);
    const normal = trianglePoints[1].clone().sub(trianglePoints[0]).cross(trianglePoints[2].clone().sub(trianglePoints[0]));
    if (normal.getComponent(bit) * (side ? 1 : -1) <= 0) return false;
    const key = bit * 2 + side;
    if (!faces.has(key)) faces.set(key, []);
    faces.get(key)!.push(triangle);
  }
  if (faces.size !== 6) return false;
  for (const triangles of faces.values()) {
    if (triangles.length !== 2 || new Set(triangles.flat()).size !== 4) return false;
    const shared = triangles[0].filter(c => triangles[1].includes(c));
    // The shared edge must be the rectangle diagonal, not an overlapping edge.
    if (shared.length !== 2 || [1, 2, 4].filter(bit => (shared[0] & bit) !== (shared[1] & bit)).length !== 2) return false;
  }
  return true;
}
export function steppedAccess(mesh: THREE.Mesh): SteppedAccess | undefined {
  const value: unknown = mesh.userData.walkTraversal;
  if (!value || typeof value !== 'object') return;
  const data = value as Partial<SteppedAccessMetadata>;
  if (data.kind !== 'stepped-access' || typeof data.id !== 'string' || !data.id.trim() ||
      !Array.isArray(data.axis) || data.axis.length !== 2 || !data.axis.every(Number.isFinite) ||
      ![data.maxRise, data.maxDrop].every(v => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 0.65) ||
      typeof data.maxGap !== 'number' || !Number.isFinite(data.maxGap) || data.maxGap < 0 || data.maxGap > 0.04) return;
  if (data.profile !== undefined && data.profile !== 'authored-rectangle') return;
  const axis = new THREE.Vector3(data.axis[0], 0, data.axis[1]);
  if (axis.lengthSq() < 1e-12) return;
  axis.normalize();
  const precision = data.profile === 'authored-rectangle' ? 2e-6 : 1e-6;
  const entry = entries.get(mesh)?.() === true;
  if (!entry && !rectangularSupport(mesh.geometry, data.profile ? axis : undefined, precision)) return;
  const normal = new THREE.Vector3(0, 1, 0).transformDirection(mesh.matrixWorld);
  if (normal.y < 0.999999) return;
  axis.transformDirection(mesh.matrixWorld);
  if (Math.abs(axis.y) > 1e-6) return; // bounded horizontal rectangular supports only
  axis.y = 0; axis.normalize();
  const positions = mesh.geometry.getAttribute('position');
  let start = Infinity, end = -Infinity, top = -Infinity;
  for (let i = 0; i < positions.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
    start = Math.min(start, p.dot(axis)); end = Math.max(end, p.dot(axis)); top = Math.max(top, p.y);
  }
  if (![start, end, top].every(Number.isFinite) || end <= start) return;
  return { id: data.id, axis, maxRise: data.maxRise!, maxDrop: data.maxDrop!, maxGap: data.maxGap, start, end, top, precision, entry };
}
