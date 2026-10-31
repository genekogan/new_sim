import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync, mkdirSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import {Hono} from '../../apps/server/node_modules/hono/dist/index.js';
import {fixture, invite, accept, factory} from '../../apps/server/test/native-owner-fixture.ts';
import {EdgeLedger} from '../../apps/server/src/edge/ledger/ledger.ts';
import {mountEdgeRoutes} from '../../apps/server/src/edge/routes.ts';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {installEngineBridge} from '../../apps/server/src/god/engine-bridge.ts';
import {HANDOVER_GAP, CONTACT_SECONDS} from '../../mars/viewer/engine/items/handover.ts';

// Entry 41 (packet 8): a consensual hand-over of a carried lantern (and the bowl, same mechanism) by plain words. Offer,
// the offeree's one line, decline / withdraw / lapse leave it with the giver, nobody moved before accepting, one holder
// in every tick with one change while both hands are on it, a receiver who stops mid-reach, refusals (hands full, hands
// empty, nobody else picks it up), 100 distant hand-overs +0 bytes.
const out = process.env.SOUL_ACTIONS_OUT;
test('consensual hand-over: offer, accept, decline, withdraw, lapse; one owner at a time', {timeout: 900000}, async t => {
  const f = fixture(':memory:', factory, {durableClockV1: true}); f.brain.quiesce();
  const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false}); const app = new Hono(); let soul;
  const comms = mountEdgeRoutes(app, {host: f.host, db: f.db, souls: f.souls, ledger: edge, soul: () => soul});
  t.after(() => {comms.close(); f.host.stop(); f.db.close();});
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
  installEngineBridge({host: f.host, god, edge, log() {}, worldLore: false, worldClock: false});
  const tick = async (n = 5) => {for (let i = 0; i < n; i++) {f.host.tickOnce(); await setImmediate(); f.host.drainInputs();}};
  await tick();
  const join = async (id, name) => {await invite(f, id); const row = await accept(f.host, f.souls.create('dev:' + id, {name, description: 'Hand-over test'})); await tick(); return {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner};};
  const ana = await join('ana', 'Ana'), ben = await join('ben', 'Ben'), cy = await join('cy', 'Cy');
  const W = () => f.host.engine.world, body = s => W().entities[s.entityId], at = s => [body(s).pose.p[0], body(s).pose.p[2]];
  const here = async s => {soul = s; const r = await app.request('/v1/edge/here'); assert.equal(r.status, 200); return (await r.json()).here;};
  const sz = x => Buffer.byteLength(JSON.stringify(x));
  const put = async (s, x, z) => {await accept(f.host, f.host.enqueue('edge-relocate', `edge:${s.soulId}`, {soulId: s.soulId, entityId: s.entityId, to: [x, z], why: 'test placement'})); await tick(3);};
  const [ax, az] = at(ana);
  await put(ben, ax + 2.6, az + 0.4); await put(cy, ax - 1.5, az + 3.2); await tick(20);
  const absent = await here(ben), absentCy = await here(cy), absentAna = await here(ana);
  const ok = r => {assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 500)); return r;};
  // ---- 100 distant hand-overs: far bodies mid-offer and mid-reach with lanterns in hand, 100 pending offers among them
  const report = {status: 'fail', hereBytes: {}, checks: [], refusals: {}, lines: {}, handOvers: []};
  // far, on the floor (this fixture's ground is [-30, 30]²; a body off it is a fault the world sets aside): the far
  // corner, beyond the 15 m object radius from all three Souls; pairs 1.6 m apart, rows 1.5 m
  const [gx0, gz0, gx1, gz1] = f.host.engine.groundBoundsV1(), FX = ax <= (gx0 + gx1) / 2 ? gx1 - 17 : gx0 + 2, FZ = az <= (gz0 + gz1) / 2 ? gz1 - 17 : gz0 + 2;
  ok(god.act({ops: Array.from({length: 100}, (_, i) => ({op: 'place', def: 'core/lantern@3', name: `far-lantern-${i}`, p: [FX + (i % 10) * 1.6 + .45, FZ + Math.floor(i / 10) * 1.5 + .07]}))}));
  await tick(20);
  const named = n => [...god.model.entities.values()].find(e => e.name === n)?.id;
  const ents = W().entities;
  for (let i = 0; i < 200; i++) {
    const id = `far_${i}`, e = structuredClone(body(cy)); e.id = id; e.label = `Far ${i}`; delete e.human.task; ents[id] = e;
    const k = Math.floor(i / 2), giver = i % 2 === 0; e.pose.p = [FX + k % 10 * 1.6 + (giver ? 0 : HANDOVER_GAP), 0, FZ + Math.floor(k / 10) * 1.5]; e.pose.yaw = giver ? 0 : Math.PI;
    const lantern = named(`far-lantern-${k}`), x = ents[lantern];
    if (giver) {x.support = {kind: 'in-hand', by: id, hand: 'right'}; x.phase = undefined; e.human.hands = {right: [e.pose.p[0] + .45, 1.04, e.pose.p[2] + .07]}; e.human.heldItemsV1 = {right: lantern}; e.human.itemTransferV1 = {item: lantern, hand: 'right', action: `far-a${k}`, mode: 'put', startTick: 1, reachTick: 1, target: [e.pose.p[0] + .45, 1.04, e.pose.p[2] + .07], hold: true};}
    else {e.human.hands = {left: [e.pose.p[0] - .45, 1.04, e.pose.p[2] - .01]}; e.human.itemTransferV1 = {item: lantern, hand: 'left', action: `far-b${k}`, mode: 'take', startTick: 1, reachTick: 1, target: [e.pose.p[0] - .45, 1.04, e.pose.p[2] - .01], hold: true};}
  }
  for (let i = 0; i < 100; i++) f.db.db.prepare('INSERT INTO edge_invites_v1 (world_id,invite_id,state,body,created_at) VALUES (?,?,?,?,?)').run(f.host.worldId, `inv_far${i}`, 'pending', JSON.stringify({id: `inv_far${i}`, what: 'hand-over', kind: 'give', host: {soulId: `s_far${i * 2}`, name: `Far ${i * 2}`}, guests: [{soulId: `s_far${i * 2 + 1}`, name: `Far ${i * 2 + 1}`}], capability: 'x', label: 'wants to give you the lantern', thing: {id: named(`far-lantern-${i}`), name: 'lantern'}, createdTick: W().tick, expiresTick: W().tick + 1e9, state: 'pending', responses: {}, hostReceipt: null, guestReceipts: {}}), Date.now());
  await tick(10);
  const far = await here(ben), farCy = await here(cy), farAna = await here(ana);
  assert.equal(f.db.events(f.host.worldId, 0).filter(e => e.kind === 'rules' && e.payload?.recovery).length, 0, 'the distant scene raised no engine fault (nothing set aside): ' + JSON.stringify(f.db.events(f.host.worldId, 0).filter(e => e.kind === 'rules' && e.payload?.recovery).map(e => e.payload.recovery.reason)).slice(0, 900) + ' at ' + [FX - ax, FZ - az]);
  assert.ok(Object.keys(W().entities).filter(id => id.startsWith('far_')).length === 200 && W().entities[named('far-lantern-0')].support.kind === 'in-hand', 'the distant hand-overs are there');
  report.distantScene = {from: [FX, FZ], to: [FX + 9 * 1.6 + HANDOVER_GAP, FZ + 13.5], nearestSoul: +Math.min(...[ana, ben, cy].map(q => Math.hypot(at(q)[0] - FX, at(q)[1] - FZ))).toFixed(1)};
  assert.equal(sz(far), sz(absent), '100 distant hand-overs and their offers add nothing to here'); assert.equal(sz(farCy), sz(absentCy)); assert.equal(sz(farAna), sz(absentAna));
  assert.ok(!/Far |far_|lantern|holds out/.test(JSON.stringify([far, farCy, farAna])), 'no names, no lines');
  // ---- the scene: a table beside Ana with the lantern and the bowl on it
  ok(god.act({ops: [{op: 'place', def: 'core/table@1', name: 'table', p: [ax - 1.6, az]}, {op: 'place', def: 'core/lantern@3', name: 'lantern', in: {parent: 'table', slot: 'top'}, p: [-.2, 0]}, {op: 'place', def: 'core/bowl@2', name: 'bowl', in: {parent: 'table', slot: 'top'}, p: [.25, 0]}]}));
  await tick(60);
  const lantern = named('lantern'), bowl = named('bowl'), item = id => W().entities[id];
  let retries = 0;
  const act = async (s, capability, params, want = true) => {let b; for (let k = 0; k < 20; k++) {soul = s; const r = await accept(f.host, app.request('/v1/edge/act', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({capability, ...(params ? {params} : {})})})); b = await r.json(); if (b.code !== 'object.admission-failed') break; retries++; await tick(10);} assert.equal(b.accepted, want, capability + ' ' + JSON.stringify(b).slice(0, 500)); return b;};
  const receipt = (s, b) => edge.receipt(s.soulId, b.receipt.id);
  const until = async (cond, limit = 1200) => {for (let n = 0; n < limit; n++) {if (cond()) return n; await tick(1);} return -1;};
  const ended = (s, b) => ['completed', 'failed', 'cancelled', 'replaced'].includes(receipt(s, b)?.phase);
  const messages = s => f.db.db.prepare('SELECT kind,body FROM edge_comms_stream WHERE world_id=? AND soul_id=? ORDER BY seq').all(f.host.worldId, s.soulId).map(r => ({kind: r.kind, ...JSON.parse(r.body)}));
  const holder = id => {const s = item(id).support; return s?.kind === 'in-hand' ? s.by : s?.kind ?? 'none';};
  const pick = await act(ana, 'pick-up:' + lantern); assert.ok(await until(() => ended(ana, pick)) >= 0); assert.equal(receipt(ana, pick).phase, 'completed');
  assert.equal(holder(lantern), ana.entityId); assert.equal(item(lantern).support.hand, 'right');
  await tick(30);
  const nearHeld = await here(ana); report.lines.holding = nearHeld.me.holding;
  /** Every tick of one offer until both receipts end: the item's holder, hand points, positions. */
  const watch = async (rs, limit = 1600) => {
    const log = [];
    const busy = () => [ana, ben, cy].some(s => {const t = body(s).human.task; return !!t && f.host.engine.runtime.records.get(t)?.verb === 'hand_over_v1';});
    for (let n = 0; n < limit && !(rs.every(([s, r]) => ended(s, r)) && !busy()); n++) {
      await tick(1);
      const A = body(ana), B = body(ben), C = body(cy), x = item(lantern), y = item(bowl);
      log.push({tick: W().tick, lantern: holder(lantern), bowl: holder(bowl), lp: [...x.pose.p], ly: x.pose.yaw, bp: [...y.pose.p], by: y.pose.yaw,
        bodies: Object.fromEntries([['ana', A], ['ben', B], ['cy', C]].map(([n, e]) => [n, {p: [...e.pose.p], yaw: e.pose.yaw, hands: structuredClone(e.human.hands ?? {}), tr: structuredClone(e.human.itemTransferV1 ?? null), act: e.human.activity}]))});
    }
    return log;
  };
  const benAt0 = at(ben), benYaw0 = body(ben).pose.yaw;
  const keptCheck = (log, name) => {
    assert.ok(log.length >= 19, name + ' lowered over the lowering (' + log.length + ' ticks)');
    assert.ok(log.every(s => s.lantern === ana.entityId), name + ': the lantern never leaves Ana\'s hand');
    const last = log.at(-1).bodies.ana;
    assert.equal(item(lantern).support.hand, 'right');
    return {ticks: log.length, benMoved: Math.hypot(at(ben)[0] - benAt0[0], at(ben)[1] - benAt0[1]), benTurned: Math.abs(body(ben).pose.yaw - benYaw0), anaHandAtEnd: last.hands.right};
  };
  // ---- 1) declined
  const cyBefore = await here(cy), benBefore = await here(ben);
  const g1 = await act(ana, 'give the lantern to Ben');
  assert.ok(await until(() => edge.together.invitesFor(ben.soulId).length > 0) >= 0);
  const benOffer = await here(ben); report.lines.offer = benOffer.me.offer;
  assert.match(benOffer.me.offer ?? '', /^Ana holds out the lantern for you: accept or decline \(\d+ s\)$/);
  assert.ok(!(await here(cy)).me.offer, 'the bystander sees no offer');
  const cyDuring = await here(cy);
  {const strip = h => JSON.stringify(h).replace(/"(?:bearing|facing|heading|distance|pos)":[^,}]*/g, ''); report.bystanderDiff = sz(cyDuring) - sz(cyBefore); assert.ok(Math.abs(report.bystanderDiff) <= 40 && !/holds out|wants to give|offer/.test(strip(cyDuring)), 'the bystander: ' + report.bystanderDiff);}
  assert.ok(!/holds out|wants to give/.test(JSON.stringify(cyDuring)), 'the bystander is told nothing of the offer');
  assert.match((await here(ana)).me.activity.kind, /inviting/);
  // the giver walks over and holds it out; Ben is not moved
  assert.ok(await until(() => body(ana).human.itemTransferV1?.hold === true && W().tick > body(ana).human.itemTransferV1.reachTick + 22, 900) >= 0, 'Ana holds the lantern out');
  {const d = Math.hypot(at(ana)[0] - at(ben)[0], at(ana)[1] - at(ben)[1]); report.offerDistance = +d.toFixed(3); assert.ok(d >= .8 && d <= .95, 'facing at a hand-over distance ' + d);}
  assert.deepEqual(at(ben), benAt0, 'Ben does not move before answering'); assert.equal(body(ben).pose.yaw, benYaw0);
  report.refusals.otherPickUp = (await act(cy, 'pick-up:' + lantern, undefined, false)).code;
  const d1 = await act(ben, 'decline'); const l1 = await watch([[ana, g1]]);
  assert.equal(receipt(ana, g1).code, 'invite.declined'); report.kept = {declined: keptCheck(l1, 'declined')};
  const afterDecline = await act(ben, 'accept', undefined, false); report.refusals.acceptAfterDecline = afterDecline.code; assert.equal(afterDecline.code, 'invite.none');
  assert.ok(!(await here(ben)).me.offer, 'the declined offer line is gone');
  // ---- 2) withdrawn
  await tick(30);
  const g2 = await act(ana, 'give the lantern to Ben'); assert.ok(await until(() => edge.together.invitesFor(ben.soulId).length > 0) >= 0);
  assert.ok(await until(() => body(ana).human.itemTransferV1?.hold === true, 900) >= 0); await tick(30);
  await act(ana, 'withdraw my offer'); const l2 = await watch([[ana, g2]]);
  assert.equal(receipt(ana, g2).code, 'invite.withdrawn'); report.kept.withdrawn = keptCheck(l2, 'withdrawn');
  assert.match(messages(ben).at(-1)?.text ?? '', /withdrew the offer \(the lantern\)/);
  // ---- 3) lapsed
  await tick(30);
  const g3 = await act(ana, 'give the lantern to Ben'); const l3 = await watch([[ana, g3]], 1400);
  assert.equal(receipt(ana, g3).code, 'invite.expired'); report.kept.lapsed = keptCheck(l3, 'lapsed');
  assert.ok(!(await here(ben)).me.offer, 'the lapsed offer line is gone');
  assert.deepEqual(at(ben), benAt0, 'Ben was never moved by the three offers'); assert.equal(body(ben).pose.yaw, benYaw0);
  /** The hand-over itself, from the per-tick log: one change of holder while both hands are on it. */
  const handOverCheck = (log, id, giver, taker, name) => {
    const hk = s => s === 'lantern' ? 'lantern' : 'bowl', key = id === lantern ? 'lantern' : 'bowl', P = id === lantern ? 'lp' : 'bp', Y = id === lantern ? 'ly' : 'by';
    const seq = log.map(s => s[key]), changes = seq.filter((v, i) => i && v !== seq[i - 1]).length;
    assert.ok(seq.every(v => v === giver.entityId || v === taker.entityId), name + ': in a hand in every tick: ' + [...new Set(seq)]);
    assert.equal(changes, 1, name + ': exactly one change of holder'); assert.equal(seq.at(-1), taker.entityId);
    const k = seq.indexOf(taker.entityId), s0 = log[k - 1], s1 = log[k];
    const gn = giver === ana ? 'ana' : giver === ben ? 'ben' : 'cy', tn = taker === ana ? 'ana' : taker === ben ? 'ben' : 'cy';
    const gt = s0.bodies[gn].tr, tt = s0.bodies[tn].tr, gh = s0.bodies[gn].hands[gt.hand], th = s0.bodies[tn].hands[tt.hand];
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    // contact: both hands on their contact points for at least CONTACT_SECONDS before the change
    let contact = 0; for (let i = k - 1; i >= 0; i--) {const s = log[i], a = s.bodies[gn], b = s.bodies[tn]; if (!a.tr || !b.tr || !a.hands[a.tr.hand] || !b.hands[b.tr.hand] || dist(a.hands[a.tr.hand], a.tr.target) > .01 || dist(b.hands[b.tr.hand], b.tr.target) > .01) break; contact++;}
    const centre = s0[P], split = [dist([gh[0], 0, gh[2]], [centre[0], 0, centre[2]]), dist([th[0], 0, th[2]], [centre[0], 0, centre[2]])];
    const gap = Math.hypot(s0.bodies[gn].p[0] - s0.bodies[tn].p[0], s0.bodies[gn].p[2] - s0.bodies[tn].p[2]);
    const face = (a, b) => {const want = Math.atan2(b.p[2] - a.p[2], b.p[0] - a.p[0]); return Math.abs(Math.atan2(Math.sin(a.yaw - want), Math.cos(a.yaw - want)));};
    // over the hand-over itself: from the giver's raise to the end (the walk over with it in hand is a carry)
    const i0 = Math.max(1, log.findIndex(s => s.bodies[gn].tr) + 1);
    let itemStep = 0, yawStep = 0; for (let i = i0; i < log.length; i++) {itemStep = Math.max(itemStep, dist(log[i][P], log[i - 1][P])); yawStep = Math.max(yawStep, Math.abs(Math.atan2(Math.sin(log[i][Y] - log[i - 1][Y]), Math.cos(log[i][Y] - log[i - 1][Y]))));}
    const r = {ticks: log.length, changeTick: s1.tick, contactSeconds: +(contact * .05).toFixed(2), giverHandError: +dist(gh, gt.target).toFixed(4), takerHandError: +dist(th, tt.target).toFixed(4), palmsFromCentre: split.map(v => +v.toFixed(3)), palmsApart: +dist(gh, th).toFixed(3), baseHeight: +(centre[1] - gh[1]).toFixed(4),
      gap: +gap.toFixed(3), facing: [+face(s0.bodies[gn], s0.bodies[tn]).toFixed(3), +face(s0.bodies[tn], s0.bodies[gn]).toFixed(3)], itemStepMax: +itemStep.toFixed(4), itemYawStepMax: +yawStep.toFixed(4), givenWith: gt.hand, takenWith: tt.hand};
    assert.ok(contact * .05 >= .4 && contact >= Math.round(CONTACT_SECONDS / .05) - 1, name + ': both hands on it before the change ' + JSON.stringify(r));
    assert.ok(r.giverHandError <= .01 && r.takerHandError <= .01, name + ' hands on their points');
    assert.ok(split.every(v => v <= .06), name + ': both palms under the base ' + split);
    assert.ok(gap >= .8 && gap <= .95, name + ': hand-over distance ' + gap); assert.ok(r.facing.every(v => v <= .1), name + ': facing ' + r.facing);
    assert.ok(itemStep <= .05, name + ': the item never jumps ' + itemStep); assert.ok(yawStep <= .1, name + ': nor spins ' + yawStep);
    // the giver's hand leaves after the change; the taker's carries it in
    const after = log.slice(k).find(s => !s.bodies[gn].tr || s.bodies[gn].tr.releaseTick !== undefined);
    assert.ok(after, name + ': the giver lets go and its hand comes back');
    return r;
  };
  // ---- 4) accepted: the hand-over
  await tick(30);
  const g4 = await act(ana, 'give the lantern to Ben'); assert.ok(await until(() => edge.together.invitesFor(ben.soulId).length > 0) >= 0);
  assert.ok(await until(() => body(ana).human.itemTransferV1?.hold === true, 900) >= 0); await tick(10);
  const offering = await here(ben); report.hereBytes.offereeWithOffer = sz(offering);
  const a4 = await act(ben, 'accept'); const l4 = await watch([[ana, g4], [ben, a4]]);
  assert.equal(receipt(ana, g4).phase, 'completed', JSON.stringify(receipt(ana, g4))); assert.equal(receipt(ben, a4).phase, 'completed', JSON.stringify(receipt(ben, a4)));
  report.handOvers.push({what: 'lantern Ana → Ben', ...handOverCheck(l4, lantern, ana, ben, 'lantern')});
  assert.equal(holder(lantern), ben.entityId);
  report.lines.receipts = [receipt(ana, g4).outcome?.summary, receipt(ben, a4).outcome?.summary];
  assert.equal(report.lines.receipts[0], 'Gave the lantern to Ben; it is in Ben\'s hand now.'); assert.equal(report.lines.receipts[1], 'Took the lantern from Ana; you are holding it.');
  await tick(20);
  const benHolding = await here(ben); assert.match(benHolding.me.holding ?? '', /lantern$/); assert.ok(!(await here(ana)).me.holding);
  report.hereBytes.takerHolding = sz(benHolding);
  // ---- refusals: hands empty, hands full, nobody else picks it up
  report.refusals.giveEmptyHanded = (await act(ana, 'give the lantern to Ben', undefined, false)).code; assert.equal(report.refusals.giveEmptyHanded, 'hands.empty');
  assert.equal(report.refusals.otherPickUp, 'capability.unknown', 'a held lantern is offered to nobody else');
  // ---- 5) back to Ana; Ana stops mid-reach (the lantern stays with Ben); then "take the lantern"
  const g5 = await act(ben, 'give the lantern to Ana'); assert.ok(await until(() => edge.together.invitesFor(ana.soulId).length > 0) >= 0);
  const a5 = await act(ana, 'accept');
  assert.ok(await until(() => body(ana).human.itemTransferV1?.mode === 'take' && W().tick > body(ana).human.itemTransferV1.reachTick + 8, 900) >= 0, 'Ana reaches for it');
  const stop = await act(ana, 'stand:here'); const l5 = await watch([[ben, g5], [ana, a5]]);
  assert.ok(l5.every(s => s.lantern === ben.entityId), 'a receiver who stops mid-reach leaves it with the giver');
  report.receiverStops = {giver: receipt(ben, g5).code, receiver: receipt(ana, a5).phase + ' ' + (receipt(ana, a5).code ?? '')};
  assert.equal(receipt(ben, g5).phase, 'failed');
  await tick(40);
  const g6 = await act(ben, 'give the lantern to Ana'); assert.ok(await until(() => edge.together.invitesFor(ana.soulId).length > 0) >= 0);
  const a6 = await act(ana, 'take the lantern'); const l6 = await watch([[ben, g6], [ana, a6]]);
  assert.equal(receipt(ben, g6).phase, 'completed'); assert.equal(receipt(ana, a6).phase, 'completed');
  report.handOvers.push({what: 'lantern Ben → Ana ("take the lantern")', ...handOverCheck(l6, lantern, ben, ana, 'lantern back')});
  // ---- 6) the bowl: Cy picks it up and gives it to Ben (the same action, a different object); Ana's full hands refuse
  const pb = await act(cy, 'pick-up:' + bowl); assert.ok(await until(() => ended(cy, pb)) >= 0); assert.equal(holder(bowl), cy.entityId);
  report.refusals.takerHandsFull = (await act(cy, 'give the bowl to Ana', undefined, false)).code; assert.equal(report.refusals.takerHandsFull, 'hands.full');
  const g7 = await act(cy, 'give the bowl to Ben'); assert.ok(await until(() => edge.together.invitesFor(ben.soulId).length > 0) >= 0);
  const a7 = await act(ben, 'accept'); const l7 = await watch([[cy, g7], [ben, a7]]);
  assert.equal(receipt(cy, g7).phase, 'completed'); assert.equal(receipt(ben, a7).phase, 'completed');
  report.handOvers.push({what: 'bowl Cy → Ben', ...handOverCheck(l7, bowl, cy, ben, 'bowl')});
  assert.deepEqual(f.host.engine.runtime.violations, []);
  report.hereBytes = {...report.hereBytes, offereeBeforeOffer: sz(benBefore), bystanderBeforeOffer: sz(cyBefore), absent: sz(absent), distant100HandOvers: sz(far), bystanderAbsent: sz(absentCy), bystanderDistant: sz(farCy), bystanderDuringOffer: sz(cyDuring), offereeNoOffer: sz(far), giverHolding: sz(nearHeld), offerLineBytes: Buffer.byteLength(JSON.stringify({offer: benOffer.me.offer}))};
  Object.assign(report, {status: 'pass', retries, checks: ['offer in plain words; the offeree alone sees one line; the giver is inviting', 'declined, withdrawn, lapsed: the lantern stays in Ana\'s right hand every tick', 'decline is final (invite.none after)', 'Ben never moved before answering', 'one holder in every tick, one change, while both hands are on it for >= 0.4 s', 'facing at 0.80-0.95 m, palms under the base, no item jump or spin', 'a receiver who stops mid-reach leaves it with the giver', 'refused: hands empty, hands full; a held lantern is offered to nobody else', 'the bowl by the same action', '100 distant hand-overs +0 bytes']});
  if (out) {mkdirSync(out, {recursive: true}); writeFileSync(`${out}/summary.json`, JSON.stringify(report, null, 2));}
  console.log(JSON.stringify(report));
});
