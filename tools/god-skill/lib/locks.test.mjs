import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireLock, breakLock, holder, inspectLock, lockStatus } from './locks.mjs';
import { localDoctor } from './doctor.mjs';
const moduleUrl = new URL('./locks.mjs', import.meta.url).href;
const fixture = t => { const d = mkdtempSync(join(tmpdir(), 'eden-lock-test-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
test('holder records host and process start; PID recycling cannot keep a lock', t => {
  const d = fixture(t), path = join(d, 'lock'), release = acquireLock(path); t.after(release);
  const record = JSON.parse(readFileSync(join(path, 'holder')));
  assert.ok(record.holder.host && record.holder.start); assert.equal(inspectLock(path).liveness, 'alive');
  writeFileSync(join(path, 'holder'), JSON.stringify({ ...record, holder: { ...record.holder, start: 'a previous process' } }));
  assert.equal(inspectLock(path).reason, 'recycled'); assert.equal(breakLock(path), true);
});
test('remote/unknown holders use TTL and live local holders stay protected', () => {
  assert.equal(lockStatus({ ...holder(), host: 'another-host' }, 1, 100, 102).stale, true);
  assert.equal(lockStatus({ ...holder(), host: 'another-host' }, 100, 100, 102).stale, false);
  assert.equal(lockStatus(holder(), 1, 100, Date.now()).stale, false);
});
test('doctor fixes stale local ownership but preserves live locks, step state and credentials', t => {
  const d = fixture(t), file = join(d, '.eden-god.json');
  writeFileSync(file, JSON.stringify({ token: 'TEST_SECRET_DO_NOT_PRINT', build: { id: 'church', n: 2, lease: 'l_12345678' } }));
  const path = file + '.lock', live = acquireLock(path); t.after(live);
  let rows = localDoctor({ cwd: d, chrome: join(d, 'chrome'), fix: true });
  assert.equal(rows.find(r => r.path === path).stale, false); assert.ok(existsSync(path));
  live(); mkdirSync(path); writeFileSync(join(path, 'holder'), JSON.stringify({ schema: 'eden-lock/1', holder: { ...holder(), start: 'recycled' }, heartbeatAt: Date.now(), ttlMs: 30_000 }));
  rows = localDoctor({ cwd: d, chrome: join(d, 'chrome'), fix: true });
  assert.equal(rows.find(r => r.path === path).fixed, true); assert.ok(existsSync(file));
  assert.doesNotMatch(JSON.stringify(rows), /TEST_SECRET|l_12345678/);
});
// Kill after acquisition at the actual lock boundaries, without Chrome, real minds or fixed external ports.
for (const stage of ['look', 'verify', 'batch', 'claim', 'done']) test(`kill -9 during ${stage}: next command reclaims in under 60 s`, async t => {
  const dir = fixture(t), path = join(dir, stage === 'look' ? 'chrome' : '.eden-god.json.lock');
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import {acquireLock} from ${JSON.stringify(moduleUrl)}; acquireLock(${JSON.stringify(path)}, {label:${JSON.stringify(stage)}}); console.log('held'); setInterval(()=>{},1000);`], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_USE_SYSTEM_CA: '' } });
  t.after(() => child.kill('SIGKILL'));
  await once(child.stdout, 'data');
  assert.equal(inspectLock(path).stale, false);
  child.kill('SIGKILL'); await once(child, 'exit');
  const started = Date.now(), release = acquireLock(path, { label: 'recovery' });
  assert.ok(Date.now() - started < 60_000); release(); assert.equal(existsSync(path), false);
});
test('normal exit releases ownership', async t => {
  const path = join(fixture(t), 'normal');
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import {acquireLock} from ${JSON.stringify(moduleUrl)}; acquireLock(${JSON.stringify(path)});`], { env: { ...process.env, NODE_USE_SYSTEM_CA: '' } });
  await once(child, 'exit'); assert.equal(existsSync(path), false);
});
test('heartbeat refreshes unknown-host TTL and release removes the refreshed owner', async t => {
  const path = join(fixture(t), 'heartbeat'), release = acquireLock(path, { ttlMs: 30 }); t.after(release);
  const at = JSON.parse(readFileSync(join(path, 'holder'))).heartbeatAt;
  await new Promise(r => setTimeout(r, 55));
  const record = JSON.parse(readFileSync(join(path, 'holder')));
  assert.ok(record.heartbeatAt > at); release(); assert.equal(existsSync(path), false);
});
// R2F review: the team's Chrome lease (team/ops/chrome-lease.mjs) breaks a slot whose directory mtime is 15 minutes old,
// and an in-place holder write does not change it; the heartbeat touches the directory, and release still owns it.
test('heartbeat refreshes the lock directory mtime too, without losing its own identity', async t => {
  const path = join(fixture(t), 'dir-beat'), release = acquireLock(path, { ttlMs: 30 }); t.after(release);
  const born = statSync(path).mtimeMs;
  await new Promise(r => setTimeout(r, 60));
  const beat = statSync(path).mtimeMs; assert.ok(beat - born >= 20, `directory mtime moved ${beat - born} ms`);
  assert.ok(Date.now() - beat < 1000, 'the team lease sees a fresh directory');
  release(); assert.equal(existsSync(path), false, 'release still recognises its own touched directory');
});
test('detail: false reports a busy lock without probing its holder again', t => {
  const path = join(fixture(t), 'quiet'), release = acquireLock(path); t.after(release);
  assert.throws(() => acquireLock(path, { detail: false }), e => e.code === 'lock.busy' && e.lock.holder === null && e.lock.reason === 'held');
  assert.throws(() => acquireLock(path), e => e.code === 'lock.busy' && e.lock.holder.pid === process.pid && e.lock.liveness === 'alive');
});
test('malformed lock timing cannot suppress stale recovery forever', t => {
  const path = join(fixture(t), 'malformed'); mkdirSync(path);
  writeFileSync(join(path, 'holder'), JSON.stringify({ heartbeatAt: Date.now() - 31_000, ttlMs: 'corrupt' }));
  assert.equal(inspectLock(path).stale, true); assert.equal(breakLock(path), true);
});
test('cross-process stale recovery admits exactly one owner', { timeout: 10_000 }, async t => {
  const path = join(fixture(t), 'contended'); mkdirSync(path);
  writeFileSync(join(path, 'holder'), JSON.stringify({ holder: { ...holder(), host: 'old-host' }, heartbeatAt: 0, ttlMs: 1 }));
  const clients = Array.from({ length: 8 }, () => {
    const script = `import {acquireLock} from ${JSON.stringify(moduleUrl)}; console.log('ready'); process.stdin.once('data',()=>{try{const release=acquireLock(${JSON.stringify(path)}); console.log('won'); process.stdin.once('end',()=>{release();process.exit(0);});}catch(e){console.log(e.code);process.exit(0);}});`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['pipe', 'pipe', 'pipe'] });
    t.after(() => child.kill('SIGKILL'));
    const ready = once(child.stdout, 'data'); const exited = once(child, 'exit');
    return { child, ready, exited };
  });
  await Promise.all(clients.map(c => c.ready));
  const replies = clients.map(c => once(c.child.stdout, 'data').then(([chunk]) => String(chunk).trim()));
  for (const c of clients) c.child.stdin.write('go');
  const results = await Promise.all(replies);
  assert.equal(results.filter(s => s === 'won').length, 1, results.join(', '));
  assert.ok(results.every(s => ['won', 'lock.busy'].includes(s)));
  for (const c of clients) c.child.stdin.end();
  await Promise.all(clients.map(c => c.exited));
});
