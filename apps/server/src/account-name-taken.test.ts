// Lane SOULSIM-E (real headless Soul agent, eden-2026, 2026-10-21): `create-soul "Wren"` in a world that already had a
// Wren was accepted, the person's approval then failed with name-taken, and the agent sat in `approval wait` for ten
// minutes. A new-Soul request under a taken name is refused when it is made; a reconnect to that Soul is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { tx } from './edge/comms/store.ts';
import { AccountStore, AccountStoreError, type AccountsDb } from './accounts/store.ts';

const input = (name: string, key: string) => ({ agentLabel: 'eden-agent 1.9.6', name, idempotencyKey: 'name-taken-request-' + key, pollSecret: randomBytes(32).toString('base64url') });

test('a new Soul under a name already taken in this world is refused at request time; a reconnect is not', t => {
  const sql = new DatabaseSync(':memory:'); t.after(() => sql.close());
  const db: AccountsDb = { db: sql, tx<T>(fn: () => T): T { return tx(sql, fn, sql.isTransaction ? undefined : { immediate: true }); } };
  const taken = new Set(['wren']);
  const store = new AccountStore(db, 'world-a', { nameTaken: name => taken.has(name.toLowerCase()) });
  assert.throws(() => store.start(input('Wren', '00000001')), (e: unknown) => e instanceof AccountStoreError && e.code === 'name-taken' && /another name/.test(e.message));
  assert.equal(store.start(input('Sorrel', '00000002')).status, 'pending');
  assert.equal(store.startRepairRequest('s_wren', input('Wren', '00000003')).mode, 'repair', 'reconnecting to the Soul that has the name');
  // a retry of a request made before the name was taken is answered with that request, not refused
  const early = input('Fern', '00000004'), first = store.start(early);
  taken.add('fern');
  assert.equal(store.start(early).id, first.id);
  // without the hook (stores built elsewhere) nothing changes
  assert.equal(new AccountStore(db, 'world-b').start(input('Wren', '00000005')).status, 'pending');
});
