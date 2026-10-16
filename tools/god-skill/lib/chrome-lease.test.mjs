import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromeLease, chromeSlotCount, chromeSlotDirs } from './chrome-lease.mjs';

// Every lease lives under a unique test directory, never the machine-wide lease. The single-directory contract is
// tested with one slot; the slot tests below use the machine's default of three.
function fixture(t, slots = 1) {
  const dir = mkdtempSync(join(tmpdir(), 'god-chrome-lease-')), leaseDir = join(dir, 'lease');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, leaseDir, options: { leaseDir, waitMs: -1, slots } };
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

// R2F: one slot made a release walk's look wait 701 s behind other lanes. The team's slot scheme
// (<team>/ops/chrome-lease.mjs): slot 0 is the old directory, slot i is `<dir>.<i>`, CHROME_LEASE_SLOTS (3).
test('slot directories and count follow the team scheme; a bad CHROME_LEASE_SLOTS keeps three', () => {
  assert.deepEqual(chromeSlotDirs('/tmp/eden-chrome-lease', 3), ['/tmp/eden-chrome-lease', '/tmp/eden-chrome-lease.1', '/tmp/eden-chrome-lease.2']);
  assert.deepEqual(chromeSlotDirs(), ['/tmp/eden-chrome-lease', '/tmp/eden-chrome-lease.1', '/tmp/eden-chrome-lease.2'].slice(0, chromeSlotCount()));
  assert.equal(chromeSlotCount({}), 3);
  for (const [v, n] of [['1', 1], ['5', 5], ['0', 3], ['-2', 3], ['2.5', 3], ['many', 3], ['99', 16]]) assert.equal(chromeSlotCount({ CHROME_LEASE_SLOTS: v }), n, v);
});

test('three looks hold three slots at once; a fourth waits for the first free slot and each release frees only its own', async t => {
  const { leaseDir, options } = fixture(t, 3), dirs = chromeSlotDirs(leaseDir, 3);
  const held = [await chromeLease('look a', options), await chromeLease('look b', options), await chromeLease('look c', options)];
  for (const r of held) t.after(r);
  assert.deepEqual(held.map(r => r.dir), dirs);
  for (const [i, dir] of dirs.entries()) assert.equal(JSON.parse(readFileSync(join(dir, 'holder'), 'utf8')).holder.label, `look ${'abc'[i]}`);
  const busy = await chromeLease('look d', options).catch(e => e);
  assert.equal(busy.code, 'lock.busy'); assert.match(busy.message, /^chrome lease busy: all 3 slots held \(.*look a.*look b.*look c.*\); run doctor$/); assert.equal(busy.locks.length, 3);
  const waiting = chromeLease('look d', { ...options, waitMs: 5000 });
  await new Promise(r => setTimeout(r, 50)); held[1]();
  const fourth = await waiting; t.after(fourth);
  assert.equal(fourth.dir, dirs[1]); assert.ok(existsSync(dirs[0]) && existsSync(dirs[2]));
  held[0](); assert.equal(existsSync(dirs[0]), false); assert.ok(existsSync(dirs[1]) && existsSync(dirs[2]));
});

test('a team-lease holder (plain text) in a slot is respected while alive and reclaimed once dead; other slots still serve', async t => {
  const { leaseDir, options } = fixture(t, 2), [zero, one] = chromeSlotDirs(leaseDir, 2);
  occupied(zero, holder(process.pid, 'team lane'));
  const release = await chromeLease('god look', options); t.after(release);
  assert.equal(release.dir, one); assert.equal(readFileSync(join(zero, 'holder'), 'utf8'), holder(process.pid, 'team lane'));
  release(); rmSync(zero, { recursive: true }); occupied(zero, holder(exitedPid(), 'team lane'));
  const next = await chromeLease('god look', options); t.after(next);
  assert.equal(next.dir, zero, 'a dead holder of slot 0 is reclaimed first');
});

test('machine-wide: of four processes taking a lease at once, exactly three hold one', { timeout: 15_000 }, async t => {
  const { leaseDir } = fixture(t, 3), url = new URL('./chrome-lease.mjs', import.meta.url).href;
  const script = `import {chromeLease} from ${JSON.stringify(url)}; console.log('ready'); process.stdin.once('data', async () => { try { const r = await chromeLease('p'+process.pid, {leaseDir:${JSON.stringify(leaseDir)}, slots:3, waitMs:-1}); console.log('won ' + r.dir); } catch (e) { console.log(e.code); } process.stdin.once('end', () => process.exit(0)); });`;
  const kids = Array.from({ length: 4 }, () => { const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['pipe', 'pipe', 'pipe'] }); t.after(() => child.kill('SIGKILL')); return { child, ready: once(child.stdout, 'data'), exited: once(child, 'exit') }; });
  await Promise.all(kids.map(k => k.ready));
  const replies = kids.map(k => once(k.child.stdout, 'data').then(([b]) => String(b).trim()));
  for (const k of kids) k.child.stdin.write('go');
  const results = await Promise.all(replies);
  assert.equal(results.filter(r => r.startsWith('won')).length, 3, results.join(', ')); assert.equal(results.filter(r => r === 'lock.busy').length, 1);
  assert.equal(new Set(results.filter(r => r.startsWith('won'))).size, 3, 'three different slots');
  for (const k of kids) k.child.stdin.end();
  await Promise.all(kids.map(k => k.exited));
  assert.ok(chromeSlotDirs(leaseDir, 3).every(d => !existsSync(d)), 'normal exit frees every slot');
});

test('three looks render at once, the fourth waits inside its deadline for a freed slot', { timeout: 10_000 }, async t => {
  const { dir, leaseDir } = fixture(t, 3), { shoot } = await import('./look.mjs');
  let launching = 0, most = 0, open; const gate = new Promise(r => { open = r; });
  const pw = { chromium: { launch: async () => { most = Math.max(most, ++launching); if (launching === 3) open(); await gate; launching--; throw new Error('test browser'); } } };
  const lease = (label, o) => chromeLease(label, { ...o, leaseDir, slots: 3 });
  const shots = Array.from({ length: 4 }, (_, i) => shoot({ worldUrl: 'http://127.0.0.1:5369', eye: [1, 1, 1], at: [0, 0, 0], out: join(dir, `shot-${i}.png`), timeoutMs: 15_000 }, { pw, lease, load: () => ({}) }).catch(e => e.message)); // no token: the remote fallback never calls out
  const results = await Promise.all(shots);
  assert.equal(most, 3, 'three browsers at once, never four'); assert.ok(results.every(m => /cannot start Chrome \(test browser\)/.test(m)), results.join(' | '));
  assert.ok(chromeSlotDirs(leaseDir, 3).every(d => !existsSync(d)));
});
