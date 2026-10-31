// L3 / CPU audit #2 (2026-10-31): `here` read and parsed the whole object table once per nearby object (kindOf asked
// objects.all() in the pick loop and again for each picked object): 39 neighbours of a 3,300-row table = 44 reads,
// ~120 CPU-ms and MBs of garbage per frame. The kinds now come from the one read things() makes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {fixture, invite, accept} from '../test/native-owner-fixture.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {hereFrame} from './edge/perception/here.ts';

test('here reads the object table once per frame, and still names each nearby object by its kind', {timeout: 60000}, async t => {
  const f = fixture(':memory:'); f.brain.quiesce();
  const edge = new EdgeLedger(f.host, f.db, undefined, {ambient: false});
  t.after(() => {f.host.stop(); f.db.close();});
  await invite(f, 'ana');
  const row = await accept(f.host, f.souls.create('dev:ana', {name: 'Ana', description: 'curious'})) as {id: string; entity_id: string; name: string; owner: string};
  for (let i = 0; i < 3; i++) {f.host.tickOnce(); await setImmediate(); f.host.drainInputs();}
  const soul = {soulId: row.id, entityId: row.entity_id, name: row.name, owner: row.owner};
  const [x, , z] = f.host.engine.world.entities[soul.entityId]!.pose.p;
  const place = edge.placePathOf(soul.soulId)[0]?.id ?? 'world';
  const kinds = ['note', 'project', 'sign'];
  const rows = Array.from({length: 300}, (_, i) => ({id: `obj-${i}`, kind: kinds[i % 3]!, name: `thing ${i}`, placeId: place, state: {at: i < 30 ? [x + 1 + (i % 6) * 0.5, z + 1 + Math.floor(i / 6) * 0.5] : [x + 900, z + 900]}}));
  let reads = 0;
  (edge as unknown as {comms: unknown}).comms = {streams: {headCursor: () => '0'}, fading: {status: () => null},
    objects: {all: () => {reads++; return structuredClone(rows);}, visibleTo: () => [], create: () => ({id: ''})}, close() {}};
  const frame = hereFrame(edge, soul, {doHere: true}) as unknown as {objects: {id: string; kind: string}[]};
  assert.equal(reads, 1, `one object-table read per here (was one per nearby object): ${reads}`);
  const objs = frame.objects.filter(o => o.id.startsWith('obj-'));
  assert.ok(objs.length >= 3, `nearby objects are listed (${objs.length})`);
  for (const o of objs) assert.equal(o.kind, rows[Number(o.id.slice(4))]!.kind, `${o.id} keeps its kind`);
});
