import test from 'node:test'; import assert from 'node:assert/strict';
import { HUD_FIT_STEPS, fitSteps, pickFit } from './hud-fit.ts';

test('labels go before controls, and the status chip truncates last', () => {
  assert.deepEqual(HUD_FIT_STEPS.slice(0, 6), ['keys', 'broadcast', 'god', 'newsoul', 'explore', 'live']);
  assert.equal(HUD_FIT_STEPS.at(-1), 'squeeze');
  assert.equal(fitSteps(0), ''); assert.equal(fitSteps(3), 'keys broadcast god');
});

test('pickFit finds the fewest steps that fit, from any starting level', () => {
  const max = HUD_FIT_STEPS.length;
  for (const need of [0, 1, 4, 7, max]) for (const from of [0, 2, 6, max]) {
    const tried: number[] = [];
    const level = pickFit(from, (l) => { tried.push(l); return l >= need; });
    assert.equal(level, need, `need ${need} from ${from}`);
    assert.ok(tried.length <= Math.abs(need - from) + 2, `few layouts (${tried.length}) need ${need} from ${from}`);
  }
  assert.equal(pickFit(0, () => false), HUD_FIT_STEPS.length, 'nothing fits: every step, the last one squeezes');
});
