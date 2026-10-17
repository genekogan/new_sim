import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256, hashOf, hashStable, setSha256Provider, stableStringify } from '../../../mars/viewer/engine/core/hash.ts';
import { marsFactory } from './index.ts';

const native = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

test('native SHA-256 preserves portable UTF-8 digests at block boundaries and malformed surrogates', () => {
  const texts = ['', 'abc', 'Verdelis 🌱 火星\u0000', '\ud800', '\udc00', '\ud800x\udc00',
    ...[55, 56, 63, 64, 65, 119, 120, 127, 128, 129, 65536].map(n => 'é'.repeat(n))];
  // Exercise all UTF-16 code units, including paired and unpaired surrogates.
  for (let start = 0; start < 65536; start += 256)
    texts.push(String.fromCharCode(...Array.from({ length: 256 }, (_, i) => start + i)));
  setSha256Provider();
  const portable = texts.map(sha256);
  try {
    setSha256Provider(native);
    assert.deepEqual(texts.map(sha256), portable);
    assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  } finally { setSha256Provider(); }
});

test('native and portable hashing produce identical world states, program events and recorded takes', async () => {
  const factory = await marsFactory();
  const run = (provider?: typeof native) => {
    setSha256Provider(provider);
    const engine = factory.create(factory.genesis('native-hash-equivalence'));
    engine.spawnHuman({ id: 'a', label: 'Ada 🌱', soul: 's_a' });
    assert.ok(engine.perform({ actor: 'a', label: 'stroll', steps: [{ verb: 'ambient_wander', params: { seconds: 10, radius: 3 } }] }).ok);
    const events = [];
    for (let tick = 0; tick < 400; tick++) events.push(engine.step());
    assert.deepEqual(engine.runtime.violations, []);
    const takes = engine.takeChunks!(0);
    assert.ok(takes.length > 0);
    return { world: structuredClone(engine.world), hash: engine.stateHash(), takes, events, addresses: takes.map(t => hashOf(t)) };
  };
  try { assert.deepEqual(run(native), run()); }
  finally { setSha256Provider(); }
});

// lane L1: the stable text is written piece by piece and, with a streaming provider (the server), hashed as it is
// written. The reference below is the text format as it was (one recursive template/join), kept here to pin it.
function reference(value: unknown, known?: ReadonlyMap<object, string>): string {
  if (value !== null && typeof value === 'object' && known?.has(value)) return known.get(value)!;
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('non-finite'); return Object.is(value, -0) ? '0' : JSON.stringify(value); }
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : reference(v, known))).join(',')}]`;
  const keys = Object.keys(value).filter((k) => (value as Record<string, unknown>)[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${reference((value as Record<string, unknown>)[k], known)}`).join(',')}}`;
}
const stream = () => { const h = createHash('sha256'); return { update: (p: string) => { h.update(p, 'utf8'); }, digest: () => h.digest('hex') }; };

test('stable text unchanged and streamed hashes equal the text hash: holes, undefined, -0, surrogates, known texts, > 64 KB', () => {
  const holey = [1, , 3, undefined, -0]; holey.length = 8;
  const shared = { big: 'é🌱'.repeat(40000) };
  const values: unknown[] = [null, true, 0, -0, 1.5e-7, 'x\ud800y\udc00', '🌱', [], {}, holey, { b: undefined, a: [, null, undefined], 'é': -0 },
    { nested: Array.from({ length: 3000 }, (_, i) => ({ i, s: `🌱${i}`, n: i % 7 ? undefined : [i, -0] })) }, [shared, shared], new Map([[1, 2]]), Object.assign([1, 2], { extra: 3 })];
  const known = new Map<object, string>([[shared, '"K🌱"']]);
  try {
    for (const provider of [undefined, native]) for (const st of provider ? [undefined, stream] : [undefined]) {
      setSha256Provider(provider, st);
      for (const v of values) for (const k of [undefined, known]) {
        const text = reference(v, k);
        assert.equal(stableStringify(v, k), text);
        assert.equal(hashStable(v, k), native(text));
        if (!k) assert.equal(hashOf(v), native(text));
      }
    }
  } finally { setSha256Provider(); }
});

test('streamed hashing (the server\'s provider) gives the same world, takes and addresses; each take starts from the state hash of its first tick', async () => {
  const factory = await marsFactory();
  const run = (provider?: typeof native, st?: typeof stream) => {
    setSha256Provider(provider, st);
    const engine = factory.create(factory.genesis('stream-hash-equivalence'));
    engine.spawnHuman({ id: 'a', label: 'Ada 🌱', soul: 's_a' });
    assert.ok(engine.perform({ actor: 'a', label: 'stroll', steps: [{ verb: 'ambient_wander', params: { seconds: 10, radius: 3 } }] }).ok);
    const rt = () => (engine as unknown as { rt: { tick: number; stateHash(): string } }).rt;   // the Mars runtime (TakeRecorder's source)
    const at = new Map<number, string>([[rt().tick, rt().stateHash()]]);
    for (let tick = 0; tick < 300; tick++) { engine.step(); at.set(rt().tick, rt().stateHash()); }
    const takes = engine.takeChunks!(0);
    assert.ok(takes.length >= 10);
    for (const c of takes) {
      const t = c.take as { startTick: number; baselineStateHash: string; finalStateHash: string };
      assert.equal(t.baselineStateHash, at.get(t.startTick), `take from ${t.startTick}: baseline is that tick's state hash`);
      assert.equal(t.finalStateHash, at.get(c.toTick), `take to ${c.toTick}: final is that tick's state hash`);
    }
    return { world: structuredClone(engine.world), hash: engine.stateHash(), takes, addresses: takes.map(t => hashOf(t)) };
  };
  try { assert.deepEqual(run(native, stream), run()); }
  finally { setSha256Provider(); }
});
