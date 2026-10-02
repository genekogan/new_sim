import test from 'node:test';
import assert from 'node:assert/strict';
import { LabSim } from '../../app/lab/sim.ts';
import { SCENARIOS, type Scenario } from '../../app/lab/scenarios.ts';
import {
  readingRuntime,
  READING_SCENE,
  READING_BINDING,
} from '../scenarios/reading.ts';
import { Runtime, DT } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { walkTo } from '../locomotion/walk.ts';
import { emptyWorld, addAll, human } from '../world/factory.ts';
import { TERMINAL } from '../actions/types.ts';

function fixture(overrides: Partial<Scenario> = {}) {
  const scenario: Scenario = {
    name: 'liveness-test',
    title: 'Hypothetical driver regression',
    description: 'Two ordinary independent walkers',
    scene: () => READING_SCENE,
    humans: () => [human('a', -4, -4), human('b', -4, 4)],
    start: () => {},
    maxTicks: 1000,
    focus: [0, 0, 8],
    expect: () => [],
    ...overrides,
  };
  SCENARIOS.push(scenario);
  const sim = new LabSim();
  try {
    sim.load(scenario.name);
  } finally {
    SCENARIOS.splice(SCENARIOS.indexOf(scenario), 1);
  }
  return sim;
}
function playUntil(sim: LabSim, done: () => boolean, limit = 400) {
  for (let i = 0; i < limit && !done(); i++) sim.advance(DT);
  assert.ok(done(), `bounded driver progress at tick ${sim.rt.tick}`);
}
function clean(sim: LabSim, actor: string) {
  assert.deepEqual(sim.rt.violations, []);
  assert.deepEqual(sim.rt.holder(`actor:${actor}`), []);
  assert.equal(sim.rt.world.entities[actor].human!.activity, 'idle');
}

test('empty and refused scripts leave ordinary world clock usable without retry dispatch', () => {
  for (const refused of [false, true]) {
    let dispatches = 0;
    const sim = fixture({
      admission: refused
        ? () => ({
            code: 'fixture.unavailable',
            message: 'declared source is unavailable',
            subjects: ['source'],
          })
        : undefined,
      start: () => {
        dispatches++;
      },
      tick: () => {
        dispatches++;
      },
    });
    assert.equal(sim.done(), true);
    assert.equal(
      sim.scriptStopReason,
      refused ? 'admission-refused' : 'terminal',
    );
    sim.advance(DT);
    assert.equal(sim.rt.tick, 1);
    const walk = sim.rt.submit('walk_to', { actor: 'b', x: 3, z: 4 });
    playUntil(sim, () => walk.status === 'completed');
    assert.equal(dispatches, refused ? 0 : 1);
    if (refused)
      assert.ok(
        sim.diagnostics.some((d) => d.text.includes('fixture.unavailable')),
      );
    clean(sim, 'b');
  }
});

test('custom terminal journey cannot freeze another actor or redispatch after terminal', () => {
  let ticks = 0;
  const sim = fixture({
    start: (rt) => {
      rt.submit('walk_to', { actor: 'missing', x: 2, z: 2 });
      rt.submit('walk_to', { actor: 'b', x: 3, z: 4 });
    },
    done: (rt) => TERMINAL.has([...rt.records.values()][0].status),
    tick: () => {
      ticks++;
    },
  });
  const [failed, walk] = [...sim.rt.records.values()];
  assert.equal(failed.status, 'failed');
  assert.ok(failed.diagnostic);
  assert.equal(sim.done(), true);
  playUntil(sim, () => walk.status === 'completed');
  assert.equal(ticks, 0);
  assert.ok(
    sim.diagnostics.some(
      (d) => d.level === 'error' && d.text.includes(failed.diagnostic!.code),
    ),
  );
  clean(sim, 'b');
});

test('real reading child failure drains posture while independent walk progresses', () => {
  let cancelledSeat = false;
  const sim = fixture({
    build: () => readingRuntime(),
    start: (rt) => {
      rt.submit('read_book', READING_BINDING);
      rt.submit('walk_to', { actor: 'visitor', x: 4, z: -4 });
    },
    done: (rt) =>
      TERMINAL.has(
        [...rt.records.values()].find((r) => r.verb === 'read_book')!.status,
      ),
    tick: (rt) => {
      const seat = [...rt.records.values()].find((r) => r.verb === 'sit');
      if (!cancelledSeat && seat?.phase === 'occupied') {
        cancelledSeat = true;
        rt.cancel(seat.id);
      }
    },
  });
  const reading = [...sim.rt.records.values()].find(
    (r) => r.verb === 'read_book',
  )!;
  playUntil(sim, () => reading.status === 'failed');
  assert.equal(reading.diagnostic?.code, 'reading.seat-released');
  const stoppedAt = sim.rt.tick;
  const independent = [...sim.rt.records.values()].find(
    (r) =>
      r.verb === 'walk_to' &&
      (r.params as { actor?: string }).actor === 'visitor',
  )!;
  assert.ok(sim.rt.isActive(independent.id));
  playUntil(sim, () => independent.status === 'completed');
  const later = sim.rt.submit('walk_to', { actor: 'visitor', x: -4, z: -4 });
  playUntil(sim, () => later.status === 'completed');
  assert.ok(sim.rt.tick > stoppedAt);
  assert.ok(
    sim.diagnostics.some((d) => d.text.includes('reading.seat-released')),
  );
  clean(sim, 'reader');
  clean(sim, 'visitor');
  assert.equal(
    [...sim.rt.records.values()].filter((r) => !TERMINAL.has(r.status)).length,
    0,
  );
});

test('script budget ends dispatch but ordinary actions continue; manual pause and Step remain distinct', () => {
  let ticks = 0;
  const sim = fixture({
    continuous: true,
    maxTicks: 2,
    tick: () => {
      ticks++;
    },
  });
  sim.stepN(10);
  assert.equal(sim.rt.tick, 2);
  assert.equal(ticks, 1);
  assert.equal(sim.scriptStopReason, 'budget');
  const walk = sim.rt.submit('walk_to', { actor: 'b', x: 3, z: 4 });
  sim.paused = true;
  sim.advance(0.25);
  assert.equal(sim.rt.tick, 2);
  sim.step();
  assert.equal(sim.rt.tick, 3);
  assert.equal(ticks, 1);
  sim.paused = false;
  playUntil(sim, () => walk.status === 'completed');
  assert.equal(ticks, 1);
  clean(sim, 'b');
});

test('terminal physical tick is observed once without further scripted dispatch', () => {
  let ticks = 0,
    observations = 0;
  const sim = fixture({
    start: (rt) => {
      rt.submit('walk_to', { actor: 'a', x: -2, z: -4 });
    },
    tick: () => {
      ticks++;
    },
  });
  sim.onTick = () => {
    observations++;
  };
  playUntil(sim, () => sim.done());
  const finishedTicks = ticks;
  assert.equal(finishedTicks, sim.rt.tick - 1);
  assert.equal(observations, sim.rt.tick);
  const walk = sim.rt.submit('walk_to', { actor: 'b', x: 3, z: 4 });
  playUntil(sim, () => walk.status === 'completed');
  assert.equal(ticks, finishedTicks);
});

test('serious invariant violation visibly halts automatic and manual stepping until fresh reset', () => {
  let scripts = 0,
    observations = 0;
  const sim = fixture({
    continuous: true,
    build: () =>
      new Runtime(
        addAll(
          emptyWorld('invalid-fixture', READING_SCENE),
          human('a', 0, 0),
          human('b', 0, 0),
        ),
        new Map([['walk_to', walkTo]]),
        { spatial: new Spatial(READING_SCENE) },
        DEFAULT_INVARIANTS,
      ),
    tick: () => {
      scripts++;
    },
  });
  sim.onTick = () => {
    observations++;
  };
  sim.advance(DT);
  assert.ok(sim.rt.violations.length > 0);
  assert.equal(sim.halted?.code, 'lab.invariant-halt');
  assert.ok(sim.diagnostics.some((d) => d.text.includes('VIOLATION')));
  assert.ok(sim.diagnostics.some((d) => d.text.includes('reset')));
  assert.equal(scripts, 0);
  assert.equal(observations, 1);
  const state = sim.rt.stateHash(),
    tick = sim.rt.tick;
  sim.advance(0.25);
  sim.step();
  sim.stepN(10);
  assert.equal(sim.rt.tick, tick);
  assert.equal(sim.rt.stateHash(), state);
  assert.equal(observations, 1);
  assert.ok(
    sim.checks().some((c) => !c.ok && c.message.includes('lab.invariant-halt')),
  );
  const epoch = sim.scenarioEpoch;
  sim.paused = true;
  sim.load('wall');
  assert.equal(sim.scenarioEpoch, epoch + 1);
  assert.equal(sim.halted, null);
  assert.equal(sim.scriptStopReason, null);
  assert.equal(sim.paused, true);
  sim.paused = false;
  sim.advance(DT);
  assert.equal(sim.rt.tick, 1);
  assert.deepEqual(sim.rt.violations, []);
});

test('continued authoritative ticks replay deterministically after finite script completion', () => {
  const run = () => {
    const sim = fixture();
    sim.rt.submit('walk_to', { actor: 'b', x: 3, z: 4 });
    for (let i = 0; i < 220; i++) sim.advance(DT);
    clean(sim, 'b');
    assert.equal(sim.rt.tick, 220);
    return {
      hash: sim.rt.stateHash(),
      records: [...sim.rt.records.values()],
      log: sim.log,
    };
  };
  assert.deepEqual(run(), run());
});

test('custom sequence polls and dispatches each stage once before its own terminal boundary', () => {
  let stage = 0,
    ticks = 0;
  const sim = fixture({
    start: (rt) => {
      rt.submit('walk_to', { actor: 'a', x: -2, z: -4 });
    },
    done: () => stage === 2,
    tick: (rt) => {
      ticks++;
      const records = [...rt.records.values()];
      if (stage === 0 && records[0].status === 'completed') {
        stage = 1;
        rt.submit('walk_to', { actor: 'a', x: -4, z: -4 });
      } else if (stage === 1 && records[1].status === 'completed') stage = 2;
    },
  });
  playUntil(sim, () => sim.done());
  assert.equal([...sim.rt.records.values()].length, 2);
  assert.equal(ticks, sim.rt.tick);
  const stopped = ticks;
  sim.advance(0.25);
  sim.step();
  assert.equal(ticks, stopped);
  clean(sim, 'a');
});

test('fixed-DT accumulator and observation calls remain bounded across Pause and frame caps', () => {
  const sim = fixture();
  let observed = 0;
  sim.onTick = () => {
    observed++;
  };
  assert.equal(sim.advance(DT / 2), 0.5);
  assert.equal(sim.rt.tick, 0);
  sim.paused = true;
  assert.equal(sim.advance(0.25), 1);
  assert.equal(sim.rt.tick, 0);
  sim.paused = false;
  sim.advance(DT / 2);
  assert.equal(sim.rt.tick, 1);
  sim.speed = 4;
  sim.advance(0.25, 2);
  assert.equal(sim.rt.tick, 3);
  sim.advance(0);
  assert.equal(sim.rt.tick, 3);
  assert.equal(observed, 3);
  assert.equal(sim.rt.time, 3 * DT);
});

test('pre-existing native invariant receipts prevent script start and remain detached from halt subjects', () => {
  let starts = 0;
  const sim = fixture({
    continuous: true,
    build: () => {
      const rt = new Runtime(
        addAll(
          emptyWorld('invalid-built-fixture', READING_SCENE),
          human('a', 0, 0),
          human('b', 0, 0),
        ),
        new Map([['walk_to', walkTo]]),
        { spatial: new Spatial(READING_SCENE) },
        DEFAULT_INVARIANTS,
      );
      rt.step();
      return rt;
    },
    start: () => {
      starts++;
    },
  });
  assert.equal(starts, 0);
  assert.equal(sim.halted?.code, 'lab.invariant-halt');
  const original = [...sim.rt.violations[0].subjects!];
  sim.halted!.subjects!.push('detached-test');
  assert.deepEqual(sim.rt.violations[0].subjects, original);
  const tick = sim.rt.tick;
  sim.step();
  sim.advance(0.25);
  assert.equal(sim.rt.tick, tick);
});

test('original finite walk, authored construction and expected-refusal preset outcomes remain intact', () => {
  for (const name of ['wall', 'construction', 'incomplete-stairs']) {
    const sim = new LabSim();
    sim.load(name);
    for (let i = 0; i < 2400 && !sim.done() && !sim.halted; i++) sim.step();
    assert.equal(sim.done(), true, name);
    assert.equal(sim.halted ?? null, null, name);
    assert.deepEqual(
      sim.checks().filter((c) => !c.ok),
      [],
      name,
    );
    assert.deepEqual(sim.rt.violations, [], name);
    const count = sim.rt.records.size;
    sim.advance(DT);
    assert.equal(sim.rt.records.size, count, `${name} does not resubmit`);
  }
});
