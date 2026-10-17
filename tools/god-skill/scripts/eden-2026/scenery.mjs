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
  kit('eden-lighthouse-bands', 'Three red paint bands round the harbour lighthouse tower (old Eden: a red-and-white banded lighthouse).', [6.3, 11, 6.3],
    [2.2, 5.4, 8.6].map(y => ({ kind: 'cyl', at: [0, y, 0], r: 3.1, h: 1.3, color: RED, segments: 32, collide: false }))),
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
group('scenery: festival meadow', (put, ops) => {
  // big top: a striped canvas tent at circus scale; helter-skelter yellow tower; balloons; food stalls and lights
  ops.push(kit('eden-big-top-canopy', 'The striped canvas canopy of a circus big top (24 m, red with white seams, a pennant on the king pole); sits on an enterable hall.', [24.8, 9.8, 24.8], [
    { kind: 'cone', at: [0, 3.6, 0], r: 12.4, h: 7.2, color: RED, segments: 24, material: 'fabric', collide: false },
    ...Array.from({ length: 12 }, (_, i) => { const a = i * Math.PI / 6, c = Math.cos(a), sn = Math.sin(a); return { kind: 'sweep', at: [0, 0, 0], path: [[r3(c * 0.4), 7.0, r3(sn * 0.4)], [r3(c * 6.3), 3.6, r3(sn * 6.3)], [r3(c * 12.45), 0.05, r3(sn * 12.45)]], r: 0.16, color: WHITE, collide: false }; }),
    { kind: 'cyl', at: [0, 8.2, 0], r: 0.08, h: 3, color: '#5a4632', collide: false },
    { kind: 'box', at: [0.6, 9.3, 0], size: [1.2, 0.7, 0.05], color: YELLOW, collide: false }]));
  ops.push({ op: 'place', def: 'eden-big-top-canopy@1', name: 'festival-big-top-canopy', in: { parent: 'region-festival-meadow-big-top', slot: 'roof' }, p: [0, 0, 0] });
  // inside the tent: a sawdust ring and tiered seats facing it on four sides
  ops.push({ op: 'place', def: 'core/round-carpet-pack@1', name: 'big-top-ring', in: { parent: 'region-festival-meadow-big-top', slot: 'hall' }, p: [0, 0, 0] });
  for (const [i, x, z, r] of [[1, 0, -6.5, 0], [2, 0, 6.5, Math.PI], [3, -6.5, 0, Math.PI / 2], [4, 6.5, 0, -Math.PI / 2]]) ops.push({ op: 'place', def: 'core/theatre-seats@1', name: `big-top-seats-${i}`, in: { parent: 'region-festival-meadow-big-top', slot: 'hall' }, p: [x, 0, z], ...(r ? { r: r3(r) } : {}) });
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
  put('dome-roof', 'campus-library-dome', [0, 0, 0], { in: { parent: 'region-campus-library-annex', slot: 'roof' }, params: { sx: 1.8, sy: 1.6, sz: 1.8, roof: '#8fa6a0', drum: '#efe4cf', trim: '#e8e2d2' } });
});
group('scenery: lawns', (put, ops) => {
  // the old commons is mown in broad stripes (its south lawn is woodland park: trees.mjs)
  ops.push({ op: 'place', def: 'core/lawn@1', name: 'commons-mown-lawn', shape: { area: rect(box('field')) }, params: { stripes: true, edge: 2, color: '#64953e' } });
});
group('scenery: avenue and commons trees', put => {
  for (let i = 0; i < 12; i++) if (i !== 5) put('tree', `north-avenue-tree-${i + 1}`, [-90 + i * 16, -78], {});   // i=5 (x -10) would stand in the campus view axis
  for (let i = 0; i < 8; i++) put('tree', `south-avenue-tree-${i + 1}`, [-28 + i * 8, 92.5], {});
  for (const [i, x, z] of [[1, -34, -26], [2, -34, -12], [3, -34, 14], [4, -34, 28], [5, -26, 34], [6, -12, 34], [7, 14, 34], [8, -20, -34], [9, -4, -34], [10, 22, -34]]) put('tree', `commons-edge-tree-${i}`, [x, z], {});
});
// V5: the campus library annex's portico (old Eden: six columns carrying a flat entablature in front of the entrance);
// the middle bay stays wide open over the door.
const STONE = '#efe4cf', TRIM = '#e8e2d2';
const porticoShapes = [
  ...[-6, -3.8, -1.6, 1.6, 3.8, 6].flatMap(x => [
    { kind: 'box', at: [x, 0.15, 1.0], size: [0.82, 0.3, 0.82], color: TRIM, material: 'stone' },
    { kind: 'cyl', at: [x, 3.6, 1.0], r: 0.3, h: 6.6, segments: 14, color: STONE, material: 'stone' },
    { kind: 'box', at: [x, 6.98, 1.0], size: [0.78, 0.16, 0.78], color: TRIM, material: 'stone', collide: false }]),
  { kind: 'box', at: [0, 7.45, -0.05], size: [13.4, 0.8, 2.5], color: STONE, material: 'stone', collide: false },
  { kind: 'box', at: [0, 7.95, -0.05], size: [13.8, 0.2, 2.75], color: TRIM, material: 'stone', collide: false },
];
groups.push({ label: 'scenery: annex portico', ops: [
  kit('eden-annex-portico', 'A stone portico of six columns under a flat entablature, in front of a library entrance (old Eden campus annex).', [13.8, 8.1, 2.8], porticoShapes),
  { op: 'place', def: 'eden-annex-portico@1', name: 'campus-annex-portico', p: [-12, -114.3] }] });

// the old campus quad: a row of small trees before the annex and four benches facing the fountain
group('scenery: campus quad', put => {
  [-27, -21, -15, -9, -3, 3].forEach((x, i) => put('tree', `campus-annex-tree-${i + 1}`, [x, -113.2], { s: 0.55 }));
  [[-21, -103, 0], [-3, -103, 0], [-21, -91, Math.PI], [-3, -91, Math.PI]].forEach(([x, z, r], i) => put('bench', `campus-quad-bench-${i + 1}`, [x, z], r ? { r } : {}));
});
// V3: old Eden's flat roofs were gardens: raised planters, a bench and a parasol table on the courtyard houses' terraces
// and the office roof (slot 'roof' of each flat-roofed building; local metres from the building centre).
group('scenery: roof gardens', (put, ops) => {
  const roof = (parent, name, def, p, r = 0) => ops.push({ op: 'place', def: `core/${def}@1`, name, in: { parent, slot: 'roof' }, p, ...(r ? { r } : {}) });
  for (const h of ['eden-house-3', 'eden-house-4']) {
    roof(h, `${h}-roof-planter-1`, 'planter-box', [-4.2, 0, 0.6]); roof(h, `${h}-roof-planter-2`, 'planter-box', [4.2, 0, 0.6]);
    roof(h, `${h}-roof-bench`, 'bench', [0, 0, 0.7], Math.PI); roof(h, `${h}-roof-pot`, 'flower-pot', [-1.6, 0, -0.9]);
    roof(`${h}-kitchen`, `${h}-kitchen-roof-planter-1`, 'planter-box', [-3.8, 0, -0.6]); roof(`${h}-kitchen`, `${h}-kitchen-roof-planter-2`, 'planter-box', [-1.6, 0, -0.6]);
    roof(`${h}-kitchen`, `${h}-kitchen-roof-planter-3`, 'planter-box', [2.4, 0, -0.6]);
  }
  roof('eden-office-1', 'office-roof-parasol', 'parasol-table', [2.5, 0, 1.2]); roof('eden-office-1', 'office-roof-planter-1', 'planter-box', [-4.5, 0, -3]);
  roof('eden-office-1', 'office-roof-planter-2', 'planter-box', [-2.5, 0, -3]); roof('eden-office-1', 'office-roof-bench', 'bench', [-3.5, 0, 1.5]);
  roof('eden-library-1', 'library-roof-planter-1', 'planter-box', [-3.5, 0, -3]); roof('eden-library-1', 'library-roof-planter-2', 'planter-box', [3.5, 0, -3]);
});
// old Eden's garden greenhouse was full of raised beds; the harbour boardwalk had a striped market stall
group('scenery: greenhouse beds and harbour stall', put => {
  [[65.2, 34.1], [68.0, 34.1], [70.8, 34.1], [65.2, 36.0], [70.8, 36.0]].forEach(([x, z], i) => put('planter-box', `greenhouse-bed-${i + 1}`, [x, z]));
  put('market-stall', 'harbour-market-stall', [24, 136.5], { r: Math.PI, params: { awning: '#d9473e' } });
});
// the open-air classroom court's big screen at its north end (old Eden: a lecture screen over a low stage)
groups.push({ label: 'scenery: classroom screen', ops: [{ op: 'place', def: 'core/screen@1', name: 'classroom-court-screen', in: { parent: 'eden-classroom-1', slot: 'classroom' }, p: [0, 0, -8.6] }] });
// the little stone fountain in front of old Eden's library
groups.push({ label: 'scenery: library fountain', ops: [{ op: 'place', def: 'core/fountain@1', name: 'library-square-fountain', p: [80.5, 1.6], s: 0.6 }] });
// V7: the park pond's stone kerb (old Eden: a stepped stone basin), with gaps at the jetty and three swimming steps.
{
  const pts = Array.from({ length: 41 }, (_, i) => { const a = i / 40 * Math.PI * 2; return [r3(-6 + Math.cos(a) * 14.1), r3(112 + Math.sin(a) * 9.6)]; });
  const len = pts.slice(1).reduce((L, p, i) => L + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
  groups.push({ label: 'scenery: park pond kerb', ops: [{ op: 'place', def: 'core/garden-wall@1', name: 'park-pond-stone-kerb', shape: { path: pts },
    params: { height: 0.42, thickness: 0.7, material: 'stone', color: '#b9b2a4', cap: true, gates: [{ at: 0.6, width: 3 }, { at: r3(len * 0.25), width: 1.8 }, { at: r3(len * 0.5), width: 1.8 }, { at: r3(len * 0.75), width: 1.8 }, { at: r3(len - 0.6), width: 3 }] } }] });
}

// (library and café interiors: interiors.mjs)
export const SCENERY_BATCHES = groups;
