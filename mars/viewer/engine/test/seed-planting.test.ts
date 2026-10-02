import test from 'node:test';
import assert from 'node:assert/strict';
import {
  seedPlantingRuntime,
  seedPlantingBinding,
  seedPlantingScene,
} from '../scenarios/seed-planting.ts';
import { readSeedbed, type PlantingEntity } from '../objects/planting.ts';
import { readSeedPlanting } from '../activities/seed-planting.ts';
import { readGarden, type GardenEntity } from '../objects/garden.ts';
import { itemEntity, placeOnSlot, surfaceSlot } from '../items/model.ts';
import { human } from '../world/factory.ts';
import { hashOf } from '../core/hash.ts';
import type { Runtime } from '../runtime/runtime.ts';
import { Spatial } from '../spatial/service.ts';
import type { ActionDef } from '../actions/types.ts';
import { z } from 'zod';
const bed = (rt: Runtime, id = 'planter-a') => {
  const s = readSeedbed(rt, id);
  assert.ok(!('code' in s), JSON.stringify(s));
  return s;
};
const total = (rt: Runtime) =>
  rt.world.entities['seed-bowl'].contents!.fraction +
  ['planter-a', 'planter-b'].reduce(
    (n, id) =>
      n + (rt.world.entities[id] as PlantingEntity).planting!.deposited,
    0,
  );
function until(rt: Runtime, done: () => boolean, max = 3000, conserve = true) {
  for (let i = 0; i < max && !done(); i++) {
    rt.step();
    assert.deepEqual(rt.violations, []);
    if (conserve) assert.equal(total(rt), 0.5);
  }
  assert.ok(
    done(),
    JSON.stringify([...rt.records.values()].filter((r) => rt.isActive(r.id))),
  );
}
function clean(rt: Runtime) {
  assert.deepEqual(rt.violations, []);
  assert.equal(
    [...rt.records.values()].filter((r) => rt.isActive(r.id)).length,
    0,
  );
  for (const e of Object.values(rt.world.entities))
    assert.deepEqual(rt.holder(`entity:${e.id}`), []);
  for (const resource of [
    'actor:planter',
    'hand:planter:right',
    'holds:planter',
    'surface:seed-table#r0c2',
  ])
    assert.deepEqual(rt.holder(resource), []);
  assert.deepEqual(rt.world.entities['seed-bowl'].support, {
    kind: 'resting-on',
    on: 'seed-table',
    slot: 'r0c2',
  });
}
function sow(rt: Runtime, plant = 'planter-a', resume = false) {
  const r = rt.submit('seed_planting', {
    ...seedPlantingBinding(0, plant),
    ...(resume ? { resume: true } : {}),
  });
  assert.notEqual(r.status, 'failed', r.diagnostic?.message);
  until(rt, () => !rt.isActive(r.id));
  assert.equal(r.status, 'completed', r.diagnostic?.message);
  clean(rt);
  return r;
}
for (const angle of [0, Math.PI / 2])
  test(`same bowl, supported right-hand reach and four conserved seed deposits at ${angle}`, () => {
    const rt = seedPlantingRuntime(angle),
      ids = Object.keys(rt.world.entities).sort(),
      gardens = hashOf(
        ['planter-a', 'planter-b'].map((id) => rt.world.entities[id]),
      );
    const beforeGarden = structuredClone(
      (rt.world.entities['planter-a'] as GardenEntity).gardenCare,
    );
    const a = rt.submit('seed_planting', seedPlantingBinding(angle));
    assert.notEqual(a.status, 'failed', a.diagnostic?.message);
    until(rt, () => bed(rt).deposits === 1);
    const r = readSeedPlanting(rt, a.id)!;
    assert.deepEqual(r.source?.support, {
      kind: 'in-hand',
      by: 'planter',
      hand: 'right',
    });
    assert.equal(r.source?.contents?.fraction, 0.4375);
    assert.ok(r.hand);
    assert.deepEqual(r.hand, rt.world.entities['seed-bowl'].pose.p);
    assert.equal(bed(rt).source, 'seed-bowl');
    until(rt, () => !rt.isActive(a.id));
    assert.equal(bed(rt).completed, true);
    assert.equal(bed(rt).deposits, 4);
    assert.equal(rt.world.entities['seed-bowl'].contents!.food, 'seeds');
    assert.equal(rt.world.entities['seed-bowl'].contents!.fraction, 0.25);
    assert.deepEqual(
      (rt.world.entities['planter-a'] as GardenEntity).gardenCare,
      beforeGarden,
    );
    assert.notEqual(
      hashOf(['planter-a', 'planter-b'].map((id) => rt.world.entities[id])),
      gardens,
    );
    assert.deepEqual(Object.keys(rt.world.entities).sort(), ids);
    assert.ok(
      [...rt.records.values()].some(
        (r) => r.verb === 'take_item' && r.status === 'completed',
      ),
    );
    assert.ok(
      [...rt.records.values()].some(
        (r) => r.verb === 'put_item' && r.status === 'completed',
      ),
    );
    clean(rt);
    sow(rt, 'planter-b');
    assert.equal(total(rt), 0.5);
    assert.equal(rt.world.entities['seed-bowl'].contents!.fraction, 0);
    const snapshot = rt.stateHash(),
      again = rt.submit('seed_planting', seedPlantingBinding());
    assert.equal(again.diagnostic?.code, 'seed_planting.already-planted');
    assert.equal(rt.stateHash(), snapshot);
  });
for (const phase of ['taking', 'walking', 'reaching', 'sowing', 'putting'])
  test(`cancel in ${phase} returns same bowl and explicit continuation retains exact purpose`, () => {
    const rt = seedPlantingRuntime(),
      a = rt.submit('seed_planting', seedPlantingBinding());
    until(
      rt,
      () => a.phase === phase && (phase !== 'sowing' || bed(rt).deposits > 0),
    );
    const before = bed(rt),
      fraction = rt.world.entities['seed-bowl'].contents!.fraction;
    rt.cancel(a.id);
    until(rt, () => !rt.isActive(a.id));
    assert.equal(a.status, 'cancelled');
    assert.equal(bed(rt).purpose, before.purpose);
    assert.equal(bed(rt).deposited, before.deposited);
    assert.equal(rt.world.entities['seed-bowl'].contents!.fraction, fraction);
    clean(rt);
    if (!before.completed) {
      const denied = rt.submit('seed_planting', seedPlantingBinding());
      assert.equal(denied.diagnostic?.code, 'seed_planting.unfinished-purpose');
      sow(rt, 'planter-a', true);
      assert.equal(bed(rt).purpose, before.purpose);
    }
    assert.equal(bed(rt).deposited, 0.25);
  });
test('player directive safely returns seeds before actor leaves, then same-source explicit continuation', () => {
  const rt = seedPlantingRuntime(),
    a = rt.submit('seed_planting', seedPlantingBinding());
  until(rt, () => bed(rt).deposits > 0);
  const purpose = bed(rt).purpose,
    direct = rt.submit('walk_to', { actor: 'planter', x: -5, z: 3 });
  assert.notEqual(direct.status, 'failed');
  until(rt, () => !rt.isActive(a.id) && !rt.isActive(direct.id));
  assert.equal(a.status, 'cancelled');
  assert.equal(direct.status, 'completed');
  clean(rt);
  sow(rt, 'planter-a', true);
  assert.equal(bed(rt).purpose, purpose);
});
for (const invalid of [
  'missing-plant',
  'missing-source',
  'wrong-material',
  'empty',
  'unsupported-plant',
  'unsupported-source',
  'occupied-return',
  'unavailable',
  'bad-seedbed',
] as const)
  test(`${invalid} refuses without state writes`, () => {
    const rt = seedPlantingRuntime(),
      p = seedPlantingBinding(),
      bowl = rt.world.entities['seed-bowl'];
    if (invalid === 'missing-plant') p.plant = 'absent';
    if (invalid === 'missing-source') p.seeds = 'absent';
    if (invalid === 'wrong-material') bowl.contents!.food = 'water';
    if (invalid === 'empty') bowl.contents!.fraction = 0;
    if (invalid === 'unsupported-plant')
      rt.world.entities['planter-a'].support = { kind: 'none' };
    if (invalid === 'unsupported-source') bowl.support = { kind: 'ground' };
    if (invalid === 'unavailable')
      rt.world.entities['planter-a'].equipment = {
        kind: 'garden',
        config: { available: false },
      };
    if (invalid === 'bad-seedbed')
      (rt.world.entities['planter-a'] as PlantingEntity).planting!.deposited =
        0.1;
    if (invalid === 'occupied-return') {
      const foreign = itemEntity('foreign', 'bowl', [0, 0, 0]),
        s = surfaceSlot(rt.world, p.returnSlot);
      assert.ok(!('code' in s));
      placeOnSlot(foreign, s, 0);
      rt.world.entities.foreign = foreign;
    }
    const before = rt.stateHash(),
      a = rt.submit('seed_planting', p);
    assert.equal(a.status, 'failed');
    assert.ok(a.diagnostic?.subjects?.length);
    assert.equal(rt.stateHash(), before);
    assert.deepEqual(rt.holder('actor:planter'), []);
  });
test('foreign planter claim and blocked route refuse without stealing or initializing a purpose', () => {
  for (const kind of ['claimed', 'blocked']) {
    const rt = seedPlantingRuntime();
    let owner: string | undefined;
    if (kind === 'claimed') {
      const lease: ActionDef = {
        verb: 'seed_test_lease',
        description: 'fixture',
        schema: z.object({}),
        reservations: () => [
          { resource: 'entity:planter-a', mode: 'exclusive' },
        ],
        plan: () => ({ ok: true, program: null }),
        start: () => null,
        step: () => ({ status: 'running' }),
        cancel: () => ({ ok: true }),
      };
      rt.registry.set(lease.verb, lease);
      owner = rt.submit(lease.verb, {}).id;
    } else {
      const scene = seedPlantingScene();
      scene.obstacles.push({
        id: 'closed-route',
        obb: { c: [0, 0], half: [16, 0.15], yaw: 0 },
        y0: 0,
        y1: 3,
        kind: 'wall',
      });
      rt.services.spatial = new Spatial(scene);
    }
    const before = rt.stateHash(),
      a = rt.submit('seed_planting', seedPlantingBinding());
    assert.equal(a.status, 'failed');
    assert.equal(rt.stateHash(), before);
    assert.equal(bed(rt).purpose, undefined);
    if (owner) {
      assert.ok(rt.isActive(owner));
      rt.cancel(owner);
    }
  }
});
test('partial source, actor and refill changes refuse instead of discarding retained seeds', () => {
  const rt = seedPlantingRuntime(),
    a = rt.submit('seed_planting', seedPlantingBinding());
  until(rt, () => bed(rt).deposits > 0);
  rt.cancel(a.id);
  until(rt, () => !rt.isActive(a.id));
  const original = bed(rt),
    fraction = rt.world.entities['seed-bowl'].contents!.fraction;
  rt.world.entities.other = human('other', -6, -4);
  for (const variation of ['actor', 'source', 'refill']) {
    const p = { ...seedPlantingBinding(), resume: true };
    if (variation === 'actor') p.actor = 'other';
    if (variation === 'source') {
      const other = itemEntity('other-bowl', 'bowl', [0, 0, 0], 0, {
        contents: { food: 'seeds', fraction: 0.5 },
      });
      const slot = surfaceSlot(rt.world, 'seed-table#r0c1');
      assert.ok(!('code' in slot));
      placeOnSlot(other, slot, 0);
      rt.world.entities[other.id] = other;
      p.seeds = other.id;
    }
    if (variation === 'refill')
      rt.world.entities['seed-bowl'].contents!.fraction = 0.5;
    const before = rt.stateHash(),
      r = rt.submit('seed_planting', p);
    assert.equal(r.status, 'failed');
    assert.equal(rt.stateHash(), before);
    assert.equal(bed(rt).purpose, original.purpose);
    rt.world.entities['seed-bowl'].contents!.fraction = fraction;
  }
  sow(rt, 'planter-a', true);
  assert.equal(bed(rt).purpose, original.purpose);
});
test('unfinished purpose reserves its source across stopped actions and other planter admission', () => {
  const rt = seedPlantingRuntime(),
    a = rt.submit('seed_planting', seedPlantingBinding());
  until(rt, () => bed(rt).deposits > 0);
  rt.cancel(a.id);
  until(rt, () => !rt.isActive(a.id));
  const purpose = bed(rt).purpose,
    before = rt.stateHash(),
    b = rt.submit('seed_planting', seedPlantingBinding(0, 'planter-b'));
  assert.equal(b.diagnostic?.code, 'seed_planting.source-committed');
  assert.equal(rt.stateHash(), before);
  assert.equal(bed(rt, 'planter-b').purpose, undefined);
  sow(rt, 'planter-a', true);
  assert.equal(bed(rt).purpose, purpose);
  sow(rt, 'planter-b');
  assert.equal(rt.world.entities['seed-bowl'].contents!.fraction, 0);
});
for (const mutation of ['material', 'refill', 'missing-contents'])
  test(`execution rejects ${mutation} without another deposit and returns actual same bowl`, () => {
    const rt = seedPlantingRuntime(),
      a = rt.submit('seed_planting', seedPlantingBinding());
    until(rt, () => bed(rt).deposits === 1);
    const before = bed(rt),
      contents = structuredClone(rt.world.entities['seed-bowl'].contents!);
    if (mutation === 'material')
      rt.world.entities['seed-bowl'].contents!.food = 'water';
    if (mutation === 'refill')
      rt.world.entities['seed-bowl'].contents!.fraction = 1;
    if (mutation === 'missing-contents')
      delete rt.world.entities['seed-bowl'].contents;
    const changed = structuredClone(rt.world.entities['seed-bowl'].contents);
    until(rt, () => !rt.isActive(a.id), 3000, false);
    assert.equal(a.status, 'failed');
    assert.equal(a.diagnostic?.code, 'seed_planting.source-changed');
    assert.equal(bed(rt).deposited, before.deposited);
    assert.equal(bed(rt).purpose, before.purpose);
    assert.deepEqual(rt.world.entities['seed-bowl'].contents, changed);
    clean(rt);
    const snapshot = rt.stateHash(),
      refused = rt.submit('seed_planting', {
        ...seedPlantingBinding(),
        resume: true,
      });
    assert.equal(refused.status, 'failed');
    assert.equal(rt.stateHash(), snapshot);
    rt.world.entities['seed-bowl'].contents = contents;
    sow(rt, 'planter-a', true);
    assert.equal(total(rt), 0.5);
  });
test('newly occupied return slot keeps real held seeds and ownership until explicit clearance', () => {
  const rt = seedPlantingRuntime(),
    a = rt.submit('seed_planting', seedPlantingBinding());
  until(rt, () => bed(rt).deposits === 1);
  const before = bed(rt),
    contents = structuredClone(rt.world.entities['seed-bowl'].contents),
    foreign = itemEntity('foreign', 'bowl', [0, 0, 0]),
    slot = surfaceSlot(rt.world, 'seed-table#r0c2');
  assert.ok(!('code' in slot));
  placeOnSlot(foreign, slot, 0);
  rt.world.entities.foreign = foreign;
  rt.cancel(a.id);
  until(
    rt,
    () =>
      a.status === 'blocked' &&
      a.diagnostic?.code === 'seed_planting.return-occupied',
  );
  assert.equal(rt.isActive(a.id), true);
  assert.deepEqual(rt.world.entities['seed-bowl'].support, {
    kind: 'in-hand',
    by: 'planter',
    hand: 'right',
  });
  assert.deepEqual(rt.holder('actor:planter'), [a.id]);
  assert.deepEqual(rt.world.entities['seed-bowl'].contents, contents);
  assert.equal(bed(rt).deposited, before.deposited);
  delete rt.world.entities.foreign;
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'cancelled');
  clean(rt);
  sow(rt, 'planter-a', true);
  assert.equal(bed(rt).purpose, before.purpose);
});
test('new blocked return route retains actual held bowl until route restored', () => {
  const rt = seedPlantingRuntime(),
    a = rt.submit('seed_planting', seedPlantingBinding());
  until(rt, () => bed(rt).deposits === 1);
  const before = bed(rt),
    scene = seedPlantingScene();
  scene.obstacles.push({
    id: 'closed-return-route',
    obb: { c: [0, 0], half: [16, 0.15], yaw: 0 },
    y0: 0,
    y1: 3,
    kind: 'wall',
  });
  rt.services.spatial = new Spatial(scene);
  rt.cancel(a.id);
  until(rt, () => a.status === 'blocked');
  assert.equal(rt.isActive(a.id), true);
  assert.deepEqual(rt.world.entities['seed-bowl'].support, {
    kind: 'in-hand',
    by: 'planter',
    hand: 'right',
  });
  assert.deepEqual(rt.holder('actor:planter'), [a.id]);
  assert.equal(bed(rt).deposited, before.deposited);
  rt.services.spatial = new Spatial(seedPlantingScene());
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'cancelled');
  clean(rt);
  sow(rt, 'planter-a', true);
  assert.equal(bed(rt).purpose, before.purpose);
});
test('moving target stops deposits and supported same-bowl return; restored binding resumes retained purpose', () => {
  const rt = seedPlantingRuntime(),
    a = rt.submit('seed_planting', seedPlantingBinding());
  until(rt, () => bed(rt).deposits === 1);
  const before = bed(rt),
    pose = structuredClone(rt.world.entities['planter-a'].pose);
  rt.world.entities['planter-a'].pose.p[0] -= 1;
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'failed');
  assert.equal(a.diagnostic?.code, 'seed_planting.support-changed');
  assert.equal(bed(rt).deposited, before.deposited);
  clean(rt);
  const snapshot = rt.stateHash(),
    refused = rt.submit('seed_planting', {
      ...seedPlantingBinding(),
      resume: true,
    });
  assert.equal(refused.status, 'failed');
  assert.equal(rt.stateHash(), snapshot);
  rt.world.entities['planter-a'].pose = pose;
  sow(rt, 'planter-a', true);
  assert.equal(bed(rt).purpose, before.purpose);
});
test('unavailable target safely returns bowl and preserves independent garden and planting effects', () => {
  const rt = seedPlantingRuntime(),
    a = rt.submit('seed_planting', seedPlantingBinding());
  until(rt, () => bed(rt).deposits === 1);
  const before = bed(rt),
    garden = structuredClone(readGarden(rt, 'planter-a'));
  rt.world.entities['planter-a'].equipment = {
    kind: 'garden',
    config: { available: false },
  };
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'failed');
  assert.equal(a.diagnostic?.code, 'garden.unavailable');
  clean(rt);
  rt.world.entities['planter-a'].equipment.config.available = true;
  assert.equal(bed(rt).deposited, before.deposited);
  assert.deepEqual(readGarden(rt, 'planter-a'), garden);
  sow(rt, 'planter-a', true);
});
test('same commands replay exact seed state, world, deposits and action provenance', () => {
  const run = () => {
    const rt = seedPlantingRuntime(),
      a = rt.submit('seed_planting', seedPlantingBinding());
    until(rt, () => bed(rt).deposits === 1);
    rt.cancel(a.id);
    until(rt, () => !rt.isActive(a.id));
    sow(rt, 'planter-a', true);
    sow(rt, 'planter-b');
    return hashOf([rt.world, [...rt.records.values()], rt.events]);
  };
  assert.equal(run(), run());
});
test('cancel accepted before first tick creates no child or planting purpose', () => {
  const rt = seedPlantingRuntime(),
    a = rt.submit('seed_planting', seedPlantingBinding());
  rt.cancel(a.id);
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'cancelled');
  assert.equal(bed(rt).purpose, undefined);
  assert.equal(bed(rt).deposited, 0);
  assert.equal(
    [...rt.records.values()].filter((r) => r.parent === a.id).length,
    0,
  );
  clean(rt);
});
test('admitted source changed before first tick refuses before writing a planting purpose', () => {
  const rt = seedPlantingRuntime(),
    a = rt.submit('seed_planting', seedPlantingBinding());
  rt.world.entities['seed-bowl'].contents!.food = 'water';
  until(rt, () => !rt.isActive(a.id), 3000, false);
  assert.equal(a.status, 'failed');
  assert.equal(a.diagnostic?.code, 'seed_planting.source-changed');
  assert.equal(bed(rt).purpose, undefined);
  assert.equal(bed(rt).deposited, 0);
  assert.equal(rt.world.entities['seed-bowl'].contents!.food, 'water');
  assert.equal(
    [...rt.records.values()].filter((r) => r.parent === a.id).length,
    0,
  );
  clean(rt);
});
test('ordinary garden care coexists without changing retained planting material or purpose', () => {
  const rt = seedPlantingRuntime();
  sow(rt);
  const before = bed(rt),
    water = itemEntity('water', 'bowl', [0, 0, 0], 0, {
      contents: { food: 'water', fraction: 0.5 },
    }),
    slot = surfaceSlot(rt.world, 'seed-table#r0c1');
  assert.ok(!('code' in slot));
  placeOnSlot(water, slot, 0);
  rt.world.entities.water = water;
  const care = rt.submit('garden_care', {
    actor: 'planter',
    plant: 'planter-a',
    water: 'water',
    returnSlot: 'seed-table#r0c1',
  });
  assert.notEqual(care.status, 'failed', care.diagnostic?.message);
  until(rt, () => !rt.isActive(care.id));
  assert.equal(care.status, 'completed');
  assert.deepEqual(bed(rt), before);
  const garden = readGarden(rt, 'planter-a');
  assert.ok(!('code' in garden));
  assert.equal(garden.waterReceived, 0.25);
  assert.equal(rt.world.entities.water.contents!.fraction, 0.25);
  assert.equal(rt.world.entities['seed-bowl'].contents!.fraction, 0.25);
  clean(rt);
});
test('unsupported return table refuses release while keeping true held seed ownership', () => {
  const rt = seedPlantingRuntime(),
    a = rt.submit('seed_planting', seedPlantingBinding());
  until(rt, () => bed(rt).deposits === 1);
  const before = bed(rt);
  rt.world.entities['seed-table'].support = { kind: 'none' };
  rt.cancel(a.id);
  until(
    rt,
    () =>
      a.status === 'blocked' &&
      a.diagnostic?.code === 'seed_planting.return-support',
  );
  assert.equal(rt.isActive(a.id), true);
  assert.deepEqual(rt.world.entities['seed-bowl'].support, {
    kind: 'in-hand',
    by: 'planter',
    hand: 'right',
  });
  assert.equal(bed(rt).deposited, before.deposited);
  assert.deepEqual(rt.holder('actor:planter'), [a.id]);
  rt.world.entities['seed-table'].support = { kind: 'ground' };
  until(rt, () => !rt.isActive(a.id));
  clean(rt);
  sow(rt, 'planter-a', true);
});
test('late contents replacement during ordinary return cannot report silent conserved success', () => {
  const rt = seedPlantingRuntime(),
    a = rt.submit('seed_planting', seedPlantingBinding());
  until(rt, () => a.phase === 'putting');
  const before = bed(rt);
  rt.world.entities['seed-bowl'].contents = { food: 'water', fraction: 0.25 };
  until(rt, () => !rt.isActive(a.id), 3000, false);
  assert.equal(a.status, 'failed');
  assert.equal(a.diagnostic?.code, 'seed_planting.source-changed');
  assert.equal(bed(rt).completed, true);
  assert.equal(bed(rt).deposited, before.deposited);
  assert.equal(rt.world.entities['seed-bowl'].contents!.food, 'water');
  clean(rt);
});
