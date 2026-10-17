// E-life: a god setting the time of day moves the clock origin; the render base keeps its hash (viewers read only the day
// length from it), so no viewer reinstalls the scene behind the arrival card. A new day length still recaptures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { marsFactory, GREEN_FIELD_WORLD } from './index.ts';
import type { Take } from '../../../mars/viewer/engine/take/types.ts';

test('a clock origin change keeps the render scene; a day-length change recaptures it', async () => {
  const f = await marsFactory(GREEN_FIELD_WORLD), e = f.create(f.genesis('clock-key'));
  e.configureClock!({ origin: 0, dayTicks: 72000 }); for (let i = 0; i < 3; i++) e.step();
  e.configureClock!({ origin: -30000, dayTicks: 72000 }); for (let i = 0; i < 3; i++) e.step();
  e.configureClock!({ origin: -45000, dayTicks: 72000 }); for (let i = 0; i < 3; i++) e.step();
  e.configureClock!({ origin: -45000, dayTicks: 36000 });
  const refs = e.takeChunks!(-1).map((c) => (c.take as Take).renderSceneRef!.hash);
  assert.equal(refs.length, 3);
  assert.equal(refs[1], refs[0], 'time of day set: same scene');
  assert.equal(refs[2], refs[0], 'again: same scene');
  for (let i = 0; i < 3; i++) e.step(); e.configureClock!({ origin: -45000, dayTicks: 36000 }); for (let i = 0; i < 3; i++) e.step(); e.configureClock!({ origin: 0, dayTicks: 72000 });
  const last = e.takeChunks!(-1).map((c) => (c.take as Take).renderSceneRef!.hash).at(-1);
  assert.notEqual(last, refs[0], 'a new day length is a new scene');
});
