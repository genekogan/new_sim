#!/usr/bin/env node
// littlemartians-two: the Arium-era Little Martians art, made fit for the god import path (lane LM, 2026-10-11).
//
// Source: the authored LM map on branch lm/map (an lm-map worktree), pinned at LM_MAP_COMMIT (953613972438, the LM-22 world); read
// through git objects only (never the worktree, never a local Little Martians checkout). Its `scene.json` lists the three
// original Vanessa scans (Madmaraca, Minarete, Celadon tower) and the 96 scan-court exhibits; `landscape.glb` holds
// the three gallery images.
//
// Each GLB is decoded (Draco via three's decoder), welded, simplified with meshoptimizer to a triangle target,
// textures resized and re-encoded as WebP (sharp), then quantized and written with EXT_meshopt_compression, so every
// file fits the default world budget (80 000 tris, 3 MB, 2048 px) and imports through POST /v1/god/assets unchanged.
// Mesh data is simplified, never re-authored; the original bytes stay in the archive and on lm/map.
//
//   node tools/god-skill/scripts/lm-two/optimize-assets.mjs [--only name,name] [--force]
//
// Writes worlds/littlemartians-two/assets/<file>.glb and worlds/littlemartians-two/assets/SOURCES.json.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const LM_MAP_COMMIT = '953613972438611c336b4cb5733390e47aed3290'; // LM-22 world content (later lm/map commits are temple experiments, excluded)
const OUT = join(root, 'worlds/littlemartians-two/assets');
const args = process.argv.slice(2);
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
const force = args.includes('--force');

// gltf-transform + friends live in the pnpm store (apps/server has core/functions; extensions/meshoptimizer/sharp sit beside them)
const pnpm = join(root, 'node_modules/.pnpm');
const find = (prefix) => { const d = execFileSync('ls', [pnpm], { encoding: 'utf8' }).split('\n').filter((x) => x.startsWith(prefix)).sort().pop(); if (!d) throw new Error(`pnpm store lacks ${prefix}`); return join(pnpm, d, 'node_modules'); };
const fnDir = find('@gltf-transform+functions@4.5');
const req = createRequire(join(fnDir, '@gltf-transform/functions/package.json'));
const { NodeIO } = req('@gltf-transform/core');
const { ALL_EXTENSIONS, KHRDracoMeshCompression, EXTMeshoptCompression, KHRMeshQuantization } = req('@gltf-transform/extensions');
const { dedup, weld, simplify, prune, textureCompress, quantize, reorder, flatten, join: joinPrims, compactPrimitive } = req('@gltf-transform/functions');
const meshopt = await import(pathToFileURL(join(find('meshoptimizer@1.3'), 'meshoptimizer/index.js')).href);
const { MeshoptSimplifier, MeshoptEncoder } = meshopt;
const sharp = createRequire(join(find('sharp@0.35'), 'sharp/package.json'))('sharp');

// three's Draco decoder is an emscripten UMD file inside an ESM package: load it as CommonJS from a scratch copy.
const dracoSrc = join(root, 'node_modules/.pnpm', execFileSync('ls', [pnpm], { encoding: 'utf8' }).split('\n').find((x) => x.startsWith('three@0.185')), 'node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.js');
mkdirSync(join(root, '.lane'), { recursive: true });
const dracoCjs = join(root, '.lane/draco_decoder.cjs');
writeFileSync(dracoCjs, readFileSync(dracoSrc));
const dracoDecoder = await createRequire(import.meta.url)(dracoCjs)();
await MeshoptSimplifier.ready; await MeshoptEncoder.ready;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': dracoDecoder, 'meshopt.encoder': MeshoptEncoder });
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const git = (path) => execFileSync('git', ['-C', root, 'show', `${LM_MAP_COMMIT}:${path}`], { maxBuffer: 1 << 30 });

/** Triangles in a document (indexed or not). */
function tris(doc) {
  let n = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); n += Math.floor((i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3); }
  return n;
}

/** The art to optimize: file stem → target triangles and texture size. */
function catalog() {
  const scene = JSON.parse(git('worlds/littlemartians/scene.json'));
  const list = [];
  for (const b of scene.buildings) {
    if (b.file === 'landscape' || b.file === 'ceramic-tower' || b.file === 'minaret-temple') continue; // landscape is rebuilt natively; the pavilions are core defs
    const scan = b.file.startsWith('scan-');
    list.push({ file: b.file, src: `worlds/littlemartians/buildings/${b.file}.glb`, tris: scan ? 76_000 : 30_000, tex: scan ? 2048 : 1024, quality: scan ? 86 : 80 });
  }
  // the seven cast floaters (the six kin are already core defs: core/kin-*@1, the same files)
  const chars = JSON.parse(git('worlds/littlemartians/characters/manifest.json')).models.filter((m) => m.group === 'floater');
  for (const m of chars) list.push({ file: `character-${m.id}`, src: `worlds/littlemartians/characters/${m.file}`, tris: 40_000, tex: 2048, quality: 84 });
  return list;
}

async function optimize(item) {
  const raw = git(item.src);
  const doc = await io.readBinary(new Uint8Array(raw));
  const before = { tris: tris(doc), bytes: raw.byteLength };
  doc.createExtension(KHRDracoMeshCompression).dispose();
  await doc.transform(dedup(), flatten(), joinPrims(), weld({}), prune());
  let t = tris(doc);
  if (t > item.tris) {
    // meshopt's error bound keeps the silhouette; step the ratio until the target is met
    let ratio = item.tris / t;
    for (let i = 0; i < 4 && t > item.tris; i++) {
      await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01 + i * 0.02, lockBorder: false }));
      t = tris(doc); ratio = Math.min(0.98, ratio * (item.tris / t) * 0.97);
    }
  }
  if (t > item.tris * 1.1) {
    // triangle soups (unwelded scans) do not collapse under edge simplification: cluster them instead
    const k = item.tris / t;
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
      const pos = p.getAttribute('POSITION'); let idx = p.getIndices();
      if (!idx) { const a = new Uint32Array(pos.getCount()); for (let j = 0; j < a.length; j++) a[j] = j; idx = doc.createAccessor().setType('SCALAR').setArray(a); p.setIndices(idx); }
      const src = new Uint32Array(idx.getArray()), xyz = new Float32Array(pos.getCount() * 3);
      for (let j = 0, v = [0, 0, 0]; j < pos.getCount(); j++) { pos.getElement(j, v); xyz.set(v, j * 3); }
      const target = Math.max(3, Math.floor((src.length * k) / 3) * 3);
      const [dst] = MeshoptSimplifier.simplifySloppy(src, xyz, 3, null, target, 0.05);
      idx.setArray(new Uint32Array(dst)); compactPrimitive(p);
    }
    t = tris(doc);
  }
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [item.tex, item.tex], quality: item.quality }),
    prune(), reorder({ encoder: MeshoptEncoder }), quantize(),
  );
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  let out = await io.writeBinary(doc);
  // over 3 MB: shrink the textures once more (geometry is already small)
  if (out.byteLength > 2_900_000) {
    await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [item.tex / 2, item.tex / 2], quality: item.quality - 8 }));
    out = await io.writeBinary(doc);
  }
  return { before, after: { tris: tris(doc), bytes: out.byteLength }, out, rawSha: sha256(raw) };
}

mkdirSync(OUT, { recursive: true });
const sourcesFile = join(OUT, 'SOURCES.json');
const sources = existsSync(sourcesFile) ? JSON.parse(readFileSync(sourcesFile, 'utf8')) : { schema: 'lm-two-sources/1', assets: {} };
sources.lmMapCommit = LM_MAP_COMMIT;
const items = catalog().filter((x) => !only || only.has(x.file));
let i = 0;
for (const item of items) {
  i++;
  const dest = join(OUT, `${item.file}.glb`);
  if (!force && existsSync(dest) && sources.assets[item.file]) { continue; }
  const t0 = Date.now();
  try {
    const r = await optimize(item);
    writeFileSync(dest, r.out);
    sources.assets[item.file] = { source: `lm/map@${LM_MAP_COMMIT}:${item.src}`, sourceSha256: r.rawSha, sha256: sha256(r.out), before: r.before, after: r.after, targets: { tris: item.tris, texPx: item.tex } };
    console.log(`${i}/${items.length} ${item.file}: ${r.before.tris} → ${r.after.tris} tris, ${(r.before.bytes / 1e6).toFixed(1)} → ${(r.after.bytes / 1e6).toFixed(2)} MB (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) { console.log(`${i}/${items.length} ${item.file}: FAILED ${e.message}`); sources.assets[item.file] = { source: `lm/map@${LM_MAP_COMMIT}:${item.src}`, error: String(e.message) }; }
  writeFileSync(sourcesFile, JSON.stringify(sources, null, 1) + '\n');
}
