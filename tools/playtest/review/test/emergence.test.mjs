import test from 'node:test';
import assert from 'node:assert/strict';
import { computeEmergence } from '../emergence.mjs';

const T0 = Date.parse('2026-10-24T12:00:00Z');
const S = (soulId, s, x, z, place, activity) => ({ soulId, t: new Date(T0 + s * 1000).toISOString(), ms: T0 + s * 1000, p: [x, z], place, activity });
const R = (id, soulId, capability, s, extra = {}) => ({ id, soulId, capability, phase: 'completed', startedAt: new Date(T0 + s * 1000).toISOString(), ms: T0 + s * 1000, ...extra });

test('two Souls that meet score above the shuffled baseline; one Soul has no co-location', () => {
  const samples = [];
  for (let s = 0; s < 300; s += 5) { const together = s >= 100 && s < 160; samples.push(S('a', s, s / 5, 0, 'Plaza', 'walking')); samples.push(S('b', s, together ? s / 5 + 1 : 200 - s / 5, 50 * !together, together ? 'Plaza' : 'Park', s < 150 ? 'reading' : 'eating')); }
  const m = computeEmergence({ samples: samples.sort((x, y) => x.ms - y.ms), receipts: [] });
  assert.ok(m.coLocation.observed > 0.15 && m.coLocation.ratio > 1.5, JSON.stringify(m.coLocation));
  assert.deepEqual(computeEmergence({ samples: samples.filter((x) => x.soulId === 'a'), receipts: [] }).coLocation, null);
  assert.equal(m.individuality.perSoul.a.activityEntropyBits, 0);
  assert.equal(m.individuality.perSoul.b.activityEntropyBits, 1);
  assert.equal(m.individuality.perSoul.b.places, 2);
});
test('conversations, unprompted shared receipts, imitation, chains', () => {
  const samples = [S('a', 0, 0, 0, 'Plaza'), S('b', 0, 1, 0, 'Plaza'), S('a', 200, 0, 0, 'Plaza'), S('b', 200, 1, 0, 'Plaza')];
  const receipts = [
    R('r1', 'a', 'talk:b', 10, { with: ['Bea'], turns: 4 }), R('r2', 'b', 'talk:a', 11, { phase: 'failed', code: 'declined' }),
    R('r3', 'a', 'dance:here', 30, { with: ['Bea'] }), R('r4', 'b', 'dance:here', 90),
    R('r5', 'a', 'light:fire', 120, { produces: 'fire-1' }), R('r6', 'b', 'warm:fire-1', 150, { object: 'fire-1', produces: 'warmth-b' }),
  ];
  const requests = [{ soulId: 'a', text: 'dance with Bea', sentAt: new Date(T0 + 25000).toISOString(), cutoffAt: new Date(T0 + 60000).toISOString() }];
  const m = computeEmergence({ samples, receipts, requests });
  assert.deepEqual({ s: m.conversations.started, a: m.conversations.accepted, d: m.conversations.declined, t: m.conversations.turns }, { s: 2, a: 1, d: 1, t: 4 });
  assert.deepEqual(m.sharedActivities, { unprompted: 1, prompted: 1 });
  assert.equal(m.imitationWithin2min, 2, 'b talked right after a, b danced 60 s after a');
  assert.equal(m.chainsGe2, 1); assert.equal(m.chains[0].object, 'fire-1');
  const m2 = computeEmergence({ samples, receipts, requests: [...requests, { soulId: 'a', text: 'light a fire-1', sentAt: new Date(T0).toISOString(), cutoffAt: new Date(T0 + 1000).toISOString() }] });
  assert.equal(m2.chainsGe2, 0, 'a chain whose object a request named is not emergent');
});
