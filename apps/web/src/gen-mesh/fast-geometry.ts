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
  if (!attr.normalized) return a instanceof Float32Array || a instanceof Float64Array || a instanceof Int8Array || a instanceof Uint8Array || a instanceof Int16Array || a instanceof Uint16Array || a instanceof Int32Array || a instanceof Uint32Array ? { ...lay, d: 0, signed: false } : null;
  if (a instanceof Float32Array) return { ...lay, d: 0, signed: false };
  if (a instanceof Uint32Array) return { ...lay, d: 4294967295.0, signed: false };
  if (a instanceof Uint16Array) return { ...lay, d: 65535.0, signed: false };
  if (a instanceof Uint8Array) return { ...lay, d: 255.0, signed: false };
  if (a instanceof Int32Array) return { ...lay, d: 2147483647.0, signed: true };
  if (a instanceof Int16Array) return { ...lay, d: 32767.0, signed: true };
  if (a instanceof Int8Array) return { ...lay, d: 127.0, signed: true };
  return null;
}
/** Component c of vertex i, exactly as getX/getY/getZ/getW return it. */
const comp = (p: Plain, i: number, c: number) => { const v = p.a[i * p.st + p.o + c]; return p.d === 0 ? v : p.signed ? Math.max(v / p.d, -1.0) : v / p.d; };

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
