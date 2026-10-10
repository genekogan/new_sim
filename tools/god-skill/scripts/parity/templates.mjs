#!/usr/bin/env node
// L11 parity demonstrators: three genesis/1 templates built only with god ops from the library,
// each generated from its world's source data where practical (place names kept as entity names).
//
//   node tools/god-skill/scripts/parity/templates.mjs [eden|mars|lm ...] [--furnish <port>]
//
// Writes worlds/templates/{eden-district,mars-camp,littlemartians-garden}.json. With --furnish
// <port> it boots each template once in a scratch world on that port, asks L2's furnish recipes
// (tools/god-skill/lib/furnish.mjs) for each building's furniture against the live model, and
// appends those ops as a final batch, so the templates carry fully furnished interiors.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const json = (p) => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
const r2 = (n) => Math.round(n * 100) / 100;
const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const bbox = (poly) => { const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]); return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]; };
const centre = (b) => [r2((b[0] + b[2]) / 2), r2((b[1] + b[3]) / 2)];
const slug = (id) => id.replace(/[^a-z0-9._-]/g, '-').slice(0, 48);
const place = (def, name, extra = {}) => ({ op: 'place', def, name: slug(name), ...extra });

// ------------------------------------------------------------------ Little Martians: the garden
function lmGarden() {
  const s = json('worlds/littlemartians/scene.json');
  const w = json('worlds/littlemartians/world.json');
  const [x0, z0, x1, z1] = s.scene.bounds;
  const glaze = { pale: '#9fcfc4', deep: '#2f5f86', cream: '#efe4cf', terracotta: '#c9805a', moss: '#7d9c6a' };
  const tower = s.buildings.find((b) => b.file === 'ceramic-tower'), temple = s.buildings.find((b) => b.file === 'minaret-temple');
  const tp = [tower.p[0], tower.p[2]], mp = [temple.p[0], temple.p[2]];
  const kinZ = s.kin[0].p[2];
  return {
    schema: 'genesis/1',
    name: 'Little Martians garden',
    description: 'The Little Martians garden in the new vocabulary: Vanessa\'s Ceramic Tower and Minaret Temple (imported glazed meshes whose footprints carry the rooms and the float-only shafts), the six kin hovering in their row, a glazed-tile court between the two buildings, ceramic pots and moss. Generated from worlds/littlemartians/scene.json (parity proof, docs/god/PARITY.md).',
    constants: { extent: 240, ground: 'land' },
    state: {
      constitution: `# Little Martians garden\n${w.customs?.garden ?? 'A ceramic garden between a glazed tower and a temple; the kin float where they like.'}\n\nParity demonstrator: generated from the Little Martians scene.`,
      time: { dayTicks: w.dayTicks ?? 72000, startTick: 0 },
      sky: { palette: 'lm-garden', sun: 0.65 },
    },
    batches: [
      { note: 'the garden ground and the glazed court', group: 'garden', ops: [
        place('core/lawn@1', 'garden', { shape: { area: rect(x0, z0, x1, z1) }, params: { material: 'sand' } }),
        place('core/plaza@1', 'glazed-court', { shape: { area: rect(-7, -8, 7, 8) }, params: { material: 'tile', pattern: 'radial', kerb: true } }),
        place('core/footpath@1', 'path-to-tower', { shape: { path: [[-7, 0], [tp[0] + 9.2, 0]], width: 2.4 }, params: { material: 'stone', width: 2.4 } }),
        place('core/footpath@1', 'path-to-temple', { shape: { path: [[7, 0], [mp[0] - 10.4, 0]], width: 2.4 }, params: { material: 'stone', width: 2.4 } }),
        place('core/footpath@1', 'kin-walk', { shape: { path: [[0, 8], [0, kinZ - 2.5]], width: 2 }, params: { material: 'stone', width: 2 } }),
        place('core/footpath@1', 'kin-row', { shape: { path: [[-15, kinZ - 2.5], [16, kinZ - 2.5]], width: 2 }, params: { material: 'stone', width: 2 } }),
      ] },
      { note: 'the two glazed buildings (imported meshes with rooms)', group: 'buildings', ops: [
        place('core/ceramic-tower@1', 'ceramic-tower', { tmp: '$tower', p: tp, r: tower.yaw ?? 0 }),
        place('core/minaret-temple@1', 'minaret-temple', { tmp: '$temple', p: mp, r: temple.yaw ?? 0 }),
      ] },
      { note: 'inside: a carpet and pots in the tower\'s ground hall, a kin floating in its second room, a bowl in the temple pavilion', group: 'rooms', ops: [
        place('core/round-carpet-pack@1', 'tower-hall-carpet', { in: { parent: 'ceramic-tower', slot: 'tower-l0' }, p: [0, 0, 0] }),
        place('core/flower-pot@1', 'tower-hall-pot-1', { in: { parent: 'ceramic-tower', slot: 'tower-l0' }, p: [-4.5, 0, -4.5], params: { pot: glaze.terracotta } }),
        place('core/flower-pot@1', 'tower-hall-pot-2', { in: { parent: 'ceramic-tower', slot: 'tower-l0' }, p: [4.5, 0, -4.5], params: { pot: glaze.terracotta } }),
        place('core/kin-green-brains-out@1', 'tower-room-kin', { in: { parent: 'ceramic-tower', slot: 'tower-l1' }, p: [0, 1.2, 0] }),
        place('core/bowl@1', 'temple-bowl', { in: { parent: 'minaret-temple', slot: 'temple-l0' }, p: [0, 0, 0] }),
      ] },
      { note: 'the kin, hovering in their row (scene.json kin)', group: 'kin', ops: s.kin.map((k) => place(`core/kin-${k.model}@1`, `kin-${k.model}`, { p: [k.p[0], k.p[2]], r: Math.PI })) },
      { note: 'ceramic and moss: pots along the court, flower beds, mossy rocks, willows at the edge', group: 'planting', ops: [
        ...[[-6, -9.5], [6, -9.5], [-6, 9.5], [6, 9.5]].map(([x, z], i) => place('core/planter-box@1', `court-planter-${i + 1}`, { p: [x, z] })),
        place('core/flower-bed@1', 'bed-north', { p: [0, -14] }),
        place('core/mossy-rock-1-pack@1', 'rock-1', { p: [-30, -22] }), place('core/mossy-rock-2-pack@1', 'rock-2', { p: [30, 20] }),
        place('core/mushrooms-red-pack@1', 'mushrooms-1', { p: [-33, 14] }), place('core/mushrooms-tan-pack@1', 'mushrooms-2', { p: [34, -16] }),
        ...[[-36, -28], [36, -28], [-36, 28], [36, 28]].map(([x, z], i) => place(i % 2 ? 'core/willow-tree-2-pack@1' : 'core/willow-tree-1-pack@1', `willow-${i + 1}`, { p: [x, z] })),
        place('core/wildflowers@1', 'meadow-south', { shape: { area: rect(-38, kinZ + 2, 38, z1 - 1) }, params: {} }),
      ] },
    ],
  };
}

const BUILDERS = { lm: ['littlemartians-garden', lmGarden] };
export { BUILDERS };

if (import.meta.url === `file://${process.argv[1]}`) {
  const want = process.argv.slice(2).filter((a) => !a.startsWith('--') && BUILDERS[a]);
  for (const k of want.length ? want : Object.keys(BUILDERS)) {
    const [file, build] = BUILDERS[k];
    const t = build();
    const out = resolve(root, `worlds/templates/${file}.json`);
    writeFileSync(out, JSON.stringify(t, null, 1) + '\n');
    console.log(`${file}: ${t.batches.length} batches, ${t.batches.reduce((n, b) => n + b.ops.length, 0)} ops → ${out}`);
  }
}
