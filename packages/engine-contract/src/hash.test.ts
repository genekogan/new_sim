import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256, stableStringify, hashOf } from './hash.ts';
import { seedRng, nextU32 } from './rng.ts';

test('sha256 known vectors', () => {
  assert.equal(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256('a'.repeat(1000)).length, 64);
});
test('stableStringify sorts keys and drops undefined', () => {
  assert.equal(stableStringify({ b: 1, a: [{ d: undefined, c: -0 }] }), '{"a":[{"c":0}],"b":1}');
  assert.throws(() => stableStringify({ x: Infinity }));
});
test('hashOf stable', () => assert.equal(hashOf({ a: 1, b: 2 }), hashOf({ b: 2, a: 1 })));
test('rng deterministic', () => {
  const a = seedRng('x'), b = seedRng('x');
  for (let i = 0; i < 10; i++) assert.equal(nextU32(a), nextU32(b));
});
