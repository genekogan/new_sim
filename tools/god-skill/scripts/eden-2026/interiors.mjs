// Eden 2026 interiors (gap V4): the library reading room and the corner café furnished piece for piece like old /w/eden
// (eden-interiors/existing.ts `library`, buildings.ts `int-cafe`), with core-kit furniture in the building's local frame
// (x east, z south, origin at the building centre; old world coords minus the centre). Every batch is optional: a
// piece the compiler refuses is dropped and recorded, never forced.
const r3 = n => Math.round(n * 1000) / 1000;
const PI = Math.PI, N = 0, S = PI, E = -PI / 2, W = PI / 2; // yaw: which way the piece faces (0 = +z, into a north-wall room)
const C = { walnut: '#5e3d27', oak: '#8a5a36', rust: '#b0573a', ochre: '#d19c3c', cream: '#f2ead8', navy: '#34476b', sage: '#8ea47f', rose: '#c98a8a', teal: '#2f6b6b', iron: '#3b3d40', ash: '#c9b48f' };
export const INTERIOR_DEFS = [
  // A ceiling pendant (old F.pendant): cord from the ceiling, a dark conical shade with a warm bulb; glows at night.
  { op: 'define', def: { schema: 'def/1', name: 'eden-pendant', version: 1, description: 'A ceiling pendant lamp: a dark conical shade on a cord, warm light (old Eden library and café).', tags: ['furniture', 'light', 'lamp', 'eden'], form: 'point',
    state: { on: { type: 'bool', default: true } }, components: { light: { color: '#ffd99a', range: 5, on: true } }, size: { box: [0.6, 2.92, 0.6] },
    make: { kind: 'gen', gen: 'kit/2', args: { shapes: [
      { kind: 'cyl', at: [0, 2.62, 0], r: 0.008, h: 0.6, segments: 4, color: '#2b2623', collide: false },
      { kind: 'cone', at: [0, 2.19, 0], r: 0.3, h: 0.26, segments: 14, color: '#2f3332', collide: false },
      { kind: 'sphere', at: [0, 2.06, 0], r: 0.07, color: '#ffe2a8', glow: 1, collide: false }] } } } },
];
const piece = (room, parent, name, def, p, r = 0, extra = {}) => ({ op: 'place', def: /[/@]/.test(def) ? def : `core/${def}@1`, name, in: { parent, slot: room }, p: p.map(r3), ...(r ? { r: r3(r) } : {}), ...extra });

// Library: one reading room 10.4 x 8.4 m (old interior 69.2..78.8 x -10.8..-3.2), centre (74, -7), door south.
const L = (name, def, [x, z], r, extra) => piece('reading', 'eden-library-1', `library-${name}`, def, [x - 74, 0, z + 7], r, extra);
const books = (sx, sy) => ({ params: { sx, sy } });
export const LIBRARY = [
  L('north-shelf-west', 'bookcase', [70.3, -10.6], N, books(1.6, 1.15)), L('north-shelf-east', 'bookcase', [77.7, -10.6], N, books(1.6, 1.15)),
  L('window-shelf-west', 'bookcase', [72.85, -10.6], N, books(1.85, 0.6)), L('window-shelf-east', 'bookcase', [75.15, -10.6], N, books(1.85, 0.6)),
  L('east-shelf', 'bookcase', [78.6, -7], E, books(1.2, 1.15)), L('east-low-north', 'bookcase', [78.6, -8.8], E, books(1.45, 0.6)), L('east-low-south', 'bookcase', [78.6, -5.2], E, books(1.45, 0.6)),
  L('west-shelf', 'bookcase', [69.4, -6.9], W, books(1.1, 1.15)), L('west-low-south', 'bookcase', [69.4, -5.2], W, books(1.45, 0.6)),
  L('rug-west', 'rug', [71.5, -6.3], N, { params: { border: C.rust, field: C.ochre } }), L('rug-east', 'rug', [76.5, -6.3], N, { params: { border: C.navy, field: C.cream } }),
  L('reading-table-west', 'table', [71.5, -6.4], N, { params: { top: C.oak, legs: C.walnut } }), L('reading-table-east', 'table', [76.5, -6.4], N, { params: { top: C.oak, legs: C.walnut } }),
  L('reading-chair-west-1', 'chair', [71.2, -5.6], S, { params: { wood: C.walnut, cushion: C.sage } }), L('reading-chair-west-2', 'chair', [71.8, -7.2], N, { params: { wood: C.walnut, cushion: C.sage } }),
  L('reading-chair-east-1', 'chair', [76.2, -5.6], S, { params: { wood: C.walnut, cushion: C.sage } }), L('reading-chair-east-2', 'chair', [76.8, -7.2], N, { params: { wood: C.walnut, cushion: C.sage } }),
  L('armchair-sage', 'armchair', [75.9, -3.9], S, { params: { fabric: C.sage, wood: C.walnut } }), L('armchair-rose', 'armchair', [77.95, -3.9], S, { params: { fabric: C.rose, wood: C.walnut } }),
  L('floor-lamp', 'floor-lamp', [69.7, -3.7], N), L('tall-plant', 'potted-plant', [71.6, -3.7], N, { params: { sy: 1.6 } }),
  L('desk-west', 'desk', [71.5, -9.3], N, { params: { top: C.walnut } }), L('desk-east', 'office-desk', [76.5, -9.4], N),
  L('desk-chair-west', 'chair', [71.5, -8.4], S, { params: { wood: C.walnut, cushion: C.sage } }), L('desk-chair-east', 'office-chair', [76.5, -8.4], S),
  ...[[71.5, -6.6], [76.5, -6.6], [71.3, -9], [76.3, -9], [74, -5]].map(([x, z], i) => L(`pendant-${i + 1}`, 'eden-pendant@1', [x, z], N)),
];
// Things that stand on the furniture above (books on the reading tables, lamps on the desks); dropped if refused.
const on = (table, name, def, p, r = 0) => ({ op: 'place', def: `core/${def}@1`, name, in: { parent: table, slot: 'top' }, p: [p[0], 0, p[1]], ...(r ? { r } : {}) });
export const LIBRARY_TOPS = [
  on('eden-library-1/library-reading-table-west', 'library-books-west', 'book-stack', [-0.2, 0.1]), on('eden-library-1/library-reading-table-east', 'library-books-east', 'book-stack', [-0.2, 0.1]),
  on('eden-library-1/library-desk-west', 'library-desk-lamp-west', 'desk-lamp', [-0.45, -0.1]), on('eden-library-1/library-desk-west', 'library-desk-books', 'book-stack', [0.3, 0]),
  L('corner-lamp', 'floor-lamp', [77.1, -3.75], N),
];

// Café: one room 8 x 6 m (old int-cafe, the same frame: counter at the back, door at the front +z).
const K = (name, def, [x, z], r, extra) => piece('cafe', 'int-cafe', `cafe-${name}`, def, [x, 0, z], r, extra);
export const CAFE = [
  ...[-2.6, -1.4, -0.2].map((x, i) => K(`counter-${i + 1}`, 'counter', [x, -1.75], N, { params: { cab: '#3f5f57', top: C.ash, door: '#4f7068' } })),
  K('back-shelves', 'shop-shelving', [-2.2, -2.5], N, { params: { g0: '#c46a43', g1: '#e8e2d6', g2: '#2f6b6b', g3: '#d9a63a' } }),
  K('menu-board', 'chalkboard', [0.9, -2.45], N),
  K('stool-1', 'stool', [-2.6, -0.85], S), K('stool-2', 'stool', [-1.6, -0.85], S),
  ...[[-2.7, 1.3], [2.5, 1.35]].flatMap(([x, z], i) => [K(`table-${i + 1}`, 'round-table', [x, z], N, { params: { top: C.cream, legs: C.iron } }),
    K(`table-${i + 1}-chair-w`, 'chair', [x - 0.68, z], W, { params: { wood: C.iron, cushion: C.rust } }), K(`table-${i + 1}-chair-e`, 'chair', [x + 0.68, z], E, { params: { wood: C.iron, cushion: C.rust } })]),
  K('sofa', 'sofa', [3.25, -1.55], E, { params: { fabric: C.teal, pillow: C.ochre } }),
  K('nook-shelf', 'bookcase', [2.2, -2.6], N, books(0.75, 0.8)), K('nook-rug', 'rug', [2.8, -1.55], W, { params: { border: C.rust, field: C.cream } }),
  K('plant', 'potted-plant', [-3.4, 2.4], N), K('tall-plant', 'potted-plant', [3.35, 2.35], N, { params: { sy: 1.5 } }),
  K('picture', 'picture-frame', [-3.75, -1.2], W),
  ...[[-2.7, 1.3], [2.5, 1.35], [-1.6, -1.6], [0.2, -1.6], [2.8, -1.5]].map(([x, z], i) => K(`pendant-${i + 1}`, 'eden-pendant@1', [x, z], N)),
];
export const CAFE_TOPS = [
  on('int-cafe/cafe-table-1', 'cafe-cup-1', 'cup-of-coffee-pack', [-0.1, -0.15]), on('int-cafe/cafe-table-1', 'cafe-plate-1', 'croissant-pack', [0.15, 0.1]),
  on('int-cafe/cafe-table-2', 'cafe-cup-2', 'cup-of-coffee-pack', [0.1, 0.1]), on('int-cafe/cafe-table-2', 'cafe-candle-2', 'candle', [-0.1, -0.1]),
  on('int-cafe/cafe-counter-1', 'cafe-kettle', 'kettle', [-0.2, 0]), on('int-cafe/cafe-counter-2', 'cafe-pie-1', 'pie-pack', [0.1, 0.05]),
  on('int-cafe/cafe-counter-3', 'cafe-pie-2', 'pie-pack', [-0.15, 0.05]), on('int-cafe/cafe-counter-3', 'cafe-bread', 'bread-loaf-pack', [0.35, 0]),
];
/** One-room plans (no back stockroom wall in either: old Eden's library and café were each a single room). */
export const oneRoom = (w, d, id) => ({ floors: [{ rooms: [{ id, name: id[0].toUpperCase() + id.slice(1), rect: [0, 0, w, d] }], exterior: [{ room: id, wall: 's', kind: 'door', at: 0.5, width: 1.5 }] }], stairs: [] });

// Office (old eden-office-1, 12 x 8 m, three floors; centre (92, 15)): every floor has two desks with chairs and lamps and
// four pendants; the ground floor is the post room and lounge, the first the artists' studio, the second the meeting room.
const O = (room, name, def, [x, z], r, extra) => piece(room, 'eden-office-1', `office-${name}`, def, [x - 92, 0, z - 15], r, extra);
const officeFloor = (room, tag) => [
  O(room, `${tag}-desk-1`, 'desk', [91.6, 15.1], N), O(room, `${tag}-desk-2`, 'office-desk', [94.9, 15.1], N),
  O(room, `${tag}-desk-chair-1`, 'chair', [91.6, 15.95], S, { params: { wood: C.iron, cushion: '#5a6670' } }), O(room, `${tag}-desk-chair-2`, 'office-chair', [94.9, 16.0], S),
  ...[[91.5, 13], [94.6, 13], [91.5, 16.9], [94.6, 16.9]].map(([x, z], i) => O(room, `${tag}-pendant-${i + 1}`, 'eden-pendant@1', [x, z], N)),
];
export const OFFICE = [
  ...officeFloor('reception', 'f0'),
  O('reception', 'f0-pigeonholes', 'shop-shelving', [92.4, 11.6], N, { params: { g0: '#c9a77a', g1: '#e8e2d6', g2: '#b0573a', g3: '#2f4a6b' } }),
  O('reception', 'f0-parcels-1', 'crate', [95.2, 11.75], 0.2), O('reception', 'f0-parcels-2', 'crate', [95.9, 11.8], -0.15),
  O('reception', 'f0-lounge-rug', 'rug', [96.0, 17.0], N, { params: { border: C.sage, field: C.cream } }),
  O('reception', 'f0-lounge-sofa', 'sofa', [96.1, 18.0], S, { params: { fabric: C.teal, pillow: C.ochre } }),
  O('reception', 'f0-notice-board', 'wall-board', [97.7, 13.3], E),
  O('reception', 'f0-plant-1', 'potted-plant', [97.3, 11.7], N, { params: { sy: 1.5 } }),
  ...officeFloor('office', 'f1'),
  ...[90.4, 92.2, 94.0, 95.8].map((x, i) => O('office', `f1-easel-${i + 1}`, 'easel', [x, 17.9], N)),
  O('office', 'f1-plan-chest', 'dresser', [97.4, 15.6], E), O('office', 'f1-sitter-stool', 'stool', [93.2, 13.7], N),
  O('office', 'f1-drop-cloth', 'rug', [93.3, 13.0], N, { params: { border: '#cfc6b2', field: '#d9d2c2' } }),
  O('office', 'f1-plant', 'potted-plant', [97.3, 18.3], N),
  ...officeFloor('meeting', 'f2'),
  O('meeting', 'f2-meeting-rug', 'round-carpet-pack', [93.4, 12.9], N),
  O('meeting', 'f2-meeting-table', 'long-table', [93.4, 12.9], N),
  ...[[92.6, 12.25, N], [94.2, 12.25, N], [92.6, 13.55, S], [94.2, 13.55, S]].map(([x, z, r], i) => O('meeting', `f2-meeting-chair-${i + 1}`, 'chair', [x, z], r, { params: { wood: C.walnut, cushion: C.navy } })),
  O('meeting', 'f2-sofa', 'sofa', [96.4, 18.0], S, { params: { fabric: C.rust, pillow: C.cream } }), O('meeting', 'f2-armchair', 'armchair', [93.9, 18.1], S, { params: { fabric: C.ochre } }),
];
export const OFFICE_TOPS = ['f0', 'f1', 'f2'].flatMap(f => [on(`eden-office-1/office-${f}-desk-1`, `office-${f}-desk-lamp`, 'desk-lamp', [-0.4, -0.1]), on(`eden-office-1/office-${f}-desk-1`, `office-${f}-desk-books`, 'book-stack', [0.3, 0])]);

// Courtyard houses 3 and 4 (old eden-interiors courtyardHouse): kitchen and dining in the north range, living room with a
// piano (house 3) or an easel (house 4) in the south range, a bedroom in the west range. House 4 is house 3 moved 20 m east.
export const HOUSES = [['eden-house-3', 0], ['eden-house-4', 1]].flatMap(([h, v]) => {
  const wood = v ? C.ash : C.oak, fab = v ? C.teal : C.rust;
  const k = (name, def, p, r, extra) => piece('kitchen', `${h}-kitchen`, `${h}-${name}`, def, [p[0], 0, p[1]], r, extra);
  const l = (name, def, p, r, extra) => piece('living', h, `${h}-${name}`, def, [p[0], 0, p[1]], r, extra);
  const b = (name, def, p, r, extra) => piece('bedroom', `${h}-bedroom`, `${h}-${name}`, def, [p[0], 0, p[1]], r, extra);
  return [
    k('fridge', 'fridge', [-5.35, -0.92], N), k('sink', 'sink', [-4.35, -0.95], N), k('stove', 'stove', [-3.35, -0.95], N),
    k('counter', 'counter', [-2.25, -0.97], N, { params: { cab: v ? C.sage : '#a85a42', top: C.ash } }),
    k('dining-rug', 'rug', [2.9, 0.2], N, { params: { border: v ? C.sage : C.rust, field: C.cream } }),
    k('dining-table', 'table', [2.9, 0.2], N, { params: { top: wood, legs: wood } }),
    ...[[2.6, -0.42, N], [3.2, -0.42, N], [2.6, 0.82, S], [3.2, 0.82, S], [2.0, 0.2, W], [3.8, 0.2, E]].map(([x, z, r], i) => k(`dining-chair-${i + 1}`, 'chair', [x, z], r, { params: { wood, cushion: fab } })),
    k('dining-pendant', 'eden-pendant@1', [2.9, 0.2], N), k('kitchen-pendant', 'eden-pendant@1', [-3.8, 0.3], N),
    l('sofa', 'sofa', [-5.2, -0.35], W, { params: { fabric: v ? C.navy : C.sage, pillow: C.ochre } }),
    l('armchair', 'armchair', [-2.7, -0.4], E, { params: { fabric: v ? C.rose : C.ochre } }),
    l('living-rug', 'rug', [-3.95, -0.4], N, { params: { border: v ? '#6a4a7a' : C.navy, field: C.cream } }),
    l('floor-lamp', 'floor-lamp', [-2.5, -1.25], N), l('living-pendant', 'eden-pendant@1', [-3.95, -0.4], N),
    v ? l('easel', 'easel', [2.9, -0.7], PI * 0.85) : l('piano', 'piano', [2.9, -0.95], N),
    v ? l('plan-chest', 'dresser', [4.6, -1.15], N) : l('music-stool', 'stool', [2.9, 0.15], N),
    l('tall-shelf', 'bookcase', [4.7, 1.2], S, { params: { sx: 0.9, sy: 1 } }), l('plant', 'potted-plant', [-1.6, 1.15], N, { params: { sy: 1.4 } }),
    b('bed', 'bed', [-0.55, 0.35], N, { params: { quilt: v ? C.teal : C.ochre } }), b('wardrobe', 'wardrobe', [0.55, -1.25], N, { params: { wood } }),
    b('bedroom-rug', 'rug', [-0.45, -0.75], N, { params: { border: v ? C.teal : C.ochre, field: C.cream } }),
  ];
});
