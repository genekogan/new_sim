import test from 'node:test';
import assert from 'node:assert/strict';
import { partition } from './v5-shard.mjs';

test('v5 shards are an exact, ordered, non-empty cover balanced by seconds', () => {
  const files = Array.from({ length: 40 }, (_, i) => `src/f${String(i).padStart(2, '0')}.test.ts`);
  const seconds = Object.fromEntries(files.map((f, i) => [f, i === 5 ? 100 : 10]));
  const shards = partition(files, seconds, 8);
  assert.equal(shards.length, 8);
  assert.deepEqual(shards.flat(), files);
  assert.ok(shards.every(s => s.length));
  const load = s => s.reduce((a, f) => a + seconds[f], 0);
  assert.ok(Math.max(...shards.map(load)) <= 100 + 10, 'the heavy file sits nearly alone');
});

test('v5 shards: unknown files weigh the median; more shards than files leaves empties at the end', () => {
  assert.deepEqual(partition(['a', 'b', 'c'], {}, 2).flat(), ['a', 'b', 'c']);
  const s = partition(['a', 'b'], {}, 4);
  assert.deepEqual(s, [['a'], ['b'], [], []]);
  assert.deepEqual(partition(['a', 'b', 'c', 'd'], { a: 1, b: 1, c: 1, d: 1 }, 2), [['a', 'b'], ['c', 'd']]);
});
