import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Db } from './db.ts';
import { commsFixture } from './edge/comms/testing.ts';
import { Objects, readOnlyObjectAdvance } from './edge/comms/objects/framework.ts';
import type { ObjectKind, ObjectRecord } from './edge/comms/objects/types.ts';
import { builtKindFor, type BuiltState } from './god/perceive.ts';

const state = (key: string, text = 'initial'): BuiltState => ({ key, what: 'test sign', text, near: ['pond'], at: [-0, 2.25], def: 'core/sign@1', state: { open: false, nested: { values: [1, null, 'text'] } }, front: [0, 1] });
function fixture(t: TestContext, legacy = false) {
  const db = new Db(':memory:'), f = commsFixture(['Alice'], {}, { dir: '', db, clock: { now: 1_800_000_000_000 } });
  t.after(() => { f.close(); db.close(); });
  const desired = new Map<string, BuiltState>(), calls: string[] = [], events: unknown[] = [];
  const hooks: { want?: (key: string) => void } = {};
  const kind = builtKindFor(key => { calls.push(key); hooks.want?.(key); return desired.get(key); }, 'built-test') as ObjectKind<BuiltState>;
  if (legacy) {
    // Independent old ownership behavior: this unmarked wrapper forces the original defensive-clone path.
    const original = kind.advance!;
    kind.advance = function (s, ctx) { return original.call(this, s, ctx); };
  }
  f.runtime.objects.register(kind); f.runtime.onSpectator(e => events.push(e));
  const add = (id: string) => f.runtime.objects.create({ id, kind: kind.kind, name: id, placeId: 'eden-commons', params: state(id) });
  const soul = { soulId: f.id('Alice'), entityId: `h_${f.id('Alice')}`, name: 'Alice', owner: 'dev:Alice' };
  return { ...f, desired, calls, events, hooks, kind, add, soul, objects: f.runtime.objects };
}
type Fixture = ReturnType<typeof fixture>;
function persisted(f: Fixture) {
  return {
    objects: f.objects.all(),
    logs: f.db.db.prepare('SELECT * FROM edge_comms_object_log ORDER BY object_id,version').all(),
    stream: f.runtime.streams.read(f.id('Alice'), 0), events: f.events,
  };
}
function rewrite(f: Fixture, id: string, mutate: (row: ObjectRecord) => void) {
  const row = structuredClone(f.objects.all().find(o => o.id === id)!); mutate(row);   // L8: records are frozen; copy first
  f.db.db.prepare('UPDATE edge_comms_objects SET body=?,version=? WHERE world_id=? AND id=?').run(JSON.stringify(row), row.version, f.host.worldId, id);
  f.objects.reload();   // L8: SQL that bypasses the framework must tell the in-memory table
}

test('built refresh matches a clone-path oracle for nested JSON, desired replacements and direct row edits', t => {
  const fast = fixture(t), old = fixture(t, true);
  for (const f of [fast, old]) { f.add('a'); f.add('b'); }
  for (let i = 0; i < 12; i++) {
    for (const f of [fast, old]) {
      const desired = state('a', i % 3 ? `updated-${i}` : 'initial');
      desired.removed = i % 4 === 0;
      desired.near = ['pond', `place-${i}`];
      desired.state = { open: !!(i % 2), nested: { values: [i, null, 'é', { ['__proto__']: 'data' }] }, alias: desired.at };
      f.desired.set('a', desired);
      if (i === 3) rewrite(f, 'b', row => { (row.state as BuiltState).text = 'direct SQL edit'; row.version += 3; });
      if (i === 7) f.desired.delete('a');
    }
    // L8: built advances are refresh-only: listings skip them (no want() call), the sweep applies them
    const calls = fast.calls.length; fast.objects.fresh(); assert.equal(fast.calls.length, calls, 'fresh() skips a refresh-only advance');
    const a = fast.objects.sweep(), b = old.objects.fresh();
    assert.deepEqual(a, b); assert.deepEqual(persisted(fast), persisted(old)); assert.deepEqual(fast.calls, old.calls);
    // Shared reads are frozen: a caller cannot change storage through them.
    assert.throws(() => (fast.objects.all().find(x => x.id === 'b')!.state as BuiltState).near.push('local mutation'), TypeError);
    assert.deepEqual(persisted(fast), persisted(old));
    assert.ok(!(fast.objects.all().find(x => x.id === 'b')!.state as BuiltState).near.includes('local mutation'));
  }
});

test('a transition retains the original desired-state alias but storage remains detached', t => {
  for (const legacy of [false, true]) {
    const f = fixture(t, legacy); f.add('a');
    const desired = state('a', 'changed'); f.desired.set('a', desired);
    const out = (legacy ? f.objects.fresh() : f.objects.sweep())[0]; assert.equal(out.state, desired);
    desired.near.push('later alias mutation');
    assert.ok(!(f.objects.all()[0].state as BuiltState).near.includes('later alias mutation'));
    assert.deepEqual((legacy ? f.objects.fresh() : f.objects.sweep())[0].state, desired, 'next pass sees changed desired JSON');
  }
});

test('a mutating advance returning null is isolated, including a replacement after registration', t => {
  const f = fixture(t); f.add('a'); const before = persisted(f);
  const replacement: NonNullable<ObjectKind<BuiltState>['advance']> = function (this: ObjectKind<BuiltState>, s) {
    assert.equal(this, f.kind); s.near.push('should stay detached'); s.text = 'changed'; return null;
  };
  f.objects.kindOf(f.kind.kind)!.advance = replacement;
  assert.deepEqual(f.objects.fresh(), before.objects);
  assert.deepEqual(persisted(f), before);
});

test('invalid non-null advance callbacks retain optional-call errors and argument evaluation', t => {
  const f = fixture(t); f.add('a'); const trace: string[] = [];
  t.mock.method(f.runtime.core, 'tick', () => { trace.push('tick'); return 100; });
  t.mock.method(f.runtime.core, 'now', () => { trace.push('now'); return f.clock.now; });
  for (const value of [false, 0, '', {}, null, undefined]) {
    f.kind.advance = value as unknown as ObjectKind<BuiltState>['advance']; trace.length = 0;
    if (value == null) { assert.equal(f.objects.fresh().length, 1); assert.deepEqual(trace, []); }
    else { assert.throws(() => f.objects.fresh(), TypeError); assert.deepEqual(trace, ['tick', 'now']); }
  }
});

for (const prototype of [false, true]) test(`overridden ${prototype ? 'prototype' : 'instance'} all() retains clone isolation for shared records`, t => {
  for (const legacy of [false, true]) {
    const f = fixture(t, legacy); f.add('a');
    // an override hands out its own mutable records (the framework's are frozen)
    const shared = structuredClone(f.objects.all()), original = structuredClone(shared[0].state) as BuiltState;
    f.desired.set('a', original); let reads = 0;
    const override = function () { reads++; return shared; };
    const mock = t.mock.method(prototype ? Objects.prototype : f.objects, 'all', override);
    f.hooks.want = () => { (shared[0].state as BuiltState).text = 'external alias changed during want'; };
    const result = f.objects.fresh();
    assert.equal(reads, 1); assert.equal(result[0].version, 1);
    // L8: a listing skips the refresh-only built advance (want is never asked); the legacy unmarked one still runs
    assert.equal((result[0].state as BuiltState).text, legacy ? 'external alias changed during want' : 'initial');
    mock.mock.restore();
    assert.equal((f.objects.all()[0].state as BuiltState).text, 'initial');
    assert.equal(f.objects.all()[0].version, 1, 'no spurious transition from comparing a mutable external alias');
  }
});

test('reentrant reads/writes and the first transition preserve subsequent live rereads and logs', t => {
  const fast = fixture(t), old = fixture(t, true), returned: unknown[] = [];
  for (const f of [fast, old]) {
    f.add('a'); f.add('b'); f.desired.set('a', state('a', 'new a')); f.desired.set('b', state('b', 'new b'));
    let once = false;
    f.hooks.want = key => {
      if (key !== 'a' || once) return; once = true;
      rewrite(f, 'b', row => { row.version += 7; (row.state as BuiltState).text = 'intervening write'; });
      f.add('c');
      assert.equal(f.objects.all().find(o => o.id === 'b')!.version, 8);
      f.objects.get('b', f.soul);
    };
    returned.push(f === fast ? f.objects.sweep() : f.objects.fresh());
    assert.equal(f.objects.all().find(o => o.id === 'b')!.version, 9);
    assert.ok(!(returned.at(-1) as ObjectRecord[]).some(o => o.id === 'c'), 'initial ordered listing owns this pass');
  }
  assert.deepEqual(returned[0], returned[1]); assert.deepEqual(persisted(fast), persisted(old)); assert.deepEqual(fast.calls, old.calls);
});

test('captured advance preserves receiver and argument evaluation across timeCtx reentrancy', t => {
  const f = fixture(t); f.add('a'); const trace: string[] = [];
  const advance = readOnlyObjectAdvance(function (this: ObjectKind<BuiltState>, s: BuiltState) {
    assert.equal(this, f.kind); assert.equal(s.text, 'initial'); trace.push('original'); return null;
  });
  f.kind.advance = advance;
  const replacement = function (s: BuiltState) { trace.push('replacement'); s.text = 'mutated clone'; return null; };
  t.mock.method(f.runtime.core, 'tick', () => { trace.push('tick'); f.kind.advance = replacement; return 100; });
  t.mock.method(f.runtime.core, 'now', () => { trace.push('now'); return f.clock.now; });
  assert.equal((f.objects.fresh()[0].state as BuiltState).text, 'initial');
  assert.deepEqual(trace, ['tick', 'now', 'original']);
  trace.length = 0;
  assert.equal((f.objects.fresh()[0].state as BuiltState).text, 'initial');
  assert.deepEqual(trace, ['tick', 'now', 'replacement']);
  t.mock.method(f.runtime.core, 'now', () => { throw Error('clock fixture'); });
  assert.throws(() => f.objects.fresh(), /clock fixture/);
  assert.equal((f.objects.all()[0].state as BuiltState).text, 'initial');
});

test('after the first write and in get(), advance still receives detached state', t => {
  const f = fixture(t); f.add('a'); f.add('b'); f.desired.set('a', state('a', 'changed'));
  const seen: unknown[] = [];
  const realClone = structuredClone;
  t.mock.method(globalThis, 'structuredClone', (value: unknown) => { seen.push(value); return realClone(value); });
  f.objects.sweep();
  assert.ok(seen.some(s => (s as BuiltState)?.key === 'b'), 'post-firstwrite uses the existing advanced path');
  seen.length = 0; f.objects.get('a', f.soul);
  assert.ok(seen.some(s => (s as BuiltState)?.key === 'a'), 'direct get retains defensive clone');
});
