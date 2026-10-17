// L1 (Eden 2026 memory/speed): point reads off the paged windows no longer copy composites or build fine tiles. They must
// give the very answers the composite gives: GroundNav.clearanceReader(r) = clearanceAt(compose(r), q) to the bit, and
// GroundNav.clearanceCapped(r, cap) = min(that, cap) and clearTester(r, t) = (that ≥ t), whether q's fine tile is cached or classified round q, at tile seams, near
// water (wade/swim edges), steep ground and obstacles straddling seams, and 0 / false outside r.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyGround, groundSchema } from '../../ground/src/index.ts';
import { groundField, registerGroundRecipe } from './ground-bridge.ts';
import { GroundNav, type TileRect } from '../../../mars/viewer/engine/spatial/tiled.ts';
import { clearanceAt } from '../../../mars/viewer/engine/spatial/grid.ts';
import type { Obstacle } from '../../../mars/viewer/engine/spatial/types.ts';

const g = emptyGround(512);
g.landforms.push({ id: 'cliff', kind: 'ridge', path: [[40, 100], [90, 130]], w: 3, h: 6, peak: 1 } as never);
g.landforms.push({ id: 'lake', kind: 'carve', area: [[50, 50], [75, 52], [80, 70], [62, 78], [48, 66]], bed: -2, edge: 4 } as never);
g.landforms.push({ id: 'canal', kind: 'carve', area: [[0, 60], [130, 60], [130, 66], [0, 66]], bed: -0.9, edge: 1 } as never);
g.waters.push({ id: 'lake', area: [[50, 50], [75, 52], [80, 70], [62, 78], [48, 66]], level: 0 } as never);
g.waters.push({ id: 'canal', path: [[0, 63], [64, 63.4], [130, 62.8]], w: 3, level: 0, levels: [0, 0.05, 0.1] } as never);
const field = groundField(registerGroundRecipe(groundSchema.parse(g)));

let seed = 11; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const obstacles: Obstacle[] = [];
for (let k = 0; k < 160; k++) {
  const c: [number, number] = [k < 40 ? 64 + (rnd() - 0.5) * 6 : rnd() * 150 - 10, k >= 40 && k < 70 ? 64 + (rnd() - 0.5) * 6 : rnd() * 150 - 10];
  obstacles.push({ id: `o${k}`, obb: { c, half: [0.1 + rnd() * 2, 0.1 + rnd() * 1.5], yaw: rnd() * 3 }, y0: rnd() < 0.2 ? 2.5 : 0, y1: 0.3 + rnd() * 3, kind: 'component' });
}
const rects: TileRect[] = [[0, 0, 0, 0], [1, 0, 1, 0], [0, 0, 1, 1], [0, 1, 1, 1], [1, 1, 2, 2]];
const T = [0.4, 0.4 + 0.28, 0.68 + 0.0001, 0.28 + 0.12, 1, 1.65];

function points(r: TileRect): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k < 1500; k++) out.push([r[0] * 64 - 3 + rnd() * ((r[2] - r[0] + 1) * 64 + 6), r[1] * 64 - 3 + rnd() * ((r[3] - r[1] + 1) * 64 + 6)]);
  for (const s of [0, 64, 128, 192]) for (let k = 0; k < 120; k++) { const v = r[1] * 64 + k * 1.07; out.push([s, v], [s - 0.05, v], [v, s], [v, s - 1e-9]); }
  for (let k = 0; k < 600; k++) out.push([rnd() * 140, 57 + rnd() * 12]);   // the canal banks
  return out;
}

test('clearanceReader / clearTester give the composite\'s answers, tiles cached or not', () => {
  let n = 0;
  for (const r of rects) {
    const ref = new GroundNav(field, 0.1, { paged: true }), comp = ref.compose(r, obstacles);
    const cold = new GroundNav(field, 0.1, { paged: true });   // nothing cached: classified round each point
    const testers = T.map((t) => [t, cold.clearTester(r, obstacles, t), ref.clearTester(r, obstacles, t)] as const);
    const read = ref.clearanceReader(r, obstacles), coldRead = new GroundNav(field, 0.1, { paged: true }).clearanceReader(r, obstacles);
    const capped = [0.5, 1, 1.4].map((cap) => [cap, cold.clearanceCapped(r, obstacles, cap)] as const);
    for (const q of points(r)) {
      const want = clearanceAt(comp, q);
      assert.ok(Object.is(read(q), want) && Object.is(coldRead(q), want), `reader at ${q} in ${r}: ${read(q)} / ${coldRead(q)} vs ${want}`);
      for (const [cap, f] of capped) assert.ok(Object.is(f(q), Math.min(want, cap)), `capped ${cap} at ${q}: ${f(q)} vs ${want}`);
      for (const [t, a, b] of testers) { assert.equal(a(q), want >= t, `cold tester t=${t} at ${q} in ${r} (clearance ${want})`); assert.equal(b(q), want >= t, `warm tester t=${t} at ${q}`); n++; }
    }
    assert.equal(cold.stats.fineBuilds, 0, 'the cold testers built no fine tile');
    // past the apron's reach a tester reads the tiles (built as needed)
    const far = new GroundNav(field, 0.1, { paged: true }).clearTester(r, obstacles, 1.9);
    for (const q of points(r).slice(0, 400)) assert.equal(far(q), clearanceAt(comp, q) >= 1.9, `t=1.9 at ${q}`);
  }
  assert.ok(n > 50_000, `checks ${n}`);
});
