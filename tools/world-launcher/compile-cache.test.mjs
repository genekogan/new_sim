// Lane P5: world processes share V8's compile cache for this release (NODE_COMPILE_CACHE, one directory per build under
// <data>/compile-cache); other builds' directories are dropped once untouched for a day.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
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
  assert.deepEqual(defaultCommand(world, 1, o).args, ['apps/server/src/main.ts'], 'no cache: no strip cache either');
  assert.deepEqual(defaultCommand(world, 1, { ...o, compileCache: '/d/cc' }).args, ['--import', './apps/server/src/strip-cache.mjs', 'apps/server/src/main.ts'], 'lane BOOT2');
  // a release that does not ship the hook (the keeper's test releases, an older tree) boots without it, never a failed import
  assert.deepEqual(defaultCommand(world, 1, { ...o, compileCache: '/d/cc', root: mkdtempSync(join(tmpdir(), 'boot2-nohook-')) }).args, ['apps/server/src/main.ts'], 'no hook in the release: plain boot');
  const fork = { ...world, fork: { descriptor: '/f.json', accounts: '/a.sqlite' } }, auth = { auth: { envFile: '/e.env' } };
  assert.equal(forkCommand(fork, 1, { ...o, ...auth, compileCache: '/d/cc' }).env.NODE_COMPILE_CACHE, '/d/cc');
});

// Lane BOOT2: the stripped TypeScript is kept per build under <cache>/ts-strip-1 and read back on the next boot, the same
// bytes Node's own strip makes; a TypeScript-only construct is still refused as without the hook.
test('strip cache: a second boot reads the stripped text back, byte for byte Node\'s own strip', { skip: typeof stripTypeScriptTypes !== 'function' }, () => {
  const d = mkdtempSync(join(tmpdir(), 'boot2-strip-')), cc = join(d, 'cc'), src = 'const n: number = 41;\nexport const answer = (x: number): number => x + n + 0;\nconsole.log(answer(1));\n';
  writeFileSync(join(d, 'm.ts'), src);
  const hook = fileURLToPath(new URL('../../apps/server/src/strip-cache.mjs', import.meta.url));
  const run = () => spawnSync(process.execPath, ['--no-warnings', '--import', hook, join(d, 'm.ts')], { env: { ...process.env, NODE_COMPILE_CACHE: cc }, encoding: 'utf8' });
  const a = run();
  assert.equal(a.status, 0, a.stderr); assert.equal(a.stdout.trim(), '42');
  const files = readdirSync(join(cc, 'ts-strip-1'));
  assert.equal(files.length, 1);
  assert.equal(readFileSync(join(cc, 'ts-strip-1', files[0]), 'utf8'), stripTypeScriptTypes(src, { mode: 'strip' }));
  writeFileSync(join(cc, 'ts-strip-1', files[0]), 'console.log("from the cache")');
  assert.equal(run().stdout.trim(), 'from the cache', 'the second boot reads the cache');
  writeFileSync(join(d, 'e.ts'), 'enum E { A }\nconsole.log(E.A);\n');
  const e = spawnSync(process.execPath, ['--no-warnings', '--import', hook, join(d, 'e.ts')], { env: { ...process.env, NODE_COMPILE_CACHE: cc }, encoding: 'utf8' });
  assert.notEqual(e.status, 0, 'an enum still needs --experimental-transform-types');
});
