// Pure extraction core (engine/campus/geom.ts, extract.ts): footprint fitting
// on synthetic meshes, and determinism. Set CAMPUS_FULL=1 to also re-extract
// from the real GLB and compare with the committed contentHash (~6 s).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { hashOf } from '../core/hash.ts';
import { pointInObb } from '../core/math.ts';
import { clipTrianglesToBand, minAreaRect } from '../campus/geom.ts';
import { extractObstacles, GROUND_Y, type ComponentInput } from '../campus/extract.ts';

/** Axis-aligned box as 12 triangles (only the 8 corners matter for footprints). */
function boxTris(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[] {
  const c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
  const f = [[0, 1, 2], [0, 2, 3], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return f.flatMap((t) => t.flatMap((i) => c[i]));
}
const comp = (id: string, tris: number[], layer = 'Walls and screens', extra: Partial<ComponentInput> = {}): ComponentInput =>
  ({ id, kind: 'wood_component', layer, assembly: 'chiba', accuracy: 'CAD geometry; visual correspondence, dimensions not field verified', tris: Float64Array.from(tris), ...extra });

test('a 6 m post with vertices only at its ends is caught by band clipping', () => {
  const pts = clipTrianglesToBand(boxTris(0, GROUND_Y, 0, 0.09, 6, 0.09), GROUND_Y + 0.06, GROUND_Y + 2);
  assert.ok(pts.length > 0);
  const { rows } = extractObstacles([comp('post', boxTris(0, GROUND_Y, 0, 0.09, 6, 0.09), 'Rack steel')], {});
  assert.deepEqual(rows.map((r) => r[0]), ['post', 'post.up']);
});

test('a 10 m thin wall stays one prism (big triangles are not split into end posts)', () => {
  const { rows } = extractObstacles([comp('w', boxTris(0, GROUND_Y, 0, 10, 2.4, 0.05))], {});
  const low = rows.filter((r) => r[0] === 'w');
  assert.equal(low.length, 1);
  const [, kind, cx, cz, hx, hz] = low[0];
  assert.equal(kind, 'wall');
  assert.ok(Math.abs(cx - 5) < 1e-3 && Math.abs(cz - 0.025) < 1e-3);
  assert.ok(Math.abs(Math.max(hx, hz) - 5) < 1e-3 && Math.min(hx, hz) <= 0.03);
});

test('an L-shaped component is split so the inner corner stays open', () => {
  const tris = [...boxTris(0, GROUND_Y, 0, 8, 2.4, 0.1), ...boxTris(0, GROUND_Y, 0, 0.1, 2.4, 8)];
  const { rows } = extractObstacles([comp('L', tris)], {});
  const low = rows.filter((r) => !r[0].includes('.up'));
  assert.ok(low.length >= 2, `${low.length} pieces`);
  const obbs = low.map((r) => ({ c: [r[2], r[3]] as [number, number], half: [r[4], r[5]] as [number, number], yaw: r[6] }));
  assert.ok(!obbs.some((o) => pointInObb([4, 4], o)), 'inner corner (4, 4) must stay walkable');
  for (const p of [[7.9, 0.05], [0.05, 7.9], [0.05, 0.05]] as [number, number][]) assert.ok(obbs.some((o) => pointInObb(p, o, 1e-3)), `wall point ${p} covered`);
});

test('roofs of buildings emit interior blockers from the ground to their underside', () => {
  const { rows } = extractObstacles([comp('roof', boxTris(0, 2.8, 0, 6, 3, 4), 'Roofs and upper floors')], {});
  const inner = rows.find((r) => r[0] === 'interior:roof');
  assert.ok(inner, 'interior prism');
  assert.equal(inner![7], GROUND_Y);
  assert.equal(inner![8], 2.8);
  const site = extractObstacles([comp('shade', boxTris(0, 2.8, 0, 6, 3, 4), 'Roofs and upper floors', { assembly: 'site-context' })], {});
  assert.ok(!site.rows.some((r) => r[0].startsWith('interior:')), 'site-context shelters are not treated as building interiors');
});

test('vehicles and glazing are classified from source names/layers', () => {
  const { rows } = extractObstacles([
    comp('bus', boxTris(0, GROUND_Y, 0, 9, 3, 2.4), 'Fittings and furniture', { ancestors: ['2008 Thomas C2 school bus (with lift, short)'] }),
    comp('pane', boxTris(20, GROUND_Y, 0, 21, 2, 0.01), 'Glazing', { kind: 'transparent_panel' }),
  ], {});
  assert.equal(rows.find((r) => r[0] === 'bus')![1], 'vehicle');
  assert.equal(rows.find((r) => r[0] === 'pane')![1], 'glass');
});

test('extraction is deterministic and independent of input order', () => {
  const cs = [comp('a', boxTris(0, GROUND_Y, 0, 3, 2, 0.1)), comp('b', boxTris(5, GROUND_Y, 5, 5.1, 4, 9)), comp('c', boxTris(-3, 1, -3, 2, 1.2, 2), 'Fittings and furniture')];
  const h1 = hashOf(extractObstacles(cs, {}));
  const h2 = hashOf(extractObstacles([...cs].reverse(), {}));
  assert.equal(h1, h2);
  assert.equal(hashOf(minAreaRect([[0, 0], [2, 1], [1, 3], [-1, 2]])), hashOf(minAreaRect([[-1, 2], [1, 3], [0, 0], [2, 1]])));
});

test('full re-extraction reproduces the committed contentHash (CAMPUS_FULL=1)', { skip: process.env.CAMPUS_FULL !== '1' }, () => {
  const viewer = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const out = execFileSync('node', ['deploy/engine-scene.mjs', '--check'], { cwd: viewer, encoding: 'utf8' });
  assert.match(out, /deterministic/);
});
