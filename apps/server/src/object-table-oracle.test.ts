// L8 oracle: the in-memory object table answers exactly what a fresh parse of edge_comms_objects would, after every
// write path (create, advance, act, remove, re-create, savepoint and raw rollbacks, writes from a second connection).
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Db } from './db.ts';
import { commsFixture } from './edge/comms/testing.ts';
import { tx } from './edge/comms/store.ts';
import { DELTA_KEEP, OBJECT_TABLE_STATS } from './edge/comms/objects/table.ts';
import type { ObjectKind, ObjectRecord } from './edge/comms/objects/types.ts';

type State = { n: number; target: number; at: [number, number] | null };
function fixture(t: TestContext, path = ':memory:') {
  const db = new Db(path);
  const f = commsFixture(['Alice'], {}, { dir: '', db, clock: { now: 1_800_000_000_000 } });
  t.after(() => { f.close(); db.close(); });
  const kind: ObjectKind<State> = {
    kind: 'oracle', description: 'Synthetic timed object', listed: true, roles: [],
    actions: { bump: { label: 'Bump', roles: 'anyone', params: {}, validate: () => null, apply: (s: State) => ({ state: { ...s, n: s.n + 1 } }) } },
    schema: { n: { type: 'integer', visibility: 'public' }, target: { type: 'integer', visibility: 'public' }, at: { type: 'json', visibility: 'public' } },
    initial: (p: Record<string, unknown>) => ({ n: 0, target: Number(p.target ?? 0), at: (p.at as [number, number] | undefined) ?? null }), rolesOf: () => [],
    advance: (s: State) => s.n < s.target ? { state: { ...s, n: s.target } } : null,
  } as unknown as ObjectKind<State>;
  f.runtime.objects.register(kind);
  const add = (id: string, target = 0, at: [number, number] | null = null) => f.runtime.objects.create({ id, kind: 'oracle', name: id, placeId: 'eden-commons', params: { target, ...(at ? { at } : {}) } });
  return { ...f, add, objects: f.runtime.objects };
}
type F = ReturnType<typeof fixture>;
const parsed = (f: F) => (f.db.db.prepare('SELECT body FROM edge_comms_objects WHERE world_id=? ORDER BY id').all(f.host.worldId) as { body: string }[]).map(r => JSON.parse(r.body) as ObjectRecord);
/** L9 Stage B: a replica fed by snapshot + ordered deltas (re-snapshot only when the stream says so). */
const replicas = new WeakMap<object, { gen: number; rows: Map<string, ObjectRecord>; resnaps: number }>();
function replica(f: F) {
  const t = f.objects.objectTable();
  let r = replicas.get(f.db);
  const snap = () => { const s = t.snapshot(); return { gen: s.gen, rows: new Map(s.records.map(o => [o.id, o])), resnaps: (r?.resnaps ?? -1) + 1 }; };
  if (!r) replicas.set(f.db, r = snap());
  const c = t.changes(r.gen);
  if (!c) replicas.set(f.db, r = snap());
  else { for (const d of c.deltas) { assert.equal(d.gen, ++r.gen, 'deltas come in generation order, one per change'); if (d.record) r.rows.set(d.id, d.record); else r.rows.delete(d.id); } assert.equal(r.gen, c.gen); }
  return { rows: [...r.rows.values()].sort((a, b) => a.id < b.id ? -1 : 1), settled: c?.settled ?? true, resnaps: r.resnaps };
}
function same(f: F, why: string) {
  const want = parsed(f);
  const rep = replica(f); if (rep.settled) assert.deepEqual(rep.rows, want, `snapshot + deltas replica after ${why}`);
  assert.deepEqual(f.objects.all(), want, `all() after ${why}`);
  assert.deepEqual(f.objects.ids(), want.map(o => o.id), `ids() after ${why}`);
  assert.deepEqual(f.objects.ofKind('oracle'), want.filter(o => o.kind === 'oracle'), `ofKind() after ${why}`);
  for (const id of ['a', 'b', 'c', 'z']) assert.equal(f.objects.has(id), want.some(o => o.id === id), `has(${id}) after ${why}`);
}

test('memory answers what a fresh parse answers after every write path', t => {
  const f = fixture(t);
  same(f, 'boot');
  f.add('b', 2); f.add('a'); same(f, 'create');
  f.objects.fresh(); same(f, 'fresh() advance');
  f.objects.refresh(['b']); f.objects.sweep(); same(f, 'refresh + sweep');
  for (const _ of f.objects.sweepSteps()) { /* drain */ } same(f, 'sliced sweep');
  const soul = { soulId: f.id('Alice'), entityId: 'x', name: 'Alice', owner: 'dev:Alice' };
  try { f.objects.act('a', soul, { action: 'bump' }); } catch { /* no body in this fixture: refusal is fine */ }
  same(f, 'act');
  f.objects.remove('b'); same(f, 'remove');
  f.add('b', 1); same(f, 're-create');
  assert.equal(f.objects.all().find(o => o.id === 'b')!.version, 3, 're-create continues the version sequence');
  // tracked savepoint rollback inside a transaction that goes on, then commits
  tx(f.db.db, () => {
    f.add('c');
    assert.throws(() => tx(f.db.db, () => { f.objects.remove('a'); f.add('z'); same(f, 'writes inside a savepoint'); throw Error('roll back'); }));
    same(f, 'savepoint rollback (transaction still open)');
  });
  same(f, 'commit');
  // outer tracked rollback
  assert.throws(() => tx(f.db.db, () => { f.objects.remove('c'); f.add('z'); throw Error('roll back'); }));
  same(f, 'outer tx rollback');
  // raw untracked transaction rolled back by raw SQL
  f.db.db.exec('BEGIN IMMEDIATE'); f.objects.remove('a'); f.add('z'); same(f, 'raw transaction'); f.db.db.exec('ROLLBACK');
  same(f, 'raw ROLLBACK');
  f.db.db.exec('BEGIN IMMEDIATE'); f.objects.remove('a'); f.db.db.exec('COMMIT'); same(f, 'raw COMMIT');
  // records are shared and frozen
  const o = f.objects.all()[0];
  assert.throws(() => { (o.state as State).n = 99; }, TypeError);
  assert.throws(() => { (f.objects.all() as ObjectRecord[]).push(o); }, TypeError);
  same(f, 'refused mutation');
});

test('a commit from another connection reloads the table', t => {
  const dir = mkdtempSync(join(tmpdir(), 'l8-oracle-')), f = fixture(t, join(dir, 'w.db'));
  f.add('a'); f.add('b'); same(f, 'create');
  const other = new DatabaseSync(join(dir, 'w.db'));
  const body = JSON.parse((other.prepare('SELECT body FROM edge_comms_objects WHERE id=?').get('b') as { body: string }).body) as ObjectRecord;
  (body.state as State).n = 41;
  other.prepare('UPDATE edge_comms_objects SET body=? WHERE id=?').run(JSON.stringify(body), 'b');
  other.prepare('DELETE FROM edge_comms_objects WHERE id=?').run('a');
  other.close();
  same(f, 'second-connection writes');
  assert.equal((f.objects.all()[0].state as State).n, 41);
});

test('reads are answered from memory: no parse after warm-up, the near filter uses the cell index', t => {
  const f = fixture(t);
  for (let i = 0; i < 200; i++) f.add(`p${String(i).padStart(3, '0')}`, 0, [i * 10, 0]);
  f.objects.all();
  const before = OBJECT_TABLE_STATS.parsed;
  for (let i = 0; i < 50; i++) { f.objects.all(); f.objects.fresh(); f.objects.ofKind('oracle'); f.objects.ids(); }
  assert.equal(OBJECT_TABLE_STATS.parsed, before, 'no row parsed by repeated reads');
  assert.equal(f.objects.all(), f.objects.all(), 'the same frozen snapshot until a write');
  const soul = { soulId: f.id('Alice'), entityId: 'x', name: 'Alice', owner: 'dev:Alice' };
  const all = f.objects.visibleTo(soul), near = f.objects.visibleTo(soul, { at: [500, 0], radius: 30, kinds: new Set(['oracle']) });
  assert.deepEqual(near, all.filter(v => Math.abs((v.public.at as [number, number])[0] - 500) <= 30));
  assert.deepEqual(near.map(v => v.id), ['p047', 'p048', 'p049', 'p050', 'p051', 'p052', 'p053']);
});

test('L9 Stage B: the delta stream is ordered, voided by a reload, bounded, and unsettled inside a transaction', t => {
  const f = fixture(t), tbl = f.objects.objectTable();
  f.add('a', 1); const s0 = tbl.snapshot();
  f.add('b'); f.objects.fresh(); f.objects.remove('b');
  const c = tbl.changes(s0.gen)!;
  assert.deepEqual(c.deltas.map(d => [d.id, d.record ? d.record.version : null]), [['b', 1], ['a', 2], ['b', null]], 'create b, advance a, remove b');
  assert.equal(c.settled, true); assert.deepEqual(tbl.changes(c.gen), { gen: c.gen, deltas: [], settled: true });
  assert.equal(tbl.changes(c.gen + 1), null, 'a generation the table never had');
  f.objects.reload(); assert.equal(tbl.changes(c.gen), null, 'a reload voids older generations: re-snapshot');
  const s1 = tbl.snapshot();
  for (let i = 0; i < DELTA_KEEP * 2 + 5; i++) f.objects.act('a', { soulId: f.id('Alice'), entityId: `h_${f.id('Alice')}`, name: 'Alice', owner: 'dev:Alice' } as never, { action: 'bump' });
  assert.equal(tbl.changes(s1.gen), null, 'more than DELTA_KEEP behind: re-snapshot');
  const s2 = tbl.snapshot();
  tx(f.db.db as never, () => { f.add('c'); assert.equal(tbl.changes(s2.gen)!.settled, false, 'inside an open transaction'); });
  assert.equal(tbl.changes(s2.gen)!.settled, true);
  same(f, 'the delta-stream test');
});

test('L3 seam: generationNear moves only for changes to objects near the point (or unplaced), and on a reload', t => {
  const f = fixture(t), o = f.objects, soul = { soulId: f.id('Alice'), entityId: `h_${f.id('Alice')}`, name: 'Alice', owner: 'dev:Alice' } as never;
  f.add('near', 0, [5, 5]); f.add('far', 0, [500, 500]); f.add('nowhere');
  const g0 = o.generationNear([0, 0], 20), far0 = o.generationNear([500, 500], 10);
  o.act('far', soul, { action: 'bump' });
  assert.equal(o.generationNear([0, 0], 20), g0, 'a far change does not move it');
  assert.ok(o.generationNear([500, 500], 10) > far0, 'it moves where the change was');
  const g1 = o.generationNear([0, 0], 20); o.act('near', soul, { action: 'bump' });
  const g2 = o.generationNear([0, 0], 20); assert.ok(g2 > g1, 'a near change moves it');
  o.act('nowhere', soul, { action: 'bump' });
  const g3 = o.generationNear([0, 0], 20); assert.ok(g3 > g2, 'an unplaced object counts everywhere');
  o.remove('near'); const g4 = o.generationNear([0, 0], 20); assert.ok(g4 > g3, 'a removal moves it');
  assert.equal(o.generationNear([0, 0], 20), g4, 'reads do not move it');
  o.reload(); assert.ok(o.generationNear([0, 0], 20) > g4, 'a reload moves every region');
  assert.ok(o.generationNear([0, 0], 1e6) >= o.generationNear([500, 500], 10), 'a huge radius covers every cell');
});
