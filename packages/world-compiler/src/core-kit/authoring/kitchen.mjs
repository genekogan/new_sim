// Kitchen (L4): stove, sink, counter, fridge, hearth and the things on them (pot, kettle, bowl,
// cup, plate, loaf). Ported from the Eden interiors palette; origin on the floor, front +z.
import { box, cbox, cyl, kitDef, lathe, sph, surface, tor } from './dsl.mjs';
import { C } from './furniture.mjs';

const k = (name, description, tags, shapes, palette, extra = {}) => kitDef({ name, description, tags: ['kitchen', ...tags], shapes, palette, round: 0.015, ...extra });
const item = (name, description, tags, shapes, palette, extra = {}) => k(name, description, ['item', ...tags], shapes, palette, { layer: 'decor', ...extra });

export default [
  k('stove', 'A cast-iron cooking stove with two hotplates, an oven door and a flue; a surface for pots.', ['stove', 'cooking', 'surface'],
    [cbox([0, 0.42, 0], [0.8, 0.84, 0.6], 'iron'), cbox([0, 0.86, 0], [0.84, 0.04, 0.64], 'top'), cyl([-0.2, 0.89, 0.05], 0.13, 0.025, 'plate', { seg: 10 }), cyl([0.2, 0.89, 0.05], 0.13, 0.025, 'plate', { seg: 10 }),
      box([0, 0.4, 0.302], [0.56, 0.42, 0.01], 'door'), cyl([0, 0.63, 0.32], 0.012, 0.4, 'brass', { roll: Math.PI / 2, seg: 5 }), cyl([0.28, 1.5, -0.22], 0.07, 1.3, 'iron', { seg: 6 })],
    { iron: '#2f3236', top: '#3c4046', plate: '#1d1f22', door: '#45494f', brass: C.brass }, { slots: [surface('hob', [0, 0.9, 0.05], 2, [0.4, 0.4, 0.4])], components: { surface: { height: 0.9 }, workstation: { kind: 'cooking' } } }),
  k('sink', 'A kitchen sink in a cabinet with a tap; a workstation for washing up.', ['sink', 'water', 'surface'],
    [cbox([0, 0.42, 0], [0.9, 0.84, 0.6], 'cab'), cbox([0, 0.87, 0], [0.94, 0.05, 0.64], 'top'), box([0, 0.86, 0.04], [0.56, 0.05, 0.38], 'basin'), box([0, 0.885, 0.04], [0.5, 0.02, 0.32], 'water'),
      cyl([0, 0.98, -0.22], 0.018, 0.2, 'metal', { seg: 6 }), cyl([0, 1.07, -0.16], 0.014, 0.14, 'metal', { pitch: Math.PI / 2, seg: 5 }), box([-0.22, 0.45, 0.302], [0.4, 0.7, 0.01], 'door'), box([0.22, 0.45, 0.302], [0.4, 0.7, 0.01], 'door')],
    { cab: C.paint, top: C.oak, basin: '#c9ced3', water: '#9fc3d6', metal: '#9aa0a6', door: '#ddd6c6' }, { components: { workstation: { kind: 'washing' }, water: { level: 0.88 } } }),
  k('counter', 'A kitchen counter with cupboards and a wooden worktop (1.2 m); a prep surface.', ['counter', 'surface', 'cupboard'],
    [cbox([0, 0.42, 0], [1.2, 0.84, 0.6], 'cab'), cbox([0, 0.87, 0], [1.24, 0.05, 0.64], 'top'), ...[-0.3, 0.3].map((x) => box([x, 0.45, 0.302], [0.56, 0.7, 0.01], 'door')), ...[-0.06, 0.06].map((x) => sph([x, 0.62, 0.315], 0.015, 'brass', { seg: 4 }))],
    { cab: C.sage, top: C.oak, door: '#9bb08c', brass: C.brass }, { slots: [surface('top', [0, 0.9, 0], 8)], components: { surface: { height: 0.9 }, container: { capacity: 12 } } }),
  k('fridge', 'A rounded retro fridge with a chrome handle.', ['fridge', 'cold', 'container'],
    [cbox([0, 0.85, 0], [0.7, 1.7, 0.66], 'body'), box([0, 1.15, 0.332], [0.64, 0.012, 0.01], 'gap'), cyl([0.27, 1.0, 0.36], 0.018, 0.4, 'chrome', { seg: 5 }), ...[[-0.28, -0.26], [0.28, -0.26], [-0.28, 0.26], [0.28, 0.26]].map(([x, z]) => cyl([x, 0.02, z], 0.03, 0.04, 'gap', { seg: 5 }))],
    { body: '#e9e2cf', gap: '#9b968a', chrome: '#c9ced3' }, { components: { container: { capacity: 20 } } }),
  k('hearth', 'A stone hearth with a log fire and a cooking hook; glows at night.', ['fire', 'hearth', 'cooking', 'light'],
    [cbox([0, 0.12, 0], [1.3, 0.24, 0.8], 'stone'), cbox([-0.55, 0.7, -0.2], [0.2, 1.0, 0.4], 'stone'), cbox([0.55, 0.7, -0.2], [0.2, 1.0, 0.4], 'stone'), cbox([0, 1.3, -0.2], [1.3, 0.25, 0.45], 'stone'),
      cyl([-0.12, 0.3, 0.05], 0.06, 0.6, 'log', { pitch: Math.PI / 2, yaw: 0.6, seg: 6 }), cyl([0.12, 0.3, 0.05], 0.06, 0.6, 'log', { pitch: Math.PI / 2, yaw: -0.6, seg: 6 }), lathe([0, 0.3, 0.05], [[0.2, 0], [0.12, 0.2], [0, 0.42]], 'flame', { seg: 6, glow: 1 })],
    { stone: '#a39b8c', log: '#5e4630', flame: '#f39a3a' }, { components: { light: { color: '#ffb36a', range: 6, on: true }, workstation: { kind: 'cooking' } }, state: { on: { type: 'bool', default: true } } }),
  item('pot', 'A cooking pot with two handles and a lid (carryable).', ['pot', 'container', 'cooking'],
    [lathe([0, 0, 0], [[0, 0], [0.16, 0.0], [0.17, 0.18], [0.17, 0.2]], 'metal', { seg: 10 }), lathe([0, 0.2, 0], [[0.175, 0], [0.12, 0.04], [0.02, 0.05]], 'lid', { seg: 10 }), sph([0, 0.26, 0], 0.025, 'knob', { seg: 4 }), tor([0.19, 0.15, 0], 0.035, 0.01, 'metal', { seg: 6 }), tor([-0.19, 0.15, 0], 0.035, 0.01, 'metal', { seg: 6 })],
    { metal: '#5a5f66', lid: '#6a7078', knob: '#2b2b2b' }, { components: { carryable: { mass: 2, grips: 2 }, container: { capacity: 1 } } }),
  item('kettle', 'A copper kettle with a spout and handle (carryable).', ['kettle', 'tea'],
    [lathe([0, 0, 0], [[0, 0], [0.1, 0], [0.12, 0.08], [0.09, 0.17], [0.03, 0.2], [0, 0.2]], 'copper', { seg: 10 }), cyl([0.13, 0.09, 0], 0.018, 0.13, 'copper', { roll: -0.8, r2: 0.01, seg: 5 }), tor([0, 0.22, 0], 0.07, 0.01, 'dark', { arc: Math.PI, seg: 8 })],
    { copper: '#b87333', dark: '#3b2a22' }, { components: { carryable: { mass: 1, grips: 1 }, container: { capacity: 1 } } }),
  item('bowl', 'A ceramic bowl (carryable; holds one portion).', ['bowl', 'container', 'food'],
    [lathe([0, 0, 0], [[0, 0], [0.06, 0], [0.11, 0.05], [0.125, 0.1], [0.115, 0.1], [0.1, 0.06], [0, 0.02]], 'glaze', { seg: 12 })],
    { glaze: '#d9c7a8' }, { components: { carryable: { mass: 0.5, grips: 1 }, container: { capacity: 1 } } }),
  item('cup', 'A mug with a handle (carryable).', ['cup', 'mug', 'tea', 'container'],
    [lathe([0, 0, 0], [[0, 0], [0.04, 0], [0.045, 0.1], [0.04, 0.1], [0.036, 0.02], [0, 0.02]], 'glaze', { seg: 10 }), tor([0.05, 0.05, 0], 0.025, 0.007, 'glaze', { seg: 6 })],
    { glaze: '#e8e2d6' }, { components: { carryable: { mass: 0.3, grips: 1 }, container: { capacity: 1 } } }),
  item('plate', 'A dinner plate (carryable).', ['plate', 'food'],
    [lathe([0, 0, 0], [[0, 0], [0.08, 0], [0.12, 0.012], [0.13, 0.02], [0.12, 0.02], [0.08, 0.008], [0, 0.008]], 'glaze', { seg: 12 })],
    { glaze: '#f2efe8' }, { components: { carryable: { mass: 0.4, grips: 1 }, surface: { height: 0.02 } } }),
  item('loaf', 'A round loaf of bread (carryable, food).', ['bread', 'food'],
    [sph([0, 0.07, 0], 0.13, 'crust', { scale: [1, 0.6, 1.25], seg: 8 }), ...[-0.05, 0.03, 0.1].map((z) => box([0, 0.13, z], [0.1, 0.01, 0.015], 'cut', { yaw: 0.2 }))],
    { crust: '#c98a45', cut: '#e8c58a' }, { components: { carryable: { mass: 0.5, grips: 1 } } }),
];
