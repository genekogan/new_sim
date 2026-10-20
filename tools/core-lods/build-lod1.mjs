#!/usr/bin/env node
// Z2 (2026-10-20): distant versions (lod1) of the core meshes that are over their class triangle budget.
// The original GLB stays the near model, unchanged. lod1 is a decimated copy that the viewer draws only past the
// switch distance (apps/web/src/gen-mesh/mesh-lod.ts); its triangles must fit the def's class cap (vocab triBudget).
// Simplification is meshoptimizer's edge collapse (Prune: small loose pieces may go; Permissive only when the seams
// block the target), so the shape does not shatter; the sloppy grid clusterer is never used. Textures are resized for distance (WebP), geometry is
// meshopt-compressed. Named nodes, skins and clips are kept.
//   node tools/core-lods/build-lod1.mjs <jobs.json> <outDir> [--tex 512]
//   jobs.json: [{ src: "<path to GLB>", target: <max triangles>, key?: "<label>" }]
// Writes <outDir>/<sha256>.glb per job and prints one JSON line per job: { key, src, sha, tris, bytes, ... }.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1]; };
const [jobsFile, outDir] = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
if (!jobsFile || !outDir) { console.error('usage: build-lod1.mjs <jobs.json> <outDir> [--tex 512]'); process.exit(2); }
const TEX = Number(opt('--tex', 512));

async function deps() {
  const pnpm = join(ROOT, 'node_modules/.pnpm');
  const find = (prefix) => { const d = readdirSync(pnpm).filter((x) => x.startsWith(prefix)).sort().pop(); if (!d) throw new Error(`pnpm store lacks ${prefix}`); return join(pnpm, d, 'node_modules'); };
  const req = createRequire(join(find('@gltf-transform+functions@4.5'), '@gltf-transform/functions/package.json'));
  const { NodeIO, Logger, getBounds } = req('@gltf-transform/core'), ext = req('@gltf-transform/extensions'), fn = req('@gltf-transform/functions');
  const meshopt = await import(pathToFileURL(join(find('meshoptimizer@1.3'), 'meshoptimizer/index.js')).href);
  const sharp = createRequire(join(find('sharp@0.35'), 'sharp/package.json'))('sharp');
  // three's Draco decoder is CommonJS inside an ESM package: load a private copy as .cjs
  const dracoCjs = join(tmpdir(), `core-lods-draco-${process.pid}.cjs`);
  writeFileSync(dracoCjs, readFileSync(join(find('three@0.185'), 'three/examples/jsm/libs/draco/gltf/draco_decoder.js')));
  const { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } = meshopt;
  await Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.ERROR)).registerExtensions(ext.ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await createRequire(import.meta.url)(dracoCjs)(), 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
  });
  return { io, fn, ext, sharp, MeshoptSimplifier, MeshoptEncoder, getBounds };
}

/** Drawn triangles: a mesh used by two nodes is drawn twice. */
export function triangles(doc) {
  let tris = 0;
  for (const n of doc.getRoot().listNodes()) {
    const m = n.getMesh(); if (!m) continue;
    for (const p of m.listPrimitives()) if ((p.getMode?.() ?? 4) === 4) tris += Math.floor((p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3);
  }
  return tris;
}

const D = await deps();
const { io, fn, sharp, getBounds } = D;
const sceneBounds = (doc) => { const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; for (const sc of doc.getRoot().listScenes()) { const x = getBounds(sc); for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], x.min[k]); b.max[k] = Math.max(b.max[k], x.max[k]); } } return b; };
const boundsGap = (a, b) => { const size = Math.max(...a.max.map((v, k) => v - a.min[k])); return Math.max(...[0, 1, 2].flatMap((k) => [Math.abs(a.min[k] - b.min[k]), Math.abs(a.max[k] - b.max[k])])) / size; };
/** Inverse of an affine column-major 4x4. */
function invertAffine(m) {
  const [a, b, c, , d, e, f, , g, h, i] = m, det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  const r = [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det, 0, (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det, 0, (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det, 0];
  const t = [m[12], m[13], m[14]];
  return [...r, -(r[0] * t[0] + r[4] * t[1] + r[8] * t[2]), -(r[1] * t[0] + r[5] * t[1] + r[9] * t[2]), -(r[2] * t[0] + r[6] * t[1] + r[10] * t[2]), 1];
}
const apply = (m, v) => [0, 1, 2].map((k) => m[k] * v[0] + m[4 + k] * v[1] + m[8 + k] * v[2] + m[12 + k]);
/** The viewer fits a GLB to its def box by the bounds of every vertex, so lod1 must keep the original's bounds even
 *  where a thin tip was collapsed: one zero-area triangle spanning the original corners (never rasterised). */
function keepBounds(doc, want) {
  if (boundsGap(want, sceneBounds(doc)) < 1e-4) return 0;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh || node.getSkin()) continue;
    const prim = mesh.listPrimitives().find((p) => (p.getMode?.() ?? 4) === 4 && p.getIndices() && !p.listTargets().length); if (!prim) continue;
    const inv = invertAffine(node.getWorldMatrix());
    const corners = [want.min, want.max].map((v) => apply(inv, v));
    const n = prim.getAttribute('POSITION').getCount();
    for (const sem of prim.listSemantics()) {
      const acc = prim.getAttribute(sem), arr = acc.getArray(), es = acc.getElementSize();
      const next = new arr.constructor(arr.length + 2 * es); next.set(arr);
      for (let j = 0; j < 2; j++) for (let k = 0; k < es; k++) next[(n + j) * es + k] = sem === 'POSITION' ? corners[j][k] : arr[k];
      acc.setArray(next);
    }
    const idx = prim.getIndices(), old = idx.getArray();
    const next = new (n + 1 > 65535 ? Uint32Array : old.constructor)(old.length + 3); next.set(old); next.set([n, n + 1, n + 1], old.length);
    idx.setArray(next);
    return 1;
  }
  return -1;
}

// gltf-transform's simplify calls simplifier.simplify(indices, positions, stride, target, error, flags);
// add Permissive (collapses across attribute seams of scanned meshes) and Prune (drops pieces smaller than the error).
const withFlags = (extra) => ({ ...D.MeshoptSimplifier, simplify: (i, p, s, t, e, f = []) => D.MeshoptSimplifier.simplify(i, p, s, t, e, [...f, ...extra]) });
// First keep attribute seams (the texture stays put); a scanned mesh that cannot reach the target that way then
// collapses across seams too (Permissive). Prune (pieces smaller than the error bound go) only at small bounds,
// so a large bound can never empty a model.
const STAGES = [
  ...[0.002, 0.005, 0.01, 0.02].map((e) => [e, withFlags(['Prune']), 'careful']),
  [0.05, withFlags([]), 'careful'],
  ...[0.01, 0.02].map((e) => [e, withFlags(['Permissive', 'Prune']), 'permissive']),
  ...[0.05, 0.1, 0.2, 0.5].map((e) => [e, withFlags(['Permissive']), 'permissive']),
];

async function build(job) {
  const src = resolve(ROOT, job.src), bytes = readFileSync(src);
  const doc = await io.readBinary(new Uint8Array(bytes));
  const before = triangles(doc), want = sceneBounds(doc);
  const animated = doc.getRoot().listSkins().length > 0 || doc.getRoot().listAnimations().length > 0;
  await doc.transform(fn.dedup(), fn.weld(), ...(animated ? [] : [fn.join({ keepNamed: true })]), fn.prune());
  let t = triangles(doc), passes = 0;
  // Edge collapse with a growing error bound until the drawn count fits; each pass re-aims at the target.
  let mode = 'none';
  for (const [error, simplifier, name] of STAGES) {
    if (t <= job.target - 1) break;   // one triangle is kept for keepBounds
    await doc.transform(fn.simplify({ simplifier, ratio: Math.min(1, ((job.target - 1) / t) * 0.97), error, lockBorder: false }), fn.prune());
    t = triangles(doc); passes++; mode = name;
  }
  if (t < Math.min(job.target, before) * 0.25) throw new Error(`over-reduced: ${t} of target ${job.target}`);
  const pinned = keepBounds(doc, want); t = triangles(doc);
  if (t > job.target) throw new Error(`target missed: ${t} > ${job.target}`);
  // Distance textures: at most TEX px on a side, WebP. Then compact geometry.
  await doc.transform(
    fn.textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [TEX, TEX], quality: 82 }),
    fn.prune(), fn.reorder({ encoder: D.MeshoptEncoder }), fn.quantize(), fn.meshopt({ encoder: D.MeshoptEncoder, level: 'medium' }),
  );
  // decoded Draco geometry is re-encoded with meshopt, so the Draco extension goes
  for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === 'KHR_draco_mesh_compression') e.dispose();
  const out = await io.writeBinary(doc);
  // skinned models are fitted by their bind pose in the viewer and are not pinned; their bounds are not compared here
  const gap = animated ? 0 : boundsGap(want, sceneBounds(await io.readBinary(out)));
  if (gap > 0.002) throw new Error(`bounds moved by ${(gap * 100).toFixed(2)}% of the size`);
  const sha = createHash('sha256').update(out).digest('hex');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${sha}.glb`), out);
  return { key: job.key ?? job.src, src: job.src, srcSha: createHash('sha256').update(bytes).digest('hex'), sha, before, tris: t, target: job.target, bytes: out.length, srcBytes: bytes.length, passes, mode, pinned, boundsGap: +gap.toFixed(5) };
}

const jobs = JSON.parse(readFileSync(jobsFile, 'utf8'));
for (const job of jobs) {
  try { console.log(JSON.stringify(await build(job))); }
  catch (e) { console.log(JSON.stringify({ key: job.key ?? job.src, src: job.src, error: String(e.message ?? e).slice(0, 300) })); }
}
