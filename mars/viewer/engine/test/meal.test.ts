// Tables, hand-held items and eating together (owner feedback §12, ITEMS.md): catalog geometry, the
// meal scenario (4 people take a bowl + spoon, serve, sit round the fire, eat until empty), eating
// inside a converse, the refusals, and mid-eat resumability. Default invariants on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import { addAll, emptyWorld, FIXTURE, human } from '../world/factory.ts';
import { CATALOG } from '../world/catalog.ts';
import { TABLE_TOP } from '../world/catalog-items.ts';
import type { Entity } from '../world/types.ts';
import { createRegistry } from '../api/registry.ts';
import { slotById } from '../social/slots.ts';
import { bodyFrame, chestPoint, dist3, mouthPoint, SEAT_DROP, shoulderPoint, BODY, type Hand } from '../items/body.ts';
import { EAT_CYCLE, EAT_PHASES } from '../items/actions.ts';
import { followHand, itemEntity, placeOnSlot, putInHand, surfaceSlot, surfaceSlotsOf } from '../items/model.ts';
import { mealRegistry, mealRuntime, mealWorld, runMeal } from '../scenarios/meal.ts';

const fixture = (id: string, def: string, x: number, z: number, yaw = 0): Entity => ({ id, def, kind: 'fixture', pose: { p: [x, 0, z], yaw }, provenance: FIXTURE });

function setup(extra: Parameters<typeof provingGround>[0] = {}, ...es: Entity[]) {
  const base = provingGround(extra);
  const w = addAll(emptyWorld('proving-ground', base), ...es);
  return new Runtime(w, mealRegistry(), { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
}
/** Put item `id` on table `t` slot `slot` (world set-up, not an action). */
function onTable(rt: Runtime, id: string, def: string, t: string, slot: string, contents?: { food: string; fraction: number }) {
  const e = itemEntity(id, def, [0, 0, 0], 0, { contents });
  rt.world.entities[id] = e;
  const s = surfaceSlot(rt.world, `${t}#${slot}`);
  if ('code' in s) throw new Error(s.message);
  placeOnSlot(e, s, rt.world.entities[t].pose.yaw);
  return e;
}
/** Give `actor` item `id` in `hand` (world set-up). */
function inHandOf(rt: Runtime, actor: string, id: string, def: string, hand: Hand, contents?: { food: string; fraction: number }) {
  const e = itemEntity(id, def, [0, 0, 0], 0, { contents });
  rt.world.entities[id] = e;
  putInHand(e, actor, hand);
  followHand(e, rt.world.entities[actor].pose.p, 0);
  return e;
}
const msgs = (rt: Runtime) => rt.violations.map((v) => `${v.tick} ${v.code} ${v.message}`);

test('items: verbs are registered in the one engine registry; catalog table + small items', () => {
  const reg = createRegistry();
  for (const v of ['take_item', 'put_item', 'serve', 'eat', 'hold_items']) assert.ok(reg.has(v), v);
  const t = CATALOG['table-6ft'];
  assert.ok(t.obstacle);
  assert.ok(Math.abs(t.size[0] - 1.8288) < 1e-9 && t.size[1] === TABLE_TOP && t.size[2] === 0.75);
  assert.equal(t.surfaceSlots!.length, 18);
  for (const s of t.surfaceSlots!) {
    assert.equal(s.local[1], 0.75);
    assert.ok(Math.abs(s.local[0]) < t.size[0] / 2 && Math.abs(s.local[2]) < t.size[2] / 2, s.id);
  }
  const xs = [...new Set(t.surfaceSlots!.map((s) => s.local[0]))].sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) assert.ok(Math.abs(xs[i] - xs[i - 1] - 0.3) < 1e-9);
  for (const id of ['bowl', 'spoon', 'plate', 'cup', 'pot']) {
    const d = CATALOG[id];
    assert.equal(d.category, 'item');
    assert.equal(d.handling?.hands, 1);
    assert.equal(d.handling?.small, true);
    assert.ok(id === 'pot' ? Math.abs(d.massKg - 4) < 1e-9 : d.massKg <= 1, id);
  }
  // items on a table are not rasterised; a tall item (the pot) on the ground is an obstacle, a bowl never is (below the step)
  const rt = setup({}, fixture('t', 'table-6ft', -6, -6), human('p', -6, -8));
  onTable(rt, 'b', 'bowl', 't', 'r0c0');
  const pot = onTable(rt, 'pot', 'pot', 't', 'r1c2');
  const sp = rt.services.spatial as Spatial;
  sp.sync(rt.world);
  const ids = sp.scene.obstacles.map((o) => o.id);
  assert.ok(ids.includes('t') && !ids.includes('b') && !ids.includes('pot'));
  pot.pose.p = [-8, 0, -8];
  pot.support = { kind: 'ground' };
  pot.phase = 'staged';
  sp.sync(rt.world);
  assert.ok(sp.scene.obstacles.some((o) => o.id === 'pot'));
  assert.ok(surfaceSlotsOf(rt.world, 't').every((s) => Math.abs(s.p[1] - 0.75) < 1e-12));
});

// ---- the meal ----

/**
 * Pinned against walk_to at e09a961 (a walk.ts / turning change re-pins this with the reason in
 * PLANNING_BUDGET.md, like every other pin). Re-pinned (was 689 ticks, baf84de6…ccbfd): splined turns +
 * immediate block reaction, 2026-09-28; same meal (5 cycles each, all seated, bowls and pot empty).
 * 631 ticks = 31.55 s.
 */
const MEAL_TICKS = 631;
const MEAL_HASH = '9dae86bfd31ef8331c5930d345c7ceace5bd2f7a8a247ab02462c262f4a70f87';

test('meal: four people take bowl + spoon, serve, sit round the fire and eat together until the bowls are empty', () => {
  const rt = mealRuntime();
  let eatTicks = 0, mouthMoments = 0, seatedChecked = 0;
  const cycles: Record<string, number> = {};
  const recs = runMeal(rt, {
    onTick(rt) {
      for (const id of ['p1', 'p2', 'p3', 'p4']) {
        const a = rt.world.entities[id];
        const h = a.human!;
        if (h.activity !== 'eat') continue;
        eatTicks++;
        assert.equal(h.baseActivity, 'sit', `${id} eats seated`);
        const hold = rt.holder(`actor:${id}`).map((r) => rt.records.get(r)!.verb);
        assert.deepEqual(hold, ['sit'], `${id} is still held by its sit while eating`);
        const b = bodyFrame(a, SEAT_DROP);
        const bowl = Object.values(rt.world.entities).find((e) => e.def === 'bowl' && e.support?.kind === 'in-hand' && e.support.by === id)!;
        const bh = (bowl.support as { hand: Hand }).hand, sh: Hand = bh === 'left' ? 'right' : 'left';
        const bp = h.hands![bh]!, spn = h.hands![sh]!;
        assert.ok(dist3(bp, chestPoint(b)) <= 0.4 + 1e-9, `${id} bowl hand ${dist3(bp, chestPoint(b)).toFixed(3)} m from the chest at tick ${rt.tick}`);
        assert.ok(dist3(spn, shoulderPoint(b, sh)) <= BODY.armReach + 1e-9, `${id} spoon hand ${dist3(spn, shoulderPoint(b, sh)).toFixed(3)} m from the shoulder at tick ${rt.tick}`);
        if (dist3(spn, mouthPoint(b)) < 1e-9) mouthMoments++;
        // the bowl rides on its hand
        assert.ok(Math.abs(bowl.pose.p[1] - bp[1]) < 1e-9 && Math.abs(bowl.pose.p[0] - bp[0]) < 1e-9);
        // seated exactly on the chair's seat
        const sit = rt.records.get(rt.holder(`actor:${id}`)[0])!;
        const slot = slotById(rt, (sit.params as { slot: string }).slot);
        assert.ok(!('code' in slot) && Math.abs(a.pose.p[0] - slot.p[0]) < 1e-9 && Math.abs(a.pose.p[2] - slot.p[1]) < 1e-9);
        seatedChecked++;
      }
    },
  });
  assert.deepEqual(msgs(rt), []);
  for (const [id, rs] of Object.entries(recs)) {
    const eat = rs[rs.length - 1];
    assert.equal(eat.verb, 'eat');
    assert.equal(eat.status, 'completed', `${id}: ${eat.diagnostic?.message}`);
    cycles[id] = (eat.outputs as { cycles: number }).cycles;
    assert.equal(cycles[id], 5, `${id} empties the bowl in 5 cycles`);
    const serve = rs.find((r) => r.verb === 'serve')!;
    assert.deepEqual((serve.outputs as { bowl: unknown }).bowl, { food: 'stew', fraction: 1 });
  }
  for (const b of ['bowl1', 'bowl2', 'bowl3', 'bowl4']) assert.equal(rt.world.entities[b].contents?.fraction, 0, b);
  assert.equal(rt.world.entities.pot.contents?.fraction, 0);
  assert.ok(seatedChecked > 0 && eatTicks === seatedChecked);
  // 4 eaters × (ready + 5 cycles + lower) ticks, less the last tick of each (activity back to sit)
  assert.equal(eatTicks, 4 * (Math.round((5 * EAT_CYCLE + EAT_PHASES.ready + EAT_PHASES.lower) * 20) - 1));
  assert.equal(mouthMoments, 4 * 5 * Math.round(EAT_PHASES.pause * 20) + 4 * 5, 'the spoon is at the mouth through every pause (and the last lift tick)');
  // everyone still seated, still holding bowl + spoon, hands published in the seated carry pose
  for (const id of ['p1', 'p2', 'p3', 'p4']) {
    const h = rt.world.entities[id].human!;
    assert.equal(h.activity, 'sit');
    assert.equal(h.baseActivity, undefined);
    assert.ok(h.hands?.left && h.hands.right);
    assert.ok(Math.abs(h.hands.left[1] - (1.0 - SEAT_DROP)) < 1e-9);
  }
  assert.equal(rt.tick, MEAL_TICKS);
  assert.equal(rt.stateHash(), MEAL_HASH);
  // determinism: a second run from the same world is identical
  const rt2 = mealRuntime();
  runMeal(rt2);
  assert.equal(rt2.stateHash(), rt.stateHash());
});

test('meal: eat is resumable mid-cycle — snapshot, JSON round-trip, restore; both continue to the same state', () => {
  const rt = mealRuntime();
  let snapAt = -1;
  let snap: ReturnType<Runtime['snapshot']> | undefined;
  try {
    runMeal(rt, {
      onTick(rt) {
        const eating = ['p1', 'p2', 'p3', 'p4'].filter((id) => rt.world.entities[id].human!.activity === 'eat');
        if (!snap && eating.length >= 2) { snap = rt.snapshot(); snapAt = rt.tick; throw new Error('stop'); }
      },
    });
  } catch (e) {
    assert.equal((e as Error).message, 'stop');
  }
  assert.ok(snap && snapAt > 0);
  const eats = [...rt.records.values()].filter((r) => r.verb === 'eat' || r.verb === 'hold_items').map((r) => r.id);
  const other = Runtime.restore(JSON.parse(JSON.stringify(snap)), mealRegistry(), { spatial: new Spatial(provingGround()) }, DEFAULT_INVARIANTS);
  assert.equal(other.stateHash(), rt.stateHash());
  for (let i = 0; i < 400; i++) { rt.step(); other.step(); }
  assert.equal(other.stateHash(), rt.stateHash());
  assert.deepEqual(msgs(other), []);
  assert.ok(eats.length >= 4);
});

test('eat inside a converse: two standing people talk and eat; activity eat over base talk, converse keeps them', () => {
  const rt = setup({}, fixture('t', 'table-6ft', -6, -8), human('a', -6.6, -9.2, { yaw: Math.PI / 2 }), human('b', -5.4, -9.2, { yaw: Math.PI / 2 }));
  onTable(rt, 'bowlA', 'bowl', 't', 'r0c1', { food: 'stew', fraction: 0.6 });
  onTable(rt, 'spoonA', 'spoon', 't', 'r0c0');
  onTable(rt, 'bowlB', 'bowl', 't', 'r0c4', { food: 'stew', fraction: 1 });
  onTable(rt, 'spoonB', 'spoon', 't', 'r0c5');
  const takes = [
    rt.submit('take_item', { actor: 'a', item: 'bowlA', hand: 'left' }),
    rt.submit('take_item', { actor: 'b', item: 'bowlB', hand: 'right' }),
  ];
  for (const r of takes) assert.equal(r.status, 'executing', r.diagnostic?.message);
  rt.runUntilIdle(400, takes.map((r) => r.id));
  const takes2 = [
    rt.submit('take_item', { actor: 'a', item: 'spoonA', hand: 'right' }),
    rt.submit('take_item', { actor: 'b', item: 'spoonB', hand: 'left' }),
  ];
  for (const r of takes2) assert.equal(r.status, 'executing', r.diagnostic?.message);
  rt.runUntilIdle(400, takes2.map((r) => r.id));
  for (const r of [...takes, ...takes2]) assert.equal(r.status, 'completed', r.diagnostic?.message);
  const talk = rt.submit('converse', { actors: ['a', 'b'], at: [-6, -10.4] });
  assert.equal(talk.status, 'executing', talk.diagnostic?.message);
  let n = 0;
  while (!(rt.world.entities.a.human!.activity === 'talk' && rt.world.entities.b.human!.activity === 'talk') && n++ < 400) rt.step();
  const ea = rt.submit('eat', { actor: 'a', bowl: 'bowlA', spoon: 'spoonA' });
  const eb = rt.submit('eat', { actor: 'b', bowl: 'bowlB', spoon: 'spoonB', cycles: 2 });
  assert.equal(ea.status, 'executing', ea.diagnostic?.message);
  assert.equal(eb.status, 'executing', eb.diagnostic?.message);
  rt.step();
  for (const id of ['a', 'b']) {
    const h = rt.world.entities[id].human!;
    assert.equal(h.activity, 'eat');
    assert.equal(h.baseActivity, 'talk');
    assert.equal(rt.holder(`actor:${id}`)[0], talk.id);
  }
  rt.runUntilIdle(600, [ea.id, eb.id]);
  assert.equal(ea.status, 'completed');
  assert.equal((ea.outputs as { cycles: number }).cycles, 3, '0.6 of a bowl = 3 spoonfuls');
  assert.equal(eb.status, 'completed');
  assert.equal((eb.outputs as { cycles: number }).cycles, 2);
  assert.ok(Math.abs(rt.world.entities.bowlB.contents!.fraction - 0.6) < 1e-9);
  rt.step();
  assert.equal(rt.world.entities.a.human!.activity, 'talk');
  assert.equal(rt.isActive(talk.id), true);
  rt.cancel(talk.id);
  // put the bowl back on the table (walks to the edge first), the other on the ground
  const put = rt.submit('put_item', { actor: 'a', item: 'bowlA', surfaceSlot: 't#r0c2' });
  assert.equal(put.status, 'executing', put.diagnostic?.message);
  rt.runUntilIdle(400, [put.id]);
  assert.equal(put.status, 'completed', put.diagnostic?.message);
  assert.deepEqual(rt.world.entities.bowlA.support, { kind: 'resting-on', on: 't', slot: 'r0c2' });
  assert.ok(Math.abs(rt.world.entities.bowlA.pose.p[1] - 0.75) < 1e-9);
  const g = rt.submit('put_item', { actor: 'b', item: 'spoonB', surfaceSlot: 'ground' });
  assert.equal(g.status, 'executing', g.diagnostic?.message);
  rt.runUntilIdle(100, [g.id]);
  assert.deepEqual(rt.world.entities.spoonB.support, { kind: 'ground' });
  assert.equal(rt.world.entities.spoonB.pose.p[1], 0);
  assert.equal(rt.world.entities.b.human!.hands?.left, undefined, 'the emptied hand is no longer published');
  assert.deepEqual(msgs(rt), []);
});

test('items refusals: out of reach, hand full, held by someone else, not hand-held, eat while walking, empty bowl, occupied slot, occupied chair', () => {
  const rt = setup({}, fixture('t', 'table-6ft', -6, -8), fixture('chair', 'camp-chair', -3, -4), human('p', -6, -10.5, { yaw: Math.PI / 2 }), human('q', -6, -6.5), human('r', -3, -6));
  onTable(rt, 'pot', 'pot', 't', 'r1c2', { food: 'stew', fraction: 1 });
  onTable(rt, 'b2', 'bowl', 't', 'r0c3');
  onTable(rt, 'b3', 'bowl', 't', 'r0c4');
  inHandOf(rt, 'p', 'b1', 'bowl', 'left', { food: 'stew', fraction: 0 });
  inHandOf(rt, 'q', 'bq', 'bowl', 'left', { food: 'stew', fraction: 0.4 });
  inHandOf(rt, 'q', 'sq', 'spoon', 'right');
  // serve with the pot 2 m away (the person has not walked to the table)
  const far = rt.submit('serve', { actor: 'p', pot: 'pot', bowl: 'b1' });
  assert.equal(far.status, 'failed');
  assert.equal(far.diagnostic?.code, 'item.out-of-reach');
  assert.match(far.diagnostic!.message, /p at \(-6\.00, -10\.50\) is 2\.\d\d m from pot \(on t#r1c2\); reach 1\.10 m/);
  // a second item into the full left hand
  const full = rt.submit('take_item', { actor: 'p', item: 'b2', hand: 'left' });
  assert.equal(full.diagnostic?.code, 'item.hand-full');
  assert.match(full.diagnostic!.message, /p's left hand already holds b1/);
  // someone else's bowl; a chair
  assert.equal(rt.submit('take_item', { actor: 'p', item: 'bq', hand: 'right' }).diagnostic?.code, 'item.held-by');
  const chair = rt.submit('take_item', { actor: 'p', item: 'chair', hand: 'right' });
  assert.equal(chair.diagnostic?.code, 'item.not-handheld');
  assert.match(chair.diagnostic!.message, /folding camp chair, not a small hand-held item/);
  // eat with an empty bowl
  inHandOf(rt, 'p', 's1', 'spoon', 'right');
  assert.equal(rt.submit('eat', { actor: 'p', bowl: 'b1', spoon: 's1' }).diagnostic?.code, 'eat.bowl-empty');
  // eating while walking
  const walk = rt.submit('walk_to', { actor: 'q', x: -3, z: -8 });
  assert.equal(walk.status, 'executing', walk.diagnostic?.message);
  rt.step();
  const ew = rt.submit('eat', { actor: 'q', bowl: 'bq', spoon: 'sq' });
  assert.equal(ew.status, 'failed');
  assert.equal(ew.diagnostic?.code, 'eat.not-still');
  assert.match(ew.diagnostic!.message, new RegExp(`q is walking \\(walk_to ${walk.id}\\)`));
  rt.cancel(walk.id);
  // put onto an occupied slot
  const occ = rt.submit('put_item', { actor: 'p', item: 'b1', surfaceSlot: 't#r0c3' });
  assert.equal(occ.diagnostic?.code, 'item.slot-occupied');
  assert.match(occ.diagnostic!.message, /t#r0c3 already has b2 on it/);
  // two sitters, one chair: the existing reservation conflict
  const s1 = rt.submit('sit', { actor: 'r', slot: 'chair#seat' });
  assert.equal(s1.status, 'executing', s1.diagnostic?.message);
  const s2 = rt.submit('sit', { actor: 'q', slot: 'chair#seat' });
  assert.equal(s2.diagnostic?.code, 'reservation.conflict');
  assert.match(s2.diagnostic!.message, /slot:chair#seat .*\(sit,/);
});

test('take_item: an item out of reach behind a wall is refused item.unreachable naming the wall', () => {
  // table along the proving-ground wall (x = −15 ± 0.15, z −19…−11), long axis along z, local +z side facing the wall
  const rt = setup({}, fixture('t', 'table-6ft', -14.425, -15, Math.PI / 2), human('p', -12, -15));
  onTable(rt, 'far', 'bowl', 't', 'r2c2'); // 0.075 m from the wall-side edge, 0.675 m from the open side
  onTable(rt, 'near', 'bowl', 't', 'r0c2');
  const r = rt.submit('take_item', { actor: 'p', item: 'far', hand: 'left' });
  assert.equal(r.status, 'failed');
  assert.equal(r.diagnostic?.code, 'item.unreachable');
  assert.ok(r.diagnostic!.subjects!.includes('wall'), r.diagnostic!.message);
  assert.match(r.diagnostic!.message, /blocked by wall \(test wall\)/);
  // the near-row bowl on the open side is fine
  const ok = rt.submit('take_item', { actor: 'p', item: 'near', hand: 'left' });
  assert.equal(ok.status, 'executing', ok.diagnostic?.message);
  rt.runUntilIdle(400, [ok.id]);
  assert.equal(ok.status, 'completed', ok.diagnostic?.message);
  assert.deepEqual(rt.world.entities.near.support, { kind: 'in-hand', by: 'p', hand: 'left' });
  // reach phase: the hand point went to the bowl; it now rides at the carry point
  const h = rt.world.entities.p.human!;
  assert.ok(h.hands?.left && !h.hands.right);
  assert.deepEqual(msgs(rt), []);
  // the world set-up helper is what scenarios use too
  assert.ok(mealWorld().entities.pot.contents?.fraction === 1);
});
