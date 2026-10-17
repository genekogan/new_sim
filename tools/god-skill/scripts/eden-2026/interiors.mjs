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
    state: { on: { type: 'bool', default: true } }, components: { light: { color: '#ffd99a', range: 5, on: true } }, size: { box: [0.6, 3.1, 0.6] },
    make: { kind: 'gen', gen: 'kit/2', args: { shapes: [
      { kind: 'cyl', at: [0, 2.78, 0], r: 0.008, h: 0.64, segments: 4, color: '#2b2623', collide: false },
      { kind: 'cone', at: [0, 2.33, 0], r: 0.3, h: 0.26, segments: 14, color: '#2f3332', collide: false },
      { kind: 'sphere', at: [0, 2.2, 0], r: 0.07, color: '#ffe2a8', glow: 1, collide: false }] } } } },
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
