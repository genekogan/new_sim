// node --test tools/world-launcher/handover-race.test.mjs (lane t4-mem; fake worlds on ports 6630-6633)
// A release hands a world to the next launcher only once its previous process is gone: while that pid lives it holds the
// data dir (edge-server.mjs's lock) and the next process refuses to open it ("fork refused", 3.53 legacy activate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChildPool } from './children.mjs';

const fake = new URL('./fake-world.mjs', import.meta.url).pathname;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const pools = [];
const pool = (range, env = {}, o = {}) => {
  const command = (w, port) => ({ cmd: process.execPath, args: [fake], env: { ...process.env, WORLD_KEY: w.slug, PORT: String(port), DATA_DIR: w.dataDir, FAKE_LOCK: '1', ...env } });
  const p = new ChildPool({ root: process.cwd(), range, logDir: mkdtempSync(join(tmpdir(), 't4-race-')), command, healthPath: (s) => `/w/${s}/healthz`, ...o });
  pools.push(p); return p;
};
const world = (slug) => ({ slug, dataDir: mkdtempSync(join(tmpdir(), `t4-race-${slug}-`)) });
test.after(async () => { for (const p of pools) await p.closeAll(); });

test('stop() returns only once a world that ignored SIGTERM is gone (SIGKILL, then its exit)', async () => {
  const a = pool([6630, 6631], { FAKE_STOP_MS: 'never' }, { stopGraceMs: 300 });
  await a.ensure(world('stubborn'));
  const pid = a.state('stubborn').child.pid;
  await a.stop('stubborn');
  assert.equal(alive(pid), false, 'the SIGKILLed process is gone when stop() resolves');
});

test('takeOver waits for the released process to exit before the standby opens the data', async () => {
  const w = world('slow');
  const a = pool([6630, 6631], { FAKE_STOP_MS: '700' });
  await a.ensure(w);
  const { port, child: { pid } } = a.state('slow');
  const b = pool([6632, 6633], {}, { prewarm: true });
  b.adopt(w, { port, pid, script: fake });
  // a release that answers before the process has exited (as stop() did after its SIGKILL)
  const release = async () => { a.stop('slow'); };
  const t0 = Date.now();
  assert.equal(await b.takeOver('slow', release), port);
  assert.ok(Date.now() - t0 >= 600, 'it waited for the exit');
  assert.equal(alive(pid), false);
  const k = b.state('slow');
  assert.equal(k.status, 'running');
  assert.notEqual(k.child.pid, pid);
  const r = await fetch(`http://127.0.0.1:${port}/w/slow/healthz`).then((x) => x.json());
  assert.equal(r.pid, k.child.pid, 'the new process serves, it was not refused by the lock');
});

test('a released process that never exits fails the takeover clearly and the standby is stopped', async () => {
  const w = world('stuck');
  const a = pool([6630, 6631], { FAKE_STOP_MS: 'never' });
  await a.ensure(w);
  const { port, child: { pid } } = a.state('stuck');
  const b = pool([6632, 6633], {}, { prewarm: true });
  b.adopt(w, { port, pid, script: fake });
  let stopping = null;
  const release = async () => { stopping = a.stop('stuck'); };
  await assert.rejects(b.takeOver('stuck', release, { goneMs: 400 }), /previous process of stuck \(pid \d+\) still running 0 s after its release/);
  assert.equal(b.state('stuck').status, 'failed');
  assert.ok(b.state('stuck').adopted, 'still recorded as the previous launcher\'s process');
  assert.ok(alive(pid), 'the old process is untouched');
  const standby = Number(/\[standby\] ready pid (\d+)/.exec(readFileSync(join(b.o.logDir, 'stuck.log'), 'utf8'))?.[1]);
  assert.ok(standby > 0);
  for (let i = 0; i < 40 && alive(standby); i++) await new Promise((r) => setTimeout(r, 25));
  assert.equal(alive(standby), false, 'the standby process was stopped');
  process.kill(pid, 'SIGKILL'); await stopping;
  assert.equal(alive(pid), false);
});
