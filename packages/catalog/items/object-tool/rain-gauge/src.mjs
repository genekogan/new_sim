// CC0. This item has no weather-driven filling; it is an empty marked vessel.
export default {
  schema: 'def/1', name: 'core-rain-gauge', version: 1, form: 'point',
  description: '', category: 'object.tool', tags: ['weather', 'tool', 'container'],
  make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [
    { kind: 'rbox', at: [0, 0.015, 0], size: [0.28, 0.03, 0.28], round: 0.005, tint: 'base', collide: false },
    { kind: 'lathe', at: [0, 0.03, 0], profile: [[0, 0], [0.085, 0], [0.085, 0.31], [0.077, 0.31], [0.077, 0.012], [0, 0.012]], segments: 12, tint: 'glass', material: 'glass', collide: false },
    ...[0.085, 0.135, 0.185, 0.235, 0.285].map((y, i) => ({ kind: 'box', at: [0, y, 0.086], size: [i % 2 ? 0.025 : 0.04, 0.003, 0.003], round: 0, tint: 'ticks', collide: false })),
  ] } },
  params: {
    base: { type: 'color', default: '#6f8a73', doc: 'Base colour' },
    glass: { type: 'color', default: '#b8dbe8', doc: 'Glass tint' },
    ticks: { type: 'color', default: '#38434a', doc: 'Graduation colour' },
  },
  palette: { base: '#6f8a73', glass: '#b8dbe8', ticks: '#38434a' },
  anchor: 'base', layer: 'decor', size: { box: [0.28, 0.34, 0.28] },
  components: { carryable: { mass: 0.3, grips: 1 } },
};
