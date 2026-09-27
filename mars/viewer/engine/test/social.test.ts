// Social / inhabited-scene regressions (spec §17, §28 "Reservation conflict", milestone H):
// slots, sit/stand, converse, gather/campfire_circle, ambient_wander on the proving ground's
// open ground, with the default invariants on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { entityFootprint, Spatial } from '../spatial/service.ts';
import { cellOf, clearanceAt } from '../spatial/grid.ts';
import { fireRingRadius, HUMAN_RADIUS } from '../world/catalog.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import { emptyWorld, human, addAll, FIXTURE } from '../world/factory.ts';
import { walkTo } from '../locomotion/walk.ts';
import { add2, angleDelta, heading, pointInObb, rot2, type Vec2 } from '../core/math.ts';
import type { ActionDef, ActionRecord } from '../actions/types.ts';
import type { Entity } from '../world/types.ts';
import { SOCIAL_ACTIONS, releaseForDirective } from '../social/actions.ts';
import { allSlots, fixtureSlots, pointInPolygon, slotsOf, type SocialRegion } from '../social/slots.ts';
import { createRegistry } from '../api/registry.ts';

const LAWN: [number, number][] = [[-10, -10], [-2, -10], [-2, -2], [-10, -2]];

function fixture(id: string, defId: string, x: number, z: number, yaw = 0, obstacle = false): Entity {
  return { id, def: defId, kind: 'fixture', pose: { p: [x, 0, z], yaw }, provenance: FIXTURE, ...(obstacle ? { phase: 'installed' as const, support: { kind: 'ground' as const } } : {}) };
}

function setup(...es: Entity[]) {
  const base = provingGround();
  const w = addAll(emptyWorld('proving-ground', base), ...es);
  w.regions.lawn = { id: 'lawn', label: 'lawn', kind: 'place', polygon: LAWN, provenance: FIXTURE };
  const reg = new Map<string, ActionDef>([[walkTo.verb, walkTo], ...SOCIAL_ACTIONS.map((a) => [a.verb, a] as [string, ActionDef])]);
  return new Runtime(w, reg, { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
}
const p2 = (rt: Runtime, id: string): Vec2 => [rt.world.entities[id].pose.p[0], rt.world.entities[id].pose.p[2]];
const H = (rt: Runtime, id: string) => rt.world.entities[id].human!;
const msgs = (rt: Runtime) => rt.violations.map((v) => v.message);
function runWhile(rt: Runtime, cond: () => boolean, max: number) {
  let n = 0;
  while (cond() && n++ < max) rt.step();
  return !cond();
}
const noClaims = (rt: Runtime, actors: string[]) => actors.every((a) => rt.holder(`actor:${a}`).length === 0) && allSlots(rt).every((s) => !s.claimedBy);

test('social verbs are registered in the one engine registry', () => {
  const reg = createRegistry();
  for (const v of ['sit', 'take_slot', 'stand', 'face', 'converse', 'gather', 'campfire_circle', 'ambient_wander']) assert.ok(reg.has(v), v);
});

test('catalog slots: campfire has 8 fire-circle places 1.6 m out facing the centre; bench 3 seats', () => {
  const rt = setup(fixture('fire', 'campfire', -5, 4, 0.3, true), fixture('bench', 'bench-6ft', 0, -8, Math.PI / 2));
  const ring = fixtureSlots(rt, rt.world.entities.fire);
  assert.equal(ring.length, 8);
  for (const s of ring) {
    assert.equal(s.kind, 'fire-circle');
    assert.ok(Math.abs(Math.hypot(s.p[0] + 5, s.p[1] - 4) - 1.6) < 1e-9);
    assert.ok(Math.abs(angleDelta(s.yaw, heading([-5 - s.p[0], 4 - s.p[1]]))) < 1e-9);
  }
  const seats = slotsOf(rt, 'bench');
  assert.ok(Array.isArray(seats) && seats.length === 3 && seats.every((s) => s.kind === 'seat'));
});

test('sit: two people cannot hold one camp-chair (reservation.conflict names slot + sit; slot.none-free names the chair); stand frees it', () => {
  const rt = setup(fixture('chair', 'camp-chair', 0, -5), human('p1', -2, -5), human('p2', 2, -5));
  const a = rt.submit('sit', { actor: 'p1', fixture: 'chair' });
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  const b = rt.submit('sit', { actor: 'p2', slot: 'chair#seat' }); // same tick
  assert.equal(b.status, 'failed');
  assert.equal(b.diagnostic?.code, 'reservation.conflict');
  assert.match(b.diagnostic!.message, /slot:chair#seat .*\(sit,/);
  const c = rt.submit('sit', { actor: 'p2', fixture: 'chair' });
  assert.equal(c.diagnostic?.code, 'slot.none-free');
  assert.ok(c.diagnostic!.subjects!.includes('chair'), c.diagnostic!.message);
  assert.ok(runWhile(rt, () => a.phase !== 'occupied', 20 * 30), a.diagnostic?.message);
  assert.ok(a.history.some((h) => h.phase === 'sit-down'), 'sat down through the approach point');
  rt.step();
  assert.equal(H(rt, 'p1').activity, 'sit');
  assert.ok(Math.hypot(p2(rt, 'p1')[0], p2(rt, 'p1')[1] + 5) < 0.05);
  assert.ok(Math.abs(angleDelta(rt.world.entities.p1.pose.yaw, Math.PI / 2)) < 0.05, 'faces the seat direction');
  // a directed task for a seated person is refused: walk_to's plan finds its start inside the chair
  // (route.start-blocked naming it) before the runtime reaches the sit's actor reservation
  const w = rt.submit('walk_to', { actor: 'p1', x: -4, z: -5 });
  assert.equal(w.status, 'failed');
  assert.match(w.diagnostic!.message, /chair|\(sit,/);
  const s = rt.submit('stand', { actor: 'p1' });
  assert.equal(s.status, 'executing', s.diagnostic?.message);
  assert.equal(a.status, 'executing', 'stand-up is a deferred stop');
  rt.step();
  assert.equal(H(rt, 'p1').activity, 'stand-up');
  assert.ok(runWhile(rt, () => s.status === 'executing', 20 * 2), 'stand-up takes SIT_TRANSITION');
  assert.equal(s.status, 'completed');
  assert.equal(a.status, 'cancelled');
  assert.equal(H(rt, 'p1').activity, 'idle');
  assert.ok(Math.hypot(p2(rt, 'p1')[0], p2(rt, 'p1')[1] + 5) > 0.55, 'stood up onto the approach point, off the seat');
  assert.ok(noClaims(rt, ['p1']));
  const off = rt.submit('walk_to', { actor: 'p1', x: -2, z: -6 });
  assert.ok(rt.runUntilIdle(20 * 20, [off.id]) && off.status === 'completed', off.diagnostic?.message);
  const d = rt.submit('sit', { actor: 'p2', fixture: 'chair' });
  assert.equal(d.status, 'executing', d.diagnostic?.message);
  assert.ok(runWhile(rt, () => d.phase !== 'occupied', 20 * 30), d.diagnostic?.message);
  assert.deepEqual(msgs(rt), []);
});

test('converse: 4 people form a circle, no overlaps, everyone faces the centre; cancel leaves them idle and unclaimed', () => {
  const ids = ['c1', 'c2', 'c3', 'c4'];
  const rt = setup(human('c1', -2, 3), human('c2', 2, 3), human('c3', -2, 7), human('c4', 2.5, 7.5));
  const a = rt.submit('converse', { actors: ids });
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  assert.ok(runWhile(rt, () => a.phase !== 'talking', 20 * 30), `${a.status} ${a.diagnostic?.message ?? ''}`);
  rt.step();
  const ctr = (a.params as { at?: Vec2 }).at ?? ids.reduce<Vec2>((s, i) => [s[0] + p2(rt, i)[0] / 4, s[1] + p2(rt, i)[1] / 4], [0, 0]);
  for (const i of ids) {
    assert.equal(H(rt, i).activity, 'talk');
    const d = Math.hypot(p2(rt, i)[0] - ctr[0], p2(rt, i)[1] - ctr[1]);
    assert.ok(d >= 0.55 && d <= 1.05, `${i} is ${d.toFixed(2)} m from the centre`);
    const want = heading([ctr[0] - p2(rt, i)[0], ctr[1] - p2(rt, i)[1]]);
    assert.ok(Math.abs(angleDelta(rt.world.entities[i].pose.yaw, want)) < 0.2, `${i} faces the centre`);
  }
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const [x, y] = [p2(rt, ids[i]), p2(rt, ids[j])];
    assert.ok(Math.hypot(x[0] - y[0], x[1] - y[1]) > 0.6, `${ids[i]}/${ids[j]} too close`);
  }
  assert.deepEqual(msgs(rt), []);
  rt.cancel(a.id);
  assert.equal(a.status, 'cancelled');
  for (const i of ids) { assert.equal(H(rt, i).activity, 'idle'); assert.equal(H(rt, i).task, undefined); }
  assert.ok(noClaims(rt, ids));
});

test('converse refusals: a holder (actor.holding) and a circle that does not fit (converse.clearance)', () => {
  const rt = setup(human('c1', -2, 3), human('c2', 2, 3), human('w1', -15.8, -15), human('w2', -14.2, -15));
  H(rt, 'c1').grip = { entity: 'beam9', slot: 'g0' };
  const a = rt.submit('converse', { actors: ['c1', 'c2'] });
  assert.equal(a.diagnostic?.code, 'actor.holding');
  assert.ok(a.diagnostic!.subjects!.includes('c1'));
  const b = rt.submit('converse', { actors: ['w1', 'w2'], at: [-15, -15] }); // centred on the test wall
  assert.equal(b.diagnostic?.code, 'converse.clearance');
  assert.match(b.diagnostic!.message, /test wall|wall/);
});

test('campfire_circle with 10 people: 8 take fire-circle places, 2 fail slot.none-free naming the fire; no violations', () => {
  const ids = Array.from({ length: 10 }, (_, i) => `f${i}`);
  const rt = setup(fixture('fire', 'campfire', -5, 4, 0, true), ...ids.map((id, i) => human(id, -9.5 + i, -1)));
  const g = rt.submit('campfire_circle', { actors: ids, fire: 'fire' });
  assert.equal(g.status, 'executing', g.diagnostic?.message);
  const kids = () => [...rt.records.values()].filter((r) => r.parent === g.id);
  const failed = kids().filter((k) => k.status === 'failed');
  assert.equal(failed.length, 2);
  for (const k of failed) {
    assert.equal(k.diagnostic?.code, 'slot.none-free');
    assert.ok(k.diagnostic!.subjects!.includes('fire'), k.diagnostic!.message);
  }
  const seated = () => kids().filter((k) => k.phase === 'occupied' && k.status === 'executing');
  assert.ok(runWhile(rt, () => seated().length < 8, 20 * 60), `seated ${seated().length}: ${kids().map((k) => `${k.id}:${k.status}/${k.phase} ${k.diagnostic?.message ?? ''}`).join('; ')}`);
  const ring = fixtureSlots(rt, rt.world.entities.fire);
  for (const k of seated()) {
    const who = (k.params as { actor: string }).actor;
    assert.equal(H(rt, who).activity, 'warm');
    const s = ring.find((q) => Math.hypot(q.p[0] - p2(rt, who)[0], q.p[1] - p2(rt, who)[1]) < 0.05);
    assert.ok(s && s.claimedBy === k.id, `${who} stands on its claimed ring place`);
    assert.ok(Math.abs(angleDelta(rt.world.entities[who].pose.yaw, s!.yaw)) < 0.2);
  }
  assert.deepEqual(msgs(rt), []);
  rt.cancel(g.id);
  assert.equal(g.status, 'cancelled');
  for (const i of ids) { assert.equal(H(rt, i).activity, 'idle'); assert.equal(H(rt, i).task, undefined); }
  assert.ok(noClaims(rt, ids), 'no actor or slot reservations remain');
});

test('gather onto a place region with an audience layout: rows face the focus, nearest-first assignment', () => {
  const rt = setup(human('a1', -6, -12), human('a2', -5, -12), human('a3', -4, -12));
  (rt.world.regions.lawn as SocialRegion).layout = { focus: [-6, 0] };
  const slots = slotsOf(rt, 'lawn');
  assert.ok(Array.isArray(slots) && slots.length > 20);
  for (const s of slots) assert.ok(Math.abs(angleDelta(s.yaw, heading([-6 - s.p[0], 0 - s.p[1]]))) < 1e-9);
  const g = rt.submit('gather', { actors: ['a1', 'a2', 'a3'], region: 'lawn' });
  assert.equal(g.status, 'executing', g.diagnostic?.message);
  const kids = [...rt.records.values()].filter((r) => r.parent === g.id);
  assert.ok(runWhile(rt, () => kids.some((k) => k.phase !== 'occupied'), 20 * 60), kids.map((k) => `${k.status}/${k.phase}`).join(','));
  for (const id of ['a1', 'a2', 'a3']) assert.equal(H(rt, id).activity, 'watch');
  assert.deepEqual(msgs(rt), []);
});

test('ambient_wander: 6 people for 60 s, every target inside the region, 0 violations; a directed task claims a person and ambient lets go', () => {
  const ids = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'];
  const rt = setup(...ids.map((id, i) => human(id, -9 + (i % 3) * 3, -8 + Math.floor(i / 3) * 4)));
  const amb = rt.submit('ambient_wander', { actors: ids, region: 'lawn', seed: 7 });
  assert.equal(amb.status, 'executing', amb.diagnostic?.message);
  for (let i = 0; i < 20 * 60; i++) rt.step();
  const walks = [...rt.records.values()].filter((r) => r.parent === amb.id && r.verb === 'walk_to');
  assert.ok(walks.length >= 12, `only ${walks.length} walks`);
  for (const w of walks) {
    const q = w.params as { x: number; z: number };
    assert.ok(pointInPolygon([q.x, q.z], LAWN), `target (${q.x}, ${q.z}) outside the lawn`);
  }
  assert.ok(ids.every((id) => walks.some((w) => (w.params as { actor: string }).actor === id)), 'everyone wandered');
  assert.deepEqual(msgs(rt), []);
  // directed task: free w1 (cancels only its ambient walk, if any), then walk it away
  releaseForDirective(rt, 'w1');
  const d = rt.submit('walk_to', { actor: 'w1', x: -6, z: 2 });
  assert.equal(d.status, 'executing', d.diagnostic?.message);
  const before = walks.length;
  for (let i = 0; i < 20 * 15; i++) rt.step();
  const after = [...rt.records.values()].filter((r) => r.parent === amb.id && r.verb === 'walk_to' && (r.params as { actor: string }).actor === 'w1' && r.requestedTick > d.requestedTick);
  assert.equal(after.length, 0, 'ambient never touches w1 again');
  assert.ok([...rt.records.values()].filter((r) => r.parent === amb.id).length > before, 'the others keep wandering');
  rt.cancel(amb.id);
  assert.equal(amb.status, 'cancelled');
  assert.ok(ids.filter((i) => i !== 'w1').every((i) => rt.holder(`actor:${i}`).length === 0 && H(rt, i).activity === 'idle'));
  assert.deepEqual(msgs(rt), []);
});

test('determinism: gather + converse + ambient twice → same state hash', () => {
  const run = () => {
    const rt = setup(
      fixture('fire', 'campfire', -5, 4, 0, true),
      ...['f0', 'f1', 'f2'].map((id, i) => human(id, -7 + i, -0.5)),
      human('c1', 2, 3), human('c2', 3, 4.5),
      ...['w1', 'w2', 'w3'].map((id, i) => human(id, -9 + i * 3, -6)),
    );
    const recs: ActionRecord[] = [
      rt.submit('campfire_circle', { actors: ['f0', 'f1', 'f2'], fire: 'fire' }),
      rt.submit('converse', { actors: ['c1', 'c2'], duration: 5 }),
      rt.submit('ambient_wander', { actors: ['w1', 'w2', 'w3'], region: 'lawn', duration: 20 }),
    ];
    for (const r of recs) assert.equal(r.status, 'executing', r.diagnostic?.message);
    for (let i = 0; i < 20 * 30; i++) rt.step();
    assert.deepEqual(msgs(rt), []);
    return rt.stateHash();
  };
  assert.equal(run(), run());
});

// ---------- seat fixtures are obstacles; seats are reached through approach points ----------

const inFootprint = (rt: Runtime, id: string, p: Vec2) => pointInObb(p, entityFootprint(rt.world.entities[id]).obb);
const SEATED = new Set(['sit', 'sit-down', 'stand-up']);

test('seat fixtures and the campfire block walking: their grid cells are blocked (no phase needed); all 8 fire-circle places are standable', () => {
  const rt = setup(fixture('chair', 'camp-chair', -8, -5), fixture('bench', 'bench-6ft', -5, -5, 0.4), fixture('fire', 'campfire', -5, 4));
  const sp = rt.services.spatial as Spatial;
  sp.sync(rt.world);
  const g = sp.level(0)!;
  for (const id of ['chair', 'bench', 'fire']) {
    const f = entityFootprint(rt.world.entities[id]);
    assert.ok(f.y1 - f.y0 > 0.22, `${id} is taller than the step height`);
    for (const [u, v] of [[0, 0], [0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8], [0.8, 0.8], [-0.8, -0.8]]) {
      const q = add2(f.obb.c, rot2([u * f.obb.half[0], v * f.obb.half[1]], f.obb.yaw));
      const c = cellOf(g, q);
      assert.equal(g.free[c], 0, `${id} cell at (${q[0].toFixed(2)}, ${q[1].toFixed(2)}) is blocked`);
      assert.equal(g.blockers.get(c), id);
    }
  }
  const ring = fixtureSlots(rt, rt.world.entities.fire);
  assert.equal(ring.length, 8);
  for (const s of ring) {
    assert.ok(clearanceAt(g, s.p) >= HUMAN_RADIUS, `${s.id} has ${clearanceAt(g, s.p).toFixed(2)} m clearance`);
    assert.ok(!inFootprint(rt, 'fire', s.p));
  }
  assert.ok(fireRingRadius(1, 1) >= Math.SQRT1_2 + HUMAN_RADIUS, 'FIRE_RING rule keeps a body radius clear of the ring corner');
});

test('sitters walk around other chairs/benches (never inside another fixture footprint), sit down from the approach point, stand up back onto it; 0 violations', () => {
  const chairs = [-9, -8, -7, -6, -5].map((x, i) => fixture(`c${i}`, 'camp-chair', x, -5)); // a row: 0.45 m gaps, too tight to pass
  const rt = setup(...chairs, fixture('bench', 'bench-6ft', -7, -2.5, Math.PI), human('s1', -7, -8), human('s2', -7, 0), human('s3', -3, -5.2));
  const fixtures = [...chairs.map((c) => c.id), 'bench'];
  const recs = [
    rt.submit('sit', { actor: 's1', fixture: 'c2' }), // behind the row: must go round an end
    rt.submit('sit', { actor: 's2', fixture: 'bench' }), // behind the bench: must go round it
    rt.submit('sit', { actor: 's3', slot: 'c0#seat' }), // along the row to its far end
  ];
  for (const r of recs) assert.equal(r.status, 'executing', r.diagnostic?.message);
  const seatOf = (r: ActionRecord) => (r.params as { fixture?: string; slot?: string }).fixture ?? (r.params as { slot: string }).slot.split('#')[0];
  const check = () => {
    for (const r of recs) {
      const who = (r.params as { actor: string }).actor, p = p2(rt, who), act = H(rt, who).activity;
      for (const f of fixtures) {
        if (f === seatOf(r) && SEATED.has(act)) continue; // on (or moving onto / off) their own seat
        assert.ok(!inFootprint(rt, f, p), `tick ${rt.tick}: ${who} (${act}) is inside ${f} at (${p[0].toFixed(2)}, ${p[1].toFixed(2)})`);
      }
    }
  };
  let n = 0;
  while (recs.some((r) => r.phase !== 'occupied') && n++ < 20 * 60) { rt.step(); check(); }
  assert.ok(recs.every((r) => r.phase === 'occupied' && r.status === 'executing'), recs.map((r) => `${r.id} ${r.status}/${r.phase} ${r.diagnostic?.message ?? ''}`).join('; '));
  for (let i = 0; i < 20; i++) { rt.step(); check(); }
  for (const r of recs) {
    const who = (r.params as { actor: string }).actor;
    assert.ok(r.history.some((h) => h.phase === 'sit-down'), `${who} sat down through the approach point`);
    const slot = fixtureSlots(rt, rt.world.entities[seatOf(r)]).find((s) => s.claimedBy === r.id)!;
    assert.ok(slot, `${who} holds a seat of ${seatOf(r)}`);
    assert.ok(Math.hypot(p2(rt, who)[0] - slot.p[0], p2(rt, who)[1] - slot.p[1]) < 1e-6, `${who} is on ${slot.id}`);
    assert.equal(H(rt, who).activity, 'sit');
    assert.ok(Math.abs(angleDelta(rt.world.entities[who].pose.yaw, slot.yaw)) < 0.05);
  }
  assert.deepEqual(msgs(rt), [], 'seated people are exempt from collision.human-static on their own seat only by activity');
  const stands = recs.map((r) => rt.submit('stand', { actor: (r.params as { actor: string }).actor }));
  n = 0;
  while (stands.some((s) => s.status === 'executing') && n++ < 20 * 2) { rt.step(); check(); }
  for (const [i, s] of stands.entries()) {
    const who = (recs[i].params as { actor: string }).actor;
    assert.equal(s.status, 'completed');
    assert.equal(H(rt, who).activity, 'idle');
    for (const f of fixtures) assert.ok(!inFootprint(rt, f, p2(rt, who)), `${who} stood up off ${f}`);
  }
  assert.ok(noClaims(rt, ['s1', 's2', 's3']));
  for (let i = 0; i < 5; i++) rt.step();
  assert.deepEqual(msgs(rt), []);
});

test('a seat whose approach point is walled in front and behind is refused slot.unreachable naming the wall; nothing is reserved', () => {
  // a chair in the proving ground's 1 m passage, facing along the wall: 0.225 m to each wall face
  const rt = setup(fixture('gap', 'camp-chair', 15, -15, -Math.PI / 2), human('p1', 15, -12));
  const a = rt.submit('sit', { actor: 'p1', fixture: 'gap' });
  assert.equal(a.status, 'failed');
  assert.equal(a.diagnostic?.code, 'slot.unreachable');
  assert.ok(a.diagnostic!.subjects!.includes('passage-e') && a.diagnostic!.subjects!.includes('passage-w'), a.diagnostic!.message);
  assert.match(a.diagnostic!.message, /gap#seat .*passage east wall.*passage west wall/);
  assert.ok(noClaims(rt, ['p1']));
  const b = rt.submit('take_slot', { actor: 'p1', slot: 'gap#seat' });
  assert.equal(b.diagnostic?.code, 'slot.unreachable');
});
