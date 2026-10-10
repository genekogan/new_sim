// core kit v0: the defs every world starts with. Names are `core-<name>` so
// `core/<name>@v` resolves (see WorldModel.defineDef). M5 replaces the boxes
// with real generators and the migrated Eden kits; the refs stay.
import type { DefInput } from './schemas.ts';

export const coreRef = (name: string, v = 1) => `core/${name}@${v}`;

const gen = (name: string, genId: string, extra: Partial<DefInput>): DefInput => ({
  schema: 'def/1', name: `core-${name}`, version: 1, description: '', tags: [], form: 'point',
  make: { kind: 'gen', gen: genId }, size: { box: [1, 1, 1] }, ...extra,
});

export const CORE_KIT: DefInput[] = [
  gen('box', 'box/1', { description: 'A plain box. Placeholder for anything.', tags: ['prop'], size: { box: [1, 1, 1], scale: [0.1, 50] } }),

  // --- terrain ---
  gen('knoll', 'landform/1', { description: 'A gentle grassy rise.', tags: ['landform'], layer: 'decor', size: { box: [40, 6, 40] }, params: { height: { type: 'number', min: 0.5, max: 15, default: 4 }, radius: { type: 'number', min: 5, max: 60, default: 18 }, peak: { type: 'number', min: 0.5, max: 2, default: 1 } } }),
  gen('hill', 'landform/1', { description: 'A hill you can walk over.', tags: ['landform'], layer: 'decor', size: { box: [200, 40, 200] }, params: { height: { type: 'number', min: 5, max: 60, default: 25 }, radius: { type: 'number', min: 20, max: 300, default: 80 }, peak: { type: 'number', min: 0.5, max: 3, default: 1.2 } } }),
  gen('mountain', 'landform/1', { description: 'A mountain. Place as a point (one peak) or with a path shape (a range).', tags: ['landform'], layer: 'decor', size: { box: [400, 120, 400] }, params: { height: { type: 'number', min: 40, max: 400, default: 180 }, radius: { type: 'number', min: 60, max: 1200, default: 200 }, peak: { type: 'number', min: 1, max: 6, default: 2.5 } } }),
  gen('plateau', 'landform/1', { description: 'A raised flat area with soft edges. Area shape.', tags: ['landform'], layer: 'decor', form: 'area', size: { box: [400, 60, 400] }, params: { height: { type: 'number', min: 0.5, max: 60, default: 4 }, edge: { type: 'number', min: 1, max: 100, default: 10 } } }),
  gen('lake', 'lake/1', { description: 'A lake: carves a bed and fills it. Area shape.', tags: ['water'], layer: 'volume', form: 'area', size: { box: [400, 60, 400] }, params: { depth: { type: 'number', min: 0.3, max: 60, default: 4 }, level: { type: 'number', min: -100, max: 400, default: -0.3 }, edge: { type: 'number', min: 0.5, max: 60, default: 6 } } }),
  gen('pond', 'lake/1', { description: 'A small pond. Area shape.', tags: ['water'], layer: 'volume', form: 'area', size: { box: [60, 6, 60] }, params: { depth: { type: 'number', min: 0.3, max: 4, default: 1.2 }, level: { type: 'number', min: -100, max: 400, default: -0.2 }, edge: { type: 'number', min: 0.5, max: 10, default: 2 } } }),

  // --- cover ---
  gen('meadow', 'scatter/1', { description: 'Tall grass and wildflowers over an area.', tags: ['cover'], layer: 'decor', form: 'area', size: { box: [400, 1, 400] }, params: { density: { type: 'number', min: 0.01, max: 4, default: 0.6 }, minSpacing: { type: 'number', min: 0.2, max: 5, default: 0.8 } } }),
  gen('forest', 'scatter/1', { description: 'Trees scattered over an area.', tags: ['cover'], layer: 'decor', form: 'area', size: { box: [400, 14, 400] }, params: { density: { type: 'number', min: 0.001, max: 0.2, default: 0.02 }, minSpacing: { type: 'number', min: 2, max: 20, default: 5 }, height: { type: 'number', min: 3, max: 30, default: 10 } } }),
  gen('garden', 'scatter/1', { description: 'A planted bed: flowers and vegetables in rows.', tags: ['cover', 'garden'], layer: 'decor', form: 'area', size: { box: [60, 1, 60] }, params: { density: { type: 'number', min: 0.1, max: 6, default: 2 }, minSpacing: { type: 'number', min: 0.2, max: 2, default: 0.5 } } }),

  // --- props (box placeholders until M5) ---
  gen('tree', 'box/1', { description: 'A single tree.', tags: ['plant', 'tree'], anchor: 'center', size: { box: [0.6, 7, 0.6], scale: [0.4, 3] }, params: { w: { type: 'number', default: 0.6 }, h: { type: 'number', default: 7 }, d: { type: 'number', default: 0.6 }, color: { type: 'color', default: '#2f6b2f' } } }),
  gen('rock', 'box/1', { description: 'A boulder.', tags: ['prop', 'rock'], anchor: 'conform', tilt: { maxDeg: 25 }, size: { box: [1.2, 0.8, 1], scale: [0.3, 6] }, params: { w: { type: 'number', default: 1.2 }, h: { type: 'number', default: 0.8 }, d: { type: 'number', default: 1 }, color: { type: 'color', default: '#7d7a72' } } }),
  gen('bench', 'box/1', { description: 'A wooden bench for two.', tags: ['prop', 'furniture', 'seat'], size: { box: [1.6, 0.45, 0.5] }, params: { w: { type: 'number', default: 1.6 }, h: { type: 'number', default: 0.45 }, d: { type: 'number', default: 0.5 }, color: { type: 'color', default: '#8a5a2b' } }, slots: [{ id: 'seat-1', kind: 'seat', p: [-0.4, 0.45, 0], yaw: 0, accepts: { tags: ['body'] }, capacity: 1 }, { id: 'seat-2', kind: 'seat', p: [0.4, 0.45, 0], yaw: 0, accepts: { tags: ['body'] }, capacity: 1 }], components: { seat: { height: 0.45 } } }),
  gen('table', 'box/1', { description: 'A table.', tags: ['prop', 'furniture'], size: { box: [1.2, 0.75, 0.8] }, params: { w: { type: 'number', default: 1.2 }, h: { type: 'number', default: 0.75 }, d: { type: 'number', default: 0.8 }, color: { type: 'color', default: '#a0783c' } }, slots: [{ id: 'top', kind: 'surface', p: [0, 0.75, 0], yaw: 0, accepts: { maxSize: [0.6, 0.6, 0.6], maxMass: 20 }, capacity: 12 }], components: { surface: { height: 0.75 } } }),
  gen('chair', 'box/1', { description: 'A chair.', tags: ['prop', 'furniture', 'seat'], size: { box: [0.5, 0.45, 0.5] }, params: { w: { type: 'number', default: 0.5 }, h: { type: 'number', default: 0.45 }, d: { type: 'number', default: 0.5 }, color: { type: 'color', default: '#6b4a2b' } }, slots: [{ id: 'seat', kind: 'seat', p: [0, 0.45, 0], yaw: 0, accepts: { tags: ['body'] }, capacity: 1 }], components: { seat: { height: 0.45 } } }),
  gen('bowl', 'box/1', { description: 'A bowl.', tags: ['item', 'container'], size: { box: [0.25, 0.1, 0.25] }, params: { w: { type: 'number', default: 0.25 }, h: { type: 'number', default: 0.1 }, d: { type: 'number', default: 0.25 }, color: { type: 'color', default: '#d9c7a8' } }, components: { carryable: { mass: 0.5, grips: 1 }, container: { capacity: 1 } } }),
  gen('lamp-post', 'box/1', { description: 'A street lamp.', tags: ['prop', 'light'], anchor: 'center', size: { box: [0.3, 4, 0.3] }, params: { w: { type: 'number', default: 0.3 }, h: { type: 'number', default: 4 }, d: { type: 'number', default: 0.3 }, color: { type: 'color', default: '#333333' } }, components: { light: { color: '#ffe9c4', range: 10, on: true } }, state: { on: { type: 'bool', default: true } } }),
  gen('fountain', 'box/1', { description: 'A stone fountain.', tags: ['prop', 'water'], size: { box: [4, 1.2, 4] }, params: { w: { type: 'number', default: 4 }, h: { type: 'number', default: 1.2 }, d: { type: 'number', default: 4 }, color: { type: 'color', default: '#b8b4ad' } } }),
  gen('wall', 'box/1', { description: 'A wall segment.', tags: ['structure', 'wall'], size: { box: [4, 2.6, 0.25], scale: [0.25, 10] }, params: { w: { type: 'number', min: 0.5, max: 60, default: 4 }, h: { type: 'number', min: 0.5, max: 12, default: 2.6 }, d: { type: 'number', min: 0.1, max: 2, default: 0.25 }, color: { type: 'color', default: '#e8e2d6' } } }),
  gen('platform', 'box/1', { description: 'A flat deck people can stand on.', tags: ['structure', 'floor'], size: { box: [6, 0.3, 6], scale: [0.2, 20] }, params: { w: { type: 'number', default: 6 }, h: { type: 'number', default: 0.3 }, d: { type: 'number', default: 6 }, color: { type: 'color', default: '#b08b5a' } }, slots: [{ id: 'top', kind: 'floor', p: [0, 0.3, 0], yaw: 0, accepts: {}, capacity: 4096 }], components: { floor: { level: 0, y: 0.3 }, foundation: { kind: 'pad' } } }),
  // a cottage placeholder: one block with a terrace pad; M3 replaces make with building/1
  gen('cottage', 'box/1', { description: 'A small one-storey cottage (placeholder block until building/1).', tags: ['structure', 'building'], size: { box: [8, 3.6, 6] }, params: { w: { type: 'number', min: 4, max: 20, default: 8 }, h: { type: 'number', min: 2.6, max: 8, default: 3.6 }, d: { type: 'number', min: 3, max: 16, default: 6 }, color: { type: 'color', default: '#f1e7d2' } }, slots: [{ id: 'front', kind: 'stand', p: [0, 0, 3.6], yaw: 0, accepts: {}, capacity: 8 }], components: { foundation: { kind: 'pad' } }, state: { paint: { type: 'color', default: '#f1e7d2' } } }),

  // --- reference points: a labelled flag the god (or the owner, by clicking the ground) drops to point at places ---
  { schema: 'def/1', name: 'core-flag', version: 1, description: 'A labelled flag on a pole: a reference point for building ("put the well near flag:camp"). No collider; Souls walk through it.', tags: ['flag', 'marker'], form: 'point', make: { kind: 'gen', gen: 'box/1' }, layer: 'decor', anchor: 'center', size: { box: [0.1, 3, 0.1] }, params: { w: { type: 'number', default: 0.08 }, h: { type: 'number', default: 3 }, d: { type: 'number', default: 0.08 }, color: { type: 'color', default: '#e8c547' } }, state: { label: { type: 'string', max: 60, default: '' } } },

  // --- bodies (families; a Soul's body entity extends one) ---
  { schema: 'def/1', name: 'core-humanoid', version: 1, description: 'A human body on the humanoid rig.', tags: ['body'], form: 'point', make: { kind: 'none' }, size: { box: [0.56, 1.8, 0.56] }, layer: 'solid', anchor: 'base', components: { body: { media: ['walk', 'swim'], radius: 0.28, height: 1.8, landmarks: { eye: [0, 1.65, 0.08], top: [0, 1.8, 0], seat: [0, 0.45, 0] }, carry: { slot: 'hands', maxMass: 25, maxSize: [1.2, 1.2, 1.2] }, settle: 'sit', rig: 'humanoid' } }, slots: [{ id: 'carry', kind: 'carry', p: [0, 1.0, 0.35], yaw: 0, accepts: { tags: ['item'], maxMass: 25 }, capacity: 2 }] },
  // humanoid@2: the same body, with a look composed from the humanoid kit (apps/web/src/humanoid, plan 32).
  // Params are paint only; the engine body is unchanged. Height/build morphs are Phase 2 (after Stage B5).
  { schema: 'def/1', name: 'core-humanoid', version: 2, extends: 'core/humanoid@1', description: 'A human body on the humanoid rig whose look (frame, face, hair, clothes, hat, glasses, bag, colours) is composed from the shared humanoid kit.', tags: ['body'], form: 'point', make: { kind: 'none' }, size: { box: [0.56, 1.8, 0.56] }, layer: 'solid', anchor: 'base',
    params: {
      preset: { type: 'enum', values: ['none', 'casual', 'punk', 'woman'], default: 'none' },
      frame: { type: 'enum', values: ['masc', 'fem'], default: 'masc' },
      face: { type: 'enum', values: ['open', 'pierced', 'soft'], default: 'open' },
      hair: { type: 'enum', values: ['short', 'mohawk', 'bob', 'bald'], default: 'short' },
      top: { type: 'enum', values: ['shirt', 'jacket', 'tank'], default: 'shirt' },
      bottom: { type: 'enum', values: ['jeans', 'ripped', 'slacks'], default: 'jeans' },
      shoes: { type: 'enum', values: ['sneakers', 'boots', 'flats'], default: 'sneakers' },
      hat: { type: 'enum', values: ['none', 'cap', 'beanie', 'sunhat'], default: 'none' },
      glasses: { type: 'enum', values: ['none', 'round', 'square', 'shades'], default: 'none' },
      bag: { type: 'enum', values: ['none', 'backpack', 'satchel'], default: 'none' },
      pattern: { type: 'enum', values: ['plain', 'stripes', 'checks', 'knit'], default: 'plain' },
      headScale: { type: 'number', min: 0.9, max: 1.1, default: 1 },
      skin: { type: 'color', default: '#cead86' }, hair1: { type: 'color', default: '#492e18' }, brows: { type: 'color', default: '#3e3429' }, eyes: { type: 'color', default: '#31251c' },
      top1: { type: 'color', default: '#969083' }, top2: { type: 'color', default: '#b4b4b4' }, bottom1: { type: 'color', default: '#333f47' },
      shoes1: { type: 'color', default: '#7d2734' }, soles: { type: 'color', default: '#b4b4b4' }, accent: { type: 'color', default: '#af8749' }, gear: { type: 'color', default: '#3c5a6e' },
    } },
  { schema: 'def/1', name: 'core-floater', version: 1, description: 'A rigid hovering body (a sculpture, a head, a lantern).', tags: ['body'], form: 'point', make: { kind: 'none' }, size: { box: [0.7, 0.7, 0.7], scale: [0.4, 2.5] }, layer: 'solid', anchor: 'center', components: { body: { media: ['float'], radius: 0.35, height: 0.7, landmarks: { top: [0, 0.7, 0], eye: [0, 0.5, 0.3] }, carry: { slot: 'top', maxMass: 3, maxSize: [0.5, 0.5, 0.5] }, settle: 'hover', rig: null } }, slots: [{ id: 'carry', kind: 'carry', p: [0, 0.7, 0], yaw: 0, accepts: { tags: ['item'], maxMass: 3 }, capacity: 1 }] },
];
