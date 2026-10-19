// Lane P5 (cold boot): a flat-mode sync builds its grids when they are first read. The grids read are the ones the
// eager build gave (also through the incremental patch path and after several unread syncs), the navigation epoch moves
// at each sync as before, and ground mode replaces unread flat grids without building them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Spatial } from '../spatial/service.ts';
import * as grid from '../spatial/grid.ts';
import { emptyWorld, human, addAll, component } from '../world/factory.ts';
import { HUMAN_PROFILE, type SpatialScene } from '../spatial/types.ts';

const open = (half: number): SpatialScene => ({
  bounds: [-half, -half, half, half],
  levels: [{ id: 0, y: 0, label: 'ground' }],
  surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [half, half], yaw: 0 } }],
  obstacles: [],
  links: [],
});
const plain = (g: grid.GridSet) => ({ cell: g.cell, levels: [...g.levels.entries()].map(([id, l]) => [id, { ...l, free: Array.from(l.free as ArrayLike<number>) }]) });

for (const planner of ['exact', 'corridor'] as const) test(`lazy flat grids (${planner}): the same grids and epochs as reading after every sync`, () => {
  const world = () => addAll(emptyWorld('open', open(20)), human('p', 0, 0), component('wall', 'test-wall', [5, 0, 0], 0, { phase: 'stored' }));
  const eager = new Spatial(open(20), { planner }), lazy = new Spatial(open(20), { planner });
  const a = world(), b = world();
  const moves: [number, number, number][] = [[6, 0, 0], [6, 0, 2], [-4, 0, 3]];
  eager.sync(a); void eager.grids; lazy.sync(b);
  for (const p of moves) {
    a.entities.wall.pose.p = [...p]; b.entities.wall.pose.p = [...p];
    eager.sync(a); void eager.grids;   // read after each sync (the eager build's order)
    lazy.sync(b);                      // two unread syncs in a row: the first is built when the second needs it
    assert.equal(lazy.epoch, eager.epoch);
  }
  assert.deepEqual(plain(lazy.grids), plain(eager.grids));
  const from = { level: 0, p: [-10, 0] }, to = { level: 0, p: [10, 0] };
  assert.deepEqual(lazy.route(b, HUMAN_PROFILE, from as never, to as never), eager.route(a, HUMAN_PROFILE, from as never, to as never));
});

test('lazy flat grids: a sync that is never read builds nothing; assigning grids drops the pending build', () => {
  const sp = new Spatial(open(20)), w = addAll(emptyWorld('open', open(20)), human('p', 0, 0));
  const calls = { n: 0 };
  sp.prof = { now: () => 0, add: () => {}, time: <T>(k: string, f: () => T) => { if (k === 'spatial.sync.grids') calls.n++; return f(); } } as never;
  sp.sync(w);
  assert.equal(calls.n, 0, 'nothing built before a read');
  const other = new Spatial(open(20)); other.sync(w);
  sp.grids = other.grids;   // what ground mode does: its own grids replace the flat ones unread
  assert.equal(calls.n, 0, 'the replaced build never runs');
  assert.equal(sp.grids, other.grids);
});
