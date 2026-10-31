// Entry 39 (M04): the replay Walk weight eases over WALK_EASE at a walk start and stop instead of snapping in one sample.
import test from 'node:test';
import assert from 'node:assert/strict';
import { POS_Q, type PoseSample } from '../../engine/take/types.ts';
import { WALK_EASE, WALK_FULL, gaitSegments, lastFullStride, walkShare, walkWeightAt } from './walk-ease.ts';

const dt = 0.05;
/** A simplified pose track (keyframes only, as the recorder keeps them): stand, walk at `v` m/s from `t0` to `t1`, stand. */
function track(t0: number, t1: number, v: number, end: number): PoseSample[] {
  const x = (t: number) => Math.round(Math.max(0, Math.min(t, t1) - t0) * dt * v * POS_Q);
  return [[0, 0, 0, 0, 0], [t0, 0, 0, 0, 0], [t1, x(t1), 0, 0, 0], [end, x(t1), 0, 0, 0]];
}

test('a full-speed walk ends over WALK_EASE: no one-sample snap, standing after, striding before', () => {
  const s = gaitSegments([{ track: track(20, 100, 1.2, 160), offset: 0 }], dt);
  assert.equal(walkWeightAt(s, 10, dt), 0);
  assert.equal(walkWeightAt(s, 60, dt), 1);
  assert.equal(walkWeightAt(s, 140, dt), 0);
  // the old per-sample map went 0.94 → 0.055 between two 65 ms samples; now at most smoothstep's peak slope
  let maxStep = 0;
  for (let t = 0; t < 160; t += 0.1) maxStep = Math.max(maxStep, Math.abs(walkWeightAt(s, t + 1, dt) - walkWeightAt(s, t, dt)));
  assert.ok(maxStep <= (1.5 * dt) / WALK_EASE + 1e-9, `per-tick change ${maxStep}`);
  // centred on the stop: half way at the stop tick, full a half window before, none a half window after
  assert.ok(Math.abs(walkWeightAt(s, 100, dt) - 0.5) < 1e-9);
  const half = WALK_EASE / 2 / dt;
  assert.ok(walkWeightAt(s, 100 - half, dt) > 0.999 && walkWeightAt(s, 100 + half, dt) < 1e-3);
  assert.ok(walkWeightAt(s, 20 + half, dt) > 0.999 && walkWeightAt(s, 20 - half, dt) < 1e-3, 'the start eases the same way');
});

test('a steady speed keeps the old weight (the kernel integrates to one): slow shuffles stay partial', () => {
  for (const v of [0.1, 0.2, 0.3, 1]) {
    const s = gaitSegments([{ track: track(0, 400, v, 400), offset: 0 }], dt);
    assert.ok(Math.abs(walkWeightAt(s, 200, dt) - walkShare(v)) < 2e-3, `v=${v}`);
  }
});

test('adjacent live take windows: the weight at a window edge is the same from either side', () => {
  // one walk stopping at absolute tick 104, recorded as two 1 s windows [80, 100) and [100, 120)
  const whole = track(20, 104, 1.2, 160);
  const at = (t: number) => { const a = whole.findIndex((p) => p[0] > t); const p = whole[a - 1], q = whole[a]; return p[1] + ((q[1] - p[1]) * (t - p[0])) / (q[0] - p[0]); };
  const win = (from: number, to: number): PoseSample[] => [from, ...whole.map((p) => p[0]).filter((t) => t > from && t < to), to].map((t) => [t - from, Math.round(at(t)), 0, 0, 0]);
  const A = win(80, 100), B = win(100, 120);
  const inA = gaitSegments([{ track: A, offset: 0 }, { track: B, offset: 20 }], dt), inB = gaitSegments([{ track: A, offset: -20 }, { track: B, offset: 0 }], dt);
  assert.ok(Math.abs(walkWeightAt(inA, 20, dt) - walkWeightAt(inB, 0, dt)) < 1e-9);
  const ref = gaitSegments([{ track: whole, offset: 0 }], dt);
  assert.ok(Math.abs(walkWeightAt(inB, 4, dt) - walkWeightAt(ref, 104, dt)) < 1e-6, 'the window sees across its edge');
  // without the neighbour the window starts on the edge sample held: still finite and in [0, 1]
  const alone = gaitSegments([{ track: B, offset: 0 }], dt), w = walkWeightAt(alone, 0, dt);
  assert.ok(w >= 0 && w <= 1);
});

test('the idle onset clock restarts from the last full stride, never from a walk start or a short nudge', () => {
  const s = gaitSegments([{ track: track(20, 100, 1.2, 160), offset: 0 }], dt);
  const f = lastFullStride(s, 20, 100, dt)!;
  assert.ok(f < 100 && f > 100 - WALK_EASE / dt && walkWeightAt(s, f, dt) >= WALK_FULL && walkWeightAt(s, f + 1, dt) < WALK_FULL);
  assert.equal(lastFullStride(s, 0, 21, dt), null, 'the first tick of a walk is not a stride');
  const nudge = gaitSegments([{ track: track(20, 24, 0.6, 80), offset: 0 }], dt);
  assert.equal(lastFullStride(nudge, 20, 24, dt), null, 'a 0.2 s nudge never reaches a stride');
  const shuffle = gaitSegments([{ track: track(0, 200, 0.15, 220), offset: 0 }], dt);
  assert.equal(lastFullStride(shuffle, 0, 200, dt), 140, 'a long slow shuffle counts as moving until 60 ticks before its end');
  assert.equal(lastFullStride(shuffle, 0, 200, dt, 60, false), null);
});

test('past the last sample a slowing body keeps slowing; a steady one keeps its share', () => {
  // engine arrival: 1.2 m/s, then 0.2 m/s for 4 ticks, then the window ends (its successor not here yet)
  const slow: PoseSample[] = [[0, 0, 0, 0, 0], [20, 1200, 0, 0, 0], [24, 1240, 0, 0, 0]];
  const s = gaitSegments([{ track: slow, offset: 0 }], dt);
  // the client sat at the window's end for three frames (tick 24, then 25-27 ahead): the stop runs on to standing
  const held = gaitSegments([{ track: [...slow, [40, 1240 + 160, 0, 0, 0]], offset: 0 }], dt);
  assert.ok(walkWeightAt(s, 28, dt) < 0.2 && walkWeightAt(s, 32, dt) < 0.02, 'a slowing body finishes its stop: ' + walkWeightAt(s, 28, dt));
  assert.ok(walkWeightAt(held, 28, dt) > 0.4, 'one that keeps its slow pace keeps a partial stride');
  const steady = gaitSegments([{ track: track(0, 24, 1.2, 24), offset: 0 }], dt);
  assert.equal(walkWeightAt(steady, 24, dt), 1);
});
