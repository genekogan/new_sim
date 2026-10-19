// Lane P5: world processes share V8's compile cache for this release (NODE_COMPILE_CACHE, one directory per build under
// <data>/compile-cache); other builds' directories are dropped once untouched for a day.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileCacheDir, defaultCommand, forkCommand } from './children.mjs';

test('compile cache: one directory per build, stale other builds dropped, recent ones kept', () => {
  const data = mkdtempSync(join(tmpdir(), 'p5-cc-')), root = join(data, 'compile-cache');
  for (const b of ['old', 'recent']) { mkdirSync(join(root, b, 'v8'), { recursive: true }); writeFileSync(join(root, b, 'v8', 'x'), 'x'); }
  const day = 86_400_000, now = Date.now();
  utimesSync(join(root, 'old'), (now - 2 * day) / 1000, (now - 2 * day) / 1000);
  const dir = compileCacheDir(data, 'abc/123 x', now);
  assert.equal(dir, join(root, 'abc_123_x'));
  assert.ok(existsSync(dir));
  assert.equal(existsSync(join(root, 'old')), false, 'a build untouched for two days is dropped');
  assert.ok(existsSync(join(root, 'recent', 'v8', 'x')), 'the previous build (a handover) keeps its cache');
  assert.equal(compileCacheDir(data, 'abc/123 x', now), dir, 'the current build is never dropped');
  assert.equal(compileCacheDir(join(data, 'nope\0'), 'b'), null, 'cannot be made: null (worlds boot as before)');
});

test('compile cache: world and fork commands carry it only when the launcher has one', () => {
  const world = { slug: 'w', name: 'W', dataDir: '/tmp/w' }, o = { publicOrigin: 'http://x' };
  assert.equal(defaultCommand(world, 1, o).env.NODE_COMPILE_CACHE, undefined);
  assert.equal(defaultCommand(world, 1, { ...o, compileCache: '/d/cc' }).env.NODE_COMPILE_CACHE, '/d/cc');
  const fork = { ...world, fork: { descriptor: '/f.json', accounts: '/a.sqlite' } }, auth = { auth: { envFile: '/e.env' } };
  assert.equal(forkCommand(fork, 1, { ...o, ...auth, compileCache: '/d/cc' }).env.NODE_COMPILE_CACHE, '/d/cc');
});
