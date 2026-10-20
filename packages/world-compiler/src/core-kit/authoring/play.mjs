// Play and rides (L4): swings, slide, see-saw, sandpit, climbing frame, goal, ferris wheel (spins on
// role `wheel`), carousel (spins on role `wheel`). Origin on the ground, front +z.
import { box, cap, cbox, cone, cyl, kitDef, limb, seat, sph, stand, tor, withRole } from './dsl.mjs';

const RED = '#d9534f', BLUE = '#3a8fd9', YEL = '#f1c84b', GRN = '#2e9e5a', STEEL = '#7d8783', WOOD = '#a47a4c', WHITE = '#f2efe6';
const play = (name, description, tags, shapes, palette, extra = {}) => kitDef({ name, description, tags: ['play', ...tags], shapes, palette, round: 0.02, ...extra });

const wheelR = 7, hubY = 8.6;
const ferris = [
  // A-frame supports (static)
  ...[-0.7, 0.7].flatMap((z) => [limb([-3.2, 0.06, z], [0, hubY, z * 0.4], 0.14, 'frame', { kind: 'cyl', seg: 6 }), limb([3.2, 0.06, z], [0, hubY, z * 0.4], 0.14, 'frame', { kind: 'cyl', seg: 6 })]),
  cbox([0, 0.25, 0], [8, 0.5, 2.4], 'base'), cbox([0, 0.9, 3.2], [2.4, 0.4, 1.2], 'base'),
  // the wheel: rim, spokes and round pods, all on role wheel about the hub (spins about z)
  ...withRole('wheel', [0, hubY, 0], [
    tor([0, hubY, 0.45], wheelR, 0.08, 'rim', { seg: 24 }), tor([0, hubY, -0.45], wheelR, 0.08, 'rim', { seg: 24 }), cyl([0, hubY, 0], 0.45, 1.3, 'frame', { pitch: Math.PI / 2, seg: 8 }),
    ...Array.from({ length: 8 }, (_, i) => box([Math.cos((i / 8) * Math.PI * 2) * wheelR / 2, hubY + Math.sin((i / 8) * Math.PI * 2) * wheelR / 2, 0], [wheelR, 0.08, 0.08], 'rim', { roll: (i / 8) * Math.PI * 2 })),
    ...Array.from({ length: 8 }, (_, i) => sph([Math.cos((i / 8) * Math.PI * 2 + 0.39) * wheelR, hubY + Math.sin((i / 8) * Math.PI * 2 + 0.39) * wheelR - 0.2, 0], 0.75, ['pod1', 'pod2', 'pod3', 'pod4'][i % 4], { scale: [1, 0.9, 1], seg: 7 })),
  ]),
];
const carousel = [
  cyl([0, 0.15, 0], 4.2, 0.3, 'base', { seg: 16 }),
  ...withRole('wheel', [0, 0, 0], [
    cyl([0, 0.38, 0], 4.0, 0.16, 'deck', { seg: 16 }), cyl([0, 2.4, 0], 0.35, 4.2, 'pole', { seg: 8 }), cone([0, 5.1, 0], 4.5, 1.6, 'canopy', { seg: 12 }), cyl([0, 4.25, 0], 4.5, 0.3, 'trim', { seg: 12 }), sph([0, 6.0, 0], 0.3, 'trim', { seg: 6 }),
    ...Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * Math.PI * 2, x = Math.cos(a) * 3.0, z = Math.sin(a) * 3.0, y = 1.2 + (i % 2) * 0.25, yaw = -a; return [
      cyl([x, 2.3, z], 0.04, 3.8, 'pole', { seg: 5 }),
      cap([x, y, z], 0.2, 0.55, i % 2 ? 'horse' : 'horse2', { pitch: Math.PI / 2, yaw, seg: 6 }),
      limb([x, y + 0.1, z], [x + Math.sin(yaw + Math.PI / 2) * 0, y + 0.55, z], 0.08, i % 2 ? 'horse' : 'horse2', { kind: 'cyl', seg: 5 }),
      sph([x - Math.sin(a) * 0.35, y + 0.6, z + Math.cos(a) * 0.35], 0.15, i % 2 ? 'horse' : 'horse2', { scale: [0.8, 0.9, 1.3], seg: 5 }),
      ...[-1, 1].flatMap((s) => [limb([x - Math.sin(a) * 0.3 * s, y - 0.1, z + Math.cos(a) * 0.3 * s], [x - Math.sin(a) * 0.38 * s, y - 0.6, z + Math.cos(a) * 0.38 * s], 0.045, i % 2 ? 'horse' : 'horse2', { kind: 'cyl', seg: 4 })]),
    ]; }).flat(),
  ]),
];

export default [
  play('swings', 'A swing set: an A-frame with two swings.', ['swings', 'playground', 'seat'],
    [...[-1.6, 1.6].flatMap((x) => [limb([x, 0.03, -0.9], [x, 2.4, 0], 0.07, 'frame', { kind: 'cyl', seg: 6 }), limb([x, 0.03, 0.9], [x, 2.4, 0], 0.07, 'frame', { kind: 'cyl', seg: 6 })]), cyl([0, 2.4, 0], 0.07, 3.4, 'frame', { roll: Math.PI / 2, seg: 6 }),
      ...[-0.7, 0.7].flatMap((x) => [box([x - 0.2, 1.5, 0], [0.02, 1.8, 0.02], 'rope'), box([x + 0.2, 1.5, 0], [0.02, 1.8, 0.02], 'rope'), cbox([x, 0.55, 0], [0.5, 0.05, 0.22], x < 0 ? 'seat1' : 'seat2')])],
    { frame: STEEL, rope: '#d8d4c8', seat1: RED, seat2: BLUE }, { slots: [seat('swing-1', [-0.7, 0.58, 0]), seat('swing-2', [0.7, 0.58, 0])], components: { seat: { height: 0.58 } } }),
  play('slide', 'A playground slide with a ladder and a platform.', ['slide', 'playground'],
    [...[[-0.35, -1.0], [0.35, -1.0], [-0.35, -0.4], [0.35, -0.4]].map(([x, z]) => cyl([x, 0.8, z], 0.05, 1.6, 'frame', { seg: 6 })), cbox([0, 1.6, -0.7], [0.8, 0.08, 0.7], 'deck'),
      ...[0.3, 0.7, 1.1, 1.5].map((y) => box([0, y, -1.12], [0.6, 0.04, 0.06], 'frame')), box([0, 0.9, 0.5], [0.6, 0.05, 2.4], 'chute', { pitch: 0.62 }), box([0.32, 1.0, 0.5], [0.04, 0.2, 2.4], 'chute', { pitch: 0.62 }), box([-0.32, 1.0, 0.5], [0.04, 0.2, 2.4], 'chute', { pitch: 0.62 })],
    { frame: STEEL, deck: WOOD, chute: YEL }),
  play('see-saw', 'A see-saw: a plank on a pivot with two handles; seats two.', ['see-saw', 'playground', 'seat'],
    [cyl([0, 0.3, 0], 0.18, 0.5, 'frame', { roll: Math.PI / 2, seg: 8 }), cbox([0, 0.15, 0], [0.5, 0.3, 0.4], 'frame'), cbox([0, 0.5, 0], [0.28, 0.06, 3.6], 'plank'), ...[-1.4, 1.4].map((z) => tor([0, 0.72, z], 0.15, 0.025, 'handle', { yaw: Math.PI / 2, arc: Math.PI, seg: 6 }))],
    { frame: STEEL, plank: RED, handle: '#2b2b2b' }, { slots: [seat('end-1', [0, 0.53, -1.6], 0), seat('end-2', [0, 0.53, 1.6], Math.PI)], components: { seat: { height: 0.53 } } }),
  play('sandpit', 'A square wooden sandpit with a bucket and spade.', ['sandpit', 'playground', 'sand'],
    [cbox([0, 0.15, -1.2], [2.5, 0.3, 0.1], 'wood'), cbox([0, 0.15, 1.2], [2.5, 0.3, 0.1], 'wood'), cbox([-1.2, 0.15, 0], [0.1, 0.3, 2.3], 'wood'), cbox([1.2, 0.15, 0], [0.1, 0.3, 2.3], 'wood'), box([0, 0.12, 0], [2.3, 0.2, 2.3], 'sand'),
      cyl([0.5, 0.31, 0.3], 0.1, 0.18, 'bucket', { r2: 0.12, seg: 8 }), box([-0.4, 0.25, -0.3], [0.08, 0.02, 0.4], 'spade', { yaw: 0.6 })],
    { wood: WOOD, sand: '#e6d39a', bucket: BLUE, spade: RED }, { layer: 'surface' }),
  play('climbing-frame', 'A rounded steel climbing dome for children.', ['climbing', 'playground', 'structure'],
    [...[0, 1, 2, 3, 4, 5].map((i) => tor([0, 0, 0], 1.6, 0.04, i % 2 ? 'bar' : 'bar2', { yaw: (i / 6) * Math.PI, arc: Math.PI, seg: 12 })), tor([0, 0.8, 0], 1.38, 0.04, 'bar', { pitch: Math.PI / 2, seg: 14 }), tor([0, 1.35, 0], 0.75, 0.04, 'bar2', { pitch: Math.PI / 2, seg: 10 })],
    { bar: RED, bar2: YEL }),
  play('goal', 'A football goal with a white frame and a net (5 × 2 m).', ['goal', 'football', 'sport', 'pitch'],
    [cyl([-2.5, 1.0, 0], 0.06, 2.0, 'frame', { seg: 6 }), cyl([2.5, 1.0, 0], 0.06, 2.0, 'frame', { seg: 6 }), cyl([0, 2.0, 0], 0.06, 5.06, 'frame', { roll: Math.PI / 2, seg: 6 }),
      box([0, 1.0, -0.9], [5, 2, 0.01], 'net'), box([0, 2.0, -0.45], [5, 0.01, 0.9], 'net'), box([-2.5, 1.0, -0.45], [0.01, 2, 0.9], 'net'), box([2.5, 1.0, -0.45], [0.01, 2, 0.9], 'net')],
    { frame: WHITE, net: '#d8dde0' }),
  play('ferris-wheel', 'A ferris wheel (17 m) with eight round pods; it turns slowly (spin on role wheel). Ride later (M4).', ['ferris-wheel', 'ride', 'fair', 'structure', 'large', 'moving'],
    ferris, { frame: '#e8e2d6', base: '#8c867a', rim: '#d9534f', pod1: '#f1c84b', pod2: '#3a8fd9', pod3: '#2e9e5a', pod4: '#e86aa8' }, { components: { spin: { axis: 'z', rpm: 0.8, role: 'wheel' }, carrier: { seats: 16 } }, slots: [stand('queue', [0, 1.1, 3.6], 0, 8)] }),
  play('carousel', 'A merry-go-round with six painted horses under a striped canopy; it turns (spin on role wheel).', ['carousel', 'merry-go-round', 'ride', 'fair', 'structure', 'large', 'moving'],
    carousel, { base: '#8c867a', deck: '#c9a77a', pole: '#d9b54a', canopy: '#d9534f', trim: '#f2efe6', horse: '#f4f1ea', horse2: '#c98a45' }, { components: { spin: { axis: 'y', rpm: 4, role: 'wheel' }, carrier: { seats: 6 } } }),
];
