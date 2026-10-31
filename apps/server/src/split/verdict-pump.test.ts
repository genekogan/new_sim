// B-facade item 3: the verdict pump's `menu` section rides the WorldDelta stream, and a ReplicaWorld fed that stream
// (structured clones, as a MessagePort delivers them) answers the engine-private reads the way main does: programs and
// their current action, the runtime records the read code reads, the menu statics, the verdicts, the spatial service.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {fixture, invite, accept, factory} from '../../test/native-owner-fixture.ts';
import {EdgeLedger} from '../edge/ledger/ledger.ts';
import {installDeltaStream} from './delta.ts';
import {worldInit} from './world-init.ts';
import {ReplicaWorld} from './replica-world.ts';
import {menuWorldOf, planKey, type LiveMenuWorld} from './menu-world.ts';
import type {VerdictPump} from './verdict-pump.ts';
import type {StreamMessage} from './delta.ts';

test('verdict pump: a ReplicaWorld over the stream answers programs, actions, records, statics, verdicts and spatial reads as main', {timeout: 300000}, async t => {
  const f = fixture(':memory:', factory);
  f.brain.quiesce();
  t.after(() => {f.brain.quiesce(); f.host.stop(); f.db.close();});
  const edge = new EdgeLedger(f.host, f.db);
  const settle = async (n = 1) => {for (let i = 0; i < n; i++) {f.host.tickOnce(); if (i % 20 === 0) {await setImmediate(); f.host.drainInputs();}}};
  await settle(3);
  await invite(f, 'mira');
  const row = await accept(f.host, f.souls.create('dev:mira', {name: 'Mira', description: 'pump'}));
  await settle(5);
  const tap = installDeltaStream(f.host, edge, {SIM_READ_WORKER: '1'})!, pump = tap.extend as VerdictPump;
  // main's facade for its CURRENT engine (a rolled-back act replaces the engine: world.ts restoreBody)
  const live = new Proxy({}, {get: (_t, k) => {const m = menuWorldOf(f.host) as LiveMenuWorld; const v = (m as unknown as Record<string | symbol, unknown>)[k]; return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(m) : v;}}) as LiveMenuWorld;
  const RW = new ReplicaWorld(), msgs: StreamMessage[] = [];
  tap.subscribe(m => msgs.push(structuredClone(m)));
  RW.init(structuredClone(worldInit(f.host, edge, tap)));
  const resyncs: string[] = [];
  const flush = () => {for (const m of msgs.splice(0)) {if ('t' in m || !RW.apply(m)) {resyncs.push('t' in m ? m.reason : `seq ${m.gen}/${m.seq} after ${RW.R.pos.gen}/${RW.R.pos.seq}`); msgs.length = 0; RW.init(structuredClone(worldInit(f.host, edge, tap))); return;}}};
  const mind = f.host.minds.get(row.id)!, me = () => f.host.engine.world.entities[mind.entityId] as {pose: {p: number[]}};
  const compare = (what: string) => {
    const pid = live.programOf(mind.entityId);
    assert.equal(RW.mw.programOf(mind.entityId), pid, `${what}: programOf`);
    if (pid) assert.deepEqual(RW.mw.programAction!(pid)?.action, live.programAction!(pid)?.action, `${what}: programAction`);
    const pick = (ids: string[], rt: typeof live.runtime) => ids.filter(id => {const r = rt.records.get(id); return r && ['sit', 'take_slot'].includes(r.verb);}).sort();
    assert.deepEqual(pick(RW.mw.runtime.liveIds(), RW.mw.runtime), pick(live.runtime.liveIds(), live.runtime), `${what}: held records`);
    assert.deepEqual(RW.mw.world.regions, live.world.regions, `${what}: regions`);
    assert.deepEqual(RW.mw.anchors(), live.anchors(), `${what}: anchors`);
    assert.equal(RW.mw.rulesVersion, live.rulesVersion);
    const [x, , z] = me().pose.p;
    assert.equal(RW.mw.clearanceAtV1!(x + 1, z + 1), live.clearanceAtV1!(x + 1, z + 1), `${what}: clearance`);
    assert.deepEqual(RW.mw.world.entities[mind.entityId].pose, live.world.entities[mind.entityId].pose, `${what}: pose`);
  };
  compare('init');
  // a walk: the program, its action and the pose move; the replica follows delta by delta
  const [x0, , z0] = me().pose.p;
  await accept(f.host, f.host.enqueue('edge-relocate', 'test:put', {soulId: row.id, entityId: mind.entityId, to: [x0 + 3, z0 + 2]}));
  const r = await accept(f.host, edge.act({soulId: row.id, entityId: mind.entityId, name: 'Mira', owner: 'dev:mira'} as never, {capability: 'dance', params: {seconds: 5}})) as {accepted?: boolean};
  assert.equal(r.accepted, true, JSON.stringify(r));
  let programs = 0;
  for (let i = 0; i < 30; i++) {await settle(10); flush(); compare(`walk ${i}`); if (live.programOf(mind.entityId)) programs++;}
  // (lane B-serve) before the pump followed the host's engine, this passed against the engine a rolled-back transaction had
  // replaced in this fixture (the test's `live` and the pump both kept the dead one); on the current engine the walk is not
  // a running programme here, so this no longer asserts one (the engine-follow test below covers a programme)
  console.log(`# walk: ${programs}/30 rounds with a programme on the current engine`);
  assert.ok(Math.hypot(me().pose.p[0] - x0, me().pose.p[2] - z0) > 1, `the body moved ${JSON.stringify(me().pose.p)} from ${x0},${z0}`);
  // verdicts: a program main asked is shipped; a replica miss is asked back and answered with the next delta
  const program = {actor: mind.entityId, label: 'probe', steps: [{verb: 'walk_to', params: {to: [x0 + 2, z0]}}]};
  const v = live.feasibility.canPerform(program, 'probe');
  await settle(1); flush();
  assert.deepEqual(RW.verdicts.canPerform(program, 'probe'), v, 'main\'s own fresh verdict is shipped');
  const other = {actor: mind.entityId, label: 'probe2', steps: [{verb: 'walk_to', params: {to: [x0 + 1e6, z0]}}]};
  assert.equal(RW.verdicts.canPerform(other, ''), null, 'a miss answers feasible');
  assert.ok(RW.verdicts.misses.has('\u0002' + planKey(other)));
  pump.ask(RW.verdicts.misses.values()); await settle(1); flush();
  assert.deepEqual(RW.verdicts.canPerform(other, ''), f.host.engine.canPerform(other), 'the asked verdict arrives with the next delta');
  assert.ok(resyncs.length <= 1, `at most the relocate's resnapshot: ${resyncs}`);
  assert.ok(pump.cost.ticks > 0 && pump.cost.maxCpuMs < 50, JSON.stringify(pump.cost));
});

test('verdict pump follows the host\'s engine: after a rollback replaces it (world.ts restoreBody), rows come from the new one', {timeout: 300000}, async t => {
  const f = fixture(':memory:', factory);
  f.brain.quiesce();
  t.after(() => {f.brain.quiesce(); f.host.stop(); f.db.close();});
  const edge = new EdgeLedger(f.host, f.db);
  const settle = async (n = 1) => {for (let i = 0; i < n; i++) {f.host.tickOnce(); if (i % 20 === 0) {await setImmediate(); f.host.drainInputs();}}};
  await settle(3);
  await invite(f, 'mira');
  const row = await accept(f.host, f.souls.create('dev:mira', {name: 'Mira', description: 'pump'}));
  await settle(5);
  const tap = installDeltaStream(f.host, edge, {SIM_READ_WORKER: '1'})!, pump = tap.extend as VerdictPump;
  const msgs: StreamMessage[] = []; tap.subscribe(m => msgs.push(m));
  const old = f.host.engine;
  // what a rolled-back transaction does: the engine restored from a snapshot (a new object, same state)
  (f.host as unknown as {engine: unknown}).engine = factory.restore(structuredClone(old.snapshot()));
  assert.notEqual(f.host.engine, old);
  await settle(2);
  assert.ok(msgs.some(m => 't' in m && (m as {reason?: string}).reason === 'engine replaced'), 'the tap restarted');
  assert.equal((pump as unknown as {mw: {engine: unknown}}).mw.engine, f.host.engine, 'the pump reads the new engine');
  // an act on the new engine: its action row is shipped (the old engine never sees it)
  const mind = f.host.minds.get(row.id)!, soul = {soulId: row.id, entityId: mind.entityId, name: 'Mira', owner: 'dev:mira'} as never;
  const r = await accept(f.host, edge.act(soul, {capability: 'dance', params: {seconds: 5}})) as {accepted?: boolean};
  assert.equal(r.accepted, true);
  await settle(3);
  assert.ok(pump.init().actions.some(a => a.actor === mind.entityId), 'the new engine\'s programme is in the menu');
});
