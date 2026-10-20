import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onFollowSoulRequest, requestFollowSoul } from './follow-soul-request.ts';

test('a ready approval asks the viewer to follow its Soul; only Soul ids cross', () => {
  const bus = new EventTarget(), got: string[] = [];
  const off = onFollowSoulRequest((id) => got.push(id), bus);
  assert.equal(requestFollowSoul('s_new1', bus), true);
  assert.equal(requestFollowSoul('javascript:x', bus), false);
  assert.equal(requestFollowSoul('', bus), false);
  bus.dispatchEvent(new CustomEvent('sim:follow-soul', { detail: { soulId: 42 } }));
  off();
  requestFollowSoul('s_after', bus);
  assert.deepEqual(got, ['s_new1']);
});
