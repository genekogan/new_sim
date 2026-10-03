// Preserve source-era assertions against byte-exact canonical JSON from git7648dbf.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadCampusYear, type CampusYearFile } from '../campus/history.ts';
import { hashOf } from '../core/hash.ts';
import { buildGrids, centreOf } from '../spatial/grid.ts';
import type { SpatialScene } from '../spatial/types.ts';
const SHA256: Record<number, string> = {
  "2021": "1cfdea013b66f6fb1e69d9b1f8b4da7b1f1ace1d491ddcf53f88d468db2c3f92",
  "2022": "e21a398fede6e7c02e75374eb4a0003f49c743eba367c7cda2d2cda8f6d0e95e",
  "2023": "3d5cd26c4d38b5c701f8b35717a33027358a4307c1679eaabd948ceb8c0a3a8d",
  "2024": "c595c89162caa1d5e552e19ff1ca2670266172294c4e64b2adace09c0b2bb462"
};
const legacy = (year: number) => {
  const bytes = readFileSync(new URL(`./fixtures/campus-history-pre-review-7648dbf/campus-${year}.json`, import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), SHA256[year], `${year} frozen git source bytes`);
  const file = JSON.parse(bytes.toString()) as CampusYearFile, { contentHash, ...rest } = file;
  assert.equal(hashOf(rest), contentHash); return loadCampusYear(year, file).base;
};
test('source-era2021 retains all-provisional provenance and greater-than40percent blocked deck footprint', () => {
  const base = legacy(2021), grid = buildGrids(base as unknown as SpatialScene, 0.25).levels.get(0)!;
  assert.ok(base.obstacles.every(o => o.provenance.confidence === 'provisional'));
  const polygon = base.regions.find(r => r.id === 'chiba')!.polygon;
  let count = 0, blocked = 0;
  for (let cell = 0; cell < grid.free.length; cell++) {
    const p = centreOf(grid, cell); let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++)
      if ((polygon[i][1] > p[1]) !== (polygon[j][1] > p[1]) && p[0] < (polygon[j][0] - polygon[i][0]) * (p[1] - polygon[i][1]) / (polygon[j][1] - polygon[i][1]) + polygon[i][0]) inside = !inside;
    if (inside) { count++; if (!grid.free[cell]) blocked++; }
  }
  assert.ok(blocked / count > 0.4, `source-era2021 blocked fraction ${blocked / count}`);
});
test('source-era2022 retains rv9 and the original removed-rv structural guard', () => {
  const base = legacy(2022), components = new Set(base.obstacles.map(o => o.component));
  for (const prefix of ['chiba-rack-upright-', 'east-house-12-foot-orange-beam-', 'kitchen-plywood-deck-sheet-', 'west-house-plywood-wall-', 'rv-9-trailer-shell-']) assert.ok([...components].some(c => c.startsWith(prefix)), prefix);
  for (const prefix of ['rv-10-', 'rv-11-', 'rv-12-', 'west-house-table-']) assert.ok(![...components].some(c => c.startsWith(prefix)), prefix);
  assert.equal(base.meta.northAzimuthOffset, -101);
});
for (const year of [2023, 2024]) test(`source-era${year} preserves full AABB plus0.5metre trailer-independent grid`, () => {
  const base = legacy(year), polygon = base.regions.find(r => r.id === 'chiba')!.polygon;
  const xs = polygon.map(p => p[0]), zs = polygon.map(p => p[1]);
  const box = [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
  const full = buildGrids(base as unknown as SpatialScene, 0.25).levels.get(0)!;
  const bare = buildGrids({ ...base, obstacles: base.obstacles.filter(o => !/^rv-\d+$/.test(o.assembly)) } as unknown as SpatialScene, 0.25).levels.get(0)!;
  assert.equal(full.nx, bare.nx); let inside = 0;
  for (let cell = 0; cell < full.free.length; cell++) {
    const [x, z] = centreOf(full, cell);
    if (x < box[0] - 0.5 || x > box[2] + 0.5 || z < box[1] - 0.5 || z > box[3] + 0.5) continue;
    inside++; assert.equal(full.free[cell], bare.free[cell], `${year} source-era AABB cell(${x},${z})`);
  }
  assert.ok(inside > 1000);
});
