import test from 'node:test';
import assert from 'node:assert/strict';
import { clockAt, timePair, parseWorldRoutine, routineOccurrences } from './client-cadence.mjs';
test('both clocks follow authoritative acceleration and pause', () => {
  const anchor = { worldMinutes: 450, realMs: 100000, realMsPerWorldMinute: 2500 };
  assert.equal(clockAt(anchor, 105000).worldMinutes, 452);
  assert.equal(timePair(anchor, 570).realMs, 400000);
  assert.equal(clockAt({ ...anchor, paused: true }, 105000).worldMinutes, 450);
  assert.equal(timePair({ ...anchor, paused: true }, 570).realMs, null);
  assert.equal(clockAt({ ...anchor, paused: true, realMsPerWorldMinute: null }, 105000).worldMinutes, 450);
});
test('spec routine syntax has explicit world duration and midnight wrap', () => {
  assert.deepEqual(parseWorldRoutine('- 10:00 mon,thu · read at eden-library-1 · 30m', 'read').weekdays, [0, 3]);
  assert.equal(parseWorldRoutine('- 23:30 daily · fire · until 01:00', 'fire').durationWorldMinutes, 90);
  assert.throws(() => parseWorldRoutine('- 24:00 daily · fire · 30m', 'bad'));
});
test('routine occurrences dedupe across restart and retain distinct world days', () => {
  const routines = [parseWorldRoutine('- 07:30 daily · tea · 20m', 'tea')];
  const before = routineOccurrences({ routines, fromWorldMinutes: 440, toWorldMinutes: 460, epochWeekday: 0 });
  assert.equal(before.occurrences[0].key, 'tea@0');
  const after = routineOccurrences({ routines, fromWorldMinutes: 440, toWorldMinutes: 1900, epochWeekday: 0, completedKeys: ['tea@0'] });
  assert.deepEqual(after.occurrences.map(x => x.key), ['tea@1']);
});
test('long offline gaps are explicitly truncated, never silently replayed', () => {
  const routines = [parseWorldRoutine('- 07:30 daily · tea · 20m', 'tea')];
  const result = routineOccurrences({ routines, fromWorldMinutes: 0, toWorldMinutes: 1440 * 100, epochWeekday: 0 });
  assert.equal(result.truncated, true);
  assert.equal(result.discardedBeforeWorldMinutes, 1440 * 99);
  assert.equal(result.occurrences.length, 1);
  assert.throws(() => routineOccurrences({ routines, fromWorldMinutes: 10, toWorldMinutes: 9, epochWeekday: 0 }));
});
