// building/1 through the compiler (lane L2): room slots put furniture on its floor, `set floors` keeps
// it, walls refuse things pushed through them, sealed rooms are refused. The last two need L1's
// admit() patch (team/lanes/buildings-patches/01); without it they are skipped, not failed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_KIT, WorldModel, applyBatch, type Accepted, type Refused } from './index.ts';

function fresh() { const w = new WorldModel({ constants: { extent: 1000, ground: 'land' }, seed: 'bld' }); for (const d of CORE_KIT) w.defineDef(d, 'core', 0); return w; }
const ok = (r: ReturnType<typeof applyBatch>) => { assert.equal(r.result.accepted, true, JSON.stringify((r.result as Refused).failures)); return r.result as Accepted; };
const patched = (() => { const w = fresh(); applyBatch(w, { ops: [{ op: 'place', def: 'core/cottage@1', name: 'h', p: [0, 0] }] }, 'god', 1); return applyBatch(w, { ops: [{ op: 'place', def: 'core/table@1', in: { parent: 'h', slot: 'living' }, p: [0, 0, 2.6] }] }, 'god', 2).result.accepted === false; })();

test('room slots: a table in the upstairs bedroom stands on floor 1; one in the kitchen on the ground floor', () => {
  const w = fresh();
  ok(applyBatch(w, { ops: [
    { op: 'place', tmp: '$h', def: 'core/cottage@1', name: 'house', p: [0, 0], params: { floors: 2 } },
    { op: 'place', def: 'core/table@1', name: 'up', in: { parent: '$h', slot: 'bedroom' } },
    { op: 'place', def: 'core/table@1', name: 'down', in: { parent: '$h', slot: 'kitchen' } },
  ] }, 'god', 1));
  const h = w.get('house')!, base = w.worldPose(h).y;
  assert.equal(+(w.worldPose(w.get('house/up')!).y - base).toFixed(3), 2.9);
  assert.equal(+(w.worldPose(w.get('house/down')!).y - base).toFixed(3), 0.1);
});

test('set floors 1 → 2 keeps every piece and its pose; undo restores one floor', () => {
  const w = fresh();
  ok(applyBatch(w, { ops: [{ op: 'place', tmp: '$h', def: 'core/cottage@1', name: 'c', p: [0, 0] }, { op: 'place', def: 'core/table@1', name: 't', in: { parent: '$h', slot: 'kitchen' } }, { op: 'place', def: 'core/chair@1', name: 's', in: { parent: '$h', slot: 'living' }, p: [0.5, 0, 0.5] }] }, 'god', 1));
  const before = JSON.stringify([w.worldPose(w.get('c/t')!), w.worldPose(w.get('c/s')!)]);
  const r = applyBatch(w, { ops: [{ op: 'set', id: 'c', params: { floors: 2 } }] }, 'god', 2); ok(r);
  assert.equal(JSON.stringify([w.worldPose(w.get('c/t')!), w.worldPose(w.get('c/s')!)]), before);
  assert.ok(w.slotsOf(w.get('c')!).some((s) => s.id === 'landing'));
  ok(applyBatch(w, { ops: r.inverse! }, 'god', 3, { trusted: true }));
  assert.ok(!w.slotsOf(w.get('c')!).some((s) => s.id === 'landing'));
});

test('walls are solid to what is inside: a table through the front wall is refused, naming the wall', { skip: !patched && 'needs L1 patch 01 (admit: ancestor walls)' }, () => {
  const w = fresh();
  ok(applyBatch(w, { ops: [{ op: 'place', def: 'core/cottage@1', name: 'h', p: [0, 0] }] }, 'god', 1));
  const f = (applyBatch(w, { ops: [{ op: 'place', def: 'core/table@1', in: { parent: 'h', slot: 'living' }, p: [-0.5, 0, 2.6] }] }, 'god', 2).result as Refused).failures[0];
  assert.equal(f.code, 'overlap.solid'); assert.match(f.detail, /crosses h wall:f0:s/);
  ok(applyBatch(w, { ops: [{ op: 'place', def: 'core/table@1', in: { parent: 'h', slot: 'living' }, p: [0.4, 0, 0.8] }] }, 'god', 3));
});

test('a house with a sealed room is refused with the room named', { skip: !patched && 'needs L1 patch 01 (admit: architecture violations)' }, () => {
  const w = fresh();
  const plan = { floors: [{ rooms: [{ id: 'kitchen', rect: [0, 0, 4, 6] }, { id: 'living', rect: [4, 0, 10, 8] }, { id: 'store', rect: [0, 6, 4, 8] }], doors: [{ between: ['kitchen', 'living'] }], exterior: [{ room: 'living', wall: 's', kind: 'door' }] }] };
  const r = applyBatch(w, { ops: [{ op: 'place', def: 'core/cottage@1', name: 's', p: [0, 0], params: { w: 10, d: 8, plan } }] }, 'god', 1);
  const f = (r.result as Refused).failures[0];
  assert.equal(f.code, 'architecture'); assert.match(f.detail, /room\.unreachable: store/);
});

test('set floors 2 → 1: furniture in rooms that went away moves to the ground floor, with a warning; undo puts it back', { skip: !patched && 'needs L1 patch 01 (set: orphaned slots)' }, () => {
  const w = fresh();
  ok(applyBatch(w, { ops: [{ op: 'place', tmp: '$h', def: 'core/cottage@1', name: 'c', p: [0, 0], params: { floors: 2 } }, { op: 'place', def: 'core/chair@1', name: 'up', in: { parent: '$h', slot: 'bedroom-2' } }] }, 'god', 1));
  const r = applyBatch(w, { ops: [{ op: 'set', id: 'c', params: { floors: 1 } }] }, 'god', 2); const a = ok(r);
  assert.equal(w.get('c/up')!.in.slot, 'ground'); assert.ok(a.warnings.some((x) => /bedroom-2 is gone/.test(x)), JSON.stringify(a.warnings));
  assert.ok(w.worldPose(w.get('c/up')!).y < 0.2, 'on the ground floor');
  ok(applyBatch(w, { ops: r.inverse! }, 'god', 3, { trusted: true }));
  assert.equal(w.get('c/up')!.in.slot, 'bedroom-2');
});
