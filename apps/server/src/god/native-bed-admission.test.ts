// Refusal is the supported contract until a bed supplies native berth support,
// fit, ownership and an occupied-body witness. These are in-process CPU checks.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { coreRef } from '@sim/world-compiler';
import { fixture, invite, accept, factory, seed } from '../../test/native-owner-fixture.ts';
import { WorldHost } from '../world.ts';
import { EdgeLedger } from '../edge/ledger/ledger.ts';
import { GodMode } from './god.ts';
import { installEngineBridge } from './engine-bridge.ts';

const CODE = 'bed.attachment-unavailable';
async function setup(t: TestContext) {
  const f = fixture(':memory:', factory, { durableClockV1: true });
  f.brain.quiesce();
  t.after(() => { f.brain.quiesce(); f.host.stop(); f.db.close(); });
  const god = new GodMode(f.db, { worldId: f.host.worldId, ownerId: 'dev:admin', tick: () => f.host.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(f.host, f.db);
  const bridge = installEngineBridge({ host: f.host, god, edge, log: () => {} });
  const settle = async (n = 3) => { for (let i = 0; i < n; i++) { f.host.tickOnce(); await setImmediate(); f.host.drainInputs(); } };
  await settle();
  const souls = [];
  for (const name of ['Rowan', 'Mina']) {
    await invite(f, name.toLowerCase());
    const row = await accept(f.host, f.souls.create('dev:' + name.toLowerCase(), { name, description: 'native bed admission control' }));
    souls.push({ soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner });
  }
  await settle();
  const placed = god.act({ ops: [
    { op: 'place', def: coreRef('bed'), name: 'guest-bed', p: [5, 5] },
    { op: 'place', def: coreRef('chair'), name: 'chair', p: [-5, 5] },
  ] });
  assert.equal(placed.accepted, true, JSON.stringify(placed));
  await settle();
  const bed = god.model.get('guest-bed')!.id, chair = god.model.get('chair')!.id;
  return { ...f, god, edge, bridge, souls, settle, bed, chair };
}

test('named core-bed lie/sleep refuse before movement, receipt or decision, including a quiet barrier', async t => {
  const w = await setup(t), [soul, other] = w.souls;
  for (const s of [soul, other]) for (const verb of ['lie', 'sleep']) {
    const capability = `${verb}:${w.bed}`;
    const c = w.edge.capabilities(s).find(c => c.id === capability)!;
    assert.ok(c, 'bed remains discoverable');
    assert.equal(c.available, false);
    assert.equal(c.blocked?.code, CODE);
    const body = JSON.stringify(w.host.engine.world.entities[s.entityId]);
    const events = w.db.events(w.host.worldId).length;
    const receiptCount = () => (w.db.db.prepare('SELECT COUNT(*) AS n FROM edge_receipts_v1 WHERE world_id=? AND soul_id=?').get(w.host.worldId, s.soulId) as {n: number}).n;
    const receipts = receiptCount();
    // Quiet renewal may defer reachable work, but cannot make unsupported contact true.
    for (const quiet of [false, true]) {
      Object.defineProperty(w.host, 'quietBarrier', { configurable: true, get: () => quiet });
      const out = await w.edge.act(s, { capability, params: { seconds: 1 } });
      assert.equal(out.accepted, false, JSON.stringify(out));
      assert.equal((out as { code?: string }).code, CODE);
    }
    delete (w.host as unknown as { quietBarrier?: boolean }).quietBarrier;
    assert.equal(JSON.stringify(w.host.engine.world.entities[s.entityId]), body);
    assert.equal(w.db.events(w.host.worldId).length, events);
    assert.equal(receiptCount(), receipts);
    assert.equal(w.host.engine.programOf(s.entityId), null);
  }
  assert.deepEqual(w.host.engine.runtime.violations, []);
  assert.equal(w.db.paidCost(), 0);
});

test('a nearby floor pose cannot be submitted as bed use; ordinary pose remains available', async t => {
  const w = await setup(t), [soul] = w.souls;
  const engine = w.host.engine;
  const steps = [{ verb: 'mars:pose_v1', params: { activity: 'lie', seconds: 2, seatHeight: 0.5, seatTogether: true, face: [6, 5] } }];
  assert.equal(engine.canPerform({ actor: soul.entityId, label: 'floor pose', steps }), null, 'native generic pose alone does not certify a bed');
  const before = JSON.stringify(engine.world.entities[soul.entityId]);
  const out = await accept(w.host, w.edge.performBodies(soul, `lie:${w.bed}`, 'Lie in guest-bed', steps));
  assert.equal(out.accepted, false, JSON.stringify(out));
  assert.equal((out as { code?: string }).code, CODE);
  assert.equal(JSON.stringify(engine.world.entities[soul.entityId]), before);
  const generic = await accept(w.host, w.edge.performBodies(soul, 'lie:here', 'Lie on open ground', [{ verb: 'mars:pose_v1', params: { activity: 'lie', seconds: 1 } }]));
  assert.equal(generic.accepted, true, JSON.stringify(generic));
  if (!generic.accepted) return;
  for (let i = 0; i < 50 && w.edge.receipt(soul.soulId, generic.receipt.id)?.phase !== 'completed'; i++) await w.settle(1);
  assert.equal(w.edge.receipt(soul.soulId, generic.receipt.id)?.phase, 'completed');
  assert.equal(engine.world.entities[soul.entityId].human?.activity, 'idle');
  assert.deepEqual(engine.runtime.violations, []);
});

test('legacy waiting/active floor plans cannot produce fresh bed success; terminal history stays immutable', async t => {
  const w = await setup(t), [soul] = w.souls, guard = w.edge.nativeUseRefusal;
  const steps = [{ verb: 'mars:pose_v1', params: { activity: 'lie', seconds: 1, seatHeight: 0.5 } }];
  // Simulate admission by an older server, whose bed programme was a generic floor pose.
  w.edge.nativeUseRefusal = undefined;
  Object.defineProperty(w.host, 'quietBarrier', { configurable: true, get: () => true });
  const waiting = await w.edge.performBodies(soul, `sleep:${w.bed}`, 'Old queued bedside pose', steps);
  assert.equal(waiting.accepted, true, JSON.stringify(waiting));
  if (!waiting.accepted) return;
  w.edge.nativeUseRefusal = guard;
  delete (w.host as unknown as { quietBarrier?: boolean }).quietBarrier;
  const body = JSON.stringify(w.host.engine.world.entities[soul.entityId]);
  await w.settle(2);
  assert.equal(w.edge.receipt(soul.soulId, waiting.receipt.id)?.phase, 'failed');
  assert.equal(w.edge.receipt(soul.soulId, waiting.receipt.id)?.code, CODE);
  assert.equal(JSON.stringify(w.host.engine.world.entities[soul.entityId]), body);
  assert.equal(w.host.engine.programOf(soul.entityId), null);

  w.edge.nativeUseRefusal = undefined;
  const active = await accept(w.host, w.edge.performBodies(soul, `lie:${w.bed}`, 'Old active bedside pose', steps));
  assert.equal(active.accepted, true, JSON.stringify(active));
  if (!active.accepted) return;
  w.edge.nativeUseRefusal = guard;
  for (let i = 0; i < 50 && w.edge.openReceipts(soul.soulId).length; i++) await w.settle(1);
  assert.equal(w.edge.receipt(soul.soulId, active.receipt.id)?.phase, 'failed');
  assert.equal(w.edge.receipt(soul.soulId, active.receipt.id)?.code, CODE);

  // Idempotency retrieves prior results; it must not rewrite an old completed receipt.
  w.edge.nativeUseRefusal = undefined;
  const old = await accept(w.host, w.edge.performBodies(soul, `lie:${w.bed}`, 'Historical bedside pose', steps, 'old-bed-request'));
  assert.equal(old.accepted, true);
  if (!old.accepted) return;
  for (let i = 0; i < 50 && w.edge.openReceipts(soul.soulId).length; i++) await w.settle(1);
  const historical = w.edge.receipt(soul.soulId, old.receipt.id)!;
  assert.equal(historical.phase, 'completed');
  w.edge.nativeUseRefusal = guard;
  const replay = await w.edge.act(soul, { capability: `lie:${w.bed}`, clientRef: 'old-bed-request' });
  assert.equal(replay.accepted, true);
  if (replay.accepted) assert.deepEqual(replay.receipt, historical);
  assert.deepEqual(w.host.engine.runtime.violations, []);
});

test('bed correction/undo and cold reopen retain identity and refusal; chair and walk plans survive', async t => {
  const w = await setup(t), [soul] = w.souls;
  const moved = w.god.act({ ops: [{ op: 'move', id: w.bed, p: [6, 5], yaw: Math.PI / 2 }] });
  assert.equal(moved.accepted, true, JSON.stringify(moved));
  await w.settle();
  assert.equal(w.god.model.get('guest-bed')!.id, w.bed);
  assert.equal(w.god.undo().accepted, true);
  await w.settle();
  assert.equal(w.god.model.get('guest-bed')!.id, w.bed);
  assert.equal(w.edge.capabilities(soul).find(c => c.id === `sit:${w.chair}`)?.available, true);
  assert.ok(w.edge.capabilities(soul).some(c => c.verb === 'walk' && c.available));
  w.host.drainInputs();
  w.host.saveSnapshot(true);
  const head = w.host.engine.stateHash();
  w.host.stop();
  const cold = new WorldHost(w.db, factory, seed, 1e9, w.host.worldId, { durableClockV1: true });
  t.after(() => cold.stop());
  assert.equal(cold.boot().from, 'snapshot');
  assert.equal(cold.engine.stateHash(), head);
  const god = new GodMode(w.db, { worldId: cold.worldId, ownerId: 'dev:admin', tick: () => cold.engine.world.tick, emit: () => {} });
  const edge = new EdgeLedger(cold, w.db);
  installEngineBridge({ host: cold, god, edge, log: () => {} });
  assert.equal(god.model.get('guest-bed')!.id, w.bed);
  for (const verb of ['lie', 'sleep']) {
    const out = await edge.act(soul, { capability: `${verb}:${w.bed}` });
    assert.equal(out.accepted, false, JSON.stringify(out));
    assert.equal((out as { code?: string }).code, CODE);
  }
  assert.equal(cold.engine.stateHash(), head, 'refusal leaves authoritative cold body and world untouched');
});
