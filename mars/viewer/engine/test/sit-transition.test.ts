// A seat whose approach point is far from it (a café chair under a parasol table, 1.5 m) made sitting down move the
// body 0.19 m in one tick (motion.teleport, max 0.15). The transition now lasts long enough to stay inside the limit;
// every span that fitted keeps SIT_TRANSITION, so recorded histories replay unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIT_TRANSITION, sitDuration } from '../social/actions.ts';
import { DT } from '../runtime/runtime.ts';
import { MAX_HUMAN_STEP_PER_TICK } from '../runtime/invariants.ts';

const smooth = (k: number) => k * k * (3 - 2 * k);
function peak(span: number, dur: number) { let m = 0, t = 0; for (;;) { const a = Math.min(1, t / dur), b = Math.min(1, (t + DT) / dur); m = Math.max(m, span * (smooth(b) - smooth(a))); if (b >= 1) return m; t += DT; } }

test('sit-down/stand-up: spans that fitted keep SIT_TRANSITION; longer ones slow down to stay within the per-tick limit', () => {
  for (const span of [0, 0.3, 0.6, 0.9, 1.1]) assert.equal(sitDuration(span), SIT_TRANSITION, `span ${span}`);
  for (const span of [1.3, 1.5, 2.2, 4]) {
    const dur = sitDuration(span);
    assert.ok(dur > SIT_TRANSITION, `span ${span} slows down`);
    assert.ok(peak(span, dur) <= MAX_HUMAN_STEP_PER_TICK, `span ${span}: ${peak(span, dur).toFixed(3)} m per tick`);
  }
  assert.ok(peak(1.5, SIT_TRANSITION) > MAX_HUMAN_STEP_PER_TICK, 'the café case faulted before');
});
