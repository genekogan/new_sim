// Stand-ins for defs other lanes are adding (used only when the library lacks them).
const kit = (shapes, extra = {}) => ({ gen: 'kit/2', args: { shapes, ...(extra.gait ? { gait: extra.gait } : {}) }, ...extra });
export const STANDINS = {
  house: { gen: 'building/1', box: [8, 6, 6], tags: ['building'] },
  road: { gen: 'road/1', form: 'path', layer: 'surface', box: [6, 0.1, 6] },
  path: { gen: 'path/1', form: 'path', layer: 'surface', box: [2, 0.1, 2] },
  river: { gen: 'river/1', form: 'path', layer: 'volume', box: [10, 2, 10] },
  bridge: { gen: 'bridge/1', form: 'path', layer: 'surface', box: [4, 1, 4] },
  plaza: { gen: 'plaza/1', form: 'area', layer: 'surface', box: [20, 0.1, 20] },
  duck: kit([{ kind: 'capsule', at: [0, 0.12, 0], size: [0.28, 0.22, 0.45], color: '#f4f1e8', role: 'body' }, { kind: 'sphere', at: [0, 0.32, 0.18], r: 0.1, color: '#2f6b3a', role: 'head' }, { kind: 'cone', at: [0, 0.31, 0.3], r: 0.04, h: 0.1, color: '#e3a33b', pitch: 1.57, role: 'beak' }], { anchor: 'float', box: [0.3, 0.42, 0.5], tags: ['creature', 'bird'], gait: 'biped-waddle' }),
  stall: kit([{ kind: 'rbox', at: [0, 0, 0], size: [2.4, 0.9, 1.2], material: 'wood', color: '#9b6b3f' }, { kind: 'cyl', at: [-1.1, 0, 0.5], r: 0.05, h: 2.3, color: '#6b4a2b' }, { kind: 'cyl', at: [1.1, 0, 0.5], r: 0.05, h: 2.3, color: '#6b4a2b' }, { kind: 'wedge', at: [0, 2.2, 0], size: [2.7, 0.45, 1.6], material: 'fabric', color: '#c4453a' }], { box: [2.7, 2.65, 1.6], tags: ['market', 'prop'] }),
  bed: kit([{ kind: 'rbox', at: [0, 0, 0], size: [1.4, 0.45, 2], material: 'wood', color: '#8a5a3a' }, { kind: 'rbox', at: [0, 0.45, 0.1], size: [1.3, 0.15, 1.7], material: 'fabric', color: '#e9e2d0' }, { kind: 'rbox', at: [0, 0.6, -0.75], size: [1.1, 0.12, 0.35], material: 'fabric', color: '#f5f5f5' }], { box: [1.4, 0.75, 2], tags: ['furniture', 'bed'], components: { bed: { height: 0.5 } } }),
  shelf: kit([{ kind: 'rbox', at: [0, 0, 0], size: [1.4, 1.9, 0.4], material: 'wood', color: '#7a5233' }], { box: [1.4, 1.9, 0.4], tags: ['furniture'] }),
};
