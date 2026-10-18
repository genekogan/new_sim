// beds/1: a catalogue bed an adult fits on gets engine berths (catalog-adapter berthSlots); a body walks to it, lies down on
// the mattress through take_slot (activity lie or nap, seatHeight = the mattress top, head → feet along the berth) and gets
// up again to standing room beside it. Unfit beds (a crib, a bunk's upper berth, the bed inside a caravan or a tent, a
// carryable bassinet, a boat's berth) get no berths, so they are never offered.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assetFromDef, assetIdFor, berthSlots, BERTH_MAX_EDGE, type DefFacts } from './catalog-adapter.ts';
import { marsFactory, GREEN_FIELD_WORLD, type MarsEngine } from './engine.ts';
import { nextEntityPhysics, type WorldEditV1 } from './entity-physics.ts';

const bodySlot = (id: string, p: [number, number, number], yaw = 0) => ({ id, kind: 'bed', p, yaw, height: p[1], accepts: { tags: ['body'] }, capacity: 1 });
const def = (name: string, box: [number, number, number], slots: DefFacts['slots'], components: DefFacts['components'] = { bed: {} }): DefFacts =>
  ({ ref: `${name}@1`, hash: name.padEnd(64, '0').slice(0, 64), name, tags: [], layer: 'solid', components, box, slots });
// core-bed (furniture.json): a double, headboard at -z
const double = def('core-bed', [1.47, 0.96, 2.06], [bodySlot('bed-l', [-0.36, 0.5, -0.1]), bodySlot('bed-r', [0.36, 0.5, -0.1])]);

test('adapter: an adult-sized bed gets berths at its mattress top, head → feet; unfit beds get none', () => {
  const b = berthSlots(double);
  assert.deepEqual(b.map((s) => [s.id, s.kind, s.local, s.yaw, s.height, s.approachPolicy]),
    [['bed-l', 'berth', [-0.36, -0.1], 1.5708, 0.5, 'reachable/1'], ['bed-r', 'berth', [0.36, -0.1], 1.5708, 0.5, 'reachable/1']]);
  const bunk = def('core-bunk', [1.01, 1.8, 2.01], [bodySlot('lower', [0, 0.48, 0]), bodySlot('upper', [0, 1.43, 0])]);
  assert.deepEqual(berthSlots(bunk).map((s) => s.id), ['lower'], 'the upper bunk is out of reach from the floor');
  const hammock = def('hammock', [3.34, 1.8, 0.8], [bodySlot('hammock', [0, 0.8, 0], Math.PI / 2)], {});
  assert.deepEqual(berthSlots(hammock).map((s) => [s.id, s.yaw]), [['hammock', 0]], 'a hammock slung along x is lain on along x');
  for (const [unfit, why] of [
    [def('crib', [0.71, 1.259, 1.31], [bodySlot('crib', [0, 0.45, 0])]), 'too short for an adult'],
    [def('bassinet', [0.608, 1.075, 1.005], [bodySlot('bassinet', [0, 0.7, 0.05])], { carryable: {} }), 'carryable'],
    [def('caravan', [2.44, 2.57, 4.914], [bodySlot('bed', [0, 0.75, -1.6])], { place: {} }), 'inside the caravan shell'],
    [def('tent', [1.981, 1.33, 2.5], [bodySlot('sleep', [0, 0.1, -0.3])], { bed: {}, place: {} }), 'inside the tent'],
    [def('narrowboat', [2.12, 2.6, 14.02], [bodySlot('berth', [0, 0.6, -2.5])], { carrier: {}, place: {}, hover: {} }), 'afloat'],
  ] as const) assert.deepEqual(berthSlots(unfit), [], `${unfit.name}: ${why}`);
  assert.ok(BERTH_MAX_EDGE >= 0.5675, 'the hospital bed (berth 0.57 m from its side) still qualifies');
});

test('adapter: a bed with berths gets a new asset identity; a bed without keeps its old one', () => {
  const { ref, hash, box } = double;
  assert.notEqual(assetIdFor(double, '{}'), assetIdFor({ ref, hash, box }, '{}'));
  const crib = def('crib', [0.71, 1.259, 1.31], [bodySlot('crib', [0, 0.45, 0])]);
  assert.equal(assetIdFor(crib, '{}'), assetIdFor({ ref: crib.ref, hash: crib.hash, box: crib.box }, '{}'));
  assert.deepEqual(assetFromDef('crib-asset', crib).slots ?? [], []);
  assert.deepEqual(assetFromDef('bed-asset', double).slots!.map((s) => s.kind), ['berth', 'berth']);
});

async function bedroom(name: string, n: number) {
  const f = await marsFactory(GREEN_FIELD_WORLD), e = f.create(f.genesis(name)) as unknown as MarsEngine;
  for (let i = 0; i < n; i++) e.spawnHuman({ id: `h_bed00000${i}`, label: `Sleeper ${i}`, soul: `s_bed00000${i}` });
  const at = e.world.entities.h_bed000000.pose.p, c: [number, number] = [at[0] + 3, at[2] - 2];
  const id = assetIdFor(double, '{}');
  const edit: WorldEditV1 = { contract: 'world-edit/1', seq: 1, hash: '', levels: [], assets: { [id]: assetFromDef(id, double) },
    set: { bed: { fixture: { def: id, kind: 'fixture', label: 'double bed', p: [c[0], 0, c[1]], yaw: 0.3 } } } };
  edit.hash = nextEntityPhysics(undefined, edit).hash;
  e.applyWorldEditV1(edit);
  return e;
}
const lie = (actor: string, activity = 'lie', seconds = 2) => ({ actor, label: `${activity} on the bed`,
  steps: [{ verb: 'mars:take_slot', params: { owner: 'bed', activity } }, { verb: 'rest', params: { seconds } }, { verb: 'stand', params: {} }] });
const until = (e: MarsEngine, ok: () => boolean, max = 4000) => { for (let i = 0; i < max && !ok(); i++) e.step(); return ok(); };

test('engine: a body walks to the bed, lies on its berth at mattress height head → feet, then gets up beside it', async () => {
  const e = await bedroom('berth-lie', 1), h = () => e.world.entities.h_bed000000;
  assert.equal(e.canPerform(lie('h_bed000000')), null);
  assert.equal(e.perform(lie('h_bed000000')).ok, true);
  assert.ok(until(e, () => h().human?.activity === 'lie'), `lies down (activity ${h().human?.activity})`);
  until(e, () => (h().human as { berth?: string }).berth !== undefined && Math.hypot(h().pose.p[0] - e.world.entities.bed.pose.p[0], h().pose.p[2] - e.world.entities.bed.pose.p[2]) < 0.5);
  const held = e.seatOccupantsV1('bed', 'berth');
  assert.equal(held.length, 1);
  assert.equal(held[0].body, 'h_bed000000');
  const hu = h().human as { berth?: string; seatHeight?: number };
  assert.equal(hu.seatHeight, 0.5, 'lies at the mattress top');
  assert.equal(hu.berth, `bed#${held[0].slot}`);
  // the body lies along the bed: its yaw is the bed's yaw + the berth's (head → feet, +z of the bed)
  const yawOff = () => Math.abs(Math.atan2(Math.sin(h().pose.yaw - (0.3 + Math.PI / 2)), Math.cos(h().pose.yaw - (0.3 + Math.PI / 2))));
  assert.ok(until(e, () => yawOff() < 0.05), `lies along the bed (yaw off by ${yawOff().toFixed(2)})`);
  assert.ok(until(e, () => h().human?.activity === 'idle' && !(h().human as { berth?: string }).berth), 'gets up after the rest');
  const b = e.world.entities.bed.pose.p, off = [h().pose.p[0] - b[0], h().pose.p[2] - b[2]];
  const local = [off[0] * Math.cos(0.3) - off[1] * Math.sin(0.3), off[0] * Math.sin(0.3) + off[1] * Math.cos(0.3)];
  assert.ok(Math.abs(local[0]) > 0.735 || Math.abs(local[1]) > 1.03, `stands beside the bed, not on it (local ${local.map((v) => v.toFixed(2))})`);
  assert.equal((h().human as { seatHeight?: number }).seatHeight, undefined);
  assert.deepEqual(e.seatOccupantsV1('bed', 'berth'), []);
  assert.deepEqual(e.runtime.violations, []);
});

test('engine: two share the double bed, a third finds it full; a berth is not sat on; nap is lain asleep', async () => {
  const e = await bedroom('berth-share', 3);
  assert.equal(e.perform(lie('h_bed000000', 'lie', 30)).ok, true);
  assert.equal(e.perform(lie('h_bed000001', 'nap', 30)).ok, true);
  assert.ok(until(e, () => e.world.entities.h_bed000000.human?.activity === 'lie' && e.world.entities.h_bed000001.human?.activity === 'nap'));
  assert.deepEqual(e.seatOccupantsV1('bed', 'berth').map((o) => o.body).sort(), ['h_bed000000', 'h_bed000001']);
  const full = e.canPerform(lie('h_bed000002'));
  assert.equal(full?.code, 'slot.none-free', JSON.stringify(full));
  const sit = e.canPerform({ actor: 'h_bed000002', label: 'sit on the bed', steps: [{ verb: 'mars:take_slot', params: { owner: 'bed', activity: 'sit' } }] });
  assert.ok(sit && ['slot.wrong-activity', 'slot.none-free'].includes(sit.code), JSON.stringify(sit));
  assert.deepEqual(e.runtime.violations, []);
});

// beds/3: an upstairs berth is lain on at its own floor's height + the mattress (seatHeight is the mattress above that floor,
// never the floor height again), and the body stands up on that floor. (Hotel room 201 is the third storey, level y 6.27;
// the suspected "drawn one floor too high" was a shot camera aimed into room 101.)
test('engine: an upstairs bed is lain on at that floor + the mattress top, then stood up beside on that floor', async () => {
  const f = await marsFactory(GREEN_FIELD_WORLD), e = f.create(f.genesis('berth-upstairs')) as unknown as MarsEngine;
  const id = assetIdFor(double, '{}');
  const edit: WorldEditV1 = { contract: 'world-edit/1', seq: 1, hash: '', levels: [{ id: 1, y: 3, label: 'upstairs' }],
    assets: { [id]: assetFromDef(id, double) }, set: {
      upper: { surfaces: [{ id: 'upper-floor', level: 1, y: 3, obb: { c: [4, 0], half: [4, 4], yaw: 0 } }] },
      stairs: { links: [{ id: 'upstairs-flight', kind: 'stairs', from: { level: 0, p: [7, 3], y: 0 }, to: { level: 1, p: [7, -2], y: 3 },
        heading: -Math.PI / 2, width: 1.2, usable: true, path: Array.from({ length: 21 }, (_, i) => [7, 3 * i / 20, 3 - 5 * i / 20]) }] },
      bed: { fixture: { def: id, kind: 'fixture', label: 'upstairs bed', p: [3, 3, 0], yaw: 0 } },
    } };
  edit.hash = nextEntityPhysics(undefined, edit).hash;
  e.applyWorldEditV1(edit);
  e.spawnHuman({ id: 'h_bed000000', label: 'Sleeper', soul: 's_bed000000' });
  const h = () => e.world.entities.h_bed000000, hu = () => h().human as { berth?: string; seatHeight?: number; level?: number; activity?: string };
  assert.equal(e.canPerform(lie('h_bed000000', 'lie', 3)), null);
  assert.equal(e.perform(lie('h_bed000000', 'lie', 3)).ok, true);
  assert.ok(until(e, () => hu().activity === 'lie' && hu().berth !== undefined), `lies down upstairs (activity ${hu().activity})`);
  assert.equal(hu().level, 1);
  assert.equal(hu().seatHeight, 0.5, 'seatHeight is the mattress above its own floor, not the floor height');
  assert.ok(until(e, () => Math.abs(h().pose.p[1] - 3) < 1e-6), `the body's pose stands on the upper floor (y ${h().pose.p[1]})`);
  assert.ok(until(e, () => hu().activity === 'idle' && !hu().berth), 'gets up after the rest');
  assert.equal(hu().level, 1);
  assert.ok(Math.abs(h().pose.p[1] - 3) < 1e-6, `stands on the upper floor (y ${h().pose.p[1]})`);
  assert.deepEqual(e.runtime.violations, []);
});
