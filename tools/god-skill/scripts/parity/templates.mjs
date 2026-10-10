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
      ground: { palette: 'sand' },
    },
    batches: [
      { note: 'the garden ground and the glazed court', group: 'garden', ops: [
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

// ------------------------------------------------------------------ small defined things (kit/2)
/** A kit/2 def from shapes whose `tint` keys are colours in `palette` (params with those defaults). */
function kitDef(name, description, tags, shapes, palette, extra = {}) {
  return { op: 'define', def: { schema: 'def/1', name, version: 1, description, tags, form: 'point',
    make: { kind: 'gen', gen: 'kit/2', args: { shapes, round: 0.015 } },
    params: Object.fromEntries(Object.entries(palette).map(([k, v]) => [k, { type: 'color', default: v, doc: `${k} colour` }])),
    size: { box: extentOf(shapes) }, palette, ...extra } };
}
/** Rough bounding box [w, h, d] of kit/2 shapes (boxes, spheres, cylinders, lathes). */
function extentOf(shapes) {
  let x0 = Infinity, x1 = -Infinity, y1 = 0, z0 = Infinity, z1 = -Infinity;
  for (const sh of shapes) {
    const [x, y, z] = sh.at; let hx, hy, hz;
    if (sh.kind === 'box') [hx, hy, hz] = sh.size.map((v) => v / 2);
    else if (sh.kind === 'sphere') hx = hy = hz = sh.r;
    else if (sh.kind === 'cyl') { const L = sh.h / 2; hx = hz = sh.pitch ? Math.max(L, sh.r) : sh.r; hy = sh.pitch ? sh.r : L; }
    else { const r = Math.max(...sh.profile.map((q) => q[0])); hx = hz = r; hy = Math.max(...sh.profile.map((q) => q[1])) / 2; }
    x0 = Math.min(x0, x - hx); x1 = Math.max(x1, x + hx); z0 = Math.min(z0, z - hz); z1 = Math.max(z1, z + hz); y1 = Math.max(y1, y + hy);
  }
  return [r2(Math.max(0.05, x1 - x0)), r2(Math.max(0.05, y1)), r2(Math.max(0.05, z1 - z0))];
}
const box = (at, size, tint, more = {}) => ({ kind: 'box', at, size, tint, ...more });
const cyl = (at, r, h, tint, more = {}) => ({ kind: 'cyl', at, r, h, segments: 8, tint, ...more });

// ------------------------------------------------------------------ Mars: the camp
async function marsCamp() {
  const m = json('worlds/mars/camp/manifest.json');
  const camp = await import(resolve(root, 'mars/viewer/engine/scenarios/eden-camp.ts'));
  const w = camp.edenCampWorld();
  const E = Object.values(w.entities);
  const regionRect = (id) => bbox(w.regions[id].polygon);
  const B = Object.fromEntries(m.buildings.map((b) => [b.id, b]));
  const bcentre = (b) => centre(b.rect);
  const roomsOf = { kitchen: [['kitchen', regionRect('kitchen')]], 'living-room': [['classroom-corner', regionRect('classroom-corner')], ['living-room', regionRect('living-room')]], bunkhouse: [['bunkhouse', regionRect('bunkhouse')]] };
  const wallColour = '#e6c9a0';
  const buildingOp = (b) => {
    const [x0, z0, x1, z1] = b.rect, W = x1 - x0, D = z1 - z0;
    const door = camp.CAMP_DOORS.find((d) => d.building === b.id);
    const rooms = roomsOf[b.id].map(([id, r]) => ({ id, rect: [r2(Math.max(0, r[0] - x0)), 0, r2(Math.min(W, r[2] - x0)), D] }));
    rooms.forEach((r, k) => { if (k > 0) rooms[k - 1].rect[2] = r.rect[0]; if (k === 0) r.rect[0] = 0; if (k === rooms.length - 1) r.rect[2] = W; });
    const doorRoom = rooms.find((r) => door.at - x0 >= r.rect[0] && door.at - x0 <= r.rect[2]) ?? rooms[0];
    return place('core/hall@1', b.id, { p: bcentre(b), params: { w: W, d: D, floorHeight: 2.6, roof: 'none', material: 'plaster', wall: wallColour, trim: '#b08a62', windows: 0.25, front: door.side,
      plan: { floors: [{ rooms, exterior: [{ room: doorRoom.id, wall: door.side, width: door.width }] }] } } });
  };
  // which room each source fixture stands in (by the manifest's camp regions)
  const inRect = (p, r) => p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3];
  const roomAt = (p) => { for (const [bid, rs] of Object.entries(roomsOf)) for (const [rid, r] of rs) if (inRect(p, r)) return { bid, rid, r }; return null; };
  const roomCentre = (bid, rid) => { const b = B[bid]; const [x0, , x1] = b.rect; const plan = buildingOp(b).params.plan.floors[0].rooms.find((q) => q.id === rid); return [x0 + (plan.rect[0] + plan.rect[2]) / 2, (b.rect[1] + b.rect[3]) / 2]; };
  const FIX = { 'table-6ft': 'core/long-table@1', 'bench-6ft': 'core/bench-seat@1', 'standing-display': 'core/screen@1', 'speaker-lectern': 'core/podium@1', 'camp-chair': 'core/chair@1',
    'computer-workstation': 'core/desk@1', 'garden-planter': 'core/planter-box@1', campfire: 'mars-campfire@1', 'chess-board': 'mars-chess-board@1' };
  const ITEM = { pot: 'core/pot@1', bowl: 'core/bowl@1', spoon: 'mars-spoon@1', 'reading-book': 'mars-book@1', 'drawing-pad': 'mars-sketch-pad@1', 'drawing-pencil': 'mars-pencil@1' };
  const fixtureOps = [], itemOps = [];
  for (const e of E.filter((e) => e.kind === 'fixture' && FIX[e.def] && e.support?.kind === 'ground')) {
    const p = [e.pose.p[0], e.pose.p[2]], at = roomAt(p);
    const extra = { r: r2(e.pose.yaw ?? 0) };
    if (at) { const c = roomCentre(at.bid, at.rid); fixtureOps.push(place(FIX[e.def], e.id, { ...extra, in: { parent: at.bid, slot: at.rid }, p: [r2(p[0] - c[0]), 0, r2(p[1] - c[1])] })); }
    else fixtureOps.push(place(FIX[e.def], e.id, { ...extra, p }));
  }
  for (const e of E.filter((e) => e.support?.kind === 'resting-on' && (ITEM[e.def] || FIX[e.def]) && !/^chess-(white|black)/.test(e.def))) {
    const host = w.entities[e.support.on]; if (!host) continue;
    const hostAt = roomAt([host.pose.p[0], host.pose.p[2]]);
    const parent = hostAt ? `${hostAt.bid}/${host.id}` : host.id;
    (FIX[e.def] ? fixtureOps : itemOps).push(place(ITEM[e.def] ?? FIX[e.def], e.id, { in: { parent, slot: 'top' }, p: [r2(e.pose.p[0] - host.pose.p[0]), 0, r2(e.pose.p[2] - host.pose.p[2])] }));
  }
  const mats = Object.values(w.regions).filter((r) => /^mat-\d/.test(r.id)).map((r) => { const b = bbox(r.polygon), c = roomCentre('bunkhouse', 'bunkhouse'), q = centre(b); return place('mars-sleep-mat@1', r.id, { in: { parent: 'bunkhouse', slot: 'bunkhouse' }, p: [r2(q[0] - c[0]), 0, r2(q[1] - c[1])], r: Math.PI / 2 }); });
  const rp = regionRect('rack-pile'), tp = regionRect('timber-pile'), pp = regionRect('plywood-pile'), bs = regionRect('build-site');
  const ring = (inner, outer) => [rect(-outer, -outer, outer, -inner), rect(-outer, inner, outer, outer), rect(-outer, -inner, -inner, inner), rect(inner, -inner, outer, inner)];
  return {
    schema: 'genesis/1',
    name: 'Mars camp',
    description: 'The Mars College camp in the new vocabulary: desert floor, low hills and creosote scatter, the kitchen, the living room with its classroom corner and the bunk house as open-topped walled rooms, every fixture and item of the camp manifest at its source position (names kept), the stock piles (pallet racks with their beams in the sockets, timber, plywood), the lookout bay as built, solar panels, a shipping container and water totes. Campfire, chess board, sleeping mats, spoons, book and sketch pad are defined (kit/2) in the template. Generated from worlds/mars/camp/manifest.json + eden-camp.ts (parity proof, docs/god/PARITY.md). Not here: dust in the air and the desert sky (world weather/sky are not rendered yet, B7), the Souls\' construction process (B5).',
    constants: { extent: 400, ground: 'land' },
    state: {
      constitution: '# Mars camp\nA Mars College camp on the low Sonoran desert by the Salton Sea: a kitchen, a living room and classroom corner, a bunk house, a fire circle, a garden and a build site.\n\nParity demonstrator: generated from the Mars camp manifest.',
      sky: { palette: 'mars-desert', sun: 0.85 }, weather: { clouds: 0.05, wind: 0.35, rain: 0 }, ground: { palette: 'desert' },
    },
    _furnish: [],
    batches: [
      { note: 'desert palette ground, low hills to the north and east (toward the Chocolate Mountains), dry grass tufts, stones and cacti outside the camp (creosote shrubs approximated)', group: 'desert', ops: [
        place('core/hill@1', 'north-hills', { p: [-20, -120], params: { height: 9, radius: 45 } }),
        place('core/hill@1', 'chocolate-mountains', { p: [110, -70], params: { height: 14, radius: 55 } }),
        ...ring(32, 90).map((a, i) => place('core/rock-field@1', `desert-scatter-${i + 1}`, { shape: { area: a }, params: { palette: [{ def: 'core/grass-tuft@1', weight: 3 }, { def: 'core/rock@1', weight: 2 }, { def: 'core/cactus@1', weight: 0.6 }, { def: 'core/boulder-pile@1', weight: 0.3 }, { def: 'core/pebbles@1', weight: 1 }], density: 0.008, cluster: 0.5 } })),
      ] },
      { note: 'defined things the library lacks (kit/2): campfire, chess board, sleeping mat, small items, container, water tote', group: 'defs', ops: [
        kitDef('mars-campfire', 'A camp fire: a ring of stones, three crossed logs and a flame; glows at night.', ['fire', 'campfire', 'light', 'mars'],
          [...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => ({ kind: 'sphere', at: [r2(0.55 * Math.cos(k * Math.PI / 4)), 0.08, r2(0.55 * Math.sin(k * Math.PI / 4))], r: 0.13, segments: 6, tint: 'stone' })),
            ...[0, 1, 2].map((k) => cyl([0, 0.12, 0], 0.06, 0.8, 'log', { pitch: Math.PI / 2, yaw: k * Math.PI / 3 })), { kind: 'lathe', at: [0, 0.14, 0], profile: [[0.22, 0], [0.13, 0.22], [0, 0.5]], segments: 6, tint: 'flame', glow: 1 }],
          { stone: '#8f877a', log: '#5e4630', flame: '#f39a3a' }, { components: { light: { color: '#ffb36a', range: 7, on: true } } }),
        kitDef('mars-chess-board', 'A folding chess board with a tray of pieces.', ['game', 'chess', 'board', 'mars'],
          [box([0, 0.01, 0], [0.42, 0.02, 0.42], 'board'), ...[0, 1, 2, 3].flatMap((i) => [0, 1, 2, 3].map((j) => box([r2(-0.1575 + i * 0.105), 0.022, r2(-0.1575 + j * 0.105)], [0.0525, 0.004, 0.0525], (i + j) % 2 ? 'dark' : 'light')))],
          { board: '#a07a4f', dark: '#3b2f25', light: '#efe4cf' }, { components: { boardGame: { game: 'chess' } } }),
        kitDef('mars-sleep-mat', 'A rolled-out sleeping mat with a pillow.', ['bed', 'mat', 'sleep', 'mars'],
          [box([0, 0.025, 0], [0.8, 0.05, 1.95], 'mat', { round: 0.02 }), box([0, 0.07, -0.78], [0.55, 0.08, 0.3], 'pillow', { round: 0.03 })],
          { mat: '#4f7a8a', pillow: '#efe4cf' }, { components: { bed: { height: 0.06 } }, slots: [{ id: 'mat', kind: 'bed', p: [0, 0.06, 0], yaw: 0, height: 0.06, accepts: { tags: ['body'] }, capacity: 1 }] }),
        kitDef('mars-spoon', 'A wooden spoon.', ['item', 'spoon', 'kitchen'], [box([0, 0.01, 0.04], [0.025, 0.012, 0.13], 'wood'), { kind: 'sphere', at: [0, 0.015, -0.05], r: 0.028, segments: 6, tint: 'wood' }], { wood: '#b08a5a' }, { components: { carryable: { mass: 0.05 } }, layer: 'decor' }),
        kitDef('mars-book', 'A paperback book.', ['item', 'book', 'readable'], [box([0, 0.015, 0], [0.15, 0.03, 0.22], 'cover'), box([0.004, 0.015, 0], [0.14, 0.026, 0.21], 'pages')], { cover: '#b3482f', pages: '#f3eee2' }, { components: { carryable: { mass: 0.3 }, readable: { pages: 120 } }, layer: 'decor' }),
        kitDef('mars-sketch-pad', 'A sketch pad.', ['item', 'paper', 'drawing'], [box([0, 0.006, 0], [0.3, 0.012, 0.22], 'paper')], { paper: '#f6f2e8' }, { components: { carryable: { mass: 0.2 } }, layer: 'decor' }),
        kitDef('mars-pencil', 'A pencil.', ['item', 'pencil', 'drawing'], [cyl([0, 0.005, 0], 0.004, 0.17, 'wood', { pitch: Math.PI / 2 })], { wood: '#e0b23a' }, { components: { carryable: { mass: 0.01 } }, layer: 'decor' }),
        kitDef('mars-container', 'A weathered 20 ft shipping container, doors to the camp.', ['container', 'shipping', 'mars', 'storage'],
          [box([0, 1.295, 0], [6.06, 2.59, 2.44], 'steel'), ...[-2.4, -1.2, 0, 1.2, 2.4].map((x) => box([x, 1.295, 1.23], [0.12, 2.5, 0.04], 'rib')), box([3.04, 1.295, 0], [0.04, 2.4, 2.3], 'rib')],
          { steel: '#a8553f', rib: '#8a4232' }, { layer: 'solid' }),
        { op: 'define', def: { schema: 'def/1', name: 'mars-lookout-stair', version: 1, description: 'The lookout bay stair: a 10-tread timber flight up to the 2 m deck.', tags: ['stairs', 'mars', 'build'], form: 'point', make: { kind: 'gen', gen: 'stairs/1' }, params: { rise: { type: 'number', default: 2 }, run: { type: 'number', default: 2.6 }, width: { type: 'number', default: 0.9 }, material: { type: 'string', default: 'wood' } }, size: { box: [0.9, 2, 2.6] }, layer: 'solid' } },
        kitDef('mars-water-tote', 'An IBC water tote: a white tank in a grey cage on a pallet.', ['water', 'tote', 'tank', 'mars'],
          [box([0, 0.07, 0], [1.2, 0.14, 1.0], 'pallet'), box([0, 0.65, 0], [1.1, 1.0, 0.95], 'tank', { round: 0.08 }), box([0, 0.65, 0], [1.16, 1.04, 1.0], 'cage', { round: 0.01 })],
          { pallet: '#a07a4f', tank: '#eef0ec', cage: '#8c9196' }, { layer: 'solid' }),
      ] },
      { note: 'the three camp buildings (open-topped walled rooms, 2.6 m walls, one door each)', group: 'buildings', ops: m.buildings.map(buildingOp) },
      { note: 'every camp fixture at its source position (kitchen tables, classroom, computers, chess, reading and drawing tables, fire circle, garden)', group: 'fixtures', ops: fixtureOps },
      { note: 'items on the tables (pots, bowls, spoons, book, sketch pad, pencil) and the bunk-house mats', group: 'items', ops: [...itemOps, ...mats] },
      { note: 'build stock: pallet racks with their beams in the sockets, the timber and plywood piles; the lookout bay as built', group: 'build', ops: [
        place('core/pallet-rack@1', 'upright-a', { tmp: '$ra', p: [r2(rp[0] + 1.6), r2(rp[1] + 1.2)] }),
        place('core/pallet-rack@1', 'upright-b', { tmp: '$rb', p: [r2(rp[0] + 1.6), r2(rp[1] + 4)] }),
        ...[1, 2].map((k) => place('core/rack-beam@1', `beam-${k}`, { in: { parent: '$ra', slot: `beam-l-${k}` }, p: [0, 0, 0] })),
        ...[3, 4].map((k) => place('core/rack-beam@1', `beam-${k}`, { in: { parent: '$rb', slot: `beam-l-${k - 2}` }, p: [0, 0, 0] })),
        place('core/timber-pile@1', 'timber-pile', { p: centre(tp) }),
        place('core/plywood-stack@1', 'plywood-pile', { p: centre(pp) }),
        place('core/deck@1', 'lookout-bay', { shape: { area: rect(r2(bs[0] + 2), r2(bs[1] + 1.5), r2(bs[0] + 4.75), r2(bs[1] + 3.3)) }, params: { height: 2, rails: true, material: 'wood' } }),
        place('mars-lookout-stair@1', 'lookout-stair', { p: [r2(bs[0] + 6.2), r2(bs[1] + 2.4)], r: -Math.PI / 2, params: { rise: 2, run: 2.6, width: 0.9, material: 'wood' } }),
      ] },
      { note: 'the edge of camp: solar panels, a shipping container and water totes outside the walls', group: 'edge', ops: [
        ...[0, 1, 2].map((k) => place('core/solar-panel@1', `solar-panel-${k + 1}`, { p: [26, -16 + k * 3] })),
        place('mars-container@1', 'shipping-container', { p: [30, 6], r: -Math.PI / 2 }),
        ...[0, 1, 2].map((k) => place('mars-water-tote@1', `water-tote-${k + 1}`, { p: [26 + k * 1.5, 14] })),
      ] },
    ],
  };
}

// ------------------------------------------------------------------ Eden: a district
function edenDistrict() {
  const P = Object.fromEntries(json('worlds/eden/places.v1.json').places.map((p) => [p.id, p]));
  const B = (id) => bbox(P[id].polygon);
  const house = (id, def, front, params) => { const b = B(id); return place(def, id, { p: centre(b), params: { w: r2(b[2] - b[0]), d: r2(b[3] - b[1]), front, ...params } }); };
  const pond = P['shore-water'], bank = B('shore-bank');
  const pb = bbox(pond.polygon);
  const pondArea = [[pb[0] + 1, pb[1] + 3], [pb[0] + 6, pb[1]], [pb[2] - 1, pb[1] + 2], [pb[2], pb[1] + 11], [pb[2] - 2, pb[3] - 2], [pb[0] + 5, pb[3]], [pb[0], pb[3] - 6]];
  const street = 21.5;
  const plaza = [66, 12, 84, 26];   // relocated: the old-town plaza (119..159, 62..84) brought to the end of the housing street
  return {
    schema: 'genesis/1',
    name: 'Eden district',
    description: 'A representative Eden district in the new vocabulary: the four homes of the housing street at their source footprints (brick courtyard house, two-storey balcony house, timber and stone two-storey houses) with furnished interiors, the lamp-lit street, the commons pavilion, the pond with its sloping bank, reeds and a family of ducks, the library, and the old-town plaza with its fountain, café tables and benches brought to the end of the street, plus the hot-air balloon (from the festival meadow) and the ferris wheel (from the seaside resort) brought into view. Place names kept from worlds/eden/places.v1.json (parity proof, docs/god/PARITY.md). Courtyards are drawn as plain rooms (courtyard plans are a gap).',
    constants: { extent: 600, ground: 'land' },
    state: { ground: { palette: 'grass' }, constitution: '# Eden district\nA growing settlement between hills and the sea: a commons by a calm pond, a lamp-lit street of homes, a library and a plaza with a fountain.\n\nParity demonstrator: generated from the Eden places.', sky: { palette: 'clear-day', sun: 0.6 } },
    _furnish: ['eden-house-1', 'eden-house-2', 'eden-house-3', 'eden-house-4', 'eden-library-1'],
    batches: [
      { note: 'the pond with its sloping bank, reeds and stones; the commons lawn', group: 'pond', ops: [
        place('core/pond@1', 'shore-water', { shape: { area: pondArea }, params: { depth: 1.6, level: -0.2 } }),
        place('core/shore@1', 'shore-bank', { shape: { area: pondArea }, params: { material: 'grass', width: 4, inner: 0.5 } }),
        place('core/reedbed@1', 'pond-reeds', { shape: { area: rect(pb[2] - 3, pb[1] + 2, pb[2] + 2, pb[1] + 9) } }),
        place('core/lawn@1', 'commons', { shape: { area: rect(bank[0], -14, 26, 14) }, params: { material: 'grass' } }),
        place('core/duck@1', 'mother-duck', { p: [-53, 0], params: { behavior: 'swim', radius: 5, speed: 0.45 } }),
        place('core/animals@1', 'ducklings', { shape: { area: rect(-57, -5, -50, 5) }, params: { species: 'duck', count: 5, scale: 0.5, speed: 0.5, behavior: 'swim' } }),
        place('core/lilypad-pack@1', 'lilypads', { p: [-58, 6], constraints: [{ kind: 'float' }] }),
        place('core/bench@1', 'bank-bench', { p: [-40, 4], r: -Math.PI / 2 }),
      ] },
      { note: 'the commons pavilion and a path to the housing street', group: 'commons', ops: [
        place('core/pavilion@1', 'commons-pavilion', { p: centre(B('commons-pavilion')), params: { w: 6, d: 4.5 } }),
        place('core/footpath@1', 'commons-path', { shape: { path: [[-30, 2], [0, 6], [20, 10], [27, street]], width: 2 }, params: { width: 2, material: 'gravel' } }),
      ] },
      { note: 'the lamp-lit housing street', group: 'street', ops: [
        place('core/street@1', 'eden-housing', { shape: { path: [[26, street], [88, street]], width: 5 }, params: { width: 5 } }),
        ...[30, 42, 54, 64].map((x, i) => place('core/lamp-post@1', `street-lamp-${i + 1}`, { p: [x, street - 3.3] })),
        ...[36, 48, 60].map((x, i) => place('core/lamp-post@1', `street-lamp-${i + 5}`, { p: [x, street + 3.3] })),
      ] },
      { note: 'the four homes at their source footprints, and the library', group: 'houses', ops: [
        house('eden-house-1', 'core/cottage@1', 's', { material: 'brick', wall: '#b86a4b', roof: 'flat', roofColor: '#5e5a57' }),
        house('eden-house-2', 'core/cottage@1', 's', { floors: 2, balcony: true, roof: 'flat', wall: '#e8dcc6', roofColor: '#5e5a57' }),
        house('eden-house-3', 'core/cottage@1', 'n', { floors: 2, material: 'wood', roof: 'flat', wall: '#b98a5c', roofColor: '#5e5a57' }),
        house('eden-house-4', 'core/cottage@1', 'n', { floors: 2, material: 'stone', roof: 'flat', wall: '#cfc8bb', roofColor: '#5e5a57' }),
        house('eden-library-1', 'core/hall@1', 's', { wall: '#efe6d4', windows: 0.8 }),
      ] },
      { note: 'roof gardens: planters and a bench on the flat roofs of houses 3 and 4 (as in Eden)', group: 'roofs', ops: [
        ...['eden-house-3', 'eden-house-4'].flatMap((h) => [[-3, -2], [3, -2]].map(([x, z], i) => place('core/planter-box@1', `${h}-roof-planter-${i + 1}`, { in: { parent: h, slot: 'roof' }, p: [x, 0, z] }))),
        place('core/bench-seat@1', 'eden-house-4-roof-bench', { in: { parent: 'eden-house-4', slot: 'roof' }, p: [0, 0, 2], r: Math.PI }),
      ] },
      { note: 'the plaza with the fountain, café tables and benches (relocated from the old town)', group: 'plaza', ops: [
        place('core/plaza@1', 'region-old-town.plaza', { shape: { area: rect(...plaza) }, params: { material: 'cobble', pattern: 'radial' } }),
        place('core/fountain@1', 'plaza-fountain', { p: [75, 19] }),
        ...[[69, 15], [81, 15], [69, 23], [81, 23]].map(([x, z], i) => place('core/parasol-table@1', `cafe-table-${i + 1}`, { p: [x, z] })),
        ...[[75, 14.6, 0], [75, 23.4, Math.PI]].map(([x, z, r], i) => place('core/bench@1', `plaza-bench-${i + 1}`, { p: [x, z], r })),
        ...[[67, 13], [83, 13], [67, 25], [83, 25]].map(([x, z], i) => place('core/tree@1', `plaza-tree-${i + 1}`, { p: [x, z] })),
      ] },
      { note: 'the balloon and the ferris wheel, brought into view', group: 'attractions', ops: [
        place('core/ferris-wheel@1', 'region-seaside-resort.ferris-wheel', { p: [12, 46], r: 0.3 }),
        place('core/balloon@1', 'festival-balloon', { p: [-12, -12] }),
        ...[[20, -20], [60, -2], [-4, 26], [92, 4]].map(([x, z], i) => place('core/oak-tree-1-pack@1', `oak-${i + 1}`, { p: [x, z] })),
      ] },
    ],
  };
}

// ------------------------------------------------------------------ furnish pass (L2 recipes against a scratch world)
async function furnish(t, port) {
  if (!t._furnish?.length) return t;
  const { startWorld } = await import(resolve(root, 'tools/god-skill/dev-world.mjs'));
  const { WorldModel } = await import(resolve(root, 'packages/world-compiler/src/index.ts'));
  const { furnishBatch } = await import(resolve(root, 'tools/god-skill/lib/furnish.mjs'));
  const tmp = resolve(root, '.lane/parity/scratch-genesis.json');
  const { _furnish, ...bare } = t;
  writeFileSync(tmp, JSON.stringify(bare));
  const { child, base } = await startWorld({ slug: 'parity-scratch', port, genesis: tmp, fresh: true, log: resolve(root, '.lane/parity/scratch.log') });
  try {
    const token = (await (await fetch(`${base}/v1/god/mint`, { method: 'POST', headers: { authorization: 'Bearer dev:admin', 'content-type': 'application/json' }, body: '{"label":"parity"}' })).json()).token;
    const s = await (await fetch(`${base}/v1/god/snapshot`, { headers: { authorization: `Bearer ${token}` } })).json();
    const model = WorldModel.fromSnapshot({ constants: s.constants, state: s.state, seed: s.seed, seq: s.counter ?? 0, editSeq: s.seq, defs: [...s.defs, ...(s.library ?? [])], entities: s.entities, ground: s.ground });
    const ops = [];
    for (const name of _furnish) { const f = furnishBatch(model, name); ops.push(...f.ops); console.log(`  furnish ${name}: ${f.placed?.length ?? f.ops.length} placed, ${f.dropped?.length ?? 0} dropped`); }
    const nameOf = Object.fromEntries(s.entities.filter((e) => !e.parent || e.parent === 'world').map((e) => [e.id, e.name]));
    for (const op of ops) if (op.in?.parent && nameOf[op.in.parent]) op.in.parent = nameOf[op.in.parent];   // ids are scratch-world ids; templates address by name
    return { ...bare, batches: [...bare.batches, { note: `furniture for ${_furnish.join(', ')} (L2 furnish recipes)`, group: 'furniture', ops }] };
  } finally { child.kill(); }
}

const BUILDERS = { lm: ['littlemartians-garden', lmGarden], mars: ['mars-camp', marsCamp], eden: ['eden-district', edenDistrict] };
export { BUILDERS };

if (import.meta.url === `file://${process.argv[1]}`) {
  const fi = process.argv.indexOf('--furnish'), port = fi > 0 ? Number(process.argv[fi + 1]) : 0;
  const want = process.argv.slice(2).filter((a) => BUILDERS[a]);
  for (const k of want.length ? want : Object.keys(BUILDERS)) {
    const [file, build] = BUILDERS[k];
    let t = await build();
    if (port) t = await furnish(t, port); else delete t._furnish;
    const out = resolve(root, `worlds/templates/${file}.json`);
    writeFileSync(out, JSON.stringify(t, null, 1) + '\n');
    console.log(`${file}: ${t.batches.length} batches, ${t.batches.reduce((n, b) => n + b.ops.length, 0)} ops → ${out}`);
  }
}
