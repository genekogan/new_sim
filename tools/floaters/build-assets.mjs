#!/usr/bin/env node
/**
 * build-assets.mjs — the Little Martians floater models for worlds/littlemartians/characters/.
 *
 * Reads the Little Martians 3D archive (<lm-3d-models>) READ-ONLY and writes only
 * under this worktree:
 *   worlds/littlemartians/characters/<id>.glb        the seven floaters (six scanned Little Martians + Nyx)
 *   worlds/littlemartians/characters/kin/<id>.glb    a small subset of background ceramic-head kin
 *   worlds/littlemartians/characters/manifest.json   source, license, size, sha256, facing, lore
 *
 * Six floaters and all kin are byte-exact copies of the archive's web-ready `web/<id>.glb` (NOT the
 * rigged variants). Verdelis is the exception: its web file still carries 104 morph targets and two
 * animations (the 2024 talking-face rig), so it is rebuilt here from the canonical scan with the
 * morph targets and animations stripped, then run through the archive's own optimize.mjs pipeline.
 *
 * The original tools/optimize.mjs is NOT invoked: it always writes <archive>/web/<id>.glb and
 * <archive>/tools/optimize-results.json, i.e. inside the read-only archive. Its per-model pipeline is
 * reproduced below step for step (unpartition → weld → simplify with its size-based budget →
 * WebP q80 ≤ 2048 px → Draco), plus one necessary step: prune(), so the accessors of the stripped
 * morph targets are dropped instead of being written out unreferenced.
 *
 * Usage: node build-assets.mjs [--archive <path>] [--force]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, textureCompress, draco, unpartition, prune, getBounds } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import { CHARACTERS, KIN, LICENSE } from './sources.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const OUT = path.join(REPO, 'worlds', 'littlemartians', 'characters');
const argv = process.argv.slice(2);
const ARCHIVE = argv.includes('--archive') ? argv[argv.indexOf('--archive') + 1] : path.join(os.homedir(), 'Dev', 'littlemartians', '3d-models');
const FORCE = argv.includes('--force');

// optimize.mjs constants, verbatim
const SIZE_THRESHOLD = 30 * 1024 * 1024; // 30 MB

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const mb = (n) => (n / 1e6).toFixed(2);

/** optimize.mjs readDocument, verbatim in behaviour: GLBs whose JSON declares >1 buffer are unpacked to a temp .gltf. */
async function readDocument(io, input) {
  try {
    return await io.read(input);
  } catch (err) {
    if (!/0.1 buffers/.test(String(err.message))) throw err;
    const buf = fs.readFileSync(input);
    if (buf.readUInt32LE(0) !== 0x46546c67) throw err;
    const jsonLen = buf.readUInt32LE(12);
    const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
    let bin = null;
    let off = 20 + jsonLen;
    while (off + 8 <= buf.length) {
      const clen = buf.readUInt32LE(off);
      const ctype = buf.readUInt32LE(off + 4);
      if (ctype === 0x004e4942) { bin = buf.subarray(off + 8, off + 8 + clen); break; }
      off += 8 + clen;
    }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glb-unpack-'));
    try {
      if (bin) {
        fs.writeFileSync(path.join(tmpDir, 'buffer0.bin'), bin);
        const glbBuffer = (json.buffers || []).find((b) => b.uri === undefined);
        if (glbBuffer) glbBuffer.uri = 'buffer0.bin';
      }
      const tmpGltf = path.join(tmpDir, 'model.gltf');
      fs.writeFileSync(tmpGltf, JSON.stringify(json));
      return await io.read(tmpGltf);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

/** Strip the talking-face rig: every morph target, mesh/node default weights, and every animation. */
function stripMorphsAndAnimations(doc) {
  const root = doc.getRoot();
  let targets = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) for (const t of prim.listTargets()) { prim.removeTarget(t); t.dispose(); targets++; }
    mesh.setWeights([]);
    const extras = { ...mesh.getExtras() };
    delete extras.targetNames;
    mesh.setExtras(extras);
  }
  for (const node of root.listNodes()) node.setWeights([]);
  const animations = root.listAnimations().length;
  for (const a of root.listAnimations()) a.dispose();
  return { targets, animations };
}

/**
 * Drop every triangle with a vertex outside an axis-aligned box (scene coordinates; the scans used
 * here have identity node transforms). Used to remove the table/cloth a sculpture sat on during the
 * scan. Unreferenced vertices are pruned afterwards.
 */
function cropToBox(doc, box) {
  let kept = 0, dropped = 0;
  const inside = (v) => v.every((x, k) => x >= box.min[k] && x <= box.max[k]);
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    if (m.some((x, i) => x !== (i % 5 === 0 ? 1 : 0))) throw new Error(`crop expects identity node transforms (${node.getName()})`);
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      const src = idx.getArray();
      const out = [];
      const v = [0, 0, 0];
      for (let t = 0; t < src.length; t += 3) {
        let ok = true;
        for (let k = 0; k < 3 && ok; k++) ok = inside(pos.getElement(src[t + k], v));
        if (ok) out.push(src[t], src[t + 1], src[t + 2]);
        else dropped++;
      }
      kept += out.length / 3;
      idx.setArray(new Uint32Array(out));
    }
  }
  return { kept, dropped };
}

/** The optimize.mjs per-model pipeline (non-rigged branch) on an already-read document. */
async function optimizeLikeArchive(io, doc, inputSize) {
  const aggressive = inputSize > SIZE_THRESHOLD;
  const simplifyOpts = aggressive
    ? { simplifier: MeshoptSimplifier, ratio: 0.25, error: 0.01 }
    : { simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.001 };
  await doc.transform(
    unpartition(),
    weld(),
    simplify(simplifyOpts),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 80, resize: [2048, 2048] }),
    prune(), // not in optimize.mjs: drops the now-unreferenced morph-target accessors
  );
  await doc.transform(draco());
  return { glb: await io.writeBinary(doc), simplify: aggressive ? 'ratio 0.25, error 0.01 (input > 30 MB)' : 'ratio 0.5, error 0.001' };
}

/** Facts the engine and renderer need without loading the GLB: geometry stats and the scene bounds. */
async function describe(io, file) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  let triangles = 0, morphTargets = 0;
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
    const idx = p.getIndices();
    triangles += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3;
    morphTargets += p.listTargets().length;
  }
  const b = getBounds(root.getDefaultScene() ?? root.listScenes()[0]);
  const r = (v) => v.map((x) => Math.round(x * 1e5) / 1e5);
  return {
    triangles: Math.round(triangles),
    morphTargets,
    skins: root.listSkins().length,
    animations: root.listAnimations().length,
    textures: root.listTextures().map((t) => `${t.getMimeType()} ${(t.getSize() ?? []).join('x')}`),
    extensions: root.listExtensionsUsed().map((e) => e.extensionName).sort(),
    bounds: { min: r(b.min), max: r(b.max) },
  };
}

async function main() {
  if (!fs.existsSync(path.join(ARCHIVE, 'manifest.json'))) throw new Error(`archive not found at ${ARCHIVE}`);
  fs.mkdirSync(path.join(OUT, 'kin'), { recursive: true });
  const archive = JSON.parse(fs.readFileSync(path.join(ARCHIVE, 'manifest.json'), 'utf8'));
  const byId = new Map(archive.models.map((m) => [m.id, m]));

  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  });

  const entries = [];
  for (const [group, list] of [['floater', CHARACTERS], ['kin', KIN]]) {
    for (const src of list) {
      const meta = byId.get(src.archiveId);
      if (!meta) throw new Error(`${src.archiveId} missing from archive manifest`);
      const rel = group === 'kin' ? `kin/${src.id}.glb` : `${src.id}.glb`;
      const out = path.join(OUT, rel);
      const webFile = path.join(ARCHIVE, 'web', `${src.archiveId}.glb`);
      const canonical = path.join(ARCHIVE, meta.path);
      let process_;
      if (src.rebuild) {
        const inStat = fs.statSync(canonical);
        if (FORCE || !fs.existsSync(out)) {
          const doc = await readDocument(io, canonical);
          const stripped = stripMorphsAndAnimations(doc);
          const { glb, simplify: s } = await optimizeLikeArchive(io, doc, inStat.size);
          fs.writeFileSync(out, glb);
          console.log(`${src.id}: rebuilt from canonical ${mb(inStat.size)} MB → ${mb(glb.length)} MB (stripped ${stripped.targets} morph targets, ${stripped.animations} animations)`);
        } else console.log(`${src.id}: exists, skipping rebuild (--force to redo)`);
        process_ = {
          kind: 'rebuilt',
          from: `3d-models/${meta.path}`,
          fromBytes: inStat.size,
          fromSha256: sha256(fs.readFileSync(canonical)),
          steps: [
            'strip all morph targets, mesh/node weights, extras.targetNames and animations (104 targets, 2 animations in the canonical scan)',
            'optimize.mjs pipeline re-implemented: unpartition, weld, simplify (meshopt; input > 30 MB → ratio 0.25, error 0.01), textures → WebP q80 max 2048 px, Draco',
            'prune() added so stripped target accessors are not written',
          ],
          note: 'archive web/verdelis--characters.glb is NOT used: it still carries the 104 morph targets (~32 MB)',
          archiveWebSha256: sha256(fs.readFileSync(webFile)),
        };
      } else if (src.crop) {
        const buf = fs.readFileSync(webFile);
        const doc = await io.read(webFile);
        const c = cropToBox(doc, src.crop.box);
        await doc.transform(prune(), weld());
        const glb = await io.writeBinary(doc);
        fs.writeFileSync(out, glb);
        console.log(`${src.id}: web/${src.archiveId}.glb cropped (${c.kept} triangles kept, ${c.dropped} dropped) → ${mb(glb.length)} MB`);
        process_ = {
          kind: 'cropped-copy',
          from: `3d-models/web/${src.archiveId}.glb`,
          fromBytes: buf.length,
          fromSha256: sha256(buf),
          steps: [`drop triangles outside box min ${JSON.stringify(src.crop.box.min)} max ${JSON.stringify(src.crop.box.max)} (${c.dropped} of ${c.kept + c.dropped})`, 'prune, weld; geometry re-encoded with Draco; textures untouched'],
          note: src.crop.why,
        };
      } else {
        const buf = fs.readFileSync(webFile);
        if (FORCE || !fs.existsSync(out) || sha256(fs.readFileSync(out)) !== sha256(buf)) fs.writeFileSync(out, buf);
        console.log(`${src.id}: copied web/${src.archiveId}.glb (${mb(buf.length)} MB)`);
        process_ = { kind: 'copy', from: `3d-models/web/${src.archiveId}.glb`, note: 'byte-exact copy of the archive web-ready variant (archive tools/optimize.mjs output)' };
      }
      const bytes = fs.readFileSync(out);
      entries.push({
        id: src.id,
        group,
        name: src.name,
        file: rel,
        bytes: bytes.length,
        sha256: sha256(bytes),
        source: {
          archive: '<lm-3d-models> (read-only)',
          archiveId: src.archiveId,
          title: meta.title,
          canonicalPath: `3d-models/${meta.path}`,
          aka: meta.aka ?? [],
          archiveNotes: meta.notes ?? null,
          process: process_,
        },
        license: LICENSE,
        facing: src.facing,
        ...(src.pronouns ? { pronouns: src.pronouns } : {}),
        lore: src.lore,
        model: await describe(io, out),
      });
    }
  }
  const manifest = {
    schema: 'littlemartians-characters/1',
    generatedBy: 'tools/floaters/build-assets.mjs',
    note: 'Static scanned heads for the floater body family: no rig, no skins, no morph targets; bob, tilt and yaw are applied in code (mars/viewer/engine/bodies/pose.ts).',
    facingConvention: 'facing.yaw (radians, about +Y) is applied to the loaded glTF scene inside an orientation group, exactly as flock.html ORIENT does, so the face points along the group\'s -Z travel direction.',
    totalBytes: entries.reduce((s, e) => s + e.bytes, 0),
    models: entries,
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`manifest: ${entries.length} models, ${mb(manifest.totalBytes)} MB total`);
}

main().catch((err) => { console.error(err); process.exit(1); });
