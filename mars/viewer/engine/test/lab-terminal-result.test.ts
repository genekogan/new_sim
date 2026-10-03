import test from 'node:test';
import assert from 'node:assert/strict';
import { LabSim } from '../../app/lab/sim.ts';
import { SCENARIOS, type Scenario } from '../../app/lab/scenarios.ts';
import { human } from '../world/factory.ts';
import { READING_SCENE } from '../scenarios/reading.ts';
import { DT } from '../runtime/runtime.ts';

function fixture(overrides: Partial<Scenario> = {}) {
  const scenario: Scenario = {
    name: 'terminal-result-fixture',
    title: 'Hypothetical terminal observation regression',
    description:
      'An authored boundary while an ordinary independent walk continues.',
    scene: () => READING_SCENE,
    humans: () => [human('walker', -4, -4)],
    start: (rt) => {
      rt.submit('walk_to', { actor: 'walker', x: 3, z: -4 });
    },
    done: (rt) => rt.tick >= 2,
    maxTicks: 20,
    focus: [0, 0, 8],
    expect: () => [],
    ...overrides,
  };
  const sim = new LabSim();
  load(sim, scenario);
  return sim;
}

function load(sim: LabSim, scenario: Scenario) {
  SCENARIOS.push(scenario);
  try {
    sim.load(scenario.name);
  } finally {
    SCENARIOS.splice(SCENARIOS.indexOf(scenario), 1);
  }
}

test('exact terminal result matches deterministic reference while the same frame keeps ticking', () => {
  const reference = fixture();
  reference.stepN(2);
  const expected = {
    tick: 2,
    time: 2 * DT,
    stateHash: reference.rt.stateHash(),
    reason: 'terminal',
  };
  assert.deepEqual(reference.scriptResult, expected);
  const sim = fixture();
  sim.speed = 4;
  sim.advance(0.25);
  assert.ok(
    sim.rt.tick > expected.tick,
    'world continues within the same real frame',
  );
  assert.deepEqual(sim.scriptResult, expected);
  assert.notEqual(sim.rt.stateHash(), expected.stateHash);
  assert.equal(Object.isFrozen(sim.scriptResult), true);
  assert.throws(() => {
    Object.assign(sim.scriptResult!, { tick: 900 });
  }, TypeError);
  const receipt = sim.scriptResult;
  const walk = [...sim.rt.records.values()][0];
  for (let i = 0; i < 200 && walk.status !== 'completed'; i++) sim.advance(DT);
  assert.equal(walk.status, 'completed');
  assert.equal(sim.scriptResult, receipt);
  assert.deepEqual(sim.rt.violations, []);
  assert.deepEqual(sim.rt.holder('actor:walker'), []);
});

test('empty and admission-refused scripts retain their exact initial result without stopping the world', () => {
  for (const refused of [false, true]) {
    const sim = fixture({
      start: () => {},
      done: () => true,
      admission: refused
        ? () => ({
            code: 'fixture.unavailable',
            message: 'Declared source unavailable.',
          })
        : undefined,
    });
    const initialHash = sim.rt.stateHash();
    assert.deepEqual(sim.scriptResult, {
      tick: 0,
      time: 0,
      stateHash: initialHash,
      reason: refused ? 'admission-refused' : 'terminal',
    });
    sim.advance(DT);
    assert.equal(sim.rt.tick, 1);
    assert.equal(sim.scriptResult!.stateHash, initialHash);
    assert.deepEqual(sim.rt.violations, []);
  }
});

test('validation budget records its exact boundary; Pause and Reset retain their documented meanings', () => {
  const sim = fixture({ continuous: true, done: undefined, maxTicks: 2 });
  sim.speed = 4;
  sim.advance(0.25);
  assert.equal(sim.scriptResult!.reason, 'budget');
  assert.equal(sim.scriptResult!.tick, 2);
  assert.equal(sim.scriptResult!.time, 2 * DT);
  assert.ok(sim.rt.tick > 2);
  const hash = sim.rt.stateHash();
  sim.paused = true;
  sim.advance(0.25);
  assert.equal(sim.rt.stateHash(), hash);
  const scenario = sim.scenario;
  load(sim, scenario);
  assert.equal(sim.rt.tick, 0);
  assert.equal(sim.scriptResult, null);
  sim.step();
  assert.equal(sim.rt.tick, 1);
  assert.equal(sim.scriptResult, null);
});

test('a later unexpected observer fault invalidates the receipt and quarantines actual state', () => {
  const sim = fixture();
  sim.stepN(2);
  assert.ok(sim.scriptResult);
  sim.onTick = () => {
    throw new Error('fixture.observer-fault');
  };
  sim.step();
  assert.equal(sim.halted?.code, 'lab.executor-fault');
  assert.equal(sim.halted?.details?.phase, 'lab.onTick');
  assert.equal(sim.scriptResult, null);
  const hash = sim.rt.stateHash();
  sim.advance(0.25);
  assert.equal(sim.rt.stateHash(), hash);
});

test('a later recorded invariant invalidates a prior boundary without certifying corrupt execution', () => {
  const sim = fixture();
  sim.stepN(2);
  assert.ok(sim.scriptResult);
  // Explicit test-only recorded corruption: hosts must contain even pre-existing receipts.
  sim.rt.violations.push({
    tick: sim.rt.tick,
    code: 'fixture.invariant',
    message: 'Injected containment proof.',
    subjects: ['walker'],
  });
  const hash = sim.rt.stateHash();
  sim.step();
  assert.equal(sim.halted?.code, 'lab.invariant-halt');
  assert.equal(sim.scriptResult, null);
  assert.equal(sim.rt.stateHash(), hash);
});

test('a failed fresh-world builder preserves the prior scenario/runtime pair and ordinary commitments', () => {
  const sim = fixture({ done: () => false });
  sim.step();
  const prior = {
    scenario: sim.scenario,
    runtime: sim.rt,
    epoch: sim.scenarioEpoch,
    hash: sim.rt.stateHash(),
  };
  const original = new TypeError('fixture.builder-fault');
  const invalid = {
    ...sim.scenario,
    name: 'failed-builder-fixture',
    build: () => {
      throw original;
    },
  };
  assert.throws(
    () => load(sim, invalid),
    (error) => error === original,
  );
  assert.equal(sim.scenario, prior.scenario);
  assert.equal(sim.rt, prior.runtime);
  assert.equal(sim.scenarioEpoch, prior.epoch);
  assert.equal(sim.rt.stateHash(), prior.hash);
  assert.equal(sim.halted, null);
  const walk = [...sim.rt.records.values()][0];
  for (let i = 0; i < 200 && walk.status !== 'completed'; i++) sim.advance(DT);
  assert.equal(walk.status, 'completed');
  assert.deepEqual(sim.rt.violations, []);
});
