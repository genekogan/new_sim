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
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Db} from './db.ts';
import {AgentInbox} from './inbox.ts';
import {OwnerLoop} from './edge/owner-loop.ts';
import type {EdgeReceipt} from './edge/contract.ts';

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
  // D3c: the CLI's default link (forDefault) on an act that is not the message's last step answers `open` and leaves it open
  assert.equal((await req(box, 'dev:alice', {text: 'sit down for a bit, then come back to me'})).status, 200);
  const next = (await req(`/v1/edge/inbox/listen?after=${msg.id}&timeoutMs=0`, token)).data.backlog[0];
  assert.equal((await req(`/v1/edge/inbox/${next.id}/ack`, token, {reply: 'Got it'})).status, 200);
  const open = (await accept(f.host, req('/v1/edge/act', token, {capability: 'wave', for: next.id, forDefault: true}))).data;
  assert.equal(open.accepted, true, JSON.stringify(open)); assert.equal(open.for, next.id); assert.equal(open.open, true);
  for (let i = 0; i < 2000 && ['waiting', 'started', 'accepted'].includes(edge.receipt(a.id, open.receipt.id)!.phase); i++) { f.host.tickOnce(); if (i % 20 === 0) { await new Promise(r => setImmediate(r)); f.host.drainInputs(); } }
  await new Promise(r => setTimeout(r, 20));
  const kept = f.db.db.prepare('SELECT result,progress FROM soul_inbox_queue_v1 WHERE id=?').get(next.id) as any;
  assert.equal(kept.result, null, 'a wave does not close "sit down, then come back"'); assert.match(kept.progress, /^now: .+; not sitting yet$/);
});

// D3c (laptop-20261026 fix/trio-r1 rook-003, W/O2): Mira asked "find a comfy spot and have a little rest, then come back
// to the balloon to meet me"; Rook acked "rest a bit, then back to the balloon", then waved at Tam; the CLI's default link
// put the wave on the message and its end closed the card Done. A default (implicit) link now closes only with an act of
// the message's last step; any other act's end writes a progress line and the card stays open. Explicit links unchanged.
test('D3c rook-003: a default-linked wave, then a sit, keep "rest, then come back to the balloon" open; the walk back closes it', t => {
  const dir = mkdtempSync(join(tmpdir(), 'sim-d3c-')); t.after(() => rmSync(dir, {recursive: true, force: true}));
  const db = new Db(join(dir, 'fixture.db')); t.after(() => db.close());
  const inbox = new AgentInbox(db, 'w1'), soul = {soulId: 's_rook', entityId: 'h_rook', name: 'Rook', owner: 'mira'}, scope = {scope: 'soul:s_rook', owner: 'mira'};
  let emit: (r: EdgeReceipt) => void = () => {};
  const done = new Map<string, string>();
  const loop = new OwnerLoop(inbox, (_s, id) => ({...rec(id, '', 'completed'), ...(done.has(id) ? {done: done.get(id)} : {})}) as never, l => { emit = l; });
  const rec = (id: string, capability: string, phase: EdgeReceipt['phase']) => ({id, soulId: 's_rook', capability, phase, acceptedTick: 1, startedTick: 1, endedTick: phase === 'completed' || phase === 'failed' ? 2 : null, code: null, reason: null, programId: null}) as EdgeReceipt;
  const end = (id: string, capability: string, line: string) => { done.set(id, line); emit(rec(id, capability, 'completed')); };
  const row = (id: string) => db.db.prepare('SELECT result,outcome,result_by,progress FROM soul_inbox_queue_v1 WHERE id=?').get(id) as {result: string | null; outcome: string | null; result_by: string | null; progress: string | null};
  inbox.send(scope, 'Aww, well done Rook! Now could you find a comfy spot and have a little rest, then come back to the balloon to meet me?');
  const msg = inbox.takeBacklog(scope)[0]; inbox.acknowledge(scope, msg.id, 'Got it: will say hi to Mira, rest a bit, then back to the balloon');

  // the first act after the ack: a wave to Tam (the receipt that closed the card Done in trio-r1)
  assert.deepEqual(loop.link(soul, rec('r_wave', 'wave:s_tam', 'started'), msg.id, true), {open: true}, 'a wave is no step of this message');
  end('r_wave', 'wave:s_tam', 'wave completed at g-commons.');
  let r = row(msg.id);
  assert.equal(r.result, null, 'the wave does not close the message'); assert.equal(r.outcome, null);
  assert.equal(r.progress, 'now: wave completed at g-commons; not resting yet');
  assert.equal(inbox.ownerView(scope).latest?.progress, r.progress, 'the owner card shows the progress line');
  // the rest: a sit is its first step, not its last, so the message stays open and says what is still to come
  assert.deepEqual(loop.link(soul, rec('r_sit', 'sit:bench-2', 'started'), msg.id, true), {open: true});
  end('r_sit', 'sit:bench-2', 'sat on bench 2 at g-commons for 60 s.');
  r = row(msg.id); assert.equal(r.result, null, 'still open after the rest'); assert.equal(r.progress, 'now: sat on bench 2 at g-commons for 60 s; not there yet');
  // back to the balloon: the last step closes it
  assert.deepEqual(loop.link(soul, rec('r_walk', 'walk:festival-balloon', 'started'), msg.id, true), {open: false});
  end('r_walk', 'walk:festival-balloon', 'arrived at the festival balloon.');
  r = row(msg.id); assert.equal(r.result, 'arrived at the festival balloon.'); assert.equal(r.outcome, 'done'); assert.equal(r.result_by, 'server');
  assert.equal(inbox.ownerView(scope).latest?.result, 'arrived at the festival balloon.');

  // an explicit link (the agent chose it) keeps D3's behaviour: the wave closes it
  inbox.send(scope, 'have a little rest, then come back to the balloon');
  const two = inbox.takeBacklog(scope)[0]; inbox.acknowledge(scope, two.id, 'Got it');
  assert.deepEqual(loop.link(soul, rec('r_wave2', 'wave:s_tam', 'started'), two.id), {open: false});
  end('r_wave2', 'wave:s_tam', 'wave completed at g-commons.');
  assert.equal(row(two.id).result, 'wave completed at g-commons.');
  // a message whose words name no act cannot be judged: the default link closes it as before
  inbox.send(scope, 'Do something fun!');
  const three = inbox.takeBacklog(scope)[0]; inbox.acknowledge(scope, three.id, 'Got it');
  assert.deepEqual(loop.link(soul, rec('r_dance', 'dance:here', 'started'), three.id, true), {open: false});
  end('r_dance', 'dance:here', 'danced at g-commons.');
  assert.equal(row(three.id).outcome, 'done');
  // a progress line never lands on a message that already has a result, and a mismatched act on a one-step message stays open
  inbox.send(scope, 'sit on the bench');
  const four = inbox.takeBacklog(scope)[0]; inbox.acknowledge(scope, four.id, 'Got it');
  assert.deepEqual(loop.link(soul, rec('r_w4', 'wave:here', 'started'), four.id, true), {open: true});
  inbox.result(scope, four.id, 'Sat down already.', 'done');
  end('r_w4', 'wave:here', 'wave completed at g-commons.');
  assert.equal(row(four.id).progress, null); assert.equal(row(four.id).result, 'Sat down already.');
});
