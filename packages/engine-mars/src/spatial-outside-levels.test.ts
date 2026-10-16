// A point no paged window holds (a far thing offered to a Soul, a ring search, a recovery target) asks levelAt for the
// grid of its own small window. Upper levels used to be rebuilt (raster + EDT, ~0.1 s) on EVERY such call; they are
// now built once per navigation epoch, bounded, and equal to a fresh build cell for cell.
import test from 'node:test';
import assert from 'node:assert/strict';
import { marsFactory, GREEN_FIELD_WORLD, type MarsEngine } from './engine.ts';
import { groundFact } from './ground-bridge.ts';
import { emptyGround } from '../../ground/src/index.ts';
import { nextEntityPhysics, type WorldEditV1 } from './entity-physics.ts';
import { rectOf } from '../../../mars/viewer/engine/spatial/tiled.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
const factory = await marsFactory(GREEN_FIELD_WORLD);
const wall = (id: string, c: [number, number], half: [number, number]) => ({ id, obb: { c, half, yaw: 0 }, y0: 0, y1: 5.6, kind: 'fixture' as const, label: 'house wall' });
const floor = (id: string, c: [number, number]) => ({ id, level: 1, y: 2.85, obb: { c, half: [3.9, 2.9] as [number, number], yaw: 0 } });
function edit(seq: number, set: WorldEditV1['set'], prev?: ReturnType<typeof nextEntityPhysics>): WorldEditV1 {
  const draft: WorldEditV1 = { contract: 'world-edit/1', seq, hash: '', levels: [{ id: 1, y: 2.85, label: 'floor at 2.85 m' }], set, assets: {} };
  draft.hash = nextEntityPhysics(prev, draft).hash;
  return draft;
}
/** A paged-ground world with one human near the west edge and upper floors (level 1) far east of every window. */
function world(floors: [number, number][]) {
  const g = emptyGround(2000);
  g.extent = [-200, -1000, 1800, 1000];
  const e = factory.create(factory.genesis('outside-levels')) as unknown as MarsEngine & any;
  e.installGroundV1(groundFact(g, 1, { paged: true }));
  e.spawnHuman({ id: 'h_ana', label: 'Ana', soul: 's_ana' });
  const set: WorldEditV1['set'] = {};
  floors.forEach(([x, z], i) => { set[`e_far${i}`] = { surfaces: [floor(`far${i}:floor-1`, [x, z])], solids: [wall(`far${i}:n`, [x, z - 3], [4, 0.11])], links: [] } as never; });
  e.applyWorldEditV1(edit(1, set));
  e.step();
  const spatial = e.rt.services.spatial, ground = spatial.ground;
  return { e, spatial, ground, set };
}
const fresh = (w: ReturnType<typeof world>, id: number, p: [number, number]) => w.ground.gridsOver(rectOf([p]), w.spatial.pages.all).levels.get(id);
const same = (a: any, b: any) => {
  assert.ok(a && b, 'both grids exist');
  for (const k of ['nx', 'nz', 'ox', 'oz', 'level', 'y', 'cell']) assert.equal(a[k], b[k], k);
  assert.ok(Buffer.compare(Buffer.from(a.free.buffer), Buffer.from(b.free.buffer)) === 0, 'free cells equal');
  assert.ok(Buffer.compare(Buffer.from(a.clearance.buffer), Buffer.from(b.clearance.buffer)) === 0, 'clearance equal');
};

test('an upper level over a tile no window holds is built once per epoch and equals a fresh build', () => {
  const w = world([[1184, 32]]), at: [number, number] = [1184, 32];
  const E = w.spatial;
  const rect = rectOf([at]), pages = E.pages.rects;
  assert.ok(pages.every((r: number[]) => rect[0] < r[0] || rect[2] > r[2] || rect[1] < r[1] || rect[3] > r[3]), 'the far tile is outside every window');
  const before = w.ground.stats.levelBuilds;
  const a = E.levelAt(1, at);
  assert.ok(a, 'the far upper floor has a grid');
  assert.equal(w.ground.stats.levelBuilds, before + 1);
  for (let i = 0; i < 25; i++) assert.ok(E.levelAt(1, [1182 + (i % 5), 31 + (i % 3)]) === a, 'later asks for that tile return the same grid');
  assert.equal(w.ground.stats.levelBuilds, before + 1, 'no further build');
  same(a, fresh(w, 1, at));
  // level 0 over the same tile and a level that never reaches it answer exactly as the full set does
  same(E.levelAt(0, at), fresh(w, 0, at));
  assert.equal(E.levelAt(7, at), undefined);
  assert.equal(fresh(w, 7, at), undefined);
  assert.equal(E.levelAt(7, at), undefined);
});

test('a standing-point search on a far upper floor is answered without rebuilding the tile', () => {
  const w = world([[1184, 32]]), e = w.e;
  const first = e.standableNearV1([1184, 32], 1, undefined, 0.4, 8), builds = w.ground.stats.levelBuilds;
  assert.equal(builds, 1, 'the first search built the far floor once');
  assert.ok(first, 'standing room on the far floor');
  assert.ok(Math.abs(first[0] - 1184) <= 2.1 && Math.abs(first[1] - 32) <= 2.1);
  for (let i = 0; i < 40; i++) assert.deepEqual(e.standableNearV1([1184, 32], 1, undefined, 0.4, 8), first);
  assert.equal(w.ground.stats.levelBuilds, builds, 'forty more searches built nothing');
});

test('a static-world edit moves the epoch: the tile is rebuilt once and shows the edit', () => {
  const w = world([[1184, 32]]), at: [number, number] = [1184, 32], E = w.spatial;
  const a = E.levelAt(1, at), builds = w.ground.stats.levelBuilds;
  // a new wall across the floor (on level 1 it blocks the cells under it)
  const set = { ...w.set, e_far0: { surfaces: [floor('far0:floor-1', [1184, 32])], solids: [wall('far0:n', [1184, 29], [4, 0.11]), { ...wall('far0:mid', [1184, 32], [0.11, 2.5]), y0: 2.85, y1: 5.6 }], links: [] } };
  w.e.applyWorldEditV1(edit(2, set as never, w.e.world.entityPhysicsV1));
  w.e.step();
  const b = E.levelAt(1, at);
  assert.ok(b !== a, 'rebuilt after the edit');
  assert.equal(w.ground.stats.levelBuilds, builds + 1);
  assert.ok(E.levelAt(1, at) === b);
  same(b, fresh(w, 1, at));
  assert.ok(Buffer.compare(Buffer.from(a.free.buffer), Buffer.from(b.free.buffer)) !== 0, 'the edit changed the floor');
});

test('the memo is bounded and keeps the most recently used tiles', () => {
  const tiles: [number, number][] = Array.from({ length: 16 }, (_, i) => [416 + i * 64, 32]);
  const w = world(tiles), E = w.spatial;
  const grids = tiles.map((t) => E.levelAt(1, t));
  assert.ok(grids.every(Boolean));
  assert.equal(w.ground.stats.levelBuilds, 16);
  assert.ok(E.outside.size <= 12, `memo holds ${E.outside.size}`);
  assert.ok(E.levelAt(1, tiles[15]) === grids[15], 'the newest is still held');
  assert.equal(w.ground.stats.levelBuilds, 16);
  assert.ok(E.levelAt(1, tiles[0]) !== grids[0], 'the oldest was dropped and is rebuilt on demand');
  same(E.levelAt(1, tiles[0]), fresh(w, 1, tiles[0]));
});
