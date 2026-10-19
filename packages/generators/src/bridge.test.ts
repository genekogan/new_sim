// deck/1 rails and the gaps stairs open in them (harvest 2026-10-18; the engine side is apps/server/src/god/deck-stairs.test.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GENERATORS, deckRaised, railGaps } from './index.ts';

const area: [number, number][] = [[-3, -7], [3, -7], [3, -3], [-3, -3]];
const deck = (params: Record<string, unknown>) => GENERATORS['deck/1'].physics({ params: params as never, args: {}, seed: 0, shape: { area } });

test('a deck has rails from DECK_RAISED up, measured from the ground under it (its height), not from the world origin', () => {
  assert.equal(deckRaised({ height: 0.3 }), false); assert.equal(deckRaised({ height: 0.4 }), true); assert.equal(deckRaised({}), true);
  assert.equal(deck({ height: 0.3 }).colliders.length, 0);
  assert.equal(deck({ height: 1.6 }).colliders.length, 4, 'one rail per edge');
  // frozen at an absolute height: a 1.6 m deck in a hollow (y −0.4) keeps its rails, a 0.3 m deck on a hill (y 10.3) has none
  assert.equal(deck({ height: 1.6, at: { sig: '', y: -0.4 } }).colliders.length, 4);
  assert.equal(deck({ height: 0.3, at: { sig: '', y: 10.3 } }).colliders.length, 0);
});

test('railGaps: one gap per stair end on the rail line, the stair width plus 0.3 m, merged and clipped to the rail', () => {
  const a: [number, number] = [-3, -3], b: [number, number] = [3, -3];
  const gaps = (ends: { p: [number, number]; width: number }[]) => railGaps(a, b, ends).map((g) => g.map((v) => Math.round(v * 100) / 100));
  assert.deepEqual(gaps([{ p: [0, -3], width: 1.1 }]), [[2.3, 3.7]]);
  assert.deepEqual(gaps([{ p: [0, -2.5], width: 1.1 }]), [[2.3, 3.7]], 'half a metre off the line still opens it');
  assert.deepEqual(gaps([{ p: [0, -1.5], width: 1.1 }]), [], 'a stair end out on the lawn is not at this rail');
  assert.deepEqual(gaps([{ p: [-2.8, -3], width: 1.1 }]), [[0, 0.9]], 'clipped at the corner');
  assert.deepEqual(gaps([{ p: [0, -3], width: 1.1 }, { p: [0.8, -3], width: 1.1 }]), [[2.3, 4.5]], 'two flights side by side: one gap');
  assert.deepEqual(gaps([{ p: [9, -3], width: 1.1 }]), [], 'past the end of the rail');
});
