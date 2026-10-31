import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {fixture, invite, accept} from '../test/native-owner-fixture.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {Perception, hereFrame} from './edge/perception/here.ts';
import {GodMode} from './god/god.ts';
import {installEngineBridge} from './god/engine-bridge.ts';

test('two native sofa occupants retain distinct slot identities in here and terminal receipt bodies', async t => {
  const f = fixture(':memory:', undefined, {durableClockV1: true}); f.brain.quiesce();
  const edge = new EdgeLedger(f.host, f.db);
  t.after(() => {f.brain.quiesce(); f.host.stop(); edge.comms?.close(); f.db.close();});
  const god = new GodMode(f.db, {worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit() {}});
  const bridge = installEngineBridge({host: f.host, god, edge, log() {}, worldClock: false, worldLore: false});
  const placed = god.act({ops: [{op: 'place', def: 'core/mars-navy-sofa@2', name: 'test-sofa', p: [8, 0]}]});
  assert.equal(placed.accepted, true, JSON.stringify(placed));
  const tick = async () => {f.host.tickOnce(); await setImmediate(); f.host.drainInputs();};
  for (let i = 0; i < 4; i++) await tick();
  bridge.perceive.sync(true);
  const souls = [];
  for (const owner of ['sofa-reader-a', 'sofa-reader-b']) {
    await invite(f, owner);
    const row = await accept(f.host, f.souls.create(`dev:${owner}`, {name: owner, description: 'native slot projection regression'}));
    souls.push({soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner});
  }
  const sofa = god.model.get('test-sofa')!.id, receipts = [];
  for (const soul of souls) {
    const result = await accept(f.host, edge.act(soul, {capability: `sit:${sofa}`, params: {seconds: 1}}));
    assert.equal(result.accepted, true, JSON.stringify(result)); if (!result.accepted) return;
    receipts.push(result.receipt.id);
    for (let i = 0; i < 600 && edge.receipt(soul.soulId, result.receipt.id)?.phase !== 'completed'; i++) await tick();
    assert.equal(edge.receipt(soul.soulId, result.receipt.id)?.phase, 'completed');
  }
  const seats = souls.map(soul => hereFrame(edge, soul).me.seat);
  assert.equal(new Set(seats).size, 2, 'fixture requests must retain separate native slots');
  for (const [i, soul] of souls.entries()) {
    const held = f.host.engine.nativeSeatHoldsV1!(soul.entityId);
    assert.equal(held.length, 1);
    assert.equal(seats[i], held[0].slot);
    assert.match(seats[i]!, new RegExp(`^${sofa}#seat-[123]$`));
    assert.equal((edge.receipt(soul.soulId, receipts[i])!.endedAt as {seat?: string}).seat, seats[i]);
    assert.equal(hereFrame(edge, soul).me.posture, 'seated');
  }
  // Legacy engines expose only the live request: preserve that public fallback,
  // without deriving a made-up slot from either occupant's position.
  const nativeHolds = f.host.engine.nativeSeatHoldsV1;
  f.host.engine.nativeSeatHoldsV1 = undefined;
  try {assert.equal(new Perception(edge, souls[0]).seat(), sofa);}
  finally {f.host.engine.nativeSeatHoldsV1 = nativeHolds;}
  assert.deepEqual(f.host.engine.runtime.violations, []);
});
