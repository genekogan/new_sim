import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickQualityTier, PHONE_DETAIL, PHONE_SHADOW_EVERY } from './quality-tier.ts';

const phone = { search: '', coarsePointer: true, screen: [390, 844] as const };
test('a touch phone gets the phone tier: capped pixels, small shadow map, shadow every few frames', () => {
  const q = pickQualityTier(phone);
  assert.equal(q.tier, 'phone'); assert.equal(q.maxPixelRatio, 1.5); assert.equal(q.shadowMapSize, 1024);
  assert.equal(q.shadowEvery, PHONE_SHADOW_EVERY); assert.equal(q.detail, PHONE_DETAIL);
});
test('a desktop keeps every-frame shadows', () => {
  const q = pickQualityTier({ search: '', coarsePointer: false, screen: [1440, 900] });
  assert.equal(q.tier, 'full'); assert.equal(q.shadowEvery, 1);
});
test('phone knobs come from the URL for measurements; bad values keep the defaults', () => {
  const q = pickQualityTier({ ...phone, search: '?phoneShadowEvery=1&phoneMinPx=3' });
  assert.equal(q.shadowEvery, 1); assert.equal(q.detail?.minRadiusPx, 3); assert.equal(q.detail?.shadowNear, PHONE_DETAIL.shadowNear);
  assert.equal(pickQualityTier({ ...phone, search: '?phoneShadowEvery=x' }).shadowEvery, PHONE_SHADOW_EVERY);
  assert.equal(pickQualityTier({ ...phone, search: '?quality=full' }).tier, 'full');
});
