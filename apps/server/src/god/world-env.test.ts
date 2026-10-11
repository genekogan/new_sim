// R4-LIVE: the env setter — time of day, time speed (and pause), weather — as one `world` op, perceived by Souls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { fixture, invite, accept, factory } from '../../test/native-owner-fixture.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { hereFrame } from '../edge/perception/here.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { envClockConfig, PAUSED_DAY_TICKS } from './world-clock.ts';
import { envPatch, setEnv, envView, installWorldEnv, parseHour, weatherNow } from './world-env.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
const hourAt = (tick: number, c: { origin: number; dayTicks: number }) => (6 + 24 * ((Math.max(0, tick - c.origin) / c.dayTicks) % 1)) % 24;

test('envClockConfig moves the clock forward to the hour, once per set, and pauses', () => {
  const prev = { origin: 0, dayTicks: 72000 };
  const a = envClockConfig(36000, { dayTicks: 72000, paused: false, set: { hour: 20, n: 1 } }, prev).dayConfig; // 18:00 now
  assert.ok(Math.abs(hourAt(36000, a) - 20) < 1e-6, `20:00, got ${hourAt(36000, a)}`);
  assert.ok(a.origin < 0, 'a young world goes negative rather than back in time');
  assert.equal(a.anchor, 1);
  const b = envClockConfig(36000, { dayTicks: 72000, paused: false, set: { hour: 7, n: 2 } }, { ...a }).dayConfig; // 20:00 → 07:00 next day
  assert.ok(Math.abs(hourAt(36000, b) - 7) < 1e-6);
  assert.ok((36000 - b.origin) / 72000 > (36000 - a.origin) / 72000, 'forward, never back');
  // GOD-ENV: the nearest occurrence — setting the hour it already is (or just was) stays on the same day
  const again = envClockConfig(37000, { dayTicks: 72000, paused: false, set: { hour: 7, n: 3 } }, { ...b }).dayConfig; // 07:20 now
  assert.ok(Math.abs(hourAt(37000, again) - 7) < 1e-6);
  assert.ok(Math.abs((37000 - again.origin) / 72000 - (36000 - b.origin) / 72000) < 1e-6, 'repeated set of 07:00 does not advance the day');
  const nearBack = envClockConfig(37000, { dayTicks: 72000, paused: false, set: { hour: 3, n: 4 } }, { ...b }).dayConfig;   // 07:20 → 03:00 (4 h back, not 20 h on)
  assert.ok(Math.abs((37000 - nearBack.origin) / 72000 - ((37000 - b.origin) / 72000 - (4 + 1 / 3) / 24)) < 1e-6, 'nearest: 4 h back');
  const same = envClockConfig(40000, { dayTicks: 72000, paused: false, set: { hour: 7, n: 2 } }, b).dayConfig; // already applied: continuous
  assert.ok(Math.abs(hourAt(40000, same) - hourAt(40000, b)) < 1e-3);
  const p = envClockConfig(40000, { dayTicks: 72000, paused: true, set: { hour: 7, n: 2 } }, b).dayConfig;
  assert.equal(p.dayTicks, PAUSED_DAY_TICKS);
  assert.ok(Math.abs(hourAt(40000, p) - hourAt(40000, b)) < 1e-3, 'pause keeps the hour');
  assert.ok(Math.abs(hourAt(40000 + 72000 * 10, p) - hourAt(40000, p)) < 1e-3, 'and it stands still');
});

test('envPatch: kinds, intensity, overrides, time scale; validation', () => {
  const base = { sky: { palette: 'clear-day', sun: 0.6 }, time: { dayTicks: 72000, startTick: 0, paused: false }, weather: { clouds: 0.1, wind: 0.1, rain: 0, fog: 0, kind: 'auto', intensity: 1 }, constitution: '', ground: { palette: 'grass' } } as any;
  const s = envPatch(base, { weather: { kind: 'storm', intensity: 0.5, wind: 0.9 } });
  assert.equal(s.weather!.kind, 'storm'); assert.equal(s.weather!.wind, 0.9); assert.ok((s.weather!.rain as number) > 0.4 && (s.weather!.rain as number) < 0.6);
  assert.deepEqual(envPatch(base, { timeScale: 0 }).time, { paused: true });
  assert.equal(envPatch(base, { timeScale: 1 }).time!.dayTicks, 1_728_000);
  assert.equal(envPatch(base, { timeOfDay: '7:30 pm' }).time!.set!.valueOf().constructor, Object);
  assert.equal((envPatch(base, { timeOfDay: '7:30 pm' }).time!.set as any).hour, 19.5);
  assert.equal(parseHour('06:15'), 6.25);
  assert.throws(() => envPatch(base, { weather: { kind: 'hail' as any } }));
  assert.throws(() => envPatch(base, { timeScale: 5000 }));
  const auto = weatherNow(base, '2026-10-03T14:00:00.000Z');
  assert.equal(auto.scheduled, true);
});

test('a god sets dusk, a storm and slow time; the clock and a Soul\'s `here` follow; undo restores', { timeout: 600000 }, async (t) => {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  installEngineBridge({ host: f.host, god, edge, log: () => {}, worldClock: true });
  installWorldEnv(f.host, god, edge);
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  await settle(3);
  await invite(f, 'ana');
  const row: any = await accept(f.host, f.souls.create('dev:ana', { name: 'Ana', description: 'a guest' }));
  const ana = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  await settle(3);
  const env = () => (f.host.engine.world as any).env.datetime as string;
  const mins = (s: string) => Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16));

  const r: any = setEnv(god, { timeOfDay: '19:30', weather: { kind: 'storm', intensity: 1 } }, 'a storm at dusk');
  assert.equal(r.accepted, true, JSON.stringify(r.failures));
  await settle(4);
  assert.ok(Math.abs(mins(env()) - (19 * 60 + 30)) <= 2, `dusk: ${env()}`);
  const here: any = hereFrame(edge, ana);
  assert.equal(here.weather?.sky, 'thunderstorm', JSON.stringify(here.weather));
  assert.equal(here.light, 'dusk', `light ${here.light} at ${here.clock}`);
  const v = envView(f.host, god);
  assert.equal(v.weather.kind, 'storm'); assert.equal(v.weather.lightning, 1); assert.equal(v.time.clock, env().slice(11, 16));

  // slow time to real time, then pause
  assert.equal((setEnv(god, { timeScale: 1 }) as any).accepted, true); await settle(3);
  const c1 = env(); for (let i = 0; i < 1200; i++) f.host.tickOnce(); await settle(1);
  assert.ok(mins(env()) - mins(c1) <= 2, `real time: a minute is a minute (${c1} → ${env()})`);
  assert.equal((setEnv(god, { timeScale: 0 }) as any).accepted, true); await settle(3);
  const c2 = env(); for (let i = 0; i < 3000; i++) f.host.tickOnce(); await settle(1);
  assert.equal(env().slice(0, 16), c2.slice(0, 16), 'paused');
  assert.equal(envView(f.host, god).time.paused, true);

  // undo the pause and the speed: time runs at the default rate again; undo the storm: auto weather
  god.undo(); await settle(3); god.undo(); await settle(3);
  assert.equal(f.host.living?.dayTicks, 72000);
  god.undo(); await settle(3);
  assert.equal((god.model.state.weather as any).kind, 'auto');
  assert.notEqual(hereFrame(edge, ana).weather?.sky, 'thunderstorm');
});
