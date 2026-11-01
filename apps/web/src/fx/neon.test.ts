// Soul Actions entry 33: a neon sign's words are bounded and cleaned; each tube strikes with a stutter, then holds steady.
import test from 'node:test';
import assert from 'node:assert/strict';
import { neonLevel, neonLines, seedOfNeon } from './neon.ts';
import { variantOf } from '../gen-mesh/sound-plan.ts';

test('the words: control characters out, at most two lines and 32 characters', () => {
  assert.deepEqual(neonLines('Night\u0007 Garden\nopen\nlate'), ['Night Garden', 'open']);
  assert.deepEqual(neonLines('x'.repeat(40)), ['x'.repeat(32)]);
  assert.deepEqual(neonLines(42), []);
});

test('each tube strikes with a stutter, then holds steady; a long-lit sign never stutters', () => {
  for (const id of ['e_0b56c165', 'e_f55eeb2e', 'e_2d174965', 'e_1234abcd']) {
    const seed = seedOfNeon(id), count = 13, dt = 0.01;
    let stutters = 0;
    for (let tube = 0; tube < count; tube++) {
      assert.equal(neonLevel(seed, tube, count, 0), 0, 'dark at the switch-on');
      let seen = false, dipped = false;
      for (let t = 0; t <= 2.4; t += dt) { const v = neonLevel(seed, tube, count, t); if (v > 0.6) seen = true; else if (seen && v < 0.3) dipped = true; }
      if (dipped) stutters++;
      const steady = Array.from({ length: 300 }, (_, i) => neonLevel(seed, tube, count, 2.5 + i * dt));
      assert.ok(Math.min(...steady) >= 0.85, `tube ${tube} steady after 2.5 s`);
      assert.ok((Math.max(...steady) - Math.min(...steady)) / Math.max(...steady) <= 0.08, `tube ${tube} varies ≤ 8 %`);
    }
    assert.ok(stutters >= 1, `${id}: at least one tube stutters`);
  }
});

test('the neon hum is a pinned voicing; hash-picked hums keep their voices', () => {
  assert.equal(variantOf('hum', 'any', 2), 2);
  for (const key of ['a', 'b', 'c', 'generator#0']) assert.ok(variantOf('hum', key) < 2);
  assert.equal(variantOf('hum', 'x', 1), 1);
});
