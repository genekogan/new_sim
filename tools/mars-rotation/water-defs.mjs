#!/usr/bin/env node
// W5 (lane mars, 2026-10-16): the two Mars-local defs of the water patch, derived from the core kit so they look like
// the catalogue's tank and planter. Writes worlds/patches/mars-water-20261016/defs.json (deterministic; re-run to check).
//  - mars-water-tank: the core raised tank with no magic actions (its own fill/empty are dropped): water only leaves it
//    into a can a resident holds (server god/water.ts `draw-water`) and only arrives by a delivery (the creator's `set`).
//  - mars-planter: the core raised planter with lower shrubs, a soil bed and a damp patch (kit role `fill`) that spreads
//    with its `moisture` state (viewer vocab-look.ts); residents water it from a can (`water`).
//  - mars-watering-can: the core can, tagged `item` so a hand can hold it in the entity world too; no magic fill/empty.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const ROOT = new URL('../../', import.meta.url).pathname;
const kit = (f) => JSON.parse(readFileSync(`${ROOT}packages/world-compiler/src/core-kit/${f}`, 'utf8'));
const pick = (list, name) => structuredClone(list.find((d) => d.name === name));
const strip = ({ category: _c, synonyms: _s, ...d }) => d;

const tank = strip(pick(kit('vocab-w2.json'), 'core-water-tank'));
Object.assign(tank, {
  name: 'mars-water-tank',
  description: 'The camp water tank on its steel stand (about 1,500 L when full), refilled by the water truck. Residents fill a watering can they hold from it; its gauge shows what is left.',
  tags: ['utility', 'water', 'tank', 'mars'],
  params: { ...tank.params, litres: { type: 'number', min: 1, max: 100000, default: 1500, doc: 'capacity in litres' } },
  state: { level: { type: 'number', min: 0, max: 1, default: 0.6 } },
  actions: [],
});

const planter = strip(pick(kit('props.json'), 'core-planter-box'));
const shapes = planter.make.args.shapes.filter((s) => s.kind !== 'sphere');
shapes.push(
  // above the rim slab (its top is at .51 m): dry soil, then the damp patch that spreads with `moisture`
  { kind: 'box', at: [0, 0.522, 0], size: [1.34, 0.024, 0.54], round: 0, tint: 'soil' },
  { kind: 'box', at: [0, 0.539, 0], size: [1.3, 0.01, 0.5], round: 0, tint: 'wet', role: 'fill', pivot: [0, 0.539, 0] },
  ...[-0.5, -0.17, 0.17, 0.5].flatMap((x, i) => [
    { kind: 'sphere', at: [x, 0.6, i % 2 ? 0.12 : -0.12], r: 0.11, segments: 6, tint: i % 2 ? 'leaf2' : 'leaf', scale: [1, 0.9, 1] },
    { kind: 'cyl', at: [x, 0.53, i % 2 ? 0.12 : -0.12], r: 0.012, h: 0.08, segments: 4, tint: 'leaf' },
  ]),
);
planter.make.args.shapes = shapes;
Object.assign(planter, {
  name: 'mars-planter',
  description: 'A raised wooden garden bed of desert greens (1.4 m); the soil darkens as it is watered. Residents water it from a watering can they carry from the water tank.',
  tags: ['prop', 'planter', 'garden', 'plant', 'mars'],
  params: { ...planter.params, soil: { type: 'color', default: '#7a5a3c', doc: 'dry soil colour' }, wet: { type: 'color', default: '#3a2a1e', doc: 'damp soil colour' }, litres: { type: 'number', min: 1, max: 1000, default: 8, doc: 'litres to soak the bed from dry' } },
  state: { moisture: { type: 'number', min: 0, max: 1, default: 0.2 } },
  palette: { ...planter.palette, soil: '#7a5a3c', wet: '#3a2a1e' },
  actions: [],
});
planter.size = { box: [planter.size.box[0], 0.72, planter.size.box[2]] };

// the core can's tags (object, tool) lack `item`, which a body's carry slot requires: the engine puts it in the hand but the
// entity world refuses the write-back (slot.incompatible), so viewers keep drawing it on the ground. This copy is tagged.
const can = strip(pick(kit('vocab-w1.json'), 'core-watering-can'));
Object.assign(can, {
  name: 'mars-watering-can',
  description: 'A galvanised watering can (10 L) with a long spout and a rose; fill it at the water tank, carry it and water the garden beds.',
  tags: [...new Set([...can.tags, 'item', 'garden', 'mars'])],
  params: { ...can.params, litres: { type: 'number', min: 1, max: 50, default: 10, doc: 'capacity in litres' } },
  actions: [],
});

const out = `${ROOT}worlds/patches/mars-water-20261016`;
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/defs.json`, JSON.stringify([tank, planter, can], null, 1) + '\n');
console.log('wrote', `${out}/defs.json`);
