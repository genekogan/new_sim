// node --test tools/mars-rotation/add-patch.test.mjs — the additive Mars patch tool's pure parts (no server).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { bearingOf, loadSpec, makePatch, rollbackBatch, verify } from './add-patch.mjs';
import { turn } from './patch.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const ent = (id, name, p, r = 0, parent = 'world', def = 'x@1') => ({ id, name, p, r, v: 1, def, in: { parent } });
const world = (mimosR = -1.571) => ({ worldId: 'w1', seq: 10, entities: [ent('e_m', 'mimos', [2.097, -0.24, -33.989], mimosR), ent('e_c', 'chiba', [-14.755, 0, -30.23], mimosR), ent('e_f', 'freeside', [85.2, 0, -25.5], mimosR), ent('e_h', 'freeside-hydro-cart-chrome', [98.8, 0, -36.4], mimosR), ent('e_fc', 'field-chair', [-2.6, 0, -50]), ent('e_fc4', 'field-chair-4', [-3.2, 0, -48.4])] });

test('bearing from Mimos yaw; positions turn with the campus; building-frame items do not', () => {
  assert.equal(bearingOf(world()), 90);
  const b82 = world(-1.571 + (8 * Math.PI) / 180); assert.equal(bearingOf(b82), 82);
  assert.throws(() => bearingOf(world(-1.571 + 0.6)), /outside 70..90/);
  const water = loadSpec(`${root}worlds/patches/mars-water-20261016/spec.json`), field = loadSpec(`${root}worlds/patches/mars-field-20261016/spec.json`);
  const p90 = makePatch(world(), water), p82 = makePatch(b82, water);
  const tank90 = p90.batch.ops.find((o) => o.name === 'water-tank'), tank82 = p82.batch.ops.find((o) => o.name === 'water-tank');
  assert.deepEqual(tank90.p, [101.6, -38.6]);
  assert.deepEqual(tank82.p, turn([101.6, -38.6], -1.571, 82).p);
  assert.equal(p90.batch.ops.filter((o) => o.op === 'define').length, 3);
  const bowl = makePatch(b82, field).batch.ops.find((o) => o.name === 'field-fire-bowl');
  assert.deepEqual([bowl.in, bowl.p], [{ parent: 'chiba' }, [-18.87, 0, -13.055]]);
});

test('apply refuses a patched or wrong world; rollback removes exactly its things and refuses a held one', () => {
  const water = loadSpec(`${root}worlds/patches/mars-water-20261016/spec.json`);
  assert.throws(() => makePatch({ worldId: 'w2', entities: [] }, water), /no mimos/);
  const w = world(), receipt = makePatch(w, water);
  const placed = receipt.batch.ops.filter((o) => o.op === 'place').map((o, i) => ent(`e_${i}`, o.name, [o.p[0], 0, o.p[1]], o.r, 'world', o.def));
  const after = { ...w, entities: [...w.entities, ...placed] };
  assert.throws(() => makePatch(after, water), /already in the world/);
  verify(after, receipt);
  Object.assign(receipt, { appliedSeq: 11, ids: Object.fromEntries(placed.map((e) => [e.name, e.id])) });
  const rb = rollbackBatch(receipt, after);
  assert.deepEqual(rb.ops.map((o) => o.id).sort(), placed.map((e) => e.id).sort());
  assert.ok(rb.ops.every((o) => o.op === 'remove') && Object.keys(rb.expect).length === 4);
  const held = { ...after, entities: after.entities.map((e) => (e.name === 'watering-can' ? { ...e, in: { parent: 'h_ana', slot: 'carry' } } : e)) };
  assert.throws(() => rollbackBatch(receipt, held), /watering-can is held/);
  verify({ ...w }, receipt, true);
});

test('rollback guards skip undone edits, undo records and rolled-back add-patch pairs, nothing else', async () => {
  const { latestEffectiveEdit: rot } = await import('./patch.mjs');
  const { latestEffectiveEdit: fid } = await import('../mars-fidelity/patch.mjs');
  for (const latest of [rot, fid]) {
    const mine = { seq: 30, grp: 'mars-rotation-20261016-ab', kind: 'edit', by: 'god' };
    const edits = [
      { seq: 36, kind: 'engine', by: 'engine' },
      { seq: 35, grp: 'mars-field-20261016-cd-rollback', kind: 'edit', by: 'god' },
      { seq: 34, grp: 'mars-water-20261016-ef-rollback', kind: 'edit', by: 'god' },
      { seq: 33, kind: 'undo', by: 'god' },
      { seq: 32, grp: 'other', kind: 'edit', by: 'god', undone: true },
      { seq: 31, grp: 'mars-field-20261016-cd', kind: 'edit', by: 'god' },
      { seq: 31.5, grp: 'mars-water-20261016-ef', kind: 'edit', by: 'god' },
      mine,
    ];
    assert.equal(latest(edits), mine);
    // a later ordinary edit still blocks the rollback
    assert.notEqual(latest([{ seq: 40, grp: 'g-free-edit', kind: 'edit', by: 'god' }, ...edits]), mine);
    // a patch whose rollback has not happened still blocks it
    assert.notEqual(latest(edits.filter((e) => e.seq !== 35)), mine);
  }
});
