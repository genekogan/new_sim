// srv-load: the waking limit (dark, SIM_WAKING_LIMIT=1): FIFO, the owner never waits, one awake per account while others
// wait, an idle Soul lends its slot, amber+ admits no new wakes, a gone agent leaves the line; the body rule keeps a
// waiting Soul asleep in place; acts answer world.crowded {position, eta_s}.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Hono} from 'hono';
import {WakingLimit, crowdedNote} from './load/waking.ts';
import {Admission, admissionMiddleware} from './load/admission.ts';
import {BodyRule, type BodyPort, type BodySoul} from './edge/ledger/body-rule.ts';

function world(souls: {soulId: string; owner: string}[], awake: Set<string>, maxAwake = 2) {
  let now = 0;
  const w = new WakingLimit({maxAwake, owner: () => 'god', view: {awake: id => awake.has(id), souls: () => souls}, now: () => now});
  return {w, tick: (ms: number) => { now += ms; }};
}

test('waking limit: FIFO past the limit; the owner never waits; positions and ETA', () => {
  const souls = ['a', 'b', 'c', 'd'].map((x, i) => ({soulId: x, owner: `acct${i}`})).concat([{soulId: 'g', owner: 'god'}]);
  const awake = new Set(['a', 'b']), {w} = world(souls, awake);
  assert.equal(w.mayWake('c'), false); assert.equal(w.mayWake('d'), false);
  assert.deepEqual(w.position('c'), {position: 1, eta_s: 180}); assert.deepEqual(w.position('d'), {position: 2, eta_s: 360});
  assert.equal(w.mayWake('g'), true, 'the owner never waits'); assert.equal(w.position('g'), null);
  awake.delete('a');   // a's agent left (or a went idle: only awake bodies count)
  assert.equal(w.mayWake('d'), false, 'not d: c is first in line');
  assert.equal(w.mayWake('c'), true); awake.add('c');
  assert.deepEqual(w.position('d'), {position: 1, eta_s: 180});
  assert.match(crowdedNote(w.position('d')!), /1st in line \(about 3 min\)/);
});

test('waking limit: one awake per account while others wait; amber admits no new wakes; a gone agent leaves the line', () => {
  const souls = [{soulId: 'a1', owner: 'A'}, {soulId: 'a2', owner: 'A'}, {soulId: 'b1', owner: 'B'}, {soulId: 'x', owner: 'X'}];
  const awake = new Set(['a1', 'x']), {w, tick} = world(souls, awake);
  assert.equal(w.mayWake('a2'), false); assert.equal(w.mayWake('b1'), false);
  awake.delete('x');
  assert.equal(w.mayWake('a2'), false, 'A already has a body awake: B goes first');
  assert.equal(w.mayWake('b1'), true); awake.add('b1');
  w.setLoadLevel('amber'); awake.delete('b1');
  assert.equal(w.mayWake('a2'), false, 'amber: no new wakes even with a free slot');
  w.setLoadLevel('green');
  const {w: w2, tick: t2} = world([{soulId: 'p', owner: 'P'}, {soulId: 'q', owner: 'Q'}, {soulId: 'r', owner: 'R'}], new Set(['r']), 1);
  assert.equal(w2.mayWake('p'), false); assert.equal(w2.mayWake('q'), false);
  t2(11_000);   // p's agent went away (no longer asked about); q keeps asking
  assert.equal(w2.mayWake('q'), false); assert.deepEqual(w2.position('q'), {position: 1, eta_s: 180}, 'p left the line');
  void tick;
});

test('body rule: a connected Soul that may not wake stays asleep in place (no stand-up, no drift)', () => {
  const db = new DatabaseSync(':memory:'), soul: BodySoul = {soulId: 's1', entityId: 'e1', name: 'S', owner: 'o'};
  const decisions: string[] = []; let listening = false, now = 1e12;
  const port: BodyPort = {souls: () => [soul], presence: () => ({listening, at: listening ? now : 0}), createdAt: () => 0, pose: () => ({x: 0, z: 0, level: 0}), posture: () => 'lying', agentBusy: () => false, running: () => false,
    dry: () => true, clear: () => true, places: () => '', seat: () => null, decide: (_s, option) => { decisions.push(option); }, stop: () => {}, publish: () => {}};
  const rule = new BodyRule(db as never, 'w', port, {now: () => now, knobs: {zombieWanderMs: 1000}});
  now += 200e3; rule.sweep(); now += 5000; rule.sweep(); now += 5000; rule.sweep();
  assert.equal(rule.view('s1')!.state, 'asleep');
  let may = false; rule.mayWake = () => may;
  listening = true; rule.listen('s1'); now += 1000; rule.sweep(); now += 1000; rule.sweep();
  assert.equal(rule.view('s1')!.state, 'asleep', 'waiting its turn'); assert.ok(!decisions.includes('body:wake'));
  may = true; now += 1000; rule.sweep();
  assert.equal(rule.view('s1')!.state, 'awake', 'its turn: it wakes'); assert.ok(decisions.includes('body:wake'));
});

test('a waiting Soul\'s act answers world.crowded {position, eta_s}; its reads still answer', async () => {
  const adm = new Admission(), app = new Hono();
  app.use('*', admissionMiddleware(adm, () => 'green', c => c.req.header('authorization')?.slice(7), undefined, t => t === 'sim_wait' ? {position: 2, eta_s: 360} : null));
  app.post('/v1/edge/act', c => c.json({accepted: true})); app.get('/v1/edge/here', c => c.json({here: 1}));
  const act = await app.request('/v1/edge/act', {method: 'POST', headers: {authorization: 'Bearer sim_wait'}, body: '{}'});
  assert.equal(act.status, 503); assert.equal(act.headers.get('retry-after'), '60');
  const body = await act.json() as {error: {code: string; position: number; eta_s: number; message: string}};
  assert.deepEqual([body.error.code, body.error.position, body.error.eta_s], ['world.crowded', 2, 360]); assert.match(body.error.message, /2nd in line/);
  assert.equal((await app.request('/v1/edge/here', {headers: {authorization: 'Bearer sim_wait'}})).status, 200);
  assert.equal((await app.request('/v1/edge/act', {method: 'POST', headers: {authorization: 'Bearer sim_free'}, body: '{}'})).status, 200);
  adm.close();
});
