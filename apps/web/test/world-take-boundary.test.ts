// Real vendored producer → JSON transport → the helpers used by LiveWorld.
// No synthetic take shapes and no mutation of producer state by rendering.
import test from 'node:test';
import assert from 'node:assert/strict';
import { marsFactory, GREEN_FIELD_WORLD, LITTLE_MARTIANS_WORLD, type MarsWorldConfig } from '../../../packages/engine-mars/src/engine.ts';
import { sampleTake, replayFinalState } from '../../../mars/viewer/engine/take/replay.ts';
import { floaterBodiesOfTake } from '../../../mars/viewer/engine/bodies/index.ts';
import { validChunks, chunkAt, parseSceneInfo, WorldGeometry } from '../src/WorldGeometry.ts';

for (const [name, config, label] of [
  ['Mars', undefined, 'Visitor'],
  ['Eden', GREEN_FIELD_WORLD, 'Eden'],
  ['Little Martians', LITTLE_MARTIANS_WORLD, 'Verdelis'],
] as const) {
  test(`${name}: actual chunks survive wire decoding, fractional sampling and geometry construction`, async () => {
    const factory = await marsFactory(config as MarsWorldConfig | undefined);
    const engine = factory.create(factory.genesis(`world-consumer-${name}`));
    engine.spawnHuman({ id: 'resident', label, soul: 's-resident' });
    for (let i = 0; i < 45; i++) engine.step();
    const sourceHash = engine.stateHash();
    const raw = JSON.parse(JSON.stringify(engine.takeChunks!(0)));
    const wireBefore = JSON.stringify(raw);
    const chunks = validChunks(raw);
    assert.equal(chunks.length, 2);
    assert.deepEqual(chunks.map(x => [x.fromTick, x.toTick]), [[0, 20], [20, 40]]);
    const picked = chunkAt(chunks, 25.5)!;
    assert.equal(picked.exact, true);
    assert.equal(picked.chunk.take.startTick, 20);
    assert.equal(picked.chunk.take.schema, 'mars-take/4');
    assert.equal(picked.chunk.take.dt, 0.05);
    const take = picked.chunk.take;
    const frame = sampleTake(take, (25.5 - take.startTick) * take.dt);
    assert.equal(frame.tick, 5.5, 'sample ticks are relative; envelope ticks are absolute');
    assert.ok(frame.entities.resident);
    assert.ok(frame.entities.resident.p.every(Number.isFinite));
    const expected = engine.world.entities.resident.pose.p;
    assert.ok(frame.entities.resident.p.every((v, i) => Math.abs(v - expected[i]) <= 0.0005));
    const info = parseSceneInfo(JSON.parse(JSON.stringify(engine.renderScene!())));
    assert.ok(info.scene);
    if (name === 'Eden') assert.equal(info.ground, 'grass');
    const bodies = floaterBodiesOfTake(take);
    assert.equal(bodies.size, name === 'Little Martians' ? 1 : 0);
    const geometry = new WorldGeometry(info.scene, info.ground);
    try {
      const first = sampleTake(take, 5.5 * take.dt);
      sampleTake(take, 18 * take.dt);
      sampleTake(take, 0);
      assert.deepEqual(sampleTake(take, 5.5 * take.dt), first, 'seek/pause/order cannot change the sampled pose');
      replayFinalState(take); // verifies the recorded physical final hash
    } finally { geometry.dispose(); }
    assert.equal(JSON.stringify(raw), wireBefore);
    assert.equal(engine.stateHash(), sourceHash, 'sampling/drawing does not reserve/move/replan canonical actors');
  });
}

test('actual actor removal remains visible before its recorded lifetime boundary, then disappears', async () => {
  const factory = await marsFactory(GREEN_FIELD_WORLD);
  const engine = factory.create(factory.genesis('consumer-lifetime'));
  engine.spawnHuman({ id: 'resident', label: 'Resident', soul: 's-resident' });
  for (let i = 0; i < 25; i++) engine.step();
  engine.removeEntity('resident');
  for (let i = 0; i < 15; i++) engine.step();
  const chunks = validChunks(JSON.parse(JSON.stringify(engine.takeChunks!(0))));
  const take = chunks[1].take;
  assert.ok(take.entities0?.resident, 'removed entity record must remain for historical drawing');
  assert.ok(sampleTake(take, 4 * take.dt).entities.resident);
  assert.equal(sampleTake(take, 7 * take.dt).entities.resident, undefined);
  assert.ok(sampleTake(take, 4 * take.dt).entities.resident, 'rewinding restores the historical sample only');
  assert.equal(engine.world.entities.resident, undefined);
});
