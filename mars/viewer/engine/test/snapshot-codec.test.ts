import test from 'node:test';
import assert from 'node:assert/strict';
import { CodecError, captureGraph, captureGraphDeferred, decode, encode, finishGraph, finishGraphSteps, prepareImmutableSnapshotData, type GraphCapture } from '../runtime/codec.ts';
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

function drainGraph(steps: Generator<void, unknown, void>): { value: unknown; yields: number } {
  let yields = 0, result = steps.next();
  while (!result.done) { assert.ok(++yields < 100000, 'emission must terminate'); result = steps.next(); }
  return { value: result.value, yields };
}

test('bounded emitter preserves independent legacy bytes across aliases, cycles and special values', () => {
  for (const source of [undefined, null, -0, NaN, Infinity, -Infinity,
    ...Array.from({ length: 80 }, (_, i) => generatedGraph(i + 1))]) {
    const capture = captureGraph(source), expected = JSON.stringify(legacyEncode(source));
    for (const budget of [1, 7, 256]) {
      const { value } = drainGraph(finishGraphSteps(capture, budget));
      assertJsonTree(value);
      assert.equal(JSON.stringify(value), expected);
      sameGraph(source, decode(JSON.parse(expected)));
    }
  }
});

test('bounded emitter yields within flat arrays, objects, maps and sets, including escaped objects', () => {
  const n = 513, values = Array.from({ length: n }, (_, i) => i);
  const entries = values.map(i => ['key' + i, i] as const);
  for (const [source, edges] of [
    [values, n], [Object.fromEntries(entries), n], [new Map(entries), n * 2], [new Set(values), n],
    [Object.fromEntries(entries.map(([key, value]) => ['~' + key, value])), n],
  ] as [unknown, number][]) {
    const { value, yields } = drainGraph(finishGraphSteps(captureGraph(source), 32));
    assert.equal(yields, Math.floor(edges / 32), 'primitive edges and final frame retirement bound each turn');
    assert.equal(JSON.stringify(value), JSON.stringify(legacyEncode(source)));
  }
  for (const budget of [0, -1, 1.5, Infinity, NaN])
    assert.throws(() => finishGraphSteps(captureGraph([]), budget).next(), RangeError);
});

test('interleaved emitters and synchronous finish own outputs and never reread mutated source state', () => {
  const shared: Record<string, unknown> = { value: 3 }; shared.self = shared;
  Object.defineProperty(shared, '__proto__', { enumerable: true, configurable: true, writable: true, value: shared });
  const dropped = { closure: () => 1 };
  const source = { map: new Map<unknown, unknown>([[shared, dropped], ['keep', shared]]), shared,
    values: [shared, -0, undefined], set: new Set([shared]) };
  const capture = captureGraph(source, '$', new Set([dropped]));
  const expected = JSON.stringify(finishGraph(capture));
  const first = finishGraphSteps(capture, 1), second = finishGraphSteps(capture, 2);
  assert.equal(first.next().done, false); assert.equal(second.next().done, false);
  shared.value = 99; source.map.clear(); source.values.length = 0; source.set.clear();
  Object.defineProperty(shared, 'self', { get() { throw new Error('live source was reread'); } });
  const synchronous = finishGraph(capture) as Record<string, unknown>;
  assert.equal(JSON.stringify(synchronous), expected);
  synchronous.shared = 'changed output';
  const a = drainGraph(first).value as Record<string, unknown>;
  assert.equal(JSON.stringify(a), expected); a.map = 'changed output';
  assert.equal(JSON.stringify(drainGraph(second).value), expected);
  assert.equal(JSON.stringify(drainGraph(finishGraphSteps(capture)).value), expected);
});


test('deferred frozen traversal preserves eager counters and legacy bytes across a frozen graph corpus', () => {
  for (let seed = 1; seed <= 40; seed++) {
    let state = seed;
    const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
    const nodes: (unknown[] | Record<string, unknown>)[] = Array.from({ length: 12 }, (_, i) => i % 2 ? [] : {});
    const atoms = [undefined, -0, NaN, Infinity, -Infinity, null, false, '🌱'];
    const value = () => next() % 3 ? nodes[next() % nodes.length] : atoms[next() % atoms.length];
    for (const node of nodes) {
      if (Array.isArray(node)) for (let i = 0; i < 4; i++) node.push(value());
      else Object.assign(node, { '2': value(), '1': value(), '~literal': value(), child: value() });
    }
    assert.equal(prepareImmutableSnapshotData(nodes), true);
    const interior = nodes[seed % nodes.length];
    for (const source of [nodes, { interior, nodes, again: interior }, { nodes, interior, again: interior },
      { map: new Map<unknown, unknown>([[interior, nodes]]), nodes, set: new Set([interior]) }]) {
      const eager = captureGraph(source), lazy = captureGraphDeferred(source);
      const expected = JSON.stringify(legacyEncode(source));
      assert.ok(lazy.nodes < eager.nodes, 'atomic capture stops at admitted roots and interiors');
      assert.equal(captureGraph(source).nodes, eager.nodes, 'eager complete-graph counters remain unchanged');
      assert.equal(JSON.stringify(finishGraph(lazy)), expected);
      for (const budget of [1, 17, 256]) {
        const output = drainGraph(finishGraphSteps(lazy, budget)).value;
        assertJsonTree(output); assert.equal(JSON.stringify(output), expected);
        sameGraph(source, decode(JSON.parse(expected)));
      }
    }
  }
});

test('frozen reference counting itself yields within large flat containers before bounded emission', () => {
  const n = 513, values = Array.from({ length: n }, (_, i) => i);
  for (const source of [values, Object.fromEntries(values.map(i => ['key' + i, i])),
    Object.fromEntries(values.map(i => ['~key' + i, i]))]) {
    assert.equal(prepareImmutableSnapshotData(source), true);
    const capture = captureGraphDeferred(source);
    assert.equal(capture.nodes, 1); assert.equal(capture.cachedNodes, 1);
    const { value, yields } = drainGraph(finishGraphSteps(capture, 32));
    // One frontier initialization, each frozen edge+retirement, then each emitted
    // edge+retirement. The partial expansion quantum carries into emission.
    assert.equal(yields, Math.floor((2 * n + 2) / 32));
    assert.equal(JSON.stringify(value), JSON.stringify(legacyEncode(source)));
  }
});

test('independent lazy completions count frozen cycles, escaped keys and dropped shared Map keys exactly once', () => {
  const interior: Record<string, unknown> = { value: 4, '~id': 'literal' };
  Object.defineProperty(interior, '__proto__', { value: interior, enumerable: true });
  const physics = { interior, repeated: interior }; interior.root = physics;
  assert.equal(prepareImmutableSnapshotData(physics), true);
  const dropped = { fn() {} }, mutable = { value: 3 };
  const source = { interior, map: new Map<unknown, unknown>([[interior, dropped], ['keep', physics]]), physics, mutable };
  const reference = { ...source, map: new Map<unknown, unknown>([['keep', physics]]) };
  const expected = JSON.stringify(encode(reference));
  const capture = captureGraphDeferred(source, '$', new Set([dropped]));
  const first = finishGraphSteps(capture, 1), second = finishGraphSteps(capture, 2);
  assert.equal(first.next().done, false); assert.equal(second.next().done, false);
  const synchronous = finishGraph(capture) as Record<string, unknown>;
  assert.equal(JSON.stringify(synchronous), expected); synchronous.physics = 'changed output';
  source.physics = { interior: {}, repeated: {} }; source.map.clear();
  Object.defineProperty(mutable, 'value', { get() { throw new Error('live mutable getter read'); } });
  const a = drainGraph(first).value as Record<string, unknown>;
  assert.equal(JSON.stringify(a), expected); a.interior = 'changed first output';
  const b = drainGraph(second).value;
  assertJsonTree(b); assert.equal(JSON.stringify(b), expected);
  sameGraph(reference.physics, (decode(b) as typeof reference).physics);
  assert.equal(JSON.stringify(finishGraph(capture)), expected);
  assert.equal(JSON.stringify(drainGraph(finishGraphSteps(capture, 1)).value), expected);
});

test('admitting a mutable node after capture cannot replace its previously captured values', () => {
  const frozen = { leaf: { value: 1 } };
  assert.equal(prepareImmutableSnapshotData(frozen), true);
  const mutable = { leaf: { value: 2 }, values: [3, 4] }, source = { frozen, mutable };
  const expected = JSON.stringify(legacyEncode(source)), capture = captureGraphDeferred(source);
  const steps = finishGraphSteps(capture, 1); assert.equal(steps.next().done, false);
  mutable.leaf.value = 99; mutable.values.push(5);
  assert.equal(prepareImmutableSnapshotData(mutable), true);
  assert.equal(JSON.stringify(finishGraph(capture)), expected);
  assert.equal(JSON.stringify(drainGraph(steps).value), expected);
});

test('deferred capture retains fallback and synchronous refusal boundaries for untrusted shapes', () => {
  const map = new Map<unknown, unknown>([['x', new Set([1, 2])]]);
  const lookalike = { version: 'entity-physics/1', hash: 'a'.repeat(64), child: { value: 1 } };
  const shallow = Object.freeze({ child: { value: 2 } });
  assert.equal(prepareImmutableSnapshotData(map), false);
  for (const source of [map, lookalike, shallow]) {
    const eager = captureGraph(source), lazy = captureGraphDeferred(source);
    assert.equal(lazy.cachedNodes, 0); assert.equal(lazy.nodes, eager.nodes);
    assert.equal(JSON.stringify(finishGraph(lazy)), JSON.stringify(legacyEncode(source)));
  }
  const admitted = { child: { value: 1 } }; assert.equal(prepareImmutableSnapshotData(admitted), true);
  const bad = { get x() { assert.fail('capture must not call a getter'); return 1; } };
  assert.throws(() => captureGraphDeferred({ admitted, bad }),
    e => e instanceof CodecError && e.message.includes('$.bad.x is an accessor property'));
});
