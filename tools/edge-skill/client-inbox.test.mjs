import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clientListen, clientAck, noticeOwnerInbox, noticeInboxHeader } from './client-inbox.mjs';
import { listen, ack, here } from './eden-agent.mjs';
import { clientHelp } from './client-help.mjs';
import { readClientStream } from './client-stream.mjs';

const latest = (id, state = 'delivered') => ({ id, text: 'Please visit the library.', state, sentAt: 1, deliveredAt: 2 });
const envelope = message => ({ inbox: { connected: true, lastSeenAt: 2, latest: message } });
function context(responses) {
  const calls = [], sleeps = [];
  return { calls, sleeps, call: async (path, options) => { calls.push({ path, options }); return { status: 200, data: responses.shift() }; }, sleep: async ms => sleeps.push(ms) };
}

test('Soul inbox listen keeps long-polling until a newer unacknowledged message then returns without ack', async () => {
  const fresh = envelope(latest('new'));
  const ctx = context([envelope(null), envelope(latest('read', 'acknowledged')), envelope(latest('old')), fresh]);
  assert.deepEqual(await clientListen(['--after', 'old', '--timeout', '5'], ctx), fresh);
  assert.equal(ctx.calls.length, 4);
  assert.ok(ctx.calls.every(c => c.path === '/v1/edge/inbox/listen?timeoutMs=5000&after=old' && c.options.timeoutMs === 15000));
  assert.equal(ctx.sleeps.length, 3);
});

test('Soul inbox --once returns the timeout response for /loop', async () => {
  const ctx = context([envelope(null)]);
  assert.deepEqual(await clientListen(['--once', '--timeout', '0'], ctx), envelope(null));
  assert.equal(ctx.calls.length, 1); assert.equal(ctx.sleeps.length, 0);
});

test('Soul inbox ack preserves the receipt and escapes ids with or without a short reply', async () => {
  const result = envelope(latest('id/part', 'acknowledged')), ctx = context([result, result]);
  assert.deepEqual(await clientAck(['id/part', 'x'.repeat(140)], ctx), result);
  await clientAck(['id/part'], ctx);
  assert.equal(ctx.calls[0].path, '/v1/edge/inbox/id%2Fpart/ack');
  assert.deepEqual(ctx.calls[0].options.body, { reply: 'x'.repeat(140) });
  assert.deepEqual(ctx.calls[1].options.body, {});
});

test('Soul inbox rejects unsupported options and invalid replies before any network call', async () => {
  const ctx = context([]);
  for (const args of [['--bad'], ['--after'], ['--after', '--once'], ['--timeout'], ['--timeout', '56'], ['--timeout', '-1'], ['--timeout', '0'], ['--timeout', 'bad']]) await assert.rejects(clientListen(args, ctx));
  for (const args of [[], [''], ['id', 'x'.repeat(141)], ['id', '🌱'.repeat(71)], ['id', 'reply', 'extra']]) await assert.rejects(clientAck(args, ctx));
  assert.equal(ctx.calls.length, 0);
});

test('Soul inbox fails clearly on unavailable or unauthorized servers', async () => {
  await assert.rejects(clientListen([], { call: async () => ({ status: 200, data: {} }) }), /does not serve the owner inbox/);
  await assert.rejects(clientListen([], { call: async () => ({ status: 401, data: { error: 'revoked' } }) }), /HTTP 401/);
  assert.match(clientHelp('1.9', 'eden-edge/1'), /Owner inbox: listen .*ack <message-id>/);
});

test('Soul CLI dispatch uses its own authenticated inbox and surfaces piggyback delivery without extra calls', async t => {
  const scratch = '<team>/scratch/inbox'; mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(join(scratch, 'soul-cli-')), cwd = process.cwd(), fetcher = globalThis.fetch, error = console.error, calls = [], notices = [];
  process.chdir(dir);
  writeFileSync('.eden-agent.json', JSON.stringify({ world: 'https://inbox.invalid/w/test', soul: 'synthetic-soul', token: 'synthetic-inbox-fixture', mode: 'edge' }));
  console.error = line => notices.push(line);
  const message = latest('notice-from-soul-cli');
  const responses = [envelope(message), envelope({ ...message, state: 'acknowledged' }), { ...envelope(message), soul: { id: 'synthetic-soul' }, doHere: [], exits: [] }];
  globalThis.fetch = async (url, options) => { calls.push({ url, ...options }); return Response.json(responses.shift()); };
  t.after(() => { process.chdir(cwd); globalThis.fetch = fetcher; console.error = error; rmSync(dir, { recursive: true, force: true }); });
  assert.equal((await listen()).inbox.latest.id, message.id);
  assert.equal((await ack(message.id, 'Read.')).inbox.latest.state, 'acknowledged');
  await here();
  assert.equal(calls.length, 3);
  assert.ok(calls.every(c => c.headers.authorization === 'Bearer synthetic-inbox-fixture'));
  assert.match(calls[0].url, /\/v1\/edge\/inbox\/listen\?timeoutMs=25000$/);
  assert.deepEqual(JSON.parse(calls[1].body), { reply: 'Read.' });
  assert.deepEqual(notices, ['OWNER MESSAGE ' + JSON.stringify(message)]);
});

test('Soul inbox header decoding preserves Unicode and ignores malformed or missing headers', t => {
  const error = console.error, notices = [], message = { ...latest('soul-unicode-header'), text: 'The library 🌱 — please.' };
  console.error = line => notices.push(line); t.after(() => { console.error = error; });
  const headers = new Headers({ 'X-Sim-Agent-Inbox': Buffer.from(JSON.stringify(envelope(message))).toString('base64url') });
  assert.equal(noticeInboxHeader(headers), true);
  assert.equal(noticeOwnerInbox(envelope(message)), false);
  for (const value of ['!', 'not-json', 'x'.repeat(16385), Buffer.from([0xff]).toString('base64url'), Buffer.from('{"inbox":{"latest":{"id":"bad"}}}').toString('base64url')]) assert.equal(noticeInboxHeader(new Headers({ 'x-sim-agent-inbox': value })), false);
  assert.equal(noticeInboxHeader(new Headers()), false); assert.equal(noticeInboxHeader(undefined), false);
  assert.deepEqual(notices, ['OWNER MESSAGE ' + JSON.stringify(message)]);
});

test('Soul authenticated SSE surfaces header delivery once and shares dedupe with ordinary JSON', async t => {
  const error = console.error, notices = [], message = latest('soul-stream-header'), events = []; let calls = 0;
  console.error = line => notices.push(line); t.after(() => { console.error = error; });
  const fetcher = async () => { calls++; return new Response('event: hello\ndata: {}\n\n', { headers: { 'content-type': 'text/event-stream', 'X-Sim-Agent-Inbox': Buffer.from(JSON.stringify(envelope(message))).toString('base64url') } }); };
  assert.equal((await readClientStream('https://inbox.invalid', { fetcher, headers: { authorization: 'Bearer synthetic-inbox-fixture' }, onMessage: event => events.push(event) })).status, 200);
  assert.equal(noticeOwnerInbox(envelope(message)), false);
  await readClientStream('https://inbox.invalid', { fetcher, headers: { authorization: 'Bearer synthetic-inbox-fixture' } });
  assert.equal(calls, 2); assert.equal(events[0].event, 'hello');
  assert.deepEqual(notices, ['OWNER MESSAGE ' + JSON.stringify(message)]);
  const publicMessage = latest('soul-public-stream-ignored');
  await readClientStream('https://inbox.invalid', { fetcher: async () => new Response('', { headers: { 'X-Sim-Agent-Inbox': Buffer.from(JSON.stringify(envelope(publicMessage))).toString('base64url') } }) });
  assert.equal(notices.length, 1);
});
