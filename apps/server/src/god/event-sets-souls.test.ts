// EVENTS (R6): through the real host, edge ledger, compiler and engine bridge — the god schedules a Saturday market with
// its set on a square; at 09:30 the stalls stand in the square; a Soul reads the market on the square's map place (its
// schedule slot and the on-now line that whatson shows), walks there with the ordinary walk, and finds the stalls near
// her in `here`; at 13:00 they are packed away and the square says nothing is on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { fixture, invite, accept, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { hereFrame } from '../edge/perception/here.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { isSetPiece } from './event-sets.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
test('event sets: a Soul finds the market in the map and whatson, walks to it and sees the stalls; then they are gone', { timeout: 600000 }, async (t) => {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  const bridge = installEngineBridge({ host: f.host, god, edge, log: () => {}, worldClock: true } as any);
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  await settle(2);
  const stalls = [-6, 0, 6].map((x) => ({ def: 'core/market-stall@1', p: [x, 2] }));
  const r: any = god.act({ ops: [
    { op: 'place', def: 'core/plaza@1', name: 'square', shape: { area: [[20, -10], [44, -10], [44, 10], [20, 10]] },
      schedule: { events: [{ name: 'market', label: 'Market morning', at: '09:00', minutes: 240, set: [...stalls, { def: 'core/banner@1', p: [0, -4], state: { text: 'Market morning' } }] }] } },
  ] }, 'a square with a market morning');
  assert.equal(r.accepted, true, JSON.stringify(r));
  const time = (hour: number, n: number) => { const x: any = god.act({ ops: [{ op: 'world', state: { time: { set: { hour, n } } } }] }, `time ${hour}`); assert.equal(x.accepted, true, JSON.stringify(x)); };
  const clock = () => bridge.layers.clock()!;

  time(8, 1); await settle(4);
  assert.equal(clock().minute, 8 * 60, `the god set 08:00: ${JSON.stringify(clock())}`);
  bridge.layers.step(); bridge.perceive.sync(true);
  assert.equal([...god.model.entities.values()].filter(isSetPiece).length, 0, 'no stalls before the market');
  const square = () => new Map(edge.map().map((p: any) => [p.id, p])).get('g-square') as any;
  assert.ok(square().schedule.some((s: any) => s.label === 'Market morning' && s.cron === '0 9 * * *' && s.durationMinutes === 240), JSON.stringify(square().schedule));
  assert.doesNotMatch(square().description, /is on here now/);

  time(9.5, 2); await settle(4);
  assert.equal(clock().minute, 9 * 60 + 30);
  bridge.layers.step();   // the bridge's own clock step (every 40 ticks) may have set it up already
  assert.equal([...god.model.entities.values()].filter(isSetPiece).length, 4, 'the stalls and banner stand at 09:30');
  await settle(4); bridge.perceive.sync(true);
  assert.match(square().description, /^Market morning is on here now \(3 market stalls and a banner set up, until 13:00\)/, square().description);

  await invite(f, 'ana');
  const row: any = await accept(f.host, f.souls.create('dev:ana', { name: 'Ana', description: 'curious' }));
  await settle(3);
  const soul = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  const done = async (n = 6000) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); if (i % 20 === 0) { await setImmediate(); f.host.drainInputs(); const o: any = edge.observe(soul, new Set()); if (i > 40 && !o.self.receipts.length) break; } } await settle(2); };
  const walk = edge.capabilities(soul).find((c) => c.id === 'walk:square');
  assert.deepEqual(walk?.target, { id: 'g-square', kind: 'place' }, 'the ordinary walk goes to the market square');
  const a: any = await accept(f.host, edge.act(soul, { capability: 'walk:square' }));
  assert.equal(a.accepted, true, JSON.stringify(a));
  await done();
  assert.equal(edge.placePathOf(soul.soulId)[0]?.id, 'g-square', 'she is in the square');
  const h: any = hereFrame(edge, soul);
  const seen = JSON.stringify(h);
  assert.match(seen, /market-stall/, `here shows the stalls: ${seen.slice(0, 1500)}`);

  time(13.0, 3); await settle(4);
  bridge.layers.step();
  await settle(4); bridge.perceive.sync(true);
  assert.equal([...god.model.entities.values()].filter(isSetPiece).length, 0, 'packed away at 13:00');
  assert.doesNotMatch(square().description, /is on here now/);
  assert.doesNotMatch(JSON.stringify(hereFrame(edge, soul)), /market-stall/, 'and here no longer shows stalls');
});
