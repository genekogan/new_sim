// SOULSIM-H F1: a Soul's `wait` ends as soon as its owner writes, so an agent busy with a walk sees the message at once
// (session-1 baseline: "actually sit on the bench" typed mid-walk waited 64 s for the agent's `wait 60` to run out).
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture, invite, accept} from '../test/native-owner-fixture.ts';
import {buildApp} from './http.ts';
import {config} from './config.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';

test('wait wakes on an owner message: unseen or newer than ownerSince; not for one already handed over and older', async t => {
  const f = fixture(':memory:'); f.brain.quiesce(); t.after(() => { f.host.stop(); f.db.close(); });
  await invite(f, 'alice');
  const a = await accept(f.host, f.souls.create('dev:alice', {name: 'Avery', description: 'Wait fixture'}));
  const token = f.souls.pairExchange(f.souls.pairCode(a, 'http://127.0.0.1:5963').code, 'scripted').token;
  const app = buildApp({cfg: {...config, port: 5963, worldPath: '/w/eden', publicUrl: 'http://127.0.0.1:5963/w/eden', accountAuthRequired: false, webDir: '/nonexistent-wait-fixture', marsWebDir: '/nonexistent-wait-fixture'}, db: f.db, host: f.host, auth: f.auth, brain: f.brain, souls: f.souls, edge: new EdgeLedger(f.host, f.db), hub: {clients: new Map(), refreshMe() {}} as never});
  const req = async (path: string, auth?: string, body?: unknown) => {
    const r = await app.request(path, {method: body === undefined ? 'GET' : 'POST', headers: {...(auth ? {authorization: `Bearer ${auth}`} : {}), 'content-type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    return {status: r.status, data: await r.json() as any};
  };
  const box = `/v1/edge/owner/${a.id}/inbox`, tick = () => new Promise(r => setTimeout(r, 30));
  const head = (await req('/v1/edge/wait?after=c_0&timeout=1', token)).data;
  assert.equal(head.ownerWrote, undefined); assert.equal(typeof head.ownerMark, 'number');
  let cursor = head.cursor, mark = head.ownerMark;

  // 1. the owner writes while the agent waits: the wait ends at once, with the count and a new mark
  let begun = performance.now();
  const waiting = req(`/v1/edge/wait?after=${cursor}&timeout=20&ownerSince=${mark}`, token);
  await tick(); assert.equal((await req(box, 'dev:alice', {text: 'actually sit on the bench'})).status, 200);
  const woke = (await waiting).data;
  assert.ok(performance.now() - begun < 5_000, 'woke at once, not at its 20 s timeout');
  assert.equal(woke.ownerWrote, 1); assert.ok(woke.ownerMark > mark); assert.equal(woke.inbox.latest.text, 'actually sit on the bench');
  mark = woke.ownerMark; cursor = woke.cursor;

  // 2. a message no listen has handed over still interrupts the next wait (the agent has not seen it) …
  const again = (await req(`/v1/edge/wait?after=${cursor}&timeout=20&ownerSince=${mark}`, token)).data;
  assert.equal(again.ownerWrote, 1);
  // … until a listen takes it; then a wait sleeps through it (held, not new) to its timeout
  const listened = (await req('/v1/edge/inbox/listen?timeoutMs=0', token)).data;
  assert.equal(listened.backlog.length, 1);
  begun = performance.now();
  const quiet = (await req(`/v1/edge/wait?after=${cursor}&timeout=1&ownerSince=${mark}`, token)).data;
  assert.equal(quiet.ownerWrote, undefined); assert.ok(performance.now() - begun >= 900, 'slept its full second');
  mark = quiet.ownerMark;

  // 3. a background listen takes the next message first: the wait still ends (it is newer than the mark)
  const bg = req(`/v1/edge/inbox/listen?timeoutMs=20000&after=${listened.backlog[0].id}`, token);
  const fg = req(`/v1/edge/wait?after=${cursor}&timeout=20&ownerSince=${mark}`, token);
  await tick(); begun = performance.now();
  assert.equal((await req(box, 'dev:alice', {text: 'and wave'})).status, 200);
  const [l, w] = await Promise.all([bg, fg]);
  assert.ok(performance.now() - begun < 5_000);
  assert.ok(l.data.backlog.some((m: any) => m.text === 'and wave'));
  assert.equal(w.data.ownerWrote, 1, 'only the new one counts (the first is held)');

  // 4. acknowledged messages never wake a wait; a malformed ownerSince is refused
  for (const m of [...listened.backlog, ...l.data.backlog]) assert.equal((await req(`/v1/edge/inbox/${m.id}/ack`, token, {reply: 'Got it'})).status, 200);
  const acked = (await req(`/v1/edge/wait?after=${cursor}&timeout=1&ownerSince=0`, token)).data;
  assert.equal(acked.ownerWrote, undefined);
  assert.equal((await req(`/v1/edge/wait?after=${cursor}&timeout=1&ownerSince=soon`, token)).status, 400);
});
