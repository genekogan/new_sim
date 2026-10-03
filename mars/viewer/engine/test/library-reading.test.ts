import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Runtime } from '../runtime/runtime.ts';
import {
  libraryReadingRuntime,
  LIBRARY_READING_BINDING as P,
} from '../scenarios/library-reading.ts';
import {
  libraryReading,
  libraryReadingReadout,
} from '../activities/library-reading.ts';
import { readBook } from '../objects/reading.ts';
import {
  heldBy,
  itemEntity,
  placeOnSlot,
  surfaceSlot,
} from '../items/model.ts';
import { allSlots } from '../social/slots.ts';
function until(rt: Runtime, done: () => boolean) {
  for (let i = 0; i < 3000 && !done(); i++) rt.step();
  assert.ok(
    done(),
    JSON.stringify([...rt.records.values()].filter((r) => rt.isActive(r.id))),
  );
  assert.deepEqual(rt.violations, []);
}
function begin(rt: Runtime) {
  const r = rt.submit('library_reading', P);
  assert.notEqual(r.status, 'failed', r.diagnostic?.message);
  return r;
}
function out(rt: Runtime, id: string) {
  const r = libraryReadingReadout(rt, id);
  assert.ok(r);
  return r;
}
function read(rt: Runtime) {
  const r = readBook(rt, P.book);
  assert.ok(!('code' in r));
  return r;
}
function control(rt: Runtime, id: string, intent: 'pause' | 'resume' | 'end') {
  const r = rt.submit('library_reading_control', { session: id, intent });
  assert.notEqual(r.status, 'failed', r.diagnostic?.message);
  rt.step();
  assert.equal(r.status, 'completed');
  return r;
}
function done(rt: Runtime, id: string) {
  until(rt, () => !rt.isActive(id));
}
function clean(rt: Runtime, id: string) {
  for (const c of out(rt, id).children) assert.ok(!rt.isActive(c.id));
  for (const resource of [
    'library-purpose:reader',
    'library-book:book',
    'actor:reader',
    'hand:reader:right',
    'hand:reader:left',
    'entity:book',
    'entity:chair-a',
    'entity:chair-b',
    'reading:book',
    'slot:chair-a#seat',
    'slot:chair-b#seat',
    'entity:table-a',
    'entity:table-b',
    'surface-slot:table-a#r0c0',
    'surface-slot:table-b#r0c0',
  ])
    assert.deepEqual(rt.holder(resource), [], resource);
  for (const s of allSlots(rt)) assert.equal(s.claimedBy, undefined);
  assert.deepEqual(heldBy(rt.world, 'reader'), []);
  assert.deepEqual(heldBy(rt.world, 'visitor'), []);
  assert.deepEqual(rt.violations, []);
  assert.ok([...rt.records.values()].every((r) => !rt.isActive(r.id)));
  assert.equal(rt.world.entities.reader.human!.activity, 'idle');
}
function reach(
  rt: Runtime,
  id: string,
  stage: 'source-reading' | 'transfer' | 'destination-reading',
) {
  until(rt, () => {
    const r = out(rt, id);
    return (
      r.stage === stage &&
      (stage === 'transfer'
        ? rt.world.entities.book.support?.kind === 'in-hand'
        : r.elapsed >= (stage === 'source-reading' ? 2 : 9))
    );
  });
}
function ordinary(rt: Runtime, verb: string, p: unknown) {
  const r = rt.submit(verb, p);
  assert.notEqual(r.status, 'failed', r.diagnostic?.message);
  done(rt, r.id);
  assert.equal(r.status, 'completed', r.diagnostic?.message);
  return r;
}

test('library purpose completes same book and bookmark through actual single-item transfer and idle cleanup', () => {
  const rt = libraryReadingRuntime(),
    book = rt.world.entities.book;
  const fixtures = ['table-a', 'table-b', 'chair-a', 'chair-b'].map(
    (id) => [id, structuredClone(rt.world.entities[id])] as const,
  );
  const r = begin(rt);
  reach(rt, r.id, 'transfer');
  const retained = out(rt, r.id).elapsed;
  assert.ok(retained >= 7 && retained < 8);
  assert.equal(book.equipment!.config.readSeconds, retained);
  assert.equal(book.equipment!.config.status, 'unfinished');
  until(
    rt,
    () =>
      out(rt, r.id).stage === 'destination-reading' &&
      out(rt, r.id).children.at(-1)?.verb === 'read_book',
  );
  assert.equal(read(rt).elapsed, retained);
  reach(rt, r.id, 'destination-reading');
  assert.ok(read(rt).elapsed >= retained);
  assert.equal(read(rt).task, P.task);
  done(rt, r.id);
  assert.equal(r.status, 'completed');
  assert.equal(read(rt).elapsed, 24);
  assert.equal(read(rt).duration, 24);
  assert.equal(read(rt).page, 4);
  assert.equal(read(rt).user, P.actor);
  assert.equal(rt.world.entities.book, book);
  assert.deepEqual(book.support, {
    kind: 'resting-on',
    on: 'table-b',
    slot: 'r0c0',
  });
  for (const [id, saved] of fixtures)
    assert.deepEqual(rt.world.entities[id], saved);
  const children = out(rt, r.id).children;
  assert.deepEqual(
    children.map((c) => c.verb),
    ['read_book', 'tidy_table_transfer', 'read_book'],
  );
  assert.deepEqual(
    children.map((c) => c.status),
    ['cancelled', 'completed', 'completed'],
  );
  assert.ok(
    [...rt.records.values()].some(
      (c) => c.verb === 'take_item' && c.status === 'completed',
    ),
  );
  assert.ok(
    [...rt.records.values()].some(
      (c) => c.verb === 'put_item' && c.status === 'completed',
    ),
  );
  assert.equal(out(rt, r.id).finished, true);
  clean(rt, r.id);
});
for (const stage of [
  'source-reading',
  'transfer',
  'destination-reading',
] as const) {
  for (const directed of [false, true])
    test(`${directed ? 'ordinary direction' : 'Pause'} during ${stage} safely retains purpose until explicit Resume`, () => {
      const rt = libraryReadingRuntime(),
        r = begin(rt);
      reach(rt, r.id, stage);
      const elapsed = out(rt, r.id).elapsed,
        book = rt.world.entities.book;
      if (directed) ordinary(rt, 'walk_to', { actor: P.actor, x: -3, z: -3 });
      else control(rt, r.id, 'pause');
      until(rt, () => ['paused', 'waiting'].includes(out(rt, r.id).mode));
      assert.equal(out(rt, r.id).elapsed, elapsed);
      assert.notEqual(book.support?.kind, 'in-hand');
      assert.deepEqual(heldBy(rt.world, P.actor), []);
      const count = rt.records.size;
      for (let i = 0; i < 100; i++) rt.step();
      assert.equal(out(rt, r.id).elapsed, elapsed);
      assert.equal(rt.records.size, count);
      control(rt, r.id, 'resume');
      assert.equal(out(rt, r.id).elapsed, elapsed);
      done(rt, r.id);
      assert.equal(r.status, 'completed');
      assert.equal(read(rt).elapsed, 24);
      assert.equal(rt.world.entities.book, book);
      clean(rt, r.id);
    });
  for (const directCancel of [false, true])
    test(`${directCancel ? 'cancel' : 'End'} during ${stage} drains ordinary children and cannot be downgraded by Pause`, () => {
      const rt = libraryReadingRuntime(),
        r = begin(rt);
      reach(rt, r.id, stage);
      const elapsed = out(rt, r.id).elapsed;
      if (directCancel) rt.cancel(r.id);
      else control(rt, r.id, 'end');
      const pause = rt.submit('library_reading_control', {
        session: r.id,
        intent: 'pause',
      });
      assert.equal(pause.diagnostic?.code, 'library_reading.ending');
      rt.cancel(r.id);
      done(rt, r.id);
      assert.equal(r.status, 'cancelled');
      assert.equal(out(rt, r.id).finished, false);
      assert.equal(read(rt).elapsed, elapsed);
      assert.equal(read(rt).status, 'unfinished');
      clean(rt, r.id);
    });
}
test('occupied destination waits once; ordinary removal plus explicit Resume continues while unrelated actor stays usable', () => {
  const rt = libraryReadingRuntime(),
    other = itemEntity('other-book', 'reading-book', [0, 0, 0]),
    slot = surfaceSlot(rt.world, P.to);
  assert.ok(!('code' in slot));
  placeOnSlot(other, slot, 0);
  rt.world.entities[other.id] = other;
  const r = begin(rt);
  until(rt, () => out(rt, r.id).mode === 'waiting');
  assert.equal(
    out(rt, r.id).diagnostic?.code,
    'tidy_table.destination-occupied',
  );
  const elapsed = out(rt, r.id).elapsed,
    n = rt.records.size;
  for (let i = 0; i < 100; i++) rt.step();
  assert.equal(rt.records.size, n);
  const retry = rt.submit('library_reading_control', {
    session: r.id,
    intent: 'resume',
  });
  assert.equal(retry.diagnostic?.code, 'tidy_table.destination-occupied');
  ordinary(rt, 'take_item', {
    actor: 'visitor',
    item: other.id,
    hand: 'right',
  });
  ordinary(rt, 'walk_to', { actor: 'visitor', x: 6, z: -4 });
  ordinary(rt, 'put_item', {
    actor: 'visitor',
    item: other.id,
    surfaceSlot: 'ground',
  });
  assert.equal(out(rt, r.id).elapsed, elapsed);
  control(rt, r.id, 'resume');
  done(rt, r.id);
  assert.equal(r.status, 'completed');
  clean(rt, r.id);
});
test('unavailable book and changed binding refuse Resume without restarting bookmark; restored binding remains usable', () => {
  const rt = libraryReadingRuntime(),
    r = begin(rt);
  reach(rt, r.id, 'source-reading');
  control(rt, r.id, 'pause');
  until(rt, () => out(rt, r.id).mode === 'paused');
  const elapsed = read(rt).elapsed,
    config = rt.world.entities.book.equipment!.config;
  config.available = false;
  const unavailable = rt.submit('library_reading_control', {
    session: r.id,
    intent: 'resume',
  });
  assert.equal(unavailable.diagnostic?.code, 'library_reading.unavailable');
  config.available = true;
  const chair = rt.world.entities['chair-b'],
    original = structuredClone(chair.pose);
  chair.pose.p[0] += 0.1;
  const changed = rt.submit('library_reading_control', {
    session: r.id,
    intent: 'resume',
  });
  assert.equal(changed.diagnostic?.code, 'library_reading.binding-changed');
  chair.pose = original;
  ordinary(rt, 'walk_to', { actor: 'visitor', x: -5, z: -5 });
  assert.equal(read(rt).elapsed, elapsed);
  control(rt, r.id, 'resume');
  done(rt, r.id);
  clean(rt, r.id);
});
test('different retained task cannot be replaced by new library admission; refusal preserves world and unrelated clock', () => {
  const rt = libraryReadingRuntime();
  const old = rt.submit('read_book', {
    actor: P.actor,
    book: P.book,
    seat: P.sourceSeat,
    task: 'Different unfinished purpose',
    duration: 30,
  });
  until(rt, () => read(rt).elapsed >= 2);
  rt.cancel(old.id);
  done(rt, old.id);
  const hash = rt.stateHash(),
    r = rt.submit('library_reading', P);
  assert.equal(r.diagnostic?.code, 'library_reading.existing-purpose');
  assert.equal(rt.stateHash(), hash);
  ordinary(rt, 'walk_to', { actor: 'visitor', x: -5, z: -5 });
  assert.equal(read(rt).task, 'Different unfinished purpose');
  assert.deepEqual(rt.violations, []);
});
test('readout is detached and two uninterrupted fixed-DT runs match exactly', () => {
  const runs = [libraryReadingRuntime(), libraryReadingRuntime()];
  const records = runs.map((rt) => begin(rt));
  const detached = out(runs[0], records[0].id);
  detached.params.task = 'Mutated observer';
  detached.children.push({
    id: 'fake',
    verb: 'fake',
    status: 'failed',
    phase: undefined,
    diagnostic: undefined,
    history: [],
  });
  assert.equal(out(runs[0], records[0].id).params.task, P.task);
  assert.equal(out(runs[0], records[0].id).children.length, 0);
  runs.forEach((rt, i) => {
    done(rt, records[i].id);
    clean(rt, records[i].id);
  });
  assert.equal(runs[0].tick, runs[1].tick);
  assert.equal(runs[0].stateHash(), runs[1].stateHash());
  assert.deepEqual(runs[0].events, runs[1].events);
});

test('Pause during zero-progress arrival retains the existing task for explicit Resume', () => {
  const rt = libraryReadingRuntime(),
    r = begin(rt);
  until(rt, () => read(rt).status === 'active');
  assert.equal(read(rt).elapsed, 0);
  assert.equal(read(rt).status, 'active');
  control(rt, r.id, 'pause');
  until(rt, () => out(rt, r.id).mode === 'paused');
  assert.equal(read(rt).status, 'unfinished');
  assert.equal(read(rt).elapsed, 0);
  control(rt, r.id, 'resume');
  done(rt, r.id);
  assert.equal(r.status, 'completed');
  clean(rt, r.id);
});
test('external ordinary reading receipt cannot be silently adopted even without additional progress', () => {
  const rt = libraryReadingRuntime(),
    r = begin(rt);
  reach(rt, r.id, 'source-reading');
  control(rt, r.id, 'pause');
  until(rt, () => out(rt, r.id).mode === 'paused');
  const elapsed = read(rt).elapsed;
  const external = rt.submit('read_book', {
    actor: P.actor,
    book: P.book,
    seat: P.sourceSeat,
    task: P.task,
    duration: P.duration,
    resume: true,
  });
  assert.notEqual(external.status, 'failed');
  rt.cancel(external.id);
  done(rt, external.id);
  assert.equal(read(rt).elapsed, elapsed);
  const resumed = rt.submit('library_reading_control', {
    session: r.id,
    intent: 'resume',
  });
  assert.equal(resumed.diagnostic?.code, 'library_reading.receipt-replaced');
  control(rt, r.id, 'end');
  done(rt, r.id);
  clean(rt, r.id);
});

test('external ordinary relocation cannot skip the retained source-reading stage', () => {
  const rt = libraryReadingRuntime(),
    r = begin(rt);
  reach(rt, r.id, 'source-reading');
  control(rt, r.id, 'pause');
  until(rt, () => out(rt, r.id).mode === 'paused');
  const elapsed = read(rt).elapsed;
  ordinary(rt, 'tidy_table_transfer', {
    actor: P.actor,
    item: P.book,
    from: P.from,
    to: P.to,
  });
  const resumed = rt.submit('library_reading_control', {
    session: r.id,
    intent: 'resume',
  });
  assert.equal(resumed.diagnostic?.code, 'library_reading.stage-support');
  assert.equal(read(rt).elapsed, elapsed);
  ordinary(rt, 'tidy_table_transfer', {
    actor: P.actor,
    item: P.book,
    from: P.to,
    to: P.from,
  });
  control(rt, r.id, 'resume');
  done(rt, r.id);
  clean(rt, r.id);
});

for (const transferAfter of [1.99, 1.950001])
  test(`near-completion threshold ${transferAfter} refuses before creating a child`, () => {
    const rt = libraryReadingRuntime(),
      before = rt.stateHash();
    const r = rt.submit('library_reading', {
      ...P,
      duration: 2,
      transferAfter,
    });
    assert.equal(r.status, 'failed');
    assert.equal(r.diagnostic?.code, 'library_reading.interval');
    assert.equal(rt.stateHash(), before);
    assert.equal(rt.records.size, 1);
    assert.deepEqual(rt.violations, []);
  });
for (const [duration, transferAfter] of [
  [2, 1.95],
  [2, 1.9500000000000002],
  [2.05001, 2.01],
])
  test(`supported fixed-tick threshold ${transferAfter} of ${duration} completes`, () => {
    const rt = libraryReadingRuntime(),
      r = rt.submit('library_reading', { ...P, duration, transferAfter });
    assert.notEqual(r.status, 'failed', r.diagnostic?.message);
    until(rt, () => out(rt, r.id).stage === 'transfer');
    const retained = read(rt).elapsed;
    assert.ok(retained >= transferAfter);
    assert.ok(retained < duration);
    assert.equal(read(rt).status, 'unfinished');
    done(rt, r.id);
    assert.equal(r.status, 'completed');
    assert.equal(read(rt).elapsed, duration);
    clean(rt, r.id);
  });
test('repeated live observation does not mutate authoritative purpose, world, records, or events', () => {
  const rt = libraryReadingRuntime();
  let authoritative: ReturnType<typeof libraryReading.start> | undefined;
  rt.registry.set('library_reading', {
    ...libraryReading,
    start(...args: Parameters<typeof libraryReading.start>) {
      authoritative = libraryReading.start(...args);
      return authoritative;
    },
  });
  const r = begin(rt);
  until(rt, () => read(rt).status === 'active');
  assert.ok(authoritative);
  assert.equal(authoritative.bookmark, false);
  const arrival = structuredClone(authoritative);
  for (let i = 0; i < 50; i++) assert.equal(out(rt, r.id).elapsed, 0);
  assert.deepEqual(
    authoritative,
    arrival,
    'observation cannot install a bookmark',
  );
  until(rt, () => read(rt).elapsed >= 2);
  assert.ok(authoritative);
  const before = structuredClone(authoritative),
    hash = rt.stateHash(),
    records = structuredClone([...rt.records]),
    events = structuredClone(rt.events);
  assert.ok(
    authoritative.elapsed < read(rt).elapsed,
    'ordinary child progressed after parent on this tick',
  );
  for (let i = 0; i < 50; i++) {
    const observed = out(rt, r.id);
    assert.equal(observed.elapsed, read(rt).elapsed);
    observed.children.length = 0;
  }
  assert.deepEqual(authoritative, before);
  assert.equal(rt.stateHash(), hash);
  assert.deepEqual([...rt.records], records);
  assert.deepEqual(rt.events, events);
  done(rt, r.id);
  clean(rt, r.id);
});
