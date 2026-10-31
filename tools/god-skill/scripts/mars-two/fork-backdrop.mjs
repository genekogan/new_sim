#!/usr/bin/env node
// MARSLAND-FORK: the campus backdrop for the old-world Mars fork (/worlds/w/mars), as sim.mars.college shows it PLUS
// Gene's corrections (layer 1 + layer 2), baked into one static GLB in the same frame as /browser/campus.glb.
//
// The old-world client (apps/web WorldGeometry.addBackdrop) draws the raw campus.glb only; it never runs the Mars
// viewer's add2026Details() recipe, so the fork lacked everything that recipe adds (gallery, Mimos home, kitchen, string
// lights, showers, ...). This script runs that recipe in Node on the raw CAD, from a Mars viewer source tree (default
// the corrected source, worktree mars-src-fix @ 7d9688f: release 43 + Gene's Mimos/kitchen/diner/shower corrections),
// exports the visible result with GLTFExporter (original materials and image bytes restored by name, the recipe's new
// textures embedded), then re-encodes it as the BLOBS lane does (quantize + WebP + meshopt; tools/blobs/shrink-campus.mjs).
// After Codex's export-corrected-backdrop.mjs (team/scratch/viewer-app/mars-layout-photo-20261010).
//
//   node tools/god-skill/scripts/mars-two/fork-backdrop.mjs [--src <mars viewer repo>] [--campus <raw campus.glb>] [--out <dir>]
//
// Writes <out>/campus-owner-<src12>.raw.glb (export), <out>/<sha256>.glb (shrunk; the content-addressed blob) and
// <out>/RECEIPT.json. Nothing outside <out> is written; the source tree and the raw campus are read-only.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const need = (k, what) => { const v = arg(k); if (!v) throw new Error(`pass ${k} <${what}>`); return v; };
const SRC = resolve(need('--src', 'the corrected Mars source checkout (mars-src-fix)'));
const VIEWER = join(SRC, 'viewer');
const CAMPUS = resolve(need('--campus', "release 43's browser/campus.glb"));
const RAW_SHA = '675f4bebed89d73fb579493e708476f0dfd4c44c0106958a1aad1a92c932a8c4';   // release 43's campus.glb
const OUT = resolve(arg('--out', join(ROOT, '.lane/fork-backdrop')));
fs.mkdirSync(OUT, { recursive: true });
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const rev = execFileSync('git', ['-C', SRC, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['-C', SRC, 'status', '--porcelain', '--', 'viewer/app', 'viewer/engine', 'viewer/lib', 'viewer/public/history'], { encoding: 'utf8' }).trim();
if (dirty) throw Error(`source tree ${SRC} has uncommitted changes in the recipe:\n${dirty}`);

// ---- three, one instance for the loader, the recipe and the exporter (the source's own node_modules)
const NM = join(VIEWER, 'node_modules');
const threeMain = join(NM, 'three/build/three.module.js');
const T = await import(pathToFileURL(threeMain).href);
const { GLTFLoader } = await import(pathToFileURL(join(NM, 'three/examples/jsm/loaders/GLTFLoader.js')).href);
const { GLTFExporter } = await import(pathToFileURL(join(NM, 'three/examples/jsm/exporters/GLTFExporter.js')).href);
const { MeshoptDecoder } = await import(pathToFileURL(join(NM, 'three/examples/jsm/libs/meshopt_decoder.module.js')).href);
const { build } = await import(pathToFileURL(join(NM, 'esbuild/lib/main.js')).href);
globalThis.self = globalThis;
globalThis.ProgressEvent ??= class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
globalThis.FileReader = class { readAsArrayBuffer(blob) { blob.arrayBuffer().then((a) => { this.result = a; this.onloadend?.(); }); } readAsDataURL(blob) { blob.arrayBuffer().then((a) => { this.result = 'data:application/octet-stream;base64,' + Buffer.from(a).toString('base64'); this.onloadend?.(); }); } };
// the recipe's textures are files under the viewer's public/; record their URLs and embed the bytes after export
T.TextureLoader.prototype.load = function (url) { const t = new T.Texture(); t.userData.sourceUrl = url; return t; };

// ---- the raw CAD, textures stripped for the recipe pass (original image bytes are copied back at export)
const raw = fs.readFileSync(CAMPUS);
if (sha(raw) !== RAW_SHA) throw Error(`${CAMPUS} is not release 43's campus.glb (${RAW_SHA.slice(0, 12)})`);
const n = raw.readUInt32LE(12), original = JSON.parse(raw.subarray(20, 20 + n).toString()), originalBin = raw.subarray(28 + n);
const sourceMaterials = new Map(original.materials.map((m) => [m.name, m]));
const json = structuredClone(original);
delete json.images; delete json.textures; delete json.samplers;
const strip = (o) => { if (!o || typeof o !== 'object') return; for (const k of Object.keys(o)) { if (k.endsWith('Texture')) delete o[k]; else strip(o[k]); } };
for (const m of json.materials ?? []) strip(m);
const text = Buffer.from(JSON.stringify(json)), pad = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32); text.copy(pad);
const bin = raw.subarray(20 + n), glb = Buffer.alloc(20 + pad.length + bin.length);
raw.copy(glb, 0, 0, 12); glb.writeUInt32LE(glb.length, 8); glb.writeUInt32LE(pad.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); pad.copy(glb, 20); bin.copy(glb, 20 + pad.length);
await MeshoptDecoder.ready;
const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
const root = gltf.scene; root.updateMatrixWorld(true);
// the source's own material objects and their colours, to tell a recipe-made copy (same name, new object) or an
// in-place recolour from an untouched source material (only those get their original JSON, textures included, back)
const srcMats = new Map();
root.traverse((o) => { if (o.isMesh) for (const m of [o.material].flat()) srcMats.set(m, (m.color?.getHex() ?? 0) + '|' + (m.emissive?.getHex() ?? 0) + '|' + m.opacity); });

// ---- the recipe (add2026Details), bundled from the source with `three` resolved to the same module file
const recipe = join(OUT, `recipe-${rev.slice(0, 12)}.mjs`);
const threeExternal = { name: 'three-same-instance', setup(b) {
  b.onResolve({ filter: /^three$/ }, () => ({ path: pathToFileURL(threeMain).href, external: true }));
  b.onResolve({ filter: /^three\/(addons|examples\/jsm)\// }, (a) => ({ path: pathToFileURL(join(NM, 'three/examples/jsm', a.path.replace(/^three\/(addons|examples\/jsm)\//, ''))).href, external: true }));
} };
await build({ entryPoints: [join(VIEWER, 'app/history/details-2026.ts')], bundle: true, platform: 'node', format: 'esm', outfile: recipe, plugins: [threeExternal], logLevel: 'error' });
const { add2026Details } = await import(pathToFileURL(recipe).href);
add2026Details(root);
root.updateMatrixWorld(true);

// ---- export the visible scene; keep the original materials/images by name, embed the recipe's new textures
let materialIndex = 0; const recoloured = new Set(); const hidden = [], empty = [], textureRefs = new Map(); let components = 0;
root.traverse((o) => {
  if (!o.visible) hidden.push(o.userData.component_id ?? o.userData.assembly_id ?? o.name);
  if (o.userData.component_id) components++;
  if (!o.isMesh) return;
  if (!o.geometry.getAttribute('position')?.count) { o.visible = false; empty.push(o.userData.component_id ?? o.name); }
  for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
    const was = srcMats.get(m), same = was !== undefined && was === (m.color?.getHex() ?? 0) + '|' + (m.emissive?.getHex() ?? 0) + '|' + m.opacity;
    if (!m.name || (sourceMaterials.has(m.name) && !same)) { if (was !== undefined) recoloured.add(m.name); m.name = 'owner-derived-material-' + (++materialIndex); }
    if (m.map?.userData.sourceUrl) textureRefs.set(m.name, { url: m.map.userData.sourceUrl, colorSpace: m.map.colorSpace, wrapS: m.map.wrapS, wrapT: m.map.wrapT, repeat: m.map.repeat.toArray(), offset: m.map.offset.toArray() });
    if (m.map) m.map = null;
  }
});
const encoded = Buffer.from(await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true }));
const len = encoded.readUInt32LE(12), j = JSON.parse(encoded.subarray(20, 20 + len)), base = encoded.subarray(28 + len);
let offset = base.length; const chunks = [base];
j.images = []; j.textures = structuredClone(original.textures ?? []); j.samplers = structuredClone(original.samplers ?? []);
const append = (payload, mime) => { const i = j.bufferViews.length; j.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: payload.length }); chunks.push(payload); offset += payload.length; const p = (4 - (offset % 4)) % 4; chunks.push(Buffer.alloc(p)); offset += p; j.images.push({ bufferView: i, mimeType: mime }); return j.images.length - 1; };
for (const image of original.images ?? []) { const v = original.bufferViews[image.bufferView]; append(originalBin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength), image.mimeType); }
const derivedTextures = [];
for (const [name, ref] of textureRefs) {
  const p = join(VIEWER, 'public', ref.url.split('?')[0]);
  if (!fs.existsSync(p)) throw Error('missing recipe texture: ' + ref.url);
  const payload = fs.readFileSync(p), mime = p.endsWith('.webp') ? 'image/webp' : p.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const image = append(payload, mime), sampler = j.samplers.length;
  j.samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: ref.wrapS === T.RepeatWrapping ? 10497 : 33071, wrapT: ref.wrapT === T.RepeatWrapping ? 10497 : 33071 });
  const texture = j.textures.length; j.textures.push({ source: image, sampler });
  const tx = (ref.repeat[0] !== 1 || ref.repeat[1] !== 1 || ref.offset[0] || ref.offset[1]) ? { KHR_texture_transform: { scale: ref.repeat, offset: ref.offset } } : null;
  for (const m of j.materials) if (m.name === name) { m.pbrMetallicRoughness ??= {}; m.pbrMetallicRoughness.baseColorTexture = { index: texture, ...(tx ? { extensions: tx } : {}) }; }
  if (tx) { j.extensionsUsed = [...new Set([...(j.extensionsUsed ?? []), 'KHR_texture_transform'])]; }
  derivedTextures.push({ url: ref.url, sha256: sha(payload), bytes: payload.length });
}
j.materials = j.materials.map((m) => (sourceMaterials.has(m.name) ? structuredClone(sourceMaterials.get(m.name)) : m));
j.buffers = [{ byteLength: offset }];
const binOut = Buffer.concat(chunks), jt = Buffer.from(JSON.stringify(j)), jp = Buffer.alloc(Math.ceil(jt.length / 4) * 4, 32); jt.copy(jp);
const h = Buffer.alloc(20), bh = Buffer.alloc(8);
h.write('glTF'); h.writeUInt32LE(2, 4); h.writeUInt32LE(28 + jp.length + binOut.length, 8); h.writeUInt32LE(jp.length, 12); h.write('JSON', 16);
bh.writeUInt32LE(binOut.length); bh.write('BIN\0', 4);
const exported = Buffer.concat([h, jp, bh, binOut]), rawOut = join(OUT, `campus-owner-${rev.slice(0, 12)}.raw.glb`);
fs.writeFileSync(rawOut, exported);

// ---- shrink (BLOBS encoding) into the content-addressed blob
const P = join(ROOT, 'node_modules/.pnpm');
const shrink = fs.readFileSync(join(ROOT, 'tools/blobs/shrink-campus.mjs'), 'utf8').replace(/const P = '[^']+';/, `const P = ${JSON.stringify(P)};`)
  // the raw campus already carries EXT_meshopt_compression; a fresh export does not, so create it
  .replace("const mo = root.listExtensionsUsed().find((e) => e.extensionName === 'EXT_meshopt_compression');", "const mo = root.listExtensionsUsed().find((e) => e.extensionName === 'EXT_meshopt_compression') ?? doc.createExtension(ALL_EXTENSIONS.find((E) => E.EXTENSION_NAME === 'EXT_meshopt_compression'));");
if (!shrink.includes('doc.createExtension(ALL_EXTENSIONS')) throw Error('tools/blobs/shrink-campus.mjs changed; update fork-backdrop.mjs');
const shrinkTmp = join(OUT, 'shrink.mjs'); fs.writeFileSync(shrinkTmp, shrink);
const tmp = join(OUT, 'shrunk.tmp.glb');
const shrinkReport = JSON.parse(execFileSync(process.execPath, [shrinkTmp, rawOut, tmp], { encoding: 'utf8', maxBuffer: 1 << 26 }).trim().split('\n').at(-1));
const blob = fs.readFileSync(tmp), blobSha = sha(blob), blobPath = join(OUT, `${blobSha}.glb`);
fs.renameSync(tmp, blobPath); fs.rmSync(shrinkTmp);
const receipt = {
  what: 'old-world Mars fork backdrop: release-43 campus + add2026Details from the source below (layer 1 + Gene\'s corrections, layer 2)',
  source: { repo: SRC, rev }, campus: { path: CAMPUS, sha256: RAW_SHA },
  exported: { path: rawOut, sha256: sha(exported), bytes: exported.length },
  blob: { path: blobPath, sha256: blobSha, bytes: blob.length, url: `/blobs/assets/${blobSha.slice(0, 2)}/${blobSha}.glb` },
  recipe: { path: recipe, sha256: sha(fs.readFileSync(recipe)) }, script: sha(fs.readFileSync(fileURLToPath(import.meta.url))),
  components, recolouredSourceMaterials: [...recoloured], hidden: hidden.length, empty: empty.length, materialsRestored: sourceMaterials.size, derivedTextures, shrink: shrinkReport,
};
fs.writeFileSync(join(OUT, 'RECEIPT.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ rev, exported: receipt.exported.bytes, blob: receipt.blob, components, recolouredSourceMaterials: [...recoloured], hidden: hidden.length, textures: derivedTextures.length }));
