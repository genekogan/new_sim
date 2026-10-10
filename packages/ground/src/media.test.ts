import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HUMANOID_MEDIA, MEDIUM, Terrain, emptyGround, groundRecipeHash, groundSchema, mediaTile, mediumOf, type Ground } from './index.ts';

function world(): Ground {
  const g = emptyGround(512);
  g.landforms.push({ id: 'knoll', kind: 'bump', c: [40, 0], r: 30, h: 6, peak: 1 });
  g.landforms.push({ id: 'cliff', kind: 'ridge', path: [[-10, 60], [30, 60]], w: 3, h: 6, peak: 1 });
  g.landforms.push({ id: 'pond', kind: 'carve', area: [[-40, -10], [-30, -10], [-30, 0], [-40, 0]], bed: -0.2, edge: 1 });
  g.landforms.push({ id: 'lake', kind: 'carve', area: [[-100, -40], [-60, -40], [-60, 0], [-100, 0]], bed: -3, edge: 6 });
  g.waters.push({ id: 'pond', area: [[-40, -10], [-30, -10], [-30, 0], [-40, 0]], level: 0 });
  g.waters.push({ id: 'lake', area: [[-100, -40], [-60, -40], [-60, 0], [-100, 0]], level: 0 });
  return groundSchema.parse(g);
}

test('recipe hash is canonical: key order and derived caches do not change it; any edit does', () => {
  const g = world(), h = groundRecipeHash(g);
  assert.match(h, /^[0-9a-f]{16}$/);
  const shuffled = JSON.parse(JSON.stringify({ waters: g.waters, landforms: g.landforms, extent: g.extent, base: g.base, schema: g.schema }));
  assert.equal(groundRecipeHash(shuffled), h);
  assert.equal(groundRecipeHash({ ...g, _ordered: [] } as Ground), h);
  const moved = structuredClone(g); moved.landforms[0] = { ...moved.landforms[0], h: 6.01 } as never;
  assert.notEqual(groundRecipeHash(moved), h);
});

test('media: plain walks, knoll flank walks, cliff is steep, pond wades, lake swims, beyond the extent is outside', () => {
  const t = new Terrain(world());
  assert.equal(mediumOf(t, 0, -100), MEDIUM.walk);
  assert.equal(mediumOf(t, 40 - 15, 0), MEDIUM.walk, 'knoll flank under 30°');
  assert.equal(mediumOf(t, 10, 59), MEDIUM.steep, 'ridge flank');
  assert.equal(mediumOf(t, -35, -5), MEDIUM.wade, 'pond 0.2 m deep');
  assert.equal(mediumOf(t, -80, -20), MEDIUM.swim, 'lake 3 m deep');
  assert.equal(mediumOf(t, 300, 0), MEDIUM.outside);
  // a stricter body refuses the knoll flank
  assert.equal(mediumOf(t, 40 - 15, 0, { ...HUMANOID_MEDIA, maxSlope: 0.05 }), MEDIUM.steep);
});

test('media tile agrees with point sampling at cell centres', () => {
  const t = new Terrain(world());
  const m = mediaTile(t, -2, -1); // x -128..-64, z -64..0 (the lake's west half)
  for (const [i, j] of [[0, 0], [40, 40], [63, 63], [20, 50]]) assert.equal(m[j * 64 + i], mediumOf(t, -128 + i + 0.5, -64 + j + 0.5));
  assert.ok(m.includes(MEDIUM.swim));
});

test('TileSampler agrees with Terrain to the bit', async () => {
  const { TileSampler } = await import('./index.ts');
  const t = new Terrain(world()), s = new TileSampler(t);
  for (let k = 0; k < 2000; k++) { const x = -250 + ((k * 7919) % 500) + (k % 13) / 13, z = -250 + ((k * 104729) % 500) + (k % 7) / 7; assert.equal(s.sample(x, z), t.sample(x, z)); assert.equal(s.slope(x, z), t.slope(x, z)); }
});
