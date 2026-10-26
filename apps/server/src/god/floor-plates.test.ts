// Floors (2026-10-26, Gene's Chiba report): a mesh def's measured floor plate is a level-0 floor a step up, so every body
// inside its footprint stands on it (GroundNav.standY), and a seat standing on it is sat on at its top.
import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {fixture, factory, invite, accept} from '../../test/native-owner-fixture.ts';
import {EdgeLedger} from '../edge/ledger/ledger.ts';
import {GodMode} from './god.ts';
import {installEngineBridge} from './engine-bridge.ts';
import {GroundHost} from './ground-host.ts';
import {FLOOR_PLATES, plateIsStep, STEP_UP} from './floor-plates.ts';
import {bodyEnd, hereFrame} from '../edge/perception/here.ts';
import {aroundFrame} from '../edge/perception/around.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
test('the step rule: a plate up to 0.45 m above the terrain is a step (level 0); higher is a floor of its own', () => {
  assert.equal(STEP_UP, 0.45);
  assert.equal(plateIsStep(0.374, 0), true, 'the Chiba deck');
  assert.equal(plateIsStep(0.45, 0), true);
  assert.equal(plateIsStep(0.6, 0), false, 'a 0.6 m stage needs a stair');
  assert.equal(plateIsStep(1.2, 0.9), true, 'measured from the terrain under it');
  const [deck] = FLOOR_PLATES['core-mars-chiba'];
  assert.equal(deck.y, 0.374);
});

function world(t: TestContext) {
  const w = fixture(':memory:', factory, {durableClockV1: true});
  w.brain.quiesce();
  const god = new GodMode(w.db, {worldId: w.host.worldId, ownerId: 'owner', tick: () => w.host.engine.world.tick, emit() {}});
  new GroundHost(w.db, w.host, god);
  const edge = new EdgeLedger(w.host, w.db), bridge = installEngineBridge({host: w.host, god, edge, log() {}, worldClock: false, worldLore: false});
  t.after(() => {w.brain.quiesce(); w.host.stop(); edge.comms?.close(); w.db.close();});
  const settle = async (n = 4) => {for (let i = 0; i < n; i++) {w.host.tickOnce(); await setImmediate(); w.host.drainInputs();}};
  return {...w, god, edge, bridge, settle};
}

test('Chiba (mesh def, no floors in its footprint) gets its gallery deck as a level-0 floor at 0.374 m; bodies inside stand on it', {timeout: 180_000}, async t => {
  const w = world(t); await w.settle(2);
  const r = w.god.act({ops: [{op: 'place', def: 'core/mars-chiba@2', name: 'chiba', p: [0, 0, -40], r: -1.571}]} as any) as any;
  assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 600));
  await w.settle();
  const E = w.host.engine as any, part = E.world.entityPhysicsV1.byEntity[w.god.model.get('chiba')!.id];
  const deck = (part?.surfaces ?? []).find((s: any) => Math.abs(s.y - 0.374) < 1e-6);
  assert.ok(deck, `a deck surface: ${JSON.stringify(part?.surfaces)}`);
  assert.equal(deck.level, 0, 'a step, not an upper floor');
  const sp = E.rt.services.spatial; sp.sync(E.world);
  assert.ok(sp.ground, 'a ground world');
  // the deck centre in the world: def (4.805, 0.205) turned by r = -1.571 about (0, -40)
  const c = deck.obb.c as [number, number];
  assert.ok(Math.abs(sp.ground.standY(c[0], c[1]) - 0.374) < 1e-6, `stands on the deck at ${c}: ${sp.ground.standY(c[0], c[1])}`);
  assert.ok(Math.abs(sp.ground.standY(c[0], c[1] + 30)) < 0.05, 'outside Chiba: the terrain');
});

test('the presenter timber box on the Chiba deck is sat on top (0.41 m); one standing on nothing the world walks on refuses seat.inside with the alternative', {timeout: 240_000}, async t => {
  const w = world(t); await w.settle(2);
  const r = w.god.act({ops: [
    {op: 'place', def: 'core/mars-chiba@2', name: 'chiba', p: [0, 0, -40], r: -1.571},
    {op: 'place', def: 'core/mars-presenter-timber-box@2', name: 'presenter-timber-box', p: [-1.125, 0.373, -30.335], r: -1.571},
    {op: 'place', def: 'core/mars-presenter-timber-box@2', name: 'floating-box', p: [6, 0.373, -14], r: 0},
  ]} as any) as any;
  assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 600));
  await w.settle();
  await invite(w, 'ember');
  const row: any = await accept(w.host, w.souls.create('dev:ember', {name: 'Ember', description: 'curious'}));
  await w.settle(3);
  const s = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner};
  await accept(w.host, w.host.enqueue('edge-relocate', 'test:floors', {soulId: s.soulId, entityId: s.entityId, to: [-3, -31], why: 'stand in the Chiba gallery'}));
  await w.settle(2);
  const E = w.host.engine as any, body = E.world.entities[s.entityId];
  assert.ok(Math.abs(body.pose.p[1] - 0.374) < 0.01, `Ember stands on the deck, not under it: ${JSON.stringify(body.pose.p)}`);
  const caps = w.edge.capabilities(s as any), box = w.god.model.get('presenter-timber-box')!.id, lifted = w.god.model.get('floating-box')!.id;
  const onBox = caps.find(c => c.id === `sit:${box}`), off = caps.find(c => c.id === `sit:${lifted}`);
  assert.ok(onBox?.available, `the box on the deck is offered: ${JSON.stringify(onBox)}`);
  assert.match(onBox!.label, /sit on top, 0\.41 m high/);
  assert.equal(off?.available, false, JSON.stringify(off));
  assert.equal(off!.blocked!.code, 'seat.inside');
  assert.match(off!.blocked!.reason, new RegExp(`Nearest seat you can use: sit:${box}`));
  // F3: the agent is told the floor it stands on, and where the walk ended carries it
  const here: any = hereFrame(w.edge, s as any);
  assert.ok(here.floors?.some((l: string) => /^You are standing on the raised gallery floor of chiba, 0\.37 m above the ground; open on (all four sides|its .+ sides?)\.$/.test(l)), JSON.stringify(here.floors));
  t.diagnostic(`here.floors ${JSON.stringify(here.floors)} sit ${onBox!.label}`);
  const end: any = bodyEnd(w.edge, s.soulId);
  assert.equal(end.floor, 'chiba-deck'); assert.ok(Math.abs(end.y - 0.37) < 0.02, JSON.stringify(end));
  await accept(w.host, w.host.enqueue('edge-relocate', 'test:floors', {soulId: s.soulId, entityId: s.entityId, to: [-3, -12], why: 'outside Chiba'}));
  await w.settle(2);
  const around: any = aroundFrame(w.edge, s as any);
  assert.ok(around.floors?.some((l: string) => /^The raised gallery floor of chiba: \d+ m .+, a 0\.37 m step up; open on /.test(l)), JSON.stringify(around.floors));
  t.diagnostic(`around.floors ${JSON.stringify(around.floors)} blocked ${off!.blocked!.reason}`);
  assert.equal(bodyEnd(w.edge, s.soulId)!.hasOwnProperty('floor'), false, 'off the deck: no floor in endedAt');
});
