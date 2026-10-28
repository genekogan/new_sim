#!/usr/bin/env node
// One bounded actual-main diagnostic: startup, idle, metadata work, idle.
// No pictures, minds, live worlds, or production configuration changes.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadavg } from 'node:os';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { freeMemGb } from '../playtest/lib/platform.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(process.argv[2]);
const port = 5981, base = `http://127.0.0.1:${port}/w/context-profile`;
const slot = '<team>/lanes/MEASURE.slot';
const started = Date.now(), deadline = started + 75000;
const claim = `${new Date(started).toISOString()} eden-query-profile pid=${process.pid} until=${new Date(deadline + 5000).toISOString()}`;
const abort = new AbortController();
const report = { source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  startedAt: new Date(started).toISOString(), runnerPid: process.pid, node: process.version,
  scriptSha256: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
  scope: 'Actual local main, existing Eden template, fake minds. Same-process temporal comparison of no context requests versus metadata requests; not randomized causal proof or rendering-capacity qualification. CPU profiling adds overhead to both phases.',
  phases: [], queries: [], contextRequests: [], health: [], cleanup: {},
  ambient: { load: loadavg(), freeGiB: freeMemGb() } };
mkdirSync(out); // Never overwrite a previous measurement.
const save = () => writeFileSync(resolve(out, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
const hashFile = path => createHash('sha256').update(readFileSync(path)).digest('hex');
let child, childExit, claimed = false, sampler, sampling = true, phase = 'boot', watchdog, killTimer;
const request = (path, options) => fetch(base + path, { ...options, signal: abort.signal });
const freePort = () => new Promise((yes, no) => {
  const server = createServer(); server.once('error', no);
  server.listen(port, '127.0.0.1', () => server.close(yes));
});
const stop = () => {
  abort.abort(new Error('diagnostic stopped'));
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    killTimer ??= setTimeout(() => child.kill('SIGKILL'), 3000);
  }
};
process.once('SIGTERM', stop); process.once('SIGINT', stop);
const runPhase = async (name, work) => {
  phase = name; const record = { name, startMs: Date.now(), startTick: report.queries.at(-1)?.tick };
  report.phases.push(record); save();
  await work(); record.endMs = Date.now(); record.endTick = report.queries.at(-1)?.tick;
  const r = await request('/healthz'); report.health.push({ phase, at: Date.now(), status: r.status, data: await r.json() }); save();
};
try {
  if (loadavg()[0] >= 10 || freeMemGb() < 6) throw Error('requires load<10 and free/reclaimable>=6GiB');
  if (!process.env.WEB_DIR) throw Error('explicit reviewed WEB_DIR required');
  report.inputs = { execPath: process.execPath, webDir: resolve(process.env.WEB_DIR),
    templateSha256: hashFile(resolve(root, 'worlds/templates/eden-2026.json')),
    gitStatus: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }) };
  if (report.inputs.gitStatus.trim()) throw Error('clean committed source required');
  const prior = readFileSync(slot, 'utf8');
  if (prior.split('\n').some(line => line.trim() && !line.startsWith('#'))) throw Error('measurement slot held');
  await freePort(); writeFileSync(slot, prior + '\n' + claim + '\n'); claimed = true;
  watchdog = setTimeout(() => { report.timeout = true; stop(); }, Math.max(1, deadline - Date.now()));
  const clockImport = 'data:text/javascript,' + encodeURIComponent('console.log(JSON.stringify({profileClock:{epochMs:Date.now(),monoUs:Number(process.hrtime.bigint()/1000n)}}));');
  child = spawn(process.execPath, ['--cpu-prof', '--cpu-prof-interval=1000', `--cpu-prof-dir=${out}`, '--cpu-prof-name=server.cpuprofile', '--import', clockImport, 'apps/server/src/main.ts'], {
    cwd: root, env: { ...process.env, SIM_CONTEXT_TIMINGS: '1', SIM_CONTEXT_TRACE: '1', HOST: '127.0.0.1', PORT: String(port),
      WORLD_KEY: 'context-profile', WORLD_ID: 'context-profile-1', WORLD_OWNER_ID: 'dev:admin', PUBLIC_URL: `http://127.0.0.1:${port}`,
      GENESIS_FILE: resolve(root, 'worlds/templates/eden-2026.json'), DATA_DIR: resolve(out, 'data'), ASSET_DIR: resolve(out, 'assets'),
      ENGINE: 'mars', DEV_AUTH: '1', AUTH_PROVIDER: 'none', SEED_NATIVES: '0', EDGE_EYES: '', BRAIN_MODE: 'fake', MIND_DRIVER: 'edge',
      INVITE_REQUIRED: '0', ARCHIVE_TAKES: '0', TAKES_PERSIST: '0', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', EDEN_GOD_NO_NPX: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  report.serverPid = child.pid;
  childExit = new Promise((yes, no) => { child.once('error', no); child.once('exit', (code, signal) => { report.serverExit = { code, signal }; yes(); }); });
  void childExit.catch(() => {}); // The awaited cleanup below records spawn errors.
  for (const stream of [child.stdout, child.stderr]) {
    let pending = '';
    stream.on('data', bytes => {
      appendFileSync(resolve(out, 'server.log'), bytes);
      pending += bytes.toString();
      if (pending.length > 1024 * 1024) { report.logOverflow = true; stop(); return; }
      for (;;) {
        const end = pending.indexOf('\n'); if (end < 0) break;
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        if (line.startsWith('{"profileClock":')) {
          try { report.profileClock = JSON.parse(line).profileClock; } catch { /* final validation fails */ }
        }
        const marker = line.indexOf('[context-job]');
        if (marker >= 0) {
          try {
            const event = JSON.parse(line.slice(marker + '[context-job]'.length).trim());
            if (event.phase === 'start') { report.unexpectedCapture = true; stop(); }
          } catch { report.invalidJobLog = true; stop(); }
        }
      }
    });
  }
  save();
  for (;;) {
    abort.signal.throwIfAborted();
    if (child.exitCode !== null) throw Error('server exited before health');
    try { if ((await request('/healthz')).ok) break; } catch { abort.signal.throwIfAborted(); }
    await delay(100, undefined, { signal: abort.signal });
  }
  sampler = (async () => {
    while (sampling && !abort.signal.aborted) {
      const begun = performance.now(), at = Date.now(), sampledPhase = phase;
      try {
        const r = await request('/v1/edge/platforms'), body = await r.json();
        report.queries.push({ phase: sampledPhase, startMs: at, endMs: Date.now(), ms: performance.now() - begun, status: r.status, tick: body.tick });
      } catch (error) { if (!abort.signal.aborted) report.queries.push({ phase: sampledPhase, at, error: String(error) }); }
      if (sampling && !abort.signal.aborted) await delay(100, undefined, { signal: abort.signal }).catch(() => {});
    }
  })();
  await runPhase('startup-settle', () => delay(8000, undefined, { signal: abort.signal }));
  await runPhase('idle-before', () => delay(8000, undefined, { signal: abort.signal }));
  let first;
  const context = async path => {
    const at = Date.now(), t = performance.now(), r = await request(path), data = await r.json();
    report.contextRequests.push({ phase, startMs: at, endMs: Date.now(), ms: performance.now() - t, status: r.status, count: data.targets?.length, total: data.total });
    if (!r.ok) throw Error(`metadata HTTP${r.status}`);
    return data;
  };
  await runPhase('context-cold', async () => { first = await context('/v1/world/context'); });
  const paths = ['/v1/world/context', '/v1/world/context?q=library', '/v1/world/context?ref=' + encodeURIComponent(first.targets[0].ref)];
  await runPhase('context-warm', async () => {
    const until = Date.now() + 8000;
    for (let i = 0; Date.now() < until; i++) { await context(paths[i % paths.length]); await delay(250, undefined, { signal: abort.signal }); }
  });
  await runPhase('idle-after', () => delay(5000, undefined, { signal: abort.signal }));
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally {
  sampling = false; stop(); await sampler;
  if (childExit) await childExit.catch(error => { report.cleanup.error = String(error); });
  if (child) {
    try {
      const path = resolve(out, 'server.cpuprofile'), profile = JSON.parse(readFileSync(path, 'utf8'));
      if (!profile.nodes?.length || !profile.samples?.length || profile.samples.length !== profile.timeDeltas?.length ||
          !Number.isFinite(profile.startTime) || !Number.isFinite(profile.endTime) || profile.endTime <= profile.startTime ||
          !Number.isFinite(report.profileClock?.epochMs) || !Number.isFinite(report.profileClock?.monoUs)) throw Error('missing or invalid CPU profile/clock');
      report.profile = { sha256: hashFile(path), samples: profile.samples.length, startTime: profile.startTime, endTime: profile.endTime };
    } catch (error) { report.profileError = String(error); process.exitCode = 1; }
  }
  clearTimeout(killTimer); clearTimeout(watchdog);
  report.cleanup.serverExited = !child || child.exitCode !== null || child.signalCode !== null;
  try { await freePort(); report.cleanup.portClosed = true; } catch { report.cleanup.portClosed = false; }
  if (claimed) writeFileSync(slot, readFileSync(slot, 'utf8').split('\n').filter(line => line !== claim).join('\n'));
  report.cleanup.slotReleased = !readFileSync(slot, 'utf8').split('\n').includes(claim);
  report.cleanup.complete = report.cleanup.serverExited && report.cleanup.portClosed && report.cleanup.slotReleased && !report.cleanup.error;
  report.finishedAt = new Date().toISOString(); report.within80s = Date.now() <= started + 80000;
  if (!report.cleanup.complete || !report.within80s || report.unexpectedCapture || report.logOverflow || report.invalidJobLog) process.exitCode = 1;
  save(); console.log(JSON.stringify({ out, error: report.error, phases: report.phases, queries: report.queries.length, cleanup: report.cleanup }));
}
