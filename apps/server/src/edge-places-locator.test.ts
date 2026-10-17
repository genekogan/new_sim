// PlaceIndex.locator (lane L1): the innermost place for many points, from a grid of outline boxes built once, gives
// exactly containing(x, z, level)[0] — synthetic edge cases, then every Eden 2026 place, and the activity spots derived
// with it are the spots derived without it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {PlaceIndex, type Place} from './edge/ledger/places.ts';
import {bootEden} from '../test/eden-capabilities-timing.ts';

type V2 = [number, number];
const box = (x0: number, z0: number, x1: number, z1: number): V2[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const place = (id: string, polygon: V2[], extra: Partial<Place> = {}): Place =>
  ({id, name: id, kind: 'room', parent: 'world', polygon, level: 0, enclosed: true, capacity: null, starting: false, ...extra} as Place);
const same = (ix: PlaceIndex, pts: [number, number, number][]) => {
  const find = ix.locator();
  let off = 0;
  for (const [x, z, l] of pts) if (find(x, z, l)?.id !== ix.containing(x, z, l)[0]?.id) off++;
  return off;
};

test('locator == containing()[0]: nesting, area ties in index order, levels, roots, carriers, box edges, huge and odd outlines', () => {
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const places: Place[] = [
    place('world', box(-500, -500, 500, 500), {parent: null, kind: 'outdoor'}),
    place('second-root', box(-1, -1, 1, 1), {parent: null}),
    place('carrier', box(-5, -5, 5, 5), {carrier: {entity: 'boat'}} as Partial<Place>),
    place('huge', box(-1e6, -1e6, 1e6, 1e6)),
    place('tie-a', box(10, 10, 20, 20)), place('tie-b', box(10, 10, 20, 20)), place('inner', box(12, 12, 14, 14)),
    place('upstairs', box(12, 12, 14, 14), {level: 1}),
    place('tri', [[30, 30], [40, 30], [35, 41]]),
    place('thin', box(-3.3, 7.77, -3.3 + 1e-9, 9)),
  ];
  for (let i = 0; i < 300; i++) {   // random rectangles and triangles, some nested, some on level 1
    const x = rnd() * 200 - 100, z = rnd() * 200 - 100, w = 0.5 + rnd() * 30, d = 0.5 + rnd() * 30;
    places.push(place(`r${i}`, i % 3 ? box(x, z, x + w, z + d) : [[x, z], [x + w, z + d / 3], [x + w / 2, z + d]], {level: i % 5 === 0 ? 1 : 0}));
  }
  const ix = new PlaceIndex({contract: 'place-data/1', world: 't', places} as never);
  const pts: [number, number, number][] = [];
  for (const p of places) for (let k = 0; k < p.polygon.length; k++) {
    const [ax, az] = p.polygon[k], [bx, bz] = p.polygon[(k + 1) % p.polygon.length];
    for (const l of [0, 1]) for (const e of [0, 1e-9, -1e-9, 1e-7]) pts.push([ax + e, az, l], [ax, az + e, l], [(ax + bx) / 2 + e, (az + bz) / 2 - e, l]);
  }
  for (let i = 0; i < 20000; i++) pts.push([rnd() * 240 - 120, rnd() * 240 - 120, rnd() < 0.2 ? 1 : 0]);
  pts.push([NaN, 0, 0], [0, Infinity, 0], [15, 15, 2], [15, 15, NaN], [8 * 1.5, 8 * 1.5, 0], [-8, -8, 0], [0, 0, -0]);
  assert.equal(same(ix, pts), 0);
  assert.equal(ix.locator()(15, 15, 0)?.id, 'tie-a', 'equal areas: the earlier in the index');
  assert.equal(ix.locator()(13, 13, 0)?.id, 'inner');
  assert.equal(ix.locator()(13, 13, 1)?.id, 'upstairs');
  assert.equal(ix.locator()(300, 300, 0)?.id, 'huge');
  assert.equal(ix.locator()(0, 0, 3)?.id, 'second-root', 'nothing on that level: the smallest root (containing sorts roots by area too)');
  // a place whose outline is not plain numbers: containing() itself answers
  const odd = new PlaceIndex({contract: 'place-data/1', world: 't', places: [...places, place('odd', [[0, 0], [NaN, 1], [1, 1]])]} as never);
  assert.equal(same(odd, pts.slice(0, 3000)), 0);
});

const TEMPLATE = new URL('../../../worlds/templates/eden-2026.json', import.meta.url);
test('Eden 2026: locator == containing()[0] round every place; activity spots and the walk listing the same with and without the locator / read pass', {skip: !existsSync(TEMPLATE) && 'no Eden 2026 template'}, async () => {
  const w = await bootEden();
  try {
    const ix = w.edge.places, all = [...ix.byId.values()];
    assert.ok(all.length > 500, `places (${all.length})`);
    const pts: [number, number, number][] = [];
    for (const p of all) for (let k = 0; k < p.polygon.length; k++) {
      const [ax, az] = p.polygon[k], [bx, bz] = p.polygon[(k + 1) % p.polygon.length];
      for (const l of [p.level ?? 0, 0, 1]) pts.push([ax, az, l], [(ax + bx) / 2, (az + bz) / 2, l], [ax + 1e-9, az - 1e-9, l], [(ax * 3 + bx) / 4 + 0.05, (az * 3 + bz) / 4 - 0.05, l]);
    }
    assert.equal(same(ix, pts), 0);
    // L1 readPassV1: the walk listing with one planner sync is the listing with a sync per read
    const eng = w.host.engine as unknown as {readPassV1?: unknown};
    assert.equal(typeof eng.readPassV1, 'function');
    const withPass = JSON.stringify(w.edge.capabilities(w.soul)), keepPass = eng.readPassV1;
    try { eng.readPassV1 = undefined; assert.equal(JSON.stringify(w.edge.capabilities(w.soul)), withPass); }
    finally { eng.readPassV1 = keepPass; }
    const spots = (w.bridge as unknown as {activitySpots: {data(): unknown; cache: unknown; h: {placeLocator?: unknown}}}).activitySpots;
    const fast = JSON.stringify(spots.data());
    const h = spots.h, keep = h.placeLocator;
    try { spots.cache = null; h.placeLocator = undefined; assert.equal(JSON.stringify(spots.data()), fast); }
    finally { h.placeLocator = keep; }
  } finally { w.close(); }
});
