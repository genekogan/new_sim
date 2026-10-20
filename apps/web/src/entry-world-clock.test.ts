import test from 'node:test'; import assert from 'node:assert/strict';
import { calendarClock, entryWorldClock } from './world-env.ts';
// P7d: the phone's early poster lights its sky from the clock the page's HTML carries (window.__simWorldClock). The sun's
// position is NaN for a zoned ISO time (the poster was black), so it comes back as the naive local time a take's clock is.
test('the entry clock is the naive local time of the HTML clock, or null', () => {
  const w = globalThis as unknown as { window?: { __simWorldClock?: unknown } };
  const had = w.window; w.window = {};
  try {
    assert.equal(entryWorldClock(), null);
    for (const [v, want] of [['2026-10-11T07:20:18.000Z', '2026-10-11T07:20:18.000'], ['2026-10-11T21:05:00Z', '2026-10-11T21:05:00'], ['2026-10-11T21:05', null], ['now', null], [12, null]] as const) {
      w.window.__simWorldClock = v; assert.equal(entryWorldClock(), want, String(v));
    }
    w.window.__simWorldClock = '2026-10-11T07:20:18.000Z';
    assert.equal(calendarClock(entryWorldClock(), { time: { calendar: '06-05' } }), '2026-06-05T07:20:18.000');
  } finally { w.window = had; }
});

test('P7d: the entry Soul count is a whole number from the page\'s HTML, or null', async () => {
  const { entryWorldSouls } = await import('./world-env.ts');
  const w = globalThis as unknown as { window?: { __simWorldSouls?: unknown } };
  const had = w.window; w.window = {};
  try {
    assert.equal(entryWorldSouls(), null);
    for (const [v, want] of [[0, 0], [12, 12], [-1, null], [1.5, null], ['3', null]] as const) { w.window.__simWorldSouls = v; assert.equal(entryWorldSouls(), want, String(v)); }
  } finally { w.window = had; }
});
