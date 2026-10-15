import assert from 'node:assert/strict';
import test from 'node:test';
import { CATEGORIES, canonicalPolygon, compareContent, compileTemplate, inventoryCandidate, inventoryOldWorld, loadRepoComparison } from './content.mjs';

const square = [[-5, -5], [5, -5], [5, 5], [-5, 5]];
const scene = { bounds: [-5, -5, 5, 5], levels: [{ id: 0, y: 0 }], surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [5, 5], yaw: 0 } }], links: [] };
const full = (rows = {}) => ({ source: { kind: 'test' }, categories: Object.fromEntries(CATEGORIES.map((c) => [c, { status: 'KNOWN', records: rows[c] ?? [], limitations: [] }])) });

test('polygon comparison preserves coordinates and ignores only winding/start/closing vertex', () => {
  assert.deepEqual(canonicalPolygon(square), canonicalPolygon([[5, 5], [5, -5], [-5, -5], [-5, 5], [5, 5]]));
  assert.notDeepEqual(canonicalPolygon(square), canonicalPolygon([[5.1, 5], [5, -5], [-5, -5], [-5, 5]]));
});

test('only complete, measured, equal inventories can report IDENTICAL', () => {
  assert.equal(compareContent(full(), full()).status, 'IDENTICAL');
  const incomplete = full(); incomplete.categories.hills.status = 'UNKNOWN';
  const d = compareContent(incomplete, full());
  assert.equal(d.status, 'UNKNOWN');
  assert.equal(d.categories.hills.status, 'UNKNOWN');
});

test('exact IDs and exact coordinates detect moved/removed/added buildings', () => {
  const a = full({ buildings: [{ id: 'kitchen', name: 'Kitchen', position: [0, 0, 0] }, { id: 'bunkhouse', name: 'Bunkhouse' }] });
  const b = full({ buildings: [{ id: 'kitchen', name: 'Kitchen', position: [0.001, 0, 0] }, { id: 'mimos', name: 'Mimos' }] });
  const d = compareContent(a, b);
  assert.equal(d.status, 'NOT_IDENTICAL');
  assert.equal(d.categories.buildings.counts.FAIL, 3);
  assert.equal(d.categories.buildings.checks.find((c) => c.path === 'buildings.kitchen.position[0]').delta, 0.001);
  assert.equal(compareContent(full({ terrain: [{ id: '0,0', height: 0 }] }), full({ terrain: [{ id: '0,0', height: 1e-8 }] })).status, 'NOT_IDENTICAL');
});

test('missing data and duplicate semantic IDs are UNKNOWN, never empty passes', () => {
  const partial = full(); partial.categories.buildings.status = 'UNKNOWN';
  assert.equal(compareContent(partial, full({ buildings: [{ id: 'mimos' }] })).categories.buildings.status, 'UNKNOWN');
  const duplicates = full({ places: [{ id: 'x' }, { id: 'x' }] });
  assert.equal(compareContent(duplicates, full({ places: [{ id: 'x' }] })).categories.places.status, 'UNKNOWN');
  assert.equal(compareContent({ categories: {} }, full()).status, 'UNKNOWN');
});

test('legacy ground samples do not fabricate support outside exported surfaces or on an upper floor', () => {
  const s = { ...scene, surfaces: [...scene.surfaces, { id: 'upstairs', level: 11, y: 9, obb: { c: [0, 0], half: [1, 1], yaw: 0 } }] };
  const inv = inventoryOldWorld({ scene: s, world: { regions: {} }, buildings: [], paths: [], hills: [] }, { samples: [[0, 0], [6, 0]] });
  assert.equal(inv.categories.terrain.records[0].height, 0);
  assert.match(inv.categories.terrain.records[1].height.unknown, /no exported old ground/);
  assert.equal(inv.categories.skyLighting.records.length, 24);
  assert.equal(inv.categories.skyLighting.status, 'PARTIAL');
  assert.equal(compareContent(inv, inv).status, 'UNKNOWN');
});

test('physical terrain differences report comparable sample count and deltas', () => {
  const d = compareContent(full({ terrain: [{ id: '0,0', height: 0 }, { id: '1,0', height: { unknown: 'not measured' } }] }), full({ terrain: [{ id: '0,0', height: 7 }, { id: '1,0', height: 11 }] }));
  assert.equal(d.status, 'NOT_IDENTICAL');
  assert.deepEqual(d.categories.terrain.sampleMetrics, { requested: 2, comparable: 1, maxAbsHeightDelta: 7, rmsHeightDelta: 7 });
});

test('hourly measurements require all 24 unique hours; astronomical samples alone are incomplete', () => {
  assert.throws(() => inventoryOldWorld({ skyHourly: [{ hour: 0 }] }, { samples: [[0, 0]] }), /each integer hour/);
  const skyHourly = Array.from({ length: 24 }, (_, hour) => ({ hour, rendered: { exposure: 1, sunIntensity: hour } }));
  const inv = inventoryOldWorld({ scene, world: { regions: {} }, buildings: [], paths: [], hills: [], skyHourly }, { samples: [[0, 0]] });
  assert.equal(inv.categories.skyLighting.status, 'KNOWN');
  assert.equal(compareContent(inv, inv).status, 'IDENTICAL');
  const unmeasured = inventoryOldWorld({ skyHourly: Array.from({ length: 24 }, (_, hour) => ({ hour })) }, { samples: [[0, 0]] });
  assert.equal(unmeasured.categories.skyLighting.status, 'PARTIAL');
});

test('engine navigation links cannot be mistaken for a complete painted path inventory', () => {
  const input = { world: { regions: {} }, scene: { ...scene, links: [{ id: 'stairs', kind: 'stairs', path: [[0, 0, 0], [0, 3, 2]], width: 1 }] }, buildings: [] };
  const inv = inventoryOldWorld(input, { samples: [[0, 0]] });
  assert.equal(inv.categories.paths.status, 'UNKNOWN');
  assert.equal(inv.categories.paths.records.length, 0);
  assert.equal(inv.navigationLinks.records.length, 1);
  assert.equal(compareContent(inv, full({ paths: [{ id: 'walk', kind: 'authored-path', path: [[0, 0], [3, 0]], width: 1 }] })).categories.paths.status, 'UNKNOWN');
});

test('invalid/empty sample sets and misleading tolerance are refused', () => {
  for (const samples of [[], [[NaN, 0]], [[0, 0, 0]]]) assert.throws(() => inventoryOldWorld({}, { samples }), /samples/);
  assert.throws(() => compareContent(full(), full(), { numberTolerance: -1 }), /numberTolerance/);
});

test('template compilation uses atomic admission; a refused batch is retained as incomplete evidence', async () => {
  const template = { schema: 'genesis/1', constants: { ground: 'land', extent: 80 }, batches: [{ group: 'bad', ops: [{ op: 'place', def: 'no-such-def@1', name: 'imaginary', p: [0, 0] }] }, { group: 'must-not-run', ops: [{ op: 'place', def: 'core/flag@1', name: 'later', p: [0, 0] }] }] };
  const { model, compilation } = await compileTemplate(template);
  assert.equal(compilation.accepted, false);
  assert.equal(compilation.attempted, 1);
  assert.equal(model.entities.size, 0);
  assert.ok(compilation.results[0].failures.length > 0);
  const inv = inventoryCandidate(model, { compilation, template, samples: [[0, 0]] });
  assert.equal(inv.categories.buildings.status, 'UNKNOWN');
  assert.equal(compareContent(full({ buildings: [{ id: 'kitchen' }] }), inv).categories.buildings.status, 'UNKNOWN');
});

test('candidate inventory reads baked rooms/ground, not just a building visual box', async () => {
  const template = { schema: 'genesis/1', constants: { ground: 'land', extent: 80 }, places: [{ id: 'hall', name: 'Hall', kind: 'room', entity: 'house/room-1' }], batches: [{ ops: [{ op: 'place', def: 'core/cottage@1', name: 'house', p: [0, 0], params: { w: 8, d: 6 } }] }] };
  const { model, compilation } = await compileTemplate(template);
  assert.equal(compilation.accepted, true, JSON.stringify(compilation));
  const inv = inventoryCandidate(model, { compilation, template, samples: [[0, 0]] });
  assert.equal(inv.categories.buildings.records.length, 1);
  assert.ok(inv.categories.interiors.records.length > 0);
  assert.ok(inv.categories.interiors.records.every((r) => Array.isArray(r.polygon) && typeof r.floorY === 'number'));
  assert.equal(inv.categories.terrain.records[0].height, model.terrain.sample(0, 0));
});

test('Mars mapped fixture keeps backdrop inventory incomplete and accepts actual hourly renderer samples', async () => {
  const sky = Array.from({ length: 24 }, (_, hour) => ({ hour, background: '#000000', lights: [{ kind: 'sun', intensity: hour }] }));
  const result = await loadRepoComparison('mars', { oldMarsMap: true, samples: [[0, 0], [70, -100]], oldSkyHourly: sky, candidateSkyHourly: sky });
  assert.equal(result.old.source.map, 'mars-2026-map/1');
  assert.equal(result.old.categories.buildings.status, 'PARTIAL');
  assert.equal(result.old.categories.interiors.status, 'PARTIAL');
  assert.equal(result.old.categories.places.records.length, 21);
  assert.equal(result.old.categories.terrain.records[1].height, 0);
  assert.equal(result.diff.categories.skyLighting.status, 'PASS');
  assert.equal(result.old.categories.hills.status, 'UNKNOWN');
  assert.equal(result.candidate.categories.places.status, 'UNKNOWN');
  assert.equal(result.candidate.namedTargets.length > 0, true);
  assert.equal(result.diff.status, 'NOT_IDENTICAL');
});
