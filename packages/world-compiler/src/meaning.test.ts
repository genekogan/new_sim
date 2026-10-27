import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_KIT, WorldModel, applyBatch, coreRef, hashOf, type Op } from './index.ts';
const fresh = () => { const w = new WorldModel({ constants: { extent: 100, ground: 'land' }, seed: 'meaning' }); for (const d of CORE_KIT) w.defineDef(d, 'core', 0); return w; };
const act = (w: WorldModel, ops: unknown[], trusted = false) => { const r = applyBatch(w, { ops }, 'god', 1, { trusted }); assert.equal(r.result.accepted, true, JSON.stringify(r.result)); return r; };
const place = (name: string, x: number, about?: unknown) => ({ op: 'place', def: coreRef('bench'), name, p: [x, 0], about });

test('meaning replaces, clears and undoes exactly; idempotent updates preserve geometry cache and save/reload', () => {
  const w = fresh(); act(w, [place('bench', 0)]);
  const before = w.get('bench')!, key = w.safetyCacheKey(), ground = hashOf(w.terrain.ground);
  const a = { title: 'Speaker bench', what: 'A bench beside the lecture hall.', aliases: ['podium bench'], kind: 'bench', salience: 2 };
  const edit = act(w, [{ op: 'set', id: 'bench', about: a }]);
  assert.deepEqual(w.get('bench')!.about, a); assert.equal(w.safetyCacheKey(), key); assert.deepEqual(edit.diff!.tiles, []);
  assert.equal(hashOf(w.terrain.ground), ground);
  const again = act(w, [{ op: 'set', id: 'bench', about: a }]); assert.equal(again.diff!.upserts.length, 0); assert.deepEqual(again.inverse, []);
  const snapshot = w.snapshot(); assert.deepEqual(WorldModel.fromSnapshot(snapshot).get('bench')!.about, a);
  const changed = act(w, [{ op: 'set', id: 'bench', about: { title: 'New' } }]); assert.deepEqual(w.get('bench')!.about, { title: 'New' });
  act(w, changed.inverse!, true); assert.deepEqual(w.get('bench')!.about, a);
  const clear = act(w, [{ op: 'set', id: 'bench', about: null }]); assert.equal(w.get('bench')!.about, undefined);
  act(w, clear.inverse!, true); assert.deepEqual(w.get('bench')!.about, a);
  act(w, edit.inverse!, true); assert.deepEqual({ ...w.get('bench'), v: 0 }, { ...before, v: 0 });
});

test('semantic parent uses stable IDs; forward refs, rename and clone preserve relationships without changing containment', () => {
  const w = fresh(); act(w, [place('child', 0, { in: 'parent', parts: [{ id: 'seat', title: 'Chair', anchor: { kind: 'entity', ref: 'parent' } }] }), place('parent', 10)]);
  assert.equal(w.get('child')!.about!.in, w.get('parent')!.id); assert.equal(w.get('child')!.in.parent, 'world');
  act(w, [{ op: 'set', id: 'parent', name: 'renamed' }]); assert.equal(w.get('child')!.about!.in, w.get('renamed')!.id);
  const original = w.get('child')!;
  act(w, [{ op: 'clone', id: 'child', name: 'copied', p: [20, 0] }]);
  assert.deepEqual(w.get('copied')!.about, original.about);
  const r = applyBatch(w, { ops: [{ op: 'remove', id: 'renamed' }] }, 'god', 1); assert.equal(r.result.accepted, false);
  act(w, [{ op: 'set', id: 'child', about: null }, { op: 'set', id: 'copied', about: null }, { op: 'remove', id: 'renamed' }]);
});

test('dangling parent/part, parent cycles, bad slots and duplicate parts refuse atomically', () => {
  const w = fresh(); act(w, [place('a', 0), place('b', 10)]);
  for (const about of [ { in: 'absent' }, { in: 'a' }, { parts: [{ id: 'x', title: 'X', anchor: { kind: 'entity', ref: 'absent' } }] },
    { parts: [{ id: 'x', title: 'X', anchor: { kind: 'entity', ref: 'b', slot: 'nonexistent' } }] }, { parts: [{ id: 'x', title: 'X' }, { id: 'x', title: 'Y' }] } ]) {
    const before = hashOf(w.snapshot()); const r = applyBatch(w, { ops: [{ op: 'set', id: 'a', about }] }, 'god', 1);
    assert.equal(r.result.accepted, false, JSON.stringify(about)); assert.equal(hashOf(w.snapshot()), before);
  }
  assert.equal(applyBatch(w, { ops: [{ op: 'set', id: 'a', about: { in: 'b' } }, { op: 'set', id: 'b', about: { in: 'a' } }] }, 'god', 1).result.accepted, false);
});

test('world meaning replacement and inverse preserve exact absence and existing fields', () => {
  const w = fresh(); act(w, [place('district', 0)]);
  const edit = act(w, [{ op: 'world', state: { about: { title: 'Test world', tour: 'Start at the hall.', districts: ['district'] } } }]);
  const about = structuredClone(w.state.about); assert.deepEqual(about!.districts, [w.get('district')!.id]);
  const replace = act(w, [{ op: 'world', state: { about: { title: 'Only title' } } }]); assert.deepEqual(w.state.about, { title: 'Only title' });
  act(w, replace.inverse!, true); assert.deepEqual(w.state.about, about);
  act(w, edit.inverse!, true); assert.equal(w.state.about, undefined); assert.equal(Object.hasOwn(w.state, 'about'), false);
});
