import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_KIT, WorldModel, applyBatch } from './index.ts';

// Moving a building carries its parent-local contents; the solid index must follow them, or later checks (overlap,
// sealed entrances) measure the furniture where it stood before the move.
test('moving a furnished building re-indexes its contents at their new world pose', () => {
  const w = new WorldModel({ constants: { ground: 'land' }, seed: 'move-children' });
  for (const d of CORE_KIT) w.defineDef(d, 'core', 0);
  assert.equal(applyBatch(w, { ops: [{ op: 'place', def: 'core/church@1', name: 'church', p: [0, 0] }] }, 'god', 1).result.accepted, true);
  const church = w.get('church')!;
  const solids = w.subtree(church.id).slice(1).filter((id) => w.footprintsOf(id).length);
  assert.ok(solids.length >= 8, 'the church has solid contents');
  const r = applyBatch(w, { ops: [{ op: 'move', id: church.id, p: [40, 25], r: 0.5 }] }, 'god', 2).result;
  assert.equal(r.accepted, true, JSON.stringify(r));
  for (const id of solids) {
    const e = w.entities.get(id)!, indexed = w.footprintsOf(id), fresh = w.footprint(e);
    assert.equal(indexed.length, fresh.length);
    indexed.forEach((b, i) => { assert.ok(Math.hypot(b.c[0] - fresh[i].c[0], b.c[1] - fresh[i].c[1]) < 1e-9, `${e.name} indexed where it stood before the move`); assert.ok(Math.abs(b.yaw - fresh[i].yaw) < 1e-9); });
    assert.ok(w.near(fresh).has(id), `${e.name} found at its new place`);
  }
  // the old site is clear again: a solid placed where a pew stood before the move is admitted
  const s = applyBatch(w, { ops: [{ op: 'place', def: 'core/church@1', name: 'church-2', p: [0, 0] }] }, 'god', 3).result;
  assert.equal(s.accepted, true, JSON.stringify(s));
});
