import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SKIRT_MAX_M, Terrain, bakeTile, emptyGround, footprintOf, groundSchema, heightAt, mediumAt, padFor, settle, tileHash, tilesTouched, waterDepthAt, TILE_N, type Ground, type Landform } from './index.ts';

const hill: Landform = { id: 'knoll', kind: 'bump', c: [0, 0], r: 20, h: 6, peak: 1 };
const mountain: Landform = { id: 'east', kind: 'ridge', path: [[300, -200], [340, 220]], w: 140, h: 180, peak: 2 };
const lakeArea: [number, number][] = [[-260, -40], [-180, -90], [-150, 10], [-230, 60]];
const lake: Landform = { id: 'west-lake', kind: 'carve', area: lakeArea, bed: -5, edge: 6 };

function world(): Ground {
  const g = emptyGround(1000);
  g.landforms.push(hill, mountain, lake);
  g.waters.push({ id: 'west-lake', area: lakeArea, level: -0.5 });
  return groundSchema.parse(g);
}

test('flat world is base everywhere', () => {
  const g = emptyGround(1000, 0);
  for (const [x, z] of [[0, 0], [499, -499], [-123.4, 77.7]]) assert.equal(heightAt(g, x, z), 0);
});

test('a bump peaks at its centre and vanishes at its radius; a ridge rises along its path', () => {
  const g = world();
  assert.equal(heightAt(g, 0, 0), 6);
  assert.equal(heightAt(g, 20, 0), 0);
  assert.ok(heightAt(g, 10, 0) > 0 && heightAt(g, 10, 0) < 6);
  assert.ok(heightAt(g, 320, 0) > 150, 'mountain crest');
  assert.equal(heightAt(g, 100, 0), 0, 'plain between');
});

test('carve lowers to the bed inside, leaves the plain outside; water depth follows', () => {
  const g = world(); const t = new Terrain(g);
  assert.ok(Math.abs(heightAt(g, -210, -20) - -5) < 1e-6, 'lake bed');
  assert.equal(heightAt(g, -100, 0), 0);
  assert.ok(waterDepthAt(t, -210, -20) > 4);
  assert.equal(waterDepthAt(t, -100, 0), 0);
  assert.equal(mediumAt(t, -210, -20), 'swim');
  assert.equal(mediumAt(t, -100, 0), 'walk');
});

test('tiles reproduce the function at samples and interpolate between; hash is stable and order-independent of time', () => {
  const g = world(); const t = new Terrain(g);
  for (const [x, z] of [[0, 0], [7, 3], [-200, -20], [320, 10]]) assert.equal(t.sample(x, z), Math.fround(heightAt(g, x, z)));
  const mid = t.sample(0.5, 0);
  assert.ok(mid < 6 && mid > heightAt(g, 1, 0), 'bilinear between samples');
  const a = tileHash(bakeTile(g, 0, 0)), b = tileHash(bakeTile(world(), 0, 0));
  assert.equal(a, b);
  assert.equal(a.length, 16);
  assert.equal(bakeTile(g, 0, 0).length, TILE_N * TILE_N);
});

// Golden hashes: if these change, server and browser (or two Node versions) would disagree. Update only on purpose.
test('golden tile hashes (bit-exactness fixture)', () => {
  const t = new Terrain(world());
  assert.deepEqual([t.hash(0, 0), t.hash(-1, -1), t.hash(4, 0), t.hash(-4, -1)], ['2c87af0aa39f648e', '147cf2660f9e26d2', 'd8691134fa39165c', '73efff3d30c0594f']);
});

test('noise is deterministic and bounded', () => {
  const g = emptyGround(1000); g.noise = { amp: 0.4, scale: 9, seed: 7 };
  const a = heightAt(g, 12.3, -45.6), b = heightAt(structuredClone(g), 12.3, -45.6);
  assert.equal(a, b);
  for (let i = 0; i < 200; i++) assert.ok(Math.abs(heightAt(g, i * 3.7, -i * 1.3)) <= 0.4 + 1e-9);
});

test('settle: base takes the lowest corner and asks for a pad on a slope; the pad then flattens the footprint', () => {
  const g = world(); const t = new Terrain(g);
  const fp = footprintOf(8, 0, 4, 3, 0.3); // on the knoll's flank
  const s = settle(t, fp, 'base');
  assert.equal(s.y, Math.min(...s.samples));
  assert.ok(s.gap > 0.6, `gap ${s.gap}`);
  assert.equal(s.needsPad, true);
  const pad = padFor('cottage-pad', fp, s.y);
  g.landforms.push(pad);
  const keys = t.update(g, [pad]);
  assert.ok(keys.includes('0,0') && keys.includes('0,-1'), `touched ${keys}`);
  const s2 = settle(t, fp, 'base');
  assert.ok(s2.gap <= SKIRT_MAX_M, `flattened to a skirt-sized gap, got ${s2.gap}`);
  assert.ok(Math.abs(s2.y - s.y) < 0.3, `level kept, ${s2.y} vs ${s.y}`);
  assert.equal(s2.needsPad, false);
});

test('settle: center sinks the trunk; conform tilts within the clamp; drape uses the mean', () => {
  const t = new Terrain(world());
  const fp = footprintOf(10, 0, 0.3, 0.3, 0);
  assert.ok(Math.abs(settle(t, fp, 'center').y - (t.sample(10, 0) - 0.2)) < 1e-9);
  const c = settle(t, footprintOf(10, 0, 1, 1, 0), 'conform');
  assert.ok(Math.abs(c.roll!) > 0 && Math.abs(c.roll!) <= 0.35);
  const d = settle(t, fp, 'drape');
  assert.ok(d.y > 0);
});

test('tilesTouched covers a landform and pads reach beyond their area', () => {
  assert.deepEqual(tilesTouched(hill).sort(), ['-1,-1', '-1,0', '0,-1', '0,0']);
  const pad: Landform = { id: 'p', kind: 'pad', area: [[63, 63], [63.5, 63], [63.5, 63.5], [63, 63.5]], level: 0, edge: 1.5 };
  assert.ok(tilesTouched(pad).includes('1,1'));
});

test('schema refuses malformed landforms', () => {
  const g = emptyGround(100);
  (g.landforms as unknown[]).push({ id: 'x', kind: 'carve', bed: -1 });
  assert.throws(() => groundSchema.parse(g));
});

test('a 1 km world bakes in budget', () => {
  const t = new Terrain(world());
  // CPU time, not wall time: the budget is about our code, not about how loaded the machine is.
  const c0 = process.cpuUsage();
  for (let tz = -8; tz < 8; tz++) for (let tx = -8; tx < 8; tx++) t.tile(tx, tz);
  const c1 = process.cpuUsage(c0), ms = (c1.user + c1.system) / 1000;
  assert.equal(t.cachedTiles, 256);
  assert.ok(ms < 4000, `256 tiles took ${ms.toFixed(0)} ms`);
});

test('the last-tile cache answers like the map and forgets a tile an edit invalidates', () => {
  const g = world(), t = new Terrain(g), fresh = (x: number, z: number) => new Terrain(g).sample(x, z);
  for (const [x, z] of [[1, 2], [3, 4], [1, 2], [-200, 10], [5, 5]] as [number, number][]) { assert.equal(t.sample(x, z), fresh(x, z)); assert.equal(t.slope(x, z), new Terrain(g).slope(x, z)); }
  const before = t.sample(2, 3);
  const g2 = groundSchema.parse({ ...g, landforms: [...g.landforms, { id: 'pile', kind: 'bump', c: [2, 3], r: 8, h: 4, peak: 1 }] });
  t.update(g2, [g2.landforms.at(-1)!]);
  assert.notEqual(t.sample(2, 3), before); assert.equal(t.sample(2, 3), new Terrain(g2).sample(2, 3));
});

// pad/2b (lane PADFIX): graded pads fold together after older pads, so flats win over banks
const sq = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
function flatsWorld(...pads: Landform[]): Ground {
  const g = emptyGround(200, 0);
  g.landforms.push(...pads);
  return groundSchema.parse(g);
}

test('pad/2b: a neighbour bank never cuts a flat; its cut cone meets the flat at the flat level', () => {
  // A at 0 (house x -10..0, door landing x 0..2); B cut 3 m down 1.5 m beyond A's landing
  const A: Landform = { id: 'a', kind: 'pad', area: sq(-10, -5, 0, 5), aprons: [sq(0, -1, 2, 1)], level: 0, edge: 16, grade: 0.5, fold: 'flats' };
  const B: Landform = { id: 'b', kind: 'pad', area: sq(3.5, -5, 12, 5), level: -3, edge: 16, grade: 0.5, fold: 'flats' };
  for (const order of [[A, B], [B, A]]) {
    const g = flatsWorld(...order);
    for (const x of [-9, -1, 0.5, 1.9]) assert.equal(heightAt(g, x, 0), 0, `A's flat at x=${x}`);
    for (const x of [4, 8, 11]) assert.equal(heightAt(g, x, 0), -3, `B's flat at x=${x}`);
  }
});

test('pad/2b: no cliff at a landing edge where a neighbour cut cone digs below the landing pad fill cone (padfix2)', () => {
  // the natural ground (0) lies inside both cones; old fold: B's cut bound alone held the ground at the landing edge
  // (-3 + 0.5 x 1.5 = -2.25 m against a landing at 0: a 2.25 m cliff at the door). Now A's fill bound binds against the
  // ground as B clamped it, and the ground ramps between the two levels by distance to their flats.
  const A: Landform = { id: 'a', kind: 'pad', area: sq(-10, -5, 0, 5), aprons: [sq(0, -1, 2, 1)], level: 0, edge: 16, grade: 0.5, fold: 'flats' };
  const B: Landform = { id: 'b', kind: 'pad', area: sq(3.5, -5, 12, 5), level: -3, edge: 16, grade: 0.5, fold: 'flats' };
  const g = flatsWorld(A, B);
  assert.ok(Math.abs(heightAt(g, 2.01, 0)) < 0.05, `just off the landing: ${heightAt(g, 2.01, 0)}`);
  assert.ok(Math.abs(heightAt(g, 3.49, 0) + 3) < 0.05, `just off B's flat: ${heightAt(g, 3.49, 0)}`);
  let prev = heightAt(g, 1.95, 0);
  for (let x = 2; x <= 3.6; x += 0.05) {
    const h = heightAt(g, x, 0);
    assert.ok(Math.abs(h - prev) <= 0.15, `step at x=${x.toFixed(2)}: ${prev.toFixed(2)} -> ${h.toFixed(2)}`);
    assert.ok(h <= 0 + 1e-9 && h >= -3 - 1e-9, `between the levels at x=${x.toFixed(2)}`);
    prev = h;
  }
  // where the cones meet with room to spare the ground is unchanged (natural ground inside both cones, nothing binds)
  const C: Landform = { id: 'c', kind: 'pad', area: sq(20, -5, 30, 5), level: -1, edge: 16, grade: 0.5, fold: 'flats' };
  assert.equal(heightAt(flatsWorld(A, C), 10.5, 20), heightAt(emptyGround(200, 0), 10.5, 20));
});
