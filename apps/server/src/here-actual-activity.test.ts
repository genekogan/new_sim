import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import type {WorldState as NativeWorld} from '../../../mars/viewer/engine/world/types.ts';
import {fixture, factory, invite, accept} from '../test/native-owner-fixture.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {hereFrame} from './edge/perception/here.ts';

async function world(t: TestContext) {
  const f = fixture(':memory:', factory, {durableClockV1: true}); f.brain.quiesce();
  const ledger = new EdgeLedger(f.host, f.db, undefined, {spots: {contract: 'activity-spots/1', spots: [
    {id: 'test-reading', activity: 'read', base: 'idle', at: [8, 0], faceTo: [8, 1], prop: 'book'},
    {id: 'test-guitar', activity: 'play-music', base: 'idle', at: [-8, 0], faceTo: [-8, 1], instrument: 'guitar'},
  ]}});
  t.after(() => {f.brain.quiesce(); f.host.stop(); ledger.comms?.close(); f.db.close();});
  assert.deepEqual(ledger.spotsRefused, []);
  await invite(f, 'activity-observer');
  const row = await accept(f.host, f.souls.create('dev:activity-observer', {name: 'Activity Observer', description: 'synthetic native readback regression'}));
  const soul = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner};
  const native = f.host.engine.world as NativeWorld;
  const body = () => native.entities[soul.entityId];
  const tickUntil = async (done: () => boolean, limit = 1200) => {
    for (let i = 0; i < limit && !done(); i++) {
      f.host.tickOnce();
      if (i % 20 === 0) {await setImmediate(); f.host.drainInputs();}
    }
    assert.ok(done(), 'native condition reached within the bounded fixture journey');
  };
  const frame = () => hereFrame(ledger, soul);
  return {...f, ledger, soul, native, body, tickUntil, frame};
}

test('here separates read/music intent from native approach, then reports actual reading and instrument play', async t => {
  const w = await world(t);
  for (const [capability, intent, target, actual, instrument] of [
    ['read:test-reading', 'read', [8, 0], 'read', undefined],
    ['play-music:test-guitar', 'play-music', [-8, 0], 'play-music', 'guitar'],
  ] as const) {
    const started = await accept(w.host, w.ledger.act(w.soul, {capability, params: {seconds: 5}}));
    assert.equal(started.accepted, true, JSON.stringify(started)); if (!started.accepted) return;
    await w.tickUntil(() => w.body().human?.activity === 'walk' && Math.hypot(w.body().pose.p[0] - target[0], w.body().pose.p[2] - target[1]) > 2);
    const approaching = w.frame();
    assert.equal(approaching.me.activity.kind, intent, 'the open receipt describes the requested activity');
    assert.deepEqual(approaching.me.actualActivity, {kind: 'walk'}, 'approaching a book or instrument is still native walking');
    assert.equal(approaching.me.actualActivity?.kind, w.body().human!.activity);
    assert.ok(w.ledger.openReceipts(w.soul.soulId).some(r => r.id === started.receipt.id));

    await w.tickUntil(() => w.body().human?.activity === actual);
    const doing = w.frame();
    assert.equal(doing.me.activity.kind, intent);
    assert.equal(doing.me.actualActivity?.kind, actual);
    assert.equal(doing.me.actualActivity?.instrument, instrument);
    assert.equal(doing.me.actualActivity?.instrument, w.body().human!.instrument);
    assert.ok(Math.hypot(w.body().pose.p[0] - target[0], w.body().pose.p[2] - target[1]) < .6, 'the actual activity starts at the native destination');

    await w.tickUntil(() => !['waiting', 'started'].includes(w.ledger.receipt(w.soul.soulId, started.receipt.id)!.phase));
    assert.equal(w.ledger.receipt(w.soul.soulId, started.receipt.id)!.phase, 'completed');
  }
  assert.deepEqual(w.host.engine.runtime.violations, []);
});

test('here does not invent idle when the native body or its activity observation is unavailable', async t => {
  const w = await world(t), body = w.body();
  delete w.native.entities[w.soul.entityId];
  try {
    // Native binding rejects a missing body before the projection is returned;
    // keep that fail-closed boundary instead of mocking a fabricated frame.
    assert.throws(() => w.frame(), /human-capabilities\.body-unavailable/);
  } finally {w.native.entities[w.soul.entityId] = body;}
  const human = body.human! as unknown as Record<string, unknown>, activity = human.activity;
  delete human.activity;
  try {assert.equal(w.frame().me.actualActivity, null, 'missing native activity is unknown, not inferred idle');}
  finally {human.activity = activity;}
});
