import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { projectSoul } from './world-truth.mjs';
import { openRequest } from './evidence.mjs';
const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url)));
const KEYS = ['requestId', 'seat', 'soulId', 'text', 'channel', 'sentAt', 'ackAt', 'ackText', 'resultAt', 'resultText', 'resultState', 'cutoffAt', 'cutoffReason', 'samples', 'receipts', 'shots', 'chatTurns', 'legible', 'firstBodyChangeAt', 'serverErrors', 'cost'];

function snaps() {
  const inbox = fx('owner-inbox'), owner = fx('owner-status'), pub = fx('public-soul');
  const s1 = projectSoul({ soulId: 's_d0d67e0f21', pub, owner, inbox, clock: { t: '2026-10-24T00:00:01.000Z', mono: 1000 } });
  const moved = structuredClone(owner); moved.status.position.x += 3;
  const acked = structuredClone(inbox); Object.assign(acked.inbox.latest, { state: 'acknowledged', acknowledgedAt: 1792897020000, reply: 'On my way to the knoll.' });
  const s2 = projectSoul({ soulId: 's_d0d67e0f21', pub, owner: moved, inbox: acked, clock: { t: '2026-10-24T00:00:06.000Z', mono: 6000 } });
  const done = structuredClone(acked); Object.assign(done.inbox.latest, { outcome: 'done', result: 'I am on the knoll.', resultAt: 1792897090000 });
  const s3 = projectSoul({ soulId: 's_d0d67e0f21', pub, owner: moved, inbox: done, clock: { t: '2026-10-24T00:00:11.000Z', mono: 11000 } });
  return { s1, s2, s3, msgId: inbox.inbox.latest.id };
}

test('close() writes the pack with the contract shape', () => {
  const runDir = mkdtempSync(join(tmpdir(), 'pt-ev-')), { s1, s2, s3, msgId } = snaps();
  const ev = openRequest({ runDir, seat: 'mira', soulId: 's_d0d67e0f21', requestId: msgId, text: 'go to the knoll', channel: 'card', sentAt: 1792897015615 });
  ev.sample({ snap: s1, legible: { card: { ack: null, result: null }, raw: 'x' }, shot: { path: 'shots/mira/1000.png' } });
  ev.sample({ snap: s2, legible: { card: { ack: 'On my way to the knoll.', result: null }, raw: 'y' } });
  ev.sample({ snap: s3 }); ev.addChatTurn('turn-2'); ev.addServerErrors(2); ev.setCost({ usd: 0.1 });
  const out = ev.close({ cutoffReason: 'result' });
  for (const k of KEYS) assert.ok(k in out, k);
  assert.ok(existsSync(join(runDir, 'evidence', `${msgId}.json`)));
  assert.equal(out.ackText, 'On my way to the knoll.'); assert.equal(out.ackAt, new Date(1792897020000).toISOString());
  assert.equal(out.resultText, 'I am on the knoll.'); assert.equal(out.resultState, 'done');
  assert.equal(out.firstBodyChangeAt, '2026-10-24T00:00:06.000Z'); assert.equal(out.samples.length, 3);
  assert.deepEqual(out.shots, ['shots/mira/1000.png']); assert.deepEqual(out.chatTurns, ['turn-2']); assert.equal(out.serverErrors, 2);
  assert.equal(out.receipts.length, 1); assert.equal(out.cardSeen.ackAt != null, true); assert.deepEqual(out.omitted, []);
  const disk = JSON.parse(readFileSync(out.file, 'utf8')); assert.equal(disk.cutoffReason, 'result');
});

test('a message that is not this request does not set ack', () => {
  const runDir = mkdtempSync(join(tmpdir(), 'pt-ev-')), { s2 } = snaps();
  const ev = openRequest({ runDir, seat: 'mira', requestId: 'msg_other', text: 'something else' });
  ev.sample({ snap: s2 }); assert.equal(ev.close({ cutoffReason: 'timeout' }).ackText, null);
});

test('bodies over 256 KB spill to raw/<sha>.json.gz with a projection and omitted flags', () => {
  const runDir = mkdtempSync(join(tmpdir(), 'pt-ev-')), { s1 } = snaps();
  const big = { snapshot: { entities: Array.from({ length: 4000 }, (_, i) => ({ id: 'e_' + i, pad: 'x'.repeat(80) })) } };
  const ev = openRequest({ runDir, seat: 'mira', requestId: 'msg_big', text: 't' });
  ev.sample({ snap: { ...s1, raw: { public: fx('public-soul'), world: big } }, legible: { card: null, raw: 'w'.repeat(300 * 1024) } });
  const out = ev.close({ cutoffReason: 'timeout' });
  const w = out.samples[0].raw.world;
  assert.equal(w.omitted, true); assert.match(w.raw, /^raw\/[0-9a-f]{64}\.json\.gz$/); assert.ok(w.bytes > 256 * 1024);
  assert.equal(w.projection.snapshot.entities._array, 4000);
  assert.equal(out.samples[0].raw.public.soul.name, 'Pip'); // small bodies stay inline
  assert.equal(out.legible[0].raw.omitted, true);
  assert.deepEqual(out.omitted, ['samples[0].raw.world', 'legible[0].raw']);
  const back = JSON.parse(gunzipSync(readFileSync(join(runDir, 'evidence', w.raw))));
  assert.equal(back.snapshot.entities.length, 4000);
});

test('card history preserves intermediate server result and later explicit failure, with latest result timestamps',()=>{
 const runDir=mkdtempSync(join(tmpdir(),'pt-history-'));const ev=openRequest({runDir,seat:'a',requestId:'a-001',messageId:'msg_actual',text:'walk then sit',sentAt:0});
 ev.recordCard({id:'msg_actual',result:'walk completed',outcome:'done',resultBy:'server',resultAt:5000},new Date(5000).toISOString());
 ev.recordCard({id:'msg_other',text:'walk then sit',result:'wrong repeated text',resultAt:6000},new Date(6000).toISOString());
 ev.recordCard({id:'msg_actual',result:'Cannot sit: seat.inside',outcome:'failed',resultAt:30000},new Date(30000).toISOString());
 const out=ev.close({cutoffReason:'turn-complete',cutoffAt:new Date(31000).toISOString()});assert.equal(out.cardResults.length,2);assert.equal(out.firstResultAt,new Date(5000).toISOString());assert.equal(out.resultAt,new Date(30000).toISOString());assert.equal(out.resultBy,'agent');assert.equal(out.resultState,'failed');assert.equal(out.cardResults[0].by,'server');
});
