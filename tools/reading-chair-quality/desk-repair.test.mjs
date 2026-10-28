import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldModel, applyBatch } from '../../packages/world-compiler/src/index.ts';
import { coreLibrary } from '../../packages/world-compiler/src/library.ts';
import { EDEN_DESK_PAIRS, planEdenDeskRepair, repairHash } from './desk-repair.mjs';
function fixture() {
  const m = new WorldModel({ constants: { ground: 'land' }, seed: 'desk-repair' }); m.library = coreLibrary();
  const ops = EDEN_DESK_PAIRS.flatMap(([desk, chair], index) => [
    { op: 'place', def: 'core/office-desk@1', name: desk, p: [index * 5, 0], about: { title: desk, what: 'Preserve the computer and its local view.', viewpoint: { eye: [2, 1.6, 2], at: [0, 1, 0] } } },
    { op: 'place', def: 'core/office-chair@1', name: chair, p: [index * 5, 1], r: Math.PI },
  ]);
  const made = applyBatch(m, { ops }, 'god', 1); assert.ok(made.result.accepted, JSON.stringify(made.result));
  const input = () => ({ snapshotSha256: repairHash(m.snapshot()), pairs: EDEN_DESK_PAIRS.map(([desk, chair]) => ({ deskId: m.get(desk).id, seatId: m.get(chair).id })), audit: { seq: m.editSeq, uses: [...m.entities.values()].map(entity => ({ id: entity.id, inUse: null })), externalReferences: [] } });
  return { m, input };
}
test('bounded desk replacement is atomic, preserves all chair and semantic bytes, remaps exact about anchors and is idempotent', () => {
  const { m, input } = fixture();
  const oldId = m.get(EDEN_DESK_PAIRS[0][0]).id;
  const about = { parts: [{ id: 'computer', title: 'Computer', anchor: { kind: 'entity', ref: oldId } }] };
  assert.ok(applyBatch(m, { ops: [{ op: 'set', id: m.get(EDEN_DESK_PAIRS[1][1]).id, about }] }, 'god', 2).result.accepted);
  const expected = input(), before = structuredClone(m.snapshot()), plan = planEdenDeskRepair(m, expected);
  const chairs = EDEN_DESK_PAIRS.map(([, name]) => structuredClone(m.get(name)));
  const result = applyBatch(m, { ops: plan.ops }, 'god', 3); assert.ok(result.result.accepted, JSON.stringify(result.result));
  for (const [index, [desk, chair]] of EDEN_DESK_PAIRS.entries()) {
    assert.equal(m.resolvedDef(m.get(desk).def).version, 2); assert.notEqual(m.get(desk).id, expected.pairs[index].deskId);
    const prior = chairs[index]; if (index === 1) prior.about.parts[0].anchor.ref = m.get(EDEN_DESK_PAIRS[0][0]).id;
    // A chair with an explicit semantic anchor is updated only for that anchor; seat identity/geometry remain exact.
    assert.deepEqual({ ...m.get(chair), v: prior.v }, prior);
  }
  const afterInput = input(); afterInput.pairs = expected.pairs;
  assert.deepEqual(planEdenDeskRepair(m, afterInput).ops, []);
  assert.ok(m.def('sha:' + plan.hashes.old), 'historical definition preserved');
  const inverse = applyBatch(m, { ops: result.inverse }, 'engine', 4, { trusted: true }); assert.ok(inverse.result.accepted);
  const restored = [...m.entities.values()].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(restored.map(entity => ({ ...entity, v: before.entities.find(old => old.id === entity.id).v })), before.entities, 'prior entity IDs and all content restore atomically; edited semantic ref versions stay monotonic');
  assert.equal(m.get(EDEN_DESK_PAIRS[1][1]).v, before.entities.find(entity => entity.name === EDEN_DESK_PAIRS[1][1]).v + 2);
});
test('changed snapshots, occupancy, children, unknown metadata and external references refuse before returning a plan', () => {
  for (const blocker of ['snapshot', 'occupied', 'child', 'metadata', 'external', 'constraint', 'relationship', 'room_slot', 'suffix']) {
    const { m, input } = fixture(); let expected = input(); const desk = m.get(EDEN_DESK_PAIRS[0][0]);
    if (blocker === 'snapshot') expected.snapshotSha256 = '0'.repeat(64);
    if (blocker === 'occupied') expected.audit.uses.find(row => row.id === desk.id).inUse = 'h_soul';
    if (blocker === 'child') m.insert({ id: 'e_child123', def: 'core/cup@1', in: { parent: desk.id, slot: 'top' }, by: 'god', born: 1, v: 1 });
    if (blocker === 'metadata') desk.customBinding = 'unknown';
    if (blocker === 'external') expected.audit.externalReferences.push({ kind: 'ledger', id: desk.id });
    if (blocker === 'constraint') desk.constraints = [{ kind: 'facing', ref: 'other', offset: 0 }];
    if (blocker === 'room_slot') m.get(EDEN_DESK_PAIRS[0][1]).in.slot = 'other-floor';
    if (blocker === 'suffix') m.get(EDEN_DESK_PAIRS[0][1]).constraints = [{ kind: 'facing', ref: desk.id + '/part/computer', offset: 0 }];
    if (blocker === 'relationship') m.state.layers = { relationships: [{ a: desk.id, b: 'world', rel: 'in' }] };
    if (!['snapshot', 'occupied', 'external'].includes(blocker)) expected.snapshotSha256 = repairHash(m.snapshot());
    assert.throws(() => planEdenDeskRepair(m, expected), undefined, blocker);
  }
});

test('a refused trailing operation never applies a partial desk replacement', () => {
  const { m, input } = fixture(), before = structuredClone(m.snapshot());
  const plan = planEdenDeskRepair(m, input());
  const result = applyBatch(m, { ops: [...plan.ops, { op: 'place', def: 'core/does-not-exist@1', name: 'refuse', p: [30, 0] }] }, 'god', 3);
  assert.equal(result.result.accepted, false); assert.deepEqual(m.snapshot(), before);
});

test('an occupied retained office chair is allowed and remains byte-identical while only its unused desk is replaced', () => {
  const { m, input } = fixture(), expected = input(), chair = structuredClone(m.get(EDEN_DESK_PAIRS[0][1]));
  const actualUse = { body: 'h_reader01', soul: 'Reader', how: 'occupied', thing: EDEN_DESK_PAIRS[0][1] };
  expected.audit.uses.find(row => row.id === chair.id).inUse = actualUse;
  const plan = planEdenDeskRepair(m, expected);
  assert.deepEqual(plan.mapping[0].observedChairUse, actualUse, 'real observed claim retained in plan evidence');
  assert.ok(!plan.ops.some(op => op.id === chair.id), 'no ordinary operation touches this chair');
  assert.deepEqual(plan.expect[chair.id], { id: chair.id, v: chair.v });
  const result = applyBatch(m, { ops: plan.ops }, 'god', 3); assert.ok(result.result.accepted, JSON.stringify(result.result));
  assert.deepEqual(m.entities.get(chair.id), chair, 'same exact functional chair identity, pose, state and geometry');
  assert.equal(m.resolvedDef(m.get(EDEN_DESK_PAIRS[0][0]).def).version, 2);
});
