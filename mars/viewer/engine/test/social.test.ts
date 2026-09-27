// Social / inhabited-scene regressions (spec §17, §28 "Reservation conflict", milestone H):
// slots, sit/stand, converse, gather/campfire_circle, ambient_wander on the proving ground's
// open ground, with the default invariants on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import { emptyWorld, human, addAll, FIXTURE } from '../world/factory.ts';
import { walkTo } from '../locomotion/walk.ts';
import { angleDelta, heading, type Vec2 } from '../core/math.ts';
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
  assert.equal(H(rt, 'p1').activity, 'sit');
  assert.ok(Math.hypot(p2(rt, 'p1')[0], p2(rt, 'p1')[1] + 5) < 0.05);
  assert.ok(Math.abs(angleDelta(rt.world.entities.p1.pose.yaw, Math.PI / 2)) < 0.05, 'faces the seat direction');
  // a directed task for a seated person is refused naming the social action (no automatic pre-emption)
  const w = rt.submit('walk_to', { actor: 'p1', x: -4, z: -5 });
  assert.equal(w.diagnostic?.code, 'reservation.conflict');
  assert.match(w.diagnostic!.message, /\(sit,/);
  const s = rt.submit('stand', { actor: 'p1' });
  assert.equal(s.status, 'executing', s.diagnostic?.message);
  assert.equal(a.status, 'cancelled');
  rt.step();
  assert.equal(s.status, 'completed');
  assert.equal(H(rt, 'p1').activity, 'idle');
  const e = rt.submit('sit', { actor: 'p2', fixture: 'chair' });
  assert.equal(e.diagnostic?.code, 'slot.none-free', 'p1 is still standing on the seat');
  assert.match(e.diagnostic!.message, /occupied by p1/);
  const off = rt.submit('walk_to', { actor: 'p1', x: -2, z: -6 });
  assert.ok(rt.runUntilIdle(20 * 20, [off.id]) && off.status === 'completed', off.diagnostic?.message);
  const d = rt.submit('sit', { actor: 'p2', fixture: 'chair' });
  assert.equal(d.status, 'executing', d.diagnostic?.message);
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
