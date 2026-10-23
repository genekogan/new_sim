// VERBS2: choosing an available vehicle must not change the requested body of water.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCapability, type VocabContext } from './edge/ledger/vocabulary.ts';
import type { EdgeCapability } from './edge/contract.ts';

const punt = (name: string, available: boolean): EdgeCapability => ({
  id: `object:ride-punt-${name}:join`, verb: 'object', action: 'join', object: `ride-punt-${name}`,
  label: `Board the ${name} punt`, available,
  ...(!available ? { blocked: { code: 'punt.unsupported-water', reason: 'The pond boarding plank needs supported dry bank.' } } : {}),
});
const nearPond = punt('koi-pond', false), westLake = punt('west-lake', true);
const context = (pond = nearPond, other = westLake): VocabContext => ({
  caps: [other, pond], places: [], root: ['eden'], me: [0,0],
  target: c => c.id === pond.id ? { names: ['Koi pond punt'], around: ['Koi pond'], at: [1,0] }
    : { names: [other.label], around: [other === westLake ? 'West lake' : 'Far pond'], at: [80,0] },
});
function refusal(words: string, ctx = context()) {
  const r = resolveCapability(words, ctx);
  assert.equal(r.kind, 'unknown', words);
  if (r.kind !== 'unknown') return;
  assert.equal(r.code, 'ride.blocked');
  assert.match(r.reason, /supported dry bank/);
  assert.match(r.reason, /nothing else was chosen/);
  assert.equal(r.didYouMean?.[0]?.id, ctx.caps[0].id);
}

test('VERBS2 row on the pond refuses unsupported local water and offers lake punt without selecting it', () => {
  for (const words of ['row on the pond', 'row a boat on the pond']) refusal(words);
});
test('VERBS2 named koi pond keeps its existing honest refusal and working alternative', () => refusal('row on the koi pond'));
test('VERBS2 generic go rowing may choose the available lake punt', () => {
  const r = resolveCapability('go rowing', context());
  assert.equal(r.kind, 'alias'); if (r.kind === 'alias') assert.equal(r.cap.id, westLake.id);
});
test('VERBS2 an available requested pond is unchanged', () => {
  const r = resolveCapability('row on the pond', context({ ...nearPond, available: true, blocked: undefined }));
  assert.equal(r.kind, 'alias'); if (r.kind === 'alias') assert.equal(r.cap.id, nearPond.id);
});
test('VERBS2 another pond matching a broad word cannot replace the nearest requested pond', () => {
  refusal('row on the pond', context(nearPond, punt('far-pond', true)));
});
