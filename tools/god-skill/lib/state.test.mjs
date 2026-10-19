import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { call } from './state.mjs';
import { retryDefaults } from './retry.mjs';

retryDefaults.sleep = async () => {};   // P2 backoff waits are real in the CLI, instant here

const json = (data, status = 200) => Response.json(data, { status });
const accepted = { accepted: true, seq: 8, warnings: [], diff: { upserts: 1 } };
function fixture(t, replies) {
  const cwd = process.cwd(), originalFetch = globalThis.fetch, dir = mkdtempSync(join(tmpdir(), 'god-client-offline-')), calls = [];
  process.chdir(dir);
  writeFileSync('.eden-god.json', JSON.stringify({ world: 'https://world.invalid', token: 'fixture-only' }));
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...options });
    assert.ok(replies.length, 'unexpected fetch: the offline mock never contacts a server');
    const reply = replies.shift();
    return typeof reply === 'function' ? reply(url, options) : reply;
  };
  t.after(() => { globalThis.fetch = originalFetch; process.chdir(cwd); rmSync(dir, { recursive: true, force: true }); });
  return calls;
}
const timeout = () => { throw new DOMException('request timed out', 'TimeoutError'); };
const disconnect = () => { throw new TypeError('connection lost'); };
const receipt = (ref) => json({ world: 'fixture', clientRef: ref, payloadHash: 'hash', seq: 8, result: accepted });

test('each act gets a fresh clientRef without changing the caller batch', async (t) => {
  const calls = fixture(t, [json(accepted), json(accepted)]), batch = { clientRef: 'input-is-not-a-new-command', ops: [{ op: 'remove', id: 'thing' }] }, before = structuredClone(batch);
  await call('/v1/god/act', { body: batch });
  await call('/v1/god/act', { body: batch });
  const [one, two] = calls.map((c) => JSON.parse(c.body));
  assert.match(one.clientRef, /^[0-9a-f-]{36}$/);
  assert.notEqual(one.clientRef, two.clientRef);
  assert.notEqual(one.clientRef, batch.clientRef);
  assert.deepEqual(one.ops, batch.ops);
  assert.deepEqual(batch, before);
});

test('a timeout finds the committed receipt without submitting a duplicate', async (t) => {
  const calls = fixture(t, [timeout, (_url, _options) => receipt(JSON.parse(calls[0].body).clientRef)]);
  const result = await call('/v1/god/act', { body: { ops: [{ op: 'remove', id: 'thing' }] } });
  assert.deepEqual(result, { status: 200, data: { ...accepted, replayed: true } });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, `https://world.invalid/v1/god/requests/${JSON.parse(calls[0].body).clientRef}`);
  assert.equal(calls[1].method, 'GET');
  assert.equal(calls[1].body, undefined);
  assert.equal(calls[1].headers.authorization, 'Bearer fixture-only');
});

test('a confirmed missing receipt resends the identical serialized payload once', async (t) => {
  const calls = fixture(t, [disconnect, json({ code: 'not_found' }, 404), json({ ...accepted, replayed: true })]);
  const result = await call('/v1/god/act', { body: { group: 'build', ops: [{ op: 'place', def: 'tree@1', p: [2, 3] }] } });
  assert.equal(result.data.accepted, true);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].body, calls[2].body);
  assert.equal(calls[2].method, 'POST');
});

test('losing the response body also recovers from the receipt', async (t) => {
  const calls = fixture(t, [{ status: 200, text: disconnect }, () => receipt(JSON.parse(calls[0].body).clientRef)]);
  assert.deepEqual(await call('/v1/god/act', { body: { ops: [] } }), { status: 200, data: { ...accepted, replayed: true } });
  assert.equal(calls.length, 2);
});

test('a lost resend response gets one final receipt read', async (t) => {
  const calls = fixture(t, [timeout, json({}, 404), disconnect, () => receipt(JSON.parse(calls[0].body).clientRef)]);
  const result = await call('/v1/god/act', { body: { ops: [] } });
  assert.equal(result.data.seq, 8);
  assert.equal(calls.length, 4);
  assert.equal(calls[0].body, calls[2].body);
});

test('an unavailable lookup never authorizes a resend', async (t) => {
  // P2: the receipt lookup is a GET, so a lost connection is retried (four times) before it counts as unavailable
  const calls = fixture(t, [timeout, disconnect, disconnect, disconnect, disconnect, disconnect]);
  const result = await call('/v1/god/act', { body: { ops: [] } });
  assert.equal(calls.length, 6); assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
  assert.equal(result.status, 0);
  assert.equal(result.data.code, 'slow');
  assert.equal(result.data.clientRef, JSON.parse(calls[0].body).clientRef);
  assert.match(result.data.message, new RegExp(`request ${result.data.clientRef}`));
  assert.doesNotMatch(result.data.message, /history 3/);
});

test('a non-404 or malformed receipt response never triggers a resend', async (t) => {
  const calls = fixture(t, [disconnect, json({ message: 'unavailable' }, 503), disconnect, json({ seq: 8 })]);
  for (let i = 0; i < 2; i++) assert.equal((await call('/v1/god/act', { body: { ops: [] } })).status, 0);
  assert.equal(calls.length, 4);
  assert.equal(calls.filter((c) => c.method === 'POST').length, 2);
});

test('repeated transport failure stops after one resend and reports the ref', async (t) => {
  const calls = fixture(t, [timeout, json({}, 404), timeout, json({}, 404)]);
  const result = await call('/v1/god/act', { body: { ops: [] } });
  assert.equal(calls.length, 4);
  assert.equal(calls.filter((c) => c.method === 'POST').length, 2);
  assert.equal(result.status, 0);
  assert.match(result.data.message, /outcome is unresolved/);
  assert.equal(result.data.clientRef, JSON.parse(calls[0].body).clientRef);
});

test('typed refusals and HTTP errors are returned without transport retry', async (t) => {
  const refused = { accepted: false, failures: [{ op: 0, code: 'request.conflict', detail: 'original seq 7' }] };
  const calls = fixture(t, [json(refused), json({ code: 'internal' }, 500)]);
  assert.deepEqual((await call('/v1/god/act', { body: { ops: [] } })).data, refused);
  assert.equal((await call('/v1/god/act', { body: { ops: [] } })).status, 500);
  assert.equal(calls.length, 2);
});

test('reads, query, dryrun and preview stay single requests without edit refs', async (t) => {
  // P2: a read that loses its connection is retried four times, then reported
  const calls = fixture(t, [json({}), json({}), json({}), json({}), disconnect, disconnect, disconnect, disconnect, disconnect]);
  await call('/v1/god/status');
  for (const path of ['/v1/god/query', '/v1/god/dryrun', '/v1/god/preview']) await call(path, { body: { ops: [] } });
  assert.equal((await call('/v1/god/status')).status, 0);
  assert.equal(calls.length, 9); assert.equal(calls.filter((c) => c.method === 'POST').length, 3);
  for (const c of calls) assert.equal(c.body ? JSON.parse(c.body).clientRef : undefined, undefined);
});

test('other write endpoints carry fresh refs but are never automatically repeated', async (t) => {
  const paths = ['/env', '/land', '/strike', '/undo?group=build', '/redo', '/answer'];
  const calls = fixture(t, paths.map(() => disconnect));
  for (const path of paths) {
    const result = await call('/v1/god' + path, { method: 'POST', ...(path.startsWith('/undo') || path === '/redo' ? {} : { body: { value: 1 } }) });
    assert.equal(result.status, 0);
    assert.match(result.data.message, /no receipt recovery/);
    assert.ok(result.data.clientRef);
  }
  assert.equal(calls.length, paths.length);
  assert.equal(new Set(calls.map((c) => JSON.parse(c.body).clientRef)).size, paths.length);
});
