import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { LATENCY_TEST, serverTestFiles, serverShardFiles } from './server-test-files.mjs';

test('both PR shards plus latency cover nested server tests exactly once', t => {
  const src = mkdtempSync(join(tmpdir(), 'server-ci-inventory-'));
  t.after(() => rmSync(src, { recursive: true, force: true }));
  // Create in reverse order; include directories deeper than the reported regression.
  const expected = ['z.test.ts', 'split/menu-world.test.ts', LATENCY_TEST,
    'god/read-content-binding.test.ts', 'god/nested/contract.test.ts', 'god/exact-authored-walk.test.ts', 'a.test.ts'].sort();
  for (const file of [...expected].reverse().concat('god/implementation.ts', 'god/readme.md')) {
    mkdirSync(dirname(join(src, file)), { recursive: true });
    writeFileSync(join(src, file), '');
  }
  const all = serverTestFiles(src);
  assert.deepEqual(all, expected);
  const first = serverShardFiles(all, 0), second = serverShardFiles(all, 1);
  assert.deepEqual(first, ['src/a.test.ts', 'src/god/nested/contract.test.ts', 'src/split/menu-world.test.ts']);
  assert.deepEqual(second, ['src/god/exact-authored-walk.test.ts', 'src/god/read-content-binding.test.ts', 'src/z.test.ts']);
  assert.equal(first.some(f => second.includes(f)), false, 'shards do not overlap');
  assert.deepEqual([...first, ...second, `src/${LATENCY_TEST}`].sort(), expected.map(f => `src/${f}`));
});

test('missing latency inventory, invalid shard, and empty shard fail closed', () => {
  assert.throws(() => serverShardFiles(['a.test.ts'], 0), /latency test is missing/);
  assert.throws(() => serverShardFiles([LATENCY_TEST, 'a.test.ts'], 2), /Invalid server shard/);
  assert.throws(() => serverShardFiles([LATENCY_TEST], 0), /Empty server shard/);
});
