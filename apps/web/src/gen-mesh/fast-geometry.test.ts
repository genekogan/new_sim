// fast-geometry.ts must give bit-identical floats to three's per-vertex path it replaces.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bakeColors, copyComponents, preciseBounds, transformNormals, transformPoints } from './fast-geometry.ts';

let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const matrices = () => [
  new THREE.Matrix4().compose(new THREE.Vector3(3.1, -2, 7.25), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 1.1, -0.7)), new THREE.Vector3(1.7, 0.3, 2.2)),
  new THREE.Matrix4().compose(new THREE.Vector3(-0.5, 0.01, 1e3), new THREE.Quaternion(), new THREE.Vector3(-1, 1, 1)),   // mirrored
  new THREE.Matrix4().makePerspective(-1, 1, 1, -1, 0.5, 50),                                                              // w != 1
];
const attrs = (n: number) => {
  const f = new Float32Array(n * 3).map(() => (rnd() - 0.5) * 40);
  const i16 = new Int16Array(n * 3).map(() => Math.round((rnd() - 0.5) * 65534));
  const u8 = new Uint8Array(n * 4).map(() => Math.floor(rnd() * 256));
  const i8 = new Int8Array(n * 3).map(() => Math.round((rnd() - 0.5) * 255));
  i16[0] = -32768; i8[0] = -128;
  // gltfpack/meshopt GLBs: interleaved, quantized (normalized int16 xyz + pad, stride 4) and a float stride-8 buffer
  const ib16 = new THREE.InterleavedBuffer(new Int16Array(n * 4).map(() => Math.round((rnd() - 0.5) * 65534)), 4);
  const ibf = new THREE.InterleavedBuffer(new Float32Array(n * 8).map(() => (rnd() - 0.5) * 9), 8);
  return [new THREE.InterleavedBufferAttribute(ib16, 3, 0, true), new THREE.InterleavedBufferAttribute(ibf, 3, 0), new THREE.InterleavedBufferAttribute(ibf, 4, 4), new THREE.BufferAttribute(f, 3), new THREE.BufferAttribute(i16, 3, true), new THREE.BufferAttribute(new Uint16Array(n * 3).map(() => Math.floor(rnd() * 65536)), 3, true), new THREE.BufferAttribute(u8, 4, true), new THREE.BufferAttribute(i8, 3, true), new THREE.BufferAttribute(i16, 3, false)];
};
const same = (a: Float32Array, b: Float32Array) => { assert.equal(a.length, b.length); for (let i = 0; i < a.length; i++) assert.ok(Object.is(a[i], b[i]), `index ${i}: ${a[i]} vs ${b[i]}`); };

test('points and normals transform bit-identically to fromBufferAttribute + applyMatrix4/applyMatrix3+normalize', () => {
  const n = 257, v = new THREE.Vector3();
  for (const attr of attrs(n)) for (const m of matrices()) {
    const fast = new Float32Array(n * 3 + 6), slow = new Float32Array(n * 3 + 6);
    assert.equal(transformPoints(attr, m, fast, 6), true);
    for (let i = 0; i < n; i++) { v.fromBufferAttribute(attr, i).applyMatrix4(m); slow.set([v.x, v.y, v.z], 6 + i * 3); }
    same(fast, slow);
    const nm = new THREE.Matrix3().getNormalMatrix(m), fn = new Float32Array(n * 3), sn = new Float32Array(n * 3);
    assert.equal(transformNormals(attr, nm, fn, 0), true);
    for (let i = 0; i < n; i++) { v.fromBufferAttribute(attr, i).applyMatrix3(nm).normalize(); sn.set([v.x, v.y, v.z], i * 3); }
    same(fn, sn);
  }
  // a zero normal stays zero (normalize divides by 1)
  const z = new Float32Array(3); transformNormals(new THREE.BufferAttribute(new Float32Array(3), 3), new THREE.Matrix3(), z, 0); same(z, new Float32Array(3));
});

test('components and baked colours match getX..getW and Color multiply', () => {
  const n = 101;
  for (const attr of attrs(n)) for (const size of [1, 2, 3, attr.itemSize]) {
    if (size > attr.itemSize) continue;
    const fast = new Float32Array((n + 2) * size), slow = new Float32Array((n + 2) * size);
    assert.equal(copyComponents(attr, size, fast, 2), true);
    for (let i = 0; i < n; i++) { const o = (2 + i) * size; slow[o] = attr.getX(i); if (size > 1) slow[o + 1] = attr.getY(i); if (size > 2) slow[o + 2] = attr.getZ(i); if (size > 3) slow[o + 3] = attr.getW(i); }
    same(fast, slow);
  }
  const base = new THREE.Color(0.31, 0.77, 0.052), col = new THREE.Color();
  for (const vc of [undefined, ...attrs(n).filter((a) => a.itemSize >= 3)]) {
    const fast = new Float32Array(n * 3), slow = new Float32Array(n * 3);
    assert.equal(bakeColors(base, vc, n, fast, 0), true);
    for (let i = 0; i < n; i++) { col.copy(base); if (vc) { col.r *= vc.getX(i); col.g *= vc.getY(i); col.b *= vc.getZ(i); } slow.set([col.r, col.g, col.b], i * 3); }
    same(fast, slow);
  }
});

test('preciseBounds equals Box3.setFromObject(root, true); unsupported geometry returns null', () => {
  const root = new THREE.Group(); root.position.set(1, 2, 3); root.rotation.set(0.2, 0.4, 0.1);
  const [inter16, , , f, i16] = attrs(64);
  const a = new THREE.BufferGeometry(); a.setAttribute('position', f);
  const b = new THREE.BufferGeometry(); b.setAttribute('position', i16);
  const c = new THREE.BufferGeometry(); c.setAttribute('position', inter16);
  const m1 = new THREE.Mesh(a), m2 = new THREE.Mesh(b), m3 = new THREE.Mesh(c), inner = new THREE.Group();
  m1.position.set(-4, 0.5, 9); m1.scale.set(1, -2, 1); m3.scale.setScalar(80); inner.rotation.y = 2.1; inner.add(m2, m3); root.add(m1, inner, new THREE.Group());
  const fast = preciseBounds(root)!, slow = new THREE.Box3().setFromObject(root, true);
  for (const k of ['min', 'max'] as const) for (const c of ['x', 'y', 'z'] as const) assert.ok(Object.is(fast[k][c], slow[k][c]), `${k}.${c}`);
  assert.ok(preciseBounds(new THREE.Group())!.isEmpty());
  const half = new THREE.BufferGeometry(); half.setAttribute('position', new THREE.Float16BufferAttribute(new Uint16Array(9), 3));
  root.add(new THREE.Mesh(half)); assert.equal(preciseBounds(root), null);
  assert.equal(transformPoints(half.attributes.position, new THREE.Matrix4(), new Float32Array(9), 0), false);
  const skinned = new THREE.Group(); skinned.add(new THREE.SkinnedMesh(a)); assert.equal(preciseBounds(skinned), null);
});

test('computeVertexNormals equals three for an indexed grid, shared and degenerate triangles, and an existing normal', async () => {
  const { computeVertexNormals } = await import('./fast-geometry.ts');
  const make = () => { seed = 99;
    const g = new THREE.BufferGeometry(), nx = 17, nz = 13, pos = new Float32Array((nx + 1) * (nz + 1) * 3), idx: number[] = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const k = (j * (nx + 1) + i) * 3; pos[k] = i * 2.5 - 9; pos[k + 1] = Math.sin(i * 0.7) * Math.cos(j * 1.3) * 3 + rnd() * 0.01; pos[k + 2] = j * 2.5 + 1e3; }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    idx.push(5, 5, 9, 7, 7, 7, 0, 200, 2);   // degenerate corners: three reads all three before writing
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); return g;
  };
  const a = make(), b = make();
  assert.equal(computeVertexNormals(a), true); b.computeVertexNormals();
  same(a.attributes.normal.array as Float32Array, b.attributes.normal.array as Float32Array);
  // again with the normals already present (reset to zero first)
  assert.equal(computeVertexNormals(a), true); b.computeVertexNormals();
  same(a.attributes.normal.array as Float32Array, b.attributes.normal.array as Float32Array);
  const soup = new THREE.BufferGeometry(); soup.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  assert.equal(computeVertexNormals(soup), false);   // non-indexed: three's own path
});
