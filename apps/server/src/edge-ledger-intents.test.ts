// intents/1 (Core-A): affordance intents resolved by the server when the step starts — the nearest free seat near a
// Soul, a front-row seat in a room, go/swim/approach/turn/look — each receipt reporting the concrete choice; resolve is
// the same choice as a dry run with no side effects; the attention channel (look/turn/face) never cancels the body's
// act, speech and conversation never stop a walk; conversation members auto-face the speaker; replay is exact.
import test from 'node:test';
import assert from 'node:assert/strict';
import {coreAWorld} from '../test/core-a-fixture.ts';
import {headingOfYaw} from './edge/perception/geometry.ts';
import {Perception} from './edge/perception/here.ts';

test('intents: nearest free seat near a Soul, front row, go, swim, approach, turn, look; resolve has no side effects', {timeout: 600000}, async t => {
  const w = await coreAWorld(4); t.after(() => w.close());
  const [a, b, c, d] = w.souls;
  const act = async (s: typeof a, body: object) => (await w.http(s, 'POST', '/v1/edge/act', body)).body;
  const dry = async (s: typeof a, body: object) => (await w.http(s, 'POST', '/v1/edge/resolve', body)).body.resolve;
  const finish = async (s: typeof a, out: any, n = 8000) => {assert.equal(out.accepted, true, JSON.stringify(out)); await w.ticks(n, () => !w.open(s, out.receipt.id)); return w.receipt(s, out.receipt.id);};
  const seatOf = (s: typeof a) => new Perception(w.ledger, s).seat();
  // B stands by the dining table; C takes the chair nearest to B first
  await w.put(b, [21.6, 3.6]);
  const bAt = w.pos(b), chairs = w.ledger.capabilities(c).filter(x => x.verb === 'sit' && x.id.startsWith('sit:social-eden-dining-chair'));
  const dist = (id: string) => {const e = (w.engine.world.entities as any)[id]; return Math.hypot(e.pose.p[0] - bAt[0], e.pose.p[2] - bAt[1]);};
  const nearest = [...chairs].sort((x, y) => dist(x.target!.id) - dist(y.target!.id) || x.id.localeCompare(y.id));
  const cs = await finish(c, await act(c, {capability: nearest[0].id})); assert.equal(cs.phase, 'completed', JSON.stringify(cs));
  assert.equal(seatOf(c), nearest[0].target!.id);
  // dry run first: no receipt, no event, no movement
  const before = {receipts: (w.f.db.db.prepare('SELECT COUNT(*) n FROM edge_receipts_v1').get() as any).n, events: w.f.db.events(w.f.host.worldId).length, at: w.pos(a)};
  const r1 = await dry(a, {verb: 'sit', target: {nearest: 'seat', near: b.soulId, free: true}});
  for (const q of [{verb: 'sit', target: {in: 'eden-classroom-1', row: 'front'}}, {verb: 'go', target: {place: 'shore-bank'}}, {verb: 'swim', target: {place: 'shore-water', seconds: 120}},
    {verb: 'approach', target: b.soulId, distance: 1.5}, {verb: 'turn', heading: 90}, {verb: 'look', target: b.name}, {verb: 'go', target: {place: 'region-park.pond'}}, {capability: 'walk to the pond'}, {capability: 'walk:eden-pond-north'}]) await dry(a, q);
  assert.deepEqual({receipts: (w.f.db.db.prepare('SELECT COUNT(*) n FROM edge_receipts_v1').get() as any).n, events: w.f.db.events(w.f.host.worldId).length, at: w.pos(a)}, before, 'resolve changed nothing');
  assert.equal(r1.ok, true, JSON.stringify(r1)); assert.equal(r1.would.capability, 'sit:' + nearest[1].target!.id, 'the nearest FREE seat to B (the nearest is taken)');
  // act on it: the receipt reports the same choice and A ends up in that seat
  const s1 = await act(a, {verb: 'sit', target: {nearest: 'seat', near: b.name}});
  assert.equal(s1.chosen.seat, nearest[1].target!.id, JSON.stringify(s1)); assert.equal(s1.chosen.near.name, b.name);
  assert.deepEqual((w.receipt(a, s1.receipt.id) as any).chosen.seat, nearest[1].target!.id, 'chosen is kept on the receipt');
  const s1d = await finish(a, s1); assert.equal(s1d.phase, 'completed'); assert.equal(seatOf(a), nearest[1].target!.id); assert.equal((s1d.endedAt as any).posture, 'seated');
  // look keeps posture and seat; attention receipts never replace the body's act
  const lk = await act(a, {verb: 'look', target: c.soulId}); assert.equal(lk.accepted, true, JSON.stringify(lk)); assert.equal(lk.channel, 'attention'); assert.equal(lk.chosen.turned, 'head');
  assert.equal(seatOf(a), nearest[1].target!.id); assert.equal(w.body(a).human.gaze?.target, c.entityId); assert.deepEqual(w.body(a).human.attention, [w.body(c).pose.p[0], w.body(c).pose.p[2]]);
  // front row of the classroom: a centre seat in the row nearest the lectern; the second Soul gets the other centre seat
  const f1 = await act(d, {verb: 'sit', target: {in: 'eden-classroom-1', row: 'front'}}); assert.equal(f1.chosen.row, 1, JSON.stringify(f1));
  assert.ok(['eden-classroom-seat-02', 'eden-classroom-seat-03'].includes(f1.chosen.seat), f1.chosen.seat);
  await finish(d, f1, 12000); assert.equal(seatOf(d), f1.chosen.seat);
  const f2 = await dry(b, {verb: 'sit', target: {in: 'eden-classroom-1', row: 'front'}}); assert.equal(f2.would.chosen.row, 1);
  assert.ok(['eden-classroom-seat-02', 'eden-classroom-seat-03'].includes(f2.would.chosen.seat) && f2.would.chosen.seat !== f1.chosen.seat, JSON.stringify(f2));
  const back = await dry(b, {verb: 'sit', target: {in: 'eden-classroom-1', row: 'back'}}); assert.equal(back.would.chosen.row, back.would.chosen.rows);
  // go {place}: route + walk, chosen place and ETA; arrives there
  const g = await act(b, {verb: 'go', target: {place: 'shore-bank'}}); assert.equal(g.chosen.place, 'shore-bank'); assert.ok(g.chosen.eta && g.chosen.distance > 0, JSON.stringify(g.chosen));
  const gd = await finish(b, g); assert.equal(gd.phase, 'completed'); assert.equal((gd.endedAt as any).place, 'shore-bank');
  // approach {target, distance}: ends about that far from them
  const up = await act(c, {capability: 'stand:here'}); await w.ticks(200, () => !w.open(c, up.receipt.id)); await w.put(c, [-20, 2]);
  const ap = await act(b, {verb: 'approach', target: c.name, distance: 1.5}); assert.equal(ap.chosen?.target, c.soulId, JSON.stringify(ap) + JSON.stringify([w.pos(b), w.pos(c)]));
  const apd = await finish(b, ap); assert.equal(apd.phase, 'completed', JSON.stringify(apd));
  const gap = Math.hypot(w.pos(b)[0] - w.pos(c)[0], w.pos(b)[1] - w.pos(c)[1]); assert.ok(gap > 0.9 && gap < 2.6, 'gap ' + gap);
  // turn {heading}: a free standing body turns; turn {target: a thing}
  const tn = await act(b, {verb: 'turn', heading: 270}); assert.equal(tn.chosen.turned, 'body', JSON.stringify(tn)); assert.equal(headingOfYaw(w.body(b).pose.yaw), 270);
  const tf = await act(b, {verb: 'turn', target: 'fire'}); assert.equal(tf.accepted, true, JSON.stringify(tf)); assert.equal(tf.chosen.kind, 'fire');
  // swim {place, seconds}: laps chosen for the time asked
  const sw = await act(b, {verb: 'swim', target: {place: 'shore-water', seconds: 120}}); assert.equal(sw.accepted, true, JSON.stringify(sw)); assert.equal(sw.chosen.laps, 5); assert.equal(sw.chosen.place, 'shore-water');
  const notWater = await act(b, {verb: 'swim', target: {place: 'eden-library-1'}}); assert.equal(notWater.accepted, false); assert.equal(notWater.code, 'swim.not-swimmable');
  const st = await act(b, {capability: 'stand:here'}); assert.equal(st.accepted, true);
  // refusals are honest
  assert.equal((await act(a, {verb: 'sit', target: {nearest: 'seat', near: 'Nobody Here'}})).code, 'target.not-in-sight');
  assert.equal((await act(a, {verb: 'look', target: 'the moon'})).code, 'target.not-in-sight');
  assert.equal((await act(a, {verb: 'sit', target: {in: 'eden-nowhere'}})).code, 'place.unknown');
  assert.deepEqual(w.f.host.engine.runtime.violations, []);
  await w.replayExact();
});

test('channels: attention never cancels the body; speech and conversation never stop a walk; auto-face to the speaker', {timeout: 600000}, async t => {
  const w = await coreAWorld(3); t.after(() => w.close());
  const [a, b, c] = w.souls;
  const act = async (s: typeof a, body: object) => (await w.http(s, 'POST', '/v1/edge/act', body)).body;
  await w.put(a, [14, 4]); await w.put(b, [15.5, 4]); await w.put(c, [13, 5]);
  // a long walk; look, turn, face, say and converse while it runs
  const walk = await act(a, {capability: 'walk:shore-bank'}); assert.equal(walk.accepted, true, JSON.stringify(walk));
  await w.ticks(60); assert.equal(w.receipt(a, walk.receipt.id).phase, 'started');
  const start = w.pos(a);
  for (const q of [{verb: 'look', target: b.name}, {capability: `face:${b.soulId}`}, {capability: `look at ${c.name}`}, {verb: 'turn', face: b.soulId}, {verb: 'look', direction: 'left'}]) {
    const r = await act(a, q); assert.equal(r.accepted, true, JSON.stringify(q) + JSON.stringify(r)); assert.equal(r.channel, 'attention', JSON.stringify(r));
    assert.equal(w.receipt(a, walk.receipt.id).phase, 'started', 'the walk goes on after ' + JSON.stringify(q));
  }
  const said = (await w.http(a, 'POST', '/v1/edge/say', {text: 'Off to the pond!'})).body; assert.ok(said.said, JSON.stringify(said));
  const cv: any = w.comms.conversations.handle(b, {op: 'start', with: [a.soulId], text: 'where are you going?'});
  if (cv.accepted) {w.comms.conversations.handle(a, {op: 'accept', conversation: cv.conversation.id}); w.comms.conversations.handle(a, {op: 'say', conversation: cv.conversation.id, text: 'the pond'});}
  else t.diagnostic('conversation not started (A already out of reach): ' + cv.code);
  assert.equal(w.receipt(a, walk.receipt.id).phase, 'started', 'speech and conversation never stop the walk');
  await w.ticks(9000, () => !w.open(a, walk.receipt.id));
  assert.equal(w.receipt(a, walk.receipt.id).phase, 'completed', JSON.stringify(w.receipt(a, walk.receipt.id)));
  assert.ok(Math.hypot(w.pos(a)[0] - start[0], w.pos(a)[1] - start[1]) > 20, 'it really walked');
  assert.equal(w.ledger.openReceipts(a.soulId).length, 0);
  // auto-face (default on): B and C talk; when C speaks, B's head turns to C
  await w.put(b, [10, 10]); await w.put(c, [12, 10]);
  await act(b, {verb: 'look', direction: 'ahead'});
  const talk: any = w.comms.conversations.handle(b, {op: 'start', with: [c.soulId], text: 'hello'}); assert.equal(talk.accepted, true, JSON.stringify(talk));
  w.comms.conversations.handle(c, {op: 'accept', conversation: talk.conversation.id});
  w.comms.conversations.handle(c, {op: 'say', conversation: talk.conversation.id, text: 'hi there'}); await w.ticks(5);
  assert.equal(w.body(b).human.gaze?.kind, 'auto'); assert.equal(w.body(b).human.gaze?.target, c.entityId);
  // turned off for this conversation: no more auto-face
  const off = await act(b, {verb: 'auto-face', on: false, conversation: talk.conversation.id}); assert.equal(off.accepted, true, JSON.stringify(off));
  await act(b, {verb: 'look', direction: 'ahead'}); await w.ticks(5);
  w.comms.conversations.handle(c, {op: 'say', conversation: talk.conversation.id, text: 'still here'}); await w.ticks(5);
  assert.equal(w.body(b).human.gaze, undefined, 'auto-face off');
  // the attention events are logged and replay exactly
  assert.ok(w.f.db.events(w.f.host.worldId).filter(e => e.kind === ('edge-attention' as never)).length >= 6);
  assert.deepEqual(w.f.host.engine.runtime.violations, []);
  await w.replayExact();
});
