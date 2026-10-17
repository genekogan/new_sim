// Spatial.readPass (lane L1): one sync up front, then every sync of that world inside is "nothing changed" without
// walking the entities; another world, a lost scene or a grown ground window still sync for real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Spatial } from '../spatial/service.ts';
import { emptyWorld, human, addAll, component } from '../world/factory.ts';
import type { SpatialScene } from '../spatial/types.ts';

const open = (half: number): SpatialScene => ({
  bounds: [-half, -half, half, half],
  levels: [{ id: 0, y: 0, label: 'ground' }],
  surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [half, half], yaw: 0 } }],
  obstacles: [],
  links: [],
});

test('readPass: synced once, held for that world only, released after (also on a throw)', () => {
  const sp = new Spatial(open(20));
  const w = addAll(emptyWorld('open', open(20)), human('p', 0, 0), component('wall', 'test-wall', [5, 0, 0], 0, { phase: 'stored' }));
  const other = addAll(emptyWorld('open', open(20)), human('q', 1, 1));
  sp.sync(w);
  const epoch = sp.epoch;
  w.entities.wall.pose.p = [6, 0, 0];   // a static change made before the pass is picked up by its first sync
  const seen = sp.readPass(w, () => {
    assert.ok(sp.epoch > epoch, 'the pass syncs first');
    const e = sp.epoch;
    assert.equal(sp.sync(w), false);
    assert.equal(sp.epoch, e);
    sp.sync(other);   // another world: a real sync, and the hold on w is gone for the rest of the pass
    assert.equal(sp.sync(w), true, 'back to w: synced for real');
    return sp.epoch;
  });
  assert.ok(seen > epoch);
  w.entities.wall.pose.p = [7, 0, 0];
  assert.equal(sp.sync(w), true, 'after the pass a change syncs again');
  assert.throws(() => sp.readPass(w, () => { throw new Error('x'); }));
  w.entities.wall.pose.p = [8, 0, 0];
  assert.equal(sp.sync(w), true, 'released after a throw');
});
