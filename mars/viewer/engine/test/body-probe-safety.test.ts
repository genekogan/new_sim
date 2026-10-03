import test from 'node:test';
import assert from 'node:assert/strict';
import { LabSim } from '../../app/lab/sim.ts';
import { buildRuntime } from '../../app/lab/scenarios.ts';
import { body } from '../../app/lab/body.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';

const setup = () => { const sim = new LabSim(); sim.load('body'); return sim; };

test('body probe fresh selection and first fixed tick preserve a safe still world', () => {
  const sim = setup(), initial = structuredClone(sim.rt.world.entities);
  assert.equal(sim.rt.tick, 0);
  assert.deepEqual(sim.rt.violations, []);
  for (const check of DEFAULT_INVARIANTS) assert.deepEqual(check(sim.rt), []);
  sim.step();
  assert.equal(sim.rt.tick, 1);
  assert.deepEqual(sim.rt.violations, []);
  assert.deepEqual(sim.rt.world.entities, initial);
  assert.equal(sim.done(), false);
  assert.equal(sim.checks().every(c => c.ok), true);
});

test('body probe Play ticks the same still world and reset repeats its first tick', () => {
  const sim = setup(), initial = structuredClone(sim.rt.world.entities);
  for (let i = 0; i < 20; i++) sim.advance(0.05);
  assert.equal(sim.rt.tick, body.maxTicks);
  assert.equal(sim.done(), true);
  assert.deepEqual(sim.rt.violations, []);
  assert.deepEqual(sim.rt.world.entities, initial);
  const result = { tick: body.maxTicks, time: body.maxTicks * 0.05, stateHash: sim.rt.stateHash(), reason: 'budget' };
  assert.deepEqual(sim.scriptResult, result, 'the original one-second validation window remains exact');
  sim.advance(0.25);
  assert.equal(sim.rt.tick, body.maxTicks + 5, 'authored-window completion no longer freezes the surrounding world');
  assert.deepEqual(sim.scriptResult, result);
  assert.deepEqual(sim.rt.world.entities, initial);
  assert.deepEqual(sim.rt.violations, []);
  sim.load('body');
  assert.equal(sim.rt.tick, 0);
  assert.equal(sim.scriptResult, null);
  assert.deepEqual(sim.rt.world.entities, initial);
  sim.step();
  assert.equal(sim.rt.tick, 1);
  assert.deepEqual(sim.rt.violations, []);
});

test('original invalid deck-edge and stair admissions remain loud named violations', () => {
  const rt = buildRuntime(body);
  for (const id of ['b0', 'b1', 'b2']) rt.world.entities[id].pose.p[0] = 13.8;
  rt.world.entities.g2.pose.p[2] = 10;
  rt.step();
  assert.deepEqual(rt.violations.map(d => [d.code, d.subjects]), [
    ['collision.human-static', ['b0']], ['collision.human-static', ['b1']],
    ['collision.human-static', ['b2']], ['collision.human-static', ['g2']],
  ]);
  for (const d of rt.violations.slice(0, 3)) assert.match(d.message, /clearance 0.15 m.*floor edge/);
  assert.match(rt.violations[3].message, /clearance 0.00 m.*stairs-b-body/);
});
