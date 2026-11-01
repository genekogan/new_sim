// The vocabulary's occupied-microphone explanation is a read, including on a host whose engine always throws.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture, invite, accept, factory} from '../../test/native-owner-fixture.ts';
import {EdgeLedger} from '../edge/ledger/ledger.ts';
import {resolveCapability, type VocabContext} from '../edge/ledger/vocabulary.ts';
import type {EdgeSoul, EdgeCapability} from '../edge/contract.ts';
import {installDeltaStream} from './delta.ts';
import {worldInit} from './world-init.ts';
import {ReplicaWorld} from './replica-world.ts';
import {ReadOnlyHost, readLedger} from './read-host.ts';

// Exercise the exact context consumed by the production word resolver with no offered singing capability.
const context = (ledger: EdgeLedger, soul: EdgeSoul) =>
  (ledger as unknown as {vocabularyOf(s: EdgeSoul, caps: EdgeCapability[]): VocabContext}).vocabularyOf(soul, []);

test('vocabulary and hand planning use the current facade snapshot on live and engine-less replica hosts', {timeout: 60000}, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-vocabulary-')), path = join(dir, 'sim.db');
  const f = fixture(path, factory); f.brain.quiesce();
  let host: ReadOnlyHost | undefined;
  t.after(() => {host?.close(); f.host.stop(); f.db.close(); rmSync(dir, {recursive: true, force: true});});
  const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false});
  const create = async (name: string) => {
    await invite(f, name);
    const r = await accept(f.host, f.souls.create('dev:' + name, {name, description: 'vocabulary fixture'}));
    return {soulId: r.id, entityId: r.entity_id, name: r.name, owner: r.owner};
  };
  const reader = await create('Reader'), singer = await create('Singer');
  const body = f.host.engine.world.entities[singer.entityId]!;
  const at: [number, number] = [body.pose.p[0], body.pose.p[2]];
  // A controlled read snapshot, not a playtest of starting singing (the native singing scenario covers that).
  body.human!.activity = 'sing';
  const spots = {contract: 'activity-spots/1', spots: [{id: 'mic', activity: 'sing', title: 'Microphone', label: 'test microphone', at}], shelves: []};
  edge.spotsProvider = () => spots as never;
  const tap = installDeltaStream(f.host, edge, {SIM_READ_WORKER: '1'})!;
  const rw = new ReplicaWorld(); rw.init(structuredClone(worldInit(f.host, edge, tap)));
  host = new ReadOnlyHost(rw, f.host.worldId, path);
  const replica = readLedger(host); replica.spotsProvider = () => spots as never;
  assert.throws(() => Reflect.get(host!.engine, 'world'), /main-only/);
  const seq = f.host.seq, hash = f.host.engine.stateHash();
  const input = 'sing at the nearest microphone';
  const native = resolveCapability(input, context(edge, reader));
  assert.equal(native.kind, 'unknown');
  assert.match(native.kind === 'unknown' ? native.reason : '', /^Singer is already singing at the nearest microphone/);
  assert.deepEqual(resolveCapability(input, context(replica, reader)), native, 'replica returns the same named refusal without host.engine');
  assert.equal(f.host.seq, seq); assert.equal(f.host.engine.stateHash(), hash, 'vocabulary reads do not change the native world');

  const handOver = (ledger: EdgeLedger) => (ledger.together as unknown as {
    handOverSteps(me: string, other: string): unknown;
  }).handOverSteps(reader.entityId, singer.entityId);
  const beside = (ledger: EdgeLedger) => ledger.together.besideSteps(reader.entityId, singer.entityId);
  assert.notEqual(handOver(edge), null); assert.notEqual(beside(edge), null);
  assert.deepEqual(handOver(replica), handOver(edge), 'hand-over clearance agrees on native and replica');
  assert.deepEqual(beside(replica), beside(edge), 'hand-holding clearance agrees on native and replica');
  const clearance = rw.mw.clearanceAtV1;
  Reflect.set(rw.mw, 'clearanceAtV1', () => 0);
  assert.equal(handOver(replica), null, 'replica-only obstruction refuses a hand-over');
  assert.equal(beside(replica), null, 'replica-only obstruction refuses holding hands');
  assert.notEqual(handOver(edge), null, 'native clearance is unchanged');
  Reflect.set(rw.mw, 'clearanceAtV1', clearance);

  // Plan, do not execute, a walk from a controlled held-hands snapshot. Replace only the notification sink;
  // the read worker intentionally forbids delivering messages and actual contact effects remain main-only.
  const notices: string[][] = [[], []];
  for (const [i, ledger] of [edge, replica].entries()) {
    (ledger.together as unknown as {p: {deliver(to: string, kind: string, payload: unknown): void}}).p.deliver =
      (_to, kind) => {notices[i].push(kind);};
  }
  Reflect.set(f.host.engine.world.entities[reader.entityId]!.human!, 'handHold', {with: singer.entityId, hand: 'left', since: 0});
  rw.mw.world.entities[reader.entityId]!.human!.handHold = {with: singer.entityId, hand: 'left', since: 0};
  const steps = [{verb: 'walk_to', params: {to: [5, 5]}}];
  const nativeWalk = edge.together.holdingSteps(reader, 'walk:here', steps);
  assert.equal(nativeWalk.at(-1)?.params.pace, 'together');
  assert.deepEqual(replica.together.holdingSteps(reader, 'walk:here', steps), nativeWalk);
  rw.mw.world.entities[singer.entityId]!.human!.task = 'fixture-walk';
  (rw.mw.runtime.records as unknown as Map<string, {verb: string}>).set('fixture-walk', {verb: 'walk_to'});
  assert.equal(replica.together.holdingSteps(reader, 'walk:here', steps)[0].params.mode, 'release',
    'a replica-only walking partner means this Soul is being led and must release before its own walk');
  assert.deepEqual(edge.together.holdingSteps(reader, 'walk:here', steps), nativeWalk, 'native task records remain unchanged');
  assert.deepEqual(notices, [['hands.walk', 'hands.walk'], ['hands.walk', 'hands.released']]);

  // Deliberately divergent replica snapshot: an implementation that secretly consults main must fail this check.
  const replicaBody = rw.mw.world.entities[singer.entityId]!;
  replicaBody.human!.activity = 'idle';
  const free = resolveCapability(input, context(replica, reader));
  assert.equal(free.kind, 'unknown', 'no offered capability is invented by an unoccupied microphone');
  assert.doesNotMatch(free.kind === 'unknown' ? free.reason : '', /Singer is already singing/);
  assert.deepEqual(resolveCapability(input, context(edge, reader)), native, 'replica reads do not change native answers');
  replicaBody.human!.activity = 'sing'; replicaBody.pose.p[0] += 100;
  assert.equal(context(replica, reader).elsewhere?.('sing')?.by, undefined, 'a distant singer does not occupy this microphone');
  replica.spotsProvider = () => ({...spots, spots: []}) as never;
  assert.equal(context(replica, reader).elsewhere?.('sing'), null, 'an absent microphone remains absent');
});
