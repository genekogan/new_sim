import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CORE_KIT, WorldModel, applyBatch, obbOverlap, type Refused } from './index.ts';
import { furnishBatch, roomKeys, connectedPairs, wayLabels, approachOf, gridSlack } from '../../../tools/god-skill/lib/furnish.mjs';

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
  for (const room of baked.rooms.filter((x: any) => x.floor === 0)) {
    const keys = roomKeys(room, doors, baked.links ?? []), walls = baked.colliders.filter((o: any) => o.y0 < room.y + 1.6 && o.y1 > room.y + 0.15);
    const pieces = [...w.children.get(b.id)!].map((id) => w.entities.get(id)!).filter((e: any) => e.in.slot === room.id).map((e: any) => {
      const d = w.resolvedDef(e.def)!, bb = w.bake(d, e.params ?? {}, e.seed ?? 0) as any, p = e.p ?? [0, 0, 0];
      const c = [room.origin[0] + p[0], room.origin[1] + p[p.length - 1]], yaw = typeof e.r === 'number' ? e.r : 0;
      return { name: e.name, c, half: [bb.box[0] / 2, bb.box[2] / 2], yaw, y0: room.y, y1: room.y + bb.box[1], solid: d.layer === 'solid' && bb.box[1] > 0.06, approach: approachOf(bb, c, yaw) };
    }).filter((x) => x.solid);
    const all = (keys.length * (keys.length - 1)) / 2;
    assert.equal(connectedPairs(room, keys, walls), all, `${room.id}: walls alone`);
    assert.equal(connectedPairs(room, keys, [...walls, ...pieces]), all, `${room.id}: furnished, ${keys.length} doors/stair ends`);
    // ... and where a Soul sent to each piece stands is reached from the doors (the display may not stand at a shelf's front)
    const labels = wayLabels(room, [...keys, ...pieces.map((x) => x.approach)], [...walls, ...pieces]);
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

test('a piece may not stand where a Soul sent to another piece would stand (the display at shelf-2\'s front)', () => {
  // SEALED 2026-10-21: moved to the east side (fx 0.78) the display took shelf-2's approach: every shop's shelf-2 went bad
  const recipe = JSON.parse(readFileSync(new URL('../../../tools/god-skill/recipes/furnish/shop.json', import.meta.url), 'utf8'));
  recipe.rooms.shop.find((x: any) => x.name === 'display').try = [[0.78, 0.7, 's'], [0.3, 0.7, 's']];
  const f = furnishedShop(recipe);
  const d: any = f.ops.find((o: any) => o.name === 'shop-display');
  assert.ok(d && d.p[0] < 0, `display goes to its next pose, not shelf-2's front: ${JSON.stringify(d?.p)} ${JSON.stringify(f.dropped)}`);
});

test('the ways check keeps the walk grid\'s slack, more in a building turned off the grid (hillside-home-4, lane WALK2)', () => {
  assert.equal(gridSlack(0), 0.1); assert.equal(+gridSlack(Math.PI / 4).toFixed(6), 0.15); assert.equal(+gridSlack(Math.PI).toFixed(6), 0.1);
  // a 4 x 4 m room split by a wall with a 0.95 m gap: square to the grid the body passes, turned 45 deg it does not (on the
  // walk grid a 0.96 m gap in hillside-home-4, turned 39 deg, had 0.31 m of room where 0.34 is needed)
  const room = { id: 'r', floor: 0, polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] } as never;
  const wall = (x0: number, x1: number) => ({ c: [(x0 + x1) / 2, 2], half: [(x1 - x0) / 2, 0.05], yaw: 0, y0: 0, y1: 2 });
  const keys: [number, number][] = [[2, 0.5], [2, 3.5]], blockers = [wall(0, 1.5), wall(2.45, 4)];
  assert.equal(connectedPairs(room, keys, blockers, gridSlack(0)), 1, 'square to the grid');
  assert.equal(connectedPairs(room, keys, blockers, gridSlack(Math.PI / 4)), 0, 'turned 45 deg');
});
