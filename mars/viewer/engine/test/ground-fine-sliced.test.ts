import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GroundNav, deckedField, boxesOf } from '../spatial/tiled.ts';
import { BODY_HEIGHT, STEP, edt, latticeCentre, rasterObb } from '../spatial/grid.ts';
import { coarseMedium, G_OUTSIDE, G_STEEP, G_SWIM, G_WADE, G_WALK, type GroundField } from '../spatial/ground.ts';
import { CONNECT_CLEAR, labelComponents } from '../spatial/connectivity.ts';
import { pointInObb, rot2, type Vec2 } from '../core/math.ts';
import type { Obstacle, Surface } from '../spatial/types.ts';

// Independent reference copied from tiled.ts at 058d93795d57, before resumable classification.
// Keep its whole-raster traversal and id allocation order; do not regenerate from the sliced implementation.
function legacyClassify(nav: GroundNav,ox: number, oz: number, M: number, rel: Obstacle[], i0: number, j0: number, ni: number, nj: number, blk?: Int16Array, ids?: string[]): Uint8Array {
    const { cell, field } = nav;
    const free = new Uint8Array(ni * nj);
    // coarse media around the apron'd tile (1 m cells), and which cells touch water — evaluated as first needed
    const c0x = Math.floor(latticeCentre(ox, cell)) - 1, c0z = Math.floor(latticeCentre(oz, cell)) - 1;
    const cw = Math.floor(latticeCentre(ox + M - 1, cell)) + 2 - c0x;
    const coarse = new Uint8Array(cw * cw).fill(255), wet = new Uint8Array(cw * cw).fill(255);
    const cm = (k: number) => { let c = coarse[k]; if (c === 255) c = coarse[k] = coarseMedium(field, c0x + (k % cw) + 0.5, c0z + Math.floor(k / cw) + 0.5); return c; };
    const wetAt = (k: number) => {
      let w = wet[k]; if (w !== 255) return w;
      const i = k % cw, j = Math.floor(k / cw); w = 0;
      for (let dj = -1; dj <= 1 && !w; dj++) for (let di = -1; di <= 1; di++) {
        const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= cw || b >= cw) continue;
        const c = cm(b * cw + a); if (c === G_WADE || c === G_SWIM) { w = 1; break; }
      }
      return (wet[k] = w);
    };
    for (let j = 0; j < nj; j++) {
      const z = latticeCentre(oz + j0 + j, cell), cj = Math.floor(z) - c0z;
      for (let i = 0; i < ni; i++) {
        const x = latticeCentre(ox + i0 + i, cell), ci = Math.floor(x) - c0x, k = j * ni + i, ck = cj * cw + ci, c = cm(ck);
        if (c === G_OUTSIDE) { if (blk) blk[k] = 0; continue; }
        if (c === G_STEEP) { if (blk) blk[k] = 1; continue; }
        if (wetAt(ck)) {
          const lvl = field.waterLevel(x, z);
          if (lvl !== null && lvl - field.height(x, z) > field.wadeMax + 1e-4) { if (blk) blk[k] = 2; continue; }
        }
        free[k] = 1;
      }
    }
    // obstacles in the body band above the ground at each cell (first listed names the cell, as stampLevel)
    const whole = i0 === 0 && j0 === 0 && ni === M && nj === M, boxes = whole ? null : boxesOf(rel);
    const bx0 = latticeCentre(ox + i0, cell) - cell, bz0 = latticeCentre(oz + j0, cell) - cell, bx1 = latticeCentre(ox + i0 + ni - 1, cell) + cell, bz1 = latticeCentre(oz + j0 + nj - 1, cell) + cell;
    const clip: [number, number, number, number] | undefined = whole ? undefined : [i0, i0 + ni - 1, j0, j0 + nj - 1];
    for (let n = 0; n < rel.length; n++) {
      if (boxes && (boxes[4 * n + 2] < bx0 || boxes[4 * n] > bx1 || boxes[4 * n + 3] < bz0 || boxes[4 * n + 1] > bz1)) continue;
      const o = rel[n];
      let idx = -1;
      rasterObb(o.obb, ox, oz, cell, M, M, (g) => {
        const k = (Math.floor(g / M) - j0) * ni + (g % M) - i0;
        if (!free[k]) return;
        const x = latticeCentre(ox + (g % M), cell), z = latticeCentre(oz + Math.floor(g / M), cell), h = field.height(x, z);
        if (o.y1 <= h + STEP || o.y0 >= h + BODY_HEIGHT) return;
        if (blk && ids) { if (idx < 0) { idx = ids.length; ids.push(o.id); if (idx > 32000) throw new Error('ground: too many obstacles in one tile'); } blk[k] = idx; }
        free[k] = 0;
      }, o.raster !== 'centre', clip);
    }
    return free;
  }

const media = new Map<string, Uint8Array>();
const base: GroundField = {
  id: 'fine-sliced-field', extent: [-128, -128, 128, 128], wadeMax: .6, maxSlope: 1,
  height: (x, z) => (x > 4 && x < 8 ? .2 : 0) + (z < -40 ? .1 : 0),
  waterLevel: (x, z) => x > -2 && x < 3 && z < 20 ? .9 : null,
  medium: (x, z) => x < -100 ? G_OUTSIDE : x > 50 ? G_STEEP : x > -2 && x < 3 && z < 20 ? G_SWIM : G_WALK,
  mediaTile(tx, tz) {
    const key = `${tx},${tz}`, hit = media.get(key); if (hit) return hit;
    const out = new Uint8Array(64 * 64);
    for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) out[j * 64 + i] = this.medium(tx * 64 + i + .5, tz * 64 + j + .5);
    media.set(key, out); return out;
  },
};
const obstacles: Obstacle[] = [
  { id: 'long-rotated', kind: 'wall', obb: { c: [0, 0], half: [.12, 50], yaw: .731 }, y0: 0, y1: 3 },
  { id: 'overlap', kind: 'wall', obb: { c: [0, 0], half: [3, 12], yaw: -.24 }, y0: 0, y1: 3 },
  { id: 'centre-raster', kind: 'wall', obb: { c: [2, -2], half: [3, 20], yaw: .13 }, y0: .1, y1: .7, raster: 'centre' },
  { id: 'above-body', kind: 'wall', obb: { c: [0, 0], half: [50, 50], yaw: 0 }, y0: 5, y1: 6 },
];
function legacyTile(nav: GroundNav, tx: number, tz: number, rel: Obstacle[]) {
  const { cell, per, apron: A } = nav, M = per + 2 * A;
  const blk = new Int16Array(M * M).fill(-1), ids = ['ground:outside', 'ground:steep', 'ground:water'];
  const free = legacyClassify(nav, tx * per - A, tz * per - A, M, rel, 0, 0, M, M, blk, ids), clearance = edt(free, M, M, cell);
  const out = { free: new Uint8Array(per * per), clearance: new Float32Array(per * per), blk: new Int16Array(per * per), ids };
  for (let j = 0; j < per; j++) for (const k of ['free', 'clearance', 'blk'] as const) out[k].set(({ free, clearance, blk })[k].subarray((j + A) * M + A, (j + A) * M + A + per), j * per);
  return out;
}
function sameTile(actual: ReturnType<GroundNav['fineTile']>, expected: Pick<ReturnType<GroundNav['fineTile']>, 'free' | 'clearance' | 'blk' | 'ids'>, per: number) {
  for (const k of ['free', 'clearance', 'blk'] as const) {
    const a = actual[k], b = expected[k];
    assert.deepEqual(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength), `${k} bytes`);
  }
  assert.deepEqual(actual.ids, expected.ids);
  assert.deepEqual(labelComponents(actual.clearance, per, per, CONNECT_CLEAR), labelComponents(expected.clearance, per, per, CONNECT_CLEAR));
}
for (const [tx, tz] of [[-1, -1], [0, 0], [-2, 0]]) test(`fine tile: legacy byte parity across slices at ${tx},${tz}`, () => {
  const nav = new GroundNav(base, .25), entry = nav.tileEntry(tx, tz, obstacles);
  const expected = legacyTile(nav, tx, tz, entry.rel), steps = nav.fineTileSteps(tx, tz, entry.rel, entry.key);
  let step = steps.next(), slices = 0;
  while (!step.done) {
    assert.ok(++slices < 10000);
    // Interleaved point reads must not mutate the unfinished raster or change obstacle ids.
    nav.clearTester([-2, -1, 1, 1], obstacles, CONNECT_CLEAR)([.2, .2]);
    step = steps.next();
  }
  assert.ok(slices > 10); sameTile(step.value, expected, nav.per);
  assert.equal(nav.fineTile(tx, tz, entry.rel, entry.key), step.value, 'only the completed object is cached');
  sameTile(new GroundNav(base, .25).fineTile(tx, tz, entry.rel, entry.key), expected, nav.per);
});

test('fine tile: a synchronous read during unfinished work sees a complete raster', () => {
  const nav = new GroundNav(base, .5), entry = nav.tileEntry(0, 0, obstacles), steps = nav.fineTileSteps(0, 0, entry.rel, entry.key);
  assert.equal(steps.next().done, false);
  const synchronous = nav.fineTile(0, 0, entry.rel, entry.key);
  sameTile(synchronous, legacyTile(nav, 0, 0, entry.rel), nav.per);
  let step = steps.next(); while (!step.done) step = steps.next();
  sameTile(step.value, synchronous, nav.per);
});

test('deck basis: legacy point predicates at rotated boundaries, overlaps and mutable yaw', () => {
  const decks: Surface[] = [
    { id: 'a', level: 0, y: 1, obb: { c: [0, 0], half: [2, 1], yaw: .731 } },
    { id: 'b', level: 0, y: 2, obb: { c: [.2, -.1], half: [1, 1.5], yaw: -.44 } },
  ];
  const field = deckedField(base, decks, 'test');
  const expected = (x: number, z: number) => {
    let y = -Infinity, g = NaN;
    for (const s of decks) if (s.y > y && pointInObb([x, z], s.obb)) { if (g !== g) g = base.height(x, z); if (s.y >= g - .05) y = s.y; }
    return y === -Infinity ? null : y;
  };
  for (const [tx, tz] of [[0, 0], [-1, -1]]) {
    const want = base.mediaTile(tx, tz).slice();
    for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) if (expected(tx * 64 + i + .5, tz * 64 + j + .5) !== null) want[j * 64 + i] = G_WALK;
    assert.deepEqual(field.mediaTile(tx, tz), want, 'coarse deck media matches the legacy point predicate');
  }
  for (const yaw of [0, -0, .731, -Math.PI, Math.PI / 2, 9.3]) {
    decks[0].obb.yaw = yaw;
    for (const s of decks) for (const edge of [-1, 1]) for (const eps of [-1e-12, 0, 1e-12]) for (let t = -1; t <= 1; t += .25) {
      for (const local of [[edge * (s.obb.half[0] + eps), t * s.obb.half[1]], [t * s.obb.half[0], edge * (s.obb.half[1] + eps)]] as Vec2[]) {
        const r = rot2(local, s.obb.yaw), x = s.obb.c[0] + r[0], z = s.obb.c[1] + r[1], y = expected(x, z);
        assert.equal(field.height(x, z), y ?? base.height(x, z));
        assert.equal(field.waterLevel(x, z), y === null ? base.waterLevel(x, z) : null);
        assert.equal(field.medium(x, z), y === null ? base.medium(x, z) : G_WALK);
      }
    }
  }
  const nav = new GroundNav(base, .5); nav.setFloors(decks); const before = nav.field;
  const media = before.mediaTile(0, 0);
  decks[0].obb.yaw = .321; decks[0].obb.c = [20, 20]; nav.setFloors(decks);
  assert.notEqual(nav.field, before); assert.notEqual(nav.field.id, before.id);
  assert.notEqual(nav.field.mediaTile(0, 0), media, 'setFloors replaces the overlay and its media cache');
  assert.equal(nav.field.height(20, 20), 1);
});
