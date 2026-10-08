// Pure helpers of the live view. Run: node --test apps/web/test/world-geometry.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { agoText, buildingUrl, chunkAt, clockText, mergeWindow, MAX_PAST_CHUNKS, parseSceneInfo, placeOf, plainWords, rewindWindow, shiftIso, validChunks, WorldGeometry, type Chunk } from '../src/WorldGeometry.ts';

const take = (startTick: number, ticks = 20) => ({ schema: 'mars-take/4', id: `t${startTick}`, baselineStateHash: 'fixture-start', finalStateHash: 'fixture-end', rulesVersion: 'fixture/1', keyframeEvery: 20, startTick, ticks, dt: 0.05, tracks: {}, changes: [], events: [], finalState: { entities: {} } });
const chunk = (from: number): Chunk => ({ fromTick: from, toTick: from + 20, take: take(from) as unknown as Chunk['take'] });

test('validChunks drops malformed chunks, dedupes and sorts', () => {
  const got = validChunks([chunk(40), { fromTick: 0, toTick: 20, take: { nope: 1 } }, chunk(20), chunk(40), null, { fromTick: 60, toTick: 50, take: take(60) }]);
  assert.deepEqual(got.map((c) => c.fromTick), [20, 40]);
  assert.deepEqual(validChunks('x'), []);
});

test('chunkAt finds the covering chunk, else the one before a gap, else the first', () => {
  const list = [chunk(0), chunk(20), chunk(80)];
  assert.equal(chunkAt(list, 25)?.chunk.fromTick, 20);
  assert.equal(chunkAt(list, 25)?.exact, true);
  assert.deepEqual([chunkAt(list, 50)?.chunk.fromTick, chunkAt(list, 50)?.exact], [20, false]);
  assert.equal(chunkAt(list, -5)?.chunk.fromTick, 0);
  assert.equal(chunkAt(list, 500)?.chunk.fromTick, 80);
  assert.equal(chunkAt([], 3), null);
});

test('mergeWindow keeps at most 120 chunks around the moment watched', () => {
  const a = Array.from({ length: 100 }, (_, i) => chunk(i * 20));
  const b = Array.from({ length: 100 }, (_, i) => chunk((i + 90) * 20)); // overlaps 10
  const merged = mergeWindow(a, b, 150 * 20);
  assert.equal(merged.length, MAX_PAST_CHUNKS);
  assert.ok(merged[0].fromTick <= 140 * 20 && merged.at(-1)!.toTick >= 150 * 20, 'the moment and some history before it stay');
  assert.equal(new Set(merged.map((c) => c.fromTick)).size, merged.length);
  // a moment near the start keeps the start
  assert.equal(mergeWindow(a, b, 0)[0].fromTick, 0);
});

test('rewindWindow asks for a little before and most after, never below zero', () => {
  assert.deepEqual(rewindWindow(1000, 20), { from: 800, to: 3200 });
  assert.equal(rewindWindow(50, 20).from, 0);
  const w = rewindWindow(10_000, 20);
  assert.ok((w.to - w.from) / 20 <= MAX_PAST_CHUNKS, 'one window fits the buffer');
});

test('parseSceneInfo keeps valid parts and drops the rest', () => {
  const ok = parseSceneInfo({ scene: { bounds: [-22, -22, 22, 22], obstacles: [{ id: 'w' }] }, buildings: [{ file: 'ceramic-tower', p: [1, 0, 2], yaw: 0.5 }, { file: 3, p: [0, 0, 0] }], kin: [{ model: 'chebel', p: [0, 2, 0] }, { model: 'x' }] });
  assert.deepEqual(ok.scene?.bounds, [-22, -22, 22, 22]);
  assert.deepEqual(ok.scene?.links, []);
  assert.equal(ok.buildings.length, 1);
  assert.equal(ok.kin.length, 1);
  assert.deepEqual(parseSceneInfo(null), { scene: null, buildings: [], kin: [], clock: null, ground: undefined });
  assert.equal(parseSceneInfo({ scene: { bounds: [1, 2] } }).scene, null);
});

test('buildingUrl accepts plain names only', () => {
  assert.equal(buildingUrl('ceramic-tower'), '/world-assets/littlemartians/buildings/ceramic-tower.glb');
  assert.equal(buildingUrl('minaret-temple.glb'), '/world-assets/littlemartians/buildings/minaret-temple.glb');
  for (const bad of ['../secret', 'a/b', 'https://x.example/y', '', '%2e%2e']) assert.equal(buildingUrl(bad), null, bad);
});

test('world clock text and shifts', () => {
  assert.equal(shiftIso('2026-03-15T00:00:30', -60), '2026-03-14T23:59:30');
  assert.equal(shiftIso('2026-03-15T16:00', 90), '2026-03-15T16:01:30');
  assert.equal(shiftIso('garbage', 10), 'garbage');
  assert.equal(clockText('2026-03-15T16:05:09'), '16:05');
  assert.equal(clockText(null), '');
  assert.equal(agoText(42), '42 s ago');
  assert.equal(agoText(125), '2 min 05 s ago');
  assert.equal(agoText(3720), '1 h 2 min ago');
  assert.equal(plainWords('mars:walk_to'), 'walk to');
  assert.equal(plainWords('dining-bench'), 'dining bench');
});

test('placeOf picks the smallest named region containing the point', () => {
  const regions = {
    yard: { label: 'Yard', kind: 'walkable', polygon: [[-20, -20], [20, -20], [20, 20], [-20, 20]] as [number, number][] },
    kitchen: { label: 'Kitchen', kind: 'place', polygon: [[-20, -20], [-8, -20], [-8, -8], [-20, -8]] as [number, number][] },
  };
  assert.equal(placeOf([-14, 0, -14], regions), 'Kitchen');
  assert.equal(placeOf([5, 0, 5], regions), 'Yard');
  assert.equal(placeOf([50, 0, 50], regions), null);
});

test('WorldGeometry draws scene walls; a loaded building hides only the walls it stands on', async () => {
  const wall = (id: string, x: number, z: number) => ({ id, kind: 'wall' as const, obb: { c: [x, z] as [number, number], half: [2, 0.1] as [number, number], yaw: 0 }, y0: 0, y1: 2.6 });
  const g = new WorldGeometry({ bounds: [-22, -22, 22, 22], levels: [], surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [22, 22], yaw: 0 } }], obstacles: [wall('a', 0, 0), wall('b', 15, 15), { ...wall('pile', 5, 5), kind: 'fixture' as const }], links: [] });
  const prisms = () => g.group.children.filter((o) => o.name.startsWith('scene:'));
  assert.deepEqual(prisms().map((o) => o.name), ['scene:a', 'scene:b']);
  const building = new THREE.Mesh(new THREE.BoxGeometry(6, 5, 6), new THREE.MeshStandardMaterial());
  const loader = { loadAsync: async (url: string) => { if (url.includes('missing')) throw new Error('404'); return { scene: new THREE.Group().add(building) }; } };
  const failed = await g.addBuildings([{ file: 'ceramic-tower', p: [0, 0, 0] }, { file: 'missing', p: [15, 0, 15] }, { file: '../x', p: [0, 0, 0] }], loader as never);
  assert.deepEqual(failed.sort(), ['../x', 'missing']);
  assert.deepEqual(prisms().map((o) => o.visible), [false, true]);
  g.dispose();
});
