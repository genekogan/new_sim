// D3 (playtest 2026-10-25, ROOT-CAUSES §C D3): the server closes the owner loop. An act names the owner message it serves
// (`for`); when its receipt ends the world writes that message's result (resultBy 'server') unless the agent already
// did, and the agent's own result still replaces it. A `wait`, which ends when the owner writes, counts as listening, so
// the card no longer reads "away" while the agent waits on its act.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture, invite, accept} from '../test/native-owner-fixture.ts';
import {buildApp} from './http.ts';
import {config} from './config.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';

test('D3: act --for links the receipt to the owner message; the world writes the result; the agent overrides; wait is listening', {timeout: 300000}, async t => {
  const f = fixture(':memory:'); f.brain.quiesce(); t.after(() => { f.host.stop(); f.db.close(); });
  await invite(f, 'alice');
  const a = await accept(f.host, f.souls.create('dev:alice', {name: 'Avery', description: 'Owner loop fixture'}));
  const token = f.souls.pairExchange(f.souls.pairCode(a, 'http://127.0.0.1:5964').code, 'scripted').token;
  const edge = new EdgeLedger(f.host, f.db);
  const app = buildApp({cfg: {...config, port: 5964, worldPath: '/w/eden', publicUrl: 'http://127.0.0.1:5964/w/eden', accountAuthRequired: false, webDir: '/nonexistent-loop-fixture', marsWebDir: '/nonexistent-loop-fixture'}, db: f.db, host: f.host, auth: f.auth, brain: f.brain, souls: f.souls, edge, hub: {clients: new Map(), refreshMe() {}} as never});
  const req = async (path: string, auth?: string, body?: unknown, method?: string) => {
    const r = await app.request(path, {method: method ?? (body === undefined ? 'GET' : 'POST'), headers: {...(auth ? {authorization: `Bearer ${auth}`} : {}), 'content-type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    return {status: r.status, data: await r.json() as any};
  };
  const box = `/v1/edge/owner/${a.id}/inbox`, owner = async () => (await req(box, 'dev:alice')).data.inbox;
  assert.equal((await req(box, 'dev:alice', {text: 'wave to me'})).status, 200);
  const msg = (await req('/v1/edge/inbox/listen?timeoutMs=0', token)).data.backlog[0];
  assert.equal((await req(`/v1/edge/inbox/${msg.id}/ack`, token, {reply: 'Will try a wave'})).status, 200);

  // presence: with the listen grace long past, the box is away; while a wait is open it is listening
  f.db.db.prepare('UPDATE agent_inbox_v1 SET listened_at=0').run();
  assert.equal((await owner()).presence, 'away');
  const cursor = (await req('/v1/edge/wait?after=c_0&timeout=1', token)).data.cursor;
  f.db.db.prepare('UPDATE agent_inbox_v1 SET listened_at=0').run();
  const waiting = req(`/v1/edge/wait?after=${cursor}&timeout=2`, token);
  await new Promise(r => setTimeout(r, 50));
  assert.equal((await owner()).presence, 'listening', 'an open wait is listening');
  await waiting;

  // `for` must name a message of this Soul
  const bad = await req('/v1/edge/act', token, {capability: 'wave', for: 'm_nope'});
  assert.equal(bad.status, 400); assert.match(bad.data.error.message, /no owner message/);
  // the act's end writes the result
  const out = (await accept(f.host, req('/v1/edge/act', token, {capability: 'wave', for: msg.id}))).data;
  assert.equal(out.accepted, true, JSON.stringify(out)); assert.equal(out.for, msg.id);
  for (let i = 0; i < 2000 && ['waiting', 'started', 'accepted'].includes(edge.receipt(a.id, out.receipt.id)!.phase); i++) { f.host.tickOnce(); if (i % 20 === 0) { await new Promise(r => setImmediate(r)); f.host.drainInputs(); } }
  assert.equal(edge.receipt(a.id, out.receipt.id)!.phase, 'completed');
  await new Promise(r => setTimeout(r, 20));
  const closed = (await owner()).log?.find((m: any) => m.id === msg.id) ?? (await req('/v1/edge/inbox/listen?timeoutMs=0', token)).data.inbox.latest;
  const row = f.db.db.prepare('SELECT result,outcome,result_by FROM soul_inbox_queue_v1 WHERE id=?').get(msg.id) as any;
  assert.equal(row.result_by, 'server', JSON.stringify({row, closed})); assert.equal(row.outcome, 'done'); assert.ok(row.result.length > 0 && row.result.length <= 140);
  // the agent's own words replace the world's line; then a second agent result is refused as before
  assert.equal((await req(`/v1/edge/inbox/${msg.id}/result`, token, {outcome: 'done', text: 'Waved at you'})).status, 200);
  const mine = f.db.db.prepare('SELECT result,result_by FROM soul_inbox_queue_v1 WHERE id=?').get(msg.id) as any;
  assert.equal(mine.result, 'Waved at you'); assert.equal(mine.result_by, null);
  assert.equal((await req(`/v1/edge/inbox/${msg.id}/result`, token, {outcome: 'done', text: 'something else'})).status, 409);
  // a later linked act never overwrites the agent's result
  const again = (await accept(f.host, req('/v1/edge/act', token, {capability: 'wave', for: msg.id}))).data;
  for (let i = 0; i < 2000 && ['waiting', 'started', 'accepted'].includes(edge.receipt(a.id, again.receipt.id)!.phase); i++) { f.host.tickOnce(); if (i % 20 === 0) { await new Promise(r => setImmediate(r)); f.host.drainInputs(); } }
  await new Promise(r => setTimeout(r, 20));
  assert.equal((f.db.db.prepare('SELECT result FROM soul_inbox_queue_v1 WHERE id=?').get(msg.id) as any).result, 'Waved at you');
});
