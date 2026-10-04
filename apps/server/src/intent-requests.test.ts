import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { INTENT_V2 } from '@sim/protocol';
import { Db } from './db.ts';
import { IntentRequests, IntentRequestConflict, IntentRequestUnavailable, IntentRequestLeaseLost, type IntentRequestScope } from './intent-requests.ts';

const source = { kind: 'owner' as const, ownerId: 'owner', principalId: 'owner', channel: 'web' as const };
const request = { contract: INTENT_V2, requestId: 'request-one', op: 'upsert', words: 'PRIVATE_LEDGER_WORDS' };
const refusal = { contract: INTENT_V2, requestId: 'request-one', phase: 'refused', code: 'stale', reason: 'This operation lost its authority.' };
function fixture(t: TestContext, disk = false) {
  let dir: string | undefined;
  if (disk) {
    const root = fileURLToPath(new URL('../../../.e2e/intent-ledger/', import.meta.url)); mkdirSync(root, { recursive: true });
    dir = mkdtempSync(join(root, 'fixture-'));
  }
  const path = dir ? join(dir, 'ledger.db') : ':memory:';
  let db = new Db(path); t.after(() => { db.close(); if (dir) rmSync(dir, { recursive: true, force: true }); });
  for (const worldId of ['eden-fixture', 'mars-fixture']) db.createWorld({ id: worldId, schema: 'fixture', rules_version: 'fixture/1', dt: 0.05, seed: 'fixture' });
  for (const [id, worldId] of [['s_A', 'eden-fixture'], ['s_B', 'eden-fixture'], ['s_C', 'mars-fixture']])
    db.createSoul({ id, worldId, owner: 'owner', entityId: `h_${id}`, name: id, description: 'fixture', native: false });
  db.upsertUser({ id: 'owner', role: 'user', email: null, wallet: null }); db.setInvited('owner', 'fixture');
  const scope: IntentRequestScope = { worldId: 'eden-fixture', soulId: 's_A', source,
    currentAuthority: row => !!db.user('owner')?.invited_by && row.owner === 'owner' };
  return { path, scope, get db() { return db; }, get store() { return new IntentRequests(db); },
    reopen() { db.close(); db = new Db(path); } };
}

test('semantic-default request identity survives real file close/reopen; duplicates have no worker lease', t => {
  const f = fixture(t, true), first = f.store.reserve(f.scope, request); assert.equal(first.created, true);
  const duplicate = f.store.reserve(f.scope, { importance: 0.5, strict: false, ...request });
  assert.equal(duplicate.created, false); assert.equal('lease' in duplicate, false); assert.equal(duplicate.receipt, null);
  f.reopen();
  assert.equal(f.store.reserve(f.scope, request).created, false); assert.equal(f.store.lookup(f.scope, request.requestId)?.receipt, null);
  assert.throws(() => f.store.reserve(f.scope, { ...request, words: 'Different private words' }), IntentRequestConflict);
  assert.throws(() => f.store.reserve(f.scope, { ...request, importance: 0.9 }), IntentRequestConflict);
  assert.throws(() => f.store.reserve(f.scope, { ...request, edit: { intentId: 'purpose', expectedVersion: 1 } }), IntentRequestConflict);
  assert.equal(f.db.countEvents('eden-fixture'), 0, 'pending storage is not an accepted world revision');
  assert.equal(f.db.paidCost(), 0);
});

test('additive reservation migration upgrades old history without rewriting it and is restart-idempotent', t => {
  const f = fixture(t, true);
  f.db.appendEvent('eden-fixture', { seq: 1, tick: 0, kind: 'rules', author: 'fixture', payload: { why: 'a preserved accepted fact' }, at: 1 });
  const before = JSON.stringify({ events: f.db.events('eden-fixture'), soul: f.db.soul('s_A') });
  f.db.db.exec('DROP TABLE intent_requests_v2; DELETE FROM schema_migrations WHERE id=8');
  f.reopen(); assert.deepEqual(f.db.migrated, [8]);
  assert.equal(JSON.stringify({ events: f.db.events('eden-fixture'), soul: f.db.soul('s_A') }), before);
  f.store.reserve(f.scope, request); f.reopen(); assert.deepEqual(f.db.migrated, []);
  assert.equal(f.store.reserve(f.scope, request).created, false);
});

test('reservations are world/Soul/principal scoped; REST/MCP channel aliases retain original audit source', t => {
  const f = fixture(t), owner = f.store.reserve(f.scope, request);
  const viaMcp = f.store.reserve({ ...f.scope, source: { ...source, channel: 'mcp' } }, request);
  assert.equal(viaMcp.created, false); assert.equal(viaMcp.source.channel, 'web');
  for (const scope of [
    { ...f.scope, soulId: 's_B' }, { ...f.scope, soulId: 's_C', worldId: 'mars-fixture' },
    { ...f.scope, source: { ...source, kind: 'owner-agent' as const, principalId: 'generation-one', channel: 'api' as const } },
  ]) { assert.equal(f.store.lookup(scope, request.requestId), null); assert.equal(f.store.reserve(scope, request).created, true); }
  assert.equal(f.store.lookup(f.scope, request.requestId)?.key.principalId, owner.key.principalId);
  assert.throws(() => f.store.reserve({ ...f.scope, worldId: 'mars-fixture' }, request), IntentRequestUnavailable);
});

test('current authority and original owner guard every private retry/lookup; inaccessible and missing lookup are null', t => {
  const f = fixture(t), reserved = f.store.reserve(f.scope, request); assert.ok(reserved.created);
  f.db.db.prepare('UPDATE users SET invited_by=NULL WHERE id=?').run('owner');
  assert.equal(f.store.lookup(f.scope, request.requestId), null); assert.equal(f.store.lookup(f.scope, 'unknown'), null);
  assert.throws(() => f.store.reserve(f.scope, request), IntentRequestUnavailable);
  f.db.setInvited('owner', 'fixture'); f.db.db.prepare('UPDATE souls SET owner=? WHERE id=?').run('new-owner', 's_A');
  const transferred = { ...f.scope, source: { ...source, ownerId: 'new-owner' }, currentAuthority: () => true };
  assert.equal(f.store.lookup(transferred, request.requestId), null); assert.throws(() => f.store.reserve(transferred, request), IntentRequestUnavailable);
  // Trusted worker can durably record why its old request was refused. New
  // ownership never grants the old owner's private words/receipt entitlement.
  f.store.finish(reserved, refusal); assert.equal(f.store.lookup(transferred, request.requestId), null);
});

test('agent revocation/rotation and admin demotion remove old private lookup and retry authority', t => {
  const f = fixture(t);
  f.db.setSoulToken('s_A', 'synthetic-generation-one');
  const agent = { ...f.scope, source: { ...source, kind: 'owner-agent' as const, principalId: 'opaque-generation-one', channel: 'api' as const },
    currentAuthority: (row: import('./db.ts').SoulRow) => row.token_hash === 'synthetic-generation-one' };
  f.store.reserve(agent, request); f.db.setSoulToken('s_A', 'synthetic-generation-two');
  assert.equal(f.store.lookup(agent, request.requestId), null); assert.throws(() => f.store.reserve(agent, request), IntentRequestUnavailable);
  const next = { ...agent, source: { ...agent.source, principalId: 'opaque-generation-two' }, currentAuthority: (row: import('./db.ts').SoulRow) => row.token_hash === 'synthetic-generation-two' };
  assert.equal(f.store.lookup(next, request.requestId), null); assert.equal(f.store.reserve(next, request).created, true);
  f.db.upsertUser({ id: 'operator', role: 'admin', email: null, wallet: null });
  const operator = { ...f.scope, source: { ...source, kind: 'operator' as const, principalId: 'operator' }, currentAuthority: () => f.db.user('operator')?.role === 'admin' };
  f.store.reserve(operator, request); f.db.upsertUser({ id: 'operator', role: 'user', email: null, wallet: null });
  assert.equal(f.store.lookup(operator, request.requestId), null); assert.throws(() => f.store.reserve(operator, request), IntentRequestUnavailable);
});

test('terminal refusal is immutable and durable, lease protected, and never accepted as a received/world-completion fact', t => {
  const f = fixture(t, true), reserved = f.store.reserve(f.scope, request); assert.ok(reserved.created);
  assert.throws(() => f.store.finish({ ...reserved, lease: 'another-worker' }, refusal), IntentRequestLeaseLost);
  assert.throws(() => f.store.finish(reserved, { ...refusal, requestId: 'another-request' }), IntentRequestConflict);
  assert.throws(() => f.store.finish(reserved, { contract: INTENT_V2, requestId: request.requestId, phase: 'received', worldId: 'eden-fixture', soulId: 's_A', seq: 1, tick: 0 }), /not a canonical/);
  assert.deepEqual(f.store.finish(reserved, refusal), refusal);
  assert.deepEqual(f.store.finish(reserved, { ...refusal }), refusal);
  assert.throws(() => f.store.finish(reserved, { ...refusal, reason: 'A different terminal answer' }), IntentRequestConflict);
  f.reopen(); const lookup = f.store.lookup(f.scope, request.requestId); assert.deepEqual(lookup?.receipt, refusal);
  assert.equal(f.store.reserve(f.scope, request).created, false); assert.equal(f.db.countEvents('eden-fixture'), 0);
});

test('understood/withdrawn receipts require scoped semantic consistency AND canonical admission proof; rejected checks roll back', t => {
  const f = fixture(t), reserved = f.store.reserve(f.scope, request); assert.ok(reserved.created);
  const understood = { contract: INTENT_V2, requestId: request.requestId, phase: 'understood', revision: {
    worldId: f.scope.worldId, soulId: f.scope.soulId, intentId: 'purpose-one', version: 1, requestId: request.requestId, source,
    words: request.words, strict: false, importance: 0.5, submitted: { seq: 1, tick: 0 },
    interpretation: { summary: 'A private test interpretation', agenda: [], trigger: { kind: 'none' } },
  } };
  assert.throws(() => f.store.finish(reserved, understood), /canonical acceptance proof/);
  assert.throws(() => f.store.finish(reserved, understood, () => { throw new Error('no accepted canonical fact'); }), /no accepted canonical fact/);
  assert.equal(f.store.lookup(f.scope, request.requestId)?.receipt, null);
  assert.throws(() => f.store.finish(reserved, { ...understood, revision: { ...understood.revision, words: 'Forged' } }, () => true), IntentRequestConflict);
  const withdrawnRequest = { contract: INTENT_V2, requestId: 'withdraw-one', op: 'withdraw', edit: { intentId: 'purpose-one', expectedVersion: 2 } };
  const withdrawal = f.store.reserve(f.scope, withdrawnRequest); assert.ok(withdrawal.created);
  const withdrawn = { contract: INTENT_V2, requestId: 'withdraw-one', phase: 'withdrawn', worldId: f.scope.worldId, soulId: f.scope.soulId, seq: 1, tick: 0, intent: { intentId: 'purpose-one', version: 2 } };
  assert.throws(() => f.store.finish(withdrawal, withdrawn), /canonical acceptance proof/);
  assert.throws(() => f.store.finish(withdrawal, { ...withdrawn, intent: { intentId: 'purpose-one', version: 3 } }, () => true), IntentRequestConflict);
  assert.equal(f.db.countEvents('eden-fixture'), 0, 'this file does not fabricate accepted facts to pass');
});

async function parallelReservations(t: TestContext, conflict: boolean) {
  const f = fixture(t, true), workers: Worker[] = [];
  const scope = { worldId: f.scope.worldId, soulId: f.scope.soulId, source };
  const ready: Promise<void>[] = [], result: Promise<{ created?: boolean; error?: string }>[] = [];
  for (let i = 0; i < 2; i++) {
    const worker = new Worker(new URL('../test/fixtures/intent-request-worker.ts', import.meta.url), { workerData: { path: f.path, scope, request: { ...request, words: conflict && i === 1 ? 'Other private words' : request.words } }, execArgv: [] });
    workers.push(worker); t.after(() => worker.terminate());
    ready.push(new Promise((resolve, reject) => { worker.once('error', reject); worker.on('message', m => { if (m.kind === 'ready') resolve(); }); }));
    result.push(new Promise((resolve, reject) => { worker.once('error', reject); worker.on('message', m => { if (m.kind === 'result') resolve(m); }); }));
  }
  await Promise.all(ready); for (const worker of workers) worker.postMessage('reserve');
  const results = await Promise.all(result);
  assert.equal(results.filter(r => r.created === true).length, 1, 'exactly one concurrent worker receives a lease');
  if (conflict) assert.equal(results.filter(r => r.error === 'IntentRequestConflict').length, 1);
  else assert.equal(results.filter(r => r.created === false).length, 1);
  assert.equal(f.store.reserve(f.scope, f.store.lookup(f.scope, request.requestId)!.request).created, false);
  assert.equal(f.db.countEvents('eden-fixture'), 0); assert.equal(f.db.paidCost(), 0);
}
test('parallel SQLite workers choose one reservation for identical submissions', { timeout: 10000 }, t => parallelReservations(t, false));
test('parallel SQLite workers refuse conflicting reuse without replacing the winner', { timeout: 10000 }, t => parallelReservations(t, true));
