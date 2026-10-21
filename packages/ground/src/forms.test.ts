// Tranche-2 landform kinds (L3): cliff, terrace, channel, brush; river water levels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Terrain, emptyGround, groundSchema, heightAt, waterLevelAt, type Ground, type Landform } from './index.ts';

const g0 = (forms: Landform[], extra: Partial<Ground> = {}): Ground => groundSchema.parse({ ...emptyGround(1000), landforms: forms, ...extra });

test('cliff: the up side stands h above the low side across a narrow face; steps make ledges; ends fade', () => {
  const g = g0([{ id: 'c', kind: 'cliff', path: [[-50, 0], [50, 0]], h: 12, face: 4, w: 20, back: 10 } as Landform]);
  // travel +x; left of travel is +z
  assert.equal(heightAt(g, 0, -5), 0, 'low side');
  assert.equal(heightAt(g, 0, 10), 12, 'shelf on the up side');
  assert.ok(heightAt(g, 0, 0) > 4 && heightAt(g, 0, 0) < 8, 'mid-face');
  assert.equal(heightAt(g, 0, 40), 0, 'falls back behind the shelf');
  assert.ok(heightAt(g, 58, 10) < 12 && heightAt(g, 70, 10) === 0, 'fades past the end');
  const stepped = g0([{ id: 'c', kind: 'cliff', path: [[-50, 0], [50, 0]], h: 12, face: 12, w: 20, back: 10, steps: 3 } as Landform]);
  const ledge = [heightAt(stepped, 0, -6 + 12 * 0.05), heightAt(stepped, 0, -6 + 12 * 0.15)];
  assert.ok(Math.abs(ledge[0] - ledge[1]) < 1e-9 && Math.abs(ledge[0] - 0) < 1e-9, `first ledge flat at 0: ${ledge}`);
  assert.ok(Math.abs(heightAt(stepped, 0, -6 + 12 * 0.5) - 4) < 1e-9, 'second ledge at h/3');
  const right = g0([{ id: 'c', kind: 'cliff', path: [[-50, 0], [50, 0]], h: 12, side: -1 } as Landform]);
  assert.equal(heightAt(right, 0, -10), 12, 'side −1 raises the right');
});

test('terrace: flatten an area to a named level; step mode cuts a hill into ledges', () => {
  const hill: Landform = { id: 'h', kind: 'bump', c: [0, 0], r: 60, h: 20, peak: 1 };
  const flat = g0([hill, { id: 't', kind: 'terrace', area: [[-10, -10], [10, -10], [10, 10], [-10, 10]], level: 12, edge: 3, name: 'upper-lawn' } as Landform]);
  assert.equal(heightAt(flat, 0, 0), 12); assert.equal(heightAt(flat, 6, 6), 12);
  const steps = g0([hill, { id: 't', kind: 'terrace', area: [[-55, -55], [55, -55], [55, 55], [-55, 55]], step: 3, edge: 2 } as Landform]);
  // sample a line up the slope: most samples sit on a multiple of 3 m (ledges), few on risers
  let onLedge = 0, n = 0;
  for (let x = 5; x < 45; x += 0.5) { const h = heightAt(steps, x, 0); n++; if (Math.abs(h / 3 - Math.round(h / 3)) < 1e-6) onLedge++; }
  assert.ok(onLedge / n > 0.55, `ledges ${onLedge}/${n}`);
});

test('channel: cut to per-vertex levels along a path, fill raises, set does both; strength 0 leaves ground alone', () => {
  const hill: Landform = { id: 'h', kind: 'bump', c: [0, 0], r: 80, h: 10, peak: 1 };
  const cut = g0([hill, { id: 'r', kind: 'channel', path: [[-60, 0], [0, 0], [60, 0]], levels: [2, 1, 0], w: 3, edge: 4, mode: 'cut' } as Landform]);
  assert.ok(Math.abs(heightAt(cut, 0, 0) - 1) < 1e-9, 'bed at the middle level');
  assert.ok(Math.abs(heightAt(cut, -30, 2) - 1.5) < 1e-9, 'interpolates between vertices, flat across w');
  assert.ok(heightAt(cut, 0, 9) > 5, 'beyond w + edge: untouched');
  const fill = g0([{ id: 'r', kind: 'channel', path: [[-20, 0], [20, 0]], levels: [3, 3], w: 2, mode: 'fill' } as Landform]);
  assert.equal(heightAt(fill, 0, 0), 3);
  const set = g0([hill, { id: 'r', kind: 'channel', path: [[-60, 0], [60, 0]], levels: [4, 4], w: 3, edge: 6, mode: 'set', strength: [1, 1] } as Landform]);
  assert.equal(heightAt(set, 0, 0), 4, 'cut down on the crest'); assert.equal(heightAt(set, -60, 0), 4, 'filled at the foot');
  const weak = g0([hill, { id: 'r', kind: 'channel', path: [[-60, 0], [0, 0], [60, 0]], levels: [4, 4, 4], w: 3, mode: 'set', strength: [1, 0, 1] } as Landform]);
  assert.equal(heightAt(weak, 0, 0), heightAt(g0([hill]), 0, 0), 'strength 0 at a vertex keeps the ground');
  assert.throws(() => g0([{ id: 'r', kind: 'channel', path: [[0, 0], [1, 0]], levels: [1], w: 2 } as Landform]));
});

test('brushes: raise, lower, flatten, smooth', () => {
  const up = g0([{ id: 'b', kind: 'brush', op: 'raise', c: [0, 0], r: 8, amount: 2 } as Landform]);
  assert.equal(heightAt(up, 0, 0), 2); assert.equal(heightAt(up, 9, 0), 0);
  const down = g0([{ id: 'b', kind: 'brush', op: 'lower', c: [0, 0], r: 8, amount: 2 } as Landform]);
  assert.equal(heightAt(down, 0, 0), -2);
  const spike: Landform = { id: 'a', kind: 'bump', c: [0, 0], r: 6, h: 8, peak: 3 };
  const flat = g0([spike, { id: 'b', kind: 'brush', op: 'flatten', c: [0, 0], r: 10, amount: 1, level: 1 } as Landform]);
  assert.equal(heightAt(flat, 0, 0), 1); assert.equal(heightAt(flat, 2, 2), 1);
  const smoothed = g0([spike, { id: 'b', kind: 'brush', op: 'smooth', c: [0, 0], r: 14, amount: 1 } as Landform]);
  const peak0 = heightAt(g0([spike]), 0, 0), peak1 = heightAt(smoothed, 0, 0);
  assert.ok(peak1 < peak0 * 0.6 && peak1 > 0, `smoothed peak ${peak1} vs ${peak0}`);
});

test('a smooth brush across a tile edge bakes exactly the full-ground function (tile subset widens)', () => {
  // the bump sits just outside tile (0,0); the brush near the edge samples into it
  const g = g0([{ id: 'a', kind: 'bump', c: [-6, 30], r: 5, h: 6, peak: 1 }, { id: 'b', kind: 'brush', op: 'smooth', c: [4, 30], r: 12, amount: 1 } as Landform]);
  const t = new Terrain(g);
  for (const [x, z] of [[1, 30], [2, 28], [3, 33]]) assert.equal(t.sample(x, z), Math.fround(heightAt(g, x, z)), `at ${x},${z}`);
});

test('river water levels interpolate along the flow; level outside the ribbon is null', () => {
  const g = g0([], { waters: [{ id: 'r', path: [[0, 0], [100, 0]], w: 6, level: 1, levels: [5, 1] }] });
  assert.equal(waterLevelAt(g, 0, 0), 5); assert.equal(waterLevelAt(g, 50, 1), 3); assert.equal(waterLevelAt(g, 50, 20), null);
  assert.throws(() => g0([], { waters: [{ id: 'r', path: [[0, 0], [100, 0]], w: 6, level: 1, levels: [5] }] }));
});

// Golden hashes for the new kinds (bit-exactness fixture, like ground.test.ts). Update only on purpose.
test('golden tile hashes for cliff, terrace, channel and brushes', () => {
  const t = new Terrain(g0([
    { id: 'h', kind: 'bump', c: [20, 20], r: 50, h: 14, peak: 1 },
    { id: 'c', kind: 'cliff', path: [[-60, -30], [60, -20]], h: 9, face: 5, w: 15, back: 8, steps: 2 } as Landform,
    { id: 't', kind: 'terrace', area: [[0, 0], [40, 0], [40, 40], [0, 40]], step: 2.5, edge: 3 } as Landform,
    { id: 'r', kind: 'channel', path: [[-60, 50], [0, 30], [60, 60]], levels: [3, 1, -1], w: 3, edge: 4 } as Landform,
    { id: 'b1', kind: 'brush', op: 'smooth', c: [30, 30], r: 10, amount: 0.8 } as Landform,
    { id: 'b2', kind: 'brush', op: 'flatten', c: [-30, 10], r: 8, amount: 1, level: 2 } as Landform,
  ]));
  const got = [t.hash(0, 0), t.hash(-1, 0), t.hash(-1, -1), t.hash(0, -1)];
  assert.deepEqual(got, GOLDEN, JSON.stringify(got));
});
const GOLDEN = ["725de8d5617d869f", "7b2826730d96ea35", "524056614f7192cb", "d15f5dc29af0b81a"];

test('a river (cut channel) carves through a road embankment (set channel) whatever their ids', () => {
  for (const [roadId, riverId] of [['a', 'z'], ['z', 'a']]) {
    const g = g0([
      { id: roadId, kind: 'channel', path: [[-40, 0], [40, 0]], levels: [2, 2], w: 4, edge: 10, mode: 'set' } as Landform,
      { id: riverId, kind: 'channel', path: [[0, -40], [0, 40]], levels: [-1.5, -1.5], w: 2, edge: 3, mode: 'cut' } as Landform,
    ]);
    assert.equal(heightAt(g, 0, 0), -1.5, `river bed under the bridge (road ${roadId})`);
    assert.equal(heightAt(g, 20, 0), 2, 'embankment elsewhere');
  }
});

test('HILL: a channel with overPads holds its levels over a pad bank, never over the pad flat', () => {
  const sq = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  const pad: Landform = { id: 'p:pad', kind: 'pad', area: sq(-5, -5, 5, 5), level: 0, edge: 16, grade: 0.45, fold: 'flats' } as Landform;
  const road = (overPads: boolean) => ({ id: 'r', kind: 'channel', path: [[-40, 8], [40, 8]], levels: [9, 9], w: 1.5, edge: 2, mode: 'set', ...(overPads ? { overPads } : {}) }) as Landform;
  const before = g0([pad, road(false)]), after = g0([pad, road(true)]);
  assert.ok(heightAt(before, 0, 8) < 9 - 1, `the pad bank clamps an ordinary graded way (${heightAt(before, 0, 8)})`);
  assert.equal(heightAt(after, 0, 8), 9, 'overPads: the way keeps its level on the bank');
  assert.equal(heightAt(after, 30, 8), heightAt(before, 30, 8), 'beyond the bank both agree');
  const across = g0([pad, { id: 'r', kind: 'channel', path: [[-40, 0], [40, 0]], levels: [3, 3], w: 1.5, edge: 2, mode: 'set', overPads: true } as Landform]);
  assert.equal(heightAt(across, 0, 0), 0, 'the pad flat stays at its level');
  assert.equal(heightAt(across, 20, 0), 3, 'off the flat the way holds');
});
