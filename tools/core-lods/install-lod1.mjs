#!/usr/bin/env node
// Z2 (2026-10-20): install chosen distant versions (lod1) of core meshes.
//   node tools/core-lods/install-lod1.mjs <choices.json>
//   choices.json: [{ srcSha, file: "<built lod1 GLB>" }]
// Copies each file to worlds/core-assets/lods/<sha>.glb, measures it into worlds/core-assets/lods.index.json (the same
// schema as index.json, so the server serves /assets/<sha>.glb and the compiler sees its triangles) and writes the
// source-sha -> { lod1 } map packages/world-compiler/src/core-mesh-lods.json that core-kit/index.ts applies.
// Re-running with the same choices is a no-op. Entries for sources no longer chosen are removed.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'worlds/core-assets/lods'), INDEX = join(ROOT, 'worlds/core-assets/lods.index.json');
const MAP = join(ROOT, 'packages/world-compiler/src/core-mesh-lods.json');
const choices = JSON.parse(readFileSync(process.argv[2], 'utf8'));

const pnpm = join(ROOT, 'node_modules/.pnpm');
const find = (prefix) => { const d = readdirSync(pnpm).filter((x) => x.startsWith(prefix)).sort().pop(); if (!d) throw new Error(`pnpm store lacks ${prefix}`); return join(pnpm, d, 'node_modules'); };
const req = createRequire(join(find('@gltf-transform+functions@4.5'), '@gltf-transform/functions/package.json'));
const { NodeIO, Logger, getBounds } = req('@gltf-transform/core'), ext = req('@gltf-transform/extensions');
const { MeshoptDecoder } = await import(pathToFileURL(join(find('meshoptimizer@1.3'), 'meshoptimizer/index.js')).href);
await MeshoptDecoder.ready;
const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.ERROR)).registerExtensions(ext.ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

// every core index (the server merges them all) to find each source's licence and name
const core = {};
for (const f of readdirSync(join(ROOT, 'worlds/core-assets')).filter((n) => n.endsWith('.json') && (n === 'index.json' || n.endsWith('.index.json')) && n !== 'lods.index.json')) Object.assign(core, JSON.parse(readFileSync(join(ROOT, 'worlds/core-assets', f), 'utf8')).assets ?? {});

const r3 = (v) => Math.round(v * 1000) / 1000;
async function measure(bytes) {
  const doc = await io.readBinary(new Uint8Array(bytes));
  let tris = 0;
  for (const n of doc.getRoot().listNodes()) { const m = n.getMesh(); if (m) for (const p of m.listPrimitives()) if ((p.getMode?.() ?? 4) === 4) tris += Math.floor((p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3); }
  const b = getBounds(doc.getRoot().listScenes()[0]);
  const textures = doc.getRoot().listTextures();
  let texPx = 0; for (const t of textures) { const s = t.getSize(); if (s) texPx = Math.max(texPx, s[0], s[1]); }
  return { tris, textures: textures.length, texPx, box: [0, 1, 2].map((k) => r3(b.max[k] - b.min[k])), min: b.min.map(r3), animations: doc.getRoot().listAnimations().map((a) => a.getName()), extensions: doc.getRoot().listExtensionsUsed().map((e) => e.extensionName) };
}

mkdirSync(OUT, { recursive: true });
const index = { schema: 'core-assets/1', note: 'Z2 distant versions (lod1) of over-budget core meshes; tools/core-lods. The source GLB stays the near model.', assets: {} };
const map = {};
for (const c of choices) {
  const bytes = readFileSync(resolve(c.file)), sha = createHash('sha256').update(bytes).digest('hex');
  const src = core[c.srcSha]; if (!src) throw new Error(`source ${c.srcSha} is not a core asset`);
  const path = `worlds/core-assets/lods/${sha}.glb`;
  if (!existsSync(join(ROOT, path))) copyFileSync(resolve(c.file), join(ROOT, path));
  index.assets[sha] = { ext: 'glb', kind: 'mesh', path, bytes: bytes.length, ...(await measure(bytes)), name: `${src.name ?? c.srcSha.slice(0, 12)}-lod1`, ...(src.license ? { license: src.license } : {}), source: `lod1 of ${src.path} (${c.srcSha})` };
  map[c.srcSha] = { lod1: sha };
}
const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
index.assets = sorted(index.assets);
writeFileSync(INDEX, JSON.stringify(index, null, 1) + '\n');
writeFileSync(MAP, JSON.stringify(sorted(map), null, 1) + '\n');
const stale = readdirSync(OUT).filter((f) => f.endsWith('.glb') && !index.assets[f.slice(0, -4)]);
console.log(JSON.stringify({ installed: choices.length, files: Object.keys(index.assets).length, staleFiles: stale }));
