import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { Spatial } from '../spatial/service.ts';
import {
  DEFAULT_INVARIANTS,
  MAX_HUMAN_STEP_PER_TICK,
} from '../runtime/invariants.ts';
import { dist3 } from '../items/body.ts';
import { angleDelta, type Vec3 } from '../core/math.ts';
import { CATALOG } from '../world/catalog.ts';
import { classroomScene } from '../scenarios/classroom.ts';
import {
  preparationParams,
  preparationRuntime,
} from '../scenarios/preparation.ts';
import {
  prepareFood,
  readFoodPreparation,
} from '../activities/prepare-food.ts';
import { hashOf } from '../core/hash.ts';
import { addAll, human } from '../world/factory.ts';
const params = preparationParams;
function until(rt: Runtime, done: () => boolean, limit = 2400) {
  for (let i = 0; i < limit && !done(); i++) rt.step();
  assert.ok(done(), JSON.stringify([...rt.records.values()]));
  assert.deepEqual(rt.violations, []);
}
function run(rt: Runtime) {
  const rec = rt.submit('prepare_food', params());
  assert.notEqual(rec.status, 'failed', rec.diagnostic?.message);
  until(rt, () => !rt.isActive(rec.id));
  assert.equal(rec.status, 'completed', rec.diagnostic?.message);
  assert.equal(readFoodPreparation(rt, 'pot')!.complete, true);
  released(rt);
  return rec;
}
function total(rt: Runtime) {
  return (
    rt.world.entities.beans.contents!.fraction +
    rt.world.entities.greens.contents!.fraction +
    4 * rt.world.entities.pot.contents!.fraction
  );
}
function released(rt: Runtime) {
  for (const resource of [
    'actor:cook',
    'hand:cook:right',
    'entity:spoon',
    'entity:pot',
    'entity:beans',
    'entity:greens',
    'entity:table',
  ])
    assert.deepEqual(rt.holder(resource), [], resource);
}
for (const [yaw, x, z] of [
  [0, 0, 0],
  [Math.PI / 2, 3, 2],
])
  test(`two finite bowls prepare same supported pot at yaw ${yaw}`, () => {
    const rt = preparationRuntime(yaw, x, z),
      before = ['beans', 'greens', 'pot'].map((id) =>
        hashOf({
          pose: rt.world.entities[id].pose,
          support: rt.world.entities[id].support,
        }),
      );
    const action = rt.submit('prepare_food', params()),
      hands = new Set<string>();
    until(rt, () => {
      assert.equal(total(rt), 2);
      const rec = rt.records.get(action.id)!;
      if (rec.phase === 'mixing')
        hands.add(hashOf(rt.world.entities.cook.human!.hands?.right));
      if (
        rt.world.entities.pot.contents!.fraction > 0 &&
        readFoodPreparation(rt, 'pot')!.mixedTicks < 60
      )
        assert.equal(readFoodPreparation(rt, 'pot')!.complete, false);
      return !rt.isActive(action.id);
    });
    assert.equal(action.status, 'completed', action.diagnostic?.message);
    assert.equal(rt.world.entities.pot.contents!.fraction, 0.5);
    assert.deepEqual(
      ['beans', 'greens', 'pot'].map((id) =>
        hashOf({
          pose: rt.world.entities[id].pose,
          support: rt.world.entities[id].support,
        }),
      ),
      before,
    );
    assert.ok(hands.size > 10);
    assert.equal(readFoodPreparation(rt, 'pot')!.complete, true);
    released(rt);
  });
for (const afterDeposit of [false, true])
  test(`cancel ${afterDeposit ? 'after' : 'before'} deposit retains exact conserved retry progress`, () => {
    const rt = preparationRuntime(),
      rec = rt.submit('prepare_food', params());
    until(rt, () =>
      afterDeposit
        ? rt.world.entities.pot.contents!.fraction > 0
        : rec.phase === 'depositing',
    );
    const quantity = rt.world.entities.pot.contents!.fraction;
    rt.cancel(rec.id);
    until(rt, () => !rt.isActive(rec.id));
    assert.equal(rec.status, 'cancelled');
    assert.equal(rt.world.entities.pot.contents!.fraction, quantity);
    assert.equal(readFoodPreparation(rt, 'pot')!.complete, false);
    assert.equal(total(rt), 2);
    released(rt);
    run(rt);
    assert.equal(total(rt), 2);
    assert.equal(rt.world.entities.pot.contents!.fraction, 0.5);
    assert.equal(
      rt.events.filter(
        (e) => e.type === 'mark' && e.name === 'prepare_food.deposit',
      ).length,
      8,
    );
  });
test('partial mixing survives quiescent JSON persistence and explicit retry', () => {
  const rt = preparationRuntime(),
    rec = rt.submit('prepare_food', params());
  until(rt, () => (readFoodPreparation(rt, 'pot')?.mixedTicks ?? 0) >= 12);
  rt.cancel(rec.id);
  until(rt, () => !rt.isActive(rec.id));
  const world = JSON.parse(JSON.stringify(rt.world)),
    ticks = readFoodPreparation(rt, 'pot')!.mixedTicks;
  const restored = new Runtime(
    world,
    rt.registry,
    { spatial: new Spatial(classroomScene()) },
    DEFAULT_INVARIANTS,
  );
  assert.equal(readFoodPreparation(restored, 'pot')!.mixedTicks, ticks);
  run(restored);
  assert.equal(total(restored), 2);
  assert.equal(readFoodPreparation(restored, 'pot')!.mixedTicks, 60);
});
test('director walk drains preparation children, then runs; explicit retry preserves deposit', () => {
  const rt = preparationRuntime(),
    rec = rt.submit('prepare_food', params());
  until(rt, () => rt.world.entities.pot.contents!.fraction > 0);
  const quantity = rt.world.entities.pot.contents!.fraction;
  const directive = rt.submit('walk_to', { actor: 'cook', x: -4, z: -4 });
  until(rt, () => !rt.isActive(rec.id) && !rt.isActive(directive.id));
  assert.equal(directive.status, 'completed', directive.diagnostic?.message);
  assert.equal(rt.world.entities.pot.contents!.fraction, quantity);
  released(rt);
  run(rt);
});
for (const missing of ['beans', 'spoon'])
  test(`missing ${missing} refuses without mutation`, () => {
    const rt = preparationRuntime();
    delete rt.world.entities[missing];
    const before = hashOf(rt.world);
    const rec = rt.submit('prepare_food', params());
    assert.equal(rec.status, 'failed');
    assert.ok(rec.diagnostic?.subjects?.includes(missing));
    assert.equal(hashOf(rt.world), before);
    released(rt);
  });
test('moved support rejects active preparation and preserves partial contents', () => {
  const rt = preparationRuntime(),
    rec = rt.submit('prepare_food', params());
  until(rt, () => rt.world.entities.pot.contents!.fraction > 0);
  const amount = rt.world.entities.pot.contents!.fraction;
  rt.world.entities.table.pose.p[0] += 0.2;
  until(rt, () => !rt.isActive(rec.id));
  assert.equal(rec.diagnostic?.code, 'prepare_food.support-changed');
  assert.equal(rt.world.entities.pot.contents!.fraction, amount);
  assert.equal(total(rt), 2);
  released(rt);
});
test('foreign spoon ownership refuses explicitly', () => {
  const rt = preparationRuntime();
  addAll(rt.world, human('other', 5, 5));
  rt.world.entities.spoon.support = {
    kind: 'in-hand',
    by: 'other',
    hand: 'right',
  };
  const rec = rt.submit('prepare_food', params());
  assert.equal(rec.status, 'failed');
  assert.equal(rec.diagnostic?.code, 'prepare_food.spoon');
  released(rt);
});
test('foreign actor reservation refuses and does not cancel independent walk', () => {
  const rt = preparationRuntime(),
    walk = rt.submit('walk_to', { actor: 'cook', x: -4, z: -4 });
  const rec = rt.submit('prepare_food', params(), { preempt: false });
  assert.equal(rec.status, 'failed');
  assert.ok(rt.isActive(walk.id));
});
test('deterministic recorded preparation and already complete refusal', () => {
  const a = preparationRuntime(),
    b = preparationRuntime();
  run(a);
  run(b);
  assert.equal(hashOf(a.world), hashOf(b.world));
  assert.equal(
    hashOf([...a.records.values()]),
    hashOf([...b.records.values()]),
  );
  assert.equal(
    a.submit('prepare_food', params()).diagnostic?.code,
    'prepare_food.already-complete',
  );
  assert.equal(
    prepareFood.resumable?.toString().startsWith('Active preparation'),
    true,
  );
});
for (const phase of ['taking', 'to-source', 'scooping', 'to-pot', 'mixing'])
  test(`cancel during ${phase} drains owned children and releases preparation resources`, () => {
    const rt = preparationRuntime(),
      rec = rt.submit('prepare_food', params());
    until(rt, () => rec.phase === phase);
    const amount = rt.world.entities.pot.contents!.fraction;
    rt.cancel(rec.id);
    until(rt, () => !rt.isActive(rec.id));
    assert.equal(rec.status, 'cancelled');
    assert.equal(rt.world.entities.pot.contents!.fraction, amount);
    assert.equal(total(rt), 2);
    released(rt);
    for (const child of rt.records.values())
      if (child.parent === rec.id && child.verb !== 'hold_items')
        assert.ok(!rt.isActive(child.id));
    run(rt);
  });
test('changed ingredient quantity on retry refuses without silently replenishing it', () => {
  const rt = preparationRuntime(),
    rec = rt.submit('prepare_food', params());
  until(rt, () => rt.world.entities.pot.contents!.fraction > 0);
  rt.cancel(rec.id);
  until(rt, () => !rt.isActive(rec.id));
  rt.world.entities.beans.contents!.fraction += 0.25;
  const before = hashOf(rt.world),
    retry = rt.submit('prepare_food', params());
  assert.equal(retry.diagnostic?.code, 'prepare_food.ingredient-changed');
  assert.equal(hashOf(rt.world), before);
  released(rt);
});
test('wrong pot support, nonempty pot and partial source refuse named arrangements', () => {
  for (const bad of ['support', 'pot', 'source']) {
    const rt = preparationRuntime();
    if (bad === 'support') rt.world.entities.pot.support = { kind: 'ground' };
    if (bad === 'pot') rt.world.entities.pot.contents!.fraction = 0.1;
    if (bad === 'source') rt.world.entities.beans.contents!.fraction = 0.5;
    const before = hashOf(rt.world),
      rec = rt.submit('prepare_food', params());
    assert.equal(rec.status, 'failed');
    assert.equal(hashOf(rt.world), before);
    assert.ok(rec.diagnostic?.code.startsWith('prepare_food.'));
    released(rt);
  }
});

// Use the existing stricter on-foot displacement ceiling for this featured held
// utensil, including its farthest point under rotation. The component ceiling
// (0.6m) would permit the original target-to-carry snap.
for (const mode of ['complete', 'cancel', 'directive'] as const) {
  const phases =
    mode === 'complete'
      ? ['complete']
      : [
          'taking-held',
          'scooping',
          'depositing',
          'mix-entry',
          'mixing',
          'returning',
          'to-pot',
        ];
  for (const phase of phases)
    test(`held spoon continuity through ${mode} at ${phase}`, () => {
      const rt = preparationRuntime(),
        rec = rt.submit('prepare_food', params());
      let prior: { p: Vec3; yaw: number } | undefined,
        interrupted = false,
        directive: string | undefined;
      let samples = 0;
      for (let tick = 0; tick < 2400; tick++) {
        const spoon = rt.world.entities.spoon;
        const held = spoon.support?.kind === 'in-hand';
        const ready =
          phase === 'taking-held'
            ? rec.phase === 'taking' && held
            : rec.phase === phase;
        if (mode !== 'complete' && !interrupted && ready) {
          interrupted = true;
          if (mode === 'cancel') rt.cancel(rec.id);
          else
            directive = rt.submit('walk_to', {
              actor: 'cook',
              x: -4,
              z: -4,
            }).id;
        }
        rt.step();
        if (spoon.support?.kind === 'in-hand') {
          if (prior) {
            const extent = Math.max(...CATALOG[spoon.def].size) / 2;
            const displacement =
              dist3(prior.p, spoon.pose.p) +
              Math.abs(angleDelta(prior.yaw, spoon.pose.yaw)) * extent;
            assert.ok(
              displacement <= MAX_HUMAN_STEP_PER_TICK + 1e-9,
              `held spoon ${displacement}m jump during ${rec.phase} at tick ${rt.tick}`,
            );
            samples++;
          }
          prior = { p: [...spoon.pose.p], yaw: spoon.pose.yaw };
        } else prior = undefined;
        if (!rt.isActive(rec.id) && (!directive || !rt.isActive(directive)))
          break;
      }
      assert.ok(samples > 0);
      assert.ok(mode === 'complete' || interrupted, `did not reach ${phase}`);
      assert.ok(!rt.isActive(rec.id));
      if (mode === 'complete') assert.equal(rec.status, 'completed', rec.diagnostic?.message);
      if (mode === 'cancel') assert.equal(rec.status, 'cancelled', rec.diagnostic?.message);
      if (directive)
        assert.equal(rt.records.get(directive)!.status, 'completed');
      assert.equal(total(rt), 2);
      assert.deepEqual(rt.violations, []);
      released(rt);
    });
}
