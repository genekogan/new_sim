// A small self-made model for the library e2e: a three-block painted totem (CC0, made here), as a valid GLB.
// totemGlb() → Uint8Array. Deterministic bytes, so its sha is stable across runs.
export function totemGlb() {
  const pos = [], nrm = [], idx = [];
  const faces = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 1, 0], [0, 0, -1]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [0, 0, -1], [1, 0, 0]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]]];
  for (const [n, u, v] of faces) {
    const b = pos.length / 3;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { for (let k = 0; k < 3; k++) { pos.push(0.5 * (n[k] + su * u[k] + sv * v[k])); nrm.push(n[k]); } }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const P = new Float32Array(pos), N = new Float32Array(nrm), I = new Uint16Array(idx);
  const bin = new Uint8Array(Math.ceil((P.byteLength + N.byteLength + I.byteLength) / 4) * 4);
  bin.set(new Uint8Array(P.buffer), 0); bin.set(new Uint8Array(N.buffer), P.byteLength); bin.set(new Uint8Array(I.buffer), P.byteLength + N.byteLength);
  const colors = [[0.78, 0.33, 0.2, 1], [0.93, 0.76, 0.31, 1], [0.2, 0.5, 0.55, 1]];
  const gltf = {
    asset: { version: '2.0', generator: 'sim library e2e fixture' },
    scene: 0, scenes: [{ nodes: [0, 1, 2] }],
    nodes: [{ mesh: 0, translation: [0, 0.35, 0], scale: [0.9, 0.7, 0.9] }, { mesh: 1, translation: [0, 1.0, 0], scale: [0.7, 0.6, 0.7] }, { mesh: 2, translation: [0, 1.55, 0], scale: [0.5, 0.5, 0.5] }],
    meshes: colors.map((_, i) => ({ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: i }] })),
    materials: colors.map((c) => ({ pbrMetallicRoughness: { baseColorFactor: c, metallicFactor: 0, roughnessFactor: 0.8 } })),
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: P.byteLength, target: 34962 }, { buffer: 0, byteOffset: P.byteLength, byteLength: N.byteLength, target: 34962 }, { buffer: 0, byteOffset: P.byteLength + N.byteLength, byteLength: I.byteLength, target: 34963 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: P.length / 3, type: 'VEC3', min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
      { bufferView: 1, componentType: 5126, count: N.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: I.length, type: 'SCALAR' },
    ],
  };
  let json = JSON.stringify(gltf); while (json.length % 4) json += ' ';
  const J = new TextEncoder().encode(json), total = 12 + 8 + J.length + 8 + bin.byteLength;
  const out = new Uint8Array(total), v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true); v.setUint32(4, 2, true); v.setUint32(8, total, true);
  v.setUint32(12, J.length, true); v.setUint32(16, 0x4e4f534a, true); out.set(J, 20);
  v.setUint32(20 + J.length, bin.byteLength, true); v.setUint32(24 + J.length, 0x004e4942, true); out.set(bin, 28 + J.length);
  return out;
}
