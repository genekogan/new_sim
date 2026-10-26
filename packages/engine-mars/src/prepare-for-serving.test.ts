import test from 'node:test';
import assert from 'node:assert/strict';
import { marsFactory, GREEN_FIELD_WORLD, type MarsEngine } from './engine.ts';
import { nextEntityPhysics, type WorldEditV1, type EntityPhysicsV1 } from './entity-physics.ts';
import { assetFromDef } from './catalog-adapter.ts';
import { hashOf } from '../../../mars/viewer/engine/core/hash.ts';
import { takeIdOf } from '../../../mars/viewer/engine/take/recorder.ts';
import type { Take } from '../../../mars/viewer/engine/take/types.ts';

type Internals = {
  m: { finalStateOf(world: unknown): { hash: string } };
  rt: { events: unknown[]; observers: unknown[] };
  recorder: { startTick: number; baselineStateHash: string };
};
const inside = (engine: MarsEngine) => engine as unknown as Internals;
const factory = await marsFactory(GREEN_FIELD_WORLD);
const create = (seed: string) => factory.create(factory.genesis(seed)) as MarsEngine;

const fixtureAsset = assetFromDef('preparation-fixture', {
  ref: 'preparation-fixture@1', hash: 'a'.repeat(64), name: 'preparation-fixture', tags: [], layer: 'solid',
  components: {}, slots: [], box: [0.5, 1, 0.5],
});
function edit(engine: MarsEngine, seq: number, x: number | null) {
  const draft: WorldEditV1 = { contract: 'world-edit/1', seq, hash: '', levels: [], set: {
    'preparation-wall': x === null ? null : { solids: [{ id: 'preparation-wall', kind: 'fixture', label: 'test wall',
      obb: { c: [x, 80], half: [0.5, 0.5], yaw: 0 }, y0: 0, y1: 2 }] },
  } };
  if (seq > 0) {
    draft.assets = { 'preparation-fixture': fixtureAsset };
    draft.set['preparation-fixture'] = x === null ? null : { fixture: {
      def: 'preparation-fixture', kind: 'fixture', label: 'prepared then changed', p: [x, 0, 82], yaw: seq / 10,
    } };
  }
  draft.hash = nextEntityPhysics((engine.world as unknown as { entityPhysicsV1?: EntityPhysicsV1 }).entityPhysicsV1, draft).hash;
  assert.equal(engine.applyWorldEditV1(draft).hash, draft.hash);
}

function verifyTakes(engine: MarsEngine) {
  const chunks = engine.takeChunks(-1);
  for (const chunk of chunks) {
    const take = chunk.take as Take;
    assert.equal(hashOf(take.finalState), take.finalStateHash, `fresh final-state hash at ${chunk.toTick}`);
    assert.equal(takeIdOf(take), take.id, `content address at ${chunk.toTick}`);
    assert.equal(take.startTick, chunk.fromTick);
    assert.equal(take.ticks, chunk.toTick - chunk.fromTick);
    assert.ok(engine.takeScene(take.renderSceneRef!.hash));
  }
  return structuredClone(chunks);
}

test('serving preparation runs once without changing state, events, take baseline, recorder or observers', t => {
  let engine = create('serving-preparation-owned');
  engine.spawnHuman({ id: 'actor', label: 'Ada', soul: 's_actor' });
  edit(engine, 0, 78);
  engine = factory.restore(engine.snapshot()) as MarsEngine;
  const internals = inside(engine), recorder = internals.recorder, observers = [...internals.rt.observers];
  const capture = () => ({ tick: engine.world.tick, hash: engine.stateHash(), world: structuredClone(engine.world),
    events: structuredClone(internals.rt.events), chunks: structuredClone(engine.takeChunks(-1)), snapshot: engine.snapshot(),
    startTick: recorder.startTick, baseline: recorder.baselineStateHash });
  const before = capture(), priming = t.mock.method(internals.m, 'finalStateOf');
  assert.equal(engine.prepareForServing(), undefined);
  assert.equal(engine.prepareForServing(), undefined);
  assert.equal(priming.mock.callCount(), 1);
  assert.equal(internals.recorder, recorder);
  assert.deepEqual(internals.rt.observers, observers);
  assert.deepEqual(capture(), before);
  engine.step(); engine.prepareForServing();
  assert.equal(priming.mock.callCount(), 1, 'the hook does not become recurring work after the world advances');
  assert.equal(internals.recorder, recorder);
  assert.equal(engine.takeChunks(-1).length, 0, 'preparation never cuts the still-open take');
});

test('a failed first preparation propagates and can retry without cutting or changing the world', t => {
  const engine = create('serving-preparation-retry'), internals = inside(engine);
  edit(engine, 0, 78);
  const prepare = internals.m.finalStateOf, before = engine.snapshot(), recorder = internals.recorder;
  let attempts = 0;
  t.mock.method(internals.m, 'finalStateOf', (world: unknown) => {
    if (++attempts === 1) throw new Error('test preparation failure');
    return prepare(world);
  });
  assert.throws(() => engine.prepareForServing(), /test preparation failure/);
  assert.deepEqual(engine.snapshot(), before); assert.equal(internals.recorder, recorder);
  engine.prepareForServing(); engine.prepareForServing();
  assert.equal(attempts, 2);
  assert.deepEqual(engine.snapshot(), before); assert.equal(internals.recorder, recorder);
  assert.equal(engine.takeChunks(-1).length, 0);
});

for (const forcedCuts of [false, true]) test(`primed and unprimed takes agree through motion/static edits${forcedCuts ? ' and forced cuts' : ' at ticks 20/40'}`, () => {
  const primed = create(`serving-parity-${forcedCuts}`), plain = create(`serving-parity-${forcedCuts}`);
  for (const engine of [primed, plain]) {
    engine.spawnHuman({ id: 'actor', label: 'Ada', soul: 's_actor' });
    edit(engine, 0, 78);
  }
  const initialPose = structuredClone(primed.world.entities.actor.pose);
  primed.prepareForServing();
  const primedEvents: unknown[] = [], plainEvents: unknown[] = [];
  for (let tick = 0; tick < 60; tick++) {
    for (const engine of [primed, plain]) {
      if (tick === 3) assert.ok(engine.perform({ actor: 'actor', label: 'stroll', steps: [{ verb: 'ambient_wander', params: { seconds: 5, radius: 2 } }] }).ok);
      if (tick === 8) edit(engine, 1, 80);
      if (tick === 11) {
        engine.world.entities.actor.label = 'Ada changed after preparation';
        engine.world.entities.actor.provenance.note = 'nested live data changed after preparation';
      }
      if (tick === 28) edit(engine, 2, 82);
      if (tick === 35) edit(engine, 3, null);
      if (forcedCuts && (tick === 12 || tick === 31)) engine.configureClock({ origin: tick, dayTicks: 72000 });
    }
    primedEvents.push(primed.step()); plainEvents.push(plain.step());
    assert.equal(primed.stateHash(), plain.stateHash(), `world hash at ${tick + 1}`);
    assert.deepEqual(inside(primed).rt.events, inside(plain).rt.events, `runtime events at ${tick + 1}`);
    if ((tick + 1) % 20 === 0) assert.deepEqual(verifyTakes(primed), verifyTakes(plain), `all chunks at ${tick + 1}`);
  }
  assert.notDeepEqual(primed.world.entities.actor.pose, initialPose, 'the intervening motion actually changed live geometry');
  assert.deepEqual(primedEvents, plainEvents);
  assert.deepEqual(primed.world, plain.world);
  assert.deepEqual(primed.runtime.violations, []);
  assert.deepEqual(plain.runtime.violations, []);
  const chunks = verifyTakes(primed);
  assert.deepEqual(chunks.map(c => [c.fromTick, c.toTick]), forcedCuts ? [[0, 12], [12, 31], [31, 51]] : [[0, 20], [20, 40], [40, 60]]);
});
