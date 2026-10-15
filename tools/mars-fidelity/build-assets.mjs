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
// Explicit recipe-loader inventory, verified against the read-only Mars recipe.
// `fork-backdrop.mjs` strips Three maps before export and embeds their pixels
// afterward, without baking Texture.flipY=true into UVs. Original CAD maps are
// restored from their own glTF records and must not be flipped by this correction.
const PHOTO_TARGETS = {
  mimos: [
    ['Mimos photographed burgundy floor rug', 'owner-derived-material-128', '/history/2026/home/mimos-rug.webp', 'details-2026-mimos-home.ts:16,46'],
    ['Mimos main north plywood wall', 'owner-derived-material-201', '/modular/textures/kitchen-plywood-sample.jpg', 'details-2026-true-compass.ts:107,109; kit.ts:mat'],
  ],
  chiba: [
    ['cad-3c1d436f145625016', 'c50158 plain upper plywood above lower pixel bank', '/history/2026/accuracy/stair-upper-native-plywood.webp', 'details-2026-facade.ts:123,124; selected native photo faces only'],
    ['cad-d298c30b11df08016', 'c50158 native upper black abstract on plywood', '/history/2026/accuracy/stair-upper-abstract-native.webp', 'details-2026-facade.ts:115,117; UV V increases with world Y'],
    ['cad-c04cdcf6976fce002_1', '2026 west upper wall · native t23 photograph', '/history/2026/review-20260929/chiba-west-upper-wall.webp', 'details-2026-facade.ts:24,37; UV V increases with world Y'],
    ['Chiba native white black pixel fascia c50158', 'owner-derived-material-22', '/history/2026/accuracy/stair-white-pixel-motif.webp', 'details-2026-facade.ts:107'],
    ['Chiba gallery native c80 installation panel 0', 'owner-derived-material-232', '/history/2026/accuracy/upper-native-black-paint.webp', 'details-2026-auditorium.ts:125'],
    ['Chiba gallery native c80 installation panel 1', 'owner-derived-material-234', '/history/2026/accuracy/upper-native-green-paint.webp', 'details-2026-auditorium.ts:125'],
    ['auditorium upper gallery source portrait', '2026 auditorium source portrait c33334', '/history/2026/auditorium-source-portrait.webp', 'details-2026-auditorium.ts:102'],
  ],
  kitchen: [
    ['diner native blue wall plywood patch diner-large-wood-patch', 'owner-derived-material-78', '/history/2026/accuracy/diner-large-wood-patch.webp', 'details-2026-chiba.ts:329'],
    ['diner native blue wall plywood patch diner-small-wood-patch', 'owner-derived-material-79', '/history/2026/accuracy/diner-small-wood-patch.webp', 'details-2026-chiba.ts:329'],
    ['kitchen diner entry tread', 'owner-derived-material-201', '/modular/textures/kitchen-plywood-sample.jpg', 'details-2026-true-compass.ts:107,118; kit.ts:mat'],
  ],
  freeside: [
    ['Freeside native LOTA BREAD sign c50121', 'owner-derived-material-323', '/history/2026/accuracy/freeside-native-bread-sign.webp', 'details-2026-compound.ts:85'],
    ['CoLab native patterned left curtain c47830', 'owner-derived-material-383', '/history/2026/accuracy/colab-native-curtain.webp', 'details-2026-compound.ts:223'],
    ['Freeside native north entry paint c22', 'owner-derived-material-394', '/history/2026/accuracy/freeside-native-entry-paint.webp', 'details-2026-compound.ts:257'],
  ],
  showers: [
    ['Shower wooden floor slab', 'owner-derived-material-203', '/modular/textures/kitchen-plywood-sample.jpg', 'details-2026-showers.ts:15,19,24-29; kit.ts:mat; merged source plywood floor/wall group'],
    ['Shower timber roof', 'owner-derived-material-203', '/modular/textures/kitchen-plywood-sample.jpg', 'details-2026-showers.ts:15,30; kit.ts:mat'],
  ],
  'toilet-1': [['toilet source native sanitation label', 'owner-derived-material-476', '/history/2026/accuracy/toilet-native-sign.webp', 'details-2026-ground-life.ts:46']],
  'tool-library-bookshelf-timber': [['Tool library native book spines c73776', 'owner-derived-material-285', '/history/2026/accuracy/tool-library-books.webp', 'details-2026-tool-library.ts:13']],
};
const EXCEPTIONS = [
  { asset: 'mimos', nodes: ['Mimos photographed cutout sign', 'Mimos photographed framed gallery', 'Mimos native Portuguese love posters c49417'], reason: 'Already geometrically V-corrected in shipped build.mjs WORLD_FIX. Retain their UVs/transforms exactly to avoid a double flip.' },
  { nodes: 'all original CAD material maps', reason: 'Copied from original glTF with original UV convention; not recipe TextureLoader maps.' },
  { asset: 'showers', nodes: 'non-recipe parity-added plywood maps', reason: 'Do not infer flipY from wood appearance or apply a global material/image flip. Only the two named source recipe slab/roof nodes are corrected.' },
];
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
function fingerprint(doc, uvNames) {
  return JSON.stringify(doc.getRoot().listNodes().filter((n) => n.getMesh() && n.getName() !== DRAPE_NAME).map((n) => ({
    name: n.getName(), matrix: n.getWorldMatrix(), primitives: n.getMesh().listPrimitives().map((p) => ({
      attrs: Object.fromEntries(p.listSemantics().filter((s) => !(uvNames.has(n.getName()) && s === 'TEXCOORD_0')).map((s) => [s, arrHash(p.getAttribute(s))])), indices: arrHash(p.getIndices()), material: p.getMaterial()?.getName(),
    })),
  })));
}
function materials(doc) {
  const texture = (t) => t ? sha(t.getImage()) : null;
  return JSON.stringify(doc.getRoot().listMaterials().map((m) => ({
    name: m.getName(), color: m.getBaseColorFactor(), roughness: m.getRoughnessFactor(), metalness: m.getMetallicFactor(), emissive: m.getEmissiveFactor(), alpha: m.getAlphaMode(), cutoff: m.getAlphaCutoff(), doubleSided: m.getDoubleSided(), normalScale: m.getNormalScale(), occlusion: m.getOcclusionStrength(),
    textures: [m.getBaseColorTexture(), m.getMetallicRoughnessTexture(), m.getEmissiveTexture(), m.getNormalTexture(), m.getOcclusionTexture()].map(texture),
  })));
}
function addDrape(doc) {
  const nodes = doc.getRoot().listNodes().filter((n) => n.getName() === DRAPE_NAME);
  assert.equal(nodes.length, 1, 'exactly one named Mimos drape');
  const node = nodes[0], oldMesh = node.getMesh(), old = oldMesh.listPrimitives()[0], pos = old.getAttribute('POSITION');
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], v = [];
  for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], v[j]); hi[j] = Math.max(hi[j], v[j]); } }
  const P = [], N = [], I = [], nx = 64, nz = 12, xmid = (lo[0] + hi[0]) / 2, xhalf = (hi[0] - lo[0]) / 2, depth = hi[2] - lo[2];
  const normalScale = node.getScale()[1], gatherDepthM = .09, halfThicknessM = .0015;
  assert(normalScale > 0, 'positive source drape scale');
  assert(!old.getMaterial().getExtension('KHR_materials_unlit'), 'keep the existing lit cloth material');
  // f_040 / f_117 show a brown swag, attached high at the sides, with diagonal
  // gathers and a lower centre. Keep the whole building bounds and footprint,
  // allowing the fabric to gather outward by 9 cm instead of constraining it to
  // the old 2 cm slab. Narrow side hems retain the attachment corners.
  // Both broad surfaces are actual geometry, with no cloth simulation or shadows.
  const surface = (s, t, side) => {
    const gather = Math.max(0, 1 - s * s), top = lo[2] + depth * .30 * gather;
    const bottom = hi[2] - depth * .25 * (1 - gather);
    const z = top + (bottom - top) * t;
    // Long diagonal gathers curve toward the held ends, as in f117. The folds
    // billow to the outer side of the glazing rather than through the glass.
    const pleat = Math.sin(2 * Math.PI * (3.3 * t + 1.10 * Math.sqrt(s * s + .03) + .28 * s * t));
    const attachmentTaper = gather * Math.sin(Math.PI * t);
    const y = (gatherDepthM * (.5 + .5 * pleat) * attachmentTaper + side * halfThicknessM) / normalScale;
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
  // Thin side hems retain the four front/back attachment corners, without
  // restoring a flat rectangular face across the cloth.
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
  const clothMin = [Infinity, Infinity, Infinity], clothMax = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i++) { const k = i % 3; clothMin[k] = Math.min(clothMin[k], P[i]); clothMax[k] = Math.max(clothMax[k], P[i]); }
  return { name: DRAPE_NAME, segments: [nx, nz], triangles: I.length / 3, maxOutwardGatherDepthM: gatherDepthM, fabricThicknessM: 2 * halfThicknessM, material: 'unchanged lit MeshStandard/PBR material, roughness 0.86; no unlit extension', sourceClothLocalEnvelope: { min: lo, max: hi }, finalClothLocalEnvelope: { min: clothMin, max: clothMax }, retained: 'exact whole-building bounds and footprint; cloth attachment corners; all non-cloth geometry', reference: 'team/lanes/marsland-frames/f_040.jpg and f_117.jpg; sag/diagonal gathers fitted, not surveyed' };
}
function fixPhotos(doc, targets) {
  const result = [];
  const seenMeshes = new Set();
  for (const [name, material, sourceImage, sourceCode] of targets) {
    const matches = doc.getRoot().listNodes().filter((n) => n.getName() === name);
    assert.equal(matches.length, 1, `exactly one source recipe node: ${name}`);
    const node = matches[0];
    const mesh = node.getMesh();
    assert(!seenMeshes.has(mesh), 'recipe targets must not share a mesh (would double-flip UVs)'); seenMeshes.add(mesh);
    const beforeUV = [], afterUV = [];
    for (const p of mesh.listPrimitives()) {
      assert.equal(p.getMaterial()?.getName(), material, `${name}: known recipe material`);
      assert(p.getMaterial()?.getBaseColorTexture(), `${name}: recipe image exists`);
      const original = p.getAttribute('TEXCOORD_0'); assert(original, 'photo UVs');
      const values = [], uv = [];
      for (let i = 0; i < original.getCount(); i++) { original.getElement(i, uv); beforeUV.push([...uv]); values.push(uv[0], 1 - uv[1]); }
      const fixed = new Float32Array(values); afterUV.push(...fixed);
      p.setAttribute('TEXCOORD_0', doc.createAccessor(`${node.getName()} upright UV`).setType('VEC2').setArray(fixed).setBuffer(doc.getRoot().listBuffers()[0]));
    }
    result.push({ name, material, sourceImage, sourceCode, vertices: beforeUV.length, beforeUVHash: sha(JSON.stringify(beforeUV)), afterUVHash: sha(JSON.stringify(afterUV)), correction: 'V = 1 - V; compensate for the recipe TextureLoader flipY omitted by manual image embed; U, positions, normals, indices, materials and image pixels unchanged' });
  }
  assert.equal(result.length, targets.length, 'every explicit recipe image target corrected');
  return result;
}

const assets = {}, defs = [], changes = [], inventory = [];
for (const [name, targets] of Object.entries(PHOTO_TARGETS)) {
  const def = kit.find((d) => d.name === `core-mars-${name}` && d.version === 2); assert(def, 'shipped @2 def');
  const input = join(ROOT, `worlds/core-assets/mars/${name}.glb`), source = readFileSync(input), sourceSha = sha(source);
  assert.equal(sourceSha, def.make.asset, 'input must be the shipped content-addressed asset'); inputHashes[relative(ROOT, input)] = sourceSha;
  const doc = await io.readBinary(source), uvNames = new Set(targets.map(([n]) => n));
  const targetMaterials = new Set(targets.map(([, material]) => material));
  const recipeNodes = doc.getRoot().listNodes().filter((n) => n.getMesh()?.listPrimitives().some((p) => p.getMaterial()?.getBaseColorTexture() && (p.getMaterial().getName().startsWith('owner-derived-material-') || targetMaterials.has(p.getMaterial().getName())))).map((n) => n.getName());
  const excepted = name === 'mimos' ? EXCEPTIONS[0].nodes : [];
  assert.deepEqual([...recipeNodes].sort(), [...uvNames, ...excepted].sort(), `${name}: complete explicit source recipe image inventory`);
  inventory.push({ name, sourceRecipeImageNodes: recipeNodes.length, correctedNodes: targets.length, excludedNodes: excepted });
  const before = fingerprint(doc, uvNames), textureHashes = doc.getRoot().listTextures().map((t) => sha(t.getImage())), originalMaterials = materials(doc);
  const changed = { ...(name === 'mimos' ? { drape: addDrape(doc) } : {}), photos: fixPhotos(doc, targets) };
  assert.equal(fingerprint(doc, uvNames), before, 'all non-drape geometry/transforms and non-target UVs unchanged');
  assert.equal(materials(doc), originalMaterials, 'all material properties unchanged');
  // The original meshes are already quantized. Re-encode losslessly, without a
  // global quantize/reorder/simplify that would change unrelated campus geometry.
  const compression = doc.getRoot().listExtensionsUsed().find((e) => e.extensionName === 'EXT_meshopt_compression') ?? doc.createExtension(ext.EXTMeshoptCompression);
  compression.setRequired(true).setEncoderOptions({ method: ext.EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const bytes = await io.writeBinary(doc), output = join(OUT, `${name}.glb`), hash = sha(bytes), facts = measureGlb(bytes), originalFacts = measureGlb(source);
  assert.equal(sha(await io.writeBinary(doc)), hash, `${name}: deterministic lossless encoding`);
  const decoded = await io.readBinary(bytes);
  assert.equal(fingerprint(decoded, uvNames), before, 'encoded non-drape geometry and non-target UVs remain exact');
  assert.equal(materials(decoded), originalMaterials, 'encoded material properties unchanged');
  for (const photo of changed.photos) {
    const node = decoded.getRoot().listNodes().find((n) => n.getName() === photo.name), values = [], uv = [];
    for (const p of node.getMesh().listPrimitives()) for (let i = 0; i < p.getAttribute('TEXCOORD_0').getCount(); i++) { p.getAttribute('TEXCOORD_0').getElement(i, uv); values.push(...uv); }
    assert.equal(sha(JSON.stringify(values)), photo.afterUVHash, `${photo.name}: exact corrected UVs after encoding`);
  }
  assert.deepEqual(decoded.getRoot().listTextures().map((t) => sha(t.getImage())), textureHashes, 'native source image pixels unchanged');
  for (const key of ['min', 'max']) for (let i = 0; i < 3; i++) assert(Math.abs(facts[key][i] - originalFacts[key][i]) < 1e-5, `${name}: unchanged full mesh ${key}[${i}]`);
  assert.equal(facts.tris, originalFacts.tris + (name === 'mimos' ? changed.drape.triangles - 12 : 0), 'UV corrections add no geometry; only cloth triangles change');
  const grandfathered = originalFacts.tris > 80000 || originalFacts.bytes > 3000000;
  assert(facts.tris <= (grandfathered ? 200000 : 80000) && facts.bytes <= (grandfathered ? 6000000 : 3000000) && facts.texPx <= 2048, 'Mars world ingest budget; preserve only demonstrated grandfathered source assets');
  write(output, bytes);
  const { max, meshes, skins, ...indexFacts } = facts;
  assets[hash] = { ...originals[sourceSha], ...indexFacts, path: relative(ROOT, output), source: `${originals[sourceSha].source}; bounded cosmetic correction by tools/mars-fidelity/build-assets.mjs`, footprint: def.make.footprint };
  const updated = structuredClone(def); updated.make.asset = hash;
  updated.description += ` Cosmetic correction (2026-10-15): ${targets.length} native recipe image node${targets.length === 1 ? '' : 's'} has the source TextureLoader orientation restored by a V correction; original pixels, geometry and physical layout retained.${name === 'mimos' ? ' The brown glazing cloth has a sagged upper edge and diagonal gathers up to 9 cm outward, fitted to drone f040/f117; its whole-building envelope and physical footprint are retained.' : ''}`;
  defs.push(updated);
  changes.push({ name, originalAsset: sourceSha, asset: hash, affectedRecipeImageNodes: targets.length, grandfatheredSourceBudget: grandfathered, before: { tris: originalFacts.tris, bytes: originalFacts.bytes }, after: { tris: facts.tris, bytes: facts.bytes, box: facts.box, min: facts.min, max: facts.max }, changed });
}
const index = { schema: 'core-assets/1', note: 'Bounded Mars cosmetic variants; no original asset or footprint overwritten. Generated by tools/mars-fidelity/build-assets.mjs.', assets };
json(join(ROOT, 'worlds/core-assets/mars-fidelity.index.json'), index);
json(join(OUT, 'index.part.json'), { ...index, schema: 'core-assets-part/1' });
json(join(OUT, 'defs.json'), defs);
json(join(OUT, 'RECEIPT.json'), { schema: 'mars-fidelity-assets/1', inventory: { recipeTexturedNodes: inventory.reduce((n, i) => n + i.sourceRecipeImageNodes, 0), correctedImageNodes: changes.reduce((n, c) => n + c.affectedRecipeImageNodes, 0), excludedPreviouslyCorrectedNodes: 3, assetVariants: changes.length, clothNodes: 1, byAsset: inventory }, exceptions: EXCEPTIONS, inputs: inputHashes, changes, checks: ['exact input hashes', 'complete explicit source recipe image inventory', 'deterministic lossless encoding', 'exact all non-drape geometry/transforms after encoding', 'exact all non-target UVs including 3 already-corrected Mimos photos', 'exact material properties and native image bytes', 'full asset bounds within 0.00001m', 'footprint refs unchanged', 'UV changes add zero triangles', '80k triangles / 3MB default; unchanged-source Freeside grandfathered under Mars world 200k / 6MB; all textures <=2048px'], note: 'defs.json contains cosmetic variant inputs for tools/mars-fidelity/patch.mjs. The patch derives world-local names; these inputs are not a public core-library redefinition batch. Source recipe/code references are under the read-only <mars-campus-repo>/viewer/app/history/.' });
for (const [path, hash] of Object.entries(inputHashes)) assert.equal(sha(readFileSync(join(ROOT, path))), hash, 'source asset unchanged');
console.log(JSON.stringify({ checked: check, imageNodes: changes.reduce((n, c) => n + c.affectedRecipeImageNodes, 0), changes: changes.map((c) => ({ name: c.name, asset: c.asset, photoNodes: c.affectedRecipeImageNodes, tris: c.after.tris, bytes: c.after.bytes, grandfathered: c.grandfatheredSourceBudget })), written }, null, 2));
