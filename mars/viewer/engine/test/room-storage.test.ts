import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { EngineRoom } from '../../simulation/engine-room.ts';
import { CHUNK_BYTES, utf8Bytes, utf8Chunks } from '../../simulation/storage-bytes.ts';
import { yearBuildSetup } from '../scenarios/year-build.ts';
import { loadCampusFile } from '../campus/history-node.ts';
import { createController, roomScenes, seedHistory } from '../api/index.ts';
import { workloadRefusal, ROOM_MAX_ENTITIES, ROOM_MAX_STEPS } from '../../simulation/workload.ts';
import { minuteBindings, minuteTemplate } from './sequence-fixtures.ts';

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

test('room storage: UTF-8 chunks round-trip surrogate boundaries and three-byte text through SQLite', () => {
  const s = storage();
  const room = new EngineRoom(s.value);
  // Persistence primitive exercised with text larger than one row; JSON world fields use this same path.
  const write = (room as unknown as { write(key: string, text: string): void }).write.bind(room);
  const text = JSON.stringify({ text: 'a'.repeat(CHUNK_BYTES - 10) + '😀' + '界'.repeat(CHUNK_BYTES) + '🚀' });
  s.value.transactionSync(() => write('y2026/test/unicode', text));
  const rows = s.db.prepare('SELECT data, LENGTH(CAST(data AS BLOB)) AS bytes FROM engine_blobs ORDER BY chunk').all() as { data: string; bytes: number }[];
  assert.ok(rows.length > 3);
  assert.ok(rows.every((r) => r.bytes <= CHUNK_BYTES));
  assert.equal(rows.map((r) => r.data).join(''), text);
  assert.equal(room.sizes(2026).test.bytes, utf8Bytes(text));
  assert.deepEqual([...utf8Chunks('abc😀界', 4)], ['abc', '😀', '界']);
  assert.throws(() => [...utf8Chunks('a', 3)], RangeError);
  s.db.close();
});

test('room storage: oversized take refuses in bytes and rolls back checkpoint, states and in-memory take', () => {
  const s = storage();
  const room = new EngineRoom(s.value);
  assert.ok(room.call(2026, 'fork', { from: 'proving-ground', name: 'w' }).ok);
  const bound = room.call(2026, 'bind_plan', { workspace: 'w', template: minuteTemplate, bindings: minuteBindings });
  assert.ok(bound.ok);
  const before = s.dump();
  // Existing seed states are larger than this injected take cap; they are already durable.
  const limited = new EngineRoom(s.value, { blobBytes: 20_000 });
  const out = limited.call(2026, 'execute', { workspace: 'w', plan_id: bound.plan_id });
  assert.equal(out.code, 'room.storage-bytes');
  assert.match(String(out.message), /take\/.*UTF-8 bytes/);
  assert.deepEqual(out._meta.stored, {});
  assert.deepEqual(s.dump(), before);
  assert.deepEqual(limited.call(2026, 'log', { workspace: 'w' }).head, room.call(2026, 'log', { workspace: 'w' }).head);
  assert.ok(room.call(2026, 'rehearse', { plan_id: bound.plan_id }).ok, 'ordinary one-minute run is still admitted');
  s.db.close();
});

test('room storage: aggregate byte cap rolls back writes and survives reload; seeded over-cap room refuses cleanly', () => {
  const s = storage();
  const room = new EngineRoom(s.value);
  room.call(2026, 'list', {});
  const before = s.dump();
  const total = Object.values(room.sizes(2026)).reduce((n, v) => n + v.bytes, 0);
  const limited = new EngineRoom(s.value, { roomBytes: total });
  const out = limited.call(2026, 'fork', { from: 'proving-ground', name: '界😀' });
  // Use valid workspace id; non-ASCII belongs in its label.
  const valid = limited.call(2026, 'fork', { from: 'proving-ground', name: 'w', label: '界😀' });
  assert.equal(out.ok, false);
  assert.equal(valid.code, 'room.storage-bytes');
  assert.deepEqual(s.dump(), before);
  assert.ok(new EngineRoom(s.value).call(2026, 'list', {}).ok);
  const fresh = storage();
  assert.equal(new EngineRoom(fresh.value, { roomBytes: 1 }).call(2026, 'list', {}).code, 'room.storage-bytes');
  assert.deepEqual(fresh.dump(), []);
  s.db.close(); fresh.db.close();
});

test('room workload: real year-build chapter refuses before simulation or persistence, including old stored plans', () => {
  const setup = yearBuildSetup(2022, 'east-house', loadCampusFile(2022), { bays: 1 });
  const s = storage();
  const room = new EngineRoom(s.value);
  room.call(2022, 'list', {});
  // Existing historical history and plan emulate a room saved before admission was added.
  const write = (room as unknown as { write(key: string, text: string): void }).write.bind(room);
  s.value.transactionSync(() => {
    write('y2022/history', JSON.stringify(setup.history.toJSON()));
    write(`y2022/plan/${setup.plan.planHash}`, JSON.stringify({ plan: setup.plan, workspace: setup.workspace }));
  });
  const reloaded = new EngineRoom(s.value);
  reloaded.call(2022, 'list', {}); // migrate inline states before the snapshot
  const before = s.dump();
  for (const op of ['rehearse', 'execute']) {
    const out = reloaded.call(2022, op, { plan_id: setup.plan.planHash, workspace: setup.workspace });
    assert.equal(out.code, 'room.workload-limit', JSON.stringify(out));
    assert.deepEqual(out._meta.stored, {});
    assert.deepEqual(s.dump(), before);
  }
  const bind = reloaded.call(2022, 'bind_plan', { workspace: setup.workspace, template: setup.build.template, bindings: setup.build.bindings });
  assert.equal(bind.code, 'room.workload-limit');
  assert.deepEqual(s.dump(), before);
  console.log(`room year chapter refused: ${setup.plan.steps.length} steps, ${Object.keys(setup.history.read(setup.workspace).entities).length} entities`);
  s.db.close();
});


test('room workload: step and entity admission boundaries and malformed inputs preserve controller validation', () => {
  const ctl = createController({ history: seedHistory(), scenes: roomScenes() });
  ctl.call('fork', { from: 'proving-ground', name: 'w' });
  const step = { id: 's', verb: 'wait', params: { actor: 'n1', seconds: 1 } };
  const template = { schema: 'mars-sequence/1', id: 'bounded', params: {}, steps: Array.from({ length: ROOM_MAX_STEPS }, (_, i) => ({ ...step, id: `s${i}` })) };
  const input = { workspace: 'w', template, bindings: {} };
  assert.equal(workloadRefusal(ctl, 'bind_plan', input), undefined);
  template.steps.push({ ...step, id: 'extra' });
  assert.equal(workloadRefusal(ctl, 'bind_plan', input)?.code, 'room.workload-limit');
  template.steps.length = 1;
  const world = ctl.history.read('w');
  const sample = Object.values(world.entities)[0];
  for (let i = 0; Object.keys(world.entities).length <= ROOM_MAX_ENTITIES; i++) world.entities[`test-${i}`] = { ...sample, id: `test-${i}` };
  ctl.history.commit('w', world, { kind: 'design-edit', note: 'admission fixture, no simulation' });
  assert.equal(workloadRefusal(ctl, 'bind_plan', input)?.code, 'room.workload-limit');
  assert.equal(workloadRefusal(ctl, 'bind_plan', { template: null }), undefined);
  let nested: unknown = {};
  for (let i = 0; i < 100; i++) nested = { nested };
  assert.equal(workloadRefusal(ctl, 'bind_plan', nested), undefined);
});
