import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Db} from './db.ts';
import {AgentInbox, INBOX_CONNECTED_MS} from './inbox.ts';
import {fixture, invite, accept} from '../test/native-owner-fixture.ts';
import {buildApp} from './http.ts';
import {config} from './config.ts';
import {GodMode} from './god/god.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {streamSSE} from 'hono/streaming';

test('one durable latest message: truthful transitions, replacement, isolation, expiry and restart', t => {
  const dir = mkdtempSync(join(tmpdir(), 'sim-inbox-')); t.after(() => rmSync(dir, {recursive: true, force: true}));
  let db = new Db(join(dir, 'fixture.db')), now = 1000, inbox = new AgentInbox(db, 'w1', () => now);
  const a = {scope: 'soul:a', owner: 'alice'}, b = {scope: 'soul:a', owner: 'bob'}, other = new AgentInbox(db, 'w2', () => now);
  assert.deepEqual(inbox.view(a), {connected: false, lastSeenAt: null, latest: null});
  const first = inbox.send(a, 'A private request').latest!;
  assert.throws(() => inbox.send(a, '\u0000'.repeat(1000)), /control characters/);
  assert.equal(first.state, 'sent'); assert.equal(inbox.view(a).connected, false);
  assert.equal(inbox.view(b).latest, null); assert.equal(other.view(a).latest, null);
  assert.throws(() => inbox.acknowledge(a, first.id, 'Premature'), /receive/);
  inbox.touch(a); assert.equal(inbox.view(a).connected, true); assert.equal(inbox.view(a).latest!.state, 'sent');
  now++; assert.equal(inbox.deliver(a).latest!.state, 'delivered');
  assert.throws(() => inbox.acknowledge(a, first.id, 'x'.repeat(141)), /140/);
  assert.throws(() => inbox.acknowledge(a, first.id, 'two\nlines'), /one line/);
  assert.equal(inbox.acknowledge(a, first.id, 'Received; I will check.').latest!.state, 'acknowledged');
  assert.equal(inbox.acknowledge(a, first.id, 'Changed reply').latest!.reply, 'Received; I will check.');
  const second = inbox.send(a, 'Replace the old request').latest!; assert.notEqual(second.id, first.id); assert.equal(second.state, 'sent'); assert.equal(second.reply, undefined);
  assert.throws(() => inbox.acknowledge(a, first.id, undefined), /latest/);
  now += INBOX_CONNECTED_MS + 1; assert.equal(inbox.view(a).connected, false);
  db.close(); db = new Db(join(dir, 'fixture.db')); inbox = new AgentInbox(db, 'w1', () => now); t.after(() => db.close());
  assert.equal(inbox.view(a).latest!.id, second.id); assert.equal(inbox.view(a).latest!.state, 'sent'); assert.equal(inbox.view(a).connected, false);
  assert.equal(db.db.prepare('SELECT COUNT(*) n FROM agent_inbox_v1').get()!.n, 1, 'replacement retains one row without a chat log');
});

test('listen wakes on a new request and cleans up on timeout and abort', async t => {
  const db = new Db(':memory:'); t.after(() => db.close()); const inbox = new AgentInbox(db, 'w'), scope = {scope: 'god', owner: 'alice'};
  const ac = new AbortController(), first = inbox.send(scope, 'First').latest!;
  await inbox.listen(scope, undefined, 25_000, ac.signal);
  let woke = false; const waiting = inbox.listen(scope, first.id, 25_000, ac.signal).then(() => { woke = true; });
  await new Promise(r => setImmediate(r)); assert.equal(woke, false);
  inbox.send(scope, 'Second'); await waiting; assert.equal(woke, true);
  const latest = inbox.view(scope).latest!.id, abort = new AbortController();
  const aborted = inbox.listen(scope, latest, 25_000, abort.signal); abort.abort(); await aborted;
  await inbox.listen(scope, latest, 5, ac.signal);
  assert.equal((inbox as unknown as {waiters: Map<string, unknown>}).waiters.size, 0);
});

test('real owner and paired HTTP flows: absent, browser, command polling, listening, ack, private scope and revocation', async t => {
  const f = fixture(':memory:'); f.brain.quiesce(); t.after(() => { f.host.stop(); f.db.close(); });
  await invite(f, 'alice'); await invite(f, 'bob');
  const a = await accept(f.host, f.souls.create('dev:alice', {name: 'Avery', description: 'Inbox fixture'}));
  const b = await accept(f.host, f.souls.create('dev:bob', {name: 'Briar', description: 'Other owner fixture'}));
  const tokenA = f.souls.pairExchange(f.souls.pairCode(a, 'http://127.0.0.1:5960').code, 'scripted').token;
  const tokenB = f.souls.pairExchange(f.souls.pairCode(b, 'http://127.0.0.1:5960').code, 'scripted').token;
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:alice', tick: () => f.host.engine.world.tick, emit() {}});
  const owner = f.db.user('dev:alice')!, godToken = god.mintFor(owner, 'scripted'), browserToken = god.mintFor(owner, 'browser');
  const app = buildApp({cfg: {...config, port: 5960, worldPath: '/w/eden', publicUrl: 'http://127.0.0.1:5960/w/eden', accountAuthRequired: false, webDir: '/nonexistent-inbox-fixture', marsWebDir: '/nonexistent-inbox-fixture'}, db: f.db, host: f.host, auth: f.auth, brain: f.brain, souls: f.souls, edge: new EdgeLedger(f.host, f.db), god, hub: {clients: new Map(), refreshMe() {}} as never});
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  app.get('/v1/test-inbox-binary', c => c.body(png, 200, {'content-type': 'image/png', etag: 'fixture-original', 'cache-control': 'public, max-age=60'}));
  app.get('/v1/test-inbox-sse', c => streamSSE(c, async stream => { await stream.writeSSE({event: 'fixture', data: 'Original stream data'}); }));
  const req = async (path: string, token?: string, body?: unknown, signal?: AbortSignal) => {
    const r = await app.request(path, {method: body === undefined ? 'GET' : 'POST', headers: {...(token ? {authorization: `Bearer ${token}`} : {}), 'content-type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)}), ...(signal ? {signal} : {})});
    return {status: r.status, headers: r.headers, data: await r.json() as any};
  };
  for (const [path, token, polling] of [
    ['/v1/god/inbox', godToken, '/v1/god/status'],
    [`/v1/edge/owner/${a.id}/inbox`, tokenA, '/v1/edge/observe'],
  ] as const) {
    const agentPath = path.startsWith('/v1/god') ? '/v1/god/inbox' : '/v1/edge/inbox';
    assert.equal((await req(path)).status, 401);
    assert.equal((await req(path, 'dev:bob')).status, 403);
    const sent = await req(path, 'dev:alice', {text: `Private ${agentPath} request`}); assert.equal(sent.status, 200); assert.equal(sent.data.inbox.latest.state, 'sent'); assert.equal(sent.data.inbox.connected, false);
    const id = sent.data.inbox.latest.id;
    await req('/v1/god/status', browserToken);
    const before = await req(path, 'dev:alice'); assert.equal(before.data.inbox.connected, false); assert.equal(before.data.inbox.latest.state, 'sent');
    assert.equal((await req(`${agentPath}/${id}/ack`, token, {reply: 'Too early'})).status, 409);
    // The authenticated refusal itself carries the request, honestly delivering it.
    assert.equal((await req(path, 'dev:alice')).data.inbox.latest.state, 'delivered');
    const poll = await req(polling, token); assert.equal(poll.data.inbox.latest.id, id); assert.equal(poll.data.inbox.latest.state, 'delivered'); assert.equal(poll.headers.get('cache-control'), 'no-store');
    assert.equal((await req(`${agentPath}/${id}/ack`, token, {reply: 'I have it.'})).data.inbox.latest.state, 'acknowledged');
    assert.equal((await req(path, 'dev:alice')).data.inbox.latest.reply, 'I have it.');
    const begun = performance.now(), listening = req(`${agentPath}/listen?after=${id}&timeoutMs=25000`, token);
    await new Promise(r => setImmediate(r)); const next = await req(path, 'dev:alice', {text: 'A new request while listening'});
    const delivery = await listening; assert.equal(delivery.data.inbox.latest.id, next.data.inbox.latest.id); assert.equal(delivery.data.inbox.latest.state, 'delivered'); assert.ok(performance.now() - begun < 10_000);
    assert.equal((await req(`${agentPath}/${id}/ack`, token, {reply: 'Old request'})).status, 404);
    assert.equal((await req(`${agentPath}/${next.data.inbox.latest.id}/ack`, token, {reply: 'Done listening.'})).status, 200);
  }
  const foreign = await req('/v1/edge/observe', tokenB); assert.equal(foreign.data.inbox.latest, null);
  const callsBefore = f.db.brainCalls(100).length, eventsBefore = f.host.seq;
  const command = await req(`/v1/souls/${a.id}/command`, 'dev:alice', {text: 'Owner command uses the same inbox'});
  assert.equal(command.status, 200); assert.equal(command.data.ok, true); assert.equal(command.data.inbox.latest.state, 'sent');
  assert.equal((await req(`/v1/edge/owner/${a.id}/inbox`, 'dev:alice')).data.inbox.latest.id, command.data.inbox.latest.id);
  assert.equal((await req('/v1/edge/observe', tokenA)).data.inbox.latest.text, 'Owner command uses the same inbox');
  assert.equal(f.db.brainCalls(100).length, callsBefore); assert.equal(f.host.seq, eventsBefore, 'delivery does not translate or execute a body command');
  const publicRead = await req('/v1/world/snapshot'); assert.equal(publicRead.data.inbox, undefined);
  assert.equal((await req('/v1/god/inbox/listen?timeoutMs=0', browserToken)).status, 401);
  for (const [path, token, ownerPath, expected] of [
    ['/v1/test-inbox-binary', godToken, '/v1/god/inbox', png],
    ['/v1/test-inbox-sse', tokenA, `/v1/edge/owner/${a.id}/inbox`, new TextEncoder().encode('event: fixture\ndata: Original stream data\n\n')],
  ] as const) {
    const sent = await req(ownerPath, 'dev:alice', {text: 'A private note carried with bytes.'});
    const browser = await app.request(path, {headers: {authorization: `Bearer ${browserToken}`}});
    assert.equal(browser.headers.get('X-Sim-Agent-Inbox'), null); await browser.arrayBuffer();
    assert.equal((await req(ownerPath, 'dev:alice')).data.inbox.latest.state, 'sent', 'browser does not deliver binary or SSE notes');
    const response = await app.request(path, {headers: {authorization: `Bearer ${token}`}});
    const encoded = response.headers.get('X-Sim-Agent-Inbox')!; assert.ok(encoded);
    const delivered = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')).inbox;
    assert.equal(delivered.latest.id, sent.data.inbox.latest.id); assert.equal(delivered.latest.state, 'delivered'); assert.equal(delivered.connected, true);
    assert.equal(response.headers.get('Cache-Control'), 'no-store'); assert.equal(response.headers.get('ETag'), null);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), expected, 'private header leaves original binary/SSE bytes unchanged');
  }
  const largest = await req('/v1/god/inbox', 'dev:alice', {text: '\ufffd'.repeat(1000)});
  await req('/v1/god/status', godToken);
  await req(`/v1/god/inbox/${largest.data.inbox.latest.id}/ack`, godToken, {reply: '\u0000'.repeat(140)});
  const maxHeader = await app.request('/v1/test-inbox-binary', {headers: {authorization: `Bearer ${godToken}`}});
  assert.ok(Buffer.byteLength(maxHeader.headers.get('X-Sim-Agent-Inbox')!) < 8000, 'max UTF16 text plus escaped reply stays under an 8KB header'); await maxHeader.arrayBuffer();
  const privateId = (await req(`/v1/edge/owner/${a.id}/inbox`, 'dev:alice')).data.inbox.latest.id;
  const waiting = req(`/v1/edge/inbox/listen?after=${privateId}&timeoutMs=15`, tokenA);
  await new Promise(r => setImmediate(r)); f.db.setSoulToken(a.id, null);
  const revoked = await waiting; assert.equal(revoked.status, 401); assert.equal(revoked.data.inbox, undefined);
  assert.equal(f.db.paidCost(), 0);
});

test('owner box and edge command need an invited owner (same gate as the central /v1/souls/:id/command)', async t => {
  const f = fixture(':memory:'); f.brain.quiesce(); t.after(() => { f.host.stop(); f.db.close(); });
  await invite(f, 'carol');
  const s = await accept(f.host, f.souls.create('dev:carol', {name: 'Cato', description: 'Invite gate fixture'}));
  const app = buildApp({cfg: {...config, port: 5961, worldPath: '/w/eden', publicUrl: 'http://127.0.0.1:5961/w/eden', accountAuthRequired: false, inviteRequired: true, webDir: '/nonexistent-inbox-fixture', marsWebDir: '/nonexistent-inbox-fixture'}, db: f.db, host: f.host, auth: f.auth, brain: f.brain, souls: f.souls, edge: new EdgeLedger(f.host, f.db), hub: {clients: new Map(), refreshMe() {}} as never});
  const post = (path: string) => app.request(path, {method: 'POST', headers: {authorization: 'Bearer dev:carol', 'content-type': 'application/json'}, body: JSON.stringify({text: 'come home'})});
  assert.equal((await post(`/v1/souls/${s.id}/command`)).status, 200);
  (f.db as unknown as {db: {prepare(q: string): {run(...a: unknown[]): void}}}).db.prepare('UPDATE users SET invited_by = NULL WHERE id = ?').run('dev:carol');
  for (const path of [`/v1/souls/${s.id}/command`, `/v1/edge/owner/${s.id}/inbox`]) {
    const r = await post(path); assert.equal(r.status, 403, path); assert.equal(((await r.json()) as {code?: string; error?: string}).code ?? 'invite-required', 'invite-required');
  }
});
