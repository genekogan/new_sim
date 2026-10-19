// G2 C: the server walks the CLI's candidates with the CLI's own rules and notes, then commits once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../db.ts';
import { GodMode } from './god.ts';
import { actWithRepair, parseRepair, type RepairIn } from './repair.ts';
import { libraryHash } from './mirror.ts';

function fixture(t: { after(fn: () => void): void }) {
  const db = new Db(':memory:'); t.after(() => db.close());
  return new GodMode(db, { worldId: 'repair-test', ownerId: 'dev:owner', tick: () => 0, emit: () => {} });
}
const barrel = (name: string, p: [number, number], mode = 'strict') => ({ op: 'place', def: 'core/barrel@1', mode, p, name });
const rep = (god: GodMode, candidates: Record<string, unknown>[], extra: Partial<RepairIn> = {}): RepairIn => ({ candidates, taken: candidates.map((c) => [`world/${c.name}`]), kind: 'place', dry: {}, ifSeq: god.model.editSeq, ...extra });

test('repair: next candidate, then the server suggestion, then a nudge, with the CLI notes word for word', (t) => {
  const god = fixture(t);
  assert.equal(god.act({ ops: [barrel('a', [0, 0]), barrel('b', [3, 0])] }).accepted, true);
  // candidate 0 and 1 blocked, 2 free
  const r = actWithRepair(god, { ops: [] }, rep(god, [barrel('x', [0, 0]), barrel('x-2', [3, 0]), barrel('x-3', [9, 0])]));
  assert.equal(r.accepted, true);
  assert.equal(r.repair.choice, 2); assert.deepEqual(r.repair.op, barrel('x-3', [9, 0]));
  assert.deepEqual(r.repair.fixes, ['blocked (overlaps a) → next candidate', 'blocked (overlaps b) → next candidate']);
  // the only candidate blocked: the server's suggestion
  const s = actWithRepair(god, { ops: [] }, rep(god, [barrel('y', [0, 0])]));
  assert.equal(s.accepted, true); assert.equal(s.repair.choice, 0);
  assert.match(s.repair.fixes[0], /^blocked \(overlaps a\) → the server's suggestion \[-?[\d.]+,-?[\d.]+\]$/);
  assert.equal((s.repair.op as { _suggested?: boolean })._suggested, undefined, 'the CLI-internal marker never reaches the commit');
});

test('repair: name.taken renames as the CLI did; a refusal comes back unchanged with the notes', (t) => {
  const god = fixture(t);
  assert.equal(god.act({ ops: [barrel('dup', [0, 0])] }).accepted, true);
  const r = actWithRepair(god, { ops: [] }, rep(god, [barrel('dup', [20, 0])], { taken: [['world/dup-2']] }));
  assert.equal(r.accepted, true); assert.equal((r.repair.op as { name: string }).name, 'dup-3');
  // outside the world: refused by the dryrun, nothing committed
  const seq = god.model.editSeq;
  const no = actWithRepair(god, { ops: [] }, rep(god, [barrel('far', [100000, 0])]));
  assert.equal(no.accepted, false); assert.equal(no.repair.stage, 'dryrun'); assert.equal(no.failures[0].code, 'extent.outside');
  assert.equal(god.model.editSeq, seq);
});

test('repair: a different seq or library is stale and changes nothing; a committed request leaves its notes in the receipt', (t) => {
  const god = fixture(t);
  const seq = god.model.editSeq;
  assert.deepEqual(actWithRepair(god, { ops: [] }, rep(god, [barrel('a', [0, 0])], { ifSeq: seq + 1 })).repair, { stage: 'stale', seq });
  assert.equal(actWithRepair(god, { ops: [] }, rep(god, [barrel('a', [0, 0])], { ifLib: 'other' })).repair.stage, 'stale');
  assert.equal(god.model.editSeq, seq);
  const ok = actWithRepair(god, { ops: [], clientRef: 'g2-repair-1' }, rep(god, [barrel('a', [0, 0])], { ifLib: libraryHash(god) }));
  assert.equal(ok.accepted, true);
  assert.equal((god.store.receipt('g2-repair-1')!.result as { repair?: { stage: string } }).repair?.stage, 'act');
});

test('repair: malformed input is refused before any work', () => {
  assert.equal(parseRepair(null), null);
  assert.equal(parseRepair({ candidates: [], taken: [], kind: 'place', dry: {}, ifSeq: 0 }), null);
  assert.equal(parseRepair({ candidates: [{}], taken: [], kind: 'place', dry: {}, ifSeq: 0 }), null);
  assert.equal(parseRepair({ candidates: [{}], taken: [[]], kind: 'remove', dry: {}, ifSeq: 0 }), null);
  assert.ok(parseRepair({ candidates: [{}], taken: [[]], kind: 'move', dry: {}, ifSeq: 0 }));
});
