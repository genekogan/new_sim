// Phone arrival round 2 (lane L3): images the download worker decoded become the GLB's textures exactly where three's
// ImageBitmapLoader path would put them, and the main thread never decodes them again (createImageBitmap here throws).
import test from 'node:test';
import assert from 'node:assert/strict';

function glb(): ArrayBuffer {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), uv = new Float32Array([0, 0, 1, 0, 0, 1]), png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const bin = new Uint8Array(36 + 24 + 12); bin.set(new Uint8Array(pos.buffer), 0); bin.set(new Uint8Array(uv.buffer), 36); bin.set(png, 60);
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } }, emissiveTexture: { index: 1 } }],
    textures: [{ source: 0, sampler: 0 }, { source: 0 }], samplers: [{ magFilter: 9728 }],
    images: [{ bufferView: 2, mimeType: 'image/png', extras: { from: 'scan' } }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }, { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 24 }, { buffer: 0, byteOffset: 60, byteLength: 12 }],
    buffers: [{ byteLength: bin.length }],
  };
  let j = new TextEncoder().encode(JSON.stringify(json)); const pad = (4 - (j.length % 4)) % 4; j = new Uint8Array([...j, ...new Array(pad).fill(32)]);
  const out = new Uint8Array(12 + 8 + j.length + 8 + bin.length), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, j.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(j, 20);
  dv.setUint32(20 + j.length, bin.length, true); dv.setUint32(24 + j.length, 0x004e4942, true); out.set(bin, 28 + j.length);
  return out.buffer;
}
const bitmap = { width: 4, height: 4, closed: false, close() { this.closed = true; } };
class FakeWorker {
  onmessage: ((ev: { data: unknown }) => void) | null = null; onerror: (() => void) | null = null;
  postMessage(m: { id: number }) { setTimeout(() => this.onmessage?.({ data: { id: m.id, loaded: 1, buffer: glb(), images: [[0, bitmap]] } }), 1); }
}
const g = globalThis as unknown as Record<string, unknown>;
g.Worker = FakeWorker;
g.createImageBitmap = () => Promise.reject(new Error('decoded on the main thread'));   // also makes GLTFLoader use ImageBitmapLoader

test('worker-decoded images are the textures: same bitmap, extras, mimeType, one source shared as clones', async () => {
  const { loadAsset } = await import('./gltf-assets.ts');
  const gltf = await loadAsset('a'.repeat(64));
  let mat: { map?: { image: unknown; flipY: boolean; userData: Record<string, unknown>; version: number; magFilter: number }; emissiveMap?: { image: unknown } } | undefined;
  gltf.scene.traverse((o) => { const m = (o as unknown as { material?: typeof mat }).material; if (m && !mat) mat = m; });
  assert.ok(mat?.map, 'base colour texture');
  assert.equal(mat!.map!.image, bitmap);
  assert.equal(mat!.map!.flipY, false);
  assert.equal(mat!.map!.magFilter, 1003);   // NearestFilter from the sampler, as three assigns it
  assert.deepEqual({ from: mat!.map!.userData.from, mimeType: mat!.map!.userData.mimeType }, { from: 'scan', mimeType: 'image/png' });
  assert.ok(mat!.map!.version > 0, 'needsUpdate');
  assert.equal(mat!.emissiveMap?.image, bitmap, 'a second texture of the same source is a clone sharing it');
  assert.equal(bitmap.closed, false, 'a used bitmap is not released');
});
