// L8 item 4 (server reliability 2026-10-31): "by the X" names must not depend on the order of the named-things list.
// A point at distance 0 from two things (inside a place region and a tree area) kept the list's order on the tie; a boot's
// whole pass and the incremental passes that wrote the stored state built that list in different orders, so every first
// boot after a copy rewrote ~470 built objects' `near` and `what` (and their `advance` log rows) for nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GodNav } from './nav.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
const navOver = (order: { id: string; ref: string; kind: string }[], d: Record<string, number>) => {
  const n = Object.create(GodNav.prototype) as any;
  Object.assign(n, { cache: { key: 'k' }, nearMemo: new Map(), nearOf: 'k', things: () => order, within: () => order, distance: (t: { ref: string }) => d[t.ref] });
  return n as GodNav;
};

test('namesNear and landmarks break distance ties by ref, whatever the things order', () => {
  const things = ['trees-old-7-2', 'place-region-canal-quarter', 'bench-z', 'far-lamp'].map((ref) => ({ id: `e_${ref}`, ref, kind: 'object' }));
  const d = { 'trees-old-7-2': 0, 'place-region-canal-quarter': 0, 'bench-z': 0, 'far-lamp': 5 };
  const results = [things, [...things].reverse(), [things[2], things[0], things[3], things[1]]].map((order) => {
    const n = navOver(order, d);
    return { near: n.namesNear([0, 0], 'none', 2), marks: n.landmarks({ id: 'e_me', ref: 'me', kind: 'object', at: [0, 0] } as never, 3).map((x) => x.ref) };
  });
  for (const r of results) assert.deepEqual(r, { near: ['bench-z', 'place-region-canal-quarter'], marks: ['bench-z', 'place-region-canal-quarter', 'trees-old-7-2'] });
  // nearest still comes first
  assert.deepEqual(navOver(things, { ...d, 'bench-z': 1, 'far-lamp': 0 }).namesNear([0, 0], 'none', 2), ['far-lamp', 'place-region-canal-quarter']);
});
