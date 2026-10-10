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
  { op: 'define', def: { schema: 'def/1', name: 'flight', version: 1, description: 'A straight flight of stairs.', tags: ['stairs'], size: { box: [1.1, 2.8, 3.2] }, make: { kind: 'gen', gen: 'stairs/1' }, params: { rise: { type: 'number', default: 2.8 }, run: { type: 'number', default: 3.2 }, width: { type: 'number', default: 1.1 } } } },
  { op: 'place', tmp: '$h', def: 'house2@1', name: 'house', p: at },
  { op: 'place', def: 'flight@1', name: 'stairs', in: { parent: '$h', slot: 'ground' }, p: [2.9, 0, 0] },
  { op: 'place', def: coreRef('chair'), name: 'chair', in: { parent: '$h', slot: 'floor-1' }, p: [-2, 0, -1] },
  { op: 'place', tmp: '$t', def: coreRef('table'), name: 'table', in: { parent: '$h', slot: 'floor-1' }, p: [0, 0, -1.6] },
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
  const E = w.host.engine as any, ids = Object.fromEntries(['house', 'house/stairs', 'house/chair', 'house/table', 'house/table/bowl'].map((p) => [p, w.god.model.get(p)!.id]));
  const ep = E.world.entityPhysicsV1;
  assert.ok(ep?.byEntity[ids.house]?.solids?.length >= 5, 'walls');
  assert.equal(ep.byEntity[ids.house].surfaces.length, 2, 'two floors');
  assert.equal(ep.byEntity[ids['house/stairs']].links.length, 1, 'stairs');
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
