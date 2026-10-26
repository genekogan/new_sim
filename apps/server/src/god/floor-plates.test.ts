// Floors (2026-10-26, Gene's Chiba report): a mesh def's measured floor plate is a level-0 floor a step up, so every body
// inside its footprint stands on it (GroundNav.standY), and a seat standing on it is sat on at its top.
import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {fixture, factory} from '../../test/native-owner-fixture.ts';
import {EdgeLedger} from '../edge/ledger/ledger.ts';
import {GodMode} from './god.ts';
import {installEngineBridge} from './engine-bridge.ts';
import {GroundHost} from './ground-host.ts';
import {FLOOR_PLATES, plateIsStep, STEP_UP} from './floor-plates.ts';

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
