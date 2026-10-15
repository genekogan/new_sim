import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldModel, coreLibrary, plan, refusalCodes } from './index.ts';

test('seed 0x51afe: malformed/random batches never escape the compiler and every refusal has a known code', { timeout: 5000 }, () => {
  const w = new WorldModel({ constants: { ground: 'land', extent: 100 }, seed: 'fuzz' }); w.library = coreLibrary();
  let seed = 0x51afe;
  const rand = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 2 ** 32; };
  const pick = <T>(values: T[]) => values[Math.floor(rand() * values.length)];
  const deep = (depth: number) => { let v: unknown = 'leaf'; for (let n = 0; n < depth; n++) v = { nested: v }; return v; };
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  const malformed: unknown[] = [undefined, null, true, NaN, Infinity, 10n, [], {}, cyclic,
    { ops: Array(257).fill({ op: 'remove', id: 'missing' }) }, { ops: [{ op: 'set', id: 'missing', params: { plan: deep(10_000) } }] },
    { ops: [{ op: 'define', def: { schema: 'def/1', name: 'x', size: { box: [1, 1, 1] }, make: { kind: 'gen', gen: 'kit/2', args: deep(80) } } }] },
    { ops: [{ op: 'world', state: { constitution: '雪'.repeat(800_000) } }] }];
  const atoms: unknown[] = [null, true, false, NaN, Infinity, -Infinity, 1e308, -1e308, 0, -0, -100, 0.2, '🌌雪\u0000', '__proto__', '$bad', 'not-a-ref', 'x'.repeat(9000), {}, [], [1, 2]];
  for (let n = 0; n < 500; n++) {
    const p = pick(atoms), ref = pick(['core/bench@1', 'core/church@1', 'none@1', '$missing', '🌍/@0']);
    malformed.push({ ops: [pick([
      { op: pick(['unknown', '', '🌌', 'constructor']), id: p },
      { op: 'place', def: ref, p: pick([[rand() * 80 - 40, rand() * 80 - 40], [p, p], p]), params: { bogus: p } },
      { op: 'move', id: p, p: [p, p], r: p }, { op: 'set', id: ref, params: { plan: p } },
      { op: 'world', state: { time: { dayTicks: p }, sky: { sun: p } } },
      { op: 'define', def: { schema: 'def/1', name: 'candidate', size: { box: [1, 1, 1] }, make: { kind: 'gen', gen: pick(['kit/2', 'no-such/1']), args: { shapes: [{ kind: pick(['box', 'lathe', 'sweep', 'unknown']), at: [0, 1, 0], size: [1, p, 1], profile: p, path: p }] } } } },
    ])] });
  }
  const before = w.snapshot();
  for (let i = 0; i < malformed.length; i++) {
    let result: ReturnType<typeof plan> | undefined;
    assert.doesNotThrow(() => { result = plan(w, malformed[i], 'fuzzer', 0); }, `case ${i}`);
    assert.ok(result);
    if (!result.ok) {
      assert.ok(result.failures.length);
      for (const f of result.failures) { assert.equal(typeof f.op, 'number'); assert.equal(typeof f.detail, 'string'); assert.ok(refusalCodes.includes(f.code as never), `case ${i}: ${f.code}`); }
    }
  }
  assert.deepEqual(w.snapshot(), before);
});
