import test from 'node:test';
import assert from 'node:assert/strict';
import { createController, ENGINE_SCENES, seedHistory } from '../api/index.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import type { Invariant } from '../runtime/runtime.ts';

// Explicit injected invariant receipt tests the hosting boundary. It does not
// claim an ordinary walk creates corruption or replace physical invariant tests.
const fixtureViolation: Invariant = (rt) =>
  rt.tick >= 1
    ? [
        {
          code: 'fixture.serious-corruption',
          message: 'injected quarantine witness',
          subjects: ['n1'],
        },
      ]
    : [];

for (const pauseAt of [undefined, 0.05, 1]) {
  test(`control-plane corruption cannot commit or continue a private run (${pauseAt ?? 'unpaused'})`, () => {
    let inject = true;
    const c = createController({
      history: seedHistory(),
      scenes: ENGINE_SCENES,
      invariants: [
        ...DEFAULT_INVARIANTS,
        (rt) => (inject ? fixtureViolation(rt) : []),
      ],
    });
    assert.equal(
      c.call('fork', { from: 'proving-ground', name: 'alpha' }).ok,
      true,
    );
    const bound = c.call('bind_plan', {
      workspace: 'alpha',
      bindings: {},
      template: {
        schema: 'mars-sequence/1',
        id: 'quarantine',
        params: {},
        steps: [
          {
            id: 'walk',
            verb: 'walk_to',
            params: { actor: 'n1', x: 15, z: -10.5 },
          },
        ],
      },
    });
    assert.equal(bound.ok, true, JSON.stringify(bound));
    const head = c.history.head('alpha').id;
    const result = c.call('execute', {
      workspace: 'alpha',
      plan_id: bound.plan_id,
      ...(pauseAt === undefined ? {} : { pauseAt }),
    });
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.code, 'execution.failed');
    assert.equal(
      c.history.head('alpha').id,
      head,
      'invalid world must never become a pause or final checkpoint',
    );
    const take = c.take(result.take_id as string)!;
    assert.ok(take, 'failed private run remains inspectable');
    assert.equal(
      take.finalState.tick,
      1,
      'no invalid-state cleanup or continuation ticks',
    );
    assert.equal(take.events.filter((e) => e.type === 'violation').length, 1);
    inject = false;
    const healthy = c.call('execute', {
      workspace: 'alpha',
      plan_id: bound.plan_id,
    });
    assert.equal(healthy.ok, true, JSON.stringify(healthy));
    assert.notEqual(
      c.history.head('alpha').id,
      head,
      'unrelated subsequent operations remain usable from the valid workspace',
    );
  });
}

test('a valid pause can resume into quarantine without overwriting its valid head', () => {
  const c = createController({
    history: seedHistory(),
    scenes: ENGINE_SCENES,
    invariants: [...DEFAULT_INVARIANTS, fixtureViolation],
  });
  assert.equal(
    c.call('fork', { from: 'proving-ground', name: 'alpha' }).ok,
    true,
  );
  const bound = c.call('bind_plan', {
    workspace: 'alpha',
    bindings: {},
    template: {
      schema: 'mars-sequence/1',
      id: 'quarantine-resume',
      params: {},
      steps: [
        {
          id: 'walk',
          verb: 'walk_to',
          params: { actor: 'n1', x: 15, z: -10.5 },
        },
      ],
    },
  });
  assert.equal(bound.ok, true);
  const pause = c.call('execute', {
    workspace: 'alpha',
    plan_id: bound.plan_id,
    pauseAt: { step: 'walk', event: 'started' },
  });
  assert.equal(pause.ok, true, JSON.stringify(pause));
  const validHead = c.history.head('alpha').id;
  const resumed = c.call('resume', { workspace: 'alpha', until: 0.05 });
  assert.equal(resumed.ok, false, JSON.stringify(resumed));
  assert.equal(resumed.code, 'execution.failed');
  assert.equal(c.history.head('alpha').id, validHead);
  assert.equal(c.take(resumed.take_id as string)!.finalState.tick, 1);
});
