import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creationPolicy, checkAccountCreation } from './creation-policy.mjs';
const now = 100 * 3600_000, policy = creationPolicy();
const check = (age, times, p = policy) => checkAccountCreation(p, { now, createdAt: now - age * 3600_000, worlds: times.map(t => ({ createdAt: now - t * 60_000 })) });

test('mature account cap includes old and sleeping registered worlds; existing over-cap worlds remain untouched', () => {
  assert.equal(check(24, [1, 2, 3, 4]), null);
  const blocked = check(24, [1, 2, 3, 4, 5]);
  assert.equal(blocked.status, 409); assert.equal(blocked.code, 'account-world-limit');
  assert.match(blocked.message, /existing worlds are still available/);
  assert.equal(check(100, [1, 2, 3, 4, 5, 6]).limit, 5);
});

test('new accounts get a smaller total cap plus a precise rolling creation window', () => {
  assert.equal(check(0, []), null);
  const blocked = check(0, [1]);
  assert.equal(blocked.status, 429); assert.equal(blocked.retry_after, 59 * 60);
  assert.equal(check(1, [60]), null, 'window opens at exactly its boundary');
  assert.equal(check(2, [61, 120]).status, 409, 'young cap still applies after velocity window');
  assert.equal(check(24, [1]), null, 'mature at exactly age boundary');
  assert.equal(checkAccountCreation(policy, { now, worlds: [{ createdAt: now }], createdAt: undefined }).status, 429);
  assert.equal(checkAccountCreation(policy, { now, worlds: [{ createdAt: now }], createdAt: now + 1 }).status, 429);
});

test('policy is configurable and rejects invalid limits instead of disabling protection', () => {
  const p = creationPolicy({ maxWorldsPerAccount: 1, newAccountWorldLimit: 10, newAccountCreateLimit: 3, newAccountHours: 1, newAccountWindowMinutes: 10 });
  assert.equal(check(0, [100], p).limit, 1);
  for (const key of Object.keys(p)) for (const value of [0, -1, NaN, Infinity, 1.5]) assert.throws(() => creationPolicy({ [key]: value }), /positive integer/);
});
