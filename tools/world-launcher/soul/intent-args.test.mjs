import test from 'node:test';
import assert from 'node:assert/strict';
import { parseActionArgs } from './eden.mjs';
test('single structured go/turn intent survives as the action rather than being discarded as params', () => {
  for (const intent of [{ verb: 'go', target: { place: 'chiba' } }, { verb: 'turn', heading: 180 }]) assert.deepEqual(parseActionArgs([JSON.stringify(intent)]), intent);
  assert.deepEqual(parseActionArgs(['sit:here', '{"seconds":60}']), { capability: 'sit:here', params: { seconds: 60 } });
  assert.deepEqual(parseActionArgs(['go to', 'Chiba']), { capability: 'go to Chiba', params: {} });
  assert.throws(() => parseActionArgs([]), /action required/);
});
