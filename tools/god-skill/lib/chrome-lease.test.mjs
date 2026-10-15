import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromeLease } from './chrome-lease.mjs';

// Every lease lives under a unique test directory, never the machine-wide lease.
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'god-chrome-lease-')), leaseDir = join(dir, 'lease');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, leaseDir, options: { leaseDir, waitMs: -1 } };
}
const holder = (pid, label = 'previous lane') => `${label} ${pid} 2026-10-15T12:00:00.000Z\n`;
function occupied(leaseDir, text, ageMs = 0) {
  mkdirSync(leaseDir);
  if (text !== undefined) writeFileSync(join(leaseDir, 'holder'), text);
  const at = new Date(Date.now() - ageMs);
  utimesSync(leaseDir, at, at);
}
function exitedPid() {
  const child = spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' });
  assert.equal(child.status, 0);
  assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  return child.pid;
}

test('Chrome lease acquisition and idempotent release use only the supplied directory', async t => {
  const { leaseDir, options } = fixture(t), listeners = process.listenerCount('exit');
  const release = await chromeLease('test lane', options);
  t.after(release);
  assert.equal(JSON.parse(readFileSync(join(leaseDir, 'holder'), 'utf8')).holder.label, 'test lane');
  assert.equal(process.listenerCount('exit'), listeners + 1);
  release(); release();
  assert.equal(existsSync(leaseDir), false);
  assert.equal(process.listenerCount('exit'), listeners);
});

test('a freshly abandoned Chrome lease is reclaimed as soon as its PID is dead', async t => {
  const { leaseDir, options } = fixture(t);
  occupied(leaseDir, holder(exitedPid()));
  const release = await chromeLease('resumed lane', options);
  t.after(release);
  assert.equal(JSON.parse(readFileSync(join(leaseDir, 'holder'), 'utf8')).holder.pid, process.pid);
});

test('a live PID keeps its Chrome lease even after the stale threshold', async t => {
  const { leaseDir, options } = fixture(t), text = holder(process.pid);
  occupied(leaseDir, text, 16 * 60_000);
  await assert.rejects(chromeLease('other lane', options), /chrome lease busy/);
  assert.equal(readFileSync(join(leaseDir, 'holder'), 'utf8'), text);
});

test('EPERM and other uncertain PID probes never evict an old Chrome lease', async t => {
  const { leaseDir, options } = fixture(t), text = holder(process.pid);
  occupied(leaseDir, text, 16 * 60_000);
  for (const code of ['EPERM', 'EACCES']) {
    const mock = t.mock.method(process, 'kill', () => { throw Object.assign(new Error('probe denied'), { code }); });
    await assert.rejects(chromeLease('other lane', options), /chrome lease busy/);
    assert.equal(readFileSync(join(leaseDir, 'holder'), 'utf8'), text);
    mock.mock.restore();
  }
});

test('a missing or malformed fresh Chrome holder keeps the 30-second grace period', async t => {
  const { leaseDir, options } = fixture(t);
  occupied(leaseDir);
  await assert.rejects(chromeLease('other lane', options), /chrome lease busy/);
  assert.ok(existsSync(leaseDir));
  writeFileSync(join(leaseDir, 'holder'), 'incomplete holder\n');
  await assert.rejects(chromeLease('other lane', options), /chrome lease busy/);
  assert.equal(readFileSync(join(leaseDir, 'holder'), 'utf8'), 'incomplete holder\n');
});

test('an unreadable Chrome holder expires after the TTL', async t => {
  const { leaseDir, options } = fixture(t);
  occupied(leaseDir);
  mkdirSync(join(leaseDir, 'holder')); // readFile fails on every platform, including root.
  await assert.rejects(chromeLease('other lane', options), /chrome lease busy/);
  assert.ok(existsSync(join(leaseDir, 'holder')));
  const old = new Date(Date.now() - 16 * 60_000);
  utimesSync(leaseDir, old, old);
  const release = await chromeLease('resumed lane', options);
  t.after(release);
  assert.equal(JSON.parse(readFileSync(join(leaseDir, 'holder'), 'utf8')).holder.label, 'resumed lane');
});

test('an old Chrome lease with no holder can still be reclaimed', async t => {
  const { leaseDir, options } = fixture(t);
  occupied(leaseDir, undefined, 16 * 60_000);
  const release = await chromeLease('resumed lane', options);
  t.after(release);
  assert.equal(JSON.parse(readFileSync(join(leaseDir, 'holder'), 'utf8')).holder.label, 'resumed lane');
});

test('Chrome lease reclamation re-reads and preserves a replacement holder', async t => {
  const { leaseDir, options } = fixture(t), pid = exitedPid(), replacement = holder(process.pid, 'new lane');
  occupied(leaseDir, holder(pid));
  const kill = process.kill;
  t.mock.method(process, 'kill', (target, signal) => {
    if (target !== pid) return kill(target, signal);
    writeFileSync(join(leaseDir, 'holder'), replacement);
    throw Object.assign(new Error('dead'), { code: 'ESRCH' });
  });
  await assert.rejects(chromeLease('other lane', options), /chrome lease busy/);
  assert.equal(readFileSync(join(leaseDir, 'holder'), 'utf8'), replacement);
});

test('Chrome lease reclamation preserves a replacement directory even with identical holder bytes', async t => {
  const { dir, leaseDir, options } = fixture(t), text = holder(process.pid);
  occupied(leaseDir, text);
  let probes = 0;
  t.mock.method(process, 'kill', () => {
    if (probes++) return true;
    renameSync(leaseDir, join(dir, 'previous-lease'));
    occupied(leaseDir, text);
    throw Object.assign(new Error('dead'), { code: 'ESRCH' });
  });
  await assert.rejects(chromeLease('other lane', options), /chrome lease busy/);
  assert.equal(readFileSync(join(leaseDir, 'holder'), 'utf8'), text);
  assert.ok(existsSync(join(dir, 'previous-lease')));
  assert.ok(probes >= 2);
});

test('Chrome lease release never removes a changed holder', async t => {
  const { leaseDir, options } = fixture(t);
  const release = await chromeLease('first lane', options);
  t.after(release);
  const text = holder(process.pid, 'replacement lane');
  writeFileSync(join(leaseDir, 'holder'), text);
  release();
  assert.equal(readFileSync(join(leaseDir, 'holder'), 'utf8'), text);
});

test('contending Chrome lease callers still have exactly one winner', async t => {
  const { leaseDir, options } = fixture(t);
  occupied(leaseDir, holder(exitedPid()));
  const results = await Promise.allSettled([chromeLease('one', options), chromeLease('two', options)]);
  const acquired = results.filter(r => r.status === 'fulfilled');
  for (const r of acquired) t.after(r.value);
  assert.equal(acquired.length, 1);
  assert.match(results.find(r => r.status === 'rejected').reason.message, /chrome lease busy/);
});
