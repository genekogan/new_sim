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
  const flush = () => {for (const m of msgs.splice(0)) if ('t' in m || !RW.apply(m)) {msgs.length = 0; RW.init(structuredClone(worldInit(f.host, edge, tap))); break;} RL.replicaSync(RW.R.faded);};
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
