// L4 #7: a world-edit's physics is built once. The producer (the god bridge) builds it to log its hash; the engine's fold
// of that very event adopts the value instead of building a second copy. Replay, restore and any other engine fold the
// logged bytes themselves and must end on the same physics and the same state hash.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorldEditPhysics, nextEntityPhysics, type EntityPartV1, type EntityPhysicsV1, type WorldEditV1 } from './entity-physics.ts';
import { GREEN_FIELD_WORLD, marsFactory, type MarsEngine } from './engine.ts';

const part = (x: number): EntityPartV1 => ({
  surfaces: [{ id: `floor-${x}`, level: 0, y: 0, obb: { c: [x, 0], half: [2, 2], yaw: 0 } }],
  solids: [{ id: `wall-${x}`, obb: { c: [x, 3], half: [2, 0.1], yaw: 0 }, y0: 0, y1: 2.5, kind: 'wall' }],
});
const edit = (seq: number, set: WorldEditV1['set']): WorldEditV1 => ({ contract: 'world-edit/1', seq, hash: '', levels: [], set });
type Native = { rt: { world: { entityPhysicsV1?: EntityPhysicsV1 } } };
const physicsOf = (e: MarsEngine) => (e as unknown as Native).rt.world.entityPhysicsV1;

test('the fold adopts the physics its producer built from the same physics; other engines build the same bytes', async () => {
  const factory = await marsFactory(GREEN_FIELD_WORLD);
  const live = factory.create(factory.genesis('physics-once')) as MarsEngine;
  const replay = factory.create(factory.genesis('physics-once')) as MarsEngine;
  const events: WorldEditV1[] = [];
  let mine = physicsOf(live);
  for (const [seq, set] of [[1, { a: part(4), b: part(12) }], [2, { a: part(8) }], [3, { b: null, c: part(-6) }]] as const) {
    const e = edit(seq, set as WorldEditV1['set']);
    mine = buildWorldEditPhysics(mine, e); e.hash = mine.hash;
    events.push(JSON.parse(JSON.stringify(e)));
    assert.equal(live.applyWorldEditV1(e).hash, e.hash);
    assert.strictEqual(physicsOf(live), mine, 'one physics object: the engine holds the one the producer built');
    assert.equal(replay.applyWorldEditV1(events.at(-1)!).hash, e.hash);
    assert.notStrictEqual(physicsOf(replay), mine, 'a logged copy of the event is built by its own engine');
    assert.equal(JSON.stringify(physicsOf(replay)), JSON.stringify(mine));
    live.step(); replay.step();
    assert.equal(live.stateHash(), replay.stateHash());
  }
  const restored = factory.restore(JSON.parse(JSON.stringify(live.snapshot()))) as MarsEngine;
  assert.equal(restored.stateHash(), live.stateHash());
});

test('a fold whose physics is not the one the producer built from builds its own (and the entry is used once)', async () => {
  const factory = await marsFactory(GREEN_FIELD_WORLD);
  const a = factory.create(factory.genesis('physics-once-b')) as MarsEngine;
  const b = factory.create(factory.genesis('physics-once-b')) as MarsEngine;
  const first = edit(1, { a: part(4) }); first.hash = nextEntityPhysics(undefined, first).hash;
  a.applyWorldEditV1(first);
  // built from nothing, folded into an engine that already has `first`: the producer's value would be wrong there
  const e = edit(2, { b: part(12) }), stale = buildWorldEditPhysics(undefined, e); e.hash = nextEntityPhysics(physicsOf(a), e).hash;
  assert.notEqual(stale.hash, e.hash);
  assert.equal(a.applyWorldEditV1(e).hash, e.hash);
  assert.notStrictEqual(physicsOf(a), stale);
  // the same event object folded twice (two engines from the same physics): the first adopts, the second builds
  const f = edit(1, { a: part(4) }), built = buildWorldEditPhysics(undefined, f); f.hash = built.hash;
  const c = factory.create(factory.genesis('physics-once-b')) as MarsEngine;
  b.applyWorldEditV1(f); c.applyWorldEditV1(f);
  assert.strictEqual(physicsOf(b), built); assert.notStrictEqual(physicsOf(c), built);
  assert.equal(physicsOf(c)!.hash, built.hash);
});
