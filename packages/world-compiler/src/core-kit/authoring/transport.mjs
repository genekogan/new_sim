// Transport (L4): cart, bicycle, car, rowing boat, sailboat, balloon, rail wagon, canoe. Things that
// move carry `route` (follow a path ref at a speed) or hover/sway; boats float. Front +z.
import { box, cap, cbox, cone, cyl, kitDef, lathe, limb, rbox, seat, sph, tor } from './dsl.mjs';

const WOOD = '#9a6b46', DWOOD = '#6e4a30', TYRE = '#262626', STEEL = '#7d8783';
const veh = (name, description, tags, shapes, palette, extra = {}) => kitDef({ name, description, tags: ['transport', 'vehicle', ...tags], shapes, palette, round: 0.02, ...extra });
const wheel = (x, y, z, r, w, c = 'tyre', seg = 10) => cyl([x, y, z], r, w, c, { roll: Math.PI / 2, seg });
// an open hull: outer skin up to the gunwale, then back down the inside to a floor (so you see into it)
const hull = (L, W, D, c) => lathe([0, 0, 0], [[0, 0], [0.32, 0.02], [0.46, D * 0.6], [0.5, D], [0.45, D], [0.41, D * 0.6], [0.28, D * 0.22], [0, D * 0.2]], c, { seg: 12, scale: [W, 1, L] });

const ROUTE = { route: { speed: 2, loop: true, altitude: 0 } };
export default [
  veh('cart', 'A two-wheeled wooden hand cart for hauling goods (a container).', ['cart', 'market', 'farm'],
    [cbox([0, 0.62, 0], [1.1, 0.08, 1.4], 'wood'), ...[-0.55, 0.55].map((x) => cbox([x, 0.78, 0], [0.05, 0.3, 1.4], 'wood')), cbox([0, 0.78, -0.7], [1.1, 0.3, 0.05], 'wood'), cbox([0, 0.78, 0.7], [1.1, 0.3, 0.05], 'wood'),
      wheel(-0.64, 0.42, 0.1, 0.42, 0.08, 'rim', 12), wheel(0.64, 0.42, 0.1, 0.42, 0.08, 'rim', 12), box([-0.3, 0.6, 1.2], [0.05, 0.05, 1.1], 'dark'), box([0.3, 0.6, 1.2], [0.05, 0.05, 1.1], 'dark'), cyl([0, 0.42, 0.1], 0.04, 1.3, 'dark', { roll: Math.PI / 2, seg: 5 })],
    { wood: '#a47a4c', rim: DWOOD, dark: DWOOD }, { components: { container: { capacity: 8 } } }),
  veh('bicycle', 'A city bicycle with a basket (parked; carryable by two hands).', ['bicycle', 'bike'],
    [tor([0, 0.33, -0.52], 0.32, 0.025, 'tyre', { yaw: Math.PI / 2, seg: 14 }), tor([0, 0.33, 0.52], 0.32, 0.025, 'tyre', { yaw: Math.PI / 2, seg: 14 }),
      limb([0, 0.33, -0.52], [0, 0.72, -0.15], 0.02, 'frame', { kind: 'cyl', seg: 5 }), limb([0, 0.72, -0.15], [0, 0.75, 0.38], 0.02, 'frame', { kind: 'cyl', seg: 5 }), limb([0, 0.33, -0.05], [0, 0.75, 0.38], 0.02, 'frame', { kind: 'cyl', seg: 5 }), limb([0, 0.33, -0.05], [0, 0.72, -0.15], 0.02, 'frame', { kind: 'cyl', seg: 5 }), limb([0, 0.33, -0.52], [0, 0.33, -0.05], 0.018, 'frame', { kind: 'cyl', seg: 5 }),
      limb([0, 0.33, 0.52], [0, 0.95, 0.42], 0.02, 'frame', { kind: 'cyl', seg: 5 }), cyl([0, 0.95, 0.42], 0.018, 0.5, 'dark', { roll: Math.PI / 2, seg: 5 }), cap([0, 0.8, -0.2], 0.05, 0.14, 'dark', { pitch: Math.PI / 2, seg: 5 }), cbox([0, 0.88, 0.62], [0.32, 0.2, 0.24], 'basket')],
    { tyre: TYRE, frame: '#3f7f86', dark: '#2b2b2b', basket: '#c9a77a' }, { components: { carryable: { mass: 14, grips: 2 } } }),
  veh('car', 'A small rounded hatchback car (route: drives a loop along a road ref).', ['car', 'road', 'moving'],
    [rbox([0, 0.5, 0], [1.6, 0.55, 3.6], 'body', { round: 0.18 }), rbox([0, 0.98, -0.25], [1.42, 0.5, 2.0], 'body', { round: 0.2 }), rbox([0, 0.99, -0.25], [1.44, 0.36, 1.8], 'glass', { round: 0.12, material: 'glass' }),
      ...[[-0.72, 1.15], [0.72, 1.15], [-0.72, -1.15], [0.72, -1.15]].map(([x, z]) => wheel(x, 0.32, z, 0.32, 0.22, 'tyre', 10)), ...[-0.5, 0.5].map((x) => sph([x, 0.6, 1.79], 0.11, 'lamp', { scale: [1, 0.7, 0.4], seg: 5, glow: 0.6 })), box([0, 0.38, 1.81], [1.2, 0.12, 0.04], 'trim'), box([0, 0.38, -1.81], [1.2, 0.12, 0.04], 'trim')],
    { body: '#d9534f', glass: '#bcd8e6', tyre: TYRE, lamp: '#fff3d0', trim: '#cfd3d6' }, { components: { carrier: { seats: 4 }, ...ROUTE, light: { color: '#fff3d0', range: 8, on: true } }, state: { on: { type: 'bool', default: true } } }),
  veh('rowing-boat', 'A wooden rowing boat with two oars and seats; floats on water (anchor float).', ['boat', 'water', 'rowing'],
    [hull(3.2, 1.3, 0.5, 'hull'), { kind: 'ring', at: [0, 0.5, 0], r: 0.48, r2: 0.035, segments: 14, tint: 'rim', scale: [1.3, 1, 3.2] }, ...[-0.6, 0.1, 0.9].map((z) => cbox([0, 0.36, z], [1.1, 0.05, 0.25], 'seat')),
      cyl([0.85, 0.45, 0.1], 0.025, 2.0, 'oar', { pitch: Math.PI / 2, yaw: 0.3, seg: 5 }), cyl([-0.85, 0.45, 0.1], 0.025, 2.0, 'oar', { pitch: Math.PI / 2, yaw: -0.3, seg: 5 })],
    { hull: '#3f6f8a', rim: '#e9e2cf', seat: WOOD, oar: '#c9a77a' }, { anchor: 'float', slots: [seat('rower', [0, 0.39, 0.1], Math.PI), seat('bow', [0, 0.39, 0.9], Math.PI), seat('stern', [0, 0.39, -0.6])], components: { carrier: { seats: 3 }, seat: { height: 0.39 }, hover: { height: 0, bob: 0.04, period: 3.5 } } }),
  veh('sailboat', 'A small sailboat with a white mainsail and a jib; floats and drifts (route along a water path ref).', ['boat', 'sail', 'water', 'moving'],
    [hull(5.0, 1.8, 0.7, 'hull'), cyl([0, 0.7, 0], 0.86, 0.06, 'deck', { scale: [1.05, 1, 2.9], seg: 12 }), cyl([0, 3.6, 0.3], 0.06, 5.8, 'mast', { seg: 6 }),
      cone([0, 3.3, -0.6], 1.5, 4.8, 'sail', { seg: 3, scale: [0.03, 1, 1], yaw: Math.PI / 2 }), cone([0, 2.9, 1.5], 0.9, 3.8, 'jib', { seg: 3, scale: [0.03, 1, 1], yaw: Math.PI / 2 }), box([0, 1.25, -0.8], [0.05, 0.05, 2.2], 'mast')],
    { hull: '#f2efe6', deck: '#a47a4c', mast: '#8a6a4a', sail: '#fbf8f0', jib: '#e9e2d0' }, { anchor: 'float', components: { carrier: { seats: 4 }, sway: { amount: 0.08, period: 6 }, ...ROUTE } }),
  veh('canoe', 'A slim red canoe with a paddle; floats.', ['boat', 'canoe', 'water'],
    [hull(4.2, 0.8, 0.38, 'hull'), { kind: 'ring', at: [0, 0.38, 0], r: 0.48, r2: 0.03, segments: 14, tint: 'rim', scale: [0.8, 1, 4.2] }, cbox([0, 0.25, 0.9], [0.6, 0.04, 0.22], 'seat'), cbox([0, 0.25, -0.9], [0.6, 0.04, 0.22], 'seat'), cyl([0.3, 0.45, 0], 0.02, 1.5, 'seat', { pitch: 1.2, seg: 4 })],
    { hull: '#c8432e', rim: '#5e3d27', seat: '#c9a77a' }, { anchor: 'float', slots: [seat('front', [0, 0.27, 0.9], 0), seat('back', [0, 0.27, -0.9], 0)], components: { carrier: { seats: 2 }, seat: { height: 0.27 }, hover: { height: 0, bob: 0.03, period: 3 } } }),
  veh('balloon', 'A hot-air balloon with a striped envelope and a wicker basket; hovers and sways at height (route: follow a path ref).', ['balloon', 'air', 'ride', 'moving', 'large'],
    [lathe([0, 3.2, 0], [[0.4, 0], [1.2, 0.5], [2.6, 2.2], [3.0, 3.6], [2.7, 5.0], [1.7, 6.0], [0, 6.35]], 'env', { seg: 12 }), ...[0, 1, 2, 3, 4, 5].map((i) => cap([Math.cos(i * 1.047) * 2.95, 6.8, Math.sin(i * 1.047) * 2.95], 0.12, 1.3, 'stripe', { seg: 5 })),
      cbox([0, 0.5, 0], [1.3, 1.0, 1.3], 'basket'), cbox([0, 1.02, 0], [1.38, 0.08, 1.38], 'rim'), ...[[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]].map(([x, z]) => limb([x, 1.05, z], [x * 0.7, 3.25, z * 0.7], 0.02, 'rope', { kind: 'cyl', seg: 3 })), cyl([0, 2.6, 0], 0.25, 0.6, 'burner', { seg: 6, glow: 0.5 })],
    { env: '#e8643a', stripe: '#f1c84b', basket: '#b08b5a', rim: '#6e4a30', rope: '#5a4632', burner: '#ffb36a' }, { components: { carrier: { seats: 4 }, hover: { height: 18, bob: 0.8, period: 9 }, sway: { amount: 0.06, period: 7 } } }),
  veh('rail-wagon', 'A rail wagon (open goods car) on four wheels; rolls along a rail path ref.', ['rail', 'train', 'wagon', 'moving'],
    [cbox([0, 0.95, 0], [1.6, 0.9, 3.4], 'body'), box([0, 1.42, 0], [1.66, 0.06, 3.46], 'trim'), cbox([0, 0.45, 0], [1.2, 0.18, 3.6], 'chassis'), ...[[-0.6, 1.1], [0.6, 1.1], [-0.6, -1.1], [0.6, -1.1]].map(([x, z]) => wheel(x, 0.35, z, 0.35, 0.12, 'wheel', 10)), sph([0, 0.45, 1.9], 0.12, 'chassis', { seg: 5 }), sph([0, 0.45, -1.9], 0.12, 'chassis', { seg: 5 })],
    { body: '#3f6b4f', trim: '#c9b26b', chassis: '#2b2b2b', wheel: '#4a4f4d' }, { components: { carrier: { seats: 6 }, container: { capacity: 30 }, ...ROUTE } }),
];
