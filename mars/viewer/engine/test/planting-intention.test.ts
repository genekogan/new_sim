import test from 'node:test';
import { z } from 'zod';
import assert from 'node:assert/strict';
import {
  seedPlantingRuntime,
  seedPlantingBinding,
} from '../scenarios/seed-planting.ts';
import { readingRuntime, READING_BINDING } from '../scenarios/reading.ts';
import { seedPlanting } from '../activities/seed-planting.ts';
import { readSeedbed } from '../objects/planting.ts';
import { readGarden } from '../objects/garden.ts';
import { readBook } from '../objects/reading.ts';
import {
  readLivingIntention,
  type LivingIntentionParams,
} from '../activities/living-intention.ts';
import { itemEntity, placeOnSlot, surfaceSlot } from '../items/model.ts';
import { hashOf } from '../core/hash.ts';
import type { Runtime } from '../runtime/runtime.ts';
const seed = {
  verb: 'seed_planting' as const,
  params: { ...seedPlantingBinding() },
};
const chain = (): LivingIntentionParams => ({
  actor: 'planter',
  objectives: [
    { purpose: 'sow', label: 'Plant actual seeds', alternatives: [seed] },
    {
      purpose: 'break',
      label: 'Ordinary garden break',
      alternatives: [
        { verb: 'walk_to', params: { actor: 'planter', x: -5, z: 3 } },
      ],
    },
    {
      purpose: 'water',
      label: 'Care for the same planter',
      alternatives: [
        {
          verb: 'garden_care',
          params: {
            actor: 'planter',
            plant: 'planter-a',
            water: 'water-bowl',
            returnSlot: 'seed-table#r0c1',
          },
        },
      ],
    },
  ],
});
function fixture() {
  const rt = seedPlantingRuntime(),
    water = itemEntity('water-bowl', 'bowl', [0, 0, 0], 0, {
      contents: { food: 'water', fraction: 0.5 },
    }),
    slot = surfaceSlot(rt.world, 'seed-table#r0c1');
  assert.ok(!('code' in slot));
  placeOnSlot(water, slot, 0);
  rt.world.entities[water.id] = water;
  for (const e of Object.values(readingRuntime().world.entities)) {
    if (e.id === 'visitor') continue;
    e.pose.p[0] += 6;
    e.pose.p[2] += 5;
    rt.world.entities[e.id] = e;
  }
  return rt;
}
function bed(rt: Runtime) {
  const r = readSeedbed(rt, 'planter-a');
  assert.ok(!('code' in r), JSON.stringify(r));
  return r;
}
function intention(rt: Runtime, id: string) {
  const r = readLivingIntention(rt, id);
  assert.ok(r);
  return r;
}
function until(rt: Runtime, done: () => boolean, max = 6000, conserve = true) {
  for (let i = 0; i < max && !done(); i++) {
    rt.step();
    assert.deepEqual(rt.violations, []);
    if (conserve)
      assert.equal(
        rt.world.entities['seed-bowl'].contents!.fraction + bed(rt).deposited,
        0.5,
      );
  }
  assert.ok(
    done(),
    JSON.stringify([...rt.records.values()].filter((r) => rt.isActive(r.id))),
  );
}
function submit(rt: Runtime, p = chain()) {
  const a = rt.submit('living_intention', p);
  assert.notEqual(a.status, 'failed', a.diagnostic?.message);
  return a;
}
function control(rt: Runtime, id: string, intent: 'pause' | 'resume' | 'end') {
  const c = rt.submit('living_intention_control', { intention: id, intent });
  assert.notEqual(c.status, 'failed', c.diagnostic?.message);
  return c;
}
function reader(rt: Runtime) {
  return submit(rt, {
    actor: 'reader',
    objectives: [
      {
        purpose: 'read',
        label: 'Independent long reading',
        alternatives: [
          { verb: 'read_book', params: { ...READING_BINDING, duration: 90 } },
        ],
      },
    ],
  });
}
function reading(rt: Runtime) {
  const b = readBook(rt, 'book');
  assert.ok(!('code' in b));
  return b;
}
function clean(rt: Runtime) {
  assert.deepEqual(rt.violations, []);
  assert.equal(
    [...rt.records.values()].filter((r) => rt.isActive(r.id)).length,
    0,
  );
  for (const actor of ['planter', 'reader'])
    for (const prefix of ['actor', 'routine', 'holds'])
      assert.deepEqual(rt.holder(`${prefix}:${actor}`), []);
  for (const e of Object.values(rt.world.entities))
    assert.deepEqual(rt.holder(`entity:${e.id}`), []);
  assert.deepEqual(rt.world.entities['seed-bowl'].support, {
    kind: 'resting-on',
    on: 'seed-table',
    slot: 'r0c2',
  });
}
test('seed → ordinary break walk → finite water care shares ordinary execution with independent reading', () => {
  const rt = fixture(),
    a = submit(rt),
    r = reader(rt),
    ids = Object.keys(rt.world.entities).sort();
  until(rt, () => intention(rt, a.id).index === 1);
  assert.equal(bed(rt).completed, true);
  assert.equal(rt.world.entities['seed-bowl'].contents!.fraction, 0.25);
  assert.ok(reading(rt).elapsed > 0);
  until(rt, () => !rt.isActive(a.id));
  assert.deepEqual(a.outputs?.completed, [
    'Plant actual seeds',
    'Ordinary garden break',
    'Care for the same planter',
  ]);
  const garden = readGarden(rt, 'planter-a');
  assert.ok(!('code' in garden));
  assert.equal(garden.waterReceived, 0.25);
  assert.equal(rt.world.entities['water-bowl'].contents!.fraction, 0.25);
  assert.equal(bed(rt).deposited, 0.25);
  assert.deepEqual(Object.keys(rt.world.entities).sort(), ids);
  assert.ok(rt.isActive(r.id));
  assert.ok(
    [...rt.records.values()].some(
      (c) => c.parent === a.id && c.verb === 'seed_planting',
    ),
  );
  assert.ok(
    [...rt.records.values()].some(
      (c) => c.parent === a.id && c.verb === 'walk_to',
    ),
  );
  assert.ok(
    [...rt.records.values()].some(
      (c) => c.parent === a.id && c.verb === 'garden_care',
    ),
  );
  control(rt, r.id, 'end');
  until(rt, () => !rt.isActive(r.id));
  clean(rt);
});
test('local Pause during partial deposits leaves independent reading progressing; Resume uses same source and purpose', () => {
  const rt = fixture(),
    a = submit(rt),
    r = reader(rt);
  until(rt, () => bed(rt).deposits === 1);
  const before = bed(rt),
    book = reading(rt).elapsed;
  control(rt, a.id, 'pause');
  until(rt, () => intention(rt, a.id).mode === 'paused');
  assert.equal(bed(rt).purpose, before.purpose);
  assert.equal(bed(rt).deposited, before.deposited);
  assert.deepEqual(rt.world.entities['seed-bowl'].support, {
    kind: 'resting-on',
    on: 'seed-table',
    slot: 'r0c2',
  });
  assert.ok(reading(rt).elapsed > book);
  for (let i = 0; i < 20; i++) rt.step();
  assert.equal(bed(rt).deposited, before.deposited);
  control(rt, a.id, 'resume');
  until(rt, () => bed(rt).deposited > before.deposited);
  assert.equal(intention(rt, a.id).binding?.params.seeds, 'seed-bowl');
  assert.equal(bed(rt).purpose, before.purpose);
  const ownSeeds = [...rt.records.values()].filter(
    (c) => c.parent === a.id && c.verb === 'seed_planting',
  );
  assert.equal(ownSeeds.length, 2);
  assert.equal(seedPlanting.schema.parse(ownSeeds[1].params).resume, true);
  until(rt, () => !rt.isActive(a.id));
  assert.equal(bed(rt).deposits, 4);
  control(rt, r.id, 'end');
  until(rt, () => !rt.isActive(r.id));
  clean(rt);
});
test('End during partial planting retains effects; a new explicitly authored intention continues original leaf purpose', () => {
  const rt = fixture(),
    a = submit(rt);
  until(rt, () => bed(rt).deposits === 1);
  const before = bed(rt);
  control(rt, a.id, 'end');
  until(rt, () => !rt.isActive(a.id));
  assert.equal(bed(rt).purpose, before.purpose);
  assert.equal(bed(rt).deposited, before.deposited);
  assert.deepEqual(a.outputs?.completed, []);
  clean(rt);
  const b = submit(rt);
  until(rt, () => !rt.isActive(b.id));
  const resumed = [...rt.records.values()].find(
    (c) => c.parent === b.id && c.verb === 'seed_planting',
  );
  assert.ok(resumed);
  assert.equal(seedPlanting.schema.parse(resumed.params).resume, true);
  assert.equal(bed(rt).purpose, before.purpose);
  assert.equal(bed(rt).completed, true);
  clean(rt);
});
test('Pause through blocked safe cleanup retains actual held bowl until support clears', () => {
  const rt = fixture(),
    a = submit(rt);
  until(rt, () => bed(rt).deposits === 1);
  const before = bed(rt),
    foreign = itemEntity('foreign', 'bowl', [0, 0, 0]),
    slot = surfaceSlot(rt.world, 'seed-table#r0c2');
  assert.ok(!('code' in slot));
  placeOnSlot(foreign, slot, 0);
  rt.world.entities.foreign = foreign;
  control(rt, a.id, 'pause');
  until(rt, () => {
    const child = intention(rt, a.id).child;
    return !!child && rt.records.get(child)?.status === 'blocked';
  });
  assert.equal(intention(rt, a.id).mode, 'draining');
  assert.deepEqual(rt.world.entities['seed-bowl'].support, {
    kind: 'in-hand',
    by: 'planter',
    hand: 'right',
  });
  assert.equal(bed(rt).deposited, before.deposited);
  const count = rt.records.size;
  for (let i = 0; i < 40; i++) rt.step();
  assert.equal(rt.records.size, count);
  delete rt.world.entities.foreign;
  until(rt, () => intention(rt, a.id).mode === 'paused');
  control(rt, a.id, 'resume');
  until(rt, () => !rt.isActive(a.id));
  assert.equal(bed(rt).purpose, before.purpose);
  clean(rt);
});
test('completed seed material interrupted before purpose advancement is a checkpoint, never another leaf', () => {
  const rt = fixture(),
    a = submit(rt);
  until(rt, () => bed(rt).completed && intention(rt, a.id).index === 0);
  const purpose = bed(rt).purpose,
    seeds = [...rt.records.values()].filter(
      (c) => c.verb === 'seed_planting',
    ).length;
  control(rt, a.id, 'pause');
  until(rt, () => intention(rt, a.id).mode === 'paused');
  control(rt, a.id, 'resume');
  until(rt, () => intention(rt, a.id).index === 1);
  assert.equal(bed(rt).purpose, purpose);
  assert.equal(bed(rt).deposited, 0.25);
  assert.equal(
    [...rt.records.values()].filter((c) => c.verb === 'seed_planting').length,
    seeds,
  );
  assert.deepEqual(intention(rt, a.id).completed, ['Plant actual seeds']);
  until(rt, () => !rt.isActive(a.id));
  clean(rt);
});
test('already completed same seedbed checkpoint advances a newly authored chain without consuming seeds again', () => {
  const rt = fixture(),
    first = rt.submit('seed_planting', seedPlantingBinding());
  until(rt, () => !rt.isActive(first.id));
  const purpose = bed(rt).purpose,
    count = [...rt.records.values()].filter(
      (c) => c.verb === 'seed_planting',
    ).length,
    a = submit(rt);
  until(rt, () => !rt.isActive(a.id));
  assert.equal(
    [...rt.records.values()].filter((c) => c.verb === 'seed_planting').length,
    count,
  );
  assert.equal(bed(rt).purpose, purpose);
  assert.equal(rt.world.entities['seed-bowl'].contents!.fraction, 0.25);
  clean(rt);
});
test('Pause and End accepted before first step produce no phantom seed purpose or leaf', () => {
  for (const intent of ['pause', 'end'] as const) {
    const rt = fixture(),
      a = submit(rt);
    control(rt, a.id, intent);
    if (intent === 'pause') {
      until(rt, () => intention(rt, a.id).mode === 'paused');
      assert.equal(bed(rt).purpose, undefined);
      assert.equal(
        [...rt.records.values()].filter((c) => c.verb === 'seed_planting')
          .length,
        0,
      );
      control(rt, a.id, 'resume');
      until(rt, () => !rt.isActive(a.id));
      assert.equal(bed(rt).deposited, 0.25);
    } else {
      until(rt, () => !rt.isActive(a.id));
      assert.equal(bed(rt).purpose, undefined);
      assert.equal(
        [...rt.records.values()].filter((c) => c.verb === 'seed_planting')
          .length,
        0,
      );
    }
    clean(rt);
  }
});
test('direct planter command pauses only its own branch and independent reading progresses', () => {
  const rt = fixture(),
    a = submit(rt),
    r = reader(rt);
  until(rt, () => bed(rt).deposits === 1);
  const before = bed(rt),
    book = reading(rt).elapsed,
    walk = rt.submit('walk_to', { actor: 'planter', x: -5, z: 3 });
  assert.notEqual(walk.status, 'failed');
  until(
    rt,
    () => intention(rt, a.id).mode === 'paused' && !rt.isActive(walk.id),
  );
  assert.equal(bed(rt).deposited, before.deposited);
  assert.equal(bed(rt).purpose, before.purpose);
  assert.ok(reading(rt).elapsed > book);
  assert.ok(rt.isActive(r.id));
  assert.equal(intention(rt, a.id).diagnostic?.code, 'intention.directed-away');
  control(rt, a.id, 'resume');
  until(rt, () => !rt.isActive(a.id));
  control(rt, r.id, 'end');
  until(rt, () => !rt.isActive(r.id));
  clean(rt);
});
test('Pause after dispatch but before seed leaf first step creates no phantom purpose on Resume', () => {
  const rt = fixture(),
    a = submit(rt);
  rt.step();
  assert.ok(intention(rt, a.id).child);
  assert.equal(bed(rt).purpose, undefined);
  control(rt, a.id, 'pause');
  until(rt, () => intention(rt, a.id).mode === 'paused');
  assert.equal(bed(rt).purpose, undefined);
  assert.equal(bed(rt).deposited, 0);
  control(rt, a.id, 'resume');
  until(rt, () => !rt.isActive(a.id));
  assert.equal(bed(rt).completed, true);
  assert.equal(
    bed(rt).purpose,
    [...rt.records.values()].filter((c) => c.verb === 'seed_planting')[1].id,
  );
  clean(rt);
});
for (const obstacle of ['unavailable-material', 'occupied-source'] as const)
  test(`${obstacle} waits with named bounded retry and no failed leaf children`, () => {
    const rt = fixture();
    let lease: string | undefined;
    const original = rt.world.entities['seed-bowl'].contents!.food;
    if (obstacle === 'unavailable-material')
      rt.world.entities['seed-bowl'].contents!.food = 'water';
    else {
      rt.registry.set('planting_intention_lease', {
        verb: 'planting_intention_lease',
        description: 'test existing source lease',
        schema: z.object({}),
        reservations: () => [
          { resource: 'entity:seed-bowl', mode: 'exclusive' },
        ],
        plan: () => ({ ok: true, program: null }),
        start: () => null,
        step: () => ({ status: 'running' }),
        cancel: () => ({ ok: true }),
      });
      lease = rt.submit('planting_intention_lease', {}).id;
    }
    const a = submit(rt);
    until(rt, () => intention(rt, a.id).mode === 'waiting');
    assert.equal(
      intention(rt, a.id).diagnostic?.code,
      obstacle === 'unavailable-material'
        ? 'seed_planting.seeds-unavailable'
        : 'seed_planting.occupied',
    );
    const records = rt.records.size;
    for (let i = 0; i < 45; i++) rt.step();
    assert.equal(rt.records.size, records);
    assert.equal(
      [...rt.records.values()].filter((c) => c.parent === a.id).length,
      0,
    );
    assert.equal(bed(rt).purpose, undefined);
    if (lease) {
      assert.ok(rt.isActive(lease));
      rt.cancel(lease);
    } else rt.world.entities['seed-bowl'].contents!.food = original;
    until(rt, () => !rt.isActive(a.id));
    assert.equal(bed(rt).completed, true);
    clean(rt);
  });
test('chosen seed source cannot switch to another authored bowl after partial interruption', () => {
  const rt = fixture(),
    other = itemEntity('alternate-seeds', 'bowl', [0, 0, 0], 0, {
      contents: { food: 'seeds', fraction: 0.5 },
    }),
    slot = surfaceSlot(rt.world, 'seed-table#r0c3');
  assert.ok(!('code' in slot));
  placeOnSlot(other, slot, 0);
  rt.world.entities[other.id] = other;
  const p = chain();
  p.objectives[0].alternatives.push({
    verb: 'seed_planting',
    params: { ...seed.params, seeds: other.id, returnSlot: 'seed-table#r0c3' },
  });
  const a = submit(rt, p);
  until(rt, () => bed(rt).deposits === 1);
  const purpose = bed(rt).purpose;
  control(rt, a.id, 'pause');
  until(rt, () => intention(rt, a.id).mode === 'paused');
  rt.world.entities['seed-bowl'].contents!.food = 'water';
  control(rt, a.id, 'resume');
  until(rt, () => intention(rt, a.id).mode === 'waiting');
  assert.equal(
    intention(rt, a.id).diagnostic?.code,
    'seed_planting.seeds-unavailable',
  );
  assert.equal(intention(rt, a.id).binding?.params.seeds, 'seed-bowl');
  const records = rt.records.size;
  for (let i = 0; i < 40; i++) rt.step();
  assert.equal(rt.records.size, records);
  assert.equal(other.contents!.fraction, 0.5);
  rt.world.entities['seed-bowl'].contents!.food = 'seeds';
  until(rt, () => !rt.isActive(a.id));
  assert.equal(bed(rt).purpose, purpose);
  assert.equal(bed(rt).source, 'seed-bowl');
  assert.equal(other.contents!.fraction, 0.5);
  clean(rt);
});
test('changed original physical planting binding waits rather than rebinding completed or partial effects', () => {
  const rt = fixture(),
    a = submit(rt);
  until(rt, () => bed(rt).deposits === 1);
  const before = bed(rt),
    pose = structuredClone(rt.world.entities['planter-a'].pose);
  control(rt, a.id, 'pause');
  until(rt, () => intention(rt, a.id).mode === 'paused');
  rt.world.entities['planter-a'].pose.p[0] -= 1;
  control(rt, a.id, 'resume');
  until(rt, () => intention(rt, a.id).mode === 'waiting');
  assert.equal(
    intention(rt, a.id).diagnostic?.code,
    'seed_planting.source-changed',
  );
  assert.equal(bed(rt).deposited, before.deposited);
  const records = rt.records.size;
  for (let i = 0; i < 40; i++) rt.step();
  assert.equal(rt.records.size, records);
  rt.world.entities['planter-a'].pose = pose;
  until(rt, () => !rt.isActive(a.id));
  assert.equal(bed(rt).purpose, before.purpose);
  clean(rt);
});
test('finite seed objective refuses seconds slicing without mutation or starting children', () => {
  const rt = fixture(),
    p = chain();
  p.objectives[0].sliceSeconds = 2;
  const before = rt.stateHash(),
    a = rt.submit('living_intention', p);
  assert.equal(a.status, 'failed');
  assert.equal(a.diagnostic?.code, 'intention.seed-slice');
  assert.match(a.diagnostic!.message, /finite seed fractions/);
  assert.equal(rt.stateHash(), before);
  assert.equal(bed(rt).purpose, undefined);
  clean(rt);
});
test('same connected decisions replay conserved seed/water/world and action/event provenance', () => {
  const run = () => {
    const rt = fixture(),
      a = submit(rt),
      r = reader(rt);
    until(rt, () => bed(rt).deposits === 1);
    control(rt, a.id, 'pause');
    until(rt, () => intention(rt, a.id).mode === 'paused');
    control(rt, a.id, 'resume');
    until(rt, () => !rt.isActive(a.id));
    control(rt, r.id, 'end');
    until(rt, () => !rt.isActive(r.id));
    clean(rt);
    return hashOf([rt.world, [...rt.records.values()], rt.events]);
  };
  assert.equal(run(), run());
});
test('End during blocked seed cleanup cannot finish or lose held ownership before safe return', () => {
  const rt = fixture(),
    a = submit(rt);
  until(rt, () => bed(rt).deposits === 1);
  const before = bed(rt),
    foreign = itemEntity('foreign', 'bowl', [0, 0, 0]),
    slot = surfaceSlot(rt.world, 'seed-table#r0c2');
  assert.ok(!('code' in slot));
  placeOnSlot(foreign, slot, 0);
  rt.world.entities.foreign = foreign;
  control(rt, a.id, 'pause');
  until(rt, () => {
    const child = intention(rt, a.id).child;
    return !!child && rt.records.get(child)?.status === 'blocked';
  });
  control(rt, a.id, 'end');
  for (let i = 0; i < 40; i++) rt.step();
  assert.equal(rt.isActive(a.id), true);
  assert.equal(intention(rt, a.id).mode, 'ending');
  assert.deepEqual(rt.world.entities['seed-bowl'].support, {
    kind: 'in-hand',
    by: 'planter',
    hand: 'right',
  });
  assert.equal(bed(rt).deposited, before.deposited);
  delete rt.world.entities.foreign;
  until(rt, () => !rt.isActive(a.id));
  assert.equal(bed(rt).purpose, before.purpose);
  assert.deepEqual(a.outputs?.completed, []);
  clean(rt);
});
test('rapid accepted Pause then End before next tick dispatches no seed child', () => {
  const rt = fixture(),
    a = submit(rt);
  control(rt, a.id, 'pause');
  control(rt, a.id, 'end');
  until(rt, () => !rt.isActive(a.id));
  assert.equal(
    [...rt.records.values()].filter((c) => c.parent === a.id).length,
    0,
  );
  assert.equal(bed(rt).purpose, undefined);
  clean(rt);
});
