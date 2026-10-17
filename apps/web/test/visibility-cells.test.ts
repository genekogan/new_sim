// Phone arrival (lane L3): WorldVisibilityInstances splits big meshes into triangle cells for camera rays. Its typed-array
// path must give the same cells (order, index lists, boxes) as the generic Vector3 path, and the same ray hits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldVisibilityInstances } from '../src/WorldVisibilityInstances.ts';

function terrainLike(n: number, indexed: boolean, seed: number) {
  let s = seed; const r = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const g = indexed ? new THREE.PlaneGeometry(80, 60, n, n) : new THREE.PlaneGeometry(80, 60, n, n).toNonIndexed();
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setZ(i, (r() - 0.5) * 6 + (i % 7 === 0 ? -0 : 0));
  g.rotateX(-Math.PI / 2); g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}
type Cells = { cells: { box: THREE.Box3; geometry: THREE.BufferGeometry }[] } | null;
const cellsOf = (v: WorldVisibilityInstances, m: THREE.Mesh) => (v as unknown as { cellsOf(m: THREE.Mesh): Cells }).cellsOf(m);
const dump = (c: Cells) => c && c.cells.map((x) => ({ box: [...x.box.min.toArray(), ...x.box.max.toArray()], index: Array.from(x.geometry.index!.array) }));

test('typed-array cells equal the Vector3 path (indexed, non-indexed, draw ranges) and rays hit the same', () => {
  for (const [n, indexed, seed] of [[40, true, 1], [37, false, 2], [64, true, 3]] as const) {
    const g = terrainLike(n, indexed, seed);
    if (seed === 3) g.setDrawRange(300, 9000);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.position.set(3, 1, -2); mesh.updateMatrixWorld(true);
    const fast = dump(cellsOf(new WorldVisibilityInstances(), mesh));
    // the same geometry behind an interleaved attribute takes the generic (pre-change) path
    const p = g.attributes.position as THREE.BufferAttribute, ib = new THREE.InterleavedBuffer(new Float32Array(p.array), 3);
    const g2 = g.clone(); g2.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0)); g2.boundingSphere = g.boundingSphere; g2.boundingBox = g.boundingBox; g2.setDrawRange(g.drawRange.start, g.drawRange.count);
    const slow = dump(cellsOf(new WorldVisibilityInstances(), new THREE.Mesh(g2, mesh.material)));
    assert.ok(fast && fast.length > 4, `cells ${fast?.length}`);
    assert.deepEqual(fast, slow);
    const v = new WorldVisibilityInstances(), ray = new THREE.Raycaster(), hits: THREE.Intersection[] = [], stock: THREE.Intersection[] = [];
    for (let i = 0; i < 50; i++) {
      ray.set(new THREE.Vector3(-30 + i * 1.3, 20, -20 + i * 0.7), new THREE.Vector3(0.1, -1, 0.05).normalize()); ray.near = 0; ray.far = 100;
      hits.length = 0; stock.length = 0; v.intersect(mesh, ray, hits); mesh.raycast(ray, stock);
      assert.deepEqual(hits.map((h) => [h.distance, ...h.point.toArray()]).sort((a, b) => a[0] - b[0]), stock.map((h) => [h.distance, ...h.point.toArray()]).sort((a, b) => a[0] - b[0]));   // (a cell's faceIndex counts within the cell)
    }
  }
});
