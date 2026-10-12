#!/usr/bin/env node
// Write worlds/templates/mars-two.json: the Mars 2026 campus as god ops over the library's core/mars-* defs
// (tools/god-skill/scripts/mars-two/build.mjs makes them), every piece where the reference has it.
//
//   node tools/god-skill/scripts/mars-two/template.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, X0 } from './v3.mjs';
import { ROOMS, ROOM_AT } from './layout.mjs';
import { orientOp, BEARING } from './frame.mjs';
import { NEAR_OPS, FAR_OPS } from './land.mjs';

const P = JSON.parse(readFileSync(join(ROOT, 'worlds/core-assets/mars/placements.json'), 'utf8')).placements;
const DEFS = new Map(JSON.parse(readFileSync(join(ROOT, 'packages/world-compiler/src/core-kit/mars.json'), 'utf8')).map((d) => [`core/${d.name.slice(5)}@${d.version ?? 1}`, d]));
const r3 = (v) => Math.round(v * 1000) / 1000;
const NUM = { 1: 'coffee-counter', 2: 'tea-table', 3: 'study-table', 4: 'study-chair', 5: 'study-chair', 6: 'study-chair', 7: 'study-chair', 8: 'papasan', 9: 'tea-stool', 10: 'tea-stool', 11: 'tea-stool', 12: 'red-sofa', 13: 'honey-sofa', 14: 'cream-recliner', 15: 'prep-table', 18: 'commercial-fridge', 19: 'chest-freezer', 20: 'bus-seat', 21: 'bus-seat', 22: 'bus-seat', 23: 'bus-seat', 24: 'bus-seat', 25: 'bus-seat', 26: 'diner-table', 27: 'diner-table', 28: 'diner-table', 29: 'white-fridge' };

// Gene's corrections (2026-10-10, true compass) are in the source itself: #1 on main's west wall in the raised north, #2 in
// Mimos floor near the glazing, #3 at main's north wall before the whiteboard, #13 on Mimos floor's north poster wall, the
// kitchen west of the diner with its counters, the bus seats on the diner's east wall.
// MARSFIX: the first reading's fit nudges (study set, booths, fridges, prep table, a tea stool) are gone: the true-compass
// source stands every piece clear (mars-src-fix 076d458; e2e mars-two / mars-lived walk them).
const MOVE = {};
const MOVE_ITEM = {};
const used = new Set();
const uniq = (base) => { let n = base, k = 2; while (used.has(n)) n = `${base}-${k++}`; used.add(n); return n; };
const short = (def) => def.replace(/^core\/mars-/, '').replace(/@\d+$/, '').replace(/-\d+$/, '');
const bld = P.filter((p) => p.cat === 'building');
const pos = new Map(bld.map((b) => [b.building, b.p]));

// rooms of the authored buildings in the mars-two frame (x = E + X0, z = −N)
const roomAt = (b, x, z, y) => (ROOMS[b] ?? []).find(([, , n0, n1, e0, e1, ry]) => x >= e0 + X0 - 0.02 && x <= e1 + X0 + 0.02 && -z >= n0 - 0.02 && -z <= n1 + 0.02 && Math.abs(y - ry) < 0.2);

const ops = { campus: [], site: [], mimos: [], kitchen: [], chiba: [], more: [], items: [], places: [] };
for (const b of bld) ops.campus.push({ op: 'place', def: b.def, name: b.building, p: b.p, r: 0 });
// MARSLIVED: the authored fixtures the reference lacks (Mimos's glazed front, the Tool library's stair)
for (const f of P.filter((p) => p.cat === 'fixture')) ops.campus.push({ op: 'place', def: f.def, name: f.name, p: f.p, r: f.r });
for (const s of P.filter((p) => p.cat === 'site')) ops.site.push({ op: 'place', def: s.def, name: uniq(short(s.def)), p: s.p, r: s.r });

const tables = [];
for (const f of P.filter((p) => p.cat === 'seat' || p.cat === 'table' || p.cat === 'cold' || p.cat === 'prop')) {
  const num = f.nums?.[0], name = uniq(num ? `${NUM[num] ?? short(f.def)}-${num}` : short(f.def));
  if (MOVE[num]) { f.orig = f.p; f.p = f.p.map((v, i) => r3(v + MOVE[num][i])); }
  const room = roomAt(f.building, f.p[0], f.p[2], f.p[1]);
  let op;
  if (room) {
    const [id, , n0, n1, e0, e1] = room, at = ROOM_AT[f.building]?.[id], cx = at ? at[1] + X0 : (e0 + e1) / 2 + X0, cz = at ? -at[0] : -(n0 + n1) / 2;
    op = { op: 'place', def: f.def, name, in: { parent: f.building, slot: id }, p: [r3(f.p[0] - cx), r3(f.p[2] - cz)], r: f.r };
  } else op = { op: 'place', def: f.def, name, p: f.p, r: f.r };
  ((f.building !== 'site' && ops[f.building]) || ops.more).push(op);
  if (f.cat === 'table') tables.push({ f, name, path: room ? `${f.building}/${name}` : name, def: DEFS.get(f.def) });
}
for (const it of P.filter((p) => p.cat === 'item')) {
  const name = uniq(short(it.def));
  // on the table it stands on (its top slot), else where it is
  const at = (f) => f.orig ?? f.p;
  const t = tables.find(({ f, def }) => { const [w, , d] = def.size.box, top = at(f)[1] + (def.slots?.[0]?.p?.[1] ?? 0); return Math.abs(it.p[0] - at(f)[0]) <= w / 2 && Math.abs(it.p[2] - at(f)[2]) <= d / 2 && Math.abs(it.p[1] - top) < 0.08; });
  const mv = MOVE_ITEM[it.def.replace(/@\d+$/, '')], p = mv ? it.p.map((v, i) => r3(v + mv[i])) : it.p;
  ops.items.push(t ? { op: 'place', def: it.def, name, in: { parent: t.path, slot: 'top' }, p: [r3(it.p[0] - at(t.f)[0]), 0, r3(it.p[2] - at(t.f)[2])] } : { op: 'place', def: it.def, name, p });
}
// Named places are the buildings and their rooms (walk:mimos, walk:mimos/floor, walk:kitchen/dining-hall …); their labels
// carry the aliases (Chiba kitchen, diner, tea room). No flags: their labels draw through walls (VIS backlog).
const T = {
  schema: 'genesis/1',
  name: 'Mars two',
  description: 'The Mars College 2026 campus in the new engine, built from the library (core/mars-* defs any god can place): Mimos and the Chiba kitchen and dining hall laid out as Gene corrected them (the L-shaped Mimos with the raised main and the glazed tea room, the outdoor gap, the kitchen west of the diner with its perimeter counters, sinks and prep table, the two northeast shower bays), Chiba with the auditorium, the Dojo, Tool camp, the Freeside compound, the west rack building, and every van, bus, trailer, toilet and hut where the reference (sim.mars.college, 2026) has them. Furniture is the reference\'s own: Souls sit on the sofas, chairs, stools and bus seats and put things on the tables and counters.',
  constants: { extent: 1200, ground: 'land', limits: { budget: { tris: 200000, bytes: 6000000, texPx: 2048 } } },
  state: {
    constitution: '# Mars two\nThe Mars College 2026 campus on the low Sonoran desert by the Salton Sea: Mimos (the café and lounge), the Chiba kitchen and dining hall, the Chiba auditorium, the Dojo, Tool camp and the Freeside compound.\n\nRebuilt in the new engine from the 2026 reference with Gene\'s Mimos and kitchen corrections.',
    sky: { palette: 'mars-desert', sun: 0.8 }, weather: { kind: 'clear', clouds: 0.05, wind: 0.25, rain: 0, fog: 0 }, ground: { palette: 'playa' },
  },
  batches: [
    { note: 'the campus buildings (Mimos, the Chiba kitchen and dining hall, the showers as Gene corrected them; Chiba, Dojo, Tool camp, Freeside, the west racks)', group: 'campus', ops: ops.campus },
    { note: 'Mimos furniture: the coffee counter (#1), the tea table (#2), the study table (#3) and its chairs (#4–7), the papasan (#8), the tea stools (#9–11), the red sofa (#12), the honey sofa beneath the posters (#13), the cream recliner (#14)', group: 'mimos', ops: ops.mimos },
    { note: 'the kitchen and dining hall: perimeter counters with the sinks, the prep table (#15), the fridges and freezer (#18, #19, #29), the bus seats (#20–25) and blue tables (#26–28)', group: 'kitchen', ops: ops.kitchen },
    { note: 'Chiba and the field: the auditorium sofas, folding chairs, tier cushions, the presenter box, the classroom table and desk; the field chairs and the teal sofa', group: 'chiba', ops: ops.chiba },
    { note: 'the rest of the furnished campus: Freeside (open-mic room, lime sofa, spool tables, hydro cart), CoLab (taupe sofa, drawer coffee table, floor lamp), the Tool library and workshop, OG (clubhouse sofa and table, the east dinner table and chairs, the kitchen)', group: 'more', ops: ops.more },
    { note: 'things to carry: the prep mixing bowls and stock pot, the tea kettle and cups, the study mugs', group: 'items', ops: ops.items },
    { note: 'the site: vans, buses, trailers, RVs, toilets, huts, the forklift, OG', group: 'site', ops: ops.site },
  ],
};
// MARSLAND: the world frame is geographic (frame.mjs): every root-level placement turns about the Mimos origin, which
// becomes the world's (0, 0); parent-local placements are unchanged.
for (const b of T.batches) b.ops = b.ops.map(orientOp);
// MARSLAND: the land around it, already in the world frame (land.mjs)
T.batches.push({ note: 'the land: the playa, the tyre ring of the old race track west of camp, tyre tracks, creosote scrub; beyond the edge the 111, the wash, the salt flats, the Salton Sea and the mountains', group: 'land', ops: [...NEAR_OPS, ...FAR_OPS] });
writeFileSync(join(ROOT, 'worlds/templates/mars-two.json'), JSON.stringify(T, null, 1) + '\n');
console.log(`mars-two.json: ${T.batches.reduce((n, b) => n + b.ops.length, 0)} ops (${Object.entries(ops).map(([k, v]) => `${k} ${v.length}`).join(', ')})`);
