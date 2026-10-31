import test from 'node:test';
import assert from 'node:assert/strict';
import { tickValidity } from './tick-validity.mjs';

const h = (tick, at, extra = {}) => ({ ok: true, tick, at, paused: false, clockRate: 1, ...extra });
test('H-a: a world at its nominal 20 ticks/s is valid; a starved one is invalid with a reason; missing or paused is not judged', () => {
  assert.deepEqual(tickValidity(h(1000, 0), h(1000 + 20 * 60, 60_000)), { valid: true, service: 1, ticks: 1200, seconds: 60, clockRate: 1 });
  const slow = tickValidity(h(0, 0), h(600, 60_000, { clockRate: 0.5 }));
  assert.equal(slow.valid, false); assert.equal(slow.service, 0.5); assert.match(slow.reason, /starved/);
  assert.equal(tickValidity(null, h(1, 1)).valid, null);
  assert.equal(tickValidity(h(0, 0, { paused: true }), h(10, 60_000)).valid, null);
  assert.equal(tickValidity(h(0, 0), h(100, 5_000)).valid, null, 'too short to judge');
});
