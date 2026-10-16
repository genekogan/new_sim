import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildingLayout, buildingPhysics, buildingParams, buildingFacadeSlots, FACADE_MOUNT_HALF } from './building.ts';
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

test('each exterior wall run has at most one facade frame and every storey has one, including round towers', () => {
  for (const style of ['cottage', 'townhouse', 'tower']) {
    const p = { style, floors: 3, w: 10, d: 8 }, L = buildingLayout(p), b = buildingPhysics(p);
    const frames = b.slots.filter(s => s.id.startsWith('facade-')).length;
    assert.ok(frames > 0 && frames <= L.walls.filter(w => w.exterior).length);
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

// r2.1 walk: on the dressed cottage facade-f0-s-1 / -s-2 sat on a window and the front door, so mounted lanterns hung
// in the openings. A frame now sits on solid wall: clear of every door and window on its facade plus their dressing.
const along = (slot: { p: number[]; yaw: number }, o: { at: number[]; yaw: number }) => Math.abs((slot.p[0] - o.at[0]) * Math.cos(o.yaw) - (slot.p[2] - o.at[1]) * Math.sin(o.yaw));
const onFacade = (slot: { p: number[]; yaw: number; floor?: number }, o: { at: number[]; yaw: number; level: number }) =>
  slot.floor === o.level && Math.abs(Math.sin(slot.yaw - o.yaw)) < 1e-3 && Math.cos(slot.yaw - o.yaw) > 0
  && Math.abs((slot.p[0] - o.at[0]) * Math.sin(o.yaw) + (slot.p[2] - o.at[1]) * Math.cos(o.yaw)) < 0.5;

test('facade frames sit on solid wall, clear of doors, windows and their dressing, on every style and front', () => {
  for (const style of ['cottage', 'townhouse', 'hall', 'barn', 'tower', 'shop', 'chapel', 'shed', 'greenhouse'])
    for (const front of ['s', 'e']) {
      const b = buildingPhysics({ style, front, floors: style === 'shed' ? 1 : 2 });
      for (const slot of b.slots.filter(s => s.id.startsWith('facade-') && !s.retired))
        for (const o of b.openings!.filter(o => o.exterior && onFacade(slot, o as never)))
          assert.ok(along(slot, o as never) >= o.width / 2 + FACADE_MOUNT_HALF + 0.15 - 2e-3, `${style}/${front} ${slot.id} is ${along(slot, o as never).toFixed(2)} m from ${o.id} (half-width ${o.width / 2})`);
    }
});

test('the dressed cottage keeps facade-f0-s-1 and -s-2 beside the front door, clear of its lamp and the windows', () => {
  const b = buildingPhysics({ style: 'cottage' }), slots = b.slots.filter(s => /^facade-f0-s-[12]$/.test(s.id));
  assert.deepEqual(slots.map(s => s.id), ['facade-f0-s-1', 'facade-f0-s-2']);
  const door = b.openings!.find(o => o.id === 'front-door')!;
  for (const s of slots) {
    assert.ok(along(s, door as never) >= door.width / 2 + 0.5 + FACADE_MOUNT_HALF - 2e-3, `${s.id} clears the door lamp`);
    for (const w of b.openings!.filter(o => o.kind === 'window' && onFacade(s, o as never))) assert.ok(along(s, w as never) >= w.width / 2 + 0.55 + FACADE_MOUNT_HALF - 2e-3, `${s.id} clears ${w.id} and its shutters`);
  }
  assert.ok(Math.abs(slots[0].p[0] - slots[1].p[0]) >= 0.8 - 1e-6, 'two frames on one stretch of wall stay apart');
  // a 3 m plaster shed has no wall clear of a shuttered window, so it has no live frames; stone windows carry no shutters
  assert.equal(buildingPhysics({ style: 'shed', w: 3, d: 3 }).slots.some(s => s.id.startsWith('facade-') && !s.retired), false);
  assert.ok(buildingPhysics({ style: 'shed', w: 3, d: 3, material: 'stone' }).slots.some(s => s.id.startsWith('facade-') && !s.retired));
});

// r2patch3: release 2 put every facade frame at its run's centre and worlds hold mounts on them. A run that has no clear
// wall now keeps its frame, retired, exactly where release 2 put it, so those mounts stay put (world-compiler refuses
// new mounts there; describe lists it only while occupied). Live frames keep their ids; every release-2 id still resolves.
test('a run with no clear wall keeps its release-2 frame as a retired slot at the run centre; ids are those of release 2', () => {
  for (const style of ['cottage', 'townhouse', 'hall', 'barn', 'tower', 'shop', 'chapel', 'shed', 'greenhouse'])
    for (const front of ['s', 'e']) {
      const p = { style, front, floors: style === 'shed' ? 1 : 2 }, L = buildingLayout(p), b = buildingPhysics(p);
      const runs = L.walls.filter(w => w.exterior && w.out), frames = b.slots.filter(s => s.id.startsWith('facade-'));
      assert.equal(frames.length, runs.length, `${style}/${front}: one frame per exterior run, live or retired`);
      const n = new Map<string, number>(), c = Math.cos(L.yaw), s = Math.sin(L.yaw);
      for (const w of runs) {
        const key = `facade-f${w.floor}-${w.side ?? 'wall'}`, k = (n.get(key) ?? 0) + 1; n.set(key, k);
        const slot = frames.find(f => f.id === `${key}-${k}`)!; assert.ok(slot, `${style}/${front} ${key}-${k}`);
        if (!slot.retired) continue;
        const d = w.thick / 2 + 0.02, x = (w.a[0] + w.b[0]) / 2 + w.out![0] * d, z = (w.a[1] + w.b[1]) / 2 + w.out![1] * d;
        near(slot.p[0], x * c + z * s); near(slot.p[2], -x * s + z * c); near(slot.p[1], (w.y0 + w.y1) / 2);
        assert.match(slot.label ?? '', /retired/);
      }
    }
  // the default cottage: release 2 had facade-f0-w-1 at (-4.02, 1.4, -1.445); it is retired there, w-2 stays live
  const cottage = buildingPhysics({ style: 'cottage' }).slots, w1 = cottage.find(s => s.id === 'facade-f0-w-1')!;
  assert.equal(w1.retired, true); near(w1.p[0], -4.02); near(w1.p[1], 1.4); near(w1.p[2], -1.445);
  assert.equal(cottage.find(s => s.id === 'facade-f0-w-2')!.retired, undefined);
});
