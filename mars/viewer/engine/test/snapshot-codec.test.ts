import test from 'node:test';
import assert from 'node:assert/strict';
import { CodecError, captureGraph, decode, encode, finishGraph, prepareImmutableSnapshotData, type GraphCapture } from '../runtime/codec.ts';
import { decodeSnapshot, SNAPSHOT_FORMAT, type RuntimeSnapshot } from '../runtime/snapshot.ts';
import { hashOf } from '../core/hash.ts';
import { Runtime } from '../runtime/runtime.ts';
import { emptyWorld, human } from '../world/factory.ts';
import { provingGround } from '../scenes/proving-ground.ts';

// Frozen pre-optimization writer (22303887), restricted to the supported inert
// graphs below. This pins persisted marker/ID order independently of the new
// captured traversal. Unsupported-input validation is tested separately.
function legacyEncode(root: unknown): unknown {
  const seen = new Map<object, number>();
  const children = (v: object): unknown[] => {
    if (Array.isArray(v)) return [...v];
    if (v instanceof Set) return [...v];
    if (v instanceof Map) return [...v].flatMap(([key, value]) => [key, value]);
    return Object.values(v);
  };
  const visit = (v: unknown): void => {
    if (typeof v !== 'object' || v === null) return;
    const count = seen.get(v) ?? 0; seen.set(v, count + 1);
    if (!count) for (const child of children(v)) visit(child);
  };
  visit(root);
  const ids = new Map<object, number>(); let next = 0;
  const emit = (v: unknown): unknown => {
    if (v === undefined) return { '~u': 1 };
    if (typeof v === 'number') {
      if (Number.isNaN(v)) return { '~n': 'NaN' };
      if (v === Infinity) return { '~n': 'Infinity' };
      if (v === -Infinity) return { '~n': '-Infinity' };
      if (Object.is(v, -0)) return { '~n': '-0' };
      return v;
    }
    if (typeof v !== 'object' || v === null) return v;
    if (ids.has(v)) return { '~r': ids.get(v) };
    const shared = seen.get(v)! > 1; let id = -1;
    if (shared) ids.set(v, id = next++);
    let body: unknown;
    if (Array.isArray(v)) body = v.map(emit);
    else if (v instanceof Set) body = { '~set': [...v].map(emit) };
    else if (v instanceof Map) body = { '~map': [...v].map(([key, value]) => [emit(key), emit(value)]) };
    else {
      const out: Record<string, unknown> = {}; let tilde = false;
      for (const [key, value] of Object.entries(v)) { tilde ||= key.startsWith('~'); out[key] = emit(value); }
      body = tilde ? { '~o': Object.entries(out) } : out;
    }
    return shared ? { '~id': id, '~v': body } : body;
  };
  return emit(root);
}

/** Compare source semantics, not just encode/decode agreement: aliases must form
 * a bijection, distinct source objects cannot be merged, and special numbers
 * retain Object.is semantics. Prototype/descriptor metadata is not persisted. */
function sameGraph(source: unknown, restored: unknown): void {
  const forward = new Map<object, object>(), reverse = new Map<object, object>();
  const compare = (a: unknown, b: unknown): void => {
    if (a === null || typeof a !== 'object') { assert.ok(Object.is(a, b), `primitive differs: ${String(a)}`); return; }
    assert.ok(b !== null && typeof b === 'object'); assert.notEqual(a, b);
    if (forward.has(a)) { assert.equal(forward.get(a), b); return; }
    assert.equal(reverse.has(b), false, 'distinct source objects were merged');
    forward.set(a, b); reverse.set(b, a);
    if (Array.isArray(a)) {
      assert.ok(Array.isArray(b)); assert.equal(b.length, a.length);
      for (let i = 0; i < a.length; i++) { assert.ok(Object.hasOwn(b, i)); compare(a[i], b[i]); }
    } else if (a instanceof Map) {
      assert.ok(b instanceof Map); assert.equal(b.size, a.size);
      const left = [...Map.prototype.entries.call(a)], right = [...b];
      for (let i = 0; i < left.length; i++) { compare(left[i][0], right[i][0]); compare(left[i][1], right[i][1]); }
    } else if (a instanceof Set) {
      assert.ok(b instanceof Set); assert.equal(b.size, a.size);
      const left = [...Set.prototype.values.call(a)], right = [...b];
      for (let i = 0; i < left.length; i++) compare(left[i], right[i]);
    } else {
      assert.equal(Object.getPrototypeOf(b), Object.prototype);
      assert.deepEqual(Object.keys(b), Object.keys(a));
      for (const key of Object.keys(a)) {
        assert.ok(Object.hasOwn(b, key));
        compare((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]);
      }
    }
  };
  compare(source, restored);
}

function assertJsonTree(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { assert.ok(Number.isFinite(value)); assert.ok(!Object.is(value, -0)); return; }
  assert.ok(typeof value === 'object' && value !== null);
  assert.equal(seen.has(value), false, 'encoded output must be a tree, not an aliased/cyclic graph'); seen.add(value);
  assert.equal(Object.getOwnPropertySymbols(value).length, 0);
  if (Array.isArray(value)) {
    assert.equal(Object.getPrototypeOf(value), Array.prototype);
    assert.equal(Object.keys(value).length, value.length);
    for (let i = 0; i < value.length; i++) { assert.ok(Object.hasOwn(value, i)); assertJsonTree(value[i], seen); }
  } else {
    assert.equal(Object.getPrototypeOf(value), Object.prototype);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      assert.ok('value' in descriptor); assert.ok(descriptor.enumerable); assertJsonTree(descriptor.value, seen);
    }
  }
}

test('legacy golden bytes retain marker and reference ordering and decode older cyclic blobs', () => {
  const shared = { status: 'walking' };
  const source = { world: { tick: 7 }, records: [shared], live: new Map([['a', shared]]),
    special: [undefined, NaN, Infinity, -Infinity, -0], tags: { '~r': 'literal' } };
  const golden = '{"world":{"tick":7},"records":[{"~id":0,"~v":{"status":"walking"}}],"live":{"~map":[["a",{"~r":0}]]},"special":[{"~u":1},{"~n":"NaN"},{"~n":"Infinity"},{"~n":"-Infinity"},{"~n":"-0"}],"tags":{"~o":[["~r","literal"]]}}';
  assert.equal(JSON.stringify(encode(source)), golden);
  sameGraph(source, decode(JSON.parse(golden)));
  const legacy = '{"~id":0,"~v":{"self":{"~r":0},"list":{"~id":1,"~v":[{"~r":0}]},"again":{"~r":1}}}';
  const restored = decode(JSON.parse(legacy)) as { self: unknown; list: unknown[]; again: unknown };
  assert.equal(restored.self, restored); assert.equal(restored.list[0], restored); assert.equal(restored.again, restored.list);
  assert.equal(JSON.stringify(encode(restored)), legacy);
});

function generatedGraph(seed: number): unknown {
  let state = seed >>> 0;
  const next = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
  const nodes: object[] = Array.from({ length: 20 }, (_, i) => i % 4 === 0 ? {} : i % 4 === 1 ? [] : i % 4 === 2 ? new Map() : new Set());
  const atoms = [undefined, null, false, true, 0, -0, NaN, Infinity, -Infinity, 1.2e-20, '🌱', '\ud800', '\udc00', ''];
  const value = () => next() % 2 ? nodes[next() % nodes.length] : atoms[next() % atoms.length];
  for (const [i, node] of nodes.entries()) {
    if (Array.isArray(node)) { for (let j = 0; j < 4; j++) node.push(value()); }
    else if (node instanceof Map) { for (let j = 0; j < 4; j++) node.set(value(), value()); }
    else if (node instanceof Set) { for (let j = 0; j < 4; j++) node.add(value()); }
    else {
      Object.assign(node, { '2': value(), '1': value(), ordinary: value(), ['~tag' + i]: value() });
    }
  }
  return { nodes, first: nodes[0], again: nodes[0], twins: [{ identical: true }, { identical: true }] };
}

test('deterministic graph corpus preserves legacy bytes, source values and alias identities through JSON', () => {
  const sources = [undefined, null, -0, NaN, Infinity, -Infinity, Object.assign(Object.create(null), { value: undefined }),
    ...Array.from({ length: 80 }, (_, i) => generatedGraph(i + 1))];
  for (const source of sources) {
    const encoded = encode(source); assertJsonTree(encoded);
    const text = JSON.stringify(encoded);
    assert.equal(text, JSON.stringify(legacyEncode(source)));
    const restored = decode(JSON.parse(text)); sameGraph(source, restored);
    assert.equal(JSON.stringify(encode(restored)), text);
  }
});

test('own __proto__, constructor and escaped marker keys survive without changing prototypes', () => {
  for (const escaped of [false, true]) {
    const source = JSON.parse('{"__proto__":{"safe":true},"constructor":{"name":"data"},"prototype":"data"}');
    if (escaped) source['~id'] = source.__proto__;
    const encoded = encode(source); assertJsonTree(encoded);
    const restored = decode(JSON.parse(JSON.stringify(encoded))) as Record<string, unknown>;
    sameGraph(source, restored);
    assert.equal(Object.getPrototypeOf(restored), Object.prototype);
    assert.ok(Object.hasOwn(restored, '__proto__'));
    assert.equal(Object.hasOwn(Object.prototype, 'safe'), false);
  }
});

test('source and restored mutations cannot change an owned encoded checkpoint', () => {
  const shared = { values: [1, undefined, -0] }, source = { a: shared, b: shared, map: new Map([['value', shared]]) };
  const encoded = encode(source), bytes = JSON.stringify(encoded);
  const restored = decode(JSON.parse(bytes)) as typeof source;
  sameGraph(source, restored);
  source.a.values.push(9); source.map.clear();
  restored.a.values.push(10); restored.map.set('extra', { values: [20] });
  assert.equal(JSON.stringify(encoded), bytes);
  assert.equal(source.a.values.includes(10), false);
});

test('split capture owns every child before deferred finish and each finish owns its output', () => {
  const shared = { values: [1, undefined, -0] };
  const source = { first: shared, again: shared, map: new Map<unknown, unknown>([[shared, shared]]), set: new Set([shared]) };
  const expected = JSON.stringify(legacyEncode(source)), capture = captureGraph(source);
  let calls = 0;
  shared.values.length = 0;
  Object.defineProperty(source, 'first', { enumerable: true, get: () => { calls++; throw new Error('live read'); } });
  source.map.clear(); source.set.clear();
  const finished = finishGraph(capture);
  assert.equal(JSON.stringify(finished), expected); assert.equal(calls, 0);
  (finished as Record<string, unknown>).first = null;
  assert.equal(JSON.stringify(finishGraph(capture)), expected, 'finishing twice cannot reuse a mutable output tree');
  assert.ok(Object.isFrozen(capture));
  assert.deepEqual(Object.keys(capture), ['nodes', 'cachedNodes'], 'the capture handle exposes no source or captured arrays');
  assert.throws(() => finishGraph({ nodes: 0, cachedNodes: 0 } as GraphCapture), /not a captured snapshot graph/);
});

test('split capture and finish retain the independent legacy bytes across the graph corpus', () => {
  for (const source of [undefined, -0, NaN, ...Array.from({ length: 80 }, (_, i) => generatedGraph(i + 1))])
    assert.equal(JSON.stringify(finishGraph(captureGraph(source))), JSON.stringify(legacyEncode(source)));
});

test('admitted immutable shapes retain global aliases and fresh reference IDs at every boundary', () => {
  const leaf = { number: -0, values: [undefined, Infinity, '🌱'] };
  const physics: { leaf: typeof leaf; literal: Record<string, unknown>; self?: unknown } = { leaf, literal: { '~id': 'literal' } };
  physics.self = physics;
  assert.equal(prepareImmutableSnapshotData(physics), true);
  assert.ok(Object.isFrozen(physics)); assert.ok(Object.isFrozen(leaf)); assert.ok(Object.isFrozen(leaf.values));
  assert.equal(captureGraph(physics).cachedNodes, captureGraph(physics).nodes);
  for (const source of [physics, { physics, leaf }, { leaf, physics },
    { map: new Map<unknown, unknown>([[leaf, physics]]), physics, set: new Set([leaf]) }]) {
    const expected = JSON.stringify(legacyEncode(source));
    for (let i = 0; i < 2; i++) {
      const capture = captureGraph(source), output = finishGraph(capture);
      assert.ok(capture.cachedNodes > 0); assert.equal(JSON.stringify(output), expected);
      sameGraph(source, decode(JSON.parse(expected)));
      if (typeof output === 'object' && output) Object.assign(output, { changed: true });
      assert.equal(JSON.stringify(finishGraph(capture)), expected);
    }
  }
  assert.throws(() => { leaf.values.push('mutation'); }, TypeError);
});

test('immutable admission validates without getters and falls back without partially freezing collections', () => {
  let calls = 0;
  const child = { untouched: [] }, bad = Object.defineProperty({}, 'value', { enumerable: true, get: () => { calls++; return 1; } });
  for (const unsupported of [bad, new Map([['x', 1]]), new Set([1]), [1, , 3], () => 1]) {
    const root = { child, unsupported };
    assert.equal(prepareImmutableSnapshotData(root), false);
    assert.equal(Object.isFrozen(root), false); assert.equal(Object.isFrozen(child), false);
    assert.equal(captureGraph(child).cachedNodes, 0);
  }
  assert.equal(calls, 0);
  const mutable = { child, map: new Map([['x', 1]]), set: new Set([1]) };
  const before = JSON.stringify(encode(mutable));
  assert.equal(prepareImmutableSnapshotData(mutable), false);
  mutable.map.set('y', 2); mutable.set.add(2);
  assert.notEqual(JSON.stringify(encode(mutable)), before);
  assert.equal(JSON.stringify(encode(mutable)), JSON.stringify(legacyEncode(mutable)));
});

test('physics lookalikes and shallow frozen roots never acquire trusted cached shapes', () => {
  const child = { x: 1 }, lookalike = Object.freeze({ version: 'entity-physics/1', hash: 'a'.repeat(64), byEntity: { child } });
  const first = captureGraph(lookalike); assert.equal(first.cachedNodes, 0);
  child.x = 2;
  assert.equal((decode(finishGraph(first)) as typeof lookalike).byEntity.child.x, 1);
  const next = captureGraph(lookalike); assert.equal(next.cachedNodes, 0);
  assert.equal((decode(finishGraph(next)) as typeof lookalike).byEntity.child.x, 2);
  Object.defineProperty(child, 'bad', { enumerable: true, get: () => { throw new Error('must not run'); } });
  assert.throws(() => captureGraph(lookalike), error => error instanceof CodecError && error.path === '$.byEntity.child.bad');
});

test('immutable admission keeps literal proto/marker data and validates new siblings beside cached subtrees', () => {
  const source = JSON.parse('{"__proto__":{"safe":true},"~r":"literal","nested":[1,2]}');
  const before = JSON.stringify(encode(source));
  assert.equal(prepareImmutableSnapshotData(source), true);
  assert.equal(JSON.stringify(encode(source)), before);
  assert.ok(Object.hasOwn(decode(encode(source)) as object, '__proto__'));
  let calls = 0;
  const bad = Object.defineProperty({}, 'later', { enumerable: true, get: () => { calls++; return 1; } });
  const next = { old: source, bad };
  assert.equal(prepareImmutableSnapshotData(next), false);
  assert.equal(Object.isFrozen(next), false); assert.equal(Object.isFrozen(bad), false); assert.equal(calls, 0);
  assert.throws(() => encode(next), error => error instanceof CodecError && error.path === '$.bad.later');
  const valid = { old: source, alias: source.nested, fresh: [3] };
  assert.equal(prepareImmutableSnapshotData(valid), true);
  const out = decode(encode(valid)) as typeof valid;
  assert.strictEqual(out.alias, out.old.nested);
  assert.equal(captureGraph(valid).cachedNodes, captureGraph(valid).nodes);
});

test('accessors, unsupported values and extra collection data fail with paths without executing getters', () => {
  let calls = 0;
  const getter = () => { calls++; throw new Error('getter must not execute'); };
  const accessor = Object.defineProperty({}, 'nested', { enumerable: true, get: getter });
  const arrayAccessor = Object.defineProperty([1], '0', { enumerable: true, get: getter });
  const fn = Object.defineProperty(() => {}, 'name', { get: getter });
  class Unsupported {}
  Object.defineProperty(Unsupported.prototype, 'constructor', { get: getter });
  const extraMap = Object.defineProperty(new Map(), 'extra', { enumerable: true, get: getter });
  const extraSet = Object.assign(new Set(), { extra: 1 });
  const symbolObject = { [Symbol('hidden data')]: 1 };
  const symbolArray = Object.assign([], { [Symbol('hidden data')]: 1 });
  const cases: [unknown, string][] = [[{ accessor }, '$.accessor.nested'], [arrayAccessor, '$.0'],
    [fn, '$'], [new Unsupported(), '$'], [new Date(0), '$'], [new Uint8Array(1), '$'],
    [1n, '$'], [Symbol('value'), '$'], [[1, , 3], '$.1'], [Object.assign([1], { extra: 2 }), '$.extra'],
    [extraMap, '$.extra'], [extraSet, '$.extra'], [symbolObject, '$'], [symbolArray, '$']];
  for (const [value, path] of cases) assert.throws(() => encode(value), error => error instanceof CodecError && error.path === path);
  assert.equal(calls, 0);
});

test('native collection iteration and key paths bypass executable user hooks', () => {
  let calls = 0;
  class NativeMap extends Map { *[Symbol.iterator](): MapIterator<[unknown, unknown]> { calls++; throw new Error('iterator'); } }
  class NativeSet extends Set { *[Symbol.iterator](): SetIterator<unknown> { calls++; throw new Error('iterator'); } }
  const key = Object.create(null);
  Object.defineProperty(key, 'toString', { get: () => { calls++; throw new Error('key conversion'); } });
  const map = new NativeMap(); map.set(key, key);
  const set = new NativeSet(); set.add(key);
  const source = { key, map, set };
  sameGraph(source, decode(JSON.parse(JSON.stringify(encode(source)))));
  const badKey = Object.defineProperty({}, 'bad', { enumerable: true, get: () => { calls++; throw new Error('getter'); } });
  assert.throws(() => encode(new Map([[badKey, 1]])), error => error instanceof CodecError && error.path === '$.<map key 0>.bad');
  assert.equal(calls, 0);
});

test('lazy diagnostic paths retain nested collection positions, literal keys and custom roots', () => {
  const bad = () => 1;
  const cases: [unknown, string][] = [
    [{ nested: [new Map([[new Set([{ deep: bad }]), 0]])] }, '$.nested.0.<map key 0>.<set 0>.deep'],
    [{ map: new Map([['key', new Set([[0, { bad: 1n }]])]]) }, '$.map.<map value 0>.<set 0>.1.bad'],
    [{ map: new Map([['key', [0, , 2]]]) }, '$.map.<map value 0>.1'],
    [{ 'key.with.dots': { '': [Symbol('bad')] } }, '$.key.with.dots..0'],
  ];
  for (const [value, expected] of cases) {
    for (const root of ['$', 'action a (walk_to) exec']) {
      const path = root + expected.slice(1);
      assert.throws(() => encode(value, root), error => error instanceof CodecError && error.path === path && error.message.startsWith(`${path} is `));
    }
  }
  const shared = { clean: new Map([['values', new Set([1, undefined, -0])]]) };
  const siblings = { first: shared, again: shared, last: { invalid: bad } };
  assert.throws(() => encode(siblings), error => error instanceof CodecError && error.path === '$.last.invalid',
    'a completed branch or alias must leave no stale path segments');
  assert.equal(JSON.stringify(encode({ valid: [1, undefined, -0] })), JSON.stringify(legacyEncode({ valid: [1, undefined, -0] })),
    'a failed capture must not leak path or traversal state into a later call');
});

test('descriptor refusal still precedes traversal of captured children', () => {
  let calls = 0;
  const getter = () => { calls++; return 0; };
  const object = Object.defineProperty({ first: () => 1 }, 'later', { enumerable: true, get: getter });
  const array = Object.defineProperty([() => 1, 0], '1', { enumerable: true, get: getter });
  for (const [value, path] of [[{ object }, '$.object.later'], [{ array }, '$.array.1']] as const)
    assert.throws(() => encode(value), error => error instanceof CodecError && error.path === path && error.message.includes('an accessor property'));
  assert.equal(calls, 0);
  const dropped = { invalid: () => 1 };
  const map = new Map<unknown, unknown>([['discarded', dropped], ['retained', new Set([1n])]]);
  assert.throws(() => encode({ map }, '$', new Set([dropped])), error => error instanceof CodecError && error.path === '$.map.<map value 0>.<set 0>',
    'Map diagnostic positions continue to count only retained entries');
});

test('dropped Map values remove the whole entry before validation and preserve retained key/value aliases', () => {
  let calls = 0;
  const dropped = { closure: () => 1 }, badKey = Object.defineProperty({}, 'bad', { enumerable: true, get: () => { calls++; return 1; } });
  const shared = { retained: true }, source = new Map<unknown, unknown>([[badKey, dropped], [shared, shared]]);
  const result = decode(JSON.parse(JSON.stringify(encode(source, '$', new Set([dropped]))))) as Map<unknown, unknown>;
  assert.equal(calls, 0); assert.equal(result.size, 1);
  const [[key, value]] = result; assert.equal(key, value); assert.deepEqual(value, shared); assert.notEqual(value, shared);
  // Being a dropped *value* elsewhere does not exempt a retained key from validation.
  assert.throws(() => encode(new Map([[dropped, shared]]), '$', new Set([dropped])), error => error instanceof CodecError);
});

test('discarded Map keys shared cyclically elsewhere retain exactly the filtered graph identities', () => {
  for (const mapFirst of [false, true]) {
    const key: { name: string; self?: unknown } = { name: 'shared discarded key' }; key.self = key;
    const dropped = { closure: () => 1 }, retained = { key };
    const entries: [unknown, unknown][] = [[key, dropped], ['retained', retained]];
    const map = new Map(entries), filteredMap = new Map(entries.filter(([, value]) => value !== dropped));
    const source = mapFirst ? { map, key, again: key } : { key, again: key, map };
    const reference = mapFirst ? { map: filteredMap, key, again: key } : { key, again: key, map: filteredMap };
    const encoded = encode(source, '$', new Set([dropped]));
    assertJsonTree(encoded);
    sameGraph(reference, decode(JSON.parse(JSON.stringify(encoded))));
    assert.equal(JSON.stringify(encoded), JSON.stringify(legacyEncode(reference)),
      'discarded keys must not consume reference IDs or leave phantom references');
  }
});

test('removing the capture self-check retains restore-time world checksum rejection', () => {
  const world = { tick: 12, entities: {}, regions: {} };
  const snapshot = { format: SNAPSHOT_FORMAT, tick: 12, stateHash: hashOf(world), data: encode({ world,
    records: [], live: [], dropped: [], owners: [], services: {} }), nextId: 1, eventCursor: 0, violations: [], dropped: [] } as RuntimeSnapshot;
  assert.deepEqual(decodeSnapshot(snapshot).world, world);
  const altered = JSON.parse(JSON.stringify(snapshot)); altered.data.world.tick++;
  assert.throws(() => decodeSnapshot(altered), error => error instanceof Error && 'code' in error && error.code === 'snapshot.corrupt');
});

test('a valid legacy-written runtime checkpoint restores native state and service aliases and continues identically', () => {
  const world = emptyWorld('proving-ground', provingGround()); world.entities.a = human('a', 0, 0);
  const shared = { held: new Set(['a']), values: [undefined, -0, Infinity] };
  const graph = { world, records: [], live: [], dropped: [], owners: [], services: { first: shared, second: shared } };
  const old: RuntimeSnapshot = { format: SNAPSHOT_FORMAT, tick: world.tick, stateHash: hashOf(world),
    data: legacyEncode(graph), nextId: 1, eventCursor: 0, violations: [], dropped: [] };
  const restored = Runtime.restore(JSON.parse(JSON.stringify(old)), new Map(), {});
  assert.equal(restored.stateHash(), old.stateHash);
  assert.equal(restored.services.first, restored.services.second);
  sameGraph(graph.services, { first: restored.services.first, second: restored.services.second });
  assert.equal(JSON.stringify(restored.snapshot().data), JSON.stringify(old.data));
  const uninterrupted = new Runtime(structuredClone(world), new Map(), {});
  for (let i = 0; i < 3; i++) {
    restored.step(); uninterrupted.step();
    assert.equal(restored.stateHash(), uninterrupted.stateHash());
  }
});
