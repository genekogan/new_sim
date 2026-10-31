// node --test tools/world-launcher/guard.test.mjs (lane L1, server-reliability tranche; fake worlds on 5101-5103, a launcher on 5110 + 5107-5108)
// The guard over world processes (LOAD-CONTRACT §4), with its numbers scaled down: a wedged world is restarted, a slow
// boot that keeps moving lives, a stuck boot is killed, a flapping world is held until resumed, exit 75 restarts at once.
// Real-time runs of (a) and (b) with the production numbers: team/scratch/srv/launcher/guard-realtime.mjs (numbers in the lane file).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChildPool, backoffMs } from './children.mjs';
import { GUARD, bootMark, jitterMs, liveWedge } from './guard.mjs';

const fake = new URL('./fake-world.mjs', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms, what) => { const t0 = Date.now(); for (;;) { const v = await f(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`not within ${ms} ms: ${what}`); await sleep(25); } };
// scaled: a look every 100 ms, wedged after 6 failed looks or a live.json 600 ms stale
const FAST = { pollMs: 100, timeoutMs: 150, failures: 6, suspectFailures: 1, liveStaleMs: 600, turnAgeMs: 600, usr2WaitMs: 100, termGraceMs: 300, bootStallMs: 600, silentBootStallMs: 600, bootSlowMs: 300, backoffBaseMs: 20, backoffCapMs: 100, resetAfterMs: 60_000, breakerN: 5, breakerWindowMs: 60_000, crashloopN: 2, wedgeShownMs: 60_000 };
const pools = [], R = [5101, 5103];   // (ceilings.test.mjs, which may run beside this file, uses 5104-5106 and 5109)
const pool = (range, env = {}, o = {}) => {
  const command = (w, port) => ({ cmd: process.execPath, args: [fake], env: { ...process.env, WORLD_KEY: w.slug, PORT: String(port), DATA_DIR: w.dataDir, FAKE_LIVE_MS: '100', FAKE_TURN_MS: '600', ...env } });
  const lines = [];
  const p = new ChildPool({ root: process.cwd(), range, logDir: mkdtempSync(join(tmpdir(), 'l1-guard-')), command, healthPath: (s) => `/w/${s}/healthz`, guard: FAST, random: () => 0.999, log: (s) => lines.push(s), ...o });
  p.lines = lines; pools.push(p); return p;
};
const world = (slug) => ({ slug, dataDir: mkdtempSync(join(tmpdir(), `l1-guard-${slug}-`)) });
const get = (port, slug, path) => fetch(`http://127.0.0.1:${port}/w/${slug}${path}`, { signal: AbortSignal.timeout(1000) }).catch(() => null);
test.after(async () => { for (const p of pools) await p.closeAll(); });

test('full-jitter backoff: uniform under min(5 min, 1 s * 2^n); defaults are the contract numbers', () => {
  assert.equal(backoffMs(0, () => 0), 0);
  assert.equal(backoffMs(0, () => 0.5), 500); assert.equal(backoffMs(3, () => 0.5), 4000);
  assert.equal(backoffMs(20, () => 0.999), 299_700, 'capped at 5 min');
  assert.equal(jitterMs(2, { backoffBaseMs: 10, backoffCapMs: 1000 }, () => 0.5), 20);
  assert.deepEqual([GUARD.pollMs, GUARD.timeoutMs, GUARD.failures, GUARD.liveStaleMs, GUARD.usr2WaitMs, GUARD.termGraceMs, GUARD.bootStallMs, GUARD.breakerN, GUARD.breakerWindowMs, GUARD.resetAfterMs], [10_000, 5_000, 6, 30_000, 5_000, 20_000, 60_000, 5, 1_800_000, 600_000]);
  const now = 1e6;
  assert.equal(liveWedge({ at: now - 1000, loop: { lastTurnAgeMs: 10 } }, now), null);
  assert.match(liveWedge({ at: now - 31_000, loop: { lastTurnAgeMs: 10 } }, now), /live.json 31 s old/);
  assert.match(liveWedge({ at: now, loop: { lastTurnAgeMs: 31_000 } }, now), /main thread stuck 31 s/);
  assert.notEqual(bootMark({ phase: 'boot:replay', boot: { stage: 'replay', tick: 1 } }), bootMark({ phase: 'boot:replay', boot: { stage: 'replay', tick: 2 } }));
});

test('(a) wedged, live.json: the watchdog shows the main thread stuck; SIGUSR2, SIGTERM, SIGKILL, restarted; problems say wedged', async () => {
  const p = pool(R, { FAKE_LIVE: '1', FAKE_STOP_MS: '50' });
  const port = await p.ensure(world('wa')); const pid = p.state('wa').child.pid;
  p.startGuard();
  await sleep(700);   // past liveStaleMs after up: live.json is judged from here
  assert.deepEqual(p.problems(), [], 'a healthy world has no problems');
  const t0 = Date.now();
  await get(port, 'wa', '/wedge');
  await until(() => p.problems().some((x) => x.code === 'wedged'), 2000, 'wedged in problems');
  await until(() => p.status('wa').status === 'running' && p.status('wa').pid !== pid, 5000, 'restarted');
  const ms = Date.now() - t0, st = p.status('wa');
  assert.equal(st.restartsByReason.wedged, 1);
  assert.match(st.lastExit.reason, /wedged: main thread stuck/);
  assert.equal(st.lastExit.signal, 'SIGKILL', 'a busy-looping main thread runs no SIGTERM handler');
  assert.ok(p.lines.some((l) => /wa wedged \(main thread stuck/.test(l)), 'one line per transition');
  assert.ok(p.problems().some((x) => x.code === 'wedged' && /was wedged/.test(x.text)), 'shown for a while after its restart');
  assert.ok(ms < 3000, `restarted ${ms} ms after the wedge`);
  await p.closeAll();
});

test('(a) wedged, no live.json (a release before the watchdog): /healthz unanswered 6 looks in a row', async () => {
  const p = pool(R);
  const port = await p.ensure(world('wb')); const pid = p.state('wb').child.pid;
  p.startGuard();
  await get(port, 'wb', '/wedge');
  await until(() => p.status('wb').status === 'running' && p.status('wb').pid !== pid, 5000, 'restarted');
  assert.match(p.status('wb').lastExit.reason, /healthz unanswered 6 times/);
  assert.equal(p.status('wb').restartsByReason.wedged, 1);
  await p.closeAll();
});

test('(a) the watchdog port (SIM_HEALTH_PORT): a second port from the range, held while the world lives, answered while main is stuck', async () => {
  const p = pool(R, { FAKE_LIVE: '1' }, { healthPorts: true, guard: { ...FAST, liveStaleMs: 60_000, turnAgeMs: 60_000 } /* only the port tells */ });
  const port = await p.ensure(world('wc')); const st = p.state('wc');
  assert.ok(st.healthPort >= R[0] && st.healthPort <= R[1] && st.healthPort !== port, `watchdog port ${st.healthPort}`); assert.ok(p.usedPorts().has(st.healthPort));
  const h = await fetch(`http://127.0.0.1:${st.healthPort}/healthz`).then((r) => r.json());
  assert.equal(h.phase, 'serving');
  const pid = st.child.pid;
  p.startGuard();
  await get(port, 'wc', '/wedge');
  await until(() => p.status('wc').status === 'running' && p.status('wc').pid !== pid, 5000, 'restarted');
  assert.match(p.status('wc').lastExit.reason, /watchdog: main thread stuck/);
  await p.closeAll();
});

test('(b) a slow boot that keeps moving is never killed; it shows as bootSlow and its boot time is kept', async () => {
  for (const [slug, env] of [['ba', { FAKE_LIVE: '1' }], ['bb', {}]]) {   // live.json boot.tick, then output lines only
    const p = pool(R, { FAKE_BOOT_MS: '2000', FAKE_BOOT_TICK_MS: '100', ...env });
    const ready = p.ensure(world(slug));
    await until(() => p.problems().some((x) => x.code === 'bootSlow'), 1500, 'bootSlow');
    if (env.FAKE_LIVE) assert.match(p.problems().find((x) => x.code === 'bootSlow').text, /replay \d+\/1000/);
    await ready;
    assert.ok(p.status(slug).lastBootMs >= 2000, `${slug} booted in ${p.status(slug).lastBootMs} ms, 3x the stall limit`);
    assert.equal(p.status(slug).restarts, 0);
    await p.closeAll();
  }
});

test('(b) a stuck boot (its progress does not move) is killed after the stall limit, and counts toward the breaker', async () => {
  const p = pool(R, { FAKE_LIVE: '1', FAKE_BOOT_STUCK: '1' });
  const t0 = Date.now();
  await assert.rejects(p.ensure(world('bs')), /boot made no progress/);
  const ms = Date.now() - t0;
  assert.ok(ms >= 600 && ms < 2000, `killed after ${ms} ms`);
  assert.equal(p.state('bs').failures.length, 1);
  await p.closeAll();
});

test('(c) a flapping world is held after 5 failures, refused while held, and resumes on command', async () => {
  const p = pool(R, { FAKE_FLAP_MS: '150' });
  await p.ensure(world('fl'));
  await until(() => p.status('fl').status === 'held', 8000, 'held');
  const st = p.status('fl');
  assert.equal(st.held.failures, 5); assert.equal(st.restartsByReason.exit, 4, 'four restarts, the fifth failure holds it');
  await assert.rejects(p.ensure(world('fl')), (e) => e.code === 'held');
  assert.ok(p.problems().some((x) => x.code === 'held' && /resume-world --slug fl/.test(x.text)));
  assert.ok(p.lines.some((l) => /fl held: 5 failures/.test(l)));
  assert.equal(p.resume('fl'), true); assert.equal(p.resume('fl'), false, 'not held any more');
  await p.ensure(world('fl'));
  assert.equal(p.status('fl').status, 'running', 'resumed: boots again');
  await p.closeAll();
});

test('exit 75 (the world asks for a planned restart): restarted at once, reason planned, never a breaker failure', async () => {
  const p = pool(R, { FAKE_PLANNED_MS: '150' });
  await p.ensure(world('pl'));
  await until(() => (p.status('pl').restartsByReason?.planned ?? 0) >= 6, 8000, 'six planned restarts');
  assert.equal(p.state('pl').failures?.length ?? 0, 0);
  assert.notEqual(p.status('pl').status, 'held');
  assert.ok(p.lines.some((l) => /pl restarts in 0\.0 s \(planned/.test(l)));
  await p.closeAll();
});

test('a frozen (asleep) world is not judged, nor for liveStaleMs after it wakes', async () => {
  const p = pool(R, { FAKE_LIVE: '1' }, { sleepMs: 50, busy: () => false });
  await p.ensure(world('fz')); const pid = p.state('fz').child.pid;
  p.startGuard();
  assert.deepEqual(p.freezeIdle(Date.now() + 100), ['fz']);
  await sleep(1200);   // live.json is 1.2 s old (its writer is stopped too): would be wedged if judged
  assert.equal(p.status('fz').pid, pid, 'not restarted while frozen');
  p.thaw(p.state('fz'));
  await sleep(300);
  assert.equal(p.status('fz').pid, pid, 'nor right after it wakes (its live.json is stale until rewritten)');
  assert.deepEqual(p.problems(), []);
  await p.closeAll();
});

test('(e) the launcher: a wedge is in /__sim/healthz (hostCodes) and world-problems.json at once; held answers 503 world.held; resume-world', async () => {
  const { openLauncher } = await import('./launcher.mjs');
  const { evaluate, readWorldProblems } = await import('./deploy/host-health.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'l1-guard-l-'));
  const templatesDir = join(dir, 'templates'); mkdirSync(templatesDir);
  const webDir = join(dir, 'web'); mkdirSync(webDir); writeFileSync(join(webDir, 'index.html'), '<!doctype html>');
  const flap = new Set();
  const command = (w, port) => ({ cmd: process.execPath, args: [fake], env: { ...process.env, WORLD_KEY: w.slug, PORT: String(port), DATA_DIR: w.dataDir, ...(flap.has(w.slug) ? { FAKE_FLAP_MS: '150' } : {}) } });
  const P = 5110, base = `http://127.0.0.1:${P}`, lines = [];
  const L = await openLauncher({ port: P, range: [5107, 5108], dataDir: join(dir, 'data'), webDir, templatesDir, command, eager: 0, log: (s) => lines.push(s), prewarm: false, publicOrigin: 'http://sim.test', devAuth: true, guard: FAST, problemsEveryMs: 100 });
  const health = () => fetch(`${base}/__sim/healthz`).then((r) => r.json());
  try {
    const { slug } = await (await fetch(`${base}/__sim/worlds`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Ledge' }) })).json();
    const h0 = await health(); assert.equal(h0.hostOk, undefined, 'no host-health file and no problems: nothing claimed');
    const pid = L.pool.status(slug).pid, t0 = Date.now();
    await fetch(`${base}/w/${slug}/wedge`);
    const h1 = await until(async () => { const h = await health(); return h.hostCodes?.includes('wedged') ? h : null; }, 3000, 'wedged in healthz');
    const seen = Date.now() - t0;
    assert.equal(h1.hostOk, false); assert.match(h1.worldProblems.find((x) => x.code === 'wedged').text, new RegExp(slug));
    await until(() => readWorldProblems(join(dir, 'data')).some((x) => x.code === 'wedged'), 2000, 'world-problems.json');
    const host = evaluate({ diskTotalBytes: 100e9, diskFreeBytes: 50e9, memMb: 8000, worldProblems: readWorldProblems(join(dir, 'data')) });
    assert.equal(host.ok, false); assert.ok(host.codes.includes('wedged'), 'host-health.mjs carries the code');
    await until(() => L.pool.status(slug).status === 'running' && L.pool.status(slug).pid !== pid, 5000, 'restarted');
    assert.ok(lines.some((l) => l.includes(`world ${slug} wedged`)));
    console.log(`# (e) scaled: wedge in healthz after ${seen} ms`);
    // flapping: held, then the proxy answers at once with 503 world.held, and resume-world boots it again
    flap.add(slug); await L.pool.stop(slug); L.pool.kids.get(slug).stopped = false;
    await fetch(`${base}/w/${slug}/healthz`);
    await until(() => L.pool.status(slug).status === 'held', 8000, 'held');
    const r = await fetch(`${base}/w/${slug}/v1/edge/here`, { headers: { authorization: 'Bearer sim_s_x_y' } });
    assert.equal(r.status, 503); assert.equal((await r.json()).code, 'world.held'); assert.ok(Number(r.headers.get('retry-after')) > 0);
    assert.ok((await health()).hostCodes.includes('held'));
    flap.delete(slug);
    const op = (name, body) => fetch(`${base}/__sim/op/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const res = await op('resume-world', { slug }); assert.equal(res.status, 200); assert.equal((await res.json()).was.failures, 5);
    assert.equal((await op('resume-world', { slug })).status, 409);
    assert.equal((await fetch(`${base}/w/${slug}/healthz`)).status, 200, 'resumed: the next visit boots it');
  } finally { await L.close(); }
});

test('watchdog ports across a handover: an adopted world keeps its port, held from every other world here, passed on again', async () => {
  const p = pool(R, {}, { healthPorts: true });
  p.adopt(world('ho'), { port: 5101, pid: 999_999, script: 'x', healthPort: 5103 });
  assert.ok(p.usedPorts().has(5101) && p.usedPorts().has(5103), 'both of the previous process\'s ports are held');
  const port = await p.ensure(world('other'));
  assert.equal(port, 5102); assert.equal(p.state('other').healthPort, null, 'no third port: runs without one');
  assert.ok(p.lines.some((l) => /world other: no free watchdog port in 5101-5103; liveness from live.json and the main \/healthz only/.test(l)), 'the degraded mode is said once');
  assert.match(p.status('other').watchdog, /none/);
  assert.equal(p.status('ho').healthPort, 5103);
  p.kids.delete('ho');
  await p.closeAll();
});
