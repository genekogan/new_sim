// Phone arrival (lane d3): the per-vertex loops that prepare every loaded GLB (static-merge, shadow-proxy, model bounds)
// ran through three's Vector3.fromBufferAttribute + applyMatrix4 / Box3.setFromObject(precise), a few calls and a
// temporary array per vertex: ~1.5 s of a phone's (4x throttled) main thread before the Mars arrival card could close.
// These loops read the typed arrays directly and do exactly the same double arithmetic in the same order as three
// (BufferAttribute.getX + MathUtils.denormalize, Vector3.applyMatrix4 / applyMatrix3 / normalize, Box3.expandByPoint),
// so every output float is bit-identical. Anything they do not cover (half-float, skinned, morphed, instanced)
// returns false / null and the caller keeps three's path.
import * as THREE from 'three';

// st = stride, o = offset in array elements: component c of vertex i is a[i * st + o + c] (BufferAttribute: st = itemSize,
// o = 0; InterleavedBufferAttribute: the buffer's stride and the attribute's offset, as their getX..getW read it)
type Plain = { a: ArrayLike<number>; st: number; o: number; s: number; d: number; signed: boolean };
/** A BufferAttribute's (or interleaved attribute's) array, layout and denormalisation (three's MathUtils.denormalize). */
function plain(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined): Plain | null {
  if (!attr || (attr as unknown as { isFloat16BufferAttribute?: boolean }).isFloat16BufferAttribute) return null;
  const inter = (attr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute === true;
  const a = inter ? (attr as THREE.InterleavedBufferAttribute).data.array : (attr as THREE.BufferAttribute).array, s = attr.itemSize;
  const st = inter ? (attr as THREE.InterleavedBufferAttribute).data.stride : s, o = inter ? (attr as THREE.InterleavedBufferAttribute).offset : 0;
  const lay = { a, st, o, s };
  let p: Plain | null = null;
  if (!attr.normalized) p = a instanceof Float32Array || a instanceof Float64Array || a instanceof Int8Array || a instanceof Uint8Array || a instanceof Int16Array || a instanceof Uint16Array || a instanceof Int32Array || a instanceof Uint32Array ? { ...lay, d: 0, signed: false } : null;
  else if (a instanceof Float32Array) p = { ...lay, d: 0, signed: false };
  else if (a instanceof Uint32Array) p = { ...lay, d: 4294967295.0, signed: false };
  else if (a instanceof Uint16Array) p = { ...lay, d: 65535.0, signed: false };
  else if (a instanceof Uint8Array) p = { ...lay, d: 255.0, signed: false };
  else if (a instanceof Int32Array) p = { ...lay, d: 2147483647.0, signed: true };
  else if (a instanceof Int16Array) p = { ...lay, d: 32767.0, signed: true };
  else if (a instanceof Int8Array) p = { ...lay, d: 127.0, signed: true };
  if (!p || (a instanceof Float32Array && p.d === 0)) return p;
  // Phone arrival round 2 (lane L3): any other layout (meshopt's quantised Int16/Uint16/Int8 attributes, normalised or
  // not) is decoded once into doubles — the exact values getX..getW return — so the loops below read one or two array
  // kinds instead of every kind through one accessor (a megamorphic element load per component).
  const n = attr.count, out = new Float64Array(n * s), d = p.d, sg = p.signed;
  for (let i = 0; i < n; i++) for (let c = 0; c < s; c++) { const v = a[i * st + o + c]; out[i * s + c] = d === 0 ? v : sg ? Math.max(v / d, -1.0) : v / d; }
  return { a: out, st: s, o: 0, s, d: 0, signed: false };
}
/** Component c of vertex i, exactly as getX/getY/getZ/getW return it (plain() leaves only undenormalised doubles/floats). */
const comp = (p: Plain, i: number, c: number) => p.a[i * p.st + p.o + c];

/** dst[off + 3i ..] = position i transformed by `m` (Vector3.fromBufferAttribute(attr, i).applyMatrix4(m)). */
export function transformPoints(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, m: THREE.Matrix4, dst: Float32Array, off: number): boolean {
  const p = plain(attr); if (!p || p.s < 3) return false;
  const e = m.elements, n = attr.count;
  for (let i = 0; i < n; i++) {
    const x = comp(p, i, 0), y = comp(p, i, 1), z = comp(p, i, 2);
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    const o = off + i * 3;
    dst[o] = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    dst[o + 1] = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
    dst[o + 2] = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
  }
  return true;
}

/** dst[off + 3i ..] = normal i by the normal matrix, normalised (fromBufferAttribute(attr, i).applyMatrix3(nm).normalize()). */
export function transformNormals(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, nm: THREE.Matrix3, dst: Float32Array, off: number): boolean {
  const p = plain(attr); if (!p || p.s < 3) return false;
  const e = nm.elements, n = attr.count;
  for (let i = 0; i < n; i++) {
    const x0 = comp(p, i, 0), y0 = comp(p, i, 1), z0 = comp(p, i, 2);
    const x = e[0] * x0 + e[3] * y0 + e[6] * z0, y = e[1] * x0 + e[4] * y0 + e[7] * z0, z = e[2] * x0 + e[5] * y0 + e[8] * z0;
    const k = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    const o = off + i * 3;
    dst[o] = x * k; dst[o + 1] = y * k; dst[o + 2] = z * k;
  }
  return true;
}

/** Up to 4 components of each vertex of `attr` (getX..getW) into dst with stride `size`, from vertex offset `vo`. */
export function copyComponents(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, size: number, dst: Float32Array, vo: number): boolean {
  const p = plain(attr); if (!p || p.s < size) return false;
  const n = attr.count;
  for (let i = 0; i < n; i++) for (let c = 0; c < size; c++) dst[(vo + i) * size + c] = comp(p, i, c);
  return true;
}

/** Linear base colour times an optional vertex colour (Color.copy(base); r *= vc.getX(i) ...), into dst from vertex `vo`. */
export function bakeColors(base: THREE.Color, vc: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined, n: number, dst: Float32Array, vo: number): boolean {
  const p = vc ? plain(vc) : null; if (vc && (!p || p.s < 3)) return false;
  for (let i = 0; i < n; i++) {
    let r = base.r, g = base.g, b = base.b;
    if (p) { r *= comp(p, i, 0); g *= comp(p, i, 1); b *= comp(p, i, 2); }
    const o = (vo + i) * 3; dst[o] = r; dst[o + 1] = g; dst[o + 2] = b;
  }
  return true;
}

/** Box3.setFromObject(root, true), or null when some geometry needs three's own path (skinned, morphed, instanced, not a mesh). */
export function preciseBounds(root: THREE.Object3D): THREE.Box3 | null {
  const items: { o: THREE.Mesh; p: Plain }[] = [];
  let ok = true;
  root.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined; if (!ok || g === undefined) return;
    const m = o as THREE.Mesh, pos = g.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || (m as THREE.InstancedMesh).isInstancedMesh || !pos || (g.morphAttributes.position && m.morphTargetInfluences)) { ok = false; return; }
    const p = plain(pos); if (!p || p.s < 3) { ok = false; return; }
    items.push({ o: m, p });
  });
  if (!ok) return null;
  const box = new THREE.Box3();   // empty
  let x0 = box.min.x, y0 = box.min.y, z0 = box.min.z, x1 = box.max.x, y1 = box.max.y, z1 = box.max.z;
  // expandByObject: each object updates its own world matrix (parents first: traverse order), then its vertices
  root.traverse((o) => { o.updateWorldMatrix(false, false); });
  for (const { o, p } of items) {
    const e = o.matrixWorld.elements, n = (o.geometry.getAttribute('position') as THREE.BufferAttribute).count;
    for (let i = 0; i < n; i++) {
      const x = comp(p, i, 0), y = comp(p, i, 1), z = comp(p, i, 2);
      const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
      const X = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w, Y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w, Z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
      x0 = Math.min(x0, X); y0 = Math.min(y0, Y); z0 = Math.min(z0, Z); x1 = Math.max(x1, X); y1 = Math.max(y1, Y); z1 = Math.max(z1, Z);
    }
  }
  box.min.set(x0, y0, z0); box.max.set(x1, y1, z1);
  return box;
}

/** BufferGeometry.computeVertexNormals() for an indexed geometry with a plain position attribute: the same per-triangle
 *  cross products accumulated through the Float32 normal array in the same order (each corner read before any is
 *  written, as three does), then normalised. Returns false (nothing changed) for anything else. */
export function computeVertexNormals(g: THREE.BufferGeometry): boolean {
  const pos = g.getAttribute('position') as THREE.BufferAttribute | undefined, index = g.index;
  const p = plain(pos); if (!p || p.s < 3 || !pos || !index || index.normalized || (index as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) return false;
  let na = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (na && na.count === pos.count && (na.normalized || (na as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute || !(na.array instanceof Float32Array) || na.itemSize !== 3)) return false;
  if (!na || na.count !== pos.count) { na = new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3); g.setAttribute('normal', na); }
  else na.array.fill(0);
  const n = na.array as Float32Array, ia = index.array;
  for (let i = 0, il = index.count; i < il; i += 3) {
    const vA = ia[i], vB = ia[i + 1], vC = ia[i + 2];
    const ax = comp(p, vA, 0), ay = comp(p, vA, 1), az = comp(p, vA, 2), bx = comp(p, vB, 0), by = comp(p, vB, 1), bz = comp(p, vB, 2), cx = comp(p, vC, 0), cy = comp(p, vC, 1), cz = comp(p, vC, 2);
    const cbx = cx - bx, cby = cy - by, cbz = cz - bz, abx = ax - bx, aby = ay - by, abz = az - bz;
    const x = cby * abz - cbz * aby, y = cbz * abx - cbx * abz, z = cbx * aby - cby * abx;
    const a0 = n[vA * 3] + x, a1 = n[vA * 3 + 1] + y, a2 = n[vA * 3 + 2] + z;
    const b0 = n[vB * 3] + x, b1 = n[vB * 3 + 1] + y, b2 = n[vB * 3 + 2] + z;
    const c0 = n[vC * 3] + x, c1 = n[vC * 3 + 1] + y, c2 = n[vC * 3 + 2] + z;
    n[vA * 3] = a0; n[vA * 3 + 1] = a1; n[vA * 3 + 2] = a2;
    n[vB * 3] = b0; n[vB * 3 + 1] = b1; n[vB * 3 + 2] = b2;
    n[vC * 3] = c0; n[vC * 3 + 1] = c1; n[vC * 3 + 2] = c2;
  }
  for (let i = 0, il = na.count; i < il; i++) {
    const x = n[i * 3], y = n[i * 3 + 1], z = n[i * 3 + 2], k = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    n[i * 3] = x * k; n[i * 3 + 1] = y * k; n[i * 3 + 2] = z * k;
  }
  na.needsUpdate = true;
  return true;
}

/** computeBoundingBox() then computeBoundingSphere() for a geometry with a plain position and no morph targets: the same
 *  box (expandByPoint over every vertex), centre ((min + max) * 0.5) and radius (sqrt of the largest squared distance).
 *  Returns false (nothing set) otherwise, or when a coordinate is NaN (three's own calls then log it). */
export function computeBounds(g: THREE.BufferGeometry): boolean {
  const pos = g.getAttribute('position') as THREE.BufferAttribute | undefined, p = plain(pos);
  if (!p || p.s < 3 || !pos || g.morphAttributes.position || (pos as unknown as { isGLBufferAttribute?: boolean }).isGLBufferAttribute) return false;
  const n = pos.count;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) { const x = comp(p, i, 0), y = comp(p, i, 1), z = comp(p, i, 2); x0 = Math.min(x0, x); y0 = Math.min(y0, y); z0 = Math.min(z0, z); x1 = Math.max(x1, x); y1 = Math.max(y1, y); z1 = Math.max(z1, z); }
  if ([x0, y0, z0, x1, y1, z1].some(Number.isNaN)) return false;
  const empty = x1 < x0 || y1 < y0 || z1 < z0, cx = empty ? 0 : (x0 + x1) * 0.5, cy = empty ? 0 : (y0 + y1) * 0.5, cz = empty ? 0 : (z0 + z1) * 0.5;
  let r2 = 0;
  for (let i = 0; i < n; i++) { const dx = cx - comp(p, i, 0), dy = cy - comp(p, i, 1), dz = cz - comp(p, i, 2); r2 = Math.max(r2, dx * dx + dy * dy + dz * dz); }
  (g.boundingBox ??= new THREE.Box3()).min.set(x0, y0, z0); g.boundingBox.max.set(x1, y1, z1);
  (g.boundingSphere ??= new THREE.Sphere()).center.set(cx, cy, cz); g.boundingSphere.radius = Math.sqrt(r2);
  return true;
}
