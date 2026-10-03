import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { LabSim } from '../../app/lab/sim.ts';
import { SCENARIOS, type Scenario } from '../../app/lab/scenarios.ts';
import type { ActionDef } from '../actions/types.ts';
import { Runtime, DT } from '../runtime/runtime.ts';
import { Spatial } from '../spatial/service.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { walkTo } from '../locomotion/walk.ts';
import { emptyWorld, addAll, human } from '../world/factory.ts';
import { READING_SCENE } from '../scenarios/reading.ts';
function fixture(overrides: Partial<Scenario> = {}) {
  const s: Scenario = {
    name: 'executor-fault-test',
    title: 'Hypothetical executor fault',
    description:
      'Deliberate synchronous exception, not an intentional action refusal',
    scene: () => READING_SCENE,
    humans: () => [human('walker', -4, -4)],
    start: (rt) => {
      rt.submit('walk_to', { actor: 'walker', x: 4, z: -4 });
    },
    continuous: true,
    maxTicks: 1000,
    focus: [0, 0, 8],
    expect: () => [{ ok: true, message: 'fixture normally valid' }],
    ...overrides,
  };
  SCENARIOS.push(s);
  const sim = new LabSim();
  try {
    sim.load(s.name);
  } finally {
    SCENARIOS.splice(SCENARIOS.indexOf(s), 1);
  }
  return sim;
}
function fault(sim: LabSim, phase: string, original: Error | string) {
  assert.equal(sim.halted?.code, 'lab.executor-fault');
  assert.equal(sim.halted?.details?.phase, phase);
  assert.equal(sim.halted?.details?.scenario, 'executor-fault-test');
  assert.equal(sim.halted?.details?.tick, sim.rt.tick);
  assert.equal(
    sim.halted?.details?.message,
    original instanceof Error ? original.message : original,
  );
  if (original instanceof Error) {
    assert.equal(sim.halted?.details?.name, original.name);
    assert.equal(sim.halted?.details?.stack, original.stack);
  }
  assert.match(sim.halted!.message, /reset to a fresh world/);
  assert.match(sim.halted!.message, /partial.*unknown/);
  assert.ok(
    sim.log.some(
      (l) =>
        l.level === 'error' &&
        l.text.includes('lab.executor-fault') &&
        l.text.includes(
          original instanceof Error ? original.message : original,
        ),
    ),
  );
  assert.ok(sim.diagnostics.some((l) => l.text.includes('lab.executor-fault')));
  assert.equal(
    sim.done(),
    false,
    'quarantine is not successful script completion',
  );
  assert.ok(sim.checks().length > 0);
  assert.ok(sim.checks().every((c) => !c.ok));
  const before = {
    hash: sim.rt.stateHash(),
    records: structuredClone([...sim.rt.records.values()]),
    events: structuredClone(sim.rt.events),
    holders: sim.rt.holder('actor:walker'),
    diagnostics: structuredClone(sim.diagnostics),
  };
  assert.doesNotThrow(() => {
    sim.advance(0.25);
    sim.step();
    sim.stepN(20);
    sim.done();
    sim.checks();
  });
  assert.deepEqual(
    {
      hash: sim.rt.stateHash(),
      records: [...sim.rt.records.values()],
      events: sim.rt.events,
      holders: sim.rt.holder('actor:walker'),
      diagnostics: sim.diagnostics,
    },
    before,
  );
}

test('throwing executor preserves partial tick, active records/claims and original exception without unsafe cleanup', () => {
  const original = new TypeError(
    'deliberate executor fault after prior walker progress',
  );
  let cancels = 0,
    callbacks = 0;
  const throwing: ActionDef<Record<string, never>, null, null> = {
    verb: 'throw_fixture',
    description: 'test-only logical fault injector',
    schema: z.strictObject({}),
    reservations: () => [{ resource: 'fixture:throw', mode: 'exclusive' }],
    plan: () => ({ ok: true, program: null }),
    start: () => null,
    step: (rt) => {
      rt.mark('before-executor-throw');
      throw original;
    },
    cancel: () => {
      cancels++;
      return { ok: true };
    },
  };
  const sim = fixture({
    build: () =>
      new Runtime(
        addAll(
          emptyWorld('executor-fault', READING_SCENE),
          human('walker', -4, -4),
        ),
        new Map<string, ActionDef>([
          ['walk_to', walkTo],
          [throwing.verb, throwing],
        ]),
        { spatial: new Spatial(READING_SCENE) },
        DEFAULT_INVARIANTS,
      ),
    start: (rt) => {
      rt.submit('walk_to', { actor: 'walker', x: 4, z: -4 });
      rt.submit(throwing.verb, {});
    },
    tick: () => {
      callbacks++;
    },
  });
  const initial = [...sim.rt.world.entities.walker.pose.p];
  assert.doesNotThrow(() => sim.advance(DT));
  assert.equal(sim.rt.tick, 1);
  assert.notDeepEqual(sim.rt.world.entities.walker.pose.p, initial);
  assert.ok(
    sim.rt.events.some(
      (e) => e.type === 'mark' && e.name === 'before-executor-throw',
    ),
  );
  assert.equal(sim.rt.records.size, 2);
  assert.ok(
    [...sim.rt.records.values()].every(
      (r) => r.status === 'executing' && r.endedTick === undefined,
    ),
  );
  assert.equal(sim.rt.holder('actor:walker').length, 1);
  assert.equal(sim.rt.holder('fixture:throw').length, 1);
  fault(sim, 'runtime.step', original);
  assert.equal(cancels, 0);
  assert.equal(callbacks, 0);
  const old = sim.rt,
    epoch = sim.scenarioEpoch;
  sim.paused = true;
  sim.load('wall');
  assert.notEqual(sim.rt, old);
  assert.equal(sim.scenarioEpoch, epoch + 1);
  assert.equal(sim.halted, null);
  assert.equal(sim.scriptStopReason, null);
  assert.equal(sim.paused, true);
  sim.step();
  assert.equal(sim.rt.tick, 1);
  assert.deepEqual(sim.rt.violations, []);
  assert.equal(
    old.holder('fixture:throw').length,
    1,
    'discarded fault world was not falsely cleaned',
  );
});

test('scenario tick throw is quarantined after real ordinary progress and never redispatched', () => {
  const original = new Error('scenario tick crashed after native runtime step');
  let calls = 0;
  const sim = fixture({
    tick: (rt) => {
      calls++;
      rt.mark('before-scenario-throw');
      throw original;
    },
  });
  const initial = [...sim.rt.world.entities.walker.pose.p];
  assert.doesNotThrow(() => sim.advance(DT));
  assert.notDeepEqual(sim.rt.world.entities.walker.pose.p, initial);
  fault(sim, 'scenario.tick', original);
  assert.equal(calls, 1);
  assert.deepEqual(sim.rt.violations, []);
});

for (const phase of ['scenario.admission', 'scenario.start'] as const)
  test(`${phase} unexpected throw after valid Runtime construction is visible without rollback`, () => {
    const original = new Error(`deliberate ${phase} failure`);
    const sim = fixture(
      phase === 'scenario.admission'
        ? {
            admission: () => {
              throw original;
            },
          }
        : {
            start: (rt) => {
              rt.submit('walk_to', { actor: 'walker', x: 4, z: -4 });
              throw original;
            },
          },
    );
    assert.equal(sim.rt.tick, 0);
    fault(sim, phase, original);
    assert.equal(
      sim.rt.holder('actor:walker').length,
      phase === 'scenario.start' ? 1 : 0,
    );
  });

test('faulting completion predicate and expectation cannot be retried by UI readout callbacks', () => {
  const original = new Error('completion predicate unavailable');
  let calls = 0;
  const sim = fixture({
    continuous: false,
    done: () => {
      calls++;
      throw original;
    },
  });
  fault(sim, 'scenario.done', original);
  assert.equal(calls, 1);
  const expectation = new Error('expectation callback unavailable');
  let expects = 0;
  const other = fixture({
    expect: () => {
      expects++;
      throw expectation;
    },
  });
  assert.doesNotThrow(() => other.checks());
  fault(other, 'scenario.expect', expectation);
  assert.equal(expects, 1);
});

test('post-tick observer exception remains an unexpected fault with a retained completed runtime tick', () => {
  const original = new Error('host observation failed');
  let observed = 0;
  const sim = fixture();
  sim.onTick = () => {
    observed++;
    throw original;
  };
  assert.doesNotThrow(() => sim.advance(DT));
  assert.equal(sim.rt.tick, 1);
  fault(sim, 'lab.onTick', original);
  assert.equal(observed, 1);
});

test('non-Error synchronous throw remains explicit without fabricated stack or success', () => {
  const sim = fixture({
    tick: () => {
      throw 'deliberate non-Error failure';
    },
  });
  assert.doesNotThrow(() => sim.step());
  fault(sim, 'scenario.tick', 'deliberate non-Error failure');
  assert.equal(sim.halted?.details?.name, 'NonErrorThrow');
  assert.equal(sim.halted?.details?.stack, null);
});

test('ordinary named action refusal does not become an executor quarantine or freeze another actor', () => {
  const sim = fixture({
    start: (rt) => {
      rt.submit('walk_to', { actor: 'missing', x: 2, z: 2 });
      rt.submit('walk_to', { actor: 'walker', x: 4, z: -4 });
    },
  });
  const [refusal, walk] = [...sim.rt.records.values()];
  for (let i = 0; i < 300 && walk.status !== 'completed'; i++) sim.advance(DT);
  assert.equal(refusal.status, 'failed');
  assert.equal(refusal.diagnostic?.code, 'entity.unknown');
  assert.equal(walk.status, 'completed');
  assert.equal(sim.halted, null);
  assert.deepEqual(sim.rt.violations, []);
  assert.deepEqual(sim.rt.holder('actor:walker'), []);
});

test('explicit sustained script guard still dispatches after its validation budget', () => {
  let ticks = 0;
  const sim = fixture({
    execution: 'sustained',
    continuous: true,
    maxTicks: 2,
    tick: () => {
      ticks++;
    },
  });
  for (let i = 0; i < 6; i++) sim.advance(DT);
  assert.equal(sim.rt.tick, 6);
  assert.equal(ticks, 6);
  assert.equal(sim.scriptStopReason, null);
  assert.equal(sim.halted, null);
});

test('observer throw on a violating tick preserves both original invariant and unexpected exception', () => {
  const original = new Error(
    'observer crashed inspecting the first invalid tick',
  );
  const sim = fixture({
    build: () =>
      new Runtime(
        addAll(
          emptyWorld('invalid-observer-fixture', READING_SCENE),
          human('walker', 0, 0),
          human('other', 0, 0),
        ),
        new Map([['walk_to', walkTo]]),
        { spatial: new Spatial(READING_SCENE) },
        DEFAULT_INVARIANTS,
      ),
    start: () => {},
  });
  sim.onTick = () => {
    throw original;
  };
  assert.doesNotThrow(() => sim.advance(DT));
  assert.equal(sim.halted?.code, 'lab.invariant-halt');
  assert.ok(sim.rt.violations.length > 0);
  assert.equal(
    (sim.halted?.details?.executorFault as { message?: string })?.message,
    original.message,
  );
  assert.ok(sim.diagnostics.some((l) => l.text.includes('VIOLATION')));
  assert.ok(
    sim.diagnostics.some(
      (l) =>
        l.text.includes('lab.executor-fault') &&
        l.text.includes(original.stack!),
    ),
  );
  const state = sim.rt.stateHash(),
    diagnostic = structuredClone(sim.halted);
  sim.step();
  sim.advance(0.25);
  assert.equal(sim.rt.stateHash(), state);
  assert.deepEqual(sim.halted, diagnostic);
  assert.ok(sim.checks().every((c) => !c.ok));
});

test('completion predicate throwing after a native tick cannot dispatch scenario or observation callbacks', () => {
  const original = new Error('completion predicate crashed after progress');
  let predicates = 0,
    scripts = 0,
    observations = 0;
  const sim = fixture({
    continuous: false,
    done: () => {
      predicates++;
      if (predicates === 3) throw original;
      return false;
    },
    tick: () => {
      scripts++;
    },
  });
  sim.onTick = () => {
    observations++;
  };
  assert.doesNotThrow(() => sim.advance(DT));
  assert.equal(sim.rt.tick, 1);
  fault(sim, 'scenario.done', original);
  assert.equal(predicates, 3);
  assert.equal(scripts, 0);
  assert.equal(observations, 0);
});
