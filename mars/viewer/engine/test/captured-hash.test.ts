import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { stableStringify as nativeText, hashOf, hashCanonicalSteps, setSha256Provider } from '../core/hash.ts';
import { captureGraphDeferred, captureGraphForCheckpoint, checkpointNeedsEagerNativeHash, finishGraph, capturedCanonicalRoot, canonicalGet, canonicalTextSteps, prepareImmutableSnapshotData } from '../runtime/codec.ts';
import { Runtime } from '../runtime/runtime.ts';
import { emptyWorld } from '../world/factory.ts';
import { provingGround } from '../scenes/proving-ground.ts';

// Independent contract serializer oracle, deliberately retaining its ordinary
// assignment and JSON integer-key enumeration behavior.
function contractText(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') {
      if (typeof v === 'number' && !Number.isFinite(v)) throw Error('non-finite');
      return Object.is(v, -0) ? 0 : v;
    }
    if (Array.isArray(v)) return v.map(sort);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(v).sort()) if ((v as Record<string, unknown>)[key] !== undefined) out[key] = sort((v as Record<string, unknown>)[key]);
    return out;
  };
  return JSON.stringify(sort(value));
}
function text(value: unknown, mode: 'native' | 'contract', mutate?: () => void) {
  const owned = capturedCanonicalRoot(captureGraphDeferred(value));
  let out = '', yields = 0;
  for (const token of canonicalTextSteps(owned, mode, 7)) {
    if (token === undefined) { yields++; mutate?.(); } else out += token;
  }
  return { out, yields, owned };
}
function drain<T>(iterator: Generator<void, T, void>): T {
  let result = iterator.next(); while (!result.done) result = iterator.next(); return result.value;
}

test('owned canonical text matches independent native/contract oracles across keys, values and aliases', () => {
  const shared = { '~id': 3, negative: -0, absent: undefined, unicode: '🌱\ud800' };
  const proto = JSON.parse('{"__proto__":{"2":3,"10":4},"2":2,"10":10,"x":null}');
  const corpus: unknown[] = [null, 0, -0, true, '🙂', [undefined, -0, shared, shared],
    { '2': shared, '10': proto, z: new Map([[shared, Infinity]]), s: new Set([NaN]), none: undefined }, proto];
  for (let seed = 0; seed < 80; seed++) corpus.push({ [String(seed % 11)]: [seed, undefined, shared], ['~'+seed]: { z: -seed, a: seed / 3 }, shared });
  for (const value of corpus) for (const mode of ['native', 'contract'] as const) {
    const expected = mode === 'native' ? nativeText(value) : contractText(value);
    const got = text(value, mode);
    assert.equal(got.out, expected);
    assert.equal(drain(hashCanonicalSteps(canonicalTextSteps(got.owned, mode, 5))), createHash('sha256').update(expected).digest('hex'));
  }
  assert.notEqual(text(proto, 'native').out, text(proto, 'contract').out, 'the two legacy canonical key contracts are intentionally distinct');
});

test('flat sorting/arrays yield and never reread mutated source or late admission', () => {
  const source = { values: Array.from({ length: 1400 }, (_, i) => ({ [String(1400-i)]: i, x: -0 })), text: '🌱'.repeat(40000) };
  const expected = nativeText(source), owned = capturedCanonicalRoot(captureGraphDeferred(source));
  const first = canonicalTextSteps(owned, 'native', 17);
  let actual = '', yields = 0, initial = first.next();
  while (!initial.done && initial.value !== undefined) { actual += initial.value; initial = first.next(); }
  assert.equal(initial.done, false); yields++;
  source.values[0].x = 88; source.text = 'changed'; prepareImmutableSnapshotData(source);
  for (const token of first) { if (token === undefined) yields++; else actual += token; }
  assert.ok(yields > 100); assert.equal(actual, expected);
  assert.equal(drain(hashCanonicalSteps(canonicalTextSteps(owned, 'native', 19))), createHash('sha256').update(expected).digest('hex'));
});

test('frozen closure interiors and aliases preserve actual owned values without content-key trust', () => {
  const interior = { x: -0, '~r': 12 }, frozen = { version: 'entity-physics/1', hash: 'a'.repeat(64), byEntity: { interior }, assets: {}, levels: [] };
  prepareImmutableSnapshotData(frozen);
  const source = { frozen, outside: interior, another: interior };
  assert.equal(text(source, 'native').out, nativeText(source));
  assert.equal(text(source, 'contract').out, contractText(source));
});

test('nonfinite values and ancestor cycles remain unhashable, while Map/Set entries are not hash fields', () => {
  for (const mode of ['native', 'contract'] as const) {
    for (const value of [NaN, Infinity, -Infinity]) assert.throws(() => text({ value }, mode), /non-finite/);
    const cycle: { next?: unknown } = {}; cycle.next = cycle;
    assert.throws(() => text(cycle, mode), RangeError);
    assert.equal(text(new Map([[cycle, Infinity]]), mode).out, '{}');
    assert.equal(text(new Set([cycle, NaN]), mode).out, '{}');
  }
  const hiddenBad = Object.defineProperty({}, '__proto__', { value: { bad: Infinity }, enumerable: true });
  assert.throws(() => text(hiddenBad, 'contract'), /non-finite/);
  const a = {}, b = {};
  Object.defineProperty(a, '__proto__', { value: b, enumerable: true });
  Object.defineProperty(b, '__proto__', { value: a, enumerable: true });
  assert.throws(() => text(a, 'contract'), RangeError);
  assert.equal(text(undefined, 'native').out, 'null');
  assert.throws(() => text(undefined, 'contract'), TypeError);
});

test('deferred native checkpoint keeps graph bytes and independent finishes after mutation on every yield', () => {
  const world = emptyWorld('owned-hash', provingGround());
  const services: Record<string, unknown> = { fixture: { sequence: Array.from({ length: 1000 }, (_, i) => i) } };
  const cycle: { self?: unknown } = {}; cycle.self = cycle; services.cycle = cycle;
  const runtime = new Runtime(world, new Map(), services, []);
  const expected = runtime.snapshot(), bytes = JSON.stringify(expected), capture = runtime.captureSnapshotDeferred();
  const first = capture.steps(); assert.equal(first.next().done, false);
  world.tick++;
  assert.equal(JSON.stringify(capture.finish()), bytes);
  let result = first.next(), yields = 0;
  while (!result.done) { world.tick++; (services.fixture as { sequence: number[] }).sequence[0]++; yields++; result = first.next(); }
  assert.ok(yields > 1); assert.equal(JSON.stringify(result.value), bytes);
  result.value.violations.push({ tick: 1, code: 'output', message: 'output mutation' });
  assert.equal(JSON.stringify(drain(capture.steps())), bytes);
  const restored = Runtime.restore(capture.finish(), new Map(), {}, []);
  assert.equal(restored.stateHash(), expected.stateHash);
});

test('deferred native capture rejects unhashable world data synchronously but permits service cycles', () => {
  for (const frozen of [false, true]) {
    const world = emptyWorld('invalid-hash', provingGround());
    const extra: { bad?: unknown; self?: unknown } = { bad: Infinity };
    if (frozen) prepareImmutableSnapshotData(extra);
    Object.assign(world, { fixture: extra });
    const runtime = new Runtime(world, new Map(), {}, []);
    assert.throws(() => runtime.captureSnapshotDeferred(), /non-finite/);
    const cycle: { self?: unknown } = {}; cycle.self = cycle;
    if (frozen) prepareImmutableSnapshotData(cycle);
    Object.assign(world, { fixture: cycle });
    assert.throws(() => runtime.captureSnapshotDeferred(), RangeError);
    delete (world as unknown as { fixture?: unknown }).fixture;
    runtime.services.fixture = cycle;
    assert.doesNotThrow(() => runtime.captureSnapshotDeferred());
  }
});

test('captured hashing reads no newly installed source getter and reports digest-provider failure at completion', () => {
  const source = { nested: { value: 3 } }, owned = capturedCanonicalRoot(captureGraphDeferred(source));
  Object.defineProperty(source.nested, 'value', { get() { throw Error('live getter called'); } });
  assert.equal([...canonicalTextSteps(owned, 'native')].filter(x => typeof x === 'string').join(''), '{"nested":{"value":3}}');
  const runtime = new Runtime(emptyWorld('provider-failure', provingGround()), new Map(), {}, []);
  const capture = runtime.captureSnapshotDeferred();
  setSha256Provider(text => createHash('sha256').update(text).digest('hex'), () => ({
    update() { throw Error('digest provider failed'); }, digest() { throw Error('digest provider failed'); },
  }));
  try {
    assert.throws(() => capture.finish(), /digest provider failed/);
    assert.throws(() => drain(capture.steps()), /digest provider failed/);
  } finally { setSha256Provider(); }
  assert.equal(capture.finish().stateHash, runtime.stateHash());
});

test('checkpoint pins legacy physics text selection, including copied lookalikes, before cache eviction and mutation', () => {
  const facts = { levels: [0], byEntity: { a: { x: 1, unicode: '🌱'.repeat(40000) } }, assets: {} };
  const physics = { version: 'entity-physics/1', hash: hashOf(facts), ...facts };
  nativeText(physics); // Seed precisely the legacy validated content-key cache.
  const copied = structuredClone(physics); copied.byEntity.a.x = 2;
  const world = { entityPhysicsV1: copied, outside: copied.byEntity.a };
  const expected = nativeText(world);
  const owned = canonicalGet(capturedCanonicalRoot(captureGraphForCheckpoint({ world }, ['world'])), 'world');
  copied.byEntity.a.x = 3; copied.assets = { changed: true };
  // Evict the original cache entry; deferred output must not perform a new lookup.
  for (let i = 0; i < 5; i++) {
    const next = { levels: [i + 1], byEntity: {}, assets: {} };
    nativeText({ version: 'entity-physics/1', hash: hashOf(next), ...next });
  }
  const tokens = [...canonicalTextSteps(owned, 'native', 13)];
  assert.equal(tokens.filter(x => typeof x === 'string').join(''), expected);
  let updates = 0;
  setSha256Provider(text => createHash('sha256').update(text).digest('hex'), () => {
    const digest = createHash('sha256');
    return { update(piece) { updates++; digest.update(piece); }, digest() { return digest.digest('hex'); } };
  });
  try {
    assert.equal(drain(hashCanonicalSteps(canonicalTextSteps(owned, 'native', 13))), createHash('sha256').update(expected).digest('hex'));
    assert.ok(updates > 2, 'large pinned JSON text is streamed without splitting UTF-16 surrogate pairs');
  } finally { setSha256Provider(); }
  // Contract hashing ignores the native shortcut and reads the original captured
  // copy (x=2), not either the seeded native-cache value or subsequent x=3.
  const originalCopy = structuredClone(physics); originalCopy.byEntity.a.x = 2;
  assert.equal([...canonicalTextSteps(owned, 'contract')].filter(x => typeof x === 'string').join(''), contractText({ entityPhysicsV1: originalCopy, outside: originalCopy.byEntity.a }));
});

test('native selection follows lexical occurrences through eviction, aliases and inherited-name own keys', () => {
  const make = (n: number) => {
    const facts = { levels: [n], byEntity: { a: { x: n } }, assets: {} };
    return { version: 'entity-physics/1', hash: hashOf(facts), ...facts };
  };
  const good = make(7100), bad = structuredClone(good); bad.byEntity.a.x = -1;
  Object.assign(bad, { constructor: 'own constructor', toString: 'own toString' });
  Object.defineProperty(bad, '__proto__', { value: { ordinary: true }, enumerable: true });
  const root = { z: bad, e: make(7104), c: make(7102), a: bad, d: make(7103), b: make(7101) };
  const reset = () => { for (let i = 0; i < 5; i++) nativeText(make(7200 + i)); nativeText(good); };
  reset(); const expected = nativeText(root);
  assert.equal(JSON.parse(expected).a.byEntity.a.x, 7100, 'first alias uses the warm validated cache');
  assert.equal(JSON.parse(expected).z.byEntity.a.x, -1, 'later alias observes intervening eviction');
  reset();
  const owned = capturedCanonicalRoot(captureGraphForCheckpoint(root, []));
  const first = canonicalTextSteps(owned, 'native', 1);
  let partial = '', item = first.next();
  while (!item.done && item.value !== undefined) { partial += item.value; item = first.next(); }
  bad.byEntity.a.x = -999; reset();
  assert.equal([...canonicalTextSteps(owned, 'native', 3)].filter(x => typeof x === 'string').join(''), expected);
  for (const token of first) if (typeof token === 'string') partial += token;
  assert.equal(partial, expected, 'each independent iterator owns its selection occurrence cursor');
});

test('hidden selector getter compatibility retains the eager native capture ordering without extra reads', () => {
  const make = () => {
    const world = emptyWorld('hidden-native-selector', provingGround());
    const log: string[] = [], fixture = { levels: [], byEntity: {}, assets: {} };
    Object.defineProperties(fixture, {
      version: { get() { log.push('version'); world.tick++; return 'entity-physics/1'; } },
      hash: { get() { log.push('hash'); return '0'.repeat(64); } },
    });
    Object.assign(world, { fixture });
    return { world, log, runtime: new Runtime(world, new Map(), {}, []) };
  };
  const eager = make(), expected = eager.runtime.snapshot(), expectedLog = [...eager.log];
  const deferred = make(), capture = deferred.runtime.captureSnapshotDeferred();
  assert.deepEqual(deferred.log, expectedLog);
  assert.equal(capture.eagerStateHash, expected.stateHash);
  assert.equal(capture.tick, expected.tick, 'tick is read before the native selector getter runs');
  const before = [...deferred.log]; deferred.world.tick += 100;
  assert.equal(JSON.stringify(capture.finish()), JSON.stringify(expected));
  assert.equal(JSON.stringify(drain(capture.steps())), JSON.stringify(expected));
  assert.deepEqual(deferred.log, before, 'completion never repeats an exceptional source getter');
});


test('non-enumerable data selector metadata uses legacy selection without becoming persisted fields', () => {
  const facts = { levels: [7900], byEntity: { item: { x: 1 } }, assets: {} };
  const good = { version: 'entity-physics/1', hash: hashOf(facts), ...facts };
  nativeText(good);
  const make = () => {
    const world = emptyWorld('hidden-data-selector', provingGround());
    const fixture = structuredClone(facts); fixture.byEntity.item.x = 2;
    Object.defineProperties(fixture, { version: { value: good.version }, hash: { value: good.hash } });
    Object.assign(world, { fixture });
    return new Runtime(world, new Map(), {}, []);
  };
  const expected = make().snapshot(), capture = make().captureSnapshotDeferred();
  assert.equal(capture.eagerStateHash, expected.stateHash);
  assert.equal(JSON.stringify(capture.finish()), JSON.stringify(expected));
});


test('fused hashability proof preserves lexical rejection order without preflight cache effects', () => {
  for (const source of [{ z: NaN, a: Infinity }, { z: { bad: -Infinity }, a: { bad: NaN } }]) {
    let message = '';
    try { nativeText(source); } catch (error) { message = (error as Error).message; }
    assert.throws(() => captureGraphForCheckpoint(source, []), { message });
  }
  const shared = { values: [1, 2, 3] }, root = { z: shared, a: shared };
  const expected = nativeText(root), owned = capturedCanonicalRoot(captureGraphForCheckpoint(root, []));
  shared.values[0] = Infinity;
  assert.equal([...canonicalTextSteps(owned, 'native', 1)].filter(x => typeof x === 'string').join(''), expected);
});

test('compatibility predicate keeps digest side effects at the original native metadata position', () => {
  const make = () => new Runtime(emptyWorld('compatibility-provider', provingGround()), new Map(), {}, []);
  const collect = (runtime: Runtime, deferred: boolean) => {
    let calls = 0, predicates = 0;
    setSha256Provider(text => {
      calls++; runtime.world.tick++;
      runtime.violations.push({ tick: runtime.tick, code: 'provider-fixture', message: 'after digest' });
      return createHash('sha256').update(text).digest('hex');
    });
    try {
      const capture = deferred ? runtime.captureSnapshotDeferred({}, () => { predicates++; return true; }) : runtime.captureSnapshot();
      const snapshot = capture.finish();
      assert.equal(calls, 1); assert.equal(predicates, deferred ? 1 : 0);
      assert.equal(snapshot.tick, 0); assert.equal(snapshot.violations.length, 1);
      const repeated = capture.finish(); assert.equal(calls, 1);
      assert.equal(JSON.stringify(repeated), JSON.stringify(snapshot));
      return snapshot;
    } finally { setSha256Provider(); }
  };
  assert.equal(JSON.stringify(collect(make(), true)), JSON.stringify(collect(make(), false)));
});


test('ownership proof follows only the selected hash root and ignores collection entries', () => {
  let getterReads = 0;
  const hidden = Object.defineProperty({}, 'version', { get() { getterReads++; return 'entity-physics/1'; } });
  const cycle: { back?: unknown; invalid: number } = { invalid: Infinity }; cycle.back = cycle;
  const shared = { finite: [1, -0, undefined] };
  const world = { shared, alias: shared, map: new Map<unknown, unknown>([[cycle, hidden]]), set: new Set([cycle, hidden]) };
  // The selected world is first captured through a service collection, before
  // its named hash path. Invalid service-only closures cannot poison its proof.
  const root = { services: new Map<unknown, unknown>([['world', world], ['cycle', cycle], ['hidden', hidden]]), world };
  const expectedGraph = JSON.stringify(finishGraph(captureGraphDeferred(root)));
  const expected = nativeText(world), capture = captureGraphForCheckpoint(root, ['world']);
  assert.equal(checkpointNeedsEagerNativeHash(capture), false);
  assert.equal(getterReads, 0);
  assert.equal(JSON.stringify(finishGraph(capture)), expectedGraph);
  const owned = canonicalGet(capturedCanonicalRoot(capture), 'world');
  shared.finite[0] = 99;
  assert.equal([...canonicalTextSteps(owned, 'native', 1)].filter(x => typeof x === 'string').join(''), expected);
  assert.equal(getterReads, 0);
});

test('active ownership aliases retain full inspection for later hidden-selector siblings', () => {
  let getterReads = 0;
  const hidden = Object.defineProperty({}, 'version', { get() { getterReads++; return 'entity-physics/1'; } });
  const ancestor: { first?: unknown; last?: unknown } = {};
  const world = { back: ancestor };
  ancestor.first = world; ancestor.last = hidden;
  const root = { services: new Map([['ancestor', ancestor]]), world };
  const capture = captureGraphForCheckpoint(root, ['world']);
  assert.equal(checkpointNeedsEagerNativeHash(capture), true,
    'world was completed while its ancestor and the later hidden sibling were unresolved');
  assert.equal(getterReads, 0, 'the fallback decision only inspects descriptors');
  assert.equal(JSON.stringify(finishGraph(capture)), JSON.stringify(finishGraph(captureGraphDeferred(root))));
});

test('frozen proof frontiers preserve lazy ownership, aliases, hidden metadata and cycles', () => {
  const interior = { '~inside': [1, 2, 3] }, frozen = { interior, alias: interior };
  prepareImmutableSnapshotData(frozen);
  const root = { world: { frozen, interior } };
  const ordinary = captureGraphDeferred(root), checkpoint = captureGraphForCheckpoint(root, ['world']);
  assert.equal(checkpoint.nodes, ordinary.nodes); assert.equal(checkpoint.cachedNodes, ordinary.cachedNodes);
  assert.equal(JSON.stringify(finishGraph(checkpoint)), JSON.stringify(finishGraph(ordinary)));
  assert.equal([...canonicalTextSteps(canonicalGet(capturedCanonicalRoot(checkpoint), 'world'), 'native', 1)]
    .filter(x => typeof x === 'string').join(''), nativeText(root.world));

  let getterReads = 0;
  const hidden = Object.defineProperty({}, 'version', { get() { getterReads++; return 'entity-physics/1'; } });
  const cycle: { self?: unknown; hidden: object } = { hidden }; cycle.self = cycle;
  prepareImmutableSnapshotData(cycle);
  const cyclicRoot = { world: cycle }, cyclic = captureGraphForCheckpoint(cyclicRoot, ['world']);
  assert.equal(checkpointNeedsEagerNativeHash(cyclic), true); assert.equal(getterReads, 0);
  assert.equal(cyclic.nodes, captureGraphDeferred(cyclicRoot).nodes);
  assert.equal(JSON.stringify(finishGraph(cyclic)), JSON.stringify(finishGraph(captureGraphDeferred(cyclicRoot))));
});

test('ownership summaries do not change codec error precedence or late-admission values', () => {
  for (const makeServices of [() => ({ unsupported() {} }),
    () => Object.defineProperty({}, 'bad', { enumerable: true, get() { throw Error('getter must not run'); } })]) {
    const root = { world: { z: NaN, a: Infinity }, services: makeServices() };
    let expected = '';
    try { captureGraphDeferred(root); } catch (error) { expected = (error as Error).message; }
    assert.ok(expected.includes('resumable snapshot'));
    assert.throws(() => captureGraphForCheckpoint(root, ['world']), { message: expected });
  }
  const shared = { a: [1, 2, 3] }, root = { first: new Set([shared]), world: { shared, alias: shared } };
  const expected = nativeText(root.world), checkpoint = captureGraphForCheckpoint(root, ['world']);
  shared.a[0] = 100; prepareImmutableSnapshotData(shared);
  const owned = canonicalGet(capturedCanonicalRoot(checkpoint), 'world');
  assert.equal([...canonicalTextSteps(owned, 'native', 1)].filter(x => typeof x === 'string').join(''), expected);
});
