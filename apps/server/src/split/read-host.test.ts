// B-facade item 6: the read code over a read-only host. A ReplicaWorld fed main's stream (structured clones, as a
// MessagePort delivers them) + a read-only sqlite connection + EdgeLedger({readOnly}) answer `here` as main does.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate} from 'node:timers/promises';
import {fixture, invite, accept, factory} from '../../test/native-owner-fixture.ts';
import {EdgeLedger} from '../edge/ledger/ledger.ts';
import {hereFrame} from '../edge/perception/here.ts';
import {installDeltaStream, type StreamMessage} from './delta.ts';
import {worldInit} from './world-init.ts';
import {ReplicaWorld} from './replica-world.ts';
import {ReadOnlyHost, readLedger} from './read-host.ts';
import {diffFields} from './read-oracle.ts';

test('read host: here over a ReplicaWorld + read-only sqlite equals main', {timeout: 300000}, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'read-host-')), path = join(dir, 'sim.db');
  const f = fixture(path, factory);
  f.brain.quiesce();
  const edge = new EdgeLedger(f.host, f.db);
  const settle = async (n = 1) => {for (let i = 0; i < n; i++) {f.host.tickOnce(); if (i % 20 === 0) {await setImmediate(); f.host.drainInputs();}}};
  await settle(3);
  await invite(f, 'mira');
  const row = await accept(f.host, f.souls.create('dev:mira', {name: 'Mira', description: 'read host'}));
  await settle(5);
  const tap = installDeltaStream(f.host, edge, {SIM_READ_WORKER: '1'})!;
  const RW = new ReplicaWorld(), msgs: StreamMessage[] = [];
  tap.subscribe(m => msgs.push(structuredClone(m)));
  RW.init(structuredClone(worldInit(f.host, edge, tap)));
  const H = new ReadOnlyHost(RW, f.host.worldId, path), RL = readLedger(H);
  t.after(() => {H.close(); f.brain.quiesce(); f.host.stop(); f.db.close(); rmSync(dir, {recursive: true, force: true});});
  const flush = () => {for (const m of msgs.splice(0)) if ('t' in m || !RW.apply(m)) {msgs.length = 0; RW.init(structuredClone(worldInit(f.host, edge, tap))); break;} RL.replicaSync(RW.R.faded, RW.R.static?.places);};
  const mind = f.host.minds.get(row.id)!, soul = {soulId: row.id, entityId: mind.entityId, name: 'Mira', owner: 'dev:mira'} as never;
  flush();
  const kinds = new Set<string>();
  const compare = (what: string) => {
    const a = hereFrame(edge, soul), b = hereFrame(RL, soul), d = diffFields(a, b);
    kinds.add(String((a as {me: {activity: {kind: string; endsIn?: string}}}).me.activity.kind) + ((a as {me: {activity: {endsIn?: string}}}).me.activity.endsIn ? '+endsIn' : ''));
    assert.deepEqual(d, [], `${what}: ${JSON.stringify(d).slice(0, 2000)}`);
  };
  compare('init');
  assert.throws(() => (H.engine as {programOf(x: string): unknown}).programOf('x'), /main-only/);
  assert.throws(() => H.db.db.prepare('INSERT INTO edge_receipts_v1 (world_id) VALUES (1)').run(), /readonly|read-only/i);
  const r = await accept(f.host, edge.act(soul, {capability: 'dance', params: {seconds: 5}})) as {accepted?: boolean};
  assert.equal(r.accepted, true, JSON.stringify(r));
  for (let i = 0; i < 12; i++) {await settle(10); flush(); compare(`dance ${i}`);}
  assert.ok([...kinds].some(k => k.startsWith('dance')), `the dance showed: ${[...kinds]}`);
});

test('read worker mode 2: GET /v1/edge/here served by the worker\'s read code equals main\'s frame', {timeout: 300000}, async t => {
  const {ReadPool, deltaSource} = await import('./read-pool.ts');
  const dir = mkdtempSync(join(tmpdir(), 'read-w2-')), path = join(dir, 'sim.db');
  const f = fixture(path, factory);
  f.brain.quiesce();
  const edge = new EdgeLedger(f.host, f.db);
  const settle = async (n = 1) => {for (let i = 0; i < n; i++) {f.host.tickOnce(); if (i % 20 === 0) {await setImmediate(); f.host.drainInputs();}}};
  await settle(3);
  await invite(f, 'mira');
  const row = await accept(f.host, f.souls.create('dev:mira', {name: 'Mira', description: 'worker'}));
  await settle(5);
  const source = await deltaSource(f.host, edge, {SIM_READ_WORKER: '1'});
  const forwarded: string[] = [];
  const p = new ReadPool({workers: 1, mode: 2, worldPath: '/w/eden', init: source.init, ask: source.ask, writes: source.writes, world: {dbPath: path, worldId: f.host.worldId},
    auth: token => token === 'sim_mira' ? {soulId: row.id, account: 'acct'} : {soulId: null},
    run: async fw => {forwarded.push(fw.url); return {status: 200, headers: [['content-type', 'application/json']], body: new TextEncoder().encode(JSON.stringify({main: true})).buffer as ArrayBuffer};},
    log: () => {}}).start();
  source.onDelta(d => p.delta(d), () => p.reinit());
  t.after(async () => {await p.close(); f.brain.quiesce(); f.host.stop(); f.db.close(); rmSync(dir, {recursive: true, force: true});});
  const until = async (ok: () => boolean, ms = 60000) => {const t0 = Date.now(); while (!ok()) {if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 20));}};
  await until(() => p.slots[0].ready && p.slots[0].port > 0);
  const port = p.slots[0].port, mind = f.host.minds.get(row.id)!, soul = {soulId: row.id, entityId: mind.entityId, name: 'Mira', owner: 'dev:mira'} as never;
  const get = async (q = '') => {const r = await fetch(`http://127.0.0.1:${port}/w/eden/v1/edge/here${q}`, {headers: {authorization: 'Bearer sim_mira'}}); return {r, j: await r.json() as Record<string, unknown>};};
  const check = async (what: string) => {
    await until(() => p.lagGens() === 0);
    const {r, j} = await get();
    assert.equal(r.headers.get('x-sim-read'), 'worker', what);
    assert.ok(Number(r.headers.get('x-sim-read-cpu-ms')) > 0, `${what}: served by the worker's read code (${JSON.stringify(j).slice(0, 300)})`);
    const live = {contract: 'eden-edge/1', tick: f.host.engine.world.tick, here: hereFrame(edge, soul)};
    assert.deepEqual(diffFields(live, j), [], what);
  };
  await check('idle');
  const r = await accept(f.host, edge.act(soul, {capability: 'dance', params: {seconds: 5}})) as {accepted?: boolean};
  assert.equal(r.accepted, true);
  for (let i = 0; i < 4; i++) {await settle(10); await check(`dance ${i}`);}
  const h = await (await fetch(`http://127.0.0.1:${port}/w/eden/healthz/read`)).json() as {read: {served: number; warmMs: number; fallbacks: Record<string, number>}};
  assert.equal(h.read.served, 5, JSON.stringify(h.read));
  assert.deepEqual(forwarded, [], 'nothing forwarded');
});
