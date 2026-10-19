import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byDistance } from './WorldEntityLayer.ts';

// P1 phones: the progressive first build's order (nearest the arrival's eye or target first; things without a pose first)
test('byDistance: nearer of two points, stable for ties, pose-less first, distances carried', () => {
  const pos: Record<string, [number, number] | null> = { far: [100, 0], eyeSide: [0, 48], mid: [20, 0], none: null, tie1: [5, 0], tie2: [-5, 0] };
  const out = byDistance(Object.keys(pos), (k) => pos[k], [0, 0], [0, 50]);
  assert.deepEqual([...out], ['none', 'eyeSide', 'tie1', 'tie2', 'mid', 'far']);
  assert.deepEqual(out.dist, [0, 2, 5, 5, 20, 100]);
});
