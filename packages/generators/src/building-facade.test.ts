import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildingLayout, buildingPhysics, buildingParams, buildingFacadeSlots } from './building.ts';
import { slotSchema } from './fields.ts';
import fixtures from './fixtures/building-dress.json' with { type: 'json' };

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) <= 0.0011, `${a} != ${b}`);
const flags = { chimney: false, shutters: false, flowerBoxes: false, quoins: false, hood: false, doorLamp: false };

test('ornament switches are optional booleans defaulting to the existing look; physics is unchanged', () => {
  for (const k of Object.keys(flags)) assert.deepEqual({ type: buildingParams[k as keyof typeof flags].type, default: buildingParams[k as keyof typeof flags].default }, { type: 'bool', default: true });
  for (const { params } of fixtures) assert.deepEqual(buildingPhysics({ ...params, ...flags }), buildingPhysics(params));
});

test('every exterior opening gets an outward-facing sill anchor, on every storey and front', () => {
  for (const front of ['s', 'e', 'n', 'w']) {
    const p = { style: 'townhouse', floors: 3, front, w: 10, d: 7 }, L = buildingLayout(p), baked = buildingPhysics(p);
    const ops = baked.openings!.filter(o => o.exterior);
    assert.equal(baked.slots.filter(s => s.id.startsWith('opening-')).length, ops.length);
    for (const o of ops) {
      const slot = baked.slots.find(s => s.id === `opening-${o.id}`)!;
      assert.ok(slot); slotSchema.parse(slot);
      near(slot.p[0], o.at[0] + Math.sin(o.yaw) * (L.t / 2 + 0.02));
      near(slot.p[2], o.at[1] + Math.cos(o.yaw) * (L.t / 2 + 0.02));
      near(slot.p[1], 0.1 + o.level * L.fh + (o.sill ?? 0)); near(slot.yaw, o.yaw);
      assert.equal(slot.floor, o.level); assert.equal(slot.capacity, 1);
    }
  }
});

test('each exterior wall run has a facade frame on every storey, including round towers', () => {
  for (const style of ['cottage', 'townhouse', 'tower']) {
    const p = { style, floors: 3, w: 10, d: 8 }, L = buildingLayout(p), b = buildingPhysics(p);
    assert.equal(b.slots.filter(s => s.id.startsWith('facade-')).length, L.walls.filter(w => w.exterior).length);
    for (let floor = 0; floor < 3; floor++) assert.ok(b.slots.some(s => s.id.startsWith(`facade-f${floor}-`) && s.floor === floor));
    for (const s of b.slots) slotSchema.parse(s);
  }
});

test('gable apexes follow the actual wall triangle; ridge clears the roof; unsupported roofs add no gables', () => {
  for (const [w, d] of [[10, 6], [6, 10]]) {
    const p = { w, d, roof: 'gable', front: 'e' }, L = buildingLayout(p), b = buildingPhysics(p);
    const gables = b.slots.filter(s => s.id.startsWith('gable-'));
    assert.equal(gables.length, 2);
    for (const g of gables) near(g.p[1], L.wallTop + L.roofRise * (Math.min(L.W, L.D) / 2) / (Math.min(L.W, L.D) / 2 + 0.35));
    near(b.slots.find(s => s.id === 'ridge')!.p[1], L.wallTop + L.roofRise + 0.18);
  }
  for (const roof of ['none', 'shed', 'flat', 'dome', 'hip']) {
    const slots = buildingPhysics({ roof }).slots;
    assert.equal(slots.some(s => s.id.startsWith('gable-')), false);
    assert.equal(slots.some(s => s.id === 'ridge'), roof === 'hip');
  }
  assert.equal(buildingPhysics({ style: 'tower' }).slots.some(s => s.id === 'ridge'), false);
});

test('facade ids avoid authored room ids and preserve the existing wall hang slots', () => {
  const L = buildingLayout({ floors: 2 });
  const anchors = buildingFacadeSlots(L), colliding = anchors[0].id;
  const reserved = [colliding, `${colliding}-2`];
  const renamed = buildingFacadeSlots(L, reserved);
  assert.equal(renamed[0].id, `${colliding}-3`);
  const all = buildingPhysics({ floors: 2 }).slots;
  assert.equal(new Set(all.map(s => s.id)).size, all.length);
  assert.ok(all.some(s => /^wall-[snew]-\d+$/.test(s.id)));
});
