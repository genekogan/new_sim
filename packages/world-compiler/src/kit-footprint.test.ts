import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldModel, applyBatch, type Refused } from './index.ts';

const shapes = [
  ...[-2.8, 2.8].flatMap(x => [-2.8, 2.8].map(z => ({ kind: 'box', at: [x, 1.5, z], size: [0.2, 3, 0.2] }))),
  { kind: 'box', at: [0, 3.1, 0], size: [6, 0.2, 6] },
];
function setup(footprint: unknown = 'open', extra: Record<string, unknown> = {}) {
  const w = new WorldModel({ constants: { ground: 'land' }, seed: 'kit-ground' });
  const result = applyBatch(w, { ops: [{ op: 'define', def: { schema: 'def/1', name: 'pavilion', size: { box: [6, 3.2, 6], scale: [0.1, 3] }, make: { kind: 'gen', gen: 'kit/2', args: { shapes, footprint } }, ...extra } }] }, 'god', 0).result;
  assert.equal(result.accepted, true, JSON.stringify(result));
  return w;
}
const place = (w: WorldModel, extra: object = {}) => applyBatch(w, { ops: [{ op: 'place', def: 'pavilion@1', name: 'gazebo', p: [10, 0], ...extra }] }, 'god', 1).result;

test('open kit admission retains room slots together with def-authored seats', () => {
  const w = setup('open', { slots: [{ id: 'bench', kind: 'seat', p: [0, 0.5, 0] }] });
  assert.equal(place(w).accepted, true);
  const b = w.bake(w.resolvedDef('pavilion@1')!, {}, 0);
  assert.deepEqual(b.slots.map(s => s.id), ['ground', 'front', 'bench']);
  assert.equal(w.slotsOf(w.get('gazebo')!).some(s => s.id === 'ground'), true);
});

test('instance scaling and stretch must preserve two-metre ground headroom', () => {
  const w = setup();
  const refused = place(w, { s: 0.5 }) as Refused;
  assert.equal(refused.failures[0].code, 'architecture.headroom'); assert.equal(w.entities.size, 0);
  const stretched = setup('open', { params: { sy: { type: 'number', default: 1 } } });
  assert.equal((place(stretched, { params: { sy: 0.5 } }) as Refused).failures[0].code, 'architecture.headroom');
});

test('inline rooms require a real entrance; windows do not grant access', () => {
  const footprint = { schema: 'lm-building-footprint/1', rooms: [{ id: 'hall', level: 0, y0: 0, y1: 3, polygon: [[-3, -3], [3, -3], [3, 3], [-3, 3]] }], portals: [{ id: 'window', kind: 'window', level: 0, center: [0, 1, 3], width: 2, y0: 0, y1: 3 }] };
  const w = setup(footprint), before = w.snapshot();
  assert.equal((place(w) as Refused).failures[0].code, 'architecture.sealed'); assert.deepEqual(w.snapshot(), before);
});

test('new surrounding solids may block three open sides but never the last exterior approach', () => {
  const w = setup(); assert.equal(place(w).accepted, true);
  const defined = applyBatch(w, { ops: [{ op: 'define', def: { schema: 'def/1', name: 'barrier', size: { box: [7.2, 3, 0.2] }, make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, 1.5, 0], size: [7.2, 3, 0.2] }] } } } }] }, 'god', 2).result;
  assert.equal(defined.accepted, true);
  const walls = [
    { p: [10, -3.8], r: 0 }, { p: [10, 3.8], r: 0 },
    { p: [6.2, 0], r: Math.PI / 2 }, { p: [13.8, 0], r: Math.PI / 2 },
  ];
  for (const [i, wall] of walls.entries()) {
    const r = applyBatch(w, { ops: [{ op: 'place', def: 'barrier@1', ...wall }] }, 'god', 3 + i).result;
    if (i < 3) assert.equal(r.accepted, true, JSON.stringify(r));
    else assert.equal((r as Refused).failures[0].code, 'architecture.sealed');
  }
});
