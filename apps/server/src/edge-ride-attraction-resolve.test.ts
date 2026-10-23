// SOUL2: attraction names must resolve to their own ride even when a balloon is nearer.
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCapability, type VocabContext} from './edge/ledger/vocabulary.ts';
import type {EdgeCapability} from './edge/contract.ts';

const ride = (name: string, action = 'join', available = true): EdgeCapability => ({
  id: `object:ride-resort-${name}:${action}`, verb: 'object', object: `ride-resort-${name}`,
  action, label: `Ride the ${name}`, available, target: {kind: 'object', id: `ride-resort-${name}`},
  ...(!available ? {blocked: {code: 'ride.departed', reason: 'It is going round.'}} : {}),
});
const carousel = ride('carousel'), ferris = ride('ferris-wheel'), balloon = ride('balloon');
const context = (caps: EdgeCapability[]): VocabContext => ({caps, places: [], root: ['eden'], me: [-125, 25],
  target: c => ({names: [c.object!], around: ['seaside-resort'], at: c === balloon ? [-124, 25] : [220, -300]}),
});

test('carousel and ferris-wheel words choose their own join from far away', () => {
  for (const [words, want] of [['ride the carousel', carousel], ['board the carousel', carousel],
    ['ride the merry-go-round', carousel], ['ride the ferris wheel', ferris], ['ride the big wheel', ferris]] as const) {
    const result = resolveCapability(words, context([balloon, ferris, carousel]));
    assert.notEqual(result.kind, 'unknown', words);
    if (result.kind !== 'unknown') assert.equal(result.cap.id, want.id, words);
  }
});

test('named attraction keeps unavailable ride and never substitutes another attraction', () => {
  const departed = ride('carousel', 'join', false);
  const result = resolveCapability('ride the carousel', context([balloon, ferris, departed]));
  assert.notEqual(result.kind, 'unknown');
  if (result.kind !== 'unknown') assert.equal(result.cap.id, departed.id);
  assert.equal(resolveCapability('ride the carousel', context([balloon, ferris])).kind, 'unknown');
  assert.equal(resolveCapability('ride the moon carousel', context([balloon, ferris, carousel])).kind, 'unknown');
});
