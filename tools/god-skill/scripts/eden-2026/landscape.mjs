// Eden 2026 landscape, in the original Eden world frame: +x east, -z north, metres.
// Sources: worlds/eden/places.v1.json; eden-regions/{terrain,north,south,botanic,
// river,hill-village}.ts; packages/engine-mars/src/connected-shore.ts.
// This is a native ground/1 reconstruction, not a hidden cosmetic height mesh.
// Terrain/water precedes foundations. Detail paths have maxGrade=0 and never
// change terrain after foundations; ecology is last so it can avoid structures.

const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const ellipse = (x, z, rx, rz, n = 24, closed = false) => {
  const pts = Array.from({ length: n }, (_, i) => {
    const a = i * Math.PI * 2 / n;
    return [+(x + Math.cos(a) * rx).toFixed(3), +(z + Math.sin(a) * rz).toFixed(3)];
  });
  return closed ? [...pts, pts[0]] : pts;
};
const point = (def, name, p, params = {}) => ({ op: 'place', def: `core/${def}@1`, name: `land-${name}`, p, params });
const area = (def, name, polygon, params = {}) => ({ op: 'place', def: `core/${def}@1`, name: `land-${name}`, shape: { area: polygon }, params });
const path = (name, points, width = 2.5, material = 'gravel') => ({ op: 'place', def: 'core/footpath@1', name: `land-${name}`, shape: { path: points }, params: { width, material, maxGrade: 0, autoBridge: false, edging: false } });
const bridge = (name, points, width = 3, material = 'wood', arch = 0.35) => ({ op: 'place', def: 'core/bridge@1', name: `land-${name}`, shape: { path: points }, params: { width, material, deck: 0.15, arch, rails: true } });
const pier = (name, points, width = 2.4, platform = 4, rails = true) => ({ op: 'place', def: 'core/pier@1', name: `land-${name}`, shape: { path: points }, params: { width, height: 0.65, platform, rails, color: '#98724b' } });
const woodland = (name, bounds, density = 0.012, palette) => area('woodland', name, rect(...bounds), { density, minSpacing: 4.5, cluster: 0.35, ...(palette ? { palette } : {}) });
const lawn = (name, bounds, color = '#86a36b', material = 'grass') => area('lawn', name, rect(...bounds), { material, color, edge: 1.2 });

// Source river polyline, retained rather than replaced by a generic straight cut.
export const RIVER_PATH = [[-262,-232],[-252,-200],[-240,-170],[-246,-140],[-236,-110],[-228,-84],[-238,-58],[-246,-30],[-236,0],[-226,30],[-232,62],[-242,92],[-236,122],[-230,150],[-226,186]];
export const HILL_ROAD = [[160,-8],[170,-9],[180,-14],[188,-26],[192,-40],[200,-52],[212,-55],[220,-46],[214,-34],[204,-26],[202,-14],[210,-4],[222,-2],[234,-8],[238,-20],[232,-28],[226,-24]];
const WEST_LAKE = ellipse(-148, 2, 46, 44);
const PARK_POND = ellipse(-6, 112, 13, 8.5);
const KOI_POND = ellipse(-70, -152, 10, 6);
const SHORE_POND = [[-100,-11],[-64,-15],[-46,-13],[-29,-11],[-29,11],[-46,13],[-64,15],[-100,11]];
const SEA = [[-498,160],[-340,154],[-220,150],[-110,150],[-40,148],[60,150],[130,151],[210,155],[310,150],[400,166],[498,153],[498,498],[-498,498]];

const terrain = [
  // A quiet flat centre preserves the old commons, campus and east-side plan.
  // Old regional relief's east hill is approximately 22 m at (226,-22).
  point('hill', 'east-hillside', [226,-22], { height: 22, radius: 72, peak: 1.2 }),
  point('hill', 'vineyard-rise', [72,-153], { height: 11, radius: 82, peak: 1.4 }),
  point('hill', 'abbey-knoll', [-170,96], { height: 9, radius: 48, peak: 1.3 }),
  point('hill', 'cliff-village-bluff', [284,111], { height: 7, radius: 47, peak: 1.2 }),
  point('hill', 'east-rolling-shoulder', [366,-40], { height: 28, radius: 96, peak: 1.4 }),
  point('hill', 'northeast-ridge', [320,-224], { height: 45, radius: 132, peak: 1.7 }),
  point('mountain', 'alpine-backdrop', [-7,-365], { height: 74, radius: 165, peak: 1.25 }), // V8: a softer, forested backdrop like old Eden's hills
  point('mountain', 'northwest-backdrop', [-321,-367], { height: 96, radius: 160, peak: 1.4 }),
  point('mountain', 'northeast-backdrop', [305,-394], { height: 104, radius: 155, peak: 1.5 }),
  point('hill', 'western-hills', [-385,-65], { height: 45, radius: 125, peak: 1.6 }),
  point('hill', 'northwest-spring-hill', [-281,-250], { height: 30, radius: 82, peak: 1.5 }),
  // Water is carved into the same tiles Souls and the viewer sample. Soft banks
  // replace the old cosmetic-only cliff around water with real walkable shallows.
  area('lake', 'southern-sea', SEA, { level: -0.55, depth: 5.5, edge: 18 }),
  area('lake', 'west-lake', WEST_LAKE, { level: -2, depth: 2.6, edge: 9 }),
  area('pond', 'commons-shore-pond', SHORE_POND, { level: -2, depth: 1.5, edge: 10 }),
  area('pond', 'park-pond', PARK_POND, { level: -0.45, depth: 1, edge: 3.8 }),
  area('pond', 'botanic-koi-pond', KOI_POND, { level: -0.4, depth: 0.8, edge: 2.2 }),
  area('lake', 'canal', rect(133.2,-35,139.8,55), { level: -0.7, depth: 1.2, edge: 2 }),
  area('pond', 'golf-water-hazard', ellipse(222,-139,7,4), { level: -0.4, depth: 0.7, edge: 2.5 }),
  { op: 'place', def: 'core/river@1', name: 'land-west-river', shape: { path: RIVER_PATH }, params: { width: 7, depth: 1.1, banks: 'reeds', bankWidth: 2.5 } },
];

const waterside = [
  area('shore', 'west-lake-pebble-shore', WEST_LAKE, { material: 'pebble', width: 2.5, inner: 1 }),
  area('shore', 'park-pond-stone-edge', PARK_POND, { material: 'stone', width: 0.8, inner: 0.4 }),
  area('shore', 'koi-pond-rock-edge', KOI_POND, { material: 'pebble', width: 0.7, inner: 0.35 }),
  // Native bridges put a real level-zero support over the canal/river.
  bridge('canal-bridge-south', [[129,2],[144,2]], 3.2, 'stone', 0.4),
  bridge('canal-bridge-north', [[129,29],[144,29]], 3.2, 'stone', 0.4),
  bridge('river-stone-bridge', [[-252,-61],[-225,-55]], 4.2, 'stone', 0.6),
  bridge('botanic-red-bridge', [[-82,-152],[-58,-152]], 1.8, 'wood', 0.7),
  pier('harbour-boardwalk', [[-40,139],[100,139]], 4.8, 0, false),
  pier('harbour-west-pier', [[10,139],[10,167]], 3, 5),
  pier('harbour-east-pier', [[62,139],[62,175]], 3, 5),
  pier('lighthouse-breakwater', [[96,139],[96,187]], 5.2, 7, false),
  pier('west-lake-jetty', [[-104,26],[-122,26]], 2.2, 5),
  pier('park-pond-jetty', [[10,112],[3,112]], 1.5, 2, false),
  lawn('harbour-sand', [-100,134,-44,149], '#d8c69b', 'sand'),
  lawn('resort-strand', [112,133,203,149], '#dccba5', 'sand'),
  point('rowing-boat', 'west-lake-rowboat', [-130,23], { hull: '#3f6f8a' }),
  point('rowing-boat', 'canal-boat-south', [136.5,12], { hull: '#b55238' }),
  point('canoe', 'canal-canoe-north', [136.5,42], { hull: '#426c61' }),
  point('sailboat', 'harbour-sailboat', [69,165], { hull: '#f2efe6' }),
];

const streets = [
  path('north-avenue', [[-100,-69.5],[109,-69.5],[109,-40]], 5, 'cobble'),
  path('south-avenue', [[-96,90.5],[106.5,90.5]], 5, 'cobble'),
  path('east-promenade', [[105,-40],[105,90.5],[105,133]], 4, 'stone'),
  path('west-promenade', [[-27,-27],[-27,27],[-27,90.5]], 2.8),
  path('commons-north-gate', [[8,-28],[8,-57],[10,-69.5]], 2.8),
  path('commons-east-gate', [[28,5],[103,5]], 3.2),
  path('commons-garden-gate', [[25,26],[25,40],[25,78],[25,90.5]], 2.5),
  path('central-house-street', [[28,22],[103,22]], 3),
  path('garden-lane', [[28,38],[78,38],[103,38]], 2.5),
  path('garden-south-lane', [[28,77],[103,77]], 2.5),
  path('west-shore-approach', [[-27,0],[-32,0],[-43,0]], 2.6),
  path('lake-north-walk', [[-43,-18],[-79,-25],[-100,-38],[-148,-48],[-187,-27],[-198,12],[-178,50],[-138,54],[-104,37]], 2.3),
  path('campus-south-gate', [[-12,-69.5],[-12,-83],[-12,-111]], 3, 'stone'),
  path('campus-quad-ring', [[-31,-111],[7,-111],[7,-83],[-31,-83],[-31,-111]], 2.6, 'stone'),
  path('campus-quad-cross', [[-30,-97],[6,-97]], 2.6, 'stone'),
  path('artists-lane', [[-100,-69.5],[-74,-78],[-74,-98],[-74,-134]], 3),
  path('botanic-entry', [[-74,-134],[-72,-140],[-72,-144]], 2.2),
  path('botanic-loop', [[-82,-142],[-82,-152],[-82,-165],[-60,-165],[-60,-142],[-82,-142]], 2),
  path('vineyard-avenue', [[71,-69.5],[71,-100],[71,-126],[71,-145]], 2.4),
  path('observatory-trail', [[71,-158],[76,-166],[86,-172],[90,-182]], 2),
  path('forest-campsite-lane', [[-100,-69.5],[-120,-80],[-142,-96],[-151,-119]], 2.4, 'dirt'),
  path('castle-trail', [[-151,-119],[-166,-144],[-170,-163],[-165,-179]], 2, 'dirt'),
  path('alpine-switchback', [[-20,-134],[-45,-177],[23,-201],[-31,-235],[26,-260],[-18,-284],[6,-303]], 2.2),
  path('west-country-road', [[-100,-58],[-135,-58],[-179,-58],[-225,-55]], 3.2, 'cobble'),
  path('river-west-road', [[-252,-61],[-271,-44],[-270,40],[-258,92],[-250,131],[-232,145]], 3, 'dirt'),
  path('abbey-approach', [[-108,64],[-138,71],[-158,82],[-162,103]], 2.5, 'stone'),
  path('canal-west-quay', [[129,-33],[129,2],[129,29],[129,57]], 3.2, 'stone'),
  path('canal-east-quay', [[144,-33],[144,2],[144,29],[144,57]], 3.2, 'stone'),
  path('canal-south-crossing-west', [[105,2],[129,2]], 3.2, 'stone'),
  path('canal-north-crossing-west', [[105,29],[129,29]], 3.2, 'stone'),
  path('hill-village-lane', [[144,2],[160,-8],...HILL_ROAD.slice(1)], 3.2, 'stone'),
  path('old-town-west-entry', [[105,73],[119,73]], 3.2, 'stone'),
  path('old-town-south-walk', [[109,95],[170,95],[200,95],[242,95],[259,113]], 3.2, 'cobble'),
  path('old-town-north-link', [[129,57],[129,62]], 3, 'stone'),
  path('east-suburb-avenue', [[144,29],[176,29],[176,53],[176,82],[176,111]], 3),
  path('festival-approach', [[176,53],[230,53],[250,53]], 3),
  path('crossroads-link', [[238,-20],[260,-10],[282,-10],[284,22]], 3),
  path('makers-yard-lane', [[109,-40],[112,-64],[112,-94],[112,-124]], 3),
  path('golf-approach', [[112,-124],[171,-124],[186,-115]], 2.6),
  path('park-entry', [[0,90.5],[-2,100]], 2.2),
  path('park-gazebo-entry', [[-13,90.5],[-24,100],[-28,105]], 2.2),
  path('park-pond-loop', ellipse(-6,112,17,12.2,28,true), 2.2),
  path('park-harbour-link', [[-6,124.2],[-6,132],[10,139]], 2.2),
  path('harbour-approach', [[105,90.5],[105,131],[99,139]], 3),
  path('farm-coast-lane', [[-96,90.5],[-104,113],[-104,132],[-97,139]], 2.5),
  path('resort-promenade', [[105,133],[154,133],[198,133],[259,130]], 3.5, 'stone'),
];

const planting = [
  lawn('campus-quad-lawn', [-29,-109,5,-85], '#7fa858'),
  lawn('park-lawns-west', [-42,95,-21,133], '#84a76c'),
  // (old south lawn is the south-country woodland park with its loop paths: trees.mjs)
  lawn('botanic-zen-gravel', [-55,-165.5,-45,-158.5], '#d9d3c2', 'gravel'),
  // old Eden's gardens were many small plots with grass walks between (not a few big fields): gardenPlots below
  area('flower-garden', 'commons-flowers', rect(64,42,76,56), { rows: 0.8 }),
  area('garden-bed', 'farm-wheat', rect(-101,95,-85,110), { crop: 'wheat', rows: 1.1 }),
  area('garden-bed', 'farm-vegetables', rect(-82,95,-64,110), { crop: 'vegetables', rows: 1.2 }),
  area('garden-bed', 'abbey-kitchen-garden', rect(-180,82,-156,92), { crop: 'herbs', rows: 1.1 }),
  area('flower-garden', 'abbey-lavender', rect(-196,60,-184,94), { rows: 1.2 }),
  area('garden-bed', 'canal-allotments-north', rect(112,-31,115,6), { crop: 'mixed', rows: 0.9 }),
  area('garden-bed', 'canal-allotments-south', rect(112,12,115,51), { crop: 'vegetables', rows: 0.9 }),
  area('orchard', 'vineyard-orchard', rect(76,-137,105,-77), { species: 'apple', spacing: 7, height: 4.3 }),
  woodland('north-woods', [-20,-65,30,-32], 0.016),
  woodland('forest-campsite', [-176,-136,-106,-74], 0.011),
  woodland('east-hills-groves', [307,-148,425,71], 0.005),
  // V8: old Eden's backdrop hills were forested to their crowns: pines up the slopes that face the village
  woodland('alpine-slope-pines', [-170,-335,160,-205], 0.007, [{ kind: 'pine', weight: 7, maxSlope: 0.9, scale: [0.8,1.5] }, { kind: 'oak', weight: 1, maxSlope: 0.5 }, { kind: 'rock', weight: 1, minSlope: 0.35 }]),
  woodland('northwest-slope-pines', [-470,-470,-170,-225], 0.005, [{ kind: 'pine', weight: 8, maxSlope: 0.9, scale: [0.8,1.6] }, { kind: 'rock', weight: 1, minSlope: 0.4 }]),
  woodland('northeast-slope-pines', [170,-500,450,-265], 0.005, [{ kind: 'pine', weight: 8, maxSlope: 0.9, scale: [0.8,1.6] }, { kind: 'rock', weight: 1, minSlope: 0.4 }]),
  woodland('north-mountain-pines', [-430,-410,430,-335], 0.004, [{ kind: 'pine', weight: 7, maxSlope: 0.8, scale: [0.7,1.4] }, { kind: 'rock', weight: 2 }, { kind: 'boulder', weight: 1, minSlope: 0.25 }]),
  woodland('western-forest', [-429,-190,-285,90], 0.003),
  woodland('west-lake-willows', [-201,-47,-104,51], 0.006, [{ kind: 'birch', weight: 3, farWater: 3 }, { kind: 'oak', weight: 2, farWater: 5 }, { kind: 'reed', weight: 5, nearWater: 3, wet: 0.4 }, { kind: 'bush', weight: 2 }]),
  woodland('river-bank-groves', [-269,-229,-212,145], 0.004, [{ kind: 'birch', weight: 4, nearWater: 16, farWater: 3 }, { kind: 'bush', weight: 2 }, { kind: 'reed', weight: 4, nearWater: 4, wet: 0.4 }]),
  woodland('botanic-specimens', [-104,-170,-40,-136], 0.009, [{ kind: 'birch', weight: 3, scale: [0.6,0.95] }, { kind: 'poplar', weight: 2, scale: [0.6,0.9] }, { kind: 'bush', weight: 2 }, { kind: 'flower', weight: 4 }]),
  woodland('park-specimens', [-42,95,32,134], 0.008, [{ kind: 'oak', weight: 4, farWater: 4, scale: [0.7,1.1] }, { kind: 'poplar', weight: 1, farWater: 4 }, { kind: 'bush', weight: 2 }]),
  area('reedbed', 'commons-pond-reeds', rect(-100,-17,-34,17), { density: 0.035, minSpacing: 1.7 }),
  area('reedbed', 'park-pond-reeds', rect(-23,100,11,124), { density: 0.035, minSpacing: 1.5 }),
  area('wildflowers', 'festival-meadow-borders', rect(252,25,301,81), { density: 0.035, minSpacing: 1.3 }),
  area('wildflowers', 'east-hill-wildflowers', rect(305,-78,373,68), { density: 0.012, minSpacing: 2.2 }),
];

// Small cultivated plots (old Eden: 'Cultivated garden plot' beds ~4 x 6 m with walks between), in the garden quarter's
// former vegetable, herb and pumpkin fields; crops vary plot by plot.
{
  const CROPS = ['vegetables', 'herbs', 'mixed', 'pumpkins', 'vegetables', 'wheat'];
  let n = 0;
  for (const [x0, z0, x1, z1] of [[31,44,45,73], [49,43,61,56], [61,61,75,73]]) for (let z = z0; z + 5.2 <= z1 + 0.01; z += 6.6) for (let x = x0; x + 3.6 <= x1 + 0.01; x += 4.9)
    planting.push(area('garden-bed', `garden-plot-${++n}`, rect(x, z, x + 3.6, z + 5.2), { crop: CROPS[(n * 7) % CROPS.length], rows: 0.9 + (n % 3) * 0.2, border: true }));
}

// A vineyard is rows rather than a dense random wood. Each native hedge follows
// the terrain and no row extends across the avenue or the villa's footprint.
for (let i = 0; i < 13; i++) {
  const z = -78 - i * 4.4;
  planting.push({ op: 'place', def: 'core/hedge@1', name: `land-vine-row-${i+1}`, shape: { path: [[25,z],[65,z]] }, params: { height: 0.9, width: 0.45, color: i % 2 ? '#4f7a3c' : '#668943', flowers: false } });
}

// Batches stay small enough for ordinary Godmode commits. Phase is consumed by
// the template composer; do not put foundations between terrain sub-batches.
const batches = (phase, name, ops, size = 18) => Array.from({ length: Math.ceil(ops.length / size) }, (_, i) => ({ name: `${name}-${i+1}`, phase, ops: ops.slice(i*size, (i+1)*size) }));
// The abbey cloister (region-abbey.cloister, 18 x 16 round (-162,117.5)) sits on the abbey knoll's flank: its wings stand on
// ~0.75 m foundations but the open court between them was left at the knoll's 2-4 m, so the court-side doors opened onto a
// bank. Flatten the footprint to the wing floors; the 3 m inward edge keeps the court (3.2 m in) fully level. build.mjs
// applies it as the very last op: placed earlier it would shift every later entity id, and overlapping foundation pads apply
// in id order, so the cliff village's pads and the rail joints would resettle (L4a/doors, 2026-10-17).
export const ABBEY_COURT = area('terrace', 'abbey-cloister-court', rect(-171,109.5,-153,125.5), { level: 0.75, edge: 3 });

export const LANDSCAPE_BATCHES = [
  ...batches('terrain', 'relief-and-water', terrain),
  ...batches('detail', 'waterside', waterside),
  ...batches('detail', 'paths', streets),
  ...batches('detail', 'planting', planting),
];

export const LANDMARKS = [
  { id: 'shore-water', name: 'Commons pond and balloon bank', at: [-53,-2,0], camera: [-18,12,25], target: [-52,-1,0], note: 'Original water datum -2; broad, supported sloping bank reconstructed in ground tiles.' },
  { id: 'region-campus', name: 'Campus and library annex', at: [-12,0,-97], camera: [20,25,-59], target: [-12,3,-104] },
  { id: 'region-vineyard', name: 'Vineyard and orchard', at: [69,8,-117], camera: [117,28,-90], target: [65,8,-125] },
  { id: 'region-botanic-garden', name: 'Botanic garden and koi pond', at: [-70,-0.4,-152], camera: [-110,15,-130], target: [-70,1,-152] },
  { id: 'region-west-lake', name: 'West lake', at: [-148,-2,2], camera: [-91,15,58], target: [-148,-2,2] },
  { id: 'region-canal-quarter', name: 'Canal quarter', at: [136.5,-0.7,15], camera: [108,15,-14], target: [138,2,21] },
  { id: 'region-hillside-village', name: 'Hillside village and lookout', at: [226,22,-22], camera: [173,35,9], target: [224,23,-23], note: 'Native hill approximates old east-hill Gaussian; building foundations provide local terraces.' },
  { id: 'region-park', name: 'Park pond', at: [-6,-0.45,112], camera: [-24,8,92], target: [-6,0,112] },
  { id: 'region-harbour', name: 'Harbour boardwalk', at: [40,0,150], camera: [20,8,124], target: [40,1,150] },
  { id: 'region-harbour.lighthouse', name: 'Lighthouse', at: [96,0,187], camera: [70,10,150], target: [96,8,186] },
  { id: 'region-west-river', name: 'River stone bridge', at: [-238,0,-58], camera: [-214,15,-35], target: [-238,1,-58] },
  { id: 'region-northern-mountains', name: 'Northern mountains', at: [0,70,-365], camera: [84,48,-186], target: [0,60,-340] },
];

export const LANDSCAPE_NOTES = {
  coordinateFrame: 'Original Eden x/z metres; north is -z; constants.extent=1000.',
  ordering: 'terrain phases, then all buildings and public fixtures, then detail phases in listed order; planting last.',
  nativeHeight: 'Ground recipe is the sole height source. Old cosmetic outer relief is approximated by native landforms, with real water and banks.',
  pathPolicy: 'Every decorative path has maxGrade=0 and autoBridge=false. Explicit bridges provide the canal, river and koi crossings.',
  performance: 'Area ecology uses scatter/2 instances and bounded densities; forests are not thousands of independent entity roots.',
  sources: ['worlds/eden/places.v1.json','mars/viewer/app/engine-view/content/assets/eden-regions/terrain.ts','mars/viewer/app/engine-view/content/assets/eden-regions/north.ts','mars/viewer/app/engine-view/content/assets/eden-regions/south.ts','mars/viewer/app/engine-view/content/assets/eden-regions/botanic.ts','mars/viewer/app/engine-view/content/assets/eden-regions/river.ts','packages/engine-mars/src/connected-shore.ts'],
};
