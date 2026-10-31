// srv-load: load levels with hysteresis (LOAD-CONTRACT §1), live.json from the shared numbers (§4).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LevelState, LoadMonitor, STEP_DOWN_MS, type Signals} from './load/monitor.ts';
import {liveOf, newSharedLoad, S} from './load/shared.ts';
import {attachBootSlots, bootPhase, bootSlots, bootTick} from './load/boot-progress.ts';

const calm: Signals = {service: 1, loopP99Ms: 5, heapFrac: 0.2, gcFrac: 0.01, oldestMs: 0};
const at = (s: Partial<Signals>) => ({...calm, ...s});

test('levels: enter on any condition, at once and straight to the highest that holds', () => {
  const l = new LevelState();
  assert.equal(l.update(calm, 0), 'green');
  assert.equal(l.update(at({loopP99Ms: 250}), 1), 'amber');
  assert.equal(new LevelState().update(at({heapFrac: 0.86}), 0), 'red');
  assert.equal(new LevelState().update(at({oldestMs: 6500}), 0), 'red');
  assert.equal(new LevelState().update(at({service: 0.79}), 0), 'amber');
  assert.equal(new LevelState().update(at({heapFrac: 0.93, gcFrac: 0.41}), 0), 'black');
  assert.equal(new LevelState().update(at({heapFrac: 0.93, gcFrac: 0.2}), 0), 'red', 'a full heap alone is red, not black');
});

test('levels: black on tick service < 0.2 only after 30 s of it', () => {
  const l = new LevelState();
  assert.equal(l.update(at({service: 0.1}), 0), 'red');
  assert.equal(l.update(at({service: 0.1}), 29_000), 'red');
  assert.equal(l.update(at({service: 0.1}), 30_000), 'black');
  const m = new LevelState(); m.update(at({service: 0.1}), 0); m.update(at({service: 0.3}), 10_000);
  assert.equal(m.update(at({service: 0.1}), 31_000), 'red', 'the 30 s restart after a better sample');
});

test('levels: leave one step at a time after 30 s below the lower band; a signal between bands holds the level', () => {
  const l = new LevelState(); let t = 0;
  l.update(at({loopP99Ms: 1500}), t); assert.equal(l.level, 'red');
  l.update(at({loopP99Ms: 500}), t += 1000); assert.equal(l.level, 'red', 'between red bands (400..1000)');
  l.update(at({loopP99Ms: 500}), t += STEP_DOWN_MS + 1000); assert.equal(l.level, 'red', 'never below the red band: stays');
  l.update(at({loopP99Ms: 150}), t += 1000); assert.equal(l.level, 'red');
  l.update(at({loopP99Ms: 150}), t += STEP_DOWN_MS - 1); assert.equal(l.level, 'red');
  l.update(at({loopP99Ms: 150}), t += 1); assert.equal(l.level, 'amber', 'one step down');
  l.update(at({loopP99Ms: 150}), t += STEP_DOWN_MS + 5000); assert.equal(l.level, 'amber', '150 ms is not below the amber band (100)');
  l.update(calm, t += 1000); l.update(at({loopP99Ms: 120}), t += 20_000); l.update(calm, t += 1000);
  l.update(calm, t += STEP_DOWN_MS - 2000); assert.equal(l.level, 'amber', 'a sample above the band restarts the 30 s');
  l.update(calm, t += 2000); assert.equal(l.level, 'green');
});

test('monitor: tick service counts dilation and slow frames as missed, a paused or stopped clock as served', () => {
  let now = 0; const host = {engine: {world: {tick: 0}}, tickMs: [10, 20, 30], paused: false, pace: 1, baseRate: 1, running: true, clockAvailable: true};
  const shared = newSharedLoad(), m = new LoadMonitor({host, now: () => now, shared});
  m.sample();
  for (let i = 0; i < 20; i++) { now += 250; host.engine.world.tick += 2; m.sample(); }   // 8 ticks/s of 20 owed
  assert.ok(Math.abs(m.signals.service - 0.4) < 0.01, String(m.signals.service));
  assert.equal(m.level, 'red');
  host.paused = true; for (let i = 0; i < 25; i++) { now += 250; m.sample(); }
  assert.equal(m.signals.service, 1, 'nothing owed while paused');
  assert.equal(shared[S.worldTick], 40); assert.equal(m.tickStats.avg, 20); assert.equal(m.tickStats.max, 30);
  assert.equal(m.health().level, 'red');
});

test('monitor: dials hear the level at once and on every change; black for the limit asks for the planned restart', () => {
  let now = 0, restarts = 0; const heard: string[] = [];
  const host = {engine: {world: {tick: 0}}, tickMs: [], paused: false, pace: 1, baseRate: 1, running: true, clockAvailable: true};
  const m = new LoadMonitor({host, now: () => now, shared: newSharedLoad(), blackLimitMs: 60_000, onBlackTooLong: () => restarts++, queue: () => ({depth: 1, oldestMs: 0})});
  m.register('test', l => heard.push(l));
  assert.deepEqual(heard, ['green']);
  m.sample(); for (let i = 0; i < 4 * 95; i++) { now += 250; m.sample(); }   // no ticks at all for 95 s
  assert.deepEqual(heard, ['green', 'red', 'black']);
  assert.equal(restarts, 1, 'black from 30 s, restart at 90 s');
});

test('live.json: phases, boot progress through the absorbed L5 slots, and the turn age of a stuck thread', () => {
  const a = newSharedLoad(), before = bootSlots();
  attachBootSlots(a, S.boot);
  try {
    bootPhase('boot:replay', 100, 900); bootTick(128);
    a[S.lastTurnAt] = 0;
    let live = liveOf(a, 42, Date.now());
    assert.equal(live.phase, 'boot:replay'); assert.deepEqual(live.boot, {stage: 'replay', tick: 128, target: 900});
    assert.ok(live.loop.lastTurnAgeMs < 1000, 'the replay tick stamps the turn');
    assert.equal(live.tick, undefined); assert.equal(live.queue, undefined);
    bootPhase('serving', 900); a[S.worldTick] = 901; a[S.level] = 2; a[S.queueDepth] = 3;
    live = liveOf(a, 42, Date.now() + 40_000);
    assert.equal(live.phase, 'serving'); assert.equal(live.boot, undefined); assert.equal(live.level, 'red');
    assert.deepEqual(live.queue, {depth: 3, oldestMs: 0}); assert.equal(live.tick!.world, 901);
    assert.ok(live.loop.lastTurnAgeMs >= 40_000, 'a thread that stopped turning shows its age');
    assert.equal(live.v, 1); assert.equal(live.pid, 42);
  } finally { attachBootSlots(before.view as Float64Array, before.offset); }
});
