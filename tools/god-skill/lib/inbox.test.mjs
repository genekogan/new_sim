import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listen, ack } from './inbox.mjs';
import { call } from './state.mjs';
import { COMMANDS, checkArgs, parseFlags } from '../cli.mjs';
import { noticeOwnerInbox, noticeInboxHeader } from './inbox-notice.mjs';
import { remoteLook } from './remote-look.mjs';
import { follow } from './mirror.mjs';

const latest = (id, state = 'delivered') => ({ id, text: 'Please make a quiet garden.', state, sentAt: 1, deliveredAt: 2 });
const envelope = message => ({ inbox: { connected: true, lastSeenAt: 2, latest: message } });
function fixture(t, responses) {
  const scratch = '<team>/scratch/inbox';
  mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(join(scratch, 'god-cli-')), cwd = process.cwd(), fetcher = globalThis.fetch, error = console.error, calls = [], notices = [];
  process.chdir(dir);
  writeFileSync('.eden-god.json', JSON.stringify({ world: 'https://inbox.invalid/w/test', token: 'synthetic-inbox-fixture' }));
  console.error = line => notices.push(line);
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...options });
    const response = responses.shift();
    assert.ok(response, 'unexpected extra request');
    return Response.json(response.data ?? response, { status: response.status ?? 200 });
  };
  t.after(() => { process.chdir(cwd); globalThis.fetch = fetcher; console.error = error; rmSync(dir, { recursive: true, force: true }); });
  return { calls, notices };
}

test('god inbox listen waits through empty and unchanged long polls then returns promptly without ack', async t => {
  const next = envelope(latest('new-message'));
  const { calls, notices } = fixture(t, [envelope(null), envelope(latest('previous')), next]);
  const started = Date.now();
  assert.deepEqual(await listen({ after: 'previous', timeout: 0.01 }), next);
  assert.ok(Date.now() - started < 1000);
  assert.equal(calls.length, 3);
  for (const request of calls) {
    assert.equal(request.url, 'https://inbox.invalid/w/test/v1/god/inbox/listen?timeoutMs=10&after=previous');
    assert.equal(request.method, 'GET');
    assert.equal(request.headers.authorization, 'Bearer synthetic-inbox-fixture');
    assert.equal(request.body, undefined);
  }
  assert.deepEqual(notices, []);
});

test('god inbox --once returns an empty or already acknowledged inbox for a bounded loop', async t => {
  fixture(t, [envelope(null), envelope({ ...latest('read', 'acknowledged'), reply: 'Read.' })]);
  assert.equal((await listen({ once: true, timeout: 0 })).inbox.latest, null);
  assert.equal((await COMMANDS.listen([], { once: true })).inbox.latest.state, 'acknowledged');
});

test('god inbox ack escapes ids and sends only the optional 140-character reply', async t => {
  const result = envelope({ ...latest('id/part', 'acknowledged'), reply: 'x'.repeat(140) });
  const { calls } = fixture(t, [result, result]);
  assert.deepEqual(await ack('id/part', 'x'.repeat(140)), result);
  await COMMANDS.ack(['id/part']);
  assert.equal(calls[0].url, 'https://inbox.invalid/w/test/v1/god/inbox/id%2Fpart/ack');
  assert.deepEqual(JSON.parse(calls[0].body), { reply: 'x'.repeat(140) });
  assert.deepEqual(JSON.parse(calls[1].body), {});
});

test('god inbox rejects invalid options and long replies before any request', async t => {
  const { calls } = fixture(t, []);
  for (const flags of [{ timeout: -1 }, { timeout: 56 }, { timeout: 'bad' }, { timeout: true }, { timeout: 0 }, { after: true }]) await assert.rejects(listen(flags));
  await assert.rejects(ack(), /usage: ack/);
  await assert.rejects(ack('id', 'x'.repeat(141)), /at most 140/);
  await assert.rejects(ack('id', '🌱'.repeat(71)), /at most 140/);
  const { flags, rest } = parseFlags(['--once', '--after', 'previous', '--timeout', '25', '--json']);
  checkArgs('listen', flags, rest);
  assert.throws(() => checkArgs('listen', {}, ['extra']), /no words/);
  assert.throws(() => checkArgs('ack', {}, ['id', 'reply', 'extra']), /2 words/);
  assert.equal(calls.length, 0);
});

test('god inbox pending message survives text formatting via one stderr notice and zero extra requests', async t => {
  const message = latest('notice-on-normal-request'), { calls, notices } = fixture(t, [envelope(message), envelope(message), envelope({ ...message, state: 'acknowledged' })]);
  await call('/v1/god/status'); await call('/v1/god/snapshot'); await call('/v1/god/status');
  assert.equal(calls.length, 3);
  assert.deepEqual(notices, ['OWNER MESSAGE ' + JSON.stringify(message)]);
});

test('god inbox fails clearly on unavailable or unauthorized servers instead of spinning', async t => {
  fixture(t, [{ data: {}, status: 200 }, { data: { error: 'revoked' }, status: 401 }]);
  await assert.rejects(listen(), /does not serve the owner inbox/);
  await assert.rejects(listen(), /HTTP 401/);
});

test('god receipt recovery preserves piggyback inbox delivery after a lost edit response', async t => {
  const message = latest('message-on-recovered-edit'), { notices } = fixture(t, []);
  let requests = 0;
  globalThis.fetch = async () => {
    if (++requests === 1) throw new Error('synthetic lost response');
    return Response.json({ result: { accepted: true, seq: 3 }, ...envelope(message) });
  };
  const response = await call('/v1/god/act', { body: { ops: [] } });
  assert.equal(requests, 2);
  assert.equal(response.data.replayed, true);
  assert.deepEqual(response.data.inbox.latest, message);
  assert.deepEqual(notices, ['OWNER MESSAGE ' + JSON.stringify(message)]);
});

test('god inbox header decoding preserves Unicode, ignores malformed input and shares JSON dedupe', t => {
  const { notices } = fixture(t, []), message = { ...latest('god-unicode-header'), text: 'A quiet garden 🌱 — please.' };
  const headers = new Headers({ 'X-Sim-Agent-Inbox': Buffer.from(JSON.stringify(envelope(message))).toString('base64url') });
  assert.equal(noticeInboxHeader(headers), true);
  assert.equal(noticeOwnerInbox(envelope(message)), false);
  for (const value of ['!', 'not-json', 'x'.repeat(16385), Buffer.from([0xff]).toString('base64url'), Buffer.from('{"inbox":{"latest":{"id":"bad"}}}').toString('base64url')]) assert.equal(noticeInboxHeader(new Headers({ 'x-sim-agent-inbox': value })), false);
  assert.equal(noticeInboxHeader(new Headers()), false);
  assert.equal(noticeInboxHeader(undefined), false);
  assert.deepEqual(notices, ['OWNER MESSAGE ' + JSON.stringify(message)]);
});

test('god remote PNG and mirror SSE surface the owner header once across authenticated transports', async t => {
  const message = latest('god-png-and-sse-header'), { notices } = fixture(t, []), calls = [];
  const headers = { 'X-Sim-Agent-Inbox': Buffer.from(JSON.stringify(envelope(message))).toString('base64url') };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...options });
    if (url.endsWith('/look')) return new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { ...headers, 'content-type': 'image/png' } });
    if (url.endsWith('/stream')) return new Response('event: hello\ndata: {}\n\n', { headers: { ...headers, 'content-type': 'text/event-stream' } });
    return Response.json(envelope(message));
  };
  await remoteLook({ worldUrl: 'https://inbox.invalid/w/test', out: join(process.cwd(), 'fixture.png') });
  const events = []; await follow(1, event => events.push(event));
  await call('/v1/god/status');
  assert.equal(calls.length, 3);
  assert.ok(calls.every(c => c.headers.authorization === 'Bearer synthetic-inbox-fixture'));
  assert.equal(events[0].event, 'hello');
  assert.deepEqual(notices, ['OWNER MESSAGE ' + JSON.stringify(message)]);
});
