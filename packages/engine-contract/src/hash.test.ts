import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256, stableStringify, hashOf } from './hash.ts';
import { seedRng, nextU32 } from './rng.ts';
import { createHash } from 'node:crypto';

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
test('sha256 equals node:crypto for every padding length, multi-block, non-ASCII and large inputs', () => {
  const ref = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
  for (let n = 0; n < 200; n++) { const t = 'x'.repeat(n); assert.equal(sha256(t), ref(t), `length ${n}`); }
  const rng = seedRng('sha');
  for (let k = 0; k < 40; k++) { let t = ''; const n = nextU32(rng) % 5000; for (let i = 0; i < n; i++) t += String.fromCharCode(32 + (nextU32(rng) % 900)); assert.equal(sha256(t), ref(t)); }
  const big = JSON.stringify(Array.from({ length: 20000 }, (_, i) => ({ i, v: Math.sin(i) })));
  assert.equal(sha256(big), ref(big));
  assert.equal(sha256('é😀\u0000'), ref('é😀\u0000'));
});
