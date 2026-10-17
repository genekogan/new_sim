// P2 (E-life): the HTTP take history leaves out each chunk's static physics, as the live stream does; ?physics=1 keeps it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { publicTakes } from './hub.ts';

test('take history replies leave out entityPhysicsV1 unless asked for the full chunks', () => {
  const chunk = (n: number) => ({ fromTick: n, toTick: n + 20, take: { id: 't' + n, finalState: { tick: n + 20, entities: { a: { id: 'a' } }, entityPhysicsV1: { version: 'entity-physics/1', hash: 'x'.repeat(64), byEntity: { big: 1 } } } } });
  const reply = { serverTick: 99, chunks: [chunk(0), chunk(20)], next: null };
  const lean = publicTakes(reply);
  assert.deepEqual(lean.chunks.map((k: any) => Object.keys(k.take.finalState).sort()), [['entities', 'tick'], ['entities', 'tick']]);
  assert.equal(lean.serverTick, 99); assert.equal(lean.next, null);
  assert.ok(reply.chunks[0].take.finalState.entityPhysicsV1, 'the canonical chunk is untouched');
  assert.equal(publicTakes(reply, true), reply);
  assert.ok(JSON.stringify(lean).length < JSON.stringify(reply).length);
});
