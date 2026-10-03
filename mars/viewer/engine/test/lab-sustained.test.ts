import test from 'node:test';
import assert from 'node:assert/strict';
import { LabSim } from '../../app/lab/sim.ts';
import { SCENARIOS, stress } from '../../app/lab/scenarios.ts';
import { DT } from '../runtime/runtime.ts';

test('declared sustained life keeps making ordinary commitments after its validation budget and replays', () => {
  const run = () => {
    const scenario = stress(2);
    const sim = new LabSim();
    SCENARIOS.push(scenario);
    try {
      sim.load(scenario.name);
    } finally {
      SCENARIOS.splice(SCENARIOS.indexOf(scenario), 1);
    }
    for (let i = 0; i < scenario.maxTicks; i++) sim.advance(DT);
    const atBudget = sim.rt.records.size;
    assert.equal(sim.done(), true, 'bounded validation window reached');
    assert.equal(
      sim.scriptStopReason,
      null,
      'ongoing dispatch is not a terminal script',
    );
    for (let i = 0; i < 400; i++) sim.advance(DT);
    assert.ok(
      sim.rt.records.size > atBudget,
      'new ordinary commitments after budget',
    );
    assert.ok(
      [...sim.rt.records.values()].some(
        (r) => r.status === 'completed' && r.endedTick! > scenario.maxTicks,
      ),
    );
    assert.deepEqual(sim.rt.violations, []);
    assert.equal(sim.halted, null);
    assert.equal(sim.rt.tick, scenario.maxTicks + 400);
    const beforePause = sim.rt.stateHash();
    sim.paused = true;
    sim.advance(0.25);
    assert.equal(
      sim.rt.stateHash(),
      beforePause,
      'manual Pause still stops the world',
    );
    return { hash: sim.rt.stateHash(), actions: [...sim.rt.records.values()] };
  };
  assert.deepEqual(run(), run());
});
