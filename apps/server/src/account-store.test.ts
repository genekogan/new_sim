import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { tx, afterCommit } from './edge/comms/store.ts';
import { AccountStore, AccountStoreError, type AccountIdentity, type Allocation, type AllocationInput, type AccountsDb, type LifecycleProjection } from './accounts/store.ts';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const input = { agentLabel: 'Fixture agent', name: 'Fixture Soul', description: 'Synthetic test description', idempotencyKey: 'fixture-request-key-0001' };
function fixture(t: TestContext) {
  const sql = new DatabaseSync(':memory:');
  t.after(() => sql.close());
  let now = 1000;
  const clock = () => now;
  const db: AccountsDb = { db: sql, tx<T>(fn: () => T): T { return tx(sql, fn, sql.isTransaction ? undefined : { immediate: true }); } };
  const owner: AccountIdentity = { id: 'account-owner', issuer: 'fixture-provider', subject: 'fixture-owner', verifiedAt: 100, expiresAt: 100_000, verifiedEmail: 'fixture@example.invalid' };
  const other: AccountIdentity = { ...owner, id: 'account-other', subject: 'fixture-other' };
  const store = new AccountStore(db, 'fixture-world', { now: clock, approvalTtlMs: 500 });
  sql.exec('CREATE TABLE fixture_intents(request_id TEXT PRIMARY KEY, world_id TEXT, account_id TEXT, soul_id TEXT)');
  const allocate = (a: AllocationInput): Allocation => db.tx(() => {
    sql.prepare('INSERT INTO fixture_intents VALUES (?,?,?,?)').run(a.requestId, a.worldId, a.accountId, 's_fixture');
    return { worldId: a.worldId, accountId: a.accountId, requestId: a.requestId, soulId: 's_fixture' };
  });
  return { sql, db, store, owner, other, clock, advance(ms: number) { now += ms; }, allocate };
}
function accepted(t: TestContext) {
  const f = fixture(t), start = f.store.start(input);
  f.store.approve(f.owner, start.id, f.allocate);
  const allocation = f.sql.prepare('SELECT world_id,account_id,request_id,soul_id FROM fixture_intents').get() as { world_id: string; account_id: string; request_id: string; soul_id: string };
  const actual: LifecycleProjection = { worldId: allocation.world_id, accountId: allocation.account_id, requestId: allocation.request_id, soulId: allocation.soul_id, lifecycleState: 'complete', ready: true };
  return { ...f, start, actual };
}
function ready(t: TestContext) {
  const f = accepted(t);
  f.store.reconcile(f.start.id, f.actual);
  const token = f.store.poll(f.start.id, f.start.pollSecret!).token!;
  assert.ok(token);
  return { ...f, token };
}
function error(code: string) { return (e: unknown) => e instanceof AccountStoreError && e.code === code; }
function count(sql: DatabaseSync, table: string): number { return (sql.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n; }

test('pending start binds only selected world, secret appears once, retry cannot change request', t => {
  const { store, sql } = fixture(t), a = store.start(input);
  assert.match(a.id, /^ap_[a-f0-9]{32}$/); assert.match(a.pollSecret!, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(a.status, 'pending'); assert.equal(a.worldId, 'fixture-world'); assert.equal(a.soulId, null);
  assert.deepEqual(store.start(input), store.view(a.id)); assert.equal(store.start(input).pollSecret, undefined);
  assert.throws(() => store.start({ ...input, name: 'Changed Soul' }), error('idempotency-conflict'));
  assert.equal(count(sql, 'account_identities_v1'), 0); assert.equal(count(sql, 'account_soul_memberships_v1'), 0);
  const row = sql.prepare('SELECT * FROM account_approvals_v1').get() as Record<string, unknown>;
  assert.equal(row.account_id, null); assert.equal(row.poll_hash, hash(a.pollSecret!)); assert.notEqual(row.request_nonce, input.idempotencyKey);
  assert.equal(store.allocation(a.id), null);
  const dto = store.view(a.id) as unknown as Record<string, unknown>;
  for (const field of ['accountId', 'account_id', 'subject', 'issuer', 'pollSecret', 'poll_hash', 'request_nonce', 'input_hash', 'token_hash']) assert.equal(field in dto, false);
});

test('world-scoped idempotency, preview and approval reject foreign world IDs', t => {
  const f = fixture(t), a = f.store.start(input), foreign = new AccountStore(f.db, 'elsewhere', { now: f.clock });
  const b = foreign.start(input); assert.notEqual(a.id, b.id); assert.equal(b.worldId, 'elsewhere');
  assert.throws(() => foreign.view(a.id), error('not-found'));
  assert.throws(() => foreign.approve(f.owner, a.id, f.allocate), error('not-found'));
  assert.throws(() => foreign.poll(a.id, a.pollSecret!), error('poll-secret'));
  assert.equal(count(f.sql, 'fixture_intents'), 0);
});

test('caller-held poll secret survives lost start response; wrong or missing retry proof refuses', t => {
  const f = fixture(t), pollSecret = randomBytes(32).toString('base64url'), body = { ...input, pollSecret };
  const lostResponse = f.store.start(body);
  assert.equal(lostResponse.pollSecret, undefined);
  const retry = f.store.start(body); assert.equal(retry.id, lostResponse.id);
  assert.throws(() => f.store.start(input), error('poll-secret'));
  assert.throws(() => f.store.start({ ...body, pollSecret: randomBytes(32).toString('base64url') }), error('poll-secret'));
  assert.throws(() => f.store.start({ ...body, pollSecret: 'short' }), error('invalid'));
  f.store.approve(f.owner, retry.id, f.allocate);
  const request = f.sql.prepare('SELECT request_id FROM fixture_intents').get() as { request_id: string };
  f.store.reconcile(retry.id, { worldId: 'fixture-world', accountId: f.owner.id, soulId: 's_fixture', requestId: request.request_id, lifecycleState: 'complete', ready: true });
  assert.ok(f.store.poll(retry.id, pollSecret).token);
  assert.equal(JSON.stringify(f.sql.prepare('SELECT * FROM account_approvals_v1').all()).includes(pollSecret), false);
});

test('one tracked immediate transaction commits nested intent, association and grant together', t => {
  const f = fixture(t), a = f.store.start(input); let calls = 0, after = false;
  const first = f.store.approve(f.owner, a.id, request => {
    calls++; assert.equal(f.sql.isTransaction, true);
    afterCommit(f.sql, () => { after = true; assert.equal(f.store.view(a.id, f.owner).status, 'creating'); assert.equal(f.store.memberships(f.owner).length, 1); });
    return f.allocate(request);
  });
  assert.equal(after, true); assert.equal(first.status, 'creating'); assert.equal(first.soulId, 's_fixture');
  assert.equal(f.store.poll(a.id, a.pollSecret!).token, undefined);
  assert.equal(count(f.sql, 'fixture_intents'), 1); assert.equal(count(f.sql, 'account_agent_grants_v1'), 1);
  assert.deepEqual(f.store.approve(f.owner, a.id, () => { calls++; throw Error('must not rerun'); }), first);
  assert.equal(calls, 1);
  assert.throws(() => f.store.approve(f.other, a.id, f.allocate), error('forbidden'));
  assert.throws(() => f.store.view(a.id, f.other), error('forbidden')); assert.throws(() => f.store.view(a.id), error('identity'));
});

test('reconstructed store retains approval, membership and accepted request without another allocation', t => {
  const f = accepted(t), reconstructed = new AccountStore(f.db, 'fixture-world', { now: f.clock });
  assert.equal(reconstructed.view(f.start.id, f.owner).status, 'creating');
  assert.deepEqual(reconstructed.allocation(f.start.id), { worldId: f.actual.worldId, accountId: f.actual.accountId, soulId: f.actual.soulId, requestId: f.actual.requestId });
  reconstructed.approve(f.owner, f.start.id, () => { throw Error('duplicate'); });
  assert.equal(count(f.sql, 'fixture_intents'), 1); assert.equal(reconstructed.memberships(f.owner)[0].soulId, 's_fixture');
  assert.deepEqual(reconstructed.memberships(f.other), []);
  reconstructed.reconcile(f.start.id, f.actual);
  const token = reconstructed.poll(f.start.id, f.start.pollSecret!).token!;
  assert.equal(new AccountStore(f.db, 'fixture-world', { now: f.clock }).poll(f.start.id, f.start.pollSecret!).token, token);
});

test('scope mismatch and failed final association roll all allocation writes back', t => {
  const f = fixture(t), a = f.store.start(input); let observed = false;
  assert.throws(() => f.store.approve(f.owner, a.id, r => { const v = f.allocate(r); afterCommit(f.sql, () => { observed = true; }); return { ...v, worldId: 'elsewhere' }; }), error('allocation-conflict'));
  assert.equal(observed, false); assert.equal(count(f.sql, 'fixture_intents'), 0); assert.equal(count(f.sql, 'account_identities_v1'), 0);
  assert.equal(f.store.view(a.id).status, 'pending'); assert.equal(count(f.sql, 'account_agent_grants_v1'), 0);
  f.sql.exec("CREATE TRIGGER fixture_reject_grant BEFORE INSERT ON account_agent_grants_v1 BEGIN SELECT RAISE(ABORT,'fixture grant refusal'); END");
  assert.throws(() => f.store.approve(f.owner, a.id, f.allocate), /fixture grant refusal/);
  assert.equal(count(f.sql, 'fixture_intents'), 0); assert.equal(count(f.sql, 'account_soul_memberships_v1'), 0); assert.equal(f.store.view(a.id).status, 'pending');
  f.sql.exec('DROP TRIGGER fixture_reject_grant');
  assert.equal(f.store.approve(f.owner, a.id, f.allocate).status, 'creating');
});

test('async allocation is rejected before entering it and identity expiry rolls intent back', t => {
  const f = fixture(t), a = f.store.start(input); let ran = false;
  assert.throws(() => f.store.approve(f.owner, a.id, (async () => { ran = true; return {}; }) as unknown as (v: AllocationInput) => Allocation), error('async-callback'));
  assert.equal(ran, false);
  assert.throws(() => f.store.approve(f.owner, a.id, r => { const v = f.allocate(r); f.advance(100_000); return v; }), error('identity'));
  assert.equal(count(f.sql, 'fixture_intents'), 0); assert.equal(count(f.sql, 'account_identities_v1'), 0);
});

test('provider identity conflicts and matching email never merge accounts or Soul rights', t => {
  const f = fixture(t), evidence = { attribution: 'fixture-verified-history', evidenceHash: 'a'.repeat(64) };
  const first = f.store.associate(f.owner, 's_legacy', evidence);
  assert.deepEqual(f.store.associate(f.owner, 's_legacy', evidence), first); assert.deepEqual(f.store.memberships(f.other), []);
  assert.throws(() => f.store.associate(f.other, 's_legacy', evidence), error('membership-conflict'));
  assert.throws(() => f.store.associate(f.owner, 's_legacy', { ...evidence, evidenceHash: 'b'.repeat(64) }), error('membership-conflict'));
  assert.throws(() => f.store.memberships({ ...f.owner, subject: f.other.subject }), error('identity-conflict'));
  assert.throws(() => f.store.memberships({ ...f.other, subject: f.owner.subject }), error('identity-conflict'));
  assert.throws(() => f.store.associate({ verifiedEmail: f.owner.verifiedEmail } as AccountIdentity, 's_other', evidence), error('invalid'));
  const accounts = JSON.stringify(f.sql.prepare('SELECT * FROM account_identities_v1').all());
  assert.equal(accounts.includes(f.owner.verifiedEmail!), false);
});

test('pending expiry is durable while accepted creation survives its original deadline', t => {
  const f = fixture(t), a = f.store.start(input); f.advance(500);
  assert.equal(f.store.approve(f.owner, a.id, () => { throw Error('expired allocation'); }).status, 'expired');
  assert.equal(f.store.poll(a.id, a.pollSecret!).status, 'expired'); assert.equal(f.store.start(input).status, 'expired');
  assert.equal(count(f.sql, 'fixture_intents'), 0); assert.equal(f.store.view(a.id).status, 'expired');
  const g = accepted(t); g.advance(1000);
  assert.equal(g.store.approve(g.owner, g.start.id, () => { throw Error('duplicate'); }).status, 'creating');
  assert.equal(g.store.reconcile(g.start.id, g.actual).status, 'ready'); assert.ok(g.store.poll(g.start.id, g.start.pollSecret!).token);
});

test('pending cancel requires poll credential; account approval cannot silently undo accepted birth', t => {
  const f = fixture(t), a = f.store.start(input);
  assert.throws(() => f.store.cancel(f.other, a.id), error('cancel-authority'));
  assert.throws(() => f.store.cancel(null, a.id, 'x'.repeat(43)), error('poll-secret'));
  assert.equal(f.store.cancel(null, a.id, a.pollSecret!).status, 'cancelled');
  assert.equal(f.store.cancel(null, a.id, a.pollSecret!).status, 'cancelled');
  assert.equal(f.store.approve(f.owner, a.id, () => { throw Error('cancelled allocation'); }).status, 'cancelled');
  const g = ready(t);
  assert.throws(() => g.store.cancel(g.other, g.start.id), error('forbidden'));
  assert.throws(() => g.store.cancel(g.owner, g.start.id), error('cannot-cancel'));
  assert.throws(() => g.store.cancel(null, g.start.id, g.start.pollSecret!), error('cannot-cancel'));
  assert.ok(g.store.resolveGrant(g.token)); assert.equal(count(g.sql, 'fixture_intents'), 1);
});

test('only exact actual complete/body-ready projection permits token release', t => {
  const f = accepted(t);
  for (const patch of [{ worldId: 'elsewhere' }, { accountId: f.other.id }, { soulId: 's_else' }, { requestId: 'lc_else' }, { lifecycleState: 'recorded' as const, ready: true }, { lifecycleState: 'legacy-ready' as const, ready: true }]) assert.throws(() => f.store.reconcile(f.start.id, { ...f.actual, ...patch }), error('projection-conflict'));
  assert.equal(f.store.reconcile(f.start.id, { ...f.actual, lifecycleState: 'recorded', ready: false }).status, 'creating');
  assert.equal(f.store.poll(f.start.id, f.start.pollSecret!).token, undefined);
  assert.equal(f.store.reconcile(f.start.id, { ...f.actual, ready: false }).status, 'creating');
  assert.equal(f.store.reconcile(f.start.id, f.actual).status, 'ready');
  const token = f.store.poll(f.start.id, f.start.pollSecret!).token!; assert.ok(token);
  assert.equal(f.store.reconcile(f.start.id, { ...f.actual, ready: false }).status, 'creating');
  assert.equal(f.store.resolveGrant(token), null); assert.equal(f.store.poll(f.start.id, f.start.pollSecret!).token, undefined);
  f.store.reconcile(f.start.id, f.actual); assert.equal(f.store.poll(f.start.id, f.start.pollSecret!).token, token);
});

test('token derives from raw poll secret plus explicit world/Soul/request/nonce, plaintext is never stored', t => {
  const f = ready(t), g = f.sql.prepare('SELECT * FROM account_agent_grants_v1').get() as { nonce: string; request_id: string; token_hash: string };
  const expected = createHmac('sha256', f.start.pollSecret!).update(JSON.stringify(['eden-account-soul-grant/1', 'fixture-world', 's_fixture', g.request_id, g.nonce])).digest('hex');
  assert.equal(f.token, `sim_s_fixture_${expected}`); assert.equal(g.token_hash, hash(f.token));
  for (const table of ['account_identities_v1', 'account_soul_memberships_v1', 'account_approvals_v1', 'account_agent_grants_v1']) {
    const dump = JSON.stringify(f.sql.prepare(`SELECT * FROM ${table}`).all());
    for (const secret of [f.start.pollSecret!, f.token, input.idempotencyKey, f.owner.verifiedEmail!]) assert.equal(dump.includes(secret), false, `${table} leaked synthetic private value`);
  }
  assert.throws(() => f.store.poll(f.start.id, 'x'.repeat(43)), error('poll-secret'));
  assert.throws(() => f.store.poll('ap_missing', f.start.pollSecret!), error('poll-secret'));
  assert.ok(f.store.resolveGrant(f.token)); assert.equal(f.store.resolveGrant('sim_bad'), null);
});

test('grant resolution and poll fence exact world/Soul/account/request/current association', t => {
  const f = ready(t), foreign = new AccountStore(f.db, 'elsewhere', { now: f.clock });
  assert.equal(foreign.resolveGrant(f.token), null);
  for (const [column, value, original] of [['world_id', 'elsewhere', 'fixture-world'], ['soul_id', 's_else', 's_fixture'], ['account_id', f.other.id, f.owner.id], ['request_id', 'lc_else', f.actual.requestId]]) {
    f.sql.prepare(`UPDATE account_agent_grants_v1 SET ${column}=?`).run(value);
    assert.equal(f.store.resolveGrant(f.token), null); assert.equal(f.store.poll(f.start.id, f.start.pollSecret!).token, undefined);
    f.sql.prepare(`UPDATE account_agent_grants_v1 SET ${column}=?`).run(original);
  }
  f.sql.exec("UPDATE account_soul_memberships_v1 SET current_grant_id='gr_else'");
  assert.equal(f.store.resolveGrant(f.token), null); assert.equal(f.store.poll(f.start.id, f.start.pollSecret!).token, undefined);
});

test('explicit revocation invalidates polling retries; signing out never implicitly revokes', t => {
  const f = ready(t);
  assert.throws(() => f.store.revoke(f.other, 's_fixture'), error('forbidden')); assert.ok(f.store.resolveGrant(f.token));
  f.advance(100_000); // Human session expires, delegated credential remains usable.
  assert.ok(f.store.resolveGrant(f.token)); assert.equal(f.store.poll(f.start.id, f.start.pollSecret!).token, f.token);
  const renewed = { ...f.owner, verifiedAt: f.clock(), expiresAt: f.clock() + 100_000 };
  f.store.revoke(renewed, 's_fixture'); f.store.revoke(renewed, 's_fixture');
  assert.equal(f.store.resolveGrant(f.token), null); assert.equal(f.store.poll(f.start.id, f.start.pollSecret!).token, undefined);
  f.store.approve(renewed, f.start.id, () => { throw Error('duplicate'); });
  assert.equal(f.store.poll(f.start.id, f.start.pollSecret!).token, undefined);
});

test('re-pair rotates current grant only after account approval and cannot revive prior polling secret', t => {
  const f = ready(t), repair = f.store.startRepair(f.owner, 's_fixture', { ...input, idempotencyKey: 'fixture-repair-request-0001' });
  assert.ok(f.store.resolveGrant(f.token)); assert.equal(repair.mode, 'repair'); assert.equal(repair.soulId, 's_fixture');
  assert.throws(() => f.store.startRepair(f.other, 's_fixture', input), error('forbidden'));
  assert.throws(() => f.store.approve(f.other, repair.id, r => ({ ...r, soulId: 's_fixture' })), error('forbidden'));
  let calls = 0;
  f.store.approve(f.owner, repair.id, r => { calls++; assert.equal(r.mode, 'repair'); assert.equal(r.soulId, 's_fixture'); return { ...f.actual }; });
  assert.equal(f.store.resolveGrant(f.token), null); assert.equal(f.store.poll(f.start.id, f.start.pollSecret!).token, undefined);
  assert.equal(f.store.poll(repair.id, repair.pollSecret!).token, undefined);
  f.store.reconcile(repair.id, f.actual); const token = f.store.poll(repair.id, repair.pollSecret!).token!;
  assert.ok(token); assert.notEqual(token, f.token); assert.ok(f.store.resolveGrant(token));
  f.store.approve(f.owner, repair.id, () => { calls++; throw Error('duplicate'); }); assert.equal(calls, 1);
  assert.equal(f.store.poll(f.start.id, f.start.pollSecret!).token, undefined); assert.equal(count(f.sql, 'fixture_intents'), 1);
});

test('legacy repair uses actual body readiness with association handle, never creates a birth intent', t => {
  const f = fixture(t); f.store.associate(f.owner, 's_legacy', { attribution: 'fixture-historical-proof', evidenceHash: 'c'.repeat(64) });
  const start = f.store.startRepair(f.owner, 's_legacy', input); let actual: LifecycleProjection;
  f.store.approve(f.owner, start.id, r => {
    assert.match(r.requestId, /^ar_[a-f0-9]{32}$/);
    actual = { worldId: r.worldId, accountId: r.accountId, requestId: r.requestId, soulId: 's_legacy', lifecycleState: 'legacy-ready', ready: true };
    return actual;
  });
  assert.equal(count(f.sql, 'fixture_intents'), 0); assert.equal(f.store.poll(start.id, start.pollSecret!).token, undefined);
  assert.equal(f.store.reconcile(start.id, actual!).status, 'ready'); assert.ok(f.store.poll(start.id, start.pollSecret!).token);
  assert.equal(f.store.memberships(f.owner)[0].attribution, 'fixture-historical-proof');
});

test('actual refusal remains terminal, records no ready claim and invalidates delegated grants', t => {
  const f = accepted(t), refusal = { ...f.actual, lifecycleState: 'refused' as const, ready: false };
  const refused = f.store.reconcile(f.start.id, refusal); assert.equal(refused.status, 'refused'); assert.equal(refused.reason?.code, 'arrival-unavailable', 'lane PB: the person and the agent learn why');
  assert.equal(f.store.poll(f.start.id, f.start.pollSecret!).token, undefined);
  assert.throws(() => f.store.reconcile(f.start.id, f.actual), error('projection-conflict'));
  assert.equal(f.store.approve(f.owner, f.start.id, () => { throw Error('duplicate'); }).status, 'refused');
  assert.equal(count(f.sql, 'fixture_intents'), 1);
});
