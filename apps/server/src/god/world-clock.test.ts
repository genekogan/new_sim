// F3 (rehearsal item 17): a god's world keeps time. The clock starts with the world (a logged dayConfig, as the live
// worlds' LivingWorld does), advances with ticks (Eyes' env.datetime and observe's world.time), follows the god's
// time.dayTicks, and a change of dayTicks keeps the time of day continuous.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { fixture, invite, accept, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { clockConfig } from './world-clock.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
test('clockConfig keeps the phase when dayTicks changes', () => {
  const c = clockConfig(100_000, 24_000, { origin: 28_000, dayTicks: 72_000 }).dayConfig; // 1 day of 72000 elapsed
  assert.equal((100_000 - c.origin) / c.dayTicks, 1);
  assert.deepEqual(clockConfig(500, 72_000).dayConfig, { origin: 500, dayTicks: 72_000, customs: [] });
});

test('a god world\'s clock runs, and follows the god\'s time.dayTicks', { timeout: 600000 }, async (t) => {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  installEngineBridge({ host: f.host, god, edge, log: () => {}, worldClock: true });
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  await settle(3);
  assert.equal(f.host.living?.dayTicks, 72000, 'the clock started with the world');
  await invite(f, 'ana');
  const row: any = await accept(f.host, f.souls.create('dev:ana', { name: 'Ana', description: 'a guest' }));
  const ana = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  await settle(3);
  const env = () => (f.host.engine.world as any).env.datetime as string;
  const clock = () => (edge.observe(ana, new Set()) as any).world.time?.clock as string;
  const d0 = env(), c0 = clock();
  assert.ok(c0, 'observe shows the time');
  for (let i = 0; i < 1500; i++) f.host.tickOnce(); // 75 s real = 30 world minutes at one day per hour
  await settle(1);
  assert.notEqual(env(), d0, 'env.datetime advanced');
  const mins = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  assert.ok(Math.abs(mins(clock()) - mins(c0) - 30) <= 1, `about 30 world minutes passed: ${c0} → ${clock()}`);

  // the god speeds the day up threefold: same time of day, then three times as fast
  const before = clock();
  assert.equal((god.act({ ops: [{ op: 'world', state: { time: { dayTicks: 24000 } } }] }, 'faster days') as any).accepted, true);
  await settle(3);
  assert.equal(f.host.living?.dayTicks, 24000);
  assert.ok(Math.abs(mins(clock()) - mins(before)) <= 1, `continuous: ${before} → ${clock()}`);
  const c1 = clock();
  for (let i = 0; i < 500; i++) f.host.tickOnce();
  await settle(1);
  assert.ok(Math.abs(mins(clock()) - mins(c1) - 30) <= 1, `30 world minutes in 500 ticks: ${c1} → ${clock()}`);
});
