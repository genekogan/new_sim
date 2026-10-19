import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byDistance, nearKeyOf } from './WorldEntityLayer.ts';

// P1 phones: the progressive first build's order (nearest the arrival's eye or target first; things without a pose first)
test('byDistance: nearer of two points, stable for ties, pose-less first, distances carried', () => {
  const pos: Record<string, [number, number] | null> = { far: [100, 0], eyeSide: [0, 48], mid: [20, 0], none: null, tie1: [5, 0], tie2: [-5, 0] };
  const out = byDistance(Object.keys(pos), (k) => pos[k], [0, 0], [0, 50]);
  assert.deepEqual([...out], ['none', 'eyeSide', 'tie1', 'tie2', 'mid', 'far']);
  assert.deepEqual(out.dist, [0, 2, 5, 5, 20, 100]);
});

// P7: shapes by their nearest point (a path crossing the arrival, a woodland around it), furniture with its building
test('byDistance + nearKeyOf: shapes by nearest point, children by their root, no pose first', () => {
  const E = (id: string, x: Record<string, unknown>) => ({ id, def: 'd@1', in: { parent: 'world' }, by: 'god', born: 0, v: 1, ...x }) as never;
  const list = [
    E('far', { p: [100, 0, 0] }),
    E('path', { p: [0, 0, 0], shape: { path: [[200, -40], [200, 40]] } }),          // crosses near the arrival at x=200
    E('wood', { p: [0, 0, 0], shape: { area: [[190, -10], [210, -10], [210, 10], [190, 10]] } }),  // arrival inside
    E('hall', { p: [230, 0, 0] }),
    E('chair', { in: { parent: 'hall', slot: 's' }, p: [1, 0, 1] }),
    E('free', {}),
  ];
  const by = new Map((list as { id: string }[]).map((e) => [e.id, e])) as never;
  const out = byDistance(list, nearKeyOf(by), [200, 0], [200, 30]);
  assert.deepEqual(out.map((e: { id: string }) => e.id), ['path', 'wood', 'free', 'hall', 'chair', 'far']);
  assert.deepEqual(out.dist, [0, 0, 0, Math.hypot(30, 0), Math.hypot(30, 0), 100]);
});
