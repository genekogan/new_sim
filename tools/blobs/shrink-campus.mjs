#!/usr/bin/env node
// Lane BLOBS: a smaller /browser/campus.glb with the same look.
//   node tools/blobs/shrink-campus.mjs <in.glb> <out.glb>
// Keeps every node, name, transform and extras (the viewer hides people/reference objects by node extras), every
// material and texture. Only the encoding changes:
//   - POSITION/NORMAL/TEXCOORD quantized (KHR_mesh_quantization; positions 16 bit per mesh volume, normals 10, uv 14);
//     colours and indices untouched. The viewer converts quantized attributes back to Float32 after loading
//     (apps/web/src/WorldBackdropDequantize.ts) so static batching still merges the campus.
//   - textures re-encoded as WebP (EXT_texture_webp, quality 88, same pixel size; larger than 2048 px is capped).
//   - meshopt compression with filters (EXT_meshopt_compression, level high).
// Tools (from the workspace's pnpm store): @gltf-transform 4.5.1, meshoptimizer 1.3.0, sharp 0.35.4.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
// Resolved through the workspace: the server depends on @gltf-transform, which brings extensions, meshoptimizer and sharp.
const serverRequire = createRequire(new URL('../../apps/server/package.json', import.meta.url));
const fnRequire = createRequire(serverRequire.resolve('@gltf-transform/functions'));
const { NodeIO } = fnRequire('@gltf-transform/core');
const { ALL_EXTENSIONS } = fnRequire('@gltf-transform/extensions');
const F = fnRequire('@gltf-transform/functions');
const { MeshoptDecoder, MeshoptEncoder } = fnRequire('meshoptimizer');
const sharp = fnRequire('sharp');

const [inPath, outPath] = process.argv.slice(2);
await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const t0 = Date.now(); const doc = await io.read(inPath);
const root = doc.getRoot();
const before = { nodes: root.listNodes().length, meshes: root.listMeshes().length, materials: root.listMaterials().length, textures: root.listTextures().length, extras: root.listNodes().filter((n) => Object.keys(n.getExtras()).length).length };
await doc.transform(
  F.dedup({ propertyTypes: ['Accessor', 'Texture'] }),
  F.quantize({ pattern: /^(POSITION|NORMAL|TEXCOORD_\d)$/, quantizePosition: 16, quantizeNormal: 10, quantizeTexcoord: 14, quantizationVolume: 'mesh', cleanup: false }),
  F.textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 88, resize: [2048, 2048] }),
);
const mo = root.listExtensionsUsed().find((e) => e.extensionName === 'EXT_meshopt_compression');
mo.setRequired(true).setEncoderOptions({ method: 'filter' });
await doc.transform(F.reorder({ encoder: MeshoptEncoder, level: 'high' }));
const mimes = {}; for (const t of root.listTextures()) mimes[t.getMimeType()] = (mimes[t.getMimeType()] || 0) + t.getImage().byteLength;
const after = { mimes, nodes: root.listNodes().length, meshes: root.listMeshes().length, materials: root.listMaterials().length, textures: root.listTextures().length, extras: root.listNodes().filter((n) => Object.keys(n.getExtras()).length).length };
const bytes = await io.writeBinary(doc); writeFileSync(outPath, bytes);
const sha = (b) => createHash('sha256').update(b).digest('hex');
console.log(JSON.stringify({ in: { bytes: readFileSync(inPath).length, sha256: sha(readFileSync(inPath)) }, out: { bytes: bytes.length, sha256: sha(bytes) }, before, after, seconds: (Date.now() - t0) / 1000 }));
