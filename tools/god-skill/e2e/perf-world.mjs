#!/usr/bin/env node
// Lane PERF: build a busy god-made world (~200+ things) on a running dev world, the way a god agent would
// (mint a god token as the owner, then batches of /v1/god/act). Deterministic layout: a village of cottages
// with furniture, a square, lamp and bench rows, kit and GLB trees, crops, animals, a road, woods and a meadow.
//   node tools/god-skill/e2e/perf-world.mjs <worldBase e.g. http://127.0.0.1:5552/w/perf-busy>
const base = process.argv[2]?.replace(/\/+$/, '');
if (!base) { console.error('usage: perf-world.mjs <worldBase>'); process.exit(2); }
const post = async (path, body, auth) => { const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: auth }, body: JSON.stringify(body) }); return r.json(); };
const { token } = await post('/v1/god/mint', { label: 'perf' }, 'Bearer dev:admin');
let accepted = 0, refused = 0;
async function act(ops, note) {
  const r = await post('/v1/god/act', { ops, note }, `Bearer ${token}`);
  if (r.accepted) { accepted += ops.length; return; }
  // one refusal refuses the batch: retry one by one so a single bad spot does not lose the rest
  for (const op of ops) { const one = await post('/v1/god/act', { ops: [op], note }, `Bearer ${token}`); if (one.accepted) accepted++; else { refused++; if (refused < 8) console.log('  refused', op.name, one.failures?.[0]?.code); } }
}
const ops = [];
const P = (def, name, p, extra = {}) => ({ op: 'place', def: `core/${def}@1`, name, p, ...extra });
// terrain first
await act([
  { op: 'place', def: 'core/hill@1', name: 'north-hill', p: [-40, -230], params: { height: 30, radius: 110 } },
  { op: 'place', def: 'core/pond@1', name: 'pond', shape: { area: [[-70, 40], [-48, 34], [-40, 54], [-62, 64]] } },
], 'terrain');
// a road through the village
await act([{ op: 'place', def: 'core/road@1', name: 'main-road', shape: { path: [[-140, 0], [-60, 4], [0, 0], [60, -4], [140, 0]] } }], 'road');
// ten cottages on two rows, each with a table, two chairs, a bowl and a bench out front
const kinds = ['cottage', 'cottage', 'townhouse', 'shop', 'cottage', 'roundhouse', 'cottage', 'barn', 'shed', 'cottage'];
for (let i = 0; i < 10; i++) {
  const x = -100 + (i % 5) * 45, z = i < 5 ? -28 : 28, c = `$c${i}`, t = `$t${i}`;
  await act([
    { op: 'place', tmp: c, def: `core/${kinds[i]}@1`, name: `house-${i}`, p: [x, z], r: i < 5 ? 0 : Math.PI },
    { op: 'place', tmp: t, def: 'core/table@1', name: `table-${i}`, in: { parent: c }, p: [0, 0, 0] },
    { op: 'place', def: 'core/chair@1', name: `chair-${i}a`, in: { parent: c }, p: [1.0, 0, 0], r: -1.57 },
    { op: 'place', def: 'core/chair@1', name: `chair-${i}b`, in: { parent: c }, p: [-1.0, 0, 0], r: 1.57 },
    { op: 'place', def: 'core/bowl@1', name: `bowl-${i}`, in: { parent: t, slot: 'top' } },
  ], `house ${i}`);
}
// the square: fountain, lamps, benches
await act([
  P('fountain', 'fountain', [0, 70]),
  ...[[-10, 60], [10, 60], [-10, 80], [10, 80]].map((p, i) => P('lamp-post', `sq-lamp-${i}`, p)),
  ...[[-7, 70, 1.57], [7, 70, -1.57], [0, 63, 0], [0, 77, 3.14]].map(([x, z, r], i) => P('bench', `sq-bench-${i}`, [x, z], { r })),
], 'square');
// lamp and bench rows along the road
for (let i = 0; i < 24; i++) ops.push(P('lamp-post', `road-lamp-${i}`, [-130 + i * 11, i % 2 ? 9 : -9]));
for (let i = 0; i < 16; i++) ops.push(P('bench', `road-bench-${i}`, [-124 + i * 16, i % 2 ? 12 : -12], { r: i % 2 ? Math.PI : 0 }));
// kit trees and GLB trees in a park east, props scattered
const kitTrees = ['tree', 'pine', 'birch', 'fruit-tree', 'palm'];
for (let i = 0; i < 30; i++) ops.push(P(kitTrees[i % 5], `kit-tree-${i}`, [120 + (i % 6) * 12, 30 + Math.floor(i / 6) * 12], { s: 0.8 + (i % 4) * 0.1 }));
const packTrees = ['oak-tree-1-pack', 'oak-tree-2-pack', 'birch-tree-1-pack', 'autumn-tree-1-pack', 'willow-tree-1-pack', 'bush-1-pack', 'bush-2-pack'];
for (let i = 0; i < 35; i++) ops.push(P(packTrees[i % 7], `pack-tree-${i}`, [-200 + (i % 7) * 13, 40 + Math.floor(i / 7) * 13]));
const props = ['crate', 'barrel', 'planter-box', 'flower-pot', 'bin', 'mailbox', 'picnic-table', 'wheelbarrow'];
for (let i = 0; i < 24; i++) ops.push(P(props[i % 8], `prop-${i}`, [-40 + (i % 8) * 10, 110 + Math.floor(i / 8) * 9]));
// crops (GLB) in a field, and animals (GLB with behaviour)
const crops = ['corn-crop-pack', 'wheat-crop-pack', 'pumpkin-crop-pack', 'carrot-crop-pack'];
for (let i = 0; i < 24; i++) ops.push(P(crops[i % 4], `crop-${i}`, [40 + (i % 6) * 4, 120 + Math.floor(i / 6) * 4]));
const animals = ['cow-pack', 'sheep-pack', 'horse-pack', 'pig-pack'];
for (let i = 0; i < 8; i++) ops.push(P(animals[i % 4], `animal-${i}`, [110 + (i % 4) * 10, -80 - Math.floor(i / 4) * 10]));
for (let i = 0; i < ops.length; i += 25) await act(ops.slice(i, i + 25), `batch ${i / 25}`);
// areas: woods, meadow, wildflowers
await act([
  { op: 'place', def: 'core/woodland@1', name: 'woods', shape: { area: [[-120, -160], [40, -160], [40, -90], [-120, -90]] } },
  { op: 'place', def: 'core/lawn@1', name: 'green', shape: { area: [[-30, 50], [30, 50], [30, 90], [-30, 90]] } },
  { op: 'place', def: 'core/wildflowers@1', name: 'flowers', shape: { area: [[150, -40], [220, -40], [220, 10], [150, 10]] } },
], 'areas');
const snap = await (await fetch(base + '/v1/world/snapshot')).json();
console.log(JSON.stringify({ accepted, refused, entities: snap.entities.length }));
