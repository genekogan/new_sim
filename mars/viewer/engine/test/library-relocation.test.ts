import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../api/registry.ts';
import { Spatial } from '../spatial/service.ts';
import { READING_SCENE } from '../scenarios/reading.ts';
import { emptyWorld, addAll, human, FIXTURE } from '../world/factory.ts';
import type { Entity } from '../world/types.ts';
import {
  itemEntity,
  surfaceSlot,
  placeOnSlot,
  heldBy,
} from '../items/model.ts';
import { readBook } from '../objects/reading.ts';
import { allSlots } from '../social/slots.ts';

const binding = {
  actor: 'reader',
  book: 'book',
  seat: 'chair-a#seat',
  task: 'Same hypothetical book study',
  duration: 24,
};
function setup(occupied = false) {
  const fixture = (id: string, def: string, x: number, z: number): Entity => ({
    id,
    def,
    kind: 'fixture',
    pose: { p: [x, 0, z], yaw: 0 },
    support: { kind: 'ground' },
    provenance: FIXTURE,
  });
  // Both compatible chairs are declared initial fixtures; no chair relocation claim.
  const world = addAll(
    emptyWorld('library-relocation', READING_SCENE),
    fixture('table-a', 'table-6ft', 0, 0),
    fixture('table-b', 'table-6ft', 4, 0),
    fixture('chair-a', 'camp-chair', -0.75, -0.85),
    fixture('chair-b', 'camp-chair', 3.25, -0.85),
    human('reader', -0.75, -3),
  );
  const book = itemEntity('book', 'reading-book', [0, 0, 0]);
  const a = surfaceSlot(world, 'table-a#r0c0');
  assert.ok(!('code' in a));
  placeOnSlot(book, a, 0);
  world.entities.book = book;
  if (occupied) {
    const other = itemEntity('other-book', 'reading-book', [0, 0, 0]);
    const b = surfaceSlot(world, 'table-b#r0c0');
    assert.ok(!('code' in b));
    placeOnSlot(other, b, 0);
    world.entities[other.id] = other;
  }
  return new Runtime(
    world,
    createRegistry(),
    { spatial: new Spatial(READING_SCENE) },
    ENGINE_INVARIANTS,
  );
}
function until(rt: Runtime, done: () => boolean) {
  for (let i = 0; i < 3000 && !done(); i++) rt.step();
  assert.ok(
    done(),
    JSON.stringify([...rt.records.values()].filter((r) => rt.isActive(r.id))),
  );
  assert.deepEqual(rt.violations, []);
}
function read(rt: Runtime) {
  const r = readBook(rt, 'book');
  assert.ok(!('code' in r));
  return r;
}
function action(rt: Runtime, verb: string, params: unknown) {
  const r = rt.submit(verb, params, { preempt: false });
  assert.notEqual(r.status, 'failed', r.diagnostic?.message);
  until(rt, () => !rt.isActive(r.id));
  assert.equal(r.status, 'completed', r.diagnostic?.message);
  return r;
}
function checkpoint(rt: Runtime) {
  const r = rt.submit('read_book', binding, { preempt: false });
  assert.notEqual(r.status, 'failed', r.diagnostic?.message);
  until(rt, () => read(rt).elapsed >= 7);
  assert.equal(rt.world.entities.reader.human!.activity, 'sit');
  const elapsed = read(rt).elapsed;
  rt.cancel(r.id);
  assert.ok(rt.isActive(r.id));
  until(rt, () => !rt.isActive(r.id));
  assert.equal(r.status, 'cancelled');
  assert.equal(read(rt).elapsed, elapsed);
  assert.equal(read(rt).status, 'unfinished');
  assert.equal(read(rt).page, 2);
  assert.equal(rt.world.entities.reader.human!.activity, 'idle');
  clean(rt);
  return {
    action: r,
    bookmark: read(rt),
    config: structuredClone(rt.world.entities.book.equipment),
  };
}
function take(rt: Runtime) {
  return action(rt, 'take_item', {
    actor: 'reader',
    item: 'book',
    hand: 'right',
  });
}
function put(rt: Runtime, surfaceSlot: string) {
  return action(rt, 'put_item', { actor: 'reader', item: 'book', surfaceSlot });
}
function clean(rt: Runtime) {
  for (const resource of [
    'actor:reader',
    'hand:reader:left',
    'hand:reader:right',
    'holds:reader',
    'reading:book',
    'slot:chair-a#seat',
    'slot:chair-b#seat',
    'entity:other-book',
    'entity:book',
    'entity:table-a',
    'entity:table-b',
    'entity:chair-a',
    'entity:chair-b',
    'surface-slot:table-a#r0c0',
    'surface-slot:table-b#r0c0',
    'surface-slot:table-b#r0c1',
  ])
    assert.deepEqual(rt.holder(resource), [], resource);
  for (const s of allSlots(rt)) assert.equal(s.claimedBy, undefined, s.id);
  assert.deepEqual(heldBy(rt.world, 'reader'), []);
  assert.deepEqual(rt.violations, []);
  assert.ok([...rt.records.values()].every((r) => !rt.isActive(r.id)));
}

test('same book physically relocates between supported tables and resumes exact retained bookmark', () => {
  const rt = setup(),
    book = rt.world.entities.book;
  const fixtures = Object.fromEntries(
    ['table-a', 'table-b', 'chair-a', 'chair-b'].map((id) => [
      id,
      structuredClone(rt.world.entities[id]),
    ]),
  );
  const partial = checkpoint(rt);
  const taken = take(rt);
  assert.deepEqual(book.support, {
    kind: 'in-hand',
    by: 'reader',
    hand: 'right',
  });
  assert.deepEqual(book.equipment, partial.config);
  const start = structuredClone(book.pose);
  const walk = action(rt, 'walk_to', { actor: 'reader', x: 4, z: -2 });
  assert.notDeepEqual(book.pose, start);
  assert.deepEqual(book.equipment, partial.config);
  const placed = put(rt, 'table-b#r0c0');
  assert.deepEqual(book.support, {
    kind: 'resting-on',
    on: 'table-b',
    slot: 'r0c0',
  });
  const slot = surfaceSlot(rt.world, 'table-b#r0c0');
  assert.ok(!('code' in slot));
  assert.deepEqual(book.pose.p, slot.p);
  assert.deepEqual(book.equipment, partial.config);
  assert.deepEqual(read(rt), partial.bookmark);
  const resumed = rt.submit(
    'read_book',
    { ...binding, seat: 'chair-b#seat', resume: true },
    { preempt: false },
  );
  assert.notEqual(resumed.status, 'failed', resumed.diagnostic?.message);
  assert.equal(read(rt).elapsed, partial.bookmark.elapsed);
  assert.equal(read(rt).page, partial.bookmark.page);
  until(rt, () => resumed.phase === 'reading');
  assert.equal(rt.world.entities.reader.human!.activity, 'sit');
  until(rt, () => !rt.isActive(resumed.id));
  assert.equal(resumed.status, 'completed');
  assert.equal(read(rt).elapsed, 24);
  assert.equal(read(rt).page, 4);
  assert.equal(read(rt).duration, binding.duration);
  assert.equal(read(rt).task, binding.task);
  assert.equal(read(rt).user, binding.actor);
  assert.equal(rt.world.entities.book, book);
  assert.deepEqual(book.support, {
    kind: 'resting-on',
    on: 'table-b',
    slot: 'r0c0',
  });
  for (const [id, entity] of Object.entries(fixtures))
    assert.deepEqual(rt.world.entities[id], entity);
  assert.deepEqual(
    [taken.verb, walk.verb, placed.verb],
    ['take_item', 'walk_to', 'put_item'],
  );
  assert.ok([...rt.records.values()].every((r) => r.status !== 'failed'));
  clean(rt);
});

test('held reading and nonexistent placement refuse without losing original held book or bookmark', () => {
  const rt = setup(),
    partial = checkpoint(rt);
  take(rt);
  const before = rt.stateHash();
  const held = rt.submit(
    'read_book',
    { ...binding, resume: true },
    { preempt: false },
  );
  assert.equal(held.diagnostic?.code, 'reading.support-required');
  assert.equal(rt.stateHash(), before);
  const bad = rt.submit(
    'put_item',
    { actor: 'reader', item: 'book', surfaceSlot: 'table-b#missing' },
    { preempt: false },
  );
  assert.equal(bad.diagnostic?.code, 'item.unknown-slot');
  assert.equal(rt.stateHash(), before);
  assert.deepEqual(rt.world.entities.book.equipment, partial.config);
  assert.deepEqual(rt.world.entities.book.support, {
    kind: 'in-hand',
    by: 'reader',
    hand: 'right',
  });
  put(rt, 'table-a#r0c0');
  assert.deepEqual(read(rt), partial.bookmark);
  clean(rt);
});

test('ordinary ground placement is physically valid but refuses unsupported reading', () => {
  const rt = setup(),
    partial = checkpoint(rt);
  take(rt);
  const heldHash = rt.stateHash();
  const unsafe = rt.submit(
    'put_item',
    { actor: 'reader', item: 'book', surfaceSlot: 'ground' },
    { preempt: false },
  );
  assert.equal(unsafe.diagnostic?.code, 'item.no-room');
  assert.equal(rt.stateHash(), heldHash);
  assert.deepEqual(rt.world.entities.book.support, {
    kind: 'in-hand',
    by: 'reader',
    hand: 'right',
  });
  action(rt, 'walk_to', { actor: 'reader', x: -3, z: -3 });
  put(rt, 'ground');
  assert.equal(rt.world.entities.book.support?.kind, 'ground');
  const before = rt.stateHash(),
    refused = rt.submit(
      'read_book',
      { ...binding, resume: true },
      { preempt: false },
    );
  assert.equal(refused.diagnostic?.code, 'reading.support-required');
  assert.equal(rt.stateHash(), before);
  assert.deepEqual(rt.world.entities.book.equipment, partial.config);
  take(rt);
  put(rt, 'table-b#r0c0');
  assert.deepEqual(read(rt), partial.bookmark);
  clean(rt);
});

test('occupied destination refuses while book remains held, ordinary alternate placement restores coherent support', () => {
  const rt = setup(true),
    partial = checkpoint(rt),
    other = structuredClone(rt.world.entities['other-book']);
  take(rt);
  const before = rt.stateHash(),
    refused = rt.submit(
      'put_item',
      { actor: 'reader', item: 'book', surfaceSlot: 'table-b#r0c0' },
      { preempt: false },
    );
  assert.equal(refused.diagnostic?.code, 'item.slot-occupied');
  assert.equal(rt.stateHash(), before);
  assert.deepEqual(rt.world.entities.book.support, {
    kind: 'in-hand',
    by: 'reader',
    hand: 'right',
  });
  assert.deepEqual(rt.world.entities.book.equipment, partial.config);
  put(rt, 'table-b#r0c1');
  assert.deepEqual(rt.world.entities['other-book'], other);
  assert.deepEqual(rt.world.entities.book.support, {
    kind: 'resting-on',
    on: 'table-b',
    slot: 'r0c1',
  });
  assert.equal(read(rt).elapsed, partial.bookmark.elapsed);
  clean(rt);
});
