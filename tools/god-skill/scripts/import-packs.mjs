#!/usr/bin/env node
// Register the repo's CC0 model packs, Little Martians' two buildings (with footprints) and the six kin
// as core mesh defs (spec <eden4>/29 WP1b, 33 §2 row 1). Owner: L5.
//
//   node tools/god-skill/scripts/import-packs.mjs [--check]
//
// - Splits every pack GLB (`mars/viewer/public/modular/environment/eden-*.glb`) into one GLB per model
//   with @gltf-transform (other roots removed, the model's own clips kept and renamed `Idle`/`Walk`/…,
//   dog and cat turned so their front faces +z like every other def), written to
//   `worlds/core-assets/packs/<name>.glb`. Output is deterministic: same packs → same bytes → same shas.
// - LM buildings and kin are referenced as they are in `worlds/littlemartians/` (no copies).
// - Writes `worlds/core-assets/index.json` (sha → path, measurements, licence, source, footprint physics)
//   and `packages/world-compiler/src/core-kit/mesh.json` (the defs, `core-<name>` → `core/<name>@1`).
// `--check` rebuilds in memory and fails if either output would change (CI guard).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(join(root, 'apps/server/package.json'));
const { NodeIO, Logger } = require('@gltf-transform/core');
const { prune } = require('@gltf-transform/functions');
const { measureGlb, footprintToBaked } = await import(join(root, 'apps/server/src/god/assets.ts'));

const check = process.argv.includes('--check');
const PACK_DIR = join(root, 'mars/viewer/public/modular/environment');
const OUT_DIR = join(root, 'worlds/core-assets/packs');
const INDEX = join(root, 'worlds/core-assets/index.json');
const MESH_JSON = join(root, 'packages/world-compiler/src/core-kit/mesh.json');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const r3 = (v) => Math.round(v * 1000) / 1000;

const CC0 = (pack) => ({ license: 'CC0 1.0', source: pack });
const QUAT_ANIMALS = CC0('Quaternius Ultimate Animated Animals / Farm Animals (CC0), via mars/viewer/public/modular/environment/eden-animals.glb');
const NATURE = CC0('Quaternius Ultimate Nature + Kenney Nature Kit (CC0), via eden-nature.glb');
const CROPS = CC0('Quaternius Ultimate Crops (CC0), via eden-crops.glb');
const BOATS = CC0('Kenney Watercraft + Nature Kit canoe, Quaternius Ships + Public Transport (CC0), via eden-boats-bikes.glb');
const FOOD = CC0('Quaternius Ultimate Food + Kenney Food Kit (CC0), via eden-food.glb');
const INTERIOR = CC0('Quaternius Ultimate House Interior (CC0), via eden-interior.glb');
const LM_LICENSE = 'Vanessa Rosa (Little Martians); private to this project — not for redistribution outside it without the artist\'s permission';

// ---- the catalogue: which models become defs, and how they read in the library
// facing: yaw (radians about +y) that turns the model's front to +z. clips: source clip suffix → our clip name.
const animal = (model, d) => ({ pack: 'eden-animals.glb', model, name: `${model}-pack`, layer: 'decor', credit: QUAT_ANIMALS, scale: [0.4, 2.5], ...d, tags: ['animal', 'creature', 'pack', model, ...(d.tags ?? [])] });
const ANIMALS = [
  animal('cow', { description: 'A cow (rigged, Idle and Walk clips). Grazes in pastures.', tags: ['farm', 'cattle', 'livestock'], components: { behavior: { kind: 'graze', speed: 0.6, radius: 7 } } }),
  animal('horse', { description: 'A horse (rigged, Idle and Walk clips).', tags: ['farm', 'livestock', 'pony'], components: { behavior: { kind: 'graze', speed: 0.9, radius: 9 } } }),
  animal('llama', { description: 'A llama (rigged, Idle and Walk clips).', tags: ['farm', 'livestock', 'alpaca'], components: { behavior: { kind: 'graze', speed: 0.6, radius: 4 } } }),
  animal('pig', { description: 'A pig (rigged, Idle and Walk clips).', tags: ['farm', 'livestock'], components: { behavior: { kind: 'graze', speed: 0.45, radius: 4 } } }),
  animal('sheep', { description: 'A woolly sheep (rigged, Idle and Walk clips). Flocks graze meadows.', tags: ['farm', 'livestock', 'lamb'], components: { behavior: { kind: 'graze', speed: 0.5, radius: 6 } } }),
  animal('pug', { description: 'A pug, a small dog (rigged, Idle and Walk clips).', tags: ['pet', 'dog'], components: { behavior: { kind: 'wander', speed: 0.9, radius: 6 } } }),
  animal('dog', { description: 'A dog (rigged, Idle and Walk clips). Trots about town and gardens.', tags: ['pet', 'puppy'], facing: -Math.PI / 2, components: { behavior: { kind: 'wander', speed: 1.1, radius: 10 } } }),
  animal('cat', { description: 'A cat (rigged, Idle and Walk clips).', tags: ['pet', 'kitten'], facing: -Math.PI / 2, components: { behavior: { kind: 'wander', speed: 0.7, radius: 6 } } }),
  animal('fox', { description: 'A red fox (rigged, Walk clip). Woodland edges.', tags: ['wild', 'woodland'], components: { behavior: { kind: 'wander', speed: 0.9, radius: 10 } } }),
  animal('bird', { description: 'A small bird (rigged, Fly clip). Wheels over meadows.', tags: ['wild', 'flying', 'songbird'], components: { behavior: { kind: 'fly', speed: 6, radius: 18 } } }),
  animal('koi', { description: 'A koi carp (rigged, Swim clip). Swims just under a pond\'s surface.', tags: ['fish', 'water', 'pond'], anchor: 'float', components: { behavior: { kind: 'swim', speed: 0.6, radius: 4 } } }),
];
const nat = (model, name, description, tags, d = {}) => ({ pack: 'eden-nature.glb', model, name: `${name}-pack`, description, credit: NATURE, scale: [0.4, 2.5], ...d, tags: ['nature', 'pack', ...tags] });
const NATURE_DEFS = [
  nat('nat-commontree-1', 'oak-tree-1', 'A broad-leaved common tree (oak-like), about 6 m.', ['tree', 'plant', 'oak', 'commontree'], { anchor: 'base' }),
  nat('nat-commontree-2', 'oak-tree-2', 'A broad-leaved common tree, rounder crown.', ['tree', 'plant', 'oak', 'commontree']),
  nat('nat-commontree-3', 'oak-tree-3', 'A young common tree, slimmer.', ['tree', 'plant', 'oak', 'commontree']),
  nat('nat-commontree-autumn-1', 'autumn-tree-1', 'A common tree in autumn colours.', ['tree', 'plant', 'autumn', 'commontree']),
  nat('nat-commontree-autumn-2', 'autumn-tree-2', 'A common tree in autumn colours, rounder crown.', ['tree', 'plant', 'autumn', 'commontree']),
  nat('nat-birchtree-1', 'birch-tree-1', 'A white-barked birch.', ['tree', 'plant', 'birch']),
  nat('nat-birchtree-2', 'birch-tree-2', 'A white-barked birch, taller.', ['tree', 'plant', 'birch']),
  nat('nat-birchtree-autumn-1', 'birch-tree-autumn', 'A birch in autumn yellow.', ['tree', 'plant', 'birch', 'autumn']),
  nat('nat-willow-1', 'willow-tree-1', 'A weeping willow; good by water.', ['tree', 'plant', 'willow', 'water']),
  nat('nat-willow-2', 'willow-tree-2', 'A large weeping willow.', ['tree', 'plant', 'willow', 'water']),
  nat('nat-plant-1', 'bush-1', 'A low leafy bush.', ['bush', 'shrub', 'plant'], { layer: 'decor' }),
  nat('nat-plant-2', 'bush-2', 'A small round shrub.', ['bush', 'shrub', 'plant'], { layer: 'decor' }),
  nat('nat-plant-3', 'bush-3', 'A large-leaved plant.', ['bush', 'plant', 'fern'], { layer: 'decor' }),
  nat('nat-plant-4', 'bush-4', 'A bushy plant.', ['bush', 'shrub', 'plant'], { layer: 'decor' }),
  nat('nat-plant-5', 'bush-5', 'A tall leafy plant.', ['bush', 'plant'], { layer: 'decor' }),
  nat('nat-flowers', 'wildflowers', 'A clump of wildflowers.', ['flower', 'flowers', 'plant', 'garden'], { layer: 'decor' }),
  nat('nat-grass', 'grass-tuft', 'A tall grass tuft.', ['grass', 'plant'], { layer: 'decor' }),
  nat('nat-grass-short', 'grass-short', 'A short grass tuft.', ['grass', 'plant'], { layer: 'decor' }),
  nat('nat-lilypad', 'lilypad', 'A lily pad with a flower; floats on water.', ['water', 'pond', 'plant', 'flower'], { layer: 'decor', anchor: 'float' }),
  nat('nat-treestump-moss', 'mossy-stump', 'A mossy tree stump; a seat in the woods.', ['stump', 'treestump', 'wood', 'forest'], { slots: [{ id: 'seat', kind: 'seat', p: [0, 0.45, 0], yaw: 0, accepts: { tags: ['body'] }, capacity: 1 }] }),
  nat('nat-woodlog-moss', 'mossy-log', 'A fallen mossy log.', ['log', 'woodlog', 'wood', 'forest']),
  nat('nat-rock-moss-1', 'mossy-rock-1', 'A mossy boulder.', ['rock', 'boulder', 'stone', 'moss'], { anchor: 'conform' }),
  nat('nat-rock-moss-3', 'mossy-rock-2', 'A flat mossy rock.', ['rock', 'stone', 'moss'], { anchor: 'conform' }),
  nat('knat-mushroom-red', 'mushroom-red', 'A red-capped toadstool.', ['mushroom', 'toadstool', 'forest'], { layer: 'decor' }),
  nat('knat-mushroom-redgroup', 'mushrooms-red', 'A cluster of red toadstools.', ['mushroom', 'toadstool', 'forest'], { layer: 'decor' }),
  nat('knat-mushroom-tan', 'mushroom-tan', 'A tan mushroom.', ['mushroom', 'forest'], { layer: 'decor' }),
  nat('knat-mushroom-tangroup', 'mushrooms-tan', 'A cluster of tan mushrooms.', ['mushroom', 'forest'], { layer: 'decor' }),
];
const CROP_KINDS = { carrot: 'carrots', lettuce: 'lettuce', tomato: 'tomato plants', corn: 'corn (maize)', pumpkin: 'a pumpkin patch', beet: 'beets', wheat: 'wheat', watermelon: 'watermelons', berries: 'berry bushes', flowers: 'cut flowers' };
const CROP_DEFS = Object.entries(CROP_KINDS).flatMap(([k, label]) => [
  { pack: 'eden-crops.glb', model: `crop-${k}-2`, name: `${k}-crop-young-pack`, description: `Young ${label}, a few weeks in.`, tags: ['crop', 'garden', 'farm', 'plant', 'vegetable', k, 'young'], layer: 'decor', credit: CROPS, scale: [0.5, 2] },
  { pack: 'eden-crops.glb', model: `crop-${k}-4`, name: `${k}-crop-pack`, description: `Ripe ${label}, ready to harvest.`, tags: ['crop', 'garden', 'farm', 'plant', 'vegetable', k, 'ripe'], layer: 'decor', credit: CROPS, scale: [0.5, 2] },
]);
const BOAT_DEFS = [
  { pack: 'eden-boats-bikes.glb', model: 'rowboat', name: 'rowboat-pack', description: 'A wooden rowing boat for two; floats.', tags: ['boat', 'rowing-boat', 'rowboat', 'water', 'transport'], anchor: 'float', credit: BOATS, components: { carrier: { seats: 2 } } },
  { pack: 'eden-boats-bikes.glb', model: 'canoe', name: 'canoe-pack', description: 'A canoe; floats.', tags: ['boat', 'canoe', 'kayak', 'water', 'transport'], anchor: 'float', credit: BOATS, components: { carrier: { seats: 2 } } },
  { pack: 'eden-boats-bikes.glb', model: 'dinghy', name: 'dinghy-pack', description: 'A small dinghy; floats.', tags: ['boat', 'dinghy', 'water', 'transport'], anchor: 'float', credit: BOATS, components: { carrier: { seats: 2 } } },
  { pack: 'eden-boats-bikes.glb', model: 'bicycle', name: 'bicycle-pack', description: 'A city bicycle (detailed: ~3k triangles).', tags: ['bicycle', 'bike', 'transport', 'vehicle'], credit: BOATS, components: { carrier: { seats: 1 } } },
  { pack: 'eden-boats-bikes.glb', model: 'bicycle-square', name: 'bicycle-simple-pack', description: 'A simple low-poly bicycle.', tags: ['bicycle', 'bike', 'transport', 'vehicle'], credit: BOATS, components: { carrier: { seats: 1 } } },
];
const food = (model, name, description, tags, mass = 0.3) => ({ pack: 'eden-food.glb', model, name: `${name}-pack`, description, tags: ['food', 'item', 'kitchen', 'pack', ...tags], layer: 'decor', credit: FOOD, scale: [0.5, 2], components: { carryable: { mass, grips: 1 } } });
const FOOD_DEFS = [
  food('food-croissant', 'croissant', 'A croissant.', ['bread', 'pastry', 'breakfast']),
  food('food-apple', 'apple', 'A red apple.', ['fruit']),
  food('food-banana', 'banana', 'A banana.', ['fruit']),
  food('food-orange', 'orange', 'An orange.', ['fruit']),
  food('kfood-cup-tea', 'cup-of-tea', 'A cup of tea.', ['cup', 'tea', 'drink', 'mug']),
  food('kfood-cup-coffee', 'cup-of-coffee', 'A cup of coffee.', ['cup', 'coffee', 'drink', 'mug']),
  food('kfood-plate-dinner', 'dinner-plate', 'A dinner plate with food.', ['plate', 'dinner', 'meal', 'dish']),
  food('kfood-bowl', 'food-bowl', 'A bowl of food.', ['bowl', 'meal', 'dish']),
  food('kfood-loaf', 'bread-loaf', 'A loaf of bread.', ['bread', 'loaf']),
  food('kfood-pie', 'pie', 'A whole pie.', ['pie', 'baking', 'dessert'], 0.8),
  food('kfood-glass-wine', 'glass-of-wine', 'A glass of red wine.', ['glass', 'wine', 'drink']),
  food('kfood-cutting-board', 'cutting-board', 'A wooden cutting board.', ['board', 'wood', 'cooking'], 0.6),
];
const INTERIOR_DEFS = [{ pack: 'eden-interior.glb', model: 'int-carpet-round', name: 'round-carpet-pack', description: 'A round woven carpet (rug) for a floor.', tags: ['carpet', 'rug', 'interior', 'furniture', 'pack'], layer: 'decor', credit: INTERIOR, scale: [0.5, 3] }];
const PACK_DEFS = [...ANIMALS, ...NATURE_DEFS, ...CROP_DEFS, ...BOAT_DEFS, ...FOOD_DEFS, ...INTERIOR_DEFS];

const LM = 'worlds/littlemartians';
const BUILDINGS = [
  { file: `${LM}/buildings/ceramic-tower.glb`, footprint: `${LM}/buildings/ceramic-tower.footprint.json`, name: 'ceramic-tower', tags: ['building', 'tower', 'ceramic', 'littlemartians', 'landmark', 'lighthouse'], extra: 'Four rooms (ground hall 0.5 m, second room 9 m, third room 16 m, lantern room 22 m), twelve arched doors on the ground floor, terraces on every tier, float-only shafts between floors.' },
  { file: `${LM}/buildings/minaret-temple.glb`, footprint: `${LM}/buildings/minaret-temple.footprint.json`, name: 'minaret-temple', tags: ['building', 'temple', 'minaret', 'ceramic', 'littlemartians', 'landmark', 'shrine'], extra: 'An open pavilion on four legs, a domed body hall and an upper hall rising into the lantern; float-only shafts between levels.' },
];
const KIN = ['chebel', 'colors-lemuet', 'crystal-freeman', 'dark-blue', 'green-brains-out', 'green-patterns-blue'];

// ---- split one pack model into its own GLB
const io = new NodeIO();
async function splitModel(packFile, model, facing) {
  const doc = await io.readBinary(new Uint8Array(readFileSync(join(PACK_DIR, packFile))));
  doc.setLogger(new Logger(Logger.Verbosity.WARN));
  const scene = doc.getRoot().listScenes()[0];
  const keep = scene.listChildren().find((n) => n.getName() === model);
  if (!keep) throw new Error(`${packFile}: no root node ${model}`);
  const dispose = (n) => { for (const c of n.listChildren()) dispose(c); n.dispose(); };
  for (const n of scene.listChildren()) if (n !== keep) dispose(n);
  const clips = [];
  for (const a of doc.getRoot().listAnimations()) {
    const [owner, clip] = a.getName().split('|');
    if (owner !== model || !clip) { a.dispose(); continue; }
    a.setName(clip); clips.push(clip);
  }
  if (facing) { // turn the model's front to +z without touching its animated nodes
    const wrap = doc.createNode(`${model}-front`).setRotation([0, Math.sin(facing / 2), 0, Math.cos(facing / 2)]);
    scene.removeChild(keep); wrap.addChild(keep); scene.addChild(wrap);
  }
  doc.getRoot().getAsset().generator = 'eden import-packs.mjs (gltf-transform)';
  await doc.transform(prune());
  return { bytes: await io.writeBinary(doc), clips };
}

// ---- build
const index = { schema: 'core-assets/1', note: 'Core mesh assets: sha256 → repo file + measurements. Generated by tools/god-skill/scripts/import-packs.mjs; do not edit.', assets: {} };
const defs = [];
const written = [];
const record = (bytes, path, kind, extra) => {
  const sha = sha256(bytes);
  const m = kind === 'footprint' ? null : measureGlb(bytes);
  index.assets[sha] = kind === 'footprint'
    ? { ext: 'json', kind, path, tris: 0, bytes: bytes.byteLength, textures: 0, texPx: 0, box: extra.baked.box, baked: extra.baked, name: extra.name, license: extra.license, source: extra.source }
    : { ext: 'glb', kind: 'mesh', path, tris: m.tris, bytes: m.bytes, textures: m.textures, texPx: m.texPx, box: m.box, min: m.min, animations: m.animations, nodes: m.nodes, extensions: m.extensions, ...extra };
  return { sha, m };
};
const base = (d, sha, box) => ({
  schema: 'def/1', name: `core-${d.name}`, version: 1,
  description: `${d.description} Licence: ${d.credit?.license ?? d.license}. Source: ${d.credit?.source ?? d.source}.`,
  tags: [...new Set([...d.tags, 'mesh'])].slice(0, 32), form: 'point',
  make: { kind: 'mesh', asset: sha, collide: d.layer === 'decor' ? 'none' : 'box', ...(d.footprintSha ? { footprint: d.footprintSha } : {}) },
  size: { box: box.map((v) => Math.max(0.05, r3(v))), scale: d.scale ?? [0.5, 2] },
  layer: d.layer ?? 'solid', anchor: d.anchor ?? 'base',
  ...(d.slots ? { slots: d.slots } : {}), ...(d.components ? { components: d.components } : {}),
});

mkdirSync(OUT_DIR, { recursive: true });
for (const d of PACK_DEFS) {
  const { bytes, clips } = await splitModel(d.pack, d.model, d.facing ?? 0);
  const path = `worlds/core-assets/packs/${d.name}.glb`;
  const { sha, m } = record(bytes, path, 'mesh', { name: d.name, license: d.credit.license, source: d.credit.source });
  written.push([join(root, path), bytes]);
  const def = base(d, sha, m.box);
  if (clips.length) def.description += ` Clips: ${clips.join(', ')}.`;
  defs.push(def);
}
for (const b of BUILDINGS) {
  const fpBytes = readFileSync(join(root, b.footprint)), fp = JSON.parse(fpBytes.toString('utf8'));
  const baked = footprintToBaked(fp);
  const fpRec = record(fpBytes, b.footprint, 'footprint', { baked, name: `${b.name}-footprint`, license: LM_LICENSE, source: `${b.footprint} (lm-building-footprint/1)` });
  const glb = readFileSync(join(root, b.file));
  const { sha, m } = record(glb, b.file, 'mesh', { name: b.name, license: LM_LICENSE, source: `${b.file} (tools/buildings/generate.py, after Vanessa Rosa's ceramics)`, footprint: fpRec.sha });
  const def = base({ name: b.name, description: `${fp.name}: ${fp.description} ${b.extra} ${m.tris} triangles.`, tags: b.tags, license: LM_LICENSE, source: b.file, footprintSha: fpRec.sha, scale: [0.25, 2] }, sha, baked.box);
  def.slots = baked.slots;
  def.components = { place: { kind: 'building', enclosed: true } };
  defs.push(def);
}
const kinManifest = JSON.parse(readFileSync(join(root, `${LM}/characters/manifest.json`), 'utf8'));
for (const k of KIN) {
  const file = `${LM}/characters/kin/${k}.glb`, glb = readFileSync(join(root, file));
  const info = kinManifest.models.find((x) => x.id === k);
  const { sha, m } = record(glb, file, 'mesh', { name: `kin-${k}`, license: LM_LICENSE, source: `${file} (Polycam scan of a ceramic head, rebuilt by tools/floaters/build-assets.mjs)` });
  const kk = 0.9 / Math.max(...m.box); // largest extent 0.9 m, as the floater view sizes heads
  defs.push(base({ name: `kin-${k}`, description: `${info?.name ?? k}: a ceramic Little Martians kin head (scenery, not a Soul), hovering about a metre up. ${info?.lore?.canon ?? ''}`.trim(), tags: ['kin', 'head', 'ceramic', 'littlemartians', 'sculpture', 'floater'], license: LM_LICENSE, source: file, scale: [0.25, 4], layer: 'decor', components: { hover: { height: 0.9, bob: 0.08, period: 6 } } }, sha, m.box.map((v) => v * kk)));
}

const indexText = JSON.stringify(index, null, 1) + '\n';
const meshText = JSON.stringify(defs, null, 1) + '\n';
if (check) {
  const same = (f, t) => existsSync(f) && readFileSync(f, 'utf8') === t;
  const bad = [[INDEX, indexText], [MESH_JSON, meshText]].filter(([f, t]) => !same(f, t)).map(([f]) => relative(root, f));
  for (const [f, b] of written) if (!existsSync(f) || sha256(readFileSync(f)) !== sha256(b)) bad.push(relative(root, f));
  if (bad.length) { console.error(`import-packs: out of date: ${bad.join(', ')}`); process.exit(1); }
  console.log(`import-packs: up to date (${defs.length} defs, ${Object.keys(index.assets).length} assets)`);
} else {
  for (const [f, b] of written) writeFileSync(f, b);
  writeFileSync(INDEX, indexText); writeFileSync(MESH_JSON, meshText);
  const packBytes = written.reduce((s, [, b]) => s + b.byteLength, 0);
  console.log(`import-packs: ${defs.length} defs → ${relative(root, MESH_JSON)}; ${Object.keys(index.assets).length} assets → ${relative(root, INDEX)}; ${written.length} split GLBs, ${(packBytes / 1024).toFixed(0)} KB`);
  for (const d of defs) console.log(`  core/${d.name.slice(5)}@1  ${d.make.asset.slice(0, 10)}  ${d.size.box.join('×')} m  ${index.assets[d.make.asset].tris} tris`);
}
