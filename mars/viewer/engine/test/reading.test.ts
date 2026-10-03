import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readingRuntime,
  READING_BINDING,
  READING_SCENE,
} from '../scenarios/reading.ts';
import { readBook } from '../objects/reading.ts';
import { Runtime } from '../runtime/runtime.ts';
import { SnapshotError } from '../runtime/snapshot.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../api/registry.ts';
import { Spatial } from '../spatial/service.ts';
import { itemEntity, surfaceSlot, placeOnSlot } from '../items/model.ts';
import { FIXTURE } from '../world/factory.ts';
import { allSlots } from '../social/slots.ts';
function read(rt: Runtime) {
  const s = readBook(rt, 'book');
  assert.ok(!('code' in s));
  return s;
}
function until(rt: Runtime, done: () => boolean) {
  for (let i = 0; i < 3000 && !done(); i++) rt.step();
  assert.ok(done());
  assert.deepEqual(rt.violations, []);
}
function clean(rt: Runtime) {
  for (const key of [
    'actor:reader',
    'reading:book',
    'entity:book',
    'entity:reading-table',
    'entity:reading-chair',
  ])
    assert.deepEqual(rt.holder(key), [], key);
  for (const s of allSlots(rt)) assert.equal(s.claimedBy, undefined);
  assert.deepEqual(rt.violations, []);
}
for (const yaw of [0, Math.PI / 2])
  test(`reading uses supported identity, actual seated approach and four sections at yaw ${yaw}`, () => {
    const rt = readingRuntime(yaw),
      before = structuredClone(rt.world.entities.book),
      a = rt.submit('read_book', READING_BINDING),
      pages = new Set<number>();
    until(rt, () => {
      pages.add(read(rt).page);
      return !rt.isActive(a.id);
    });
    assert.equal(a.status, 'completed', a.diagnostic?.message);
    assert.equal(read(rt).status, 'completed');
    assert.equal(read(rt).elapsed, 24);
    assert.deepEqual([...pages], [1, 2, 3, 4]);
    assert.deepEqual(rt.world.entities.book.pose, before.pose);
    assert.deepEqual(rt.world.entities.book.support, before.support);
    clean(rt);
  });
test('safe interruption, quiescent restore and same-reader resume preserve bookmark and complete total reading', () => {
  const rt = readingRuntime(),
    a = rt.submit('read_book', READING_BINDING);
  until(rt, () => read(rt).elapsed >= 7);
  const before = rt.stateHash();
  assert.throws(
    () => rt.snapshot({ allowDrop: true }),
    (e) =>
      e instanceof SnapshotError &&
      e.code === 'snapshot.drop-unsafe' &&
      e.subjects.includes('book'),
  );
  assert.equal(rt.stateHash(), before);
  rt.cancel(a.id);
  until(rt, () => !rt.isActive(a.id));
  clean(rt);
  const bookmark = read(rt);
  assert.equal(bookmark.status, 'unfinished');
  assert.equal(bookmark.page, 2);
  assert.equal(
    rt.submit('read_book', {
      ...READING_BINDING,
      actor: 'visitor',
      resume: true,
    }).diagnostic?.code,
    'reading.unfinished-task',
  );
  const copy = Runtime.restore(
    JSON.parse(JSON.stringify(rt.snapshot())),
    createRegistry(),
    { spatial: new Spatial(READING_SCENE) },
    ENGINE_INVARIANTS,
  );
  assert.deepEqual(read(copy), bookmark);
  const resumed = copy.submit('read_book', {
    ...READING_BINDING,
    resume: true,
  });
  until(copy, () => !copy.isActive(resumed.id));
  assert.equal(resumed.status, 'completed', resumed.diagnostic?.message);
  assert.equal(read(copy).elapsed, 24);
  clean(copy);
});
test('wrong capability, unsupported book, distant/facing chair and unavailable book refuse without world mutation', () => {
  for (const [mutate, code] of [
    [
      (rt: Runtime) => {
        rt.world.entities.book.def = 'bowl';
      },
      'reading.no-capability',
    ],
    [
      (rt: Runtime) => {
        rt.world.entities.book.support = { kind: 'ground' };
      },
      'reading.support-required',
    ],
    [
      (rt: Runtime) => {
        rt.world.entities['reading-chair'].pose.p[2] = -2;
      },
      'reading.seat-incompatible',
    ],
    [
      (rt: Runtime) => {
        rt.world.entities['reading-chair'].pose.yaw = Math.PI;
      },
      'reading.seat-incompatible',
    ],
    [
      (rt: Runtime) => {
        rt.world.entities.book.equipment = {
          kind: 'reading',
          config: { available: false },
        };
      },
      'reading.unavailable',
    ],
  ] as const) {
    const rt = readingRuntime();
    mutate(rt);
    const before = rt.stateHash();
    assert.equal(
      rt.submit('read_book', READING_BINDING).diagnostic?.code,
      code,
    );
    assert.equal(rt.stateHash(), before);
  }
});
test('moved book drains only owned seating and retains interrupted progress', () => {
  const rt = readingRuntime(),
    a = rt.submit('read_book', READING_BINDING);
  until(rt, () => read(rt).elapsed >= 1);
  rt.world.entities.book.pose.yaw = 0.5;
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'failed');
  assert.equal(a.diagnostic?.code, 'reading.book-moved');
  assert.equal(read(rt).status, 'unfinished');
  clean(rt);
});
test('occupied seat and foreign directive respect shared authoritative ownership and retained bookmark', () => {
  const rt = readingRuntime(),
    seat = rt.submit('sit', { actor: 'visitor', slot: READING_BINDING.seat });
  assert.equal(
    rt.submit('read_book', READING_BINDING).diagnostic?.code,
    'reading.seat-occupied',
  );
  rt.cancel(seat.id);
  until(rt, () => !rt.isActive(seat.id));
  const a = rt.submit('read_book', READING_BINDING);
  until(rt, () => read(rt).elapsed >= 1);
  const directive = rt.submit('walk_to', { actor: 'reader', x: 3, z: -3 });
  until(rt, () => !rt.isActive(directive.id));
  assert.equal(directive.status, 'completed', directive.diagnostic?.message);
  assert.equal(a.status, 'cancelled');
  assert.equal(read(rt).status, 'unfinished');
  clean(rt);
});
test('same recorded decisions reproduce reading and interruption exactly', () => {
  function run() {
    const rt = readingRuntime(),
      a = rt.submit('read_book', READING_BINDING);
    until(rt, () => read(rt).elapsed >= 7);
    rt.cancel(a.id);
    until(rt, () => !rt.isActive(a.id));
    const b = rt.submit('read_book', { ...READING_BINDING, resume: true });
    until(rt, () => !rt.isActive(b.id));
    return { hash: rt.stateHash(), records: [...rt.records.values()] };
  }
  assert.deepEqual(run(), run());
});
test('unavailable book during reading stops coherently and cannot silently discard the bookmark', () => {
  const rt = readingRuntime(),
    a = rt.submit('read_book', READING_BINDING);
  until(rt, () => read(rt).elapsed >= 1);
  rt.world.entities.book.equipment!.config.available = false;
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.diagnostic?.code, 'reading.unavailable');
  assert.equal(read(rt).status, 'unfinished');
  clean(rt);
  const before = rt.stateHash();
  assert.equal(
    rt.submit('read_book', { ...READING_BINDING, resume: true }).diagnostic
      ?.code,
    'reading.unavailable',
  );
  assert.equal(rt.stateHash(), before);
  rt.world.entities.book.equipment!.config.available = true;
  assert.equal(
    rt.submit('read_book', { ...READING_BINDING, duration: 30, resume: true })
      .diagnostic?.code,
    'reading.unfinished-task',
  );
});
test('cancel before arrival records a zero bookmark and releases ordinary physical children', () => {
  const rt = readingRuntime(),
    a = rt.submit('read_book', READING_BINDING);
  rt.step();
  rt.cancel(a.id);
  until(rt, () => !rt.isActive(a.id));
  assert.equal(read(rt).elapsed, 0);
  assert.equal(read(rt).status, 'unfinished');
  clean(rt);
  const resumed = rt.submit('read_book', { ...READING_BINDING, resume: true });
  until(rt, () => !rt.isActive(resumed.id));
  assert.equal(resumed.status, 'completed');
  clean(rt);
});

test('two independent readers share table support without sharing books, chairs or progress', () => {
  const rt = readingRuntime();
  rt.world.entities['reading-chair'].pose.p[0] = -0.45;
  const first = surfaceSlot(rt.world, 'reading-table#r0c1');
  assert.ok(!('code' in first));
  placeOnSlot(rt.world.entities.book, first, 0);
  rt.world.entities['visitor-chair'] = {
    id: 'visitor-chair',
    def: 'camp-chair',
    kind: 'fixture',
    pose: { p: [0.45, 0, -0.85], yaw: 0 },
    provenance: FIXTURE,
  };
  const book = itemEntity('visitor-book', 'reading-book', [0, 0, 0]);
  const second = surfaceSlot(rt.world, 'reading-table#r0c4');
  assert.ok(!('code' in second));
  placeOnSlot(book, second, 0);
  rt.world.entities[book.id] = book;
  const a = rt.submit('read_book', READING_BINDING),
    b = rt.submit('read_book', {
      actor: 'visitor',
      book: book.id,
      seat: 'visitor-chair#seat',
      duration: 12,
      task: 'Another reading',
    });
  assert.notEqual(a.status, 'failed', a.diagnostic?.message);
  assert.notEqual(b.status, 'failed', b.diagnostic?.message);
  assert.equal(rt.holder('entity:reading-table').length, 2);
  until(rt, () => !rt.isActive(b.id));
  assert.equal(b.status, 'completed', b.diagnostic?.message);
  assert.equal(read(rt).status, 'active');
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assert.equal(read(rt).elapsed, 24);
  assert.equal(book.equipment!.config.readSeconds, 12);
  clean(rt);
});
