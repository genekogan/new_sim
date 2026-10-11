#!/usr/bin/env node
// Lane PERF2: a world of repeated imported models (GLB instancing A/B). 12 Mars furniture/vehicle types x 15 copies and
// 3 LM scans x 6, in rows in front of the arrival, placed the way a god agent would (/v1/god/act batches).
//   node tools/god-skill/e2e/perf2-glb-world.mjs <worldBase e.g. http://127.0.0.1:5913/w/perf2-glb>
const base = process.argv[2]?.replace(/\/+$/, '');
if (!base) { console.error('usage: perf2-glb-world.mjs <worldBase>'); process.exit(2); }
const post = async (path, body, auth) => (await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: auth }, body: JSON.stringify(body) })).json();
const { token } = await post('/v1/god/mint', { label: 'perf2' }, 'Bearer dev:admin');
const types = ['mars-folding-chair', 'mars-study-chair', 'mars-diner-table', 'mars-navy-sofa', 'mars-white-fridge', 'mars-toilet-1', 'mars-ceramic-mug', 'mars-coffee-table-ceramic-cup', 'mars-field-chair', 'mars-site-object-2', 'mars-vehicle-6', 'mars-colab-hut-2'];
const scans = ['lm-scan-poly-01', 'lm-scan-poly-02', 'lm-scan-poly-05'];
let ok = 0, bad = 0;
const act = async (ops) => { const r = await post('/v1/god/act', { ops, note: 'perf2 glb' }, `Bearer ${token}`); if (r.accepted) ok += ops.length; else for (const op of ops) { const one = await post('/v1/god/act', { ops: [op] }, `Bearer ${token}`); if (one.accepted) ok++; else { bad++; if (bad < 6) console.log('refused', op.name, JSON.stringify(one).slice(0, 200)); } } };
for (let t = 0; t < types.length; t++) {
  const big = /vehicle|hut/.test(types[t]), step = big ? 9 : 3;
  await act(Array.from({ length: 15 }, (_, i) => ({ op: 'place', def: `core/${types[t]}@1`, name: `${types[t]}-${i}`, p: [-21 * (big ? 3 : 1) + i * step, -10 - t * (big ? 10 : 4) - (t >= 10 ? 20 : 0)], r: (i % 4) * 0.4 })));
}
for (let s = 0; s < scans.length; s++) await act(Array.from({ length: 6 }, (_, i) => ({ op: 'place', def: `core/${scans[s]}@1`, name: `${scans[s]}-${i}`, p: [-50 + i * 20, -150 - s * 25] })));
console.log(`accepted ${ok}, refused ${bad}`);
