// building/1 physics: plans, openings, stairs, floors, slots, checks. Owner: L2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildingLayout, buildingPhysics } from './building.ts';
import { pointInPoly } from './geom.ts';
import type { Baked, LocalOBB } from './types.ts';

const violations = (b: Baked) => (b.notes ?? []).filter((n) => n.startsWith('violation: '));
/** Does any collider cover the point (x, z) at height y? */
function solidAt(b: Baked, x: number, z: number, y: number): LocalOBB | undefined {
  return b.colliders.find((o) => {
    if (y < o.y0 || y > o.y1) return false;
    const c = Math.cos(o.yaw), s = Math.sin(o.yaw), dx = x - o.c[0], dz = z - o.c[1];
    const u = dx * c - dz * s, v = dx * s + dz * c; // into the OBB's axes (x axis = (cos, -sin))
    return Math.abs(u) <= o.half[0] + 1e-6 && Math.abs(v) <= o.half[1] + 1e-6;
  });
}

test('cottage, one floor: three rooms, a front door you can walk through, windows with sills, all reachable', () => {
  const b = buildingPhysics({ style: 'cottage', w: 8, d: 6 });
  assert.deepEqual(b.rooms!.map((r) => r.id).sort(), ['bedroom', 'kitchen', 'living']);
  const door = b.openings!.find((o) => o.id === 'front-door')!;
  assert.ok(door && door.kind === 'door' && Math.abs(door.at[1] - 2.89) < 0.01, JSON.stringify(door));
  assert.equal(solidAt(b, door.at[0], door.at[1], 1.0), undefined, 'doorway is open');
  assert.ok(solidAt(b, door.at[0], door.at[1], 2.5), 'lintel above the door');
  const win = b.openings!.find((o) => o.kind === 'window')!;
  assert.ok(solidAt(b, win.at[0], win.at[1], 0.5), 'wall below the sill');
  assert.equal(solidAt(b, win.at[0], win.at[1], 1.5), undefined, 'glass gap at eye height');
  assert.equal(violations(b).length, 0, violations(b).join('\n'));
  assert.ok(b.notes!.some((n) => n === 'reachable from outside: all 3 rooms'));
  // the old placeholder's slots still exist: a floor slot and a stand outside the door
  assert.ok(b.slots.find((s) => s.id === 'ground' && s.kind === 'floor'));
  const front = b.slots.find((s) => s.id === 'front')!; assert.ok(front.p[2] > 3.5 && Math.abs(Math.abs(front.yaw) - Math.PI) < 1e-3, 'stands outside, facing the door');
  // the middle of the living room is free (S2 of the shared e2e puts a table at the origin)
  for (const [x, z] of [[0, 0], [1, 0], [-1, 0]]) assert.equal(solidAt(b, x, z, 0.4), undefined, `free at ${x},${z}`);
});

test('cottage, two floors: stairs link, stairwell cut from the upper floor, rooms upstairs, balcony and porch', () => {
  const b = buildingPhysics({ style: 'cottage', w: 8, d: 6, floors: 2, balcony: true, porch: 1.5 });
  assert.equal(violations(b).length, 0, violations(b).join('\n'));
  const link = b.links!.find((l) => l.kind === 'stairs')!;
  assert.ok(link && link.from === 0 && link.to === 1 && link.y1 - link.y0 === 2.8);
  const up = b.rooms!.filter((r) => r.floor === 1).map((r) => r.id).sort();
  assert.deepEqual(up, ['bedroom', 'bedroom-2', 'landing']);
  // the stairwell: no floor-1 surface over the middle of the flight; the ground floor is whole there
  const mid = link.path[1].map((v, i) => (v + link.path[2][i]) / 2) as [number, number];
  const at = (level: number) => b.surfaces!.filter((s) => s.level === level && pointInPoly(mid[0], mid[1], s.polygon));
  assert.equal(at(1).length, 0, 'stairwell open above the stairs');
  assert.equal(at(0).length, 1, 'ground floor under the stairs');
  // the head of the stairs lands on floor 1 inside the landing
  const head = link.path[link.path.length - 1];
  assert.ok(b.surfaces!.some((s) => s.level === 1 && s.tag === 'landing' && pointInPoly(head[0], head[1], s.polygon)));
  // room slots carry floor, height and polygon; children in `bedroom` sit at floor-1 height
  const bed = b.slots.find((s) => s.id === 'bedroom')!;
  assert.equal(bed.kind, 'room'); assert.equal(bed.floor, 1); assert.equal(bed.p[1], 2.9); assert.ok(bed.polygon!.length === 4 && (bed.height ?? 0) >= 2.0);
  assert.ok(b.slots.find((s) => s.id === 'balcony') && b.slots.find((s) => s.id === 'porch'));
  assert.ok(b.openings!.find((o) => o.id === 'balcony-door' && o.level === 1));
  assert.ok(b.colliders.some((c) => c.tag === 'rail') && b.colliders.some((c) => c.tag === 'post') && b.colliders.some((c) => c.tag?.startsWith('stairs:')));
  assert.ok(b.box[2] >= 6 + 3, 'box includes the porch');
});

test('ground-floor rooms keep their ids from one floor to two (furniture survives `set floors`)', () => {
  const one = buildingPhysics({ style: 'cottage', floors: 1 }), two = buildingPhysics({ style: 'cottage', floors: 2 });
  for (const id of ['kitchen', 'living']) {
    const a = one.rooms!.find((r) => r.id === id)!, c = two.rooms!.find((r) => r.id === id)!;
    assert.deepEqual(a.origin, c.origin, id); assert.equal(c.floor, 0);
  }
  assert.ok(two.rooms!.find((r) => r.id === 'bedroom')!.floor === 1, 'the bedroom moves upstairs');
});

test('every style bakes clean with its defaults and with more floors; triangles within budget', () => {
  const cases: [Record<string, unknown>, Record<string, unknown>][] = [
    [{ style: 'cottage' }, {}], [{ style: 'cottage', floors: 3, w: 9, d: 7 }, {}], [{ style: 'townhouse', w: 6, d: 10, floors: 3 }, {}],
    [{ style: 'shop', w: 8, d: 9, floors: 2 }, {}], [{ style: 'hall', w: 14, d: 12, floorHeight: 4 }, {}], [{ style: 'chapel', w: 8, d: 14, floorHeight: 5 }, {}],
    [{ style: 'barn', w: 10, d: 14, floorHeight: 4.2, floors: 2 }, {}], [{ style: 'shed', w: 3, d: 2.6 }, {}], [{ style: 'greenhouse', w: 6, d: 4 }, {}],
    [{ style: 'pavilion', w: 6, d: 6 }, {}], [{ style: 'tower', w: 5, d: 5, floors: 3, floorHeight: 3 }, { round: false }],
    [{ style: 'tower', w: 6, d: 6, floors: 5, floorHeight: 3, roof: 'dome' }, { round: true, lantern: true }],
    [{ style: 'cottage', floors: 2, front: 'e' }, {}], [{ style: 'townhouse', front: 'n', floors: 2 }, {}], [{ style: 'cottage', w: 4.5, d: 4, floors: 2 }, {}],
  ];
  for (const [p, a] of cases) {
    const b = buildingPhysics(p, a);
    assert.equal(violations(b).length, 0, `${JSON.stringify(p)}: ${violations(b).join('; ')}`);
    assert.ok(b.box.every((v) => v > 0) && b.tris <= 6000, `${JSON.stringify(p)} tris ${b.tris}`);
    assert.ok(b.surfaces!.length >= 1 && b.rooms!.length >= 1 && b.slots.some((s) => s.id === 'front'), JSON.stringify(p));
  }
});

test('front turns the plan: front e puts the door on +x and the stand slot beyond it', () => {
  const b = buildingPhysics({ style: 'cottage', w: 8, d: 6, front: 'e' });
  const door = b.openings!.find((o) => o.id === 'front-door')!;
  assert.ok(door.at[0] > 3.5 && Math.abs(door.yaw - Math.PI / 2) < 1e-3, JSON.stringify(door));
  assert.ok(b.slots.find((s) => s.id === 'front')!.p[0] > 5);
  assert.deepEqual(b.box.slice(0, 1), [8]);
});

test('lighthouse: a helix up five floors, a lantern room with glass all round and a gallery', () => {
  const b = buildingPhysics({ style: 'tower', w: 6, d: 6, floors: 5, floorHeight: 3, roof: 'dome' }, { round: true, lantern: true });
  assert.equal(b.links!.length, 4); assert.ok(b.links!.every((l, i) => l.from === i && l.to === i + 1 && l.path.length > 10));
  assert.equal(b.rooms![4].id, 'lantern');
  assert.ok(b.openings!.filter((o) => o.kind === 'window' && o.level === 4).length >= 8, 'lantern glazing');
  assert.ok(b.slots.find((s) => s.id === 'balcony' && s.floor === 4));
  assert.equal(violations(b).length, 0, violations(b).join('; '));
});

test('spiral stairs: no rail fences the arrival, whatever floor the flight arrives on (the flight into floor 3 was walled in by six rails)', () => {
  const BODY = 0.28;
  for (const [label, args] of [['lighthouse', { round: true, lantern: true }], ['tower', { round: false }]] as const) {
    for (const w of [5, 6, 8, 10]) for (let floors = 2; floors <= 6; floors++) {
      const b = buildingPhysics({ style: 'tower', w, d: w, floors, floorHeight: 3, roof: 'dome' }, args);
      if (violations(b).length) continue; // too narrow for stairs: the design check refuses it before any resident could try
      for (const l of b.links!) {
        const head = l.path[l.path.length - 1], len = Math.hypot(head[0], head[1]);
        const rails = b.colliders.filter((o) => o.tag === 'rail' && Math.abs(o.y0 - l.y1) < 0.2);
        // walk from the landing in to the middle of the well (stop short of the lamp): a body must not touch a rail
        for (let d = 0; d <= len - 0.9; d += 0.05) {
          const x = head[0] * (1 - d / len), z = head[1] * (1 - d / len);
          const hit = rails.find((o) => { const c = Math.cos(o.yaw), s = Math.sin(o.yaw), dx = x - o.c[0], dz = z - o.c[1]; return Math.abs(dx * c - dz * s) <= o.half[0] + BODY && Math.abs(dx * s + dz * c) <= o.half[1] + BODY; });
          assert.equal(hit, undefined, `${label} w=${w} floors=${floors}: a rail fences the landing of ${l.id} (into floor ${l.to}) ${d.toFixed(2)} m from it`);
        }
      }
    }
  }
});

test('explicit plan: rooms and doors as given; a sealed room is a violation the compiler can refuse', () => {
  const plan = { floors: [{ rooms: [{ id: 'kitchen', rect: [0, 0, 4, 6] }, { id: 'living', rect: [4, 0, 10, 6] }, { id: 'store', rect: [0, 6, 4, 8] }], doors: [{ between: ['kitchen', 'living'] }], exterior: [{ room: 'living', wall: 's', kind: 'door' }] }] };
  const b = buildingPhysics({ w: 10, d: 8, plan });
  const v = violations(b);
  assert.equal(v.length, 1, v.join('; '));
  assert.match(v[0], /room\.unreachable: store/);
  const fixed = buildingPhysics({ w: 10, d: 8, plan: { floors: [{ ...plan.floors[0], doors: [{ between: ['kitchen', 'living'] }, { between: ['store', 'kitchen'] }] }] } });
  assert.equal(violations(fixed).length, 0, violations(fixed).join('; '));
  // no doors key: rooms connect automatically
  const auto = buildingPhysics({ w: 10, d: 8, plan: { floors: [{ rooms: plan.floors[0].rooms, exterior: plan.floors[0].exterior }] } });
  assert.equal(violations(auto).length, 0, violations(auto).join('; '));
});

test('explicit plan with stairs: two floors joined; stairs through a wall are refused', () => {
  const plan = { floors: [
    { rooms: [{ id: 'hall', rect: [0, 0, 9, 6] }], exterior: [{ room: 'hall', wall: 's', kind: 'door' }] },
    { rooms: [{ id: 'loft', rect: [0, 0, 9, 6] }] },
  ], stairs: [{ from: 0, to: 1, room: 'hall', wall: 'n' }] };
  const b = buildingPhysics({ w: 9, d: 6, plan });
  assert.equal(violations(b).length, 0, violations(b).join('; '));
  assert.equal(b.links!.length, 1);
  const bad = buildingPhysics({ w: 9, d: 6, plan: { ...plan, floors: [{ rooms: [{ id: 'a', rect: [0, 0, 2, 6] }, { id: 'b', rect: [2, 0, 9, 6] }], exterior: [{ room: 'b', wall: 's', kind: 'door' }] }, plan.floors[1]], stairs: [{ from: 0, to: 1, room: 'a', wall: 'n' }] } });
  assert.ok(violations(bad).some((x) => /stairs\.outside-room/.test(x)), violations(bad).join('; '));
});

test('layout is shared with the mesh half and cached by value', () => {
  const a = buildingLayout({ style: 'cottage', floors: 2 }), b = buildingLayout({ style: 'cottage', floors: 2 });
  assert.equal(a, b); assert.ok(a.walls.length > 8 && a.checks.ok);
});

test('explicit plan: an upper-floor balcony opens off the named room through its south wall, at `at`', () => {
  const room = (id: string, rect: number[]) => ({ id, rect });
  const plan = { floors: [{ rooms: [room('lobby', [0, 0, 12, 8])], exterior: [{ room: 'lobby', wall: 's', kind: 'door' }] },
    { rooms: [room('west', [0, 0, 6, 8]), room('east', [6, 0, 12, 8])] }], stairs: [{ from: 0, to: 1, room: 'lobby', wall: 'n' }],
    balcony: { floor: 1, room: 'east', at: 0.8 } };
  const L = buildingLayout({ w: 12, d: 8, floors: 2, plan }) as unknown as { balcony?: { floor: number; rect: number[] }; openings: { id: string; floor: number; at: number[]; from?: string; to?: string }[] };
  const door = L.openings.find((o) => o.id === 'balcony-door');
  assert.ok(door && door.floor === 1 && door.from === 'east' && door.to === 'balcony');
  assert.ok(door.at[0] > 3, 'at 0.8 puts the door in the east part of the east room');
  assert.equal(L.balcony?.floor, 1);
  assert.ok(L.balcony!.rect[1] >= 3.9 && L.balcony!.rect[0] < door.at[0] && L.balcony!.rect[2] > door.at[0], 'the balcony sits outside the south wall in front of its door');
  const none = buildingLayout({ w: 12, d: 8, floors: 2, plan: { ...plan, balcony: { floor: 0, room: 'lobby' } } }) as unknown as { balcony?: unknown };
  assert.equal(none.balcony, undefined, 'no ground-floor balcony');
  assert.equal(buildingPhysics({ w: 12, d: 8, plan }).notes?.filter((n) => n.startsWith('violation: ')).length ?? 0, 0);
});
