// Lossless geometry compression: verify every decoded byte before publishing.
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { MeshoptDecoder } from 'meshoptimizer/decoder';
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const path = 'public/browser/campus.glb',
  file = await readFile(path),
  n = file.readUInt32LE(12),
  g = JSON.parse(file.subarray(20, 20 + n)),
  bin = file.subarray(28 + n);
if (g.extensionsRequired?.includes('EXT_meshopt_compression'))
  throw Error('Run browser-model.py first');
const images = new Set(g.images.map((i) => i.bufferView)),
  parts = [];
let offset = 0,
  fallback = 0,
  compressed = 0;
function append(data) {
  const at = offset;
  parts.push(Buffer.from(data));
  offset += data.length;
  const pad = (4 - (offset % 4)) % 4;
  parts.push(Buffer.alloc(pad));
  offset += pad;
  return at;
}
for (let i = 0; i < g.bufferViews.length; i++) {
  const v = g.bufferViews[i],
    raw = bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength),
    a = g.accessors.find((a) => a.bufferView === i);
  const sizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 },
    counts = {
      SCALAR: 1,
      VEC2: 2,
      VEC3: 3,
      VEC4: 4,
      MAT4: 16,
      MAT3: 9,
      MAT2: 4,
    };
  const stride =
      v.byteStride || (a ? sizes[a.componentType] * counts[a.type] : 0),
    mode = v.target === 34963 ? 'INDICES' : 'ATTRIBUTES';
  if (
    !images.has(i) &&
    stride &&
    raw.length % stride === 0 &&
    (mode === 'ATTRIBUTES'
      ? stride % 4 === 0 && stride <= 256
      : [2, 4].includes(stride))
  ) {
    const count = raw.length / stride,
      encoded = MeshoptEncoder.encodeGltfBuffer(raw, count, stride, mode, 0),
      decoded = new Uint8Array(raw.length);
    MeshoptDecoder.decodeGltfBuffer(decoded, count, stride, encoded, mode);
    assert.deepEqual(Buffer.from(decoded), raw);
    v.extensions = {
      ...v.extensions,
      EXT_meshopt_compression: {
        buffer: 0,
        byteOffset: append(encoded),
        byteLength: encoded.length,
        byteStride: stride,
        count,
        mode,
      },
    };
    v.buffer = 1;
    v.byteOffset = fallback;
    fallback += v.byteLength;
    fallback = (fallback + 3) & ~3;
    compressed++;
  } else {
    v.buffer = 0;
    v.byteOffset = append(raw);
  }
}
g.buffers = [
  { byteLength: offset },
  {
    byteLength: fallback,
    extensions: { EXT_meshopt_compression: { fallback: true } },
  },
];
g.extensionsUsed = [...(g.extensionsUsed || []), 'EXT_meshopt_compression'];
g.extensionsRequired = [
  ...(g.extensionsRequired || []),
  'EXT_meshopt_compression',
];
let js = Buffer.from(JSON.stringify(g));
js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 32)]);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + js.length + offset, 8);
header.writeUInt32LE(js.length, 12);
header.writeUInt32LE(0x4e4f534a, 16);
const bh = Buffer.alloc(8);
bh.writeUInt32LE(offset);
bh.writeUInt32LE(0x004e4942, 4);
await writeFile(path, Buffer.concat([header, js, bh, ...parts]));
console.log(
  JSON.stringify({
    compressedViews: compressed,
    bytes: 28 + js.length + offset,
    losslessVerified: true,
  }),
);

await (await import('./http-compress.mjs')).compressHttp(path);
