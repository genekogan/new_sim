// Plain-Node structural check of the building GLBs (no dependencies), for the
// web side: valid GLB 2.0, no required extensions, textures embedded, normals
// and UVs present, and the mesh bounds equal the footprint's bounds.
//
//   node tools/buildings/check-glb.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'worlds', 'littlemartians', 'buildings');
let failed = false;

for (const id of ['ceramic-tower', 'minaret-temple']) {
  const buf = readFileSync(join(out, `${id}.glb`));
  const fp = JSON.parse(readFileSync(join(out, `${id}.footprint.json`), 'utf8'));
  const problems = [];
  if (buf.readUInt32LE(0) !== 0x46546c67 || buf.readUInt32LE(4) !== 2) problems.push('not a GLB 2.0 file');
  if (buf.readUInt32LE(8) !== buf.length) problems.push('header length mismatch');
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  if (gltf.extensionsRequired?.length) problems.push(`requires extensions ${gltf.extensionsRequired}`);
  for (const img of gltf.images ?? []) if (img.uri) problems.push(`external image ${img.uri}`);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  let tris = 0;
  for (const mesh of gltf.meshes) {
    for (const prim of mesh.primitives) {
      for (const a of ['POSITION', 'NORMAL', 'TEXCOORD_0']) if (prim.attributes[a] === undefined) problems.push(`primitive without ${a}`);
      const pos = gltf.accessors[prim.attributes.POSITION];
      pos.min.forEach((v, i) => (lo[i] = Math.min(lo[i], v)));
      pos.max.forEach((v, i) => (hi[i] = Math.max(hi[i], v)));
      tris += gltf.accessors[prim.indices].count / 3;
    }
  }
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 0.01);
  if (!near(lo, fp.bounds.min) || !near(hi, fp.bounds.max)) problems.push(`bounds ${lo}..${hi} differ from footprint ${fp.bounds.min}..${fp.bounds.max}`);
  const mats = gltf.materials.map((m) => `${m.name}${m.pbrMetallicRoughness?.baseColorTexture ? '+colour' : ''}${m.normalTexture ? '+normal' : ''}`);
  console.log(`${id}: ${buf.length} bytes, ${tris} triangles, materials [${mats.join(', ')}], images ${gltf.images?.length ?? 0} embedded, ` +
    `bounds y ${lo[1].toFixed(2)}..${hi[1].toFixed(2)} m, extensionsUsed [${gltf.extensionsUsed ?? []}] ${problems.length ? 'FAIL' : 'ok'}`);
  for (const p of problems) console.log(`  - ${p}`);
  failed ||= problems.length > 0;
}
process.exit(failed ? 1 : 0);
