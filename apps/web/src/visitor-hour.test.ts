import test from 'node:test'; import assert from 'node:assert/strict';
import { hourLabel, setVisitorPreviewHour, subscribeVisitorHour, visitorPreviewHour } from './visitor-hour.ts';
import { shotClockAt } from './world-env.ts';
test('a visitor preview hour wraps into the day, notifies, clears, and only replaces the drawn time', () => {
  let n = 0; const off = subscribeVisitorHour(() => n++);
  setVisitorPreviewHour(21 * 60 + 30); assert.equal(visitorPreviewHour(), 1290); assert.equal(hourLabel(1290), '21:30');
  setVisitorPreviewHour(1290); assert.equal(n, 1, 'same hour: no notification');
  setVisitorPreviewHour(1500); assert.equal(visitorPreviewHour(), 60);
  assert.equal(shotClockAt('2026-10-17T11:14:00', visitorPreviewHour()), '2026-10-17T01:00:00');
  setVisitorPreviewHour(null); assert.equal(visitorPreviewHour(), null); assert.equal(n, 3);
  assert.equal(shotClockAt('2026-10-17T11:14:00', visitorPreviewHour()), '2026-10-17T11:14:00');
  off();
});
