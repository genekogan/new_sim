// Lane L9 (spec eden4/31 B2/B3): Souls among god-built things, through the real host, sequencer, edge ledger and
// compiler. The god builds a two-floor house (door, stairs, a chair and a table with a bowl upstairs); a Soul born
// through the owner flow enters, climbs, sits; the god cannot remove the chair under it; the Soul picks up the bowl
// (the journal shows the engine's move), puts it on the table, prays; replay from genesis agrees.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { kernelHash } from '@sim/kernel';
import { coreRef } from '@sim/world-compiler';
import { fixture, invite, accept, factory, seed } from '../../test/native-owner-fixture.ts';
import { WorldHost } from '../world.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';
import { runQuery } from './query.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
export const HOUSE_BATCH = (at: [number, number] = [10, 0]) => ({ ops: [
  { op: 'define', def: { schema: 'def/1', name: 'house2', version: 1, description: 'A two-floor house.', tags: ['building'], size: { box: [8, 6, 6] }, make: { kind: 'gen', gen: 'building/1' }, params: { floors: { type: 'int', min: 1, max: 6, default: 2 } }, state: { doors: { type: 'json', default: {} } }, components: { foundation: { kind: 'none' } } } },
  { op: 'place', tmp: '$h', def: 'house2@1', name: 'house', p: at },
  { op: 'place', def: coreRef('chair'), name: 'chair', in: { parent: '$h', slot: 'floor-1' }, p: [-2, 0, 1] },
  { op: 'place', tmp: '$t', def: coreRef('table'), name: 'table', in: { parent: '$h', slot: 'floor-1' }, p: [2, 0, 1] },
  { op: 'place', def: coreRef('bowl'), name: 'bowl', in: { parent: '$t', slot: 'top' } },
] });

async function world(dbFile = ':memory:') {
  const f = fixture(dbFile, factory, { durableClockV1: true });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  const bridge = installEngineBridge({ host: f.host, god, edge, log: () => {} });
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  return { ...f, god, edge, bridge, settle };
}

test('Souls among god-built things: enter, climb, sit, carry, pray; bodies refuse edits; replay agrees', { timeout: 600000 }, async (t) => {
  const w = await world();
  w.brain.quiesce();
  t.after(() => { w.brain.quiesce(); w.host.stop(); w.db.close(); });
  await w.settle(2);
  const r = w.god.act(HOUSE_BATCH(), 'two-floor house');
  assert.equal(r.accepted, true, JSON.stringify(r));
  await w.settle(3);
  const E = w.host.engine as any, ids = Object.fromEntries(['house', 'house/chair', 'house/table', 'house/table/bowl'].map((p) => [p, w.god.model.get(p)!.id]));
  const ep = E.world.entityPhysicsV1;
  assert.ok(ep?.byEntity[ids.house]?.solids?.length >= 5, 'walls');
  assert.ok(ep.byEntity[ids.house].surfaces.some((x: any) => x.level === 1), 'an upper floor');
  assert.equal(ep.byEntity[ids.house].links.length, 1, 'its own stairs (L2 building/1)');
  assert.ok(E.world.entities[ids['house/chair']]?.tags.includes('entity-world'), 'chair registered with the same id');
  assert.equal(E.world.entities[ids['house/table/bowl']]?.support?.kind, 'resting-on');
  // reach: from the lawn to the upstairs room, through the door and up the stairs
  const reach = runQuery(w.god.model, { reach: { from: [10, 9], to: 'house:floor-1' } }).reach as any;
  assert.equal(reach.reachable, true, JSON.stringify(reach)); assert.ok(reach.levels.includes(1));

  // a Soul born through the owner flow gets a body entity with the engine's id
  await invite(w, 'ana');
  const row: any = await accept(w.host, w.souls.create('dev:ana', { name: 'Ana', description: 'curious' }));
  await w.settle(3);
  const body = w.god.model.entities.get(row.entity_id);
  assert.ok(body && w.god.model.resolvedDef(body.def)?.components.body, 'body entity in the entity world');
  const soul = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  const caps = w.edge.capabilities(soul);
  for (const id of [`sit:${ids['house/chair']}`, `pick-up:${ids['house/table/bowl']}`, 'pray']) assert.ok(caps.some((c) => c.id === id), `${id} offered: ${caps.map((c) => c.id).slice(0, 30).join(' ')}`);

  const until = async (pred: () => boolean, n = 4000) => { for (let i = 0; i < n && !pred(); i++) { w.host.tickOnce(); if (i % 20 === 0) { await setImmediate(); w.host.drainInputs(); } } await w.settle(2); return pred(); };
  const sit: any = await accept(w.host, w.edge.act(soul, { capability: `sit:${ids['house/chair']}`, params: { seconds: 600 } }));
  assert.equal(sit.accepted, true, JSON.stringify(sit));
  assert.ok(await until(() => E.world.entities[row.entity_id].human.activity === 'sit'), 'seated');
  assert.equal(E.world.entities[row.entity_id].human.level, 1, 'upstairs');

  // the god cannot remove the chair (or the house around it) while Ana sits on it
  assert.deepEqual((runQuery(w.god.model, { entity: 'house/chair' }).entity as any).usedBy, { soul: 'Ana', body: row.entity_id, how: 'occupied', thing: 'house/chair' }, 'query shows who uses it');
  for (const id of [ids['house/chair'], ids.house]) {
    const no = w.god.act({ ops: [{ op: 'remove', id }] }) as any;
    assert.equal(no.accepted, false); assert.equal(no.failures[0].code, 'occupied.by-body'); assert.match(no.failures[0].detail, /Ana/);
  }
  // pick up the bowl: stand, walk to the table, take it; the journal shows the engine's move into her hands
  const pick: any = await accept(w.host, w.edge.act(soul, { capability: `pick-up:${ids['house/table/bowl']}` }));
  assert.equal(pick.accepted, true, JSON.stringify(pick));
  assert.ok(await until(() => E.world.entities[ids['house/table/bowl']].support?.kind === 'in-hand' && w.god.model.entities.get(ids['house/table/bowl'])!.in.parent === row.entity_id), 'carried, written back');
  const journal = w.god.store.edits(10);
  assert.ok(journal.some((e) => e.by === 'engine' && e.ops.some((o: any) => o.op === 'move' && o.id === ids['house/table/bowl'])), 'journaled by the engine');
  const held: any = w.god.act({ ops: [{ op: 'remove', id: ids['house/table/bowl'] }] });
  assert.equal(held.failures?.[0]?.code, 'held.by-body', JSON.stringify(held));
  // engine moves are not the god's to undo: undo reverts the god's last edit (the house), refused while she holds the bowl
  const undo: any = w.god.undo();
  assert.equal(undo.accepted, false); assert.match(undo.failures[0].code, /by-body/);
  // put it on the table
  const caps2 = w.edge.capabilities(soul);
  assert.ok(caps2.some((c) => c.id === `put-on:${ids['house/table']}`), 'put-on offered');
  const put: any = await accept(w.host, w.edge.act(soul, { capability: `put-on:${ids['house/table']}` }));
  assert.equal(put.accepted, true, JSON.stringify(put));
  assert.ok(await until(() => w.god.model.entities.get(ids['house/table/bowl'])!.in.parent === ids['house/table']), 'back on the table in the entity world');
  // pray, and the god answers
  const pray: any = await w.edge.act(soul, { capability: 'pray', params: { text: 'May the house have a garden?' } });
  assert.equal(pray.accepted, true, JSON.stringify(pray));
  const prayer = w.god.store.prayers({ unanswered: true })[0];
  assert.equal(prayer.soul_id, soul.soulId);
  const ans = w.god.act({ ops: [{ op: 'answer', prayer: prayer.id, text: 'Yes; look south tomorrow.' }] });
  assert.equal(ans.accepted, true);
  assert.equal(w.god.prayersFor(soul.soulId)[0].answer, 'Yes; look south tomorrow.');
  // close the door → the lawn cannot reach the house; open it → it can (the god edits a door with nobody in the way)
  const door = w.god.act({ ops: [{ op: 'set', id: ids.house, state: { doors: { 'front-door': 'closed' } } }] });
  assert.equal(door.accepted, true, JSON.stringify(door));
  await w.settle(3);
  assert.equal((runQuery(w.god.model, { reach: { from: [10, 9], to: 'house:ground' } }).reach as any).reachable, false, 'door closed');
  assert.equal(E.world.entities[row.entity_id].human.level, 1, 'Ana is untouched');
  assert.deepEqual(E.runtime.violations, []);

  // replay from genesis: the engine log alone re-derives the same world (entity physics included)
  w.host.drainInputs(); w.host.saveSnapshot(true);
  const head = { engine: w.host.engine.stateHash(), kernel: kernelHash(w.host.kernel), physics: E.world.entityPhysicsV1.hash };
  w.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(w.host.worldId);
  const h = new WorldHost(w.db, factory, seed, 1e9, w.host.worldId, { durableClockV1: true });
  assert.equal(h.boot().from, 'genesis');
  if (h.engine.stateHash() !== head.engine) {
    const a = (w.host.engine as any).world, b = (h.engine as any).world;
    for (const id of new Set([...Object.keys(a.entities), ...Object.keys(b.entities)])) if (JSON.stringify(a.entities[id]) !== JSON.stringify(b.entities[id])) console.log('DIFF', id, JSON.stringify(a.entities[id])?.slice(0, 600), '\n   vs', JSON.stringify(b.entities[id])?.slice(0, 600));
    console.log('ticks', a.tick, b.tick, 'programs', JSON.stringify((w.host.engine as any).snapshot().programs).slice(0, 300), JSON.stringify((h.engine as any).snapshot().programs).slice(0, 300));
  }
  assert.deepEqual({ engine: h.engine.stateHash(), kernel: kernelHash(h.kernel), physics: (h.engine as any).world.entityPhysicsV1.hash }, head, 'replay exact');
  h.stop();
});

test('a god edit that would bury a standing Soul lifts it clear, and says so', { timeout: 300000 }, async (t) => {
  const w = await world();
  w.brain.quiesce();
  t.after(() => { w.brain.quiesce(); w.host.stop(); w.db.close(); });
  await w.settle(2);
  await invite(w, 'bo');
  const row: any = await accept(w.host, w.souls.create('dev:bo', { name: 'Bo', description: 'stands still' }));
  await w.settle(3);
  const E = w.host.engine as any, b = E.world.entities[row.entity_id], at: [number, number] = [b.pose.p[0], b.pose.p[2]];
  const r: any = w.god.act({ ops: [{ op: 'place', def: coreRef('wall'), name: 'wall', p: at, params: { w: 4, h: 2.6, d: 0.5 } }] });
  assert.equal(r.accepted, true, JSON.stringify(r));
  assert.ok(r.warnings.some((x: string) => x.startsWith('body.lifted') && x.includes('Bo')), JSON.stringify(r.warnings));
  await w.settle(4);
  const p = E.world.entities[row.entity_id].pose.p;
  assert.ok(Math.abs(p[2] - at[1]) > 0.5 || Math.abs(p[0] - at[0]) > 2.2, `Bo stepped clear: ${p} (was ${at})`);
  assert.ok(E.clearanceAtV1(p[0], p[2]) >= 0.27, 'standing on clear ground');
  assert.deepEqual(E.runtime.violations, []);
  // retirement removes the body entity from the entity world
  assert.ok(w.god.model.entities.has(row.entity_id));
  await accept(w.host, w.souls.retire(w.db.soul(row.id)!));
  await w.settle(4);
  assert.equal(w.god.model.entities.has(row.entity_id), false, 'body entity archived');
});

test('L3 shapes in the engine: a garden wall makes Souls go round, a deck is walkable, a far road does not widen the raster', { timeout: 300000 }, async (t) => {
  const w = await world();
  w.brain.quiesce();
  t.after(() => { w.brain.quiesce(); w.host.stop(); w.db.close(); });
  await w.settle(2);
  const before = runQuery(w.god.model, { reach: { from: [0, 0], to: [0, 12] } }).reach as any;
  assert.equal(before.reachable, true, JSON.stringify(before));
  const r: any = w.god.act({ ops: [
    { op: 'place', def: coreRef('garden-wall'), name: 'wall', shape: { path: [[-12, 6], [12, 6]] }, params: { gates: 0 } },
    { op: 'place', def: coreRef('deck'), name: 'deck', shape: { area: [[-4, -18], [4, -18], [4, -12], [-4, -12]] } },
    { op: 'place', def: coreRef('road'), name: 'far-road', shape: { path: [[200, -100], [200, 100]] } },
  ] });
  if (!r.accepted) { t.diagnostic(JSON.stringify(r).slice(0, 600)); }
  assert.equal(r.accepted, true);
  await w.settle(3);
  const E = w.host.engine as any, ep = E.world.entityPhysicsV1;
  const wall = w.god.model.get('wall')!.id, deck = w.god.model.get('deck')!.id, road = w.god.model.get('far-road')!.id;
  assert.ok(ep.byEntity[wall]?.solids?.length, 'wall solids');
  assert.ok(ep.byEntity[deck]?.surfaces?.length, 'deck floor');
  assert.equal(ep.byEntity[road], undefined, 'a road is ground cover, not engine physics');
  assert.ok(!ep.bounds || ep.bounds.every((v: number) => Math.abs(v) <= 64), `raster bounded: ${ep.bounds}`);
  const after = runQuery(w.god.model, { reach: { from: [0, 0], to: [0, 12] } }).reach as any;
  assert.equal(after.reachable, true, JSON.stringify(after));
  assert.ok(after.length > before.length + 8, `goes round the wall: ${before.length} → ${after.length}`);
  const onDeck = runQuery(w.god.model, { reach: { from: [0, 0], to: 'deck' } }).reach as any;
  assert.equal(onDeck.reachable, true, JSON.stringify(onDeck));
  // a fence across the south field with one closed gate: Souls go round it; opening the gate lets them through
  const r2: any = w.god.act({ ops: [
    { op: 'place', def: coreRef('fence'), name: 'fence', shape: { path: [[-40, -22], [40, -22]] }, params: { gates: [{ at: 40, width: 1.6 }] } },
    { op: 'place', def: coreRef('footbridge'), name: 'span', shape: { path: [[20, -8], [20, 8]] } },
  ] });
  assert.equal(r2.accepted, true, JSON.stringify(r2).slice(0, 600));
  await w.settle(3);
  const fence = w.god.model.get('fence')!.id, span = w.god.model.get('span')!;
  const gate = (E.world.entityPhysicsV1.byEntity[fence]?.solids ?? []).find((x: any) => x.id.endsWith('#door:gate-1'));
  assert.ok(gate, 'closed gate blocks its gap');
  assert.ok(Math.abs(gate.y0 - w.god.model.terrain.sample(0, -22)) < 0.05 && gate.y1 - gate.y0 > 0.8, `gate stands on the ground: ${gate.y0}..${gate.y1}`);
  // the fence runs past both edges of the field, so a closed gate cuts the south strip off
  const shut = runQuery(w.god.model, { reach: { from: [0, -20], to: [0, -26] } }).reach as any;
  assert.equal(shut.reachable, false, `closed gate: ${JSON.stringify(shut).slice(0, 200)}`);
  const r3: any = w.god.act({ ops: [{ op: 'set', id: fence, params: { gates: [{ at: 40, width: 1.6, state: 'open' }] } }] });
  assert.equal(r3.accepted, true, JSON.stringify(r3).slice(0, 400));
  await w.settle(3);
  assert.ok(!(E.world.entityPhysicsV1.byEntity[fence]?.solids ?? []).some((x: any) => x.id.includes('#door:')), 'open gate: no blocker');
  const open = runQuery(w.god.model, { reach: { from: [0, -20], to: [0, -26] } }).reach as any;
  assert.equal(open.reachable, true, JSON.stringify(open));
  assert.ok(open.length < 12, `through the open gate: ${open.length}`);
  // a footbridge: deck quads on level 0 at their own (absolute) heights, rails block, the deck is reachable
  const sp = E.world.entityPhysicsV1.byEntity[span.id];
  t.diagnostic(`footbridge params.at=${JSON.stringify(span.params?.at)} surfaces=${sp?.surfaces?.length} rails=${sp?.solids?.length}`);
  assert.ok(sp?.surfaces?.length >= 2 && sp.surfaces.every((x: any) => x.level === 0), 'deck quads on level 0');
  const onSpan = runQuery(w.god.model, { reach: { from: [20, -12], to: [20, 0] } }).reach as any;
  assert.equal(onSpan.reachable, true, JSON.stringify(onSpan));
});

test('Souls in an L2 cottage: lawn → front door → stairs → bedroom chair; rooms are reach ends', { timeout: 300000}, async (t) => {
  const w = await world();
  w.brain.quiesce();
  t.after(() => { w.brain.quiesce(); w.host.stop(); w.db.close(); });
  await w.settle(2);
  const r: any = w.god.act({ ops: [
    { op: 'define', def: { schema: 'def/1', name: 'cottage2', version: 1, description: 'A two-floor cottage.', tags: ['building'], size: { box: [8, 6, 6] }, make: { kind: 'gen', gen: 'building/1' }, params: { floors: { type: 'int', min: 1, max: 6, default: 2 } }, components: { foundation: { kind: 'none' } } } },
    { op: 'place', tmp: '$h', def: 'cottage2@1', name: 'house', p: [10, 0] },
    { op: 'place', def: coreRef('chair'), name: 'chair', in: { parent: '$h', slot: 'floor-1' }, p: [-2, 0, 1] },
  ] });
  assert.equal(r.accepted, true, JSON.stringify(r).slice(0, 600));
  await w.settle(3);
  const E = w.host.engine as any, house = w.god.model.get('house')!.id, chair = w.god.model.get('house/chair')!.id;
  const part = E.world.entityPhysicsV1.byEntity[house];
  t.diagnostic(`cottage: ${part.solids.length} solids, ${part.surfaces.length} floors on levels ${[...new Set(part.surfaces.map((x: any) => x.level))]}, ${part.links?.length ?? 0} links; levels ${JSON.stringify(E.world.entityPhysicsV1.levels)}`);
  assert.ok(part.links?.length >= 1, 'stairs link');
  assert.ok(part.surfaces.some((x: any) => x.level === 1), 'upper floor');
  for (const l of part.links) { const a = l.from.p, z = l.to.p; t.diagnostic(`link ${l.id} ${l.from.level}→${l.to.level} bottom ${a} clear0=${E.clearanceAtV1(a[0], a[1], l.from.level).toFixed(2)} top ${z} clear1=${E.clearanceAtV1(z[0], z[1], l.to.level).toFixed(2)}; mid-landing clear1=${E.clearanceAtV1(10, -1.35, 1).toFixed(2)} bedroom=${E.clearanceAtV1(8.08, 1, 1).toFixed(2)} approach=${JSON.stringify(l.approach)} ${l.approach?.from ? `a0=${E.clearanceAtV1(l.approach.from[0], l.approach.from[1], 0).toFixed(2)}` : ""} ${l.approach?.to ? `a1=${E.clearanceAtV1(l.approach.to[0], l.approach.to[1], 1).toFixed(2)}` : ""} heading=${l.heading}`); }
  // a three-storey house: two flights, the second turning back over the first
  const r3: any = w.god.act({ ops: [{ op: 'place', def: 'cottage2@1', name: 'tall', p: [-12, 14], params: { floors: 3 } }] });
  assert.equal(r3.accepted, true, JSON.stringify(r3).slice(0, 400));
  await w.settle(3);
  for (const to of ['house:living', 'house:bedroom', 'house:bedroom-2', 'house:floor-1', 'tall:floor-2']) {
    const q = runQuery(w.god.model, { reach: { from: [10, 10], to } }).reach as any;
    t.diagnostic(`reach ${to}: ${JSON.stringify(q).slice(0, 220)}`);
    assert.equal(q.reachable, true, `${to}: ${JSON.stringify(q)}`);
  }
  await invite(w, 'cy');
  const row: any = await accept(w.host, w.souls.create('dev:cy', { name: 'Cy', description: 'sits upstairs' }));
  await w.settle(3);
  const soul = { soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner };
  const until = async (pred: () => boolean, n = 4000) => { for (let i = 0; i < n && !pred(); i++) { w.host.tickOnce(); if (i % 20 === 0) { await setImmediate(); w.host.drainInputs(); } } await w.settle(2); return pred(); };
  const sit: any = await accept(w.host, w.edge.act(soul, { capability: `sit:${chair}`, params: { seconds: 600 } }));
  assert.equal(sit.accepted, true, JSON.stringify(sit));
  assert.ok(await until(() => E.world.entities[row.entity_id].human.activity === 'sit'), `seated: ${JSON.stringify(E.world.entities[row.entity_id].human).slice(0, 300)}`);
  assert.equal(E.world.entities[row.entity_id].human.level, 1, 'upstairs');
  const no: any = w.god.act({ ops: [{ op: 'remove', id: house }] });
  assert.equal(no.failures?.[0]?.code, 'occupied.by-body'); assert.match(no.failures[0].detail, /Cy/);
  assert.deepEqual(E.runtime.violations, []);
});
