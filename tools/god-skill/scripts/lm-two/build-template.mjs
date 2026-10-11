#!/usr/bin/env node
// littlemartians-two: rebuild the Arium-era Little Martians world (lm/map @ 953613972438, the LM-22 world) in the
// new engine, through god mode, and write it out as the genesis template worlds/templates/littlemartians-two.json.
//
//   node tools/god-skill/scripts/lm-two/build-template.mjs [--port 5471] [--keep]
//
// 1. Reads the authored layout from git objects at LM_MAP_COMMIT (world-layout.json, scene.json, places.v1.json,
//    native-place-aliases.json, the scan-district manifests, characters/manifest.json, world.json); never the lm-map
//    worktree, never ~/Dev/littlemartians.
// 2. Makes the three gallery panels (the landscape's embedded images on a basalt frame) and the arch footprints of
//    Minarete and the Celadon beacon (the measured 2 m ground passages, as lm/map's native obstacles had them).
// 3. Boots a fresh dev world (own data and asset dir), mints a god token and imports every GLB through the god
//    import path: POST /v1/god/assets (measured, budget-checked, stored, a def proposed). Floating ceramics get
//    the kin's hover component; then all defs are defined in one batch.
// 4. Builds the world with ordinary god ops (terrain, courts, grotto, garden, landmarks, exhibits, kin, cast,
//    flags), each batch refused-or-accepted by the server exactly as a god's would be.
// 5. Writes the genesis template (the same ops) and worlds/core-assets/littlemartians-two.index.json (the store's
//    own measurements, pointing at worlds/littlemartians-two/assets/), so the template boots on any box.
// Assets: tools/god-skill/scripts/lm-two/optimize-assets.mjs (run first).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LM_MAP_COMMIT, LM_LICENSE, makePanel } from './lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const PORT = Number(flag('port', 5471));
const ASSETS = join(root, 'worlds/littlemartians-two/assets');
const TEMPLATE = join(root, 'worlds/templates/littlemartians-two.json');
const INDEX = join(root, 'worlds/core-assets/littlemartians-two.index.json');
const git = (p) => execFileSync('git', ['-C', root, 'show', `${LM_MAP_COMMIT}:${p}`], { maxBuffer: 1 << 30 });
const gitJson = (p) => JSON.parse(git(p).toString('utf8'));
const log = (...a) => console.log(...a);
const r2 = (v) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------- the source world
const LM = 'worlds/littlemartians';
const layout = gitJson(`${LM}/design/world-layout.json`);
const scene = gitJson(`${LM}/scene.json`);
const placesV1 = gitJson(`${LM}/places.v1.json`).places;
const aliases = gitJson(`${LM}/native-place-aliases.json`).aliases;
const worldJson = gitJson(`${LM}/world.json`);
const scans = gitJson(`${LM}/buildings/scan-landmarks.manifest.json`).models;
const districts = [...gitJson(`${LM}/design/scan-districts/manifest.json`).models, ...gitJson(`${LM}/design/scan-districts/drive-manifest.json`).models];
const characters = gitJson(`${LM}/characters/manifest.json`).models;
const sources = JSON.parse(readFileSync(join(ASSETS, 'SOURCES.json'), 'utf8')).assets;

// ---------------------------------------------------------------- 2. panels and footprints
const ARTWORKS = [
  { id: 'forest-illustration', title: 'Forest illustration', at: [-44, 59] },
  { id: 'geometric-pattern', title: 'Geometric pattern', at: [44, 55.6] },
  { id: 'receding-archways', title: 'Receding archways', at: [58, 30] },
];
for (const a of ARTWORKS) {
  const file = join(ASSETS, `panel-${a.id}.glb`);
  if (!existsSync(file)) { writeFileSync(file, await makePanel(git(`${LM}/buildings/landscape.glb`), a.title)); log(`panel ${a.id}: ${readFileSync(file).byteLength} bytes`); }
}
/** lm-building-footprint/1 for a scan with a measured ground arch: west/east walls to the top, the overhead from 2.25 m. */
function archFootprint(id, centre) {
  const solids = scene.scene.obstacles.filter((o) => o.id.startsWith(`${id === 'scan-celadon-tower' ? 'celadon-tower' : 'minarete'}-scan-envelope`));
  const s = scans.find((m) => m.id === id), b = s.boundsYUp;
  return {
    schema: 'lm-building-footprint/1', id: `${id}-arch`,
    bounds: { min: b.min, max: b.max },
    obstacles: solids.map((o) => ({ id: o.id, obb: { c: [r2(o.obb.c[0] - centre[0]) || 0, r2(o.obb.c[1] - centre[2]) || 0], half: o.obb.half.map(r2), yaw: 0 }, y0: o.y0, y1: o.y1 })),
    note: `Measured ground arch from ${LM_MAP_COMMIT.slice(0, 12)} ${LM}/buildings/${id === 'scan-celadon-tower' ? 'celadon' : 'minarete'}-passage.validation.json: a 2 m wide, 2.25 m clear passage north–south through the scan; the rest of the envelope is conservative.`,
  };
}
const LANDMARKS = layout.landmarks.map((l) => ({ ...l, scan: scans.find((m) => m.id === l.file) }));
const footprints = {};
for (const l of LANDMARKS) if (l.passage) { const f = join(ASSETS, `${l.file}.footprint.json`); writeFileSync(f, JSON.stringify(archFootprint(l.file, l.at), null, 1) + '\n'); footprints[l.file] = f; }

// ---------------------------------------------------------------- 3. a fresh dev world, the god import path
const build = join(root, '.lane/lm-two-build');
rmSync(build, { recursive: true, force: true }); mkdirSync(build, { recursive: true });
process.env.ASSET_DIR = join(build, 'assets');
// the extra index must not satisfy the imports: build it from the store afterwards
const indexBackup = existsSync(INDEX) ? readFileSync(INDEX) : null; if (indexBackup) rmSync(INDEX);
const { startWorld } = await import(join(root, 'tools/god-skill/dev-world.mjs'));
let { child, base } = await startWorld({ slug: 'lm-two-build', port: PORT, data: join(build, 'data'), fresh: true, log: join(build, 'server.log') });
const stop = () => { if (!argv.includes('--keep')) try { child.kill(); } catch { } };
process.on('exit', stop);
let token = '';
async function api(path, { body, form, as } = {}) {
  const headers = { authorization: as ? `Bearer dev:${as}` : `Bearer ${token}` };
  if (body) headers['content-type'] = 'application/json';
  const r = await fetch(base + path, { method: body || form ? 'POST' : 'GET', headers, body: form ?? (body ? JSON.stringify(body) : undefined), signal: AbortSignal.timeout(300_000) });
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; }
  if (!r.ok) throw new Error(`${path} ${r.status}: ${t.slice(0, 600)}`);
  return d;
}
token = (await api('/v1/god/mint', { as: 'admin', body: { label: 'lm-two build' } })).token;

const SRC = (f) => `lm/map@${LM_MAP_COMMIT.slice(0, 12)} ${sources[f]?.source?.split(':').pop() ?? f}`;
async function importGlb(file, { name, height, description, tags, layer, footprint, source }) {
  const fd = new FormData();
  fd.set('file', new Blob([readFileSync(join(ASSETS, `${file}.glb`))], { type: 'model/gltf-binary' }), `${file}.glb`);
  if (footprint) fd.set('footprint', new Blob([readFileSync(footprint)], { type: 'application/json' }), 'footprint.json');
  for (const [k, v] of Object.entries({ name, height: height && String(height), description, tags: tags?.join(','), layer, license: LM_LICENSE, source: source ?? SRC(file) })) if (v !== undefined) fd.set(k, v);
  const r = await api('/v1/god/assets', { form: fd });
  return r;
}
const imported = {};   // file → { def, asset, footprint }
const defs = [];

// the three original scans
const LANDMARK_NAMES = { madmaraca: 'lm-madmaraca', minarete: 'lm-minarete', 'celadon-tower': 'lm-celadon-beacon' };
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
/** The library name of a scan exhibit: scenario/real-space scans by their id; drive-gallery pieces by family and title. */
const exhibitName = (m) => {
  if (!m.id.startsWith('drive-')) return `lm-scan-${m.id}`;
  const fam = /glitch_martians/.test(m.raw) ? 'glitch' : /Regency/.test(m.raw) ? 'regency' : /museum-scans/.test(m.raw) ? 'museum' : 'ceramic';
  return `lm-${fam}-${slug(m.title)}`;
};
const LIB = (short) => `core/${short}@1`;
for (const l of LANDMARKS) {
  const r = await importGlb(l.file, { name: LANDMARK_NAMES[l.id], height: l.scan.heightMetres, tags: ['littlemartians', 'ceramic', 'scan', 'landmark', 'temple', 'vanessa-rosa', 'arium'], footprint: footprints[l.file],
    description: `${l.name}: Vanessa Rosa's original ceramic sculpture, scanned and raised to ${l.scan.heightMetres} m as a landmark of the Arium-era Little Martians world. ${l.interior === 'unqualified' ? 'Its interior is not walkable.' : 'A measured 2 m ground arch runs north–south through it; the upper interiors are closed.'}` });
  imported[l.file] = r; defs.push({ ...r.def, layer: 'solid' }); log(r.report.split('\n')[0], '→', r.def.name);
}
// the 96 scan-court exhibits
for (const m of districts) {
  const h = r2(m.boundsYUp[1][1] - m.boundsYUp[0][1]), floating = m.p[1] > 0.5;
  const r = await importGlb(m.file, { name: exhibitName(m), height: h, tags: ['littlemartians', 'scan', 'exhibit', m.district ?? 'drive-gallery', ...(floating ? ['ceramic', 'floater'] : [])],
    description: `${m.title} — a scan exhibit of the Little Martians archive (${m.origin ?? 'drive gallery'}).${floating ? ' A ceramic study floating 2.4 m above its viewing court.' : ' Raw scan floors and interiors are not walkable.'}` });
  let def = r.def;
  if (floating) def = { ...def, layer: 'decor', make: { ...def.make, collide: 'none' }, components: { ...(def.components ?? {}), hover: { height: 2.4, bob: 0.06, period: 7 } } };
  imported[m.file] = r; defs.push(def);
}
log(`imported ${districts.length} exhibits`);
// the seven cast floaters (the six kin are the core kin defs, the same files)
for (const c of characters.filter((x) => x.group === 'floater')) {
  const cast = worldJson.cast?.find((x) => x.name === c.name);
  const r = await importGlb(`character-${c.id}`, { name: `lm-${c.id}`, height: 0.9, layer: 'decor', tags: ['littlemartians', 'ceramic', 'head', 'character', 'floater', 'sculpture', c.id],
    description: `${c.name}: a ceramic Little Martian head by Vanessa Rosa, hovering about a metre up. ${(cast?.description ?? '').slice(0, 420)}`, source: SRC(`character-${c.id}`) });
  imported[`character-${c.id}`] = r; defs.push({ ...r.def, layer: 'decor', make: { ...r.def.make, collide: 'none' }, components: { hover: { height: 1.1, bob: 0.08, period: 6 } } });
}
// the three gallery panels
for (const a of ARTWORKS) {
  const r = await importGlb(`panel-${a.id}`, { name: `lm-panel-${a.id}`, height: 5, tags: ['littlemartians', 'gallery', 'painting', 'panel', 'art', 'arium'], source: `lm/map@${LM_MAP_COMMIT.slice(0, 12)} ${LM}/buildings/landscape.glb (embedded "${a.title}")`,
    description: `"${a.title}" on a basalt gallery panel (6 × 4 m picture, 1 m above the ground), from the early Little Martians reference corpus; individual authorship of the picture is not asserted.` });
  imported[`panel-${a.id}`] = r; defs.push(r.def);
}
// kits: the painted grotto vault and the glazed botanical plants (world-made, like a god's define-kit)
const BASALT = '#1c1118', VAULT = '#3b2b31', GLAZE = '#0f382e', MOSS = '#1a6142', PETAL = '#80386f', PALE = '#b8a6e6', EMBER = '#bf1f09', CHALK = '#dbd4c2', OCHRE = '#a1633d';
const G = layout.grotto, GC = [(G.rect[0] + G.rect[2]) / 2, (G.rect[1] + G.rect[3]) / 2], GW = G.rect[2] - G.rect[0], GD = G.rect[3] - G.rect[1];
const local = ([x0, z0, x1, z1]) => ({ at: [r2((x0 + x1) / 2 - GC[0]), 0, r2((z0 + z1) / 2 - GC[1])], size: [x1 - x0, G.wallHeight, z1 - z0] });
const vaultShapes = [
  // the barrel vault: a segmental arch over the whole cave, its springing below ground (the cave reads as dug in)
  { kind: 'arch', at: [0, G.crownHeight / 2, 0], size: [GW + 1, G.crownHeight, GD], color: VAULT, segments: 16 },
  ...G.walls.map((w) => { const l = local(w); return { kind: 'rbox', at: [l.at[0], G.wallHeight / 2, l.at[2]], size: l.size, color: VAULT, collide: true }; }),
  // pale wisteria strands and red blossoms along both side walls, above head height
  ...[-1, 1].flatMap((side) => [0, 1, 2, 3, 4, 5].map((i) => ({ kind: 'cyl', at: [side * (GW / 2 - 4 - (i % 2) * 1.5), G.wallHeight - 1.6, -7 + i * 2.8], r: 0.18, r2: 0.05, h: 2.6, color: PALE, glow: 0.25, segments: 6, collide: false }))),
  ...[-1, 1].flatMap((side) => [0, 1, 2].map((i) => ({ kind: 'sphere', at: [side * (GW / 2 - 4.5), G.wallHeight - 3.3, -6 + i * 6], r: 0.45, color: EMBER, segments: 8 }))),
];
defs.push({ schema: 'def/1', name: 'lm-grotto-vault', version: 1, description: 'The Grotto of Painted Worlds: a basalt barrel vault with a 10 m doorway on its north side, pale hanging strands and red blossoms, reconstructed from the Arium short tour (frames 60–66). Rock and flowers are reconstructions, not recovered assets.', tags: ['littlemartians', 'grotto', 'cave', 'vault', 'gallery', 'arium', 'structure'], form: 'point', layer: 'solid', anchor: 'base', make: { kind: 'gen', gen: 'kit/2', args: { shapes: vaultShapes, round: 0.2 } }, size: { box: [GW + 1, G.crownHeight, GD], scale: [1, 1] } });
defs.push({ schema: 'def/1', name: 'lm-glazed-plant', version: 1, description: 'A glazed ceramic garden plant: a tall moss-glazed spire under a petal-glazed crown, from the Little Martians garden.', tags: ['littlemartians', 'ceramic', 'plant', 'garden', 'sculpture'], form: 'point', layer: 'solid', anchor: 'base', make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'cone', at: [0, 1.4, 0], r: 0.65, h: 2.8, color: MOSS, segments: 9, collide: true }, { kind: 'cone', at: [0, 2.75, 0], r: 0.9, h: 1.1, color: PETAL, segments: 9 }, { kind: 'sphere', at: [0, 3.4, 0], r: 0.22, color: PALE, glow: 0.2, segments: 8 }], round: 0.05 } }, size: { box: [1.8, 3.9, 1.8], scale: [0.5, 1.6] } });

function writeIndex() {
// the asset index: the store's own measurements of what the god imported, pointed at the repo files
const assetsIdx = {};
for (const [file, r] of Object.entries(imported)) {
  const meta = JSON.parse(readFileSync(join(process.env.ASSET_DIR, `${r.asset.sha}.meta.json`), 'utf8'));
  assetsIdx[r.asset.sha] = { ...meta, path: `worlds/littlemartians-two/assets/${file}.glb` };
  if (r.footprint) {
    const fm = JSON.parse(readFileSync(join(process.env.ASSET_DIR, `${r.footprint.sha}.meta.json`), 'utf8'));
    const fpFile = `worlds/littlemartians-two/assets/${file}.footprint.json`;
    // the store holds the exact bytes it measured: keep those beside the GLB
    writeFileSync(join(root, fpFile), readFileSync(join(process.env.ASSET_DIR, `${r.footprint.sha}.json`)));
    assetsIdx[r.footprint.sha] = { ...fm, path: fpFile };
  }
}
for (const m of Object.values(assetsIdx)) delete m.at;
writeFileSync(INDEX, JSON.stringify({ schema: 'core-assets/1', note: 'littlemartians-two: the Arium-era Little Martians art, measured by the god import path (POST /v1/god/assets) in tools/god-skill/scripts/lm-two/build-template.mjs. Licence per asset.', assets: Object.fromEntries(Object.entries(assetsIdx).sort()) }, null, 1) + '\n');
log(`asset index: ${INDEX} — ${Object.keys(assetsIdx).length} assets`);
}
const act = async (ops, note, group) => { const r = await api('/v1/god/act', { body: { ops, note, group } }); if (!r.accepted) throw new Error(`${note}: refused ${JSON.stringify(r.failures).slice(0, 900)}`); return r; };
const BATCHES = [];
async function batch(note, group, ops) {
  for (let i = 0; i < ops.length; i += 150) {
    const part = ops.slice(i, i + 150), n = ops.length > 150 ? `${note} (${i / 150 + 1})` : note;
    await act(part, n, group); BATCHES.push({ note: n, group, ops: part });
  }
  log(`✔ ${note}: ${ops.length} ops`);
}
// every proposed def becomes a library def (core/lm-*@1): any god in any world can place it
const KIT = join(root, 'packages/world-compiler/src/core-kit/littlemartians.json');
const lib = defs.map((d) => ({ ...d, name: `core-${d.name}` })).sort((a, b) => (a.name < b.name ? -1 : 1));
writeFileSync(KIT, JSON.stringify(lib, null, 1) + '\n');
log(`library: ${KIT} — ${lib.length} defs`);
writeIndex();
child.kill(); await new Promise((r) => setTimeout(r, 1500));
// a fresh world: the server now loads the new library (and the index) like any other world on the box
rmSync(process.env.ASSET_DIR, { recursive: true, force: true });
({ child, base } = await startWorld({ slug: 'lm-two-build', port: PORT, data: join(build, 'data2'), fresh: true, log: join(build, 'server2.log') }));
token = (await api('/v1/god/mint', { as: 'admin', body: { label: 'lm-two build' } })).token;

// ---------------------------------------------------------------- 4. the world, built by god ops
const rect = ([x0, z0, x1, z1]) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const place = (def, name, extra) => ({ op: 'place', def, ...(name ? { name } : {}), ...extra });
const paint = (name, poly, color, material = 'dirt') => place('core/ground-paint@1', name, { shape: { area: poly }, params: { material, color, edge: 0 } });

// the land: fifteen peaks of the three ranges, the scenic caldera, the Tharsis overlook
const peaks = layout.mountainRanges.flatMap((m) => m.peaks.map(([x, z, s, rx, rz], i) => place('core/mountain@1', `${m.id}-${i + 1}`, { p: [x, z], params: { height: Math.max(40, Math.round(m.height * s * 0.95)), radius: Math.max(60, Math.round(Math.max(rx, rz) * 1.2)), peak: 2.2 } })));
const cal = layout.scenicLandforms[0], hill = layout.hill, HILL_TOP = 7, HILL_EDGE = 21;
await batch('the land: the Tharsis north wall, western escarpment and eastern massif (fifteen peaks), the Olympus caldera, the Tharsis overlook and its ramp', 'land', [
  ...peaks,
  place('core/mountain@1', 'olympus-caldera', { p: [cal.at[0], cal.at[2]], params: { height: cal.height, radius: Math.max(60, cal.radius), peak: 1.4 } }),
  // lm/map's 8 m plateau had 8 m slopes and a 24 % ramp (native links); here the hill itself is the way up, so its soft edge
  // (inside the area) keeps every slope under the humanoid's 30° (tan 0.577): 7 m over 21 m, the flat top as authored
  place('core/plateau@1', 'tharsis-plateau', { shape: { area: rect([hill.plateau[0] - HILL_EDGE, hill.plateau[1] - HILL_EDGE, hill.plateau[2] + HILL_EDGE, hill.plateau[3] + HILL_EDGE]) }, params: { height: HILL_TOP, edge: HILL_EDGE } }),
  place('core/footpath@1', 'tharsis-ramp', { shape: { path: [[hill.ramp.from[0], hill.ramp.from[2]], [hill.ramp.to[0], hill.ramp.to[2]]], width: hill.ramp.width }, params: { material: 'dirt', width: hill.ramp.width } }),
]);

// courts and gardens (lm/map's ground planes), paths, the Arium black/chalk tessellation, the glazed basins
const P = Object.fromEntries(placesV1.map((p) => [p.id, p]));
const MAIN = ['garden', 'madmaraca-court', 'minarete-court', 'beacon-court', 'eden-garden', 'grotto-court', 'tharsis-overlook'];
const courtOps = MAIN.map((id) => paint(id, P[id].polygon, P[id].kind === 'garden' ? MOSS : OCHRE, P[id].kind === 'garden' ? 'moss' : 'dirt'));
const pathOps = [[-64, 18, 64, 18, 4, 'promenade'], [0, -24, 0, 32, 6, 'beacon-walk'], [-45, 20, -45, 47, 6, 'garden-walk'], [45, 20, 45, 47, 6, 'grotto-walk']].map(([x0, z0, x1, z1, w, n]) => place('core/footpath@1', n, { shape: { path: [[x0, z0], [x1, z1]], width: w }, params: { material: 'stone', width: w } }));
const tiles = []; for (let row = 0; row < 6; row++) for (let col = 0; col < 12; col++) { const x = -24 + col * 4, z = -9 + row * 4; tiles.push(paint(`tile-${row}-${col}`, rect([x, z, x + 3.9, z + 3.9]), (row + col) % 2 ? BASALT : CHALK, 'rock')); }
const basins = [[-20, -15, 'north-west'], [20, -15, 'north-east'], [-19, 41, 'south-west'], [19, 41, 'south-east']].map(([x, z, n]) => place('core/pond@1', `glazed-basin-${n}`, { shape: { area: rect([x - 8, z - 5, x + 8, z + 5]) }, params: { depth: 0.6, edge: 1 } }));
await batch('the ceramic commons, the gallery and garden courts, the stone walks, the black and chalk tessellation of the Arium floor, four glazed basins', 'courts', [...courtOps, ...pathOps, ...tiles, ...basins]);

// the three original scans and the auxiliary pavilions (core defs with rooms and float-only shafts)
const passageOps = LANDMARKS.filter((l) => l.passage).map((l) => { const p = P[l.passage.id]; return paint(l.passage.id, p.polygon, '#7a5a48', 'rock'); });
await batch('Vanessa\'s three original ceramic scans: Madmaraca, Minarete, the Celadon beacon (with their measured ground arches); the auxiliary ceramic tower and minaret temple', 'landmarks', [
  ...LANDMARKS.map((l) => place(LIB(LANDMARK_NAMES[l.id]), l.id === 'celadon-tower' ? 'celadon-beacon' : l.id, { p: [l.at[0], l.at[2]], r: l.yaw ?? 0 })),
  ...passageOps,
  place('core/ceramic-tower@1', 'auxiliary-tower', { p: [-46, 16], r: 0, s: 0.5 }),
  place('core/minaret-temple@1', 'auxiliary-temple', { p: [46, 16], r: 0, s: 0.5 }),
]);

// the painted grotto, its pools and dry causeway; the garden's glazed plants; the gallery panels
const plants = []; for (const side of [-1, 1]) for (let i = 0; i < 14; i++) {
  const x = side * (30 + (i % 7) * 4), z = 37 + Math.floor(i / 7) * 16, [ax, az, bx, bz] = G.clearWalk;
  if (ax <= x && x <= bx && az <= z && z <= bz) continue;
  if (side === 1 && z > 38 && x > G.rect[0] && x < G.rect[2]) continue; // inside the vault: the pools and the causeway keep the floor
  if (side === 1 && x > G.entrance[0] - 2 && x < G.entrance[2] + 2) continue; // keep the grotto's doorway open
  plants.push(place(LIB('lm-glazed-plant'), `glazed-plant-${side < 0 ? 'w' : 'e'}${i + 1}`, { p: [x, z], r: 0 }));
}
for (let i = 0; i < 5; i++) plants.push(place(LIB('lm-glazed-plant'), `overlook-plant-${i + 1}`, { p: [-6 + i * 3, 76.5], r: 0, s: 0.8 }));
await batch('the Grotto of Painted Worlds (vault, two turquoise pools, the dry causeway), the glazed garden plants, three gallery panels', 'grotto-garden', [
  place(LIB('lm-grotto-vault'), 'painted-grotto', { p: GC, r: 0 }),
  ...G.pools.map((pr, i) => place('core/pond@1', `grotto-pool-${i + 1}`, { shape: { area: rect(pr) }, params: { depth: 0.8, edge: 0.6 } })),
  paint('grotto-causeway', rect(G.clearWalk), '#3a2c30', 'rock'),
  ...plants,
  // lm/map's panels were double-sided quads facing +z; these are framed, so each faces its visitors (north)
  ...ARTWORKS.map((a) => place(LIB(`lm-panel-${a.id}`), `panel-${a.id}`, { p: a.at, r: Math.PI })),
  ...[[-60, 41], [-52, 41], [-36, 47], [-60, 55], [-36, 55]].map(([x, z], i) => place('core/flower-bed@1', `verdelis-bed-${i + 1}`, { p: [x, z], params: { leaf: '#3f8f5a', soil: '#4a2c26' } })),
  ...[[-57, 46, 'red'], [-33, 42, 'tan'], [-48, 56, 'red'], [-27, 50, 'tan']].map(([x, z, k], i) => place(`core/mushrooms-${k}-pack@1`, `verdelis-mushrooms-${i + 1}`, { p: [x, z], s: 2.5 })),
]);

// the scan courts: 96 exhibits on their pads, the central promenade and the cross walks, each viewing court named
const rows = [...new Set(districts.map((m) => m.p[2]))].sort((a, b) => a - b);
await batch('the scan courts: 96 exhibits of the Little Martians archive in an eight-column district, with their viewing courts', 'scan-courts', [
  place('core/footpath@1', 'scan-promenade', { shape: { path: [[0, 88], [0, 235]], width: 2 }, params: { material: 'stone', width: 2 } }),
  ...rows.map((z, i) => place('core/footpath@1', `scan-crosswalk-${i + 1}`, { shape: { path: [[-72, z + 9.5], [72, z + 9.5]], width: 1.2 }, params: { material: 'stone', width: 1.2 } })),
  ...districts.map((m) => paint(`pad-${m.id}`, rect(m.rect ?? [m.p[0] - 8, m.p[2] - 8, m.p[0] + 8, m.p[2] + 8]), OCHRE, 'dirt')),
  ...districts.map((m) => place(LIB(exhibitName(m)), m.file, { p: [m.p[0], m.p[2]], r: m.yaw ?? 0 })),
  ...districts.map((m) => P[`scan-${m.id}`] ? paint(`scan-${m.id}`, P[`scan-${m.id}`].polygon, '#c49a6c', 'sand') : null).filter(Boolean),
]);

// the kin row and the seven cast heads (ceramic scenery; Souls bring their own bodies)
const CAST_AT = { verdelis: [-45, 46], mycos: [-53, 51], kweku: [-40, 9], kalama: [38, 10], ada: [45, 50], shuijing: [-6, -16], nyx: [0, 72] };
await batch('the six ceramic kin hovering in their row; the seven cast heads at home in the courts', 'ceramics', [
  ...scene.kin.map((k) => place(`core/kin-${k.model}@1`, `kin-${k.model}`, { p: [k.p[0], k.p[2]], r: Math.PI })),
  ...characters.filter((c) => c.group === 'floater').map((c) => place(LIB(`lm-${c.id}`), c.id, { p: CAST_AT[c.id], r: Math.PI })),
]);

// flags: the places a newcomer is pointed to (labels), and the arrival
const FLAGS = [['arrival', [0, 18], 'Little Martians Ceramic World (arrival)'], ['ceramic-commons', [0, 26], 'Ceramic Commons'], ['madmaraca-gallery', [-40, 12], 'Madmaraca Gallery Court'], ['minarete-sky-court', [38, 12], 'Minarete Sky Court'], ['celadon-beacon-court', [8, -20], 'Celadon Beacon Court'], ['verdelis-eden-garden', [-40, 44], "Verdelis's Eden Garden"], ['grotto-of-painted-worlds', [45, 36], 'Grotto of Painted Worlds'], ['overlook-summit', [0, 70], 'Tharsis Overlook'], ['scan-courts', [3, 82], 'The scan courts']];
await batch('flags: the places a newcomer can walk to by name', 'flags', FLAGS.map(([n, p, label]) => place('core/flag@1', n, { p, state: { label } })));

// ---------------------------------------------------------------- the 113 places → entity paths (old ids kept)
const ROOM = Object.fromEntries(aliases.map((a) => [a.place, a.place.startsWith('tower') ? `auxiliary-tower/${a.place}` : `auxiliary-temple/${a.place}`]));
const placeMap = placesV1.map((p) => ({ id: p.id, name: p.name, kind: p.kind, entity: p.id === 'lm-world' ? 'flag:arrival' : ROOM[p.id] ?? p.id }));

// ---------------------------------------------------------------- 5. the template and the asset index
const snap = await api('/v1/god/snapshot').catch(() => null);
const entities = snap?.entities?.length ?? null;
const customs = (worldJson.customs ?? []).map((c) => `- ${c}`).join('\n');
const genesis = {
  schema: 'genesis/1', name: 'Little Martians (Arium)',
  description: "The newer Little Martians world from the Arium work: Vanessa Rosa's original Madmaraca, Minarete and celadon scans around a ceramic commons with the Arium's black-and-chalk floor; gallery and garden courts, the painted grotto, the Tharsis overlook under Martian ranges and the Olympus caldera; 96 scan exhibits from the Little Martians archive; the kin and the seven cast heads. Rebuilt in god mode from lm/map 953613972438.",
  source: { branch: 'lm/map', commit: LM_MAP_COMMIT, proof: '<team>/proofs/littlemartians-map/22/', builder: 'tools/god-skill/scripts/lm-two/build-template.mjs' },
  constants: { extent: 800, ground: 'land' },
  state: { constitution: `# Little Martians\n${customs}\n\nSouls are welcome on the ceramic ground; the sculptures, mountain slopes and scan interiors are to be looked at, not climbed.`, time: { dayTicks: 72000, startTick: 0 }, sky: { palette: 'lm-garden', sun: 0.55 }, ground: { palette: 'desert' } },
  places: placeMap,
  batches: BATCHES,
};
writeFileSync(TEMPLATE, JSON.stringify(genesis, null, 1) + '\n');
log(`template: ${TEMPLATE} — ${BATCHES.length} batches, ${BATCHES.reduce((n, b) => n + b.ops.length, 0)} ops${entities !== null ? `, ${entities} entities in the build world` : ''}`);


stop();
process.exit(0);
