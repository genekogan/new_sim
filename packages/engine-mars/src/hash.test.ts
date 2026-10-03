import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256, hashOf, setSha256Provider } from '../../../mars/viewer/engine/core/hash.ts';
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
