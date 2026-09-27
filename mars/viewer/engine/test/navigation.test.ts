// Proving-ground navigation regressions (spec §28 rows 1–5, 10–12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGrids, segmentClearance } from '../spatial/grid.ts';
import { findRoute, type Route, type WalkLeg } from '../spatial/path.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import { dist2, heading, sub2, angleDelta, type Vec2 } from '../core/math.ts';

const R = HUMAN_PROFILE.radius;
const scene = provingGround();
const grids = buildGrids(scene, 0.1);

function assertClear(route: Route) {
  for (const leg of route.legs) {
    if (leg.kind !== 'walk') continue;
    const g = grids.levels.get(leg.level)!;
    for (let i = 1; i < leg.points.length; i++)
      assert.ok(segmentClearance(g, leg.points[i - 1], leg.points[i]) >= R - 1e-6, `segment ${i} on level ${leg.level} violates clearance`);
  }
}
const walkLen = (l: WalkLeg) => l.points.slice(1).reduce((s, p, i) => s + dist2(p, l.points[i]), 0);

test('wall: plans around the wall before contact', () => {
  const r = findRoute(grids, scene, HUMAN_PROFILE, { level: 0, p: [-18, -15] }, { level: 0, p: [-12, -15] });
  assert.ok(r.ok, !r.ok ? r.diagnostic.message : '');
  assertClear(r.route);
  const leg = r.route.legs[0] as WalkLeg;
  // optimal detour around a 8.3 m wall ≈ 2*sqrt(3² + 4.15²) ≈ 10.2 m
  assert.ok(walkLen(leg) < 11.5, `length ${walkLen(leg)}`);
  assert.ok(leg.points.length <= 5, `smoothed to few corners, got ${leg.points.length}`);
});

test('U-shaped trap: global route exits via the open side', () => {
  const r = findRoute(grids, scene, HUMAN_PROFILE, { level: 0, p: [-15, 12] }, { level: 0, p: [-15, 20] });
  assert.ok(r.ok);
  assertClear(r.route);
  const pts = (r.route.legs[0] as WalkLeg).points;
  assert.ok(pts[1][1] < 12, 'first move heads away from the goal, out of the cup');
  assert.ok(pts.some((p) => p[1] < 9.2), 'route leaves the cup opening');
  assert.ok(walkLen(r.route.legs[0] as WalkLeg) < 22);
});

test('narrow passage: uses the 1.0 m gap rather than a long detour', () => {
  const r = findRoute(grids, scene, HUMAN_PROFILE, { level: 0, p: [15, -20] }, { level: 0, p: [15, -10] });
  assert.ok(r.ok);
  assertClear(r.route);
  assert.ok(r.route.length < 10.5, `length ${r.route.length}`);
});

test('too-narrow passage for a wide profile is rejected / detoured, never squeezed', () => {
  const wide = { ...HUMAN_PROFILE, id: 'wide', radius: 0.6 };
  const r = findRoute(grids, scene, wide, { level: 0, p: [15, -20] }, { level: 0, p: [15, -10] });
  assert.ok(r.ok);
  assert.ok(r.route.length > 15, 'detours around the wall ends');
});

test('stairs: oblique approach goes to the entry, faces up-stair, exits at landing', () => {
  // start north-east of the stair bottom, beside the stair body
  const r = findRoute(grids, scene, HUMAN_PROFILE, { level: 0, p: [3.5, 12.5] }, { level: 1, p: [10, 10] });
  assert.ok(r.ok, !r.ok ? r.diagnostic.message : '');
  assertClear(r.route);
  const kinds = r.route.legs.map((l) => (l.kind === 'link' ? `link:${l.link.id}` : `walk:${l.level}`));
  assert.deepEqual(kinds, ['walk:0', 'link:stairs-a', 'walk:1']);
  const w = r.route.legs[0] as WalkLeg;
  const n = w.points.length;
  const finalDir = heading(sub2(w.points[n - 1], w.points[n - 2]));
  assert.ok(Math.abs(angleDelta(finalDir, 0)) < 0.2, `final approach heading ${finalDir.toFixed(2)} should be ≈0 (up-stair)`);
  assert.ok(w.points[n - 1][0] < 2.0, 'enters from the bottom (west) end, not the side');
});

test('multi-level: deck → ground directly below uses stairs, never drops through', () => {
  const r = findRoute(grids, scene, HUMAN_PROFILE, { level: 1, p: [8, 8] }, { level: 0, p: [8, 5] });
  assert.ok(r.ok);
  assert.ok(r.route.legs.some((l) => l.kind === 'link' && l.link.id === 'stairs-a' && !l.ascending));
  const r2 = findRoute(grids, scene, HUMAN_PROFILE, { level: 0, p: [9, 9] }, { level: 1, p: [9, 9] });
  assert.ok(r2.ok, 'ground point under the deck → same XY on deck');
  assert.ok(r2.route.length > 10, 'goes round to the stairs');
});

test('incomplete stairs are not traversable and the failure names them', () => {
  // start near incomplete stairs B: must walk round to stairs A
  const r = findRoute(grids, scene, HUMAN_PROFILE, { level: 0, p: [19.5, 10] }, { level: 1, p: [12, 10] });
  assert.ok(r.ok);
  assert.ok(r.route.legs.every((l) => l.kind !== 'link' || l.link.id === 'stairs-a'));
  const s2 = provingGround({ stairsAUsable: false });
  const r2 = findRoute(buildGrids(s2, 0.1), s2, HUMAN_PROFILE, { level: 0, p: [0, 0] }, { level: 1, p: [10, 10] });
  assert.ok(!r2.ok);
  assert.equal(r2.diagnostic.code, 'route.link-unusable');
  assert.match(r2.diagnostic.message, /stairs-(a|b)/);
  assert.match(r2.diagnostic.message, /(treads|missing)/);
});

test('construction changes navigation: a new wall in the gap forces a detour', () => {
  const s2 = provingGround({ extra: [{ id: 'new-panel', obb: { c: [15, -15], half: [0.6, 0.1], yaw: 0 }, y0: 0, y1: 2.4, kind: 'component', label: 'installed plywood panel' }] });
  const g2 = buildGrids(s2, 0.1);
  const r = findRoute(g2, s2, HUMAN_PROFILE, { level: 0, p: [15, -20] }, { level: 0, p: [15, -10] });
  assert.ok(r.ok);
  assert.ok(r.route.length > 15);
  for (const leg of r.route.legs) if (leg.kind === 'walk') for (let i = 1; i < leg.points.length; i++) assert.ok(segmentClearance(g2.levels.get(0)!, leg.points[i - 1], leg.points[i]) >= R - 1e-6);
});

test('goal inside a wall is rejected with the blocking object named', () => {
  const r = findRoute(grids, scene, HUMAN_PROFILE, { level: 0, p: [-18, -15] }, { level: 0, p: [-15, -15] });
  assert.ok(!r.ok);
  assert.equal(r.diagnostic.code, 'route.goal-blocked');
  assert.match(r.diagnostic.message, /wall/);
});

test('deterministic: identical routes on repeat', () => {
  const a = findRoute(grids, scene, HUMAN_PROFILE, { level: 0, p: [-25, -25] } , { level: 1, p: [12, 12] });
  const b = findRoute(grids, scene, HUMAN_PROFILE, { level: 0, p: [-25, -25] }, { level: 1, p: [12, 12] });
  assert.deepEqual(a, b);
});

test('perf: grid build + long route budget', () => {
  const t0 = performance.now();
  const g = buildGrids(scene, 0.1);
  const t1 = performance.now();
  const r = findRoute(g, scene, HUMAN_PROFILE, { level: 0, p: [-28, -28] }, { level: 1, p: [13, 12] });
  const t2 = performance.now();
  assert.ok(r.ok);
  console.log(`grid build ${(t1 - t0).toFixed(1)} ms (600x600 x2 levels), route ${(t2 - t1).toFixed(1)} ms, expanded ${r.route.expanded}`);
  assert.ok(t1 - t0 < 1500 && t2 - t1 < 1500);
});
void ([] as Vec2[]);
