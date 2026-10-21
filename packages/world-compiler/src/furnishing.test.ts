import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORE_KIT, WorldModel, applyBatch, obbOverlap, type Refused } from './index.ts';
import { furnishBatch, roomKeys, connectedPairs, wayLabels, approachOf } from '../../../tools/god-skill/lib/furnish.mjs';

function fresh() {
  const w = new WorldModel({ constants: { ground: 'land' }, seed: 'furnishing' });
  for (const d of CORE_KIT) w.defineDef(d, 'core', 0);
  const r = applyBatch(w, { ops: [{ op: 'place', def: 'core/church@1', name: 'church' }] }, 'god', 1);
  assert.equal(r.result.accepted, true, JSON.stringify(r.result)); return w;
}

test('library church contents do not overlap each other; every pew cushion can be recoloured', () => {
  const w = fresh(), b = w.get('church')!;
  const children = [...w.children.get(b.id)!].map(id => w.entities.get(id)!);
  for (let i = 0; i < children.length; i++) for (const other of children.slice(i + 1)) {
    const e = children[i];
    assert.ok(!w.footprint(e).some(a => w.footprint(other).some(b => obbOverlap(a, b))), `${e.name} overlaps ${other.name}`);
  }
  const pews = children.filter(e => e.name?.includes('pew'));
  assert.ok(pews.length >= 8);
  for (const e of pews) {
    const result = applyBatch(w, { ops: [{ op: 'set', id: e.id, params: { cushion: '#123456' } }] }, 'god', 2).result;
    assert.equal(result.accepted, true, JSON.stringify(result));
  }
});

test('live church furnish recipe admits without overlaps after clearing its contents', () => {
  const w = fresh(), b = w.get('church')!;
  for (const id of [...w.children.get(b.id)!]) w.delete(id);
  const f = furnishBatch(w, b.id, 'church');
  assert.ok(f.ops.length >= 8);
  const r = applyBatch(w, { ops: f.ops }, 'god', 2).result;
  assert.equal(r.accepted, true, JSON.stringify(r));
});

test('moving a church pew into its piano is refused', () => {
  const w = fresh(), piano = w.get('church/nave-piano')!, pew = w.get('church/nave-pew-1-2')!;
  assert.ok(piano && pew);
  const result = applyBatch(w, { ops: [{ op: 'move', id: pew.id, p: piano.p }] }, 'god', 2).result;
  assert.equal((result as Refused).failures?.[0].code, 'overlap.solid');
});

test('legacy overlapping pair: unchanged footprint and reduced penetration pass, worsened and new overlap refuse', () => {
  const w = new WorldModel({ constants: { ground: 'land' }, seed: 'legacy-overlap' });
  w.defineDef({ schema: 'def/1', name: 'cube', params: { color: { type: 'color', default: '#ffffff' } }, size: { box: [1, 1, 1] }, make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', size: [1, 1, 1], at: [0, 0.5, 0] }] } } }, 'god', 0);
  for (const [id, x] of [['a', 0], ['b', 0.8], ['c', 4]] as const) {
    const e = { id, def: 'cube@1', in: { parent: 'world' }, p: [x, 0, 0] as [number, number, number], by: 'legacy', born: 0, v: 1 };
    w.insert(e); w.index(id, w.footprint(e));
  }
  assert.equal(applyBatch(w, { ops: [{ op: 'set', id: 'a', params: { color: '#123456' } }] }, 'god', 1).result.accepted, true);
  assert.equal(applyBatch(w, { ops: [{ op: 'move', id: 'b', p: [0.9, 0, 0] }] }, 'god', 2).result.accepted, true);
  for (const [id, x] of [['b', 0.4], ['c', -0.8]] as const) assert.equal((applyBatch(w, { ops: [{ op: 'move', id, p: [x, 0, 0] }] }, 'god', 3).result as Refused).failures?.[0].code, 'overlap.solid');
});

function furnishedShop(recipe?: any) {
  const w = new WorldModel({ constants: { ground: 'land' }, seed: 'furnishing' });
  for (const d of CORE_KIT) w.defineDef(d, 'core', 0);
  assert.equal(applyBatch(w, { ops: [{ op: 'place', def: 'core/shop@1', name: 'shop', params: { w: 5.7, d: 8, floors: 3, balcony: true } }] }, 'god', 1).result.accepted, true);
  const b = w.get('shop')!;
  for (const id of [...w.children.get(b.id) ?? []]) w.delete(id);
  const f = furnishBatch(w, b.id, 'shop', recipe ? { recipe } : {});
  const r = applyBatch(w, { ops: f.ops }, 'god', 2).result;
  assert.equal(r.accepted, true, JSON.stringify(r));
  const baked = w.bake(w.resolvedDef(b.def)!, b.params ?? {}, b.seed ?? 0, b.shape) as any;
  const doors = baked.openings.filter((o: any) => o.kind === 'door' || o.kind === 'arch');
  const wp = w.worldPose(b), way = { pose: { x: wp.x, z: wp.z, yaw: wp.yaw, s: wp.s } };   // on the walk raster where it stands (BS1)
  for (const room of baked.rooms.filter((x: any) => x.floor === 0)) {
    const keys = roomKeys(room, doors, baked.links ?? []), walls = baked.colliders.filter((o: any) => o.y0 < room.y + 1.6 && o.y1 > room.y + 0.15);
    const pieces = [...w.children.get(b.id)!].map((id) => w.entities.get(id)!).filter((e: any) => e.in.slot === room.id).map((e: any) => {
      const d = w.resolvedDef(e.def)!, bb = w.bake(d, e.params ?? {}, e.seed ?? 0) as any, p = e.p ?? [0, 0, 0];
      const c = [room.origin[0] + p[0], room.origin[1] + p[p.length - 1]], yaw = typeof e.r === 'number' ? e.r : 0;
      return { name: e.name, c, half: [bb.box[0] / 2, bb.box[2] / 2], yaw, y0: room.y, y1: room.y + bb.box[1], solid: d.layer === 'solid' && bb.box[1] > 0.06, approach: approachOf(bb, c, yaw) };
    }).filter((x) => x.solid);
    const all = (keys.length * (keys.length - 1)) / 2;
    assert.equal(connectedPairs(room, keys, walls, way), all, `${room.id}: walls alone`);
    assert.equal(connectedPairs(room, keys, [...walls, ...pieces], way), all, `${room.id}: furnished, ${keys.length} doors/stair ends`);
    // ... and where a Soul sent to each piece stands is reached from the doors (the display may not stand at a shelf's front)
    const labels = wayLabels(room, [...keys, ...pieces.map((x) => x.approach)], [...walls, ...pieces], way);
    for (const [i, x] of pieces.entries()) assert.ok(labels[keys.length + i] === labels[0], `${room.id}: ${x.name} is reached from the door`);
  }
  return f;
}

test('a furnished shop keeps the way from its front door to the storeroom door (no piece seals the counter nook)', () => {
  // SEALED 2026-10-21: the shop recipe put the stool behind the counter and the display 0.62 m off shelf-1, so the storeroom,
  // the stair foot and both upper floors were one pocket Souls could not reach (9 market-street shops, ~14 dests each)
  const f = furnishedShop();
  assert.ok(f.placed.some((p: any) => p.name === 'shop-counter') && f.placed.some((p: any) => p.name === 'shop-display'), JSON.stringify(f.dropped));
});

test('a seat whose own front is shut in is dropped (the shop stool behind the counter); a piece may not stand at another piece\'s front', () => {
  // SEALED 2026-10-21 put the display on the east side (fx 0.78) and saw shelf-2 go bad, but only because the stool's key (any
  // free cell within 1.5 m of its front) let it stand behind the counter with its front shut in. BSGEN 2026-10-21: a seat's key
  // is within 0.5 m of its front, one key per seat; the stool is dropped and, in the fuzz walk world with the display first at
  // 0.78, no shop has a bad or unusable piece (at 1.5 m: 5 shops with the stool use.no-approach). furnishedShop checks that
  // every placed piece's front is reached from the door.
  const recipe = JSON.parse(readFileSync(new URL('../../../tools/god-skill/recipes/furnish/shop.json', import.meta.url), 'utf8'));
  recipe.rooms.shop.find((x: any) => x.name === 'display').try = [[0.78, 0.7, 's'], [0.3, 0.7, 's']];
  const f = furnishedShop(recipe);
  assert.ok(!f.placed.some((p: any) => p.name === 'shop-stool') && f.dropped.some((p: any) => p.name === 'shop-stool'), JSON.stringify(f.dropped));
  assert.ok(f.placed.some((p: any) => p.name === 'shop-display') && f.placed.some((p: any) => p.name === 'shop-shelf-2'), JSON.stringify(f.dropped));
});

test('the ways check judges a gap on the walk raster where the building stands, turned or not (hillside-home-4, lane WALK2; BS1 rule)', () => {
  // a 4 x 4 m room split by a wall with a gap: on the raster of a building square to the grid and of one turned 39 deg
  // (hillside-home-4: a 0.96 m gap between a table and a sofa had 0.31 m of room on the walk grid where 0.34 is needed)
  const room = { id: 'r', floor: 0, polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] } as never;
  const wall = (x0: number, x1: number) => ({ c: [(x0 + x1) / 2, 2], half: [(x1 - x0) / 2, 0.05], yaw: 0, y0: 0, y1: 2 });
  const keys: [number, number][] = [[2, 0.5], [2, 3.5]];
  const gap = (w: number, yaw: number) => connectedPairs(room, keys, [wall(0, 2 - w / 2), wall(2 + w / 2, 4)], { pose: { x: 10.03, z: 20.07, yaw } });
  assert.equal(gap(0.88, 0), 1, 'a 0.88 m gap walks square to the grid');
  assert.equal(gap(0.88, 39 * Math.PI / 180), 0, 'the same gap is sealed turned 39 deg');
  assert.equal(gap(0.96, Math.PI / 4), 0, 'a 0.96 m gap is sealed turned 45 deg');
  for (const yaw of [0, 39 * Math.PI / 180, Math.PI / 4]) assert.equal(gap(1.04, yaw), 1, `a 1.04 m gap walks at yaw ${yaw.toFixed(2)}`);
});

test('built-in contents are what the type\'s furnish recipe lays out (theatre, office block, hospital; lane BSGEN)', () => {
  // these types' contents were laid out by an older furnish (vocab-w3.mjs layOut). core/theatre@1's back row 4-1 stood ~0.7 m
  // inside the foyer door and, on a turned theatre's walk grid, cut the whole auditorium off (fuzz walk world: 4 turned
  // theatres, 61 bad each); the office block's meeting-room chairs and the hospital wards' fourth beds shut in their rooms'
  // ways (fuzz: office blocks 136 -> 61 bad, hospitals 117 -> 6). Today's furnish drops them.
  const contents = (type: string) => {
    const w = new WorldModel({ constants: { ground: 'land' }, seed: type });
    for (const d of CORE_KIT) w.defineDef(d, 'core', 0);
    assert.equal(applyBatch(w, { ops: [{ op: 'place', def: `core/${type}@1`, name: 'b' }] }, 'god', 1).result.accepted, true);
    const b = w.get('b')!;
    return { w, b, kids: [...w.children.get(b.id) ?? []].map((id) => w.entities.get(id)!.name) };
  };
  const t = contents('theatre');
  for (const id of [...t.w.children.get(t.b.id) ?? []]) t.w.delete(id);
  // contents are laid out at build time with no world pose (the exact clearance rule, which holds at any yaw and offset),
  // so compare with furnish on the same terms: the placed theatre's own pose would use the axis-aligned walk raster instead
  const f = furnishBatch(Object.create(t.w, { worldPose: { value: undefined } }), t.b.id);
  assert.deepEqual(t.kids.sort(), f.ops.filter((o: any) => o.op === 'place').map((o: any) => o.name).sort(), JSON.stringify(f.dropped));
  const gone = { 'office-block': ['meeting-2-chair-n-2', 'meeting-2-chair-s-1', 'meeting-3-chair-s-2'], hospital: ['ward-1-bed-4', 'ward-2-bed-4', 'ward-3-bed-4'] };
  for (const [type, names] of Object.entries(gone)) { const k = contents(type).kids; for (const n of names) assert.ok(!k.includes(n), `${type}: ${n}`); }
});
