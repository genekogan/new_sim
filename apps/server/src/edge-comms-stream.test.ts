// C5: per-Soul event stream, wait long-poll, say routing, ledger feeds, retention, webhooks.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EDGE_CONTRACT} from './edge/contract.ts';
import {COMMONS, commsFixture, place} from './edge/comms/testing.ts';
import {signature} from './edge/comms/webhook.ts';

const HOUSE = place('house-1', 'building');

test('every response carries the contract; bad tokens are 401 with the error shape', async () => {
  const f = commsFixture(['Alice']);
  try {
    const res = await f.app.request('/v1/edge/say', {method: 'POST', headers: {authorization: 'Bearer nope', 'content-type': 'application/json'}, body: '{"text":"hi"}'});
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), {contract: EDGE_CONTRACT, error: {code: 'unauthorized', message: 'unknown soul token'}});
    const bad = await f.post('Alice', '/v1/edge/say', {text: '   '});
    assert.equal(bad.status, 400); assert.equal(bad.body.contract, EDGE_CONTRACT); assert.equal(bad.body.error.code, 'invalid');
    assert.equal((await f.post('Alice', '/v1/edge/say', {text: 'x'.repeat(501)})).status, 400);
    assert.equal((await f.req('Alice', 'POST', '/v1/edge/say')).status, 400);
  } finally { f.destroy(); }
});

test('outdoor say reaches only Souls within the 12 m earshot; the speaker is not echoed', async () => {
  const f = commsFixture(['Alice', 'Bob', 'Cleo', 'Dan']);
  try {
    f.at('Alice', 0, 0); f.at('Bob', 10, 0); f.at('Cleo', 15, 0); f.at('Dan', 3, 0, [HOUSE, COMMONS], 'house-1');
    const said = await f.post('Alice', '/v1/edge/say', {text: 'hello pond'});
    assert.equal(said.status, 200);
    assert.equal(said.body.contract, EDGE_CONTRACT);
    assert.deepEqual(said.body.said.channel, {kind: 'earshot', placeId: 'eden-commons', radius: 12});
    assert.equal(said.body.said.heardBy, 1);
    const bob = await f.drain('Bob');
    const speech = bob.events.filter((e: any) => e.kind === 'speech');
    assert.equal(speech.length, 1);
    assert.deepEqual({from: speech[0].from, text: speech[0].text, untrusted: speech[0].untrusted}, {from: {soulId: 's_alice', name: 'Alice'}, text: 'hello pond', untrusted: true});
    assert.match(speech[0].id, /^c_\d+$/);
    for (const who of ['Cleo', 'Dan', 'Alice']) assert.equal((await f.drain(who)).events.filter((e: any) => e.kind === 'speech').length, 0, `${who} must not hear`);
    const logged = f.db.db.prepare('SELECT soul_id, text, heard_by FROM edge_comms_speech').all() as any[];
    assert.deepEqual(logged.map(r => [r.soul_id, r.text, JSON.parse(r.heard_by)]), [['s_alice', 'hello pond', ['s_bob']]]);
  } finally { f.destroy(); }
});

test('indoor say reaches everyone in the same enclosure and nobody outside, however close', async () => {
  const f = commsFixture(['Alice', 'Bob', 'Cleo']);
  try {
    f.at('Alice', 0, 0, [HOUSE, COMMONS], 'house-1'); f.at('Bob', 40, 0, [place('house-1-kitchen', 'room'), HOUSE, COMMONS], 'house-1'); f.at('Cleo', 1, 0);
    const said = await f.post('Alice', '/v1/edge/say', {text: 'dinner'});
    assert.deepEqual(said.body.said.channel, {kind: 'enclosure', placeId: 'house-1'});
    assert.equal(said.body.said.heardBy, 1);
    assert.equal((await f.drain('Bob')).events.filter((e: any) => e.kind === 'speech')[0].channel.kind, 'enclosure');
    assert.equal((await f.drain('Cleo')).events.length, 0);
    const out = await f.post('Cleo', '/v1/edge/say', {text: 'anyone in?'});
    assert.equal(out.body.said.heardBy, 0);
  } finally { f.destroy(); }
});

test('wait long-polls until an event arrives, times out empty, and validates its query', async () => {
  const f = commsFixture(['Alice', 'Bob']);
  try {
    f.at('Alice', 0, 0); f.at('Bob', 1, 0);
    const empty = await f.get('Bob', '/v1/edge/wait?timeout=1');
    assert.equal(empty.status, 200); assert.deepEqual(empty.body.events, []); assert.equal(empty.body.cursor, 'c_0');
    const started = Date.now();
    const pending = f.get('Bob', `/v1/edge/wait?after=${empty.body.cursor}&timeout=10`);
    setTimeout(() => { void f.post('Alice', '/v1/edge/say', {text: 'wake'}); }, 50);
    const woke = await pending;
    assert.ok(Date.now() - started < 3000, 'returned on the event, not the timeout');
    assert.equal(woke.body.events.length, 1); assert.equal(woke.body.cursor, woke.body.events[0].id);
    // after omitted = from now: the earlier speech is not replayed.
    const fromNow = await f.get('Bob', '/v1/edge/wait?timeout=1');
    assert.deepEqual(fromNow.body.events, []); assert.equal(fromNow.body.cursor, woke.body.cursor);
    for (const q of ['timeout=0', 'timeout=56', 'timeout=abc', 'after=zzz', 'after=c_-1', 'after=1'])
      assert.equal((await f.get('Bob', `/v1/edge/wait?${q}`)).status, 400, q);
  } finally { f.destroy(); }
});

test('receipt phases reach their own Soul once each, deduplicated across re-emission', async () => {
  const f = commsFixture(['Alice', 'Bob']);
  try {
    f.ledger.receipt({id: 'r_1', soulId: 's_alice', phase: 'started', startedTick: 5});
    f.ledger.receipt({id: 'r_1', soulId: 's_alice', phase: 'started', startedTick: 5});
    f.ledger.receipt({id: 'r_1', soulId: 's_alice', phase: 'completed', startedTick: 5, endedTick: 9});
    const events = (await f.drain('Alice')).events;
    assert.deepEqual(events.map((e: any) => [e.kind, e.receipt.phase, e.tick]), [['receipt', 'started', 5], ['receipt', 'completed', 9]]);
    assert.equal((await f.drain('Bob')).events.length, 0);
  } finally { f.destroy(); }
});

test('arrivals and departures reach Souls sharing the place, innermost place only', async () => {
  const f = commsFixture(['Alice', 'Bob', 'Cleo', 'Dan']);
  const GARDEN = place('eden-garden', 'garden');
  try {
    f.at('Bob', 2, 0, [GARDEN, COMMONS]); f.at('Cleo', 30, 0, [HOUSE, COMMONS], 'house-1'); f.at('Dan', 80, 0, [GARDEN, COMMONS]);
    const base = {bob: (await f.drain('Bob')).events.length, cleo: (await f.drain('Cleo')).events.length, dan: (await f.drain('Dan')).events.length};
    f.at('Alice', 0, 0, [GARDEN, COMMONS]);                // into the garden next to Bob
    f.at('Alice', 28, 0, [HOUSE, COMMONS], 'house-1');     // into the house: Cleo arrival, Bob departure
    f.at('Alice', 29, 0, [place('chair-1', 'occupier'), HOUSE, COMMONS], 'house-1'); // sits: nobody shares the chair
    f.at('Alice', 26, 0, [COMMONS]);                       // leaves chair and house: Cleo departure
    const view = (events: any[], from: number) => events.slice(from).map((e: any) => [e.kind, e.placeId, e.soul.name, e.untrusted]);
    assert.deepEqual(view((await f.drain('Bob')).events, base.bob), [['arrival', 'eden-garden', 'Alice', true], ['departure', 'eden-garden', 'Alice', true]]);
    assert.deepEqual(view((await f.drain('Cleo')).events, base.cleo), [['arrival', 'house-1', 'Alice', true], ['departure', 'house-1', 'Alice', true]]);
    assert.equal((await f.drain('Dan')).events.length, base.dan, 'Dan shares the garden but is 80 m away');
  } finally { f.destroy(); }
});

test('a cursor older than retention reads as a gap with the oldest usable cursor', async () => {
  const f = commsFixture(['Alice', 'Bob'], {retainEvents: 5});
  try {
    f.at('Alice', 0, 0); f.at('Bob', 1, 0);
    for (let i = 0; i < 30; i++) await f.post('Alice', '/v1/edge/say', {text: `n${i}`});
    const gap = await f.get('Bob', '/v1/edge/wait?after=c_1&timeout=1');
    assert.equal(gap.body.gap, true); assert.deepEqual(gap.body.events, []);
    const resumed = await f.get('Bob', `/v1/edge/wait?after=${gap.body.cursor}&timeout=1`);
    assert.ok(resumed.body.events.length >= 1 && !resumed.body.gap);
    assert.equal(resumed.body.events.at(-1).text, 'n29');
    const ahead = await f.get('Bob', '/v1/edge/wait?after=c_999&timeout=1');
    assert.equal(ahead.body.gap, true); assert.equal(ahead.body.cursor, 'c_30');
  } finally { f.destroy(); }
});

test('speech and cursors survive a restart of the comms runtime', async () => {
  const first = commsFixture(['Alice', 'Bob']);
  first.at('Alice', 0, 0); first.at('Bob', 1, 0);
  await first.post('Alice', '/v1/edge/say', {text: 'before restart'});
  first.close();
  const again = commsFixture(['Alice', 'Bob'], {}, {dir: first.dir, db: first.db, clock: first.clock});
  try {
    again.at('Alice', 0, 0); again.at('Bob', 1, 0);
    await again.post('Alice', '/v1/edge/say', {text: 'after restart'});
    const events = (await again.drain('Bob')).events.filter((e: any) => e.kind === 'speech');
    assert.deepEqual(events.map((e: any) => [e.id, e.text]), [['c_1', 'before restart'], ['c_2', 'after restart']]);
  } finally { again.destroy(); }
});

test('publishWorld sends world text to every live Soul', async () => {
  const f = commsFixture(['Alice', 'Bob']);
  try {
    f.runtime.publishWorld('First light.');
    for (const who of ['Alice', 'Bob']) assert.deepEqual((await f.drain(who)).events.map((e: any) => [e.kind, e.text]), [['world', 'First light.']]);
  } finally { f.destroy(); }
});

test('subscribe pushes signed wait-shaped bodies and advances its own cursor on 2xx only', async () => {
  const calls: {url: string; headers: Record<string, string>; body: string}[] = [];
  let ok = true;
  const f = commsFixture(['Alice', 'Bob'], {fetch: async (url, init) => { calls.push({url, headers: init.headers, body: init.body}); return {ok, status: ok ? 200 : 500}; }});
  try {
    f.at('Alice', 0, 0); f.at('Bob', 1, 0);
    for (const url of ['http://agent.example/hook', 'https://localhost/hook', 'https://127.0.0.1/x', 'https://10.1.2.3/x', 'nope'])
      assert.equal((await f.post('Bob', '/v1/edge/subscribe', {url, secret: 's'.repeat(16)})).status, 400, url);
    assert.equal((await f.post('Bob', '/v1/edge/subscribe', {url: 'https://agent.example/hook', secret: 'short'})).status, 400);
    const sub = await f.post('Bob', '/v1/edge/subscribe', {url: 'https://agent.example/hook', secret: 'a-long-enough-secret'});
    assert.equal(sub.status, 200); assert.equal(sub.body.subscription.cursor, 'c_0');
    await f.post('Alice', '/v1/edge/say', {text: 'ping'});
    await new Promise(r => setTimeout(r, 20));
    assert.equal(calls.length, 1);
    const sent = JSON.parse(calls[0]!.body);
    assert.equal(sent.contract, EDGE_CONTRACT); assert.equal(sent.events[0].text, 'ping'); assert.equal(sent.cursor, 'c_1');
    assert.equal(calls[0]!.headers['x-eden-signature'], signature('a-long-enough-secret', calls[0]!.body));
    ok = false;
    await f.post('Alice', '/v1/edge/say', {text: 'pong'});
    await new Promise(r => setTimeout(r, 20));
    const row = f.db.db.prepare('SELECT cursor, failures FROM edge_comms_subscriptions').get() as any;
    assert.deepEqual([row.cursor, row.failures], [1, 1], 'failed push keeps the cursor for retry');
    const del = await f.req('Bob', 'DELETE', '/v1/edge/subscribe');
    assert.equal(del.body.unsubscribed, true);
  } finally { f.destroy(); }
});
