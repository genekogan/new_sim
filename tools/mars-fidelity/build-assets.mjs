#!/usr/bin/env node
// Bounded cosmetic variants of the shipped Mars meshes. No source reconstruction,
// footprint, existing library def, or old content-addressed asset is rewritten.
//   node tools/mars-fidelity/build-assets.mjs [--check]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { core, ext } from '../god-skill/scripts/mars-two/v3.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'worlds/core-assets/mars-fidelity');
const { MeshoptEncoder, MeshoptDecoder } = await import(join(ROOT, 'node_modules/.pnpm/meshoptimizer@1.3.0/node_modules/meshoptimizer/index.js'));
const { measureGlb } = await import(join(ROOT, 'apps/server/src/god/assets.ts'));
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new core.NodeIO().registerExtensions(ext.ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const sha = (b) => createHash('sha256').update(b).digest('hex');
const check = process.argv.includes('--check');
if (!check) mkdirSync(OUT, { recursive: true });
const kit = JSON.parse(readFileSync(join(ROOT, 'packages/world-compiler/src/core-kit/mars.json'), 'utf8'));
const originals = JSON.parse(readFileSync(join(ROOT, 'worlds/core-assets/mars/index.part.json'), 'utf8')).assets;
const PHOTO_NAMES = new Set(['Chiba gallery native c80 installation panel 0', 'Chiba gallery native c80 installation panel 1', 'auditorium upper gallery source portrait']);
const DRAPE_NAME = 'Mimos glazing brown drape';
const inputHashes = {};
const written = [];
const write = (path, data) => {
  if (check) assert(existsSync(path) && sha(readFileSync(path)) === sha(data), `${relative(ROOT, path)} is out of date`);
  else writeFileSync(path, data);
  written.push(relative(ROOT, path));
};
const json = (path, data) => write(path, JSON.stringify(data, null, 1) + '\n');
const arrHash = (a) => a ? sha(new Uint8Array(a.getArray().buffer, a.getArray().byteOffset, a.getArray().byteLength)) : null;
// Compare decoded geometry, transforms and texture pixels before/after encoding.
// All non-target geometry must remain byte-exact; meshopt is used losslessly here.
function fingerprint(doc, excluded) {
  return JSON.stringify(doc.getRoot().listNodes().filter((n) => n.getMesh() && !excluded.has(n.getName())).map((n) => ({
    name: n.getName(), matrix: n.getWorldMatrix(), primitives: n.getMesh().listPrimitives().map((p) => ({
      attrs: Object.fromEntries(p.listSemantics().map((s) => [s, arrHash(p.getAttribute(s))])), indices: arrHash(p.getIndices()), material: p.getMaterial()?.getName(),
    })),
  })));
}
function addDrape(doc) {
  const nodes = doc.getRoot().listNodes().filter((n) => n.getName() === DRAPE_NAME);
  assert.equal(nodes.length, 1, 'exactly one named Mimos drape');
  const node = nodes[0], oldMesh = node.getMesh(), old = oldMesh.listPrimitives()[0], pos = old.getAttribute('POSITION');
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], v = [];
  for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], v[j]); hi[j] = Math.max(hi[j], v[j]); } }
  const P = [], N = [], I = [], nx = 64, nz = 12, xmid = (lo[0] + hi[0]) / 2, xhalf = (hi[0] - lo[0]) / 2, depth = hi[2] - lo[2], yhalf = (hi[1] - lo[1]) / 2;
  // f_040 / f_117 show a brown swag, attached high at the sides, with diagonal
  // gathers and a lower centre. Keep the old slab's complete envelope: the two
  // narrow side hems retain its original corners; the sheet hangs between them.
  // Both broad surfaces are actual geometry, with no cloth simulation or shadows.
  const surface = (s, t, side) => {
    const gather = Math.max(0, 1 - s * s), top = lo[2] + depth * .30 * gather;
    const bottom = hi[2] - depth * .25 * (1 - gather);
    const z = top + (bottom - top) * t;
    const pleat = Math.sin(2 * Math.PI * (9 * (s + 1) / 2 + .18 * (t - .5) * s));
    // Smoothly gather into the held edges, and remain inside the original 2 cm thickness.
    const y = yhalf * (.64 * side + .35 * pleat * Math.sin(Math.PI * t) * gather);
    return [xmid + xhalf * s, y, z];
  };
  const dot = (a, b) => a.reduce((n, x, i) => n + x * b[i], 0);
  const sub = (a, b) => a.map((x, i) => x - b[i]);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  for (const side of [1, -1]) {
    const base = P.length / 3;
    for (let iz = 0; iz <= nz; iz++) for (let ix = 0; ix <= nx; ix++) {
      const s = -1 + 2 * ix / nx, t = iz / nz, p = surface(s, t, side);
      const ds = sub(surface(Math.min(1, s + .0001), t, side), surface(Math.max(-1, s - .0001), t, side));
      const dt = sub(surface(s, Math.min(1, t + .0001), side), surface(s, Math.max(0, t - .0001), side));
      let n = cross(dt, ds); const length = Math.sqrt(dot(n, n)); n = n.map((x) => x / length * side);
      P.push(...p); N.push(...n);
    }
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const a = base + iz * (nx + 1) + ix, b = a + 1, c = a + nx + 1, d = c + 1;
      I.push(...(side === 1 ? [a, c, b, b, c, d] : [a, b, c, b, d, c]));
    }
  }
  // Thin side hems retain the four front/back attachment corners and the exact
  // original AABB, without restoring a flat rectangular face across the cloth.
  for (const sign of [-1, 1]) {
    const xs = sign < 0 ? [lo[0], lo[0] + (hi[0] - lo[0]) * .004] : [hi[0] - (hi[0] - lo[0]) * .004, hi[0]];
    for (const side of [1, -1]) {
      const base = P.length / 3, y = side > 0 ? hi[1] : lo[1];
      for (const [x, z] of [[xs[0], lo[2]], [xs[1], lo[2]], [xs[0], hi[2]], [xs[1], hi[2]]]) { P.push(x, y, z); N.push(0, side, 0); }
      I.push(...(side === 1 ? [base, base + 2, base + 1, base + 1, base + 2, base + 3] : [base, base + 1, base + 2, base + 1, base + 3, base + 2]));
    }
  }
  const buffer = doc.getRoot().listBuffers()[0];
  const primitive = doc.createPrimitive().setMaterial(old.getMaterial()).setAttribute('POSITION', doc.createAccessor('Mars cloth positions').setType('VEC3').setArray(new Float32Array(P)).setBuffer(buffer)).setAttribute('NORMAL', doc.createAccessor('Mars cloth normals').setType('VEC3').setArray(new Float32Array(N)).setBuffer(buffer)).setIndices(doc.createAccessor('Mars cloth triangles').setType('SCALAR').setArray(new Uint16Array(I)).setBuffer(buffer));
  const mesh = doc.createMesh('Mimos brown gathered cloth').addPrimitive(primitive);
  node.setMesh(mesh); oldMesh.dispose();
  return { name: DRAPE_NAME, segments: [nx, nz], triangles: I.length / 3, localEnvelope: { min: lo, max: hi }, reference: 'team/lanes/marsland-frames/f_040.jpg and f_117.jpg; sag/pleats fitted, not surveyed' };
}
function fixPhotos(doc) {
  const result = [];
  for (const node of doc.getRoot().listNodes().filter((n) => PHOTO_NAMES.has(n.getName()))) {
    const mesh = node.getMesh();
    for (const p of mesh.listPrimitives()) {
      const original = p.getAttribute('TEXCOORD_0'); assert(original, 'photo UVs');
      const values = [], uv = [];
      for (let i = 0; i < original.getCount(); i++) { original.getElement(i, uv); values.push(uv[0], 1 - uv[1]); }
      p.setAttribute('TEXCOORD_0', doc.createAccessor(`${node.getName()} upright UV`).setType('VEC2').setArray(new Float32Array(values)).setBuffer(doc.getRoot().listBuffers()[0]));
    }
    result.push({ name: node.getName(), correction: 'V = 1 - V; top of each native photo now maps to top of the mounted quad; U and geometry unchanged' });
  }
  assert.equal(result.length, 3, 'the three known Chiba native-photo quads');
  return result;
}

const assets = {}, defs = [], changes = [];
for (const name of ['mimos', 'chiba']) {
  const def = kit.find((d) => d.name === `core-mars-${name}` && d.version === 2); assert(def, 'shipped @2 def');
  const input = join(ROOT, `worlds/core-assets/mars/${name}.glb`), source = readFileSync(input), sourceSha = sha(source);
  assert.equal(sourceSha, def.make.asset, 'input must be the shipped content-addressed asset'); inputHashes[relative(ROOT, input)] = sourceSha;
  const doc = await io.readBinary(source), excluded = name === 'mimos' ? new Set([DRAPE_NAME]) : PHOTO_NAMES;
  const before = fingerprint(doc, excluded), textureHashes = doc.getRoot().listTextures().map((t) => sha(t.getImage()));
  const changed = name === 'mimos' ? addDrape(doc) : fixPhotos(doc);
  assert.equal(fingerprint(doc, excluded), before, 'untouched decoded geometry and transforms');
  // The original meshes are already quantized. Re-encode losslessly, without a
  // global quantize/reorder/simplify that would change unrelated campus geometry.
  const compression = doc.getRoot().listExtensionsUsed().find((e) => e.extensionName === 'EXT_meshopt_compression') ?? doc.createExtension(ext.EXTMeshoptCompression);
  compression.setRequired(true).setEncoderOptions({ method: ext.EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const bytes = await io.writeBinary(doc), output = join(OUT, `${name}.glb`), hash = sha(bytes), facts = measureGlb(bytes), originalFacts = measureGlb(source);
  const decoded = await io.readBinary(bytes);
  assert.equal(fingerprint(decoded, excluded), before, 'encoded untouched geometry remains exact');
  assert.deepEqual(decoded.getRoot().listTextures().map((t) => sha(t.getImage())), textureHashes, 'native source image pixels unchanged');
  for (const key of ['min', 'max']) for (let i = 0; i < 3; i++) assert(Math.abs(facts[key][i] - originalFacts[key][i]) < 1e-5, `${name}: unchanged full mesh ${key}[${i}]`);
  assert(facts.tris <= 80000 && facts.bytes <= 3000000 && facts.texPx <= 2048, 'default ingest budget');
  write(output, bytes);
  const { max, meshes, skins, ...indexFacts } = facts;
  assets[hash] = { ...originals[sourceSha], ...indexFacts, path: relative(ROOT, output), source: `${originals[sourceSha].source}; bounded cosmetic correction by tools/mars-fidelity/build-assets.mjs`, footprint: def.make.footprint };
  const updated = structuredClone(def); updated.make.asset = hash;
  updated.description += name === 'mimos' ? ' Cosmetic correction (2026-10-15): the brown glazing cloth has a sagged upper edge and fine gathered folds, fitted to drone f040/f117; original footprint retained.' : ' Cosmetic correction (2026-10-15): the three native upper-gallery photos display upright, with original source pixels, mounting positions and footprint retained.';
  defs.push(updated);
  changes.push({ name, originalAsset: sourceSha, asset: hash, before: { tris: originalFacts.tris, bytes: originalFacts.bytes }, after: { tris: facts.tris, bytes: facts.bytes, box: facts.box, min: facts.min, max: facts.max }, changed });
}
const index = { schema: 'core-assets/1', note: 'Bounded Mars cosmetic variants; no original asset or footprint overwritten. Generated by tools/mars-fidelity/build-assets.mjs.', assets };
json(join(ROOT, 'worlds/core-assets/mars-fidelity.index.json'), index);
json(join(OUT, 'index.part.json'), { ...index, schema: 'core-assets-part/1' });
json(join(OUT, 'defs.json'), defs);
json(join(OUT, 'RECEIPT.json'), { schema: 'mars-fidelity-assets/1', inputs: inputHashes, changes, checks: ['exact input hashes', 'exact non-target geometry/transforms after encoding', 'exact native texture image bytes', 'full asset bounds within 0.00001m', 'footprint refs unchanged', 'default 80k triangle / 3MB / 2048px budgets'], note: 'defs.json contains cosmetic variant inputs for tools/mars-fidelity/patch.mjs. The patch derives world-local names; these inputs are not a public core-library redefinition batch.' });
for (const [path, hash] of Object.entries(inputHashes)) assert.equal(sha(readFileSync(join(ROOT, path))), hash, 'source asset unchanged');
console.log(JSON.stringify({ checked: check, changes, written }, null, 2));
