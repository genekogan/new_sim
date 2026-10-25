import test from 'node:test';
import assert from 'node:assert/strict';
import { captureGraph, decode, encode, finishGraph } from '../../../mars/viewer/engine/runtime/codec.ts';
import { decodeSnapshot, type RuntimeSnapshot } from '../../../mars/viewer/engine/runtime/snapshot.ts';
import { entityPhysicsHash, nextEntityPhysics, type EntityPartV1, type EntityPhysicsV1, type WorldEditV1 } from './entity-physics.ts';
import { GREEN_FIELD_WORLD, marsFactory, type MarsEngine } from './engine.ts';

const part = (x: number): EntityPartV1 => ({ surfaces: [
  { id: `floor-${x}`, level: 0, y: 0, obb: { c: [x, 0], half: [2, 2], yaw: 0 } },
] });
const edit = (seq: number, set: WorldEditV1['set'], assets?: Record<string, unknown>): WorldEditV1 =>
  ({ contract: 'world-edit/1', seq, hash: '', levels: [], set, ...(assets ? { assets } : {}) });

test('physics construction seals owned data, reuses unchanged admitted parts, and preserves ordinary bytes', () => {
  const input = edit(1, { first: part(4), second: part(12) });
  const first = nextEntityPhysics(undefined, input), before = JSON.stringify(encode(first));
  assert.ok(Object.isFrozen(first)); assert.ok(Object.isFrozen(first.byEntity));
  assert.ok(Object.isFrozen(first.byEntity.first.surfaces![0].obb.c));
  assert.equal(Object.isFrozen(input.set.first), false, 'the caller still owns its input event');
  assert.equal(first.hash, entityPhysicsHash(first));
  const coldCopy = structuredClone(first), cached = captureGraph(first), cold = captureGraph(coldCopy);
  assert.equal(cached.cachedNodes, cached.nodes); assert.equal(cold.cachedNodes, 0);
  assert.equal(JSON.stringify(finishGraph(cached)), JSON.stringify(finishGraph(cold)));

  input.set.first!.surfaces![0].obb.c[0] = 90;
  assert.equal(JSON.stringify(encode(first)), before, 'event mutation does not reach owned physics');
  const second = nextEntityPhysics(first, edit(2, { first: part(8) }));
  assert.notStrictEqual(second, first); assert.notStrictEqual(second.byEntity.first, first.byEntity.first);
  assert.strictEqual(second.byEntity.second, first.byEntity.second, 'unchanged parts retain their admitted identities');
  assert.equal(second.hash, entityPhysicsHash(second));
  assert.equal(JSON.stringify(encode(first)), before);
  const output = decode(encode(second)) as EntityPhysicsV1;
  output.byEntity.first.surfaces![0].obb.c[0] = -90;
  assert.equal(second.byEntity.first.surfaces![0].obb.c[0], 8, 'returned snapshot data remains mutable and isolated');
});

test('collection-valued legacy physics remains encodable without entering the immutable cache', () => {
  const physics = nextEntityPhysics(undefined, edit(1, { first: part(4) }, { legacy: { map: new Map([['x', 1]]), set: new Set([1]) } }));
  assert.equal(Object.isFrozen(physics), false);
  assert.equal(captureGraph(physics).cachedNodes, 0);
  const output = decode(encode(physics)) as EntityPhysicsV1;
  const asset = output.assets.legacy as { map: Map<string, number>; set: Set<number> };
  assert.deepEqual([...asset.map], [['x', 1]]); assert.deepEqual([...asset.set], [1]);
});

test('restored physics is admitted while cross-boundary aliases and mutable snapshot outputs survive', async () => {
  const factory = await marsFactory(GREEN_FIELD_WORLD);
  const engine = factory.create(factory.genesis('immutable-physics-snapshot')) as MarsEngine;
  const input = edit(1, { first: part(4) }); input.hash = nextEntityPhysics(undefined, input).hash;
  engine.applyWorldEditV1(input);
  type Native = { rt: { world: { entityPhysicsV1: EntityPhysicsV1 }; services: Record<string, unknown> } };
  const native = engine as unknown as Native;
  native.rt.services.snapshotPhysicsAlias = native.rt.world.entityPhysicsV1.byEntity.first.surfaces![0];
  const snapshot = engine.snapshot() as ReturnType<MarsEngine['snapshot']> & { mars: RuntimeSnapshot };
  const restored = factory.restore(JSON.parse(JSON.stringify(snapshot))) as MarsEngine;
  const restoredNative = restored as unknown as Native, physics = restoredNative.rt.world.entityPhysicsV1;
  assert.equal(restored.stateHash(), snapshot.stateHash);
  assert.ok(Object.isFrozen(physics.byEntity.first.surfaces![0].obb));
  assert.strictEqual(restoredNative.rt.services.snapshotPhysicsAlias, physics.byEntity.first.surfaces![0]);
  assert.equal(captureGraph(physics).cachedNodes, captureGraph(physics).nodes);

  const decoded = decodeSnapshot(snapshot.mars);
  assert.strictEqual(decoded.services.snapshotPhysicsAlias, decoded.world.entityPhysicsV1!.byEntity.first.surfaces![0]);
  assert.equal(Object.isFrozen(decoded.world.entityPhysicsV1), false, 'snapshot consumers receive ordinary mutable data');
  decoded.world.entityPhysicsV1!.byEntity.first.surfaces![0].obb.c[0] = 99;
  assert.equal(physics.byEntity.first.surfaces![0].obb.c[0], 4);
  engine.step(); restored.step();
  assert.equal(restored.stateHash(), engine.stateHash());
});
