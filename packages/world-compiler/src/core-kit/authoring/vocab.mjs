// VOCAB-MECH pilot: catalogue types inducted with the mechanism (docs/god/VOCAB.md). Each has a category, synonyms,
// convention params (stretch, paint, wear; variants where they make sense), interfaces (slots, actuators) and a look
// that obeys the Eden budgets. Origin on the floor at the footprint centre, front +z.
import { box, cbox, cone, cyl, lathe, limb, rbox, sph, stand, surface, seat, withRole } from './dsl.mjs';
import { presetDef, setDef, vocabDef } from './vocab-dsl.mjs';

const C = { stone: '#b9b3a6', dstone: '#8f887b', soot: '#2b2623', oak: '#9a6b43', walnut: '#5e3d27', iron: '#3b3d40', brass: '#b8913f', cream: '#f2ead8', red: '#c23a2b', glass: '#bcd9e0', flame: '#ffb347', ember: '#ff7a2f', orange: '#f07c2a', white: '#f4f2ec', sage: '#3f6b5c' };

export default [
  // ---------------- building components: doors and windows (component.opening)
  vocabDef({ name: 'door', category: 'component.opening', synonyms: ['front door', 'doorway', 'entrance', 'back door', 'wooden door'],
    description: 'A free-standing door in its frame (1.2 × 2.3 m) for walls, sheds and follies; opens, closes and locks. Variants: panel, glazed, plank.',
    variants: ['panel', 'glazed', 'plank'], ranges: { sx: [0.8, 1.8], sy: [0.9, 1.3], sz: [1, 1.5] }, actuators: ['door', 'lock'], label: 'the door',
    shapes: [cbox([-0.56, 1.13, 0], [0.1, 2.26, 0.18], 'frame'), cbox([0.56, 1.13, 0], [0.1, 2.26, 0.18], 'frame'), cbox([0, 2.3, 0], [1.22, 0.12, 0.2], 'frame'), box([0, 0.02, 0], [1.02, 0.04, 0.2], 'frame'),
      ...withRole('door', [-0.5, 1.08, 0], [cbox([0, 1.08, 0], [0.98, 2.1, 0.06], 'leaf'),
        box([0, 1.58, 0.035], [0.68, 0.62, 0.02], 'trim', { when: 'variant=panel' }), box([0, 0.6, 0.035], [0.68, 0.78, 0.02], 'trim', { when: 'variant=panel' }),
        box([0, 1.5, 0.036], [0.62, 0.78, 0.02], 'glass', { material: 'glass', when: 'variant=glazed' }), box([0, 1.5, 0.04], [0.04, 0.78, 0.02], 'trim', { when: 'variant=glazed' }),
        ...[-0.3, -0.1, 0.1, 0.3].map((x) => box([x, 1.08, 0.033], [0.012, 2.0, 0.012], 'trim', { when: 'variant=plank' })),
        sph([0.38, 1.04, 0.07], 0.035, 'brass', { seg: 5 })])],
    palette: { frame: C.cream, leaf: C.sage, trim: '#36594d', glass: C.glass, brass: C.brass }, components: { opening: { width: 0.98, height: 2.1, state: 'closed' } } }),
  vocabDef({ name: 'window', category: 'component.opening', synonyms: ['casement', 'window frame', 'pane'],
    description: 'A casement window (1 × 1.3 m) with a sill and a window box; the casement opens. Variants: square, arched, round.',
    variants: ['square', 'arched', 'round'], ranges: { sx: [0.6, 2.5], sy: [0.6, 2] }, actuators: ['door'], label: 'the window',
    shapes: [cbox([-0.48, 0.65, 0], [0.08, 1.3, 0.14], 'frame', { when: 'variant!=round' }), cbox([0.48, 0.65, 0], [0.08, 1.3, 0.14], 'frame', { when: 'variant!=round' }), cbox([0, 1.27, 0], [1.04, 0.08, 0.14], 'frame', { when: 'variant=square' }),
      lathe([0, 1.25, 0], [[0.52, 0], [0.5, 0.18], [0.36, 0.4], [0.0, 0.5]], 'frame', { seg: 8, scale: [1, 1, 0.14], when: 'variant=arched' }),
      { kind: 'torus', at: [0, 0.65, 0], r: 0.5, r2: 0.06, segments: 12, tint: 'frame', when: 'variant=round' },
      cbox([0, 0.02, 0.06], [1.16, 0.06, 0.28], 'sill'), cbox([0, 0.14, 0.22], [0.9, 0.18, 0.18], 'box'), ...[-0.3, -0.05, 0.22].map((x, i) => sph([x, 0.28, 0.22], 0.1, i % 2 ? 'bloom' : 'leaf', { seg: 5 })),
      ...withRole('door', [-0.44, 0.65, 0.02], [box([0, 0.65, 0.02], [0.86, 1.2, 0.03], 'glass', { material: 'glass', when: 'variant!=round' }), box([0, 0.65, 0.04], [0.86, 0.04, 0.03], 'frame', { when: 'variant!=round' }), box([0, 0.65, 0.04], [0.04, 1.2, 0.03], 'frame', { when: 'variant!=round' }),
        cyl([0, 0.65, 0.02], 0.46, 0.03, 'glass', { pitch: Math.PI / 2, seg: 12, material: 'glass', when: 'variant=round' })])],
    palette: { frame: C.white, sill: C.stone, box: C.oak, leaf: '#4f7f3a', bloom: '#d0567a', glass: C.glass }, components: { opening: { width: 0.86, height: 1.2, state: 'closed' } } }),

  // ---------------- furniture: lighting and fire (furniture.lighting)
  vocabDef({ name: 'desk-lamp', category: 'furniture.lighting', synonyms: ['table lamp', 'reading lamp', 'anglepoise', 'lamp'],
    description: 'An angled desk lamp (0.5 m) with a weighted base and a cone shade; switch it on and off. Put it on a desk or table.',
    actuators: [['power', { default: true }]], label: 'the desk lamp',
    shapes: [cyl([0, 0.02, 0], 0.09, 0.04, 'metal', { seg: 10 }), limb([0, 0.04, 0], [0.04, 0.3, -0.06], 0.012, 'metal', { kind: 'cyl' }), limb([0.04, 0.3, -0.06], [0.0, 0.44, 0.1], 0.012, 'metal', { kind: 'cyl' }), sph([0.04, 0.3, -0.06], 0.02, 'metal', { seg: 5 }),
      cone([0, 0.42, 0.14], 0.07, 0.11, 'shade', { seg: 10, pitch: 2.3 }), sph([0, 0.4, 0.16], 0.03, 'bulb', { seg: 6, glow: 1, role: 'light' })],
    palette: { metal: C.iron, shade: '#2f6b5c', bulb: '#ffe2a8' }, components: { light: { color: '#ffd99a', range: 3, on: true } }, layer: 'decor' }),
  vocabDef({ name: 'fireplace', category: 'furniture.lighting', synonyms: ['hearth', 'fire', 'chimney piece', 'wood burner', 'open fire'],
    description: 'A stone fireplace (1.6 × 1.3 m) with a mantel shelf and a log fire; light it and put it out. Stands against a wall; the mantel holds small things.',
    actuators: [['ignite', { default: true }]], label: 'the fire',
    shapes: [cbox([-0.62, 0.6, 0], [0.36, 1.2, 0.5], 'stone'), cbox([0.62, 0.6, 0], [0.36, 1.2, 0.5], 'stone'), cbox([0, 1.08, 0], [0.9, 0.26, 0.5], 'stone'), cbox([0, 1.27, 0.04], [1.7, 0.08, 0.6], 'mantel'),
      box([0, 0.55, -0.18], [0.9, 0.9, 0.12], 'soot'), cbox([0, 0.05, 0.28], [1.6, 0.1, 0.5], 'hearth'), cyl([-0.12, 0.17, 0.05], 0.06, 0.6, 'log', { roll: Math.PI / 2, yaw: 0.3, seg: 6 }), cyl([0.12, 0.17, 0.08], 0.06, 0.55, 'log', { roll: Math.PI / 2, yaw: -0.4, seg: 6 }),
      ...withRole('flame', [0, 0.2, 0.06], [cone([0, 0.38, 0.06], 0.16, 0.36, 'flame', { seg: 6, glow: 1 }), cone([-0.13, 0.33, 0.1], 0.09, 0.24, 'ember', { seg: 5, glow: 1 }), cone([0.14, 0.32, 0.03], 0.08, 0.22, 'ember', { seg: 5, glow: 1 })])],
    palette: { stone: C.stone, mantel: C.walnut, soot: C.soot, hearth: C.dstone, log: '#6e4a30', flame: C.flame, ember: C.ember }, slots: [surface('mantel', [0, 1.32, 0.05], 6, [0.3, 0.4, 0.25])], components: { surface: { height: 1.32 } } }),

  // ---------------- utilities (utility.comms)
  vocabDef({ name: 'phone-box', category: 'utility.comms', synonyms: ['phone booth', 'telephone box', 'call box', 'telephone booth', 'kiosk'],
    description: 'A red telephone box (1 × 2.6 m) with glazed sides and a domed roof; the door opens and one person can stand inside.',
    actuators: ['door'], label: 'the phone box door', ranges: { sx: [0.9, 1.2], sy: [0.9, 1.2], sz: [0.9, 1.2] },
    shapes: [cbox([0, 0.06, 0], [1.05, 0.12, 1.05], 'paint'), ...[[-0.48, -0.48], [0.48, -0.48], [-0.48, 0.48], [0.48, 0.48]].map(([x, z]) => cbox([x, 1.25, z], [0.1, 2.3, 0.1], 'paint')),
      box([-0.48, 1.3, 0], [0.04, 1.9, 0.86], 'glass', { material: 'glass' }), box([0.48, 1.3, 0], [0.04, 1.9, 0.86], 'glass', { material: 'glass' }), box([0, 1.3, -0.48], [0.86, 1.9, 0.04], 'glass', { material: 'glass' }),
      cbox([0, 2.43, 0], [1.1, 0.16, 1.1], 'paint'), box([0, 2.43, 0.556], [0.7, 0.1, 0.01], 'sign', { glow: 0.6 }), lathe([0, 2.51, 0], [[0.56, 0], [0.5, 0.08], [0.3, 0.16], [0, 0.18]], 'paint', { seg: 8, scale: [1, 1, 1] }),
      cbox([0, 1.2, -0.38], [0.3, 0.4, 0.14], 'iron'),
      ...withRole('door', [-0.43, 1.25, 0.5], [box([0, 1.25, 0.5], [0.86, 2.2, 0.05], 'paint'), box([0, 1.4, 0.53], [0.66, 1.4, 0.02], 'glass', { material: 'glass' }), box([0.32, 1.1, 0.56], [0.04, 0.3, 0.04], 'brass')])],
    palette: { paint: C.red, glass: C.glass, sign: C.white, iron: C.iron, brass: C.brass }, slots: [stand('inside', [0, 0.12, 0], Math.PI)] }),

  // ---------------- buildings (building.commercial): a preset of the building generator
  // ---------------- composition: a set (furniture.table)
  setDef({ name: 'cafe-terrace', category: 'furniture.table', synonyms: ['outdoor seating', 'terrace', 'cafe tables', 'beer garden', 'pavement cafe', 'bistro tables'],
    description: 'A café terrace: two tables under parasols with four chairs (5 × 2.5 m). Placed as one; each piece is its own thing afterwards.',
    parts: [{ id: 'table-a', def: 'core/parasol-table@1', p: [-1.25, 0] }, { id: 'table-b', def: 'core/parasol-table@1', p: [1.25, 0] },
      { id: 'chair-a1', def: 'core/chair@1', p: [-1.25, -0.75], r: 0 }, { id: 'chair-a2', def: 'core/chair@1', p: [-1.25, 0.75], r: 3.1416 },
      { id: 'chair-b1', def: 'core/chair@1', p: [1.25, -0.75], r: 0 }, { id: 'chair-b2', def: 'core/chair@1', p: [1.25, 0.75], r: 3.1416 }],
    size: { box: [5, 2.4, 2.5] } }),

  // ---------------- construction (layer.construction)
  vocabDef({ name: 'traffic-cone', category: 'layer.construction', synonyms: ['road cone', 'pylon', 'safety cone', 'witches hat'],
    description: 'An orange traffic cone (0.7 m) with a white reflective band on a square base; marks works, closes a lane.',
    conventions: ['stretch', 'warp', 'paint', 'wear'], ranges: { sx: [0.6, 1.6], sy: [0.6, 1.6], sz: [0.6, 1.6] },
    shapes: [cbox([0, 0.02, 0], [0.38, 0.04, 0.38], 'base', { round: 0.02 }), cone([0, 0.37, 0], 0.15, 0.66, 'cone', { seg: 10 }), cyl([0, 0.42, 0], 0.093, 0.1, 'band', { r2: 0.077, seg: 10 })],
    palette: { base: '#2b2b2b', cone: C.orange, band: C.white }, components: { carryable: { mass: 2.5, grips: 1 } }, layer: 'decor' }),
];
