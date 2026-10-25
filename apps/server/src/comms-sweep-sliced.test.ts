import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Db } from './db.ts';
import { commsFixture } from './edge/comms/testing.ts';
import type { ObjectKind, ObjectRecord } from './edge/comms/objects/types.ts';
import type { CommsOptions } from './edge/comms/index.ts';

type State = { name: string; n: number; target: number; tick: number };
type Fixture = ReturnType<typeof fixture>;
function fixture(t: TestContext, options: CommsOptions = {}) {
  const db = new Db(':memory:');
  const f = commsFixture(['Alice'], options, { dir: '', db, clock: { now: 1_800_000_000_000 } });
  t.after(() => { f.close(); db.close(); });
  const visits: string[] = [], events: unknown[] = [];
  const kind: ObjectKind<State> = {
    kind: 'sweep-fixture', description: 'Synthetic timed object', listed: true, roles: [], actions: {},
    schema: { name: { type: 'string', visibility: 'public' }, n: { type: 'integer', visibility: 'public' },
      target: { type: 'integer', visibility: 'public' }, tick: { type: 'integer', visibility: 'public' } },
    initial: p => ({ name: String(p.name), n: 0, target: Number(p.target ?? 1), tick: 0 }), rolesOf: () => [],
    advance(s, ctx) {
      visits.push(s.name);
      return s.n === s.target ? null : { state: { ...s, n: s.target, tick: ctx.tick },
        events: [{ to: [f.id('Alice')], text: s.name }] };
    },
  };
  f.runtime.objects.register(kind);
  f.runtime.onSpectator(m => events.push(m));
  const add = (id: string, target = 1) => f.runtime.objects.create({ id, kind: kind.kind, name: id,
    placeId: 'eden-commons', params: { name: id, target } });
  return { ...f, visits, events, add, kind };
}
function row(f: Fixture, id: string): ObjectRecord & { state: State } {
  const r = f.db.db.prepare('SELECT body FROM edge_comms_objects WHERE world_id=? AND id=?').get(f.host.worldId, id) as { body: string };
  return JSON.parse(r.body);
}
function logs(f: Fixture) {
  return f.db.db.prepare('SELECT object_id,version,action,tick FROM edge_comms_object_log WHERE world_id=? ORDER BY object_id,version').all(f.host.worldId);
}
function drainSteps(f: Fixture) {
  const g = f.runtime.objects.sweepSteps();
  for (let n = 0; ; n++) {
    assert.ok(n < 100, 'finite fixture pass');
    const result = g.next();
    assert.equal(f.db.db.isTransaction, false, 'each yield leaves no SQL transaction open');
    if (result.done) break;
  }
}
type Timer = { run: () => void; active: boolean; unref(): void };
function scheduler(t: TestContext) {
  // Each scheduling checkpoint costs nine synthetic milliseconds: one complete unit per turn, no host-speed test.
  let clock = 0;
  const intervals: Timer[] = [], immediates: Timer[] = [];
  t.mock.method(performance, 'now', () => clock += 9);
  t.mock.method(globalThis, 'setInterval', (run: () => void) => {
    const timer = { run, active: true, unref() {} }; intervals.push(timer); return timer as unknown as NodeJS.Timeout;
  });
  t.mock.method(globalThis, 'clearInterval', (timer: Timer) => { timer.active = false; });
  t.mock.method(globalThis, 'setImmediate', (run: () => void) => {
    const timer = { run, active: true, unref() {} }; immediates.push(timer); return timer as unknown as NodeJS.Immediate;
  });
  t.mock.method(globalThis, 'clearImmediate', (timer: Timer) => { timer.active = false; });
  const next = () => {
    const timer = immediates.find(x => x.active);
    if (!timer) return false;
    timer.active = false; timer.run(); return true;
  };
  return { intervals, immediates, next, start() { intervals.at(-1)!.run(); },
    pending: () => immediates.filter(x => x.active).length,
    drain() { let n = 0; while (next()) assert.ok(++n < 100, 'finite scheduled pass'); } };
}

test('sliced object sweep matches synchronous durable state, log and events with no intervening edits', t => {
  const sync = fixture(t), sliced = fixture(t);
  for (const f of [sync, sliced]) { f.add('c', 3); f.add('a'); f.add('b', 2); }
  sync.runtime.objects.sweep(); drainSteps(sliced);
  assert.deepEqual(sliced.runtime.objects.all(), sync.runtime.objects.all());
  assert.deepEqual(logs(sliced), logs(sync));
  assert.deepEqual(sliced.events, sync.events);
  assert.deepEqual(sliced.runtime.streams.read(sliced.id('Alice'), 0), sync.runtime.streams.read(sync.id('Alice'), 0));
  assert.deepEqual(sliced.visits, ['a', 'b', 'c']);
  drainSteps(sliced);
  assert.deepEqual(logs(sliced), logs(sync), 'idempotent advances are not repeated');
});

test('sliced sweep holds only ordered ids and reads edited, deleted and replaced objects live', t => {
  const f = fixture(t); for (const id of ['d', 'b', 'c', 'a']) f.add(id);
  const g = f.runtime.objects.sweepSteps();
  assert.equal(g.next().done, false); assert.deepEqual(f.visits, [], 'enumeration does not read or advance bodies');
  g.next(); assert.deepEqual(f.visits, ['a']); assert.equal(f.db.db.isTransaction, false);
  const b = row(f, 'b'); b.state.target = 4;
  f.db.db.prepare('UPDATE edge_comms_objects SET body=? WHERE world_id=? AND id=?').run(JSON.stringify(b), f.host.worldId, 'b');
  f.runtime.objects.remove('c'); f.runtime.objects.remove('d'); f.add('d', 7); f.add('e', 9);
  f.host.engine.world.tick = 250;
  while (!g.next().done) assert.equal(f.db.db.isTransaction, false);
  assert.deepEqual(f.visits, ['a', 'b', 'd']);
  assert.equal(row(f, 'b').state.n, 4); assert.equal(row(f, 'b').state.tick, 250);
  assert.equal(row(f, 'd').state.n, 7); assert.equal(row(f, 'e').state.n, 0, 'new id waits for next pass');
  drainSteps(f); assert.equal(row(f, 'e').state.n, 9);
});

test('each sliced advance commits state/log/stream before notifications and rolls back a failed object', t => {
  const f = fixture(t); for (const id of ['a', 'b', 'c']) f.add(id);
  const observed: unknown[] = [];
  f.runtime.onSpectator(m => observed.push([m.object, f.db.db.isTransaction, row(f, String(m.object)).version,
    f.runtime.streams.head(f.id('Alice'))]));
  f.db.db.exec("CREATE TRIGGER reject_fixture_advance BEFORE INSERT ON edge_comms_object_log WHEN NEW.object_id='b' AND NEW.action='advance' BEGIN SELECT RAISE(ABORT,'fixture log failure'); END");
  const g = f.runtime.objects.sweepSteps(); g.next(); g.next();
  assert.deepEqual(observed, [['a', false, 2, 1]]);
  assert.throws(() => g.next(), /fixture log failure/);
  assert.equal(f.db.db.isTransaction, false); assert.equal(row(f, 'b').state.n, 0);
  assert.equal(row(f, 'b').version, 1); assert.equal(row(f, 'c').state.n, 0);
  assert.equal(f.runtime.streams.head(f.id('Alice')), 1); assert.equal(f.events.length, 1);
  f.db.db.exec('DROP TRIGGER reject_fixture_advance');
  drainSteps(f);
  assert.deepEqual(observed, [['a', false, 2, 1], ['b', false, 2, 2], ['c', false, 2, 3]]);
});

test('timer maintenance yields bounded units, coalesces overlapping periods and preserves phase order', t => {
  const s = scheduler(t), f = fixture(t, { sweepMs: 30_000, fading: true }), order: string[] = [];
  f.add('a'); f.add('b');
  t.mock.method(f.runtime.conversations, 'sweep', () => { order.push('conversations'); });
  t.mock.method(f.runtime.steward, 'schedule', () => { order.push('steward'); return null; });
  t.mock.method(f.runtime.fading, 'sweep', () => { order.push('fading'); });
  t.mock.method(f.runtime.fading, 'roster', () => { order.push('roster'); return []; });
  t.mock.method(f.runtime.streams, 'pruneAll', () => { order.push('prune'); });
  f.runtime.onSpectator(m => { if (m.kind === 'object') order.push(String(m.object)); });
  s.start(); assert.deepEqual(order, ['conversations']); assert.equal(s.pending(), 1);
  s.start(); assert.deepEqual(order, ['conversations']); assert.equal(s.pending(), 1);
  s.next(); assert.deepEqual(f.visits, [], 'id enumeration is its own atomic unit');
  s.next(); assert.deepEqual(f.visits, ['a']); assert.equal(f.db.db.isTransaction, false);
  s.start(); assert.deepEqual(f.visits, ['a']);
  s.next(); assert.deepEqual(f.visits, ['a', 'b']);
  s.drain(); assert.equal(s.pending(), 0);
  assert.deepEqual(order, ['conversations', 'a', 'b', 'steward', 'fading', 'roster', 'prune']);
});

test('explicit sweep cancels a queued pass and drains synchronously; stale callbacks cannot enter a newer pass', t => {
  const s = scheduler(t), f = fixture(t, { sweepMs: 30_000 }); f.add('a'); f.add('b');
  s.start(); const stale = s.immediates.at(-1)!;
  f.runtime.sweep();
  assert.deepEqual(f.visits, ['a', 'b']); assert.equal(s.pending(), 0);
  s.start(); assert.equal(s.pending(), 1); const before = [...f.visits];
  stale.run(); assert.deepEqual(f.visits, before); assert.equal(s.pending(), 1);
  s.drain(); assert.deepEqual(f.visits, ['a', 'b', 'a', 'b']);
  assert.equal(f.events.length, 2, 'the repeated pass does not repeat committed transitions');
});

test('close cancels queued maintenance and reentrant close stops after the committed object', t => {
  const s = scheduler(t), f = fixture(t, { sweepMs: 30_000 }); f.add('a'); f.add('b');
  f.runtime.onSpectator(() => f.runtime.close());
  s.start(); s.next(); const stale = s.immediates.at(-1)!;
  s.next(); assert.deepEqual(f.visits, ['a']); assert.equal(f.db.db.isTransaction, false);
  assert.equal(row(f, 'a').state.n, 1); assert.equal(row(f, 'b').state.n, 0); assert.equal(s.pending(), 0);
  stale.run(); s.start(); f.runtime.sweep(); s.drain();
  assert.deepEqual(f.visits, ['a']); assert.equal(s.intervals[0].active, false);
});

test('close before the first object cancels queued callbacks; explicit sweep from a notification supersedes its pass', t => {
  const s = scheduler(t), closed = fixture(t, { sweepMs: 30_000 }); closed.add('a');
  s.start(); const old = s.immediates.at(-1)!;
  closed.runtime.close(); assert.equal(s.pending(), 0);
  old.run(); assert.deepEqual(closed.visits, []);

  const f = fixture(t, { sweepMs: 30_000 }); f.add('a'); f.add('b');
  f.runtime.onSpectator(m => { if (m.object === 'a') f.runtime.sweep(); });
  s.start(); s.drain();
  assert.deepEqual(f.visits, ['a', 'a', 'b'], 'synchronous pass completes and the old pass never revisits b');
  assert.equal(f.events.length, 2); assert.equal(s.pending(), 0); assert.equal(f.db.db.isTransaction, false);
});

test('scheduled object failure rolls back, continues later maintenance phases and retries on a later period', t => {
  const s = scheduler(t), f = fixture(t, { sweepMs: 30_000 }); f.add('a'); f.add('b');
  let fail = true, pruned = 0;
  const advance = f.kind.advance!;
  f.kind.advance = (state, ctx) => { if (fail && state.name === 'a') throw Error('fixture kind failure'); return advance(state, ctx); };
  t.mock.method(f.runtime.streams, 'pruneAll', () => { pruned++; });
  s.start(); s.drain();
  assert.equal(row(f, 'a').state.n, 0); assert.equal(row(f, 'b').state.n, 0);
  assert.equal(f.db.db.isTransaction, false); assert.equal(pruned, 1); assert.equal(s.pending(), 0);
  fail = false; s.start(); s.drain();
  assert.deepEqual(f.visits, ['a', 'b']); assert.equal(pruned, 2); assert.equal(f.events.length, 2);
});
