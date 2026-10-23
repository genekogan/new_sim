import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasStraightLandings, railRaster } from './rail-raster.ts';
import { buildGrids, centreOf } from '../../../../mars/viewer/engine/spatial/grid.ts';
import { findRoute } from '../../../../mars/viewer/engine/spatial/path.ts';
import { HUMAN_PROFILE, type SpatialScene } from '../../../../mars/viewer/engine/spatial/types.ts';
import type { OBB2, Vec2 } from '../../../../mars/viewer/engine/core/math.ts';

const boxDistance = (p: Vec2, b: OBB2) => {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw), x = p[0] - b.c[0], z = p[1] - b.c[1];
  return Math.hypot(Math.max(0, Math.abs(x*c + z*s) - b.half[0]), Math.max(0, Math.abs(-x*s + z*c) - b.half[1]));
};
function safeRoute(r: ReturnType<typeof findRoute>, solid: OBB2) {
  assert.equal(r.ok, true);
  if (!r.ok) return;
  for (const leg of r.route.legs) if (leg.kind === 'walk') for (let i = 1; i < leg.points.length; i++) {
    const a = leg.points[i-1], b = leg.points[i], length = Math.hypot(b[0]-a[0], b[1]-a[1]), n = Math.max(1, Math.ceil(length / .01));
    for (let j = 0; j <= n; j++) assert.ok(boxDistance([a[0]+(b[0]-a[0])*j/n, a[1]+(b[1]-a[1])*j/n], solid) >= .28 + length/n/2 - 1e-6, 'route clears the real rail including both ends');
  }
}

test('YAW rail raster: only straight landing geometry is qualified, curved and mixed links stay conservative', () => {
  const straight = { kind: 'stairs', path: [[0,-.35],[0,0],[0,2],[0,2.35]] as Vec2[] };
  const spiral = { kind: 'stairs', path: Array.from({ length: 19 }, (_, i) => [Math.sin(i/3),Math.cos(i/3)] as Vec2) };
  assert.equal(hasStraightLandings([straight]), true);
  assert.equal(hasStraightLandings([spiral]), false);
  assert.equal(hasStraightLandings([straight,spiral]), false);
  assert.equal(hasStraightLandings([{ ...straight,kind: 'ramp' }]), false);
  assert.equal(hasStraightLandings([]), false);
  assert.equal(hasStraightLandings(undefined), false);
});

test('YAW rail raster: full-cell middle never shrinks solids and conservative ends remain', () => {
  const rail = { c: [0,0] as Vec2, half: [1.2,.03] as Vec2, yaw: 0 }, parts = railRaster(rail)!;
  assert.deepEqual(parts[0].obb.half, [1.2,.05]); assert.equal(parts[0].raster, 'centre');
  assert.equal(parts.length, 3); assert.equal(parts[1].raster, undefined); assert.equal(parts[2].raster, undefined);
  assert.equal(railRaster({ ...rail, half: [.03,.03] }), null);
  assert.equal(railRaster({ ...rail, half: [1.2,.1] }), null);
});

test('YAW rail raster: passable cells and paths clear the real solid at 240 size/yaw/offset poses', () => {
  for (const half of [[1.25,.03],[.12,.01],[.3,.049]] as Vec2[]) for (const yaw of [0, Math.PI/8, Math.PI/4, 3*Math.PI/8, Math.PI/2]) for (const dx of [0, .025, .05, .075]) for (const dz of [0, .025, .05, .075]) {
    const c = Math.cos(yaw), s = Math.sin(yaw), at = ([x,z]: Vec2): Vec2 => [dx+x*c-z*s, dz+x*s+z*c];
    const real: OBB2 = { c: [dx,dz], half, yaw };
    const scene: SpatialScene = { bounds: [-3,-3,3,3], levels: [{ id: 1, y: 3, label: 'upper' }], surfaces: [{ id: 'floor', level: 1, y: 3, obb: { c: [0,0], half: [3,3], yaw: 0 } }], obstacles: railRaster(real)!.map((part,i) => ({ id: 'rail'+i, ...part, y0: 3, y1: 4 })), links: [] };
    const grids = buildGrids(scene), g = grids.levels.get(1)!, physical = scene.obstacles[0].obb;
    const oldGrid = buildGrids({ ...scene, obstacles: [{id:'old-rail',obb:real,y0:3,y1:4}] }).levels.get(1)!;
    for (let i = 0; i < g.clearance.length; i++) assert.ok(g.clearance[i] >= oldGrid.clearance[i], 'no previous clearance lost');
    for (let i = 0; i < g.clearance.length; i++) if (g.clearance[i] >= .34) assert.ok(boxDistance(centreOf(g,i), physical) >= .28-1e-6, `pose ${yaw}/${dx}/${dz}: body clearance ${boxDistance(centreOf(g,i), real)} at ${centreOf(g,i)} grid ${g.clearance[i]}`);
    safeRoute(findRoute(grids,scene,HUMAN_PROFILE,{level:1,p:at([0,-.7])},{level:1,p:at([0,.7])}),physical);
  }
});

function landing(yaw: number, fine: boolean) {
  const c = Math.cos(yaw), s = Math.sin(yaw), world = ([x, z]: Vec2): Vec2 => [249.907 + x * c + z * s, -49.157 - x * s + z * c];
  const box = (p: Vec2, half: Vec2) => ({ c: world(p), half, yaw: -yaw });
  const rectangles = [[-3.339, -1.739, 3.339, -.819], [-3.339, -2.709, -.409, -1.739], [2.882, -2.709, 3.339, -1.739], [-3.339, -.699, 3.339, 2.709], [-.45, -1.0585, .45, -.4585]];
  const surfaces: SpatialScene['surfaces'] = rectangles.map(([x0, z0, x1, z1], i) => ({ id: `floor${i}`, level: 1, y: 2.9, obb: box([(x0+x1)/2, (z0+z1)/2], [(x1-x0)/2, (z1-z0)/2]) }));
  const scene: SpatialScene = { bounds: [243.907, -55.157, 255.907, -43.157], levels: [{ id: 1, y: 2.9, label: 'upper' }], surfaces, links: [], obstacles: [
    ...[-1, 1].map((d) => ({ id: `wall${d}`, y0: 2.8, y1: 5.6, obb: box([d * 1.94925, -.7585], [1.49925, .06]), raster: 'centre' as const })),
    { id: 'rail', y0: 2.9, y1: 3.9, obb: box([.7365, -1.7585], [1.125, .03]) },
  ] };
  if (fine) scene.obstacles = scene.obstacles.flatMap((o) => o.id === 'rail' ? railRaster(o.obb)!.map((piece,i) => ({ ...o, ...piece, id: 'rail'+i })) : [o]);
  return { scene, start: { level: 1, p: world([2.562, -1.274]) }, goal: { level: 1, p: world([0, 0]) } };
}

test('YAW rail raster: original hh12 landing is disconnected and padded-middle capped rail connects the actual pose with safe ends', () => {
  const old = landing(.869, false);
  assert.equal(findRoute(buildGrids(old.scene), old.scene, HUMAN_PROFILE, old.start, old.goal).ok, false);
  for (const yaw of [0,.4,.785,.869,Math.PI/2]) {
    const { scene,start,goal } = landing(yaw,true), physical = scene.obstacles.find(o => o.id === 'rail0')!.obb;
    const route = findRoute(buildGrids(scene), scene, HUMAN_PROFILE, start, goal);
    assert.equal(route.ok, yaw !== .785, `yaw ${yaw}: exact45 remains blocked with safe caps`);
    if (yaw === .785) { const before = landing(yaw,false); assert.equal(findRoute(buildGrids(before.scene),before.scene,HUMAN_PROFILE,before.start,before.goal).ok,false); }
    if (route.ok) safeRoute(route, physical);
  }
});
