import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clientListen, clientAck, clientResult, noticeOwnerInbox, noticeInboxHeader, listenNext } from './client-inbox.mjs';
import { listen, ack, here } from './eden-agent.mjs';
import { clientHelp } from './client-help.mjs';
import { readClientStream } from './client-stream.mjs';
import { tmpdir } from 'node:os';

const latest = (id, state = 'delivered') => ({ id, text: 'Please visit the library.', state, sentAt: 1, deliveredAt: 2 });
const envelope = message => ({ inbox: { connected: true, lastSeenAt: 2, latest: message } });
function context(responses) {
  const calls = [], sleeps = [];
  return { calls, sleeps, call: async (path, options) => { calls.push({ path, options }); return { status: 200, data: responses.shift() }; }, sleep: async ms => sleeps.push(ms) };
}

test('Soul inbox listen keeps long-polling until a newer unacknowledged message then returns without ack', async () => {
  const fresh = envelope(latest('new'));
  const ctx = context([envelope(null), envelope(latest('read', 'acknowledged')), envelope(latest('old')), fresh]);
  ctx.now = () => Date.UTC(2026, 9, 20, 23, 0, 0);
  assert.deepEqual(await clientListen(['--after', 'old', '--timeout', '5'], ctx), { messages: [{ id: 'new', text: 'Please visit the library.', sentAt: 1, emittedAt: '2026-10-20T23:00:00.000Z' }], waiting: 1, next: listenNext('new') });
  assert.equal(ctx.calls.length, 4);
  assert.ok(ctx.calls.every(c => c.path === '/v1/edge/inbox/listen?timeoutMs=5000&after=old' && c.options.timeoutMs === 15000));
  assert.equal(ctx.sleeps.length, 3);
});

test('Soul inbox listen (1.9.5) blocks with no time limit, rides out outages, then prints the whole backlog oldest first and nothing secret', async () => {
  const backlog = ['go find the horses', 'hello?', 'can you ride the horse?'].map((text, i) => ({ id: `m${i}`, text, state: i ? 'sent' : 'delivered', sentAt: 10 + i, deliveredAt: 20 }));
  const answers = [{ status: 0, data: { error: { code: 'unreachable' } } }, { status: 502, data: { raw: '<html>' } }, { status: 429, data: {} }, { status: 200, data: { ...envelope(null), backlog: [] } }, { status: 200, data: { inbox: { connected: true, latest: backlog[0], presence: 'listening', lastSeenAt: 5 }, backlog } }];
  const calls = [], sleeps = [];
  const out = await clientListen([], { call: async (path, options) => { calls.push([path, options.timeoutMs]); return answers.shift(); }, sleep: async ms => sleeps.push(ms), now: () => 0 });
  assert.deepEqual(out.messages.map(m => m.text), ['go find the horses', 'hello?', 'can you ride the horse?']);
  assert.deepEqual(Object.keys(out), ['messages', 'waiting', 'next']); assert.deepEqual(Object.keys(out.messages[0]), ['id', 'text', 'sentAt', 'emittedAt']);
  assert.equal(out.waiting, 3); assert.match(out.next, /Ack them all now.*ack <id>.*listen --after \S+ again right away, before the work.*result <id>/); assert.ok(out.next.includes(`--after ${out.messages.at(-1).id} `));
  assert.deepEqual(sleeps, [1000, 2000, 4000, 50], 'outages back off; an empty answer re-polls at once');
  assert.ok(calls.every(([path, ms]) => path === '/v1/edge/inbox/listen?timeoutMs=50000' && ms === 60000), 'default: 50 s long-polls, no cursor');
  await assert.rejects(clientListen([], { call: async () => ({ status: 401, data: { error: 'revoked' } }), sleep: async () => {} }), /HTTP 401/, 'a revoked credential is final');
});

test('Soul inbox listen (1.9.5) treats a connection dropped mid-answer as an outage, never as the end of listening', async () => {
  const message = { id: 'm1', text: 'are you still there?', state: 'sent', sentAt: 1 };
  const answers = [() => { throw new TypeError('terminated'); }, () => { throw new Error('other side closed'); }, () => ({ status: 200, data: { ...envelope(message), backlog: [message] } })];
  const sleeps = [];
  const out = await clientListen([], { call: async () => answers.shift()(), sleep: async ms => sleeps.push(ms), now: () => 0 });
  assert.deepEqual(out.messages.map(m => m.text), ['are you still there?']);
  assert.deepEqual(sleeps, [1000, 2000]);
});

test('Soul inbox result: the second answer (done|failed), validated before the network', async () => {
  const done = envelope({ ...latest('m/1', 'acknowledged'), outcome: 'done', result: 'Arrived.' }), ctx = context([done]);
  assert.deepEqual(await clientResult(['m/1', 'done', 'Arrived.'], ctx), done);
  assert.equal(ctx.calls[0].path, '/v1/edge/inbox/m%2F1/result'); assert.deepEqual(ctx.calls[0].options.body, { text: 'Arrived.', outcome: 'done' });
  for (const args of [[], ['m'], ['m', 'ok', 'x'], ['m', 'done'], ['m', 'done', ''], ['m', 'done', 'x'.repeat(141)], ['m', 'failed', 'a\nb'], ['m', 'done', 'x', 'y']]) await assert.rejects(clientResult(args, ctx));
  assert.equal(ctx.calls.length, 1);
  await assert.rejects(clientResult(['m', 'done', 'x'], { call: async () => ({ status: 404, data: { raw: 'Not Found' } }) }), /put the outcome in the ack reply/);
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
  const scratch = tmpdir(); mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(join(scratch, 'soul-cli-')), cwd = process.cwd(), fetcher = globalThis.fetch, error = console.error, calls = [], notices = [];
  process.chdir(dir);
  writeFileSync('.eden-agent.json', JSON.stringify({ world: 'https://inbox.invalid/w/test', soul: 'synthetic-soul', token: 'synthetic-inbox-fixture', mode: 'edge' }));
  console.error = line => notices.push(line);
  const message = latest('notice-from-soul-cli');
  const responses = [envelope(message), envelope({ ...message, state: 'acknowledged' }), { ...envelope(message), soul: { id: 'synthetic-soul' }, doHere: [], exits: [] }];
  globalThis.fetch = async (url, options) => { calls.push({ url, ...options }); return Response.json(responses.shift()); };
  t.after(() => { process.chdir(cwd); globalThis.fetch = fetcher; console.error = error; rmSync(dir, { recursive: true, force: true }); });
  assert.equal((await listen()).messages[0].id, message.id);
  assert.equal((await ack(message.id, 'Read.')).inbox.latest.state, 'acknowledged');
  await here();
  assert.equal(calls.length, 3);
  assert.ok(calls.every(c => c.headers.authorization === 'Bearer synthetic-inbox-fixture'));
  assert.match(calls[0].url, /\/v1\/edge\/inbox\/listen\?timeoutMs=50000$/);
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

test('Soul inbox --follow streams one compact line per new message and backs off on outages', async () => {
  const answers = [envelope(latest('a')), null, envelope(latest('a')), envelope(latest('b'))];
  const calls = [], lines = [], sleeps = [];
  const call = async path => { calls.push(path); const data = answers.shift(); return data ? { status: 200, data } : { status: 0, data: { error: { code: 'unreachable' } } }; };
  await clientListen(['--follow', '--timeout', '5'], { call, sleep: async ms => sleeps.push(ms), write: line => lines.push(JSON.parse(line)), stop: () => !answers.length });
  assert.deepEqual(lines.map(l => l.id), ['a', 'b']); assert.ok(lines.every(l => typeof l.emittedAt === 'string'));
  assert.deepEqual(calls, ['/v1/edge/inbox/listen?timeoutMs=5000', '/v1/edge/inbox/listen?timeoutMs=5000&after=a', '/v1/edge/inbox/listen?timeoutMs=5000&after=a', '/v1/edge/inbox/listen?timeoutMs=5000&after=a']);
  assert.ok(sleeps.includes(1000));
  await assert.rejects(clientListen(['--follow', '--once'], { call }), /not both/);
});

test('Soul inbox --follow on a 1.9.5 world prints every message of a backlog, in order, once', async () => {
  const m = (id, state = 'delivered') => ({ id, text: id, state, sentAt: 1 });
  const answers = [{ inbox: { latest: m('a') }, backlog: [m('a'), m('b'), m('c')] }, { inbox: { latest: m('d') }, backlog: [m('d')] }];
  const calls = [], lines = [];
  await clientListen(['--follow'], { call: async path => { calls.push(path); return { status: 200, data: answers.shift() }; }, sleep: async () => {}, write: l => lines.push(JSON.parse(l).id), stop: () => !answers.length });
  assert.deepEqual(lines, ['a', 'b', 'c', 'd']); assert.equal(calls[1], '/v1/edge/inbox/listen?timeoutMs=50000&after=c');
});

test('LISTEN-LEAK: a superseded listen prints one line and ends (exit 0), never reconnecting; --follow too', async () => {
  const { SUPERSEDED } = await import('./client-inbox.mjs');
  for (const args of [[], ['--follow']]) {
    const calls = [];
    const out = await clientListen(args, { call: async path => { calls.push(path); return { status: 409, data: { ok: false, code: 'superseded', message: 'superseded by a newer listen' } }; }, sleep: async () => { throw new Error('no retry after superseded'); }, write: () => {} });
    assert.equal(out, SUPERSEDED); assert.equal(calls.length, 1, 'one poll, no reconnect'); assert.ok(!/\n/.test(JSON.stringify(out)), 'one line');
  }
  // an older world's 409 for something else stays an error
  await assert.rejects(clientListen([], { call: async () => ({ status: 409, data: { code: 'conflict' } }), sleep: async () => {} }), /HTTP 409/);
});

test('LISTEN-LEAK: a second listen in the same folder supersedes the first, also while the first backs off from an outage', async () => {
  const { folderListenClaim, SUPERSEDED } = await import('./client-inbox.mjs');
  const scratch = tmpdir(); mkdirSync(scratch, { recursive: true });
  const file = join(mkdtempSync(join(scratch, 'listen-claim-')), '.eden-listen');
  let second, sleeps = 0;
  const first = clientListen([], { claim: () => folderListenClaim(file), call: async () => ({ status: 502, data: {} }),
    sleep: async () => { if (++sleeps === 2) second = clientListen([], { claim: () => folderListenClaim(file), call: async () => ({ status: 200, data: { ...envelope(null), backlog: [latest('m1')] } }), sleep: async () => {} }); } });
  assert.equal(await first, SUPERSEDED, 'the older one ends within a second of the newer one starting');
  assert.equal(sleeps, 2); assert.deepEqual((await second).messages.map(m => m.id), ['m1'], 'the newer one is the listener');
  // --once is a peek: it claims nothing
  let peeks = 0; await clientListen(['--once'], { claim: () => { peeks++; return () => true; }, call: async () => ({ status: 200, data: envelope(null) }) });
  assert.equal(peeks, 0);
});
