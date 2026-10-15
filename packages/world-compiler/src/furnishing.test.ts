import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_KIT, WorldModel, applyBatch, obbOverlap, type Refused } from './index.ts';
import { furnishBatch } from '../../../tools/god-skill/lib/furnish.mjs';

function fresh() {
  const w = new WorldModel({ constants: { ground: 'land' }, seed: 'furnishing' });
  for (const d of CORE_KIT) w.defineDef(d, 'core', 0);
  const r = applyBatch(w, { ops: [{ op: 'place', def: 'core/church@1', name: 'church' }] }, 'god', 1);
  assert.equal(r.result.accepted, true, JSON.stringify(r.result)); return w;
}

test('library church contents do not overlap each other; every pew cushion can be recoloured', () => {
  const w = fresh(), b = w.get('church')!;
  const children = [...w.children.get(b.id)!].map(id => w.entities.get(id)!);
  for (let i = 0; i < children.length; i++) for (const other of children.slice(i + 1)) {
    const e = children[i];
    assert.ok(!w.footprint(e).some(a => w.footprint(other).some(b => obbOverlap(a, b))), `${e.name} overlaps ${other.name}`);
  }
  const pews = children.filter(e => e.name?.includes('pew'));
  assert.ok(pews.length >= 8);
  for (const e of pews) {
    const result = applyBatch(w, { ops: [{ op: 'set', id: e.id, params: { cushion: '#123456' } }] }, 'god', 2).result;
    assert.equal(result.accepted, true, JSON.stringify(result));
  }
});

test('live church furnish recipe admits without overlaps after clearing its contents', () => {
  const w = fresh(), b = w.get('church')!;
  for (const id of [...w.children.get(b.id)!]) w.delete(id);
  const f = furnishBatch(w, b.id, 'church');
  assert.ok(f.ops.length >= 8);
  const r = applyBatch(w, { ops: f.ops }, 'god', 2).result;
  assert.equal(r.accepted, true, JSON.stringify(r));
});

test('moving a church pew into its piano is refused', () => {
  const w = fresh(), piano = w.get('church/nave-piano')!, pew = w.get('church/nave-pew-1-2')!;
  assert.ok(piano && pew);
  const result = applyBatch(w, { ops: [{ op: 'move', id: pew.id, p: piano.p }] }, 'god', 2).result;
  assert.equal((result as Refused).failures?.[0].code, 'overlap.solid');
});

test('legacy overlapping pair: unchanged footprint and reduced penetration pass, worsened and new overlap refuse', () => {
  const w = new WorldModel({ constants: { ground: 'land' }, seed: 'legacy-overlap' });
  w.defineDef({ schema: 'def/1', name: 'cube', params: { color: { type: 'color', default: '#ffffff' } }, size: { box: [1, 1, 1] }, make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', size: [1, 1, 1], at: [0, 0.5, 0] }] } } }, 'god', 0);
  for (const [id, x] of [['a', 0], ['b', 0.8], ['c', 4]] as const) {
    const e = { id, def: 'cube@1', in: { parent: 'world' }, p: [x, 0, 0] as [number, number, number], by: 'legacy', born: 0, v: 1 };
    w.insert(e); w.index(id, w.footprint(e));
  }
  assert.equal(applyBatch(w, { ops: [{ op: 'set', id: 'a', params: { color: '#123456' } }] }, 'god', 1).result.accepted, true);
  assert.equal(applyBatch(w, { ops: [{ op: 'move', id: 'b', p: [0.9, 0, 0] }] }, 'god', 2).result.accepted, true);
  for (const [id, x] of [['b', 0.4], ['c', -0.8]] as const) assert.equal((applyBatch(w, { ops: [{ op: 'move', id, p: [x, 0, 0] }] }, 'god', 3).result as Refused).failures?.[0].code, 'overlap.solid');
});
