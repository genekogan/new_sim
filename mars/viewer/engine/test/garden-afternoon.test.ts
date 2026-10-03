import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gardenAfternoonRuntime,
  startGardenAfternoon,
  readGardenAfternoon,
  controlGardenAfternoon,
  gardenAfternoonDirection,
} from '../scenarios/garden-afternoon.ts';
import type { Runtime } from '../runtime/runtime.ts';
import { itemEntity, placeOnSlot, surfaceSlot } from '../items/model.ts';
import { hashOf } from '../core/hash.ts';
function read(rt: Runtime) {
  const s = readGardenAfternoon(rt);
  assert.ok(s);
  assert.ok(!('code' in s.seedbed));
  assert.ok(!('code' in s.book));
  assert.ok(!('code' in s.garden));
  return { ...s, seedbed: s.seedbed, book: s.book, garden: s.garden };
}
function until(rt: Runtime, predicate: () => boolean, max = 3000) {
  for (let i = 0; i < max && !predicate(); i++) {
    rt.step();
    assert.deepEqual(rt.violations, []);
    const s = read(rt);
    assert.equal(s.seeds.contents!.fraction + s.seedbed.deposited, 0.5);
    assert.equal(s.water.contents!.fraction + s.garden.waterReceived, 0.5);
  }
  assert.ok(predicate(), JSON.stringify(read(rt)));
}
function clean(rt: Runtime) {
  assert.deepEqual(rt.violations, []);
  assert.equal(
    [...rt.records.values()].filter((r) => rt.isActive(r.id)).length,
    0,
  );
  for (const id of Object.keys(rt.world.entities))
    for (const key of [
      `entity:${id}`,
      `actor:${id}`,
      `routine:${id}`,
      `holds:${id}`,
      `hand:${id}:right`,
      `hand:${id}:left`,
    ])
      assert.deepEqual(rt.holder(key), []);
  assert.deepEqual(rt.world.entities['seed-bowl'].support, {
    kind: 'resting-on',
    on: 'seed-table',
    slot: 'r0c2',
  });
  assert.deepEqual(rt.world.entities['water-bowl'].support, {
    kind: 'resting-on',
    on: 'seed-table',
    slot: 'r0c1',
  });
}
for (const angle of [0, Math.PI / 2]) {
  test(`connected retained seeds/care and sliced book finish at yaw ${angle}`, () => {
    const rt = gardenAfternoonRuntime(angle),
      ids = Object.keys(rt.world.entities).sort();
    startGardenAfternoon(rt, angle);
    until(rt, () => read(rt).branches.reader.intention!.index === 1);
    const bookmark = read(rt).book;
    assert.ok(bookmark.elapsed > 0 && bookmark.elapsed < 24);
    until(rt, () => read(rt).branches.reader.intention!.index === 2);
    assert.equal(read(rt).book.elapsed, bookmark.elapsed);
    until(rt, () => read(rt).phase === 'completed');
    const s = read(rt);
    assert.equal(s.seedbed.deposited, 0.25);
    assert.equal(s.seedbed.completed, true);
    assert.equal(s.garden.waterReceived, 0.25);
    assert.equal(s.garden.cycles, 1);
    assert.equal(s.book.elapsed, 24);
    assert.equal(s.book.status, 'completed');
    assert.equal(s.book.task, bookmark.task);
    assert.deepEqual(Object.keys(rt.world.entities).sort(), ids);
    assert.equal(
      [...rt.records.values()].filter((r) => r.verb === 'seed_planting').length,
      1,
    );
    assert.equal(
      [...rt.records.values()].filter((r) => r.verb === 'read_book').length,
      2,
    );
    clean(rt);
  });
  test(`partial seed Pause, local player direction, explicit Resume at yaw ${angle}`, () => {
    const rt = gardenAfternoonRuntime(angle);
    startGardenAfternoon(rt, angle);
    until(rt, () => read(rt).seedbed.deposits === 1);
    const before = read(rt),
      purpose = before.seedbed.purpose;
    controlGardenAfternoon(rt, 'gardener', 'pause');
    until(rt, () => read(rt).branches.gardener.intention!.mode === 'paused');
    const paused = read(rt);
    assert.equal(paused.seedbed.deposited, before.seedbed.deposited);
    until(rt, () => read(rt).book.elapsed > before.book.elapsed);
    assert.equal(read(rt).branches.gardener.intention!.mode, 'paused');
    const walk = rt.submit(
      'walk_to',
      gardenAfternoonDirection('gardener', angle),
    );
    assert.notEqual(walk.status, 'failed');
    until(rt, () => !rt.isActive(walk.id));
    assert.equal(read(rt).branches.gardener.intention!.mode, 'paused');
    controlGardenAfternoon(rt, 'gardener', 'resume');
    until(rt, () => read(rt).phase === 'completed');
    assert.equal(read(rt).seedbed.purpose, purpose);
    assert.equal(read(rt).seedbed.source, 'seed-bowl');
    clean(rt);
  });
}
test('reader direction pauses only its commitment and retains same bookmark; gardener finishes independently', () => {
  const rt = gardenAfternoonRuntime();
  startGardenAfternoon(rt);
  until(rt, () => read(rt).book.elapsed > 1);
  const before = read(rt).book,
    walk = rt.submit('walk_to', gardenAfternoonDirection('reader'));
  until(
    rt,
    () =>
      !rt.isActive(walk.id) &&
      read(rt).branches.reader.intention!.mode === 'paused',
  );
  assert.equal(read(rt).book.elapsed, before.elapsed);
  until(rt, () => !read(rt).branches.gardener.active);
  assert.equal(read(rt).book.elapsed, before.elapsed);
  controlGardenAfternoon(rt, 'reader', 'resume');
  until(rt, () => read(rt).phase === 'completed');
  assert.equal(read(rt).book.task, before.task);
  clean(rt);
});
test('unavailable source waits without failed child spam while reader advances; repair continues finite original bowl', () => {
  const rt = gardenAfternoonRuntime();
  rt.world.entities['seed-bowl'].contents!.food = 'water';
  startGardenAfternoon(rt);
  until(rt, () => read(rt).branches.gardener.intention!.mode === 'waiting');
  assert.equal(
    read(rt).branches.gardener.diagnostic?.code,
    'seed_planting.seeds-unavailable',
  );
  const own = read(rt).gardener,
    count = [...rt.records.values()].filter((r) => r.parent === own).length;
  for (let i = 0; i < 120; i++) rt.step();
  assert.equal(
    [...rt.records.values()].filter((r) => r.parent === own).length,
    count,
  );
  assert.equal(read(rt).seedbed.purpose, undefined);
  assert.ok(read(rt).book.elapsed > 0);
  rt.world.entities['seed-bowl'].contents!.food = 'seeds';
  until(rt, () => read(rt).phase === 'completed');
  clean(rt);
});
test('rapid Pause/End before first tick creates no seed purpose, leaves reader active, and releases ended branch', () => {
  const rt = gardenAfternoonRuntime();
  startGardenAfternoon(rt);
  controlGardenAfternoon(rt, 'gardener', 'pause');
  controlGardenAfternoon(rt, 'gardener', 'end');
  until(rt, () => !read(rt).branches.gardener.active);
  assert.equal(read(rt).seedbed.purpose, undefined);
  assert.equal(
    [...rt.records.values()].filter((r) => r.verb === 'seed_planting').length,
    0,
  );
  assert.equal(read(rt).branches.reader.active, true);
  controlGardenAfternoon(rt, 'reader', 'end');
  until(rt, () => read(rt).phase === 'ended');
  clean(rt);
});
test('End during partial sowing safely retains effects and cannot silently Resume an ended intention', () => {
  const rt = gardenAfternoonRuntime();
  startGardenAfternoon(rt);
  until(rt, () => read(rt).seedbed.deposits === 1);
  const before = read(rt).seedbed;
  controlGardenAfternoon(rt, 'gardener', 'end');
  until(rt, () => !read(rt).branches.gardener.active);
  assert.equal(read(rt).seedbed.purpose, before.purpose);
  assert.equal(read(rt).seedbed.deposited, before.deposited);
  const refused = controlGardenAfternoon(rt, 'gardener', 'resume');
  assert.ok('status' in refused && refused.status === 'failed');
  controlGardenAfternoon(rt, 'reader', 'end');
  until(rt, () => read(rt).phase === 'ended');
  clean(rt);
});
test('same interruption decisions replay exact world, records and events', () => {
  const run = () => {
    const rt = gardenAfternoonRuntime();
    startGardenAfternoon(rt);
    until(rt, () => read(rt).seedbed.deposits === 1);
    controlGardenAfternoon(rt, 'gardener', 'pause');
    until(rt, () => read(rt).branches.gardener.intention!.mode === 'paused');
    controlGardenAfternoon(rt, 'gardener', 'resume');
    until(rt, () => read(rt).phase === 'completed');
    clean(rt);
    return hashOf([rt.world, [...rt.records.values()], rt.events]);
  };
  assert.equal(run(), run());
});

test('blocked cleanup exposes the physical refusal while holding the same finite bowl; clearing the slot permits safe Pause and Resume', () => {
  const rt = gardenAfternoonRuntime();
  startGardenAfternoon(rt);
  until(rt, () => read(rt).seedbed.deposits === 1);
  const before = read(rt).seedbed,
    foreign = itemEntity('foreign', 'bowl', [0, 0, 0]),
    slot = surfaceSlot(rt.world, 'seed-table#r0c2');
  assert.ok(!('code' in slot));
  placeOnSlot(foreign, slot, 0);
  rt.world.entities.foreign = foreign;
  controlGardenAfternoon(rt, 'gardener', 'pause');
  until(rt, () => !!read(rt).branches.gardener.diagnostic);
  assert.equal(read(rt).branches.gardener.intention!.mode, 'draining');
  assert.equal(read(rt).branches.gardener.planting!.status, 'blocked');
  assert.ok(
    read(rt).branches.gardener.diagnostic!.subjects?.includes(
      'seed-table#r0c2',
    ),
  );
  assert.deepEqual(read(rt).seeds.support, {
    kind: 'in-hand',
    by: 'planter',
    hand: 'right',
  });
  assert.equal(read(rt).seedbed.deposited, before.deposited);
  const count = rt.records.size;
  for (let i = 0; i < 20; i++) rt.step();
  assert.equal(rt.records.size, count);
  delete rt.world.entities.foreign;
  until(rt, () => read(rt).branches.gardener.intention!.mode === 'paused');
  controlGardenAfternoon(rt, 'gardener', 'resume');
  until(rt, () => read(rt).phase === 'completed');
  assert.equal(read(rt).seedbed.purpose, before.purpose);
  clean(rt);
});
