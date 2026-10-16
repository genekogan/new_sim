// E2 #1: on paged-navigation worlds a polygon read used the nav window round the polygon's centre, so the far parts
// of a place over ~100 m read clearance 0: strolls and region checks never reached its far ends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { marsFactory, GREEN_FIELD_WORLD } = await import('./engine.ts');
const { groundFact } = await import('./ground-bridge.ts');
const { emptyGround } = await import('../../ground/src/index.ts');

const factory = await marsFactory(GREEN_FIELD_WORLD);
type Eng = ReturnType<typeof factory.create> & { installGroundV1(f: unknown): unknown; clearSpotsV1(p: [number, number][], n: number): [number, number][]; previewRegionV1?: unknown };
function wide(paged: boolean): Eng {
  const g = emptyGround(2000); g.extent = [-200, -1000, 1800, 1000];
  const e = factory.create(factory.genesis('far-place')) as never as Eng;
  e.installGroundV1(groundFact(g, 1, { paged }));
  e.spawnHuman({ id: 'h_ana', label: 'ana', soul: 's_ana' });
  return e;
}
const place: [number, number][] = [[300, -40], [460, -40], [460, 40], [300, 40]];   // a 160 x 80 m field 300 m east

test('paged: stroll spots cover the whole of a 160 m place, far ends included', () => {
  const spots = wide(true).clearSpotsV1(place, 24);
  assert.equal(spots.length, 24, `spots ${spots.length}`);
  assert.ok(spots.some(([x]) => x < 320) && spots.some(([x]) => x > 440), `spread ${JSON.stringify(spots.map(([x]) => x))}`);
});
