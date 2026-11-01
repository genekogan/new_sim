// L8 item 4 (server reliability 2026-10-31): an advance step that changes nothing is no write. A step whose state stores
// the same (key order aside) and carries no events used to bump the version, rewrite the row and add an `advance` log row;
// on a restore or first boot that was ~1k rows for nothing. A step with events, or a changed state, still writes.
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Db } from './db.ts';
import { commsFixture } from './edge/comms/testing.ts';
import type { ObjectKind } from './edge/comms/objects/types.ts';
import { builtKindFor, type BuiltState } from './god/perceive.ts';

const state = (key: string): BuiltState => ({ key, what: 'test sign', text: 'hello', near: ['pond'], at: [1, 2], def: 'core/sign@1', state: { open: false, nested: { b: 1, a: [1, null] } }, front: null });
/** The same JSON value with every object's keys in reverse order. */
const reordered = (v: unknown): unknown => Array.isArray(v) ? v.map(reordered) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).reverse().map(k => [k, reordered((v as Record<string, unknown>)[k])])) : v;

function fixture(t: TestContext) {
  const db = new Db(':memory:'), f = commsFixture(['Alice'], {}, { dir: '', db, clock: { now: 1_800_000_000_000 } });
  t.after(() => { f.close(); db.close(); });
  const kind = builtKindFor(() => undefined, 'built-noop') as ObjectKind<BuiltState>;
  let step: (s: BuiltState) => ReturnType<NonNullable<ObjectKind<BuiltState>['advance']>> = () => null;
  kind.advance = (s) => step(s);
  f.runtime.objects.register(kind);
  f.runtime.objects.create({ id: 'a', kind: kind.kind, name: 'a', placeId: 'eden-commons', params: state('a') });
  const logs = () => (f.db.db.prepare("SELECT COUNT(*) AS n FROM edge_comms_object_log WHERE action='advance'").get() as { n: number }).n;
  const version = () => f.runtime.objects.all().find(o => o.id === 'a')!.version;
  return { f, set: (s: typeof step) => { step = s; }, logs, version, objects: f.runtime.objects };
}

test('an advance that returns the same state (any key order) and no events writes nothing', t => {
  const x = fixture(t), v0 = x.version();
  x.set(s => ({ state: reordered(structuredClone(s)) as BuiltState }));
  for (let i = 0; i < 3; i++) { x.objects.fresh(); x.objects.sweep(); x.objects.refresh(['a']); }
  assert.equal(x.version(), v0, 'no version bump');
  assert.equal(x.logs(), 0, 'no advance log rows');
});

test('an advance with events, or with a changed state, still writes', t => {
  const x = fixture(t), v0 = x.version();
  x.set(s => ({ state: s, events: [{ type: 'ping', text: 'tick' }] as never }));
  x.objects.refresh(['a']);
  assert.equal(x.version(), v0 + 1); assert.equal(x.logs(), 1);
  x.set(s => ({ state: { ...s, text: 'changed' } }));
  x.objects.refresh(['a']);
  assert.equal(x.version(), v0 + 2); assert.equal(x.logs(), 2);
  assert.equal((x.objects.all()[0].state as BuiltState).text, 'changed');
  // and the next unchanged step is a no-op again
  x.set(s => ({ state: reordered(structuredClone(s)) as BuiltState }));
  x.objects.refresh(['a']);
  assert.equal(x.version(), v0 + 2); assert.equal(x.logs(), 2);
});

test('the built kind itself does not step on a reordered but equal wanted state', t => {
  const db = new Db(':memory:'), f = commsFixture(['Alice'], {}, { dir: '', db, clock: { now: 1_800_000_000_000 } });
  t.after(() => { f.close(); db.close(); });
  const desired = new Map<string, BuiltState>();
  const kind = builtKindFor(key => desired.get(key), 'built-eq') as ObjectKind<BuiltState>;
  f.runtime.objects.register(kind);
  f.runtime.objects.create({ id: 'a', kind: kind.kind, name: 'a', placeId: 'eden-commons', params: state('a') });
  const stored = f.runtime.objects.all()[0].state as BuiltState;
  desired.set('a', reordered(structuredClone(stored)) as BuiltState);
  assert.equal(kind.advance!(structuredClone(stored), {} as never), null);
});
