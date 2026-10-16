// Eden 2026 scenery and life: the landmarks old /w/eden drew as viewer-only scenery (eden-regions/*.ts), rebuilt as
// editable core-kit entities at the same original place coordinates (worlds/eden/places.v1.json). Every batch is
// optional ("droppable"): a piece the compiler refuses is dropped and recorded in inventory.json, never forced.
import { readFileSync } from 'node:fs';
const P = JSON.parse(readFileSync(new URL('../../../../worlds/eden/places.v1.json', import.meta.url))).places;
const box = id => { const p = P.find(q => q.id === id); if (!p) throw Error(`missing original Eden place ${id}`); const xs = p.polygon.map(q => q[0]), zs = p.polygon.map(q => q[1]); return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]; };
const mid = id => { const [x0, z0, x1, z1] = box(id); return [(x0 + x1) / 2, (z0 + z1) / 2]; };
const rect = ([x0, z0, x1, z1]) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const r3 = n => Math.round(n * 1000) / 1000;
const groups = [];
const group = (label, build) => { const ops = []; const put = (def, name, p, extra = {}) => ops.push({ op: 'place', def: /[/@]/.test(def) ? def : `core/${def}@1`, name, p: p.map(r3), ...extra }); build(put, ops); groups.push({ label, ops }); };

const kit = (name, description, size, shapes, tags = ['eden', 'scenery']) => ({ op: 'define', def: { schema: 'def/1', name, version: 1, description, tags, form: 'point', size: { box: size }, make: { kind: 'gen', gen: 'kit/2', args: { shapes } } } });
const RED = '#c9342d', WHITE = '#f4efe4', YELLOW = '#f0c040';
const bigTop = [{ kind: 'cyl', at: [0, 2, 0], r: 11, h: 4, color: WHITE, segments: 24, material: 'fabric' },
  ...Array.from({ length: 12 }, (_, i) => ({ kind: 'cyl', at: [r3(Math.cos(i * Math.PI / 6) * 11.05), 2, r3(Math.sin(i * Math.PI / 6) * 11.05)], r: 0.9, h: 4, color: RED, segments: 6, material: 'fabric', collide: false })),
  { kind: 'cone', at: [0, 7.5, 0], r: 11.8, h: 7, color: RED, segments: 24, material: 'fabric' },
  { kind: 'torus', at: [0, 4.05, 0], r: 11.4, r2: 0.35, color: WHITE, segments: 24, collide: false },
  { kind: 'cyl', at: [0, 12.5, 0], r: 0.08, h: 3, color: '#5a4632', collide: false },
  { kind: 'box', at: [0.6, 13.6, 0], size: [1.2, 0.7, 0.05], color: YELLOW, collide: false }];
const spiral = Array.from({ length: 41 }, (_, i) => { const a = i / 40 * Math.PI * 5; return [r3(Math.cos(a) * 2.4), r3(8.6 - i / 40 * 8), r3(Math.sin(a) * 2.4)]; });
const helter = [{ kind: 'cyl', at: [0, 4.5, 0], r: 1.6, h: 9, color: YELLOW, segments: 12 }, { kind: 'cone', at: [0, 10.2, 0], r: 2, h: 2.4, color: RED, segments: 12 },
  { kind: 'sweep', at: [0, 0, 0], path: spiral, r: 0.32, color: RED, collide: false }];
const golfFlag = [{ kind: 'cyl', at: [0, 1.1, 0], r: 0.03, h: 2.2, color: WHITE }, { kind: 'box', at: [0.26, 1.95, 0], size: [0.5, 0.32, 0.02], color: '#d9473e', collide: false }];
groups.push({ label: 'scenery: Eden fairground and golf defs', ops: [
  kit('eden-lighthouse-bands', 'Three red paint bands round the harbour lighthouse tower (old Eden: a red-and-white banded lighthouse).', [5.3, 11, 5.3],
    [2.2, 5.4, 8.6].map(y => ({ kind: 'cyl', at: [0, y, 0], r: 2.62, h: 1.3, color: RED, segments: 24, collide: false }))),
  kit('eden-big-top', 'A red-and-white striped circus big top (23 m) with a pennant on its peak (old Eden festival meadow).', [23.6, 14, 23.6], bigTop),
  kit('eden-helter-skelter', 'A yellow helter-skelter tower with a red spiral slide (old Eden festival meadow).', [5.5, 11.4, 5.5], helter),
  kit('eden-golf-flag', 'A golf green pin: a white pole with a red flag.', [0.6, 2.2, 0.1], golfFlag)] });
group('scenery: seaside resort and marina', (put, ops) => {
  // old: a 16 m axle wheel on the beach and a striped carousel (resort-lake.ts); three pontoons of bright sails
  put('ferris-wheel', 'resort-ferris-wheel', mid('region-seaside-resort.ferris-wheel'), { params: { rim: '#d9534f', frame: '#f4f0e6' } });
  put('carousel', 'resort-carousel', [164, 134], { params: { canopy: '#d9473e', trim: '#f4efe4' } });
  for (const [i, x] of [[1, 124], [2, 136], [3, 148]]) ops.push({ op: 'place', def: 'core/pier@1', name: `marina-pontoon-${i}`, shape: { path: [[x, 140], [x, 167]] }, params: { width: 2, rails: false } });
  const sails = ['#f2c14e', '#e26d5a', '#4f8fc0', '#fbf8f0', '#7bb37a', '#e98fb2'];
  let n = 0; for (const x of [124, 136, 148]) for (const z of [157, 164]) for (const side of [-3, 3]) if ((n++ % 2) === 0) put('sailboat', `marina-sailboat-${n}`, [x + side, z], { params: { sail: sails[n % sails.length] } });
});
group('scenery: boats at sea and harbour', put => {
  for (const [i, x, z, c] of [[1, 20, 205, '#fbf8f0'], [2, 70, 232, '#f2c14e'], [3, -45, 222, '#e26d5a'], [4, 110, 196, '#fbf8f0'], [5, -100, 250, '#4f8fc0'], [6, 160, 245, '#fbf8f0']]) put('sailboat', `sea-sailboat-${i}`, [x, z], { params: { sail: c } });
  put('motorboat', 'harbour-motorboat', [4, 168], { params: { hull: '#2f5f8a' } });
  put('rowing-boat', 'harbour-rowing-boat-1', [16, 166], {});
  put('rowing-boat', 'harbour-rowing-boat-2', [56, 170], {});
});
group('scenery: canal boats and pond life', put => {
  put('narrowboat', 'canal-narrowboat-1', [135.2, -16], { params: { paint: '#2f6b4f', trim: '#d9a43a' } });
  put('narrowboat', 'canal-narrowboat-2', [137.8, 15], { params: { paint: '#8a2f2f', trim: '#e9d27a' } });
  put('rowing-boat', 'canal-rowing-boat', [137.8, 42], {});
  put('rowing-boat', 'park-pond-rowing-boat', [-12, 109], {});
  for (const [i, x, z] of [[1, -2, 114], [2, 1, 111], [3, -15, 116]]) put('duck', `park-pond-duck-${i}`, [x, z], {});
  put('swan', 'park-pond-swan', [-8, 115], {});
  for (const [i, x, z] of [[1, -50, -6], [2, -48, 4], [3, -56, 8]]) put('duck', `commons-pond-duck-${i}`, [x, z], {});
  for (const [i, x, z] of [[1, -58, -4], [2, -61, 2]]) put('swan', `commons-pond-swan-${i}`, [x, z], {});
  for (let i = 0; i < 6; i++) put('koi', `botanic-koi-${i + 1}`, [-75 + i * 2.5, -152 + (i % 2) * 2], {});
});
group('scenery: railway and train', put => {
  // the line runs east-west along the platform (train box x 116..170, z -50.4..-47.6)
  for (let i = 0; i < 7; i++) put('rail-track', `railway-track-${i + 1}`, [118 + i * 8, -49], { r: Math.PI / 2 });
  put('locomotive', 'railway-locomotive', [160, -49], { r: Math.PI / 2, params: { paint: '#2f6b4f' } });
  for (let i = 0; i < 4; i++) put('rail-wagon', `railway-carriage-${i + 1}`, [151.5 - i * 4.6, -49], { r: Math.PI / 2, params: { body: '#a8352d' } });
});
group('scenery: festival meadow', put => {
  // big top: a striped canvas tent at circus scale; helter-skelter yellow tower; balloons; food stalls and lights
  put('eden-helter-skelter@1', 'festival-helter-skelter', mid('region-festival-meadow.helter-skelter'));
  put('balloon', 'festival-balloon-2', [262, 70], { params: { env: '#d9473e', stripe: '#f4efe4' } });
  put('balloon', 'festival-balloon-3', [300, 48], { params: { env: '#3f7fb5', stripe: '#f2c14e' } });
  for (let i = 0; i < 3; i++) put('market-stall', `festival-food-stall-${i + 1}`, [258 + i * 3.4, 66], { params: { awning: ['#d9473e', '#f2c14e', '#4f8fc0'][i] } });
  for (let i = 0; i < 2; i++) put('string-lights', `festival-lights-${i + 1}`, [256 + i * 9, 60], {});
  for (let i = 0; i < 3; i++) put('flagpole', `festival-flag-${i + 1}`, [268 + i * 8, 38], {});
});
group('scenery: hills, golf and farm', put => {
  for (const [i, x, z] of [[1, 340, -110], [2, 362, -80], [3, 384, -52], [4, 404, -20], [5, 392, 14], [6, 416, 46]]) put('wind-turbine', `east-hills-turbine-${i}`, [x, z], {});
  for (const [i, x, z] of [[1, 196, -170], [2, 214, -122], [3, 240, -168], [4, 250, -128], [5, 186, -132]]) put('eden-golf-flag@1', `golf-flag-${i}`, [x, z]);
  for (let i = 0; i < 5; i++) put('sheep', `farm-sheep-${i + 1}`, [-58 + (i % 3) * 3, 124 + Math.floor(i / 3) * 3], {});
  for (let i = 0; i < 3; i++) put('cow', `farm-cow-${i + 1}`, [-96 + i * 4, 124], {});
  put('water-tower', 'makers-water-tower', [168, -70], {});
});
group('scenery: campsite and artists green', put => {
  const [cx, cz] = mid('region-campsite.fire-circle');
  const canv = ['#d9733a', '#4f8f6a', '#3f6fa5', '#c9a13a', '#a04a6a', '#5f8f3a'];
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + 0.3; put('tent', `campsite-tent-${i + 1}`, [cx + Math.cos(a) * 10, cz + Math.sin(a) * 10], { r: r3(-a - Math.PI / 2), params: { canvas: canv[i] } }); }
  const [gx, gz] = mid('region-artists-village.green');
  put('string-lights', 'artists-green-lights-1', [gx - 4, gz - 5], {});
  put('string-lights', 'artists-green-lights-2', [gx + 4, gz + 5], {});
  for (let i = 0; i < 3; i++) put('picnic-table', `artists-green-picnic-${i + 1}`, [gx - 5 + i * 5, gz + 1], {});
  put('totem', 'artists-green-totem', [gx, gz - 1], {});
});
group('scenery: lighthouse stripes', put => {
  // old harbour lighthouse is banded red and white; three red bands round the native tower (5 m, 5 x 2.6 m floors)
  put('eden-lighthouse-bands@1', 'harbour-lighthouse-bands', [96, 0.1, 188]);
});
group('scenery: campus dome', put => {
  // old north.ts: the library annex has a domed central roof over its portico; the annex is a 2-storey 7.2 m hall
  const [x, z] = mid('region-campus.library-annex');
  put('dome-roof', 'campus-library-dome', [x, 7.25, z], { params: { sx: 1.8, sy: 1.6, sz: 1.8, roof: '#8fa6a0', drum: '#efe4cf', trim: '#e8e2d2' } });
});
group('scenery: lawns', (put, ops) => {
  // old commons and south lawn are mown in broad stripes
  ops.push({ op: 'place', def: 'core/lawn@1', name: 'commons-mown-lawn', shape: { area: rect(box('field')) }, params: { stripes: true, edge: 2 } });
  ops.push({ op: 'place', def: 'core/lawn@1', name: 'south-mown-lawn', shape: { area: rect(box('eden-south-lawn')) }, params: { stripes: true, edge: 2 } });
});
group('scenery: avenue and commons trees', put => {
  for (let i = 0; i < 12; i++) put('tree', `north-avenue-tree-${i + 1}`, [-90 + i * 16, -78], {});
  for (let i = 0; i < 8; i++) put('tree', `south-avenue-tree-${i + 1}`, [-28 + i * 8, 92.5], {});
  for (const [i, x, z] of [[1, -34, -26], [2, -34, -12], [3, -34, 14], [4, -34, 28], [5, -26, 34], [6, -12, 34], [7, 14, 34], [8, -20, -34], [9, -4, -34], [10, 22, -34]]) put('tree', `commons-edge-tree-${i}`, [x, z], {});
});
group('scenery: library and cafe interiors', put => {
  for (const [name, p] of [['library-reading-rug', [-2.5, 0, -0.6]], ['library-reading-rug-2', [-3.4, 0, 1.8]]]) put('rug', name, p, { in: { parent: 'eden-library-1', slot: 'reading' }, params: { border: '#7a2e24', field: '#b8503c' } });
  put('office-desk', 'library-computer-desk', [1.2, 0, 1.9], { in: { parent: 'eden-library-1', slot: 'reading' }, r: Math.PI });
  put('bookcase', 'library-reading-shelf-1', [-4.6, 0, -1.6], { in: { parent: 'eden-library-1', slot: 'reading' }, r: Math.PI / 2 });
  put('potted-plant', 'library-reading-plant', [2.4, 0, -1.8], { in: { parent: 'eden-library-1', slot: 'reading' } });
  // cafe (int-cafe, room 8 x 3.8 m): cakes under glass, a menu board, a rug under the tables, a plant
  const cafe = { in: { parent: 'int-cafe', slot: 'cafe' } };
  put('display-case', 'cafe-cake-case', [1.3, 0, -1.2], { ...cafe, params: { g0: '#f3d9e4', g1: '#e9c46a', g2: '#c8553d' } });
  put('chalkboard', 'cafe-menu-board', [3.3, 0, 1.1], { ...cafe, r: -Math.PI / 2 });
  put('rug', 'cafe-rug', [-1.2, 0, 0.7], { ...cafe, params: { border: '#2f4f4a', field: '#c79a5b' } });
  put('potted-plant', 'cafe-plant', [-3.6, 0, 1.55], cafe);
});
export const SCENERY_BATCHES = groups;
