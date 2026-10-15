// E2 #8 "rain fades slowly": a shower must stop promptly once the sky clears, and a god's change (including clearing
// it back to the scheduled weather) must show in seconds, not minutes. Imports weather.ts only (no DOM).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../src/atmosphere/weather.ts';

const raining = (): W.WeatherState => W.copyWeather({cloud:0,rain:0,wind:0,fog:0,mist:0,wet:0}, W.targetFor('rain', 12));
/** Seconds until rendered rain drops below the viewer's 1% draw threshold, easing at `rate(t)` toward clear. */
function stopsAfter(rate: (t: number) => number) {
  const s = raining(), clear = W.targetFor('clear', 12); let t = 0;
  while (s.rain >= .01 && t < 600) { W.easeWeather(s, clear, rate(t) / 30); t += 1 / 30; }
  return {t, s};
}

test('scheduled rain stops within 40 s of the sky clearing (was ~160 s); the ground stays wet', () => {
  const {t, s} = stopsAfter(() => 1);
  assert.ok(t < 40, `rain still falling after ${t.toFixed(1)} s`);
  assert.ok(s.wet > .8, `ground dried too fast: ${s.wet}`);
});

test("a god's clear, or a return to the schedule, stops the rain within 12 s", () => {
  // set weather ('clear'): the god pace throughout
  assert.ok(stopsAfter(() => W.weatherEaseRate(true, 0)).t < 12);
  // cleared back to 'auto' (no set weather) at t=0: the god pace still applies while it settles
  const back = stopsAfter(t => W.weatherEaseRate(false, t));
  assert.ok(back.t < 12, `after auto: ${back.t.toFixed(1)} s`);
  // with no god change at all, the schedule's pace
  assert.equal(W.weatherEaseRate(false, Infinity), 1);
  assert.equal(W.weatherEaseRate(false, W.GOD_SETTLE_S + 1), 1);
});

test('rain still builds gradually (no jump) and a set weather change is detected by value', () => {
  const s = W.copyWeather({cloud:0,rain:0,wind:0,fog:0,mist:0,wet:0}, W.targetFor('clear', 12));
  let worst = 0;
  for (let i = 0; i < 30 * 120; i++) { const before = s.rain; W.easeWeather(s, W.targetFor('rain', 12), 1 / 30); worst = Math.max(worst, Math.abs(s.rain - before)); }
  assert.ok(worst < .002, `per-frame rain step ${worst}`);
  const a = {kind: 'rain', clouds: .9, rain: .8, wind: .5, fog: .2, intensity: .8};
  assert.equal(W.setWeatherChanged(a, {...a}), false);
  assert.equal(W.setWeatherChanged(a, {...a, rain: 0}), true);
  assert.equal(W.setWeatherChanged(a, null), true);
  assert.equal(W.setWeatherChanged(null, null), false);
});
