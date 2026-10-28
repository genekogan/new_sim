import test from 'node:test';
import assert from 'node:assert/strict';
import vocab from './vocab-w3.json' with { type: 'json' };
import { OFFICE_DESK_DEF } from './office-desk.ts';
import { coreLibrary } from '../library.ts';
import { WorldModel } from '../model.ts';
import { applyBatch } from '../compile.ts';

test('office-desk v2 removes the embedded scenery chair while retaining workstation, anchors and frozen v1', () => {
  const library = coreLibrary(), old = library.get('core/office-desk@1')!, next = library.get('core/office-desk@2')!;
  const m = new WorldModel({ constants: { ground: 'land' }, seed: 'separate-computer-chair' }); m.library = library;
  assert.deepEqual(vocab.find(d => d.name === old.name)!.make, old.make);
  assert.equal(next.hash, m.defineDef(OFFICE_DESK_DEF, 'core', 0).hash);
  assert.notEqual(next.hash, old.hash);
  assert.deepEqual(next.slots, old.slots); assert.deepEqual(next.components, old.components);
  assert.equal(next.slots.some(slot => slot.kind === 'seat'), false, 'desk has no phantom seat');
  assert.equal(next.components.workstation?.kind, 'computer');
  assert.ok(next.make.kind === 'gen' && old.make.kind === 'gen');
  assert.deepEqual(next.make.args!.shapes, (old.make.args!.shapes as unknown[]).slice(0, -8));
  assert.deepEqual(m.bake(next, {}, 7).box, [1.4, 1.25, .7]);
  assert.ok(m.bake(old, {}, 7).box[2] > 1.2, 'historical geometry still includes its own chair');
  const r = applyBatch(m, { ops: [
    { op: 'place', def: 'core/office-desk@2', name: 'desk', p: [0, 0] },
    { op: 'place', def: 'core/office-chair@1', name: 'chair', p: [0, 1], r: Math.PI },
  ] }, 'god', 1);
  assert.equal(r.result.accepted, true, JSON.stringify(r.result));
  const seat = m.resolvedDef('core/office-chair@1')!;
  assert.equal(seat.slots.filter(slot => slot.kind === 'seat').length, 1);
  const desk = m.get('desk')!, chair = m.get('chair')!;
  assert.ok(Math.hypot(desk.p![0] - chair.p![0], desk.p![1] - chair.p![1]) < Math.hypot(1.4, .7) / 2 + 1, 'standalone chair remains within real activity-spots desk pairing radius');
});
