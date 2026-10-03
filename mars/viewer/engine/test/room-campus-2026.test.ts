import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { EngineRoom } from '../../simulation/engine-room.ts';
import { seedHistory, roomScenes, ensureCampusYear, type RoomCampusFile } from '../api/seeds.ts';
import { readCampus2026File } from '../campus/node.ts';
import { loadCampusFile } from '../campus/history-node.ts';
import { loadCampus2026 } from '../campus/world.ts';
import { hashOf } from '../core/hash.ts';

function storage() {
  const db = new DatabaseSync(':memory:');
  const value = {
    sql: { exec(q: string, ...args: (string | number)[]) {
      const st = db.prepare(q);
      const rows = /^\s*SELECT/i.test(q) ? st.all(...args) : (st.run(...args), []);
      return { toArray: () => rows };
    } },
    transactionSync<T>(fn: () => T): T {
      db.exec('BEGIN');
      try { const out = fn(); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
  return { db, value: value as unknown as DurableObjectStorage, dump: () => db.prepare('SELECT * FROM engine_blobs ORDER BY key, chunk').all() };
}
const fileFor = (year: number): RoomCampusFile => year === 2026 ? readCampus2026File() : loadCampusFile(year);
const regionEdit = { op: 'region', id: 'test-only', kind: 'place', polygon: [[0, 0], [1, 0], [1, 1], [0, 1]] };

test('room 2026: canonical matches existing reconstruction, protected, fork editable, no flagship inventory', () => {
  const file = readCampus2026File();
  const expected = loadCampus2026(file, { flagshipInventory: false });
  const seeded = seedHistory(undefined, { year: 2026, file });
  assert.equal(hashOf(seeded.read('mars-2026')), hashOf(expected.world));
  assert.equal(hashOf(roomScenes({ year: 2026, file })['mars-2026']), hashOf(expected.base));
  assert.equal(seeded.workspaces.has('mars-2026-flagship'), false);
  assert.equal(ensureCampusYear(seeded, { year: 2026, file }), false);

  const s = storage();
  const room = new EngineRoom(s.value, {}, fileFor);
  const canonical = room.call(2026, 'query_world', { workspace: 'mars-2026', include: ['regions'] });
  assert.ok(canonical.ok);
  assert.equal(canonical.protected, true);
  assert.equal(canonical.campus, 'mars-2026');
  assert.equal(canonical.entityCount, Object.keys(expected.world.entities).length);
  assert.deepEqual(canonical.regions, Object.values(expected.world.regions));
  assert.equal(room.call(2026, 'edit_world', { workspace: 'mars-2026', note: 'test region edit', edits: [regionEdit] }).code, 'workspace.protected');
  assert.ok(room.call(2026, 'fork', { from: 'mars-2026', name: 'my-campus' }).ok);
  const fork = room.call(2026, 'query_world', { workspace: 'my-campus' });
  assert.equal(fork.protected, false);
  assert.ok(room.call(2026, 'edit_world', { workspace: 'my-campus', note: 'test region edit', edits: [regionEdit] }).ok);
  assert.equal(room.call(2026, 'query_world', { workspace: 'mars-2026' }).checkpoint, canonical.checkpoint);
  assert.notEqual(room.call(2026, 'query_world', { workspace: 'my-campus' }).checkpoint, canonical.checkpoint);
  console.log(JSON.stringify({ campus: canonical.campus, protected: canonical.protected, entityCount: canonical.entityCount, forkProtected: fork.protected, canonicalUnchanged: true }));
  s.db.close();
});

test('room 2026: migration preserves old work and restart is idempotent; historical years stay isolated', () => {
  const s = storage();
  const old = new EngineRoom(s.value);
  assert.ok(old.call(2026, 'fork', { from: 'proving-ground', name: 'existing-work' }).ok);
  const before = old.call(2026, 'query_world', { workspace: 'existing-work' });
  const upgraded = new EngineRoom(s.value, {}, fileFor);
  assert.ok(upgraded.call(2026, 'query_world', { workspace: 'mars-2026' }).ok);
  assert.equal(upgraded.call(2026, 'query_world', { workspace: 'existing-work' }).checkpoint, before.checkpoint);
  const stored = s.dump();
  const again = new EngineRoom(s.value, {}, fileFor);
  assert.ok(again.call(2026, 'query_world', { workspace: 'mars-2026' }).ok);
  assert.deepEqual(s.dump(), stored, 'restarting neither rewrites nor duplicates canonical history');
  const log = again.call(2026, 'log', { workspace: 'mars-2026' });
  assert.equal((log.checkpoints as unknown[]).length, 1);
  for (const year of [2020, 2021, 2022, 2023, 2024, 2025]) {
    const out = again.call(year, 'query_world', {});
    const ids = (out.workspaces as { id: string }[]).map((w) => w.id).sort();
    assert.deepEqual(ids, ['carry-yard', `mars-${year}`, 'proving-ground']);
    assert.equal(again.call(year, 'query_world', { workspace: 'mars-2026' }).ok, false);
  }
  assert.equal(again.call(2026, 'query_world', { workspace: 'mars-2022' }).ok, false);
  s.db.close();
});

test('room 2026: incompatible year/file pairs refuse; omitted loader preserves synthetic-only test setup', () => {
  const file = readCampus2026File();
  assert.throws(() => seedHistory(undefined, { year: 2025, file }), /incompatible scene file/);
  assert.throws(() => roomScenes({ year: 2026, file: loadCampusFile(2025) }), /incompatible scene file/);
  assert.deepEqual([...seedHistory().workspaces.keys()].sort(), ['carry-yard', 'proving-ground']);
});


test('room 2026: legacy workspace id collision refuses without replacing user work', () => {
  const s = storage();
  const old = new EngineRoom(s.value);
  assert.ok(old.call(2026, 'fork', { from: 'proving-ground', name: 'mars-2026' }).ok);
  const before = s.dump();
  const upgraded = new EngineRoom(s.value, {}, fileFor);
  const result = upgraded.call(2026, 'query_world', {});
  assert.equal(result.code, 'room.campus-conflict');
  assert.match(String(result.message), /mars-2026.*existing workspace/);
  assert.deepEqual(s.dump(), before);
  assert.equal(new EngineRoom(s.value).call(2026, 'query_world', { workspace: 'mars-2026' }).protected, false);
  s.db.close();
});
