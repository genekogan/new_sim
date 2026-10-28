#!/usr/bin/env node
// Root release-owner only. Staging is separate; this creates two disposable units,
// never edits/restarts production units, and issues no production Soul requests.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, realpathSync, readdirSync, readlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';
import { genesis } from './fixture.mjs';

const exec = promisify(execFile), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const cfg = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 0, 'root release owner must supervise transient units');
assert.equal(realpathSync(cfg.root), root);
assert.match(cfg.runId, /^[a-z0-9-]{6,40}$/); assert.match(cfg.sourceSha, /^[a-f0-9]{40}$/);
for (const name of ['out', 'webDir', 'chrome', 'browserPath', 'eyesPackage', 'lockDir', 'node', 'sourceReceipt']) assert.ok(typeof cfg[name] === 'string' && cfg[name].startsWith('/'), name);
assert.ok(resolve(cfg.out) === cfg.out && cfg.out.startsWith('/srv/sim-preflight/') && !existsSync(cfg.out), 'fresh canonical isolated evidence directory required');
assert.ok(cfg.lockDir === '/srv/sim-render-locks', 'real host-shared architectural lock required');
assert.equal(hash(readFileSync(cfg.sourceReceipt)), cfg.sourceReceiptSha256, 'root-reviewed staging receipt');
assert.equal(hash(readFileSync(resolve(root, 'pnpm-lock.yaml'))), cfg.lockSha256);
assert.ok(existsSync(resolve(root, 'node_modules/.modules.yaml')), 'offline candidate dependencies must already exist');
assert.ok(existsSync(cfg.chrome) && existsSync(resolve(cfg.webDir, 'context-view.html')) && existsSync(cfg.eyesPackage));
assert.ok(Array.isArray(cfg.productionUnits) && cfg.productionUnits.length === 2 && new Set(cfg.productionUnits).size === 2 && cfg.productionUnits.every(name => /^(sim-worlds|sim-old)@[a-z0-9-]+\.service$/.test(name)), 'two root-verified existing unit names');
const eyesUrl = new URL(cfg.productionEyesStatus);
assert.ok(['127.0.0.1', 'localhost'].includes(eyesUrl.hostname) && eyesUrl.protocol === 'http:' && !eyesUrl.username && !eyesUrl.password);
assert.ok(eyesUrl.pathname.endsWith('/w/eden-2026/v1/edge/view/status') && !eyesUrl.search && !eyesUrl.hash);

const began = Date.now(), deadline = began + 180000, abort = new AbortController();
const units = ['a', 'b'].map((role, index) => ({ role, name: `sim-context-preflight-${cfg.runId}-${role}.service`, port: 5986 + index,
  directory: resolve(cfg.out, role), base: `http://127.0.0.1:${5986 + index}/w/context-linux-${role}` }));
const report = { schema: 'linux-context-preflight/1', source: cfg.sourceSha, stagingReceiptSha256: cfg.sourceReceiptSha256,
  startedAt: new Date(began).toISOString(), runnerPid: process.pid, node: process.version, inputs: cfg, checks: [], samples: [], queries: [], cleanup: {},
  limits: { workMs: 180000, cleanupMs: 10000, contextStarts: 4, contextPngs: 2, isolatedEyesFrames: 1 },
  scope: 'Two small isolated candidate main processes in separate systemd PrivateTmp sandboxes. Direct one-frame fixture EyesWorker plus observation-only production Eden Eyes. No live Soul requests; no full-world throughput or invoice claim.' };
mkdirSync(cfg.out); const save = () => writeFileSync(resolve(cfg.out, 'receipt.json'), JSON.stringify(report, null, 2));
const check = (name, truth, data) => { report.checks.push({ name, pass: !!truth, data }); save(); assert.ok(truth, name); };
const systemctl = (...args) => exec('systemctl', args, { timeout: 2500, maxBuffer: 1024 * 1024 });
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
const events = unit => {
  const path = resolve(unit.directory, 'events.jsonl'); if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8'); return text.slice(0, text.lastIndexOf('\n') + 1).split('\n').filter(Boolean).map(JSON.parse);
};
const request = (url, body) => fetch(url, { method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]),
  ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
const json = async (url, body) => { const r = await request(url, body); assert.equal(r.status, 200, `${new URL(url).pathname}: HTTP${r.status}`); return r.json(); };
const portFree = port => new Promise((yes, no) => { const s = createServer(); s.once('error', no); s.listen(port, '127.0.0.1', () => s.close(yes)); });
const until = async predicate => { for (;;) { abort.signal.throwIfAborted(); const value = await predicate(); if (value) return value; await delay(75, undefined, { signal: abort.signal }); } };
const cgroup = async unit => {
  const path = (await systemctl('show', unit, '--property=ControlGroup', '--value')).stdout.trim();
  assert.ok(path.startsWith('/') && !path.includes('..') && path !== '/', 'exact service cgroup'); return '/sys/fs/cgroup' + path;
};
const counters = path => {
  const read = name => readFileSync(resolve(path, name), 'utf8').trim();
  const fields = name => Object.fromEntries(read(name).split('\n').map(line => { const [key, value] = line.split(' '); return [key, Number(value)]; }));
  const pids = read('cgroup.procs').split('\n').filter(Boolean).map(Number);
  const processes = pids.flatMap(pid => { try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8'), tail = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return [{ pid, startTicks: tail[19], executable: readlinkSync(`/proc/${pid}/exe`), rssPages: Number(tail[21]) }];
  } catch { return []; } });
  return { bytes: Number(read('memory.current')), peakBytes: Number(read('memory.peak')), memoryEvents: fields('memory.events'), cpu: fields('cpu.stat'), processes };
};
const available = () => Number(/^MemAvailable:\s+(\d+) kB$/m.exec(readFileSync('/proc/meminfo', 'utf8'))?.[1]) * 1024;
let monitoring = false, monitor, queryMonitor, baselineEyes, baselineProduction, failure, closing = false;
const fail = error => { failure ??= String(error); abort.abort(Error(failure)); };
const emergencyStop = () => { fail('parent signal'); for (const unit of units.filter(u => u.admitted)) void systemctl('stop', '--no-block', unit.name).catch(() => {}); };
process.once('SIGTERM', emergencyStop); process.once('SIGINT', emergencyStop);
const timer = setTimeout(() => fail('180-second work deadline'), 180000);
try {
  check('at least6GiB available before admission', available() >= 6 * 1024 ** 3, { availableBytes: available() });
  baselineEyes = await json(eyesUrl.href); check('existing production Eden Eyes ready', baselineEyes.eyes?.state === 'ready', baselineEyes);
  baselineProduction = [];
  for (const name of cfg.productionUnits) { const path = await cgroup(name); baselineProduction.push({ name, path, before: counters(path) }); }
  report.productionBefore = baselineProduction; report.eyesBefore = baselineEyes; save();
  for (const unit of units) {
    await portFree(unit.port);
    const prior = await systemctl('show', unit.name, '--property=LoadState', '--value').catch(error => {
      if (error.stdout?.trim() === 'not-found') return { stdout: error.stdout };
      throw error;
    });
    assert.equal(prior.stdout.trim(), 'not-found', 'never reuse another unit');
    mkdirSync(unit.directory); writeFileSync(resolve(unit.directory, 'genesis.json'), JSON.stringify(genesis));
    const workerConfig = { ...cfg, ...unit, genesis: resolve(unit.directory, 'genesis.json'), deadline };
    writeFileSync(resolve(unit.directory, 'worker.json'), JSON.stringify(workerConfig));
    await exec('chown', ['-R', 'simworlds:simworlds', unit.directory], { timeout: 2000 });
    unit.admitted = true; // Cleanup also covers an ambiguous systemd-run response.
    await exec('systemd-run', ['--quiet', '--unit=' + unit.name, '--uid=simworlds', '--gid=simworlds',
      '--property=WorkingDirectory=' + root, '--property=RuntimeMaxSec=180', '--property=TimeoutStopSec=5', '--property=KillMode=control-group',
      '--property=MemoryHigh=2300M', '--property=MemoryMax=2560M', '--property=TasksMax=2048',
      '--property=NoNewPrivileges=true', '--property=ProtectSystem=strict', '--property=ProtectHome=true', '--property=PrivateTmp=true',
      '--property=PrivateDevices=true', '--property=ProtectKernelTunables=true', '--property=ProtectControlGroups=true',
      '--property=RestrictSUIDSGID=true', '--property=LimitNOFILE=65536', '--property=ReadWritePaths=' + unit.directory + ' ' + cfg.lockDir,
      '--property=StandardOutput=append:' + resolve(unit.directory, 'unit.log'), '--property=StandardError=append:' + resolve(unit.directory, 'unit.log'),
      cfg.node, resolve(root, 'tools/context-views/linux-host-preflight-worker.mjs'), resolve(unit.directory, 'worker.json')], { timeout: 5000 });
    unit.cgroup = await cgroup(unit.name);
  }
  report.units = units; save(); monitoring = true;
  monitor = (async () => { while (monitoring && !abort.signal.aborted) {
    try {
      const own = units.map(unit => ({ role: unit.role, ...counters(unit.cgroup) }));
      const production = baselineProduction.map(unit => ({ name: unit.name, ...counters(unit.path) }));
      const eyes = await json(eyesUrl.href), sample = { at: Date.now(), availableBytes: available(), own, production, eyes };
      report.samples.push(sample); appendFileSync(resolve(cfg.out, 'samples.jsonl'), JSON.stringify(sample) + '\n');
      assert.ok(sample.availableBytes >= 3 * 1024 ** 3, 'host headroom below3GiB');
      assert.equal(eyes.eyes.state, 'ready'); assert.equal(eyes.eyes.since, baselineEyes.eyes.since, 'production Eyes restarted');
      assert.equal(eyes.eyes.failures, baselineEyes.eyes.failures, 'production Eyes failure counter advanced');
      for (const [i, row] of production.entries()) for (const field of ['oom', 'oom_kill']) assert.equal(row.memoryEvents[field], baselineProduction[i].before.memoryEvents[field], 'production OOM');
      for (const row of own) assert.equal(row.memoryEvents.oom_kill, 0, 'candidate OOM');
    } catch (error) { if (!closing) fail(error); }
    await delay(1000, undefined, { signal: abort.signal }).catch(() => {});
  } })();
  queryMonitor = (async () => { while (monitoring && !abort.signal.aborted) {
    for (const unit of units) {
      const at = Date.now(); try { const body = await json(unit.base + '/v1/edge/platforms'); report.queries.push({ role: unit.role, at, ms: Date.now() - at, tick: body.tick }); }
      catch (error) { report.queries.push({ role: unit.role, at, error: String(error) }); }
    }
    await delay(250, undefined, { signal: abort.signal }).catch(() => {});
  } })();
  for (const unit of units) {
    await until(() => { if (existsSync(resolve(unit.directory, 'failure.json'))) throw Error(JSON.stringify(readJson(resolve(unit.directory, 'failure.json')))); return existsSync(resolve(unit.directory, 'ready.json')); });
    unit.ready = readJson(resolve(unit.directory, 'ready.json'));
    const listing = await json(unit.base + '/v1/world/context');
    const snapshot = await json(unit.base + '/v1/world/snapshot');
    const entity = snapshot.entities.find(e => e.name === (unit.role === 'a' ? 'hall' : 'landmark')); assert.ok(entity);
    const choices = listing.targets.filter(t => t.entity === entity.id && (unit.role === 'a' ? t.enclosed && t.ref.startsWith(entity.id + '/slot/') : t.ref === entity.id));
    assert.equal(choices.length, 1); unit.target = choices[0];
  }
  check('separate native main identities', units[0].ready.mainPid !== units[1].ready.mainPid);
  const admissionAt = Date.now();
  await Promise.all(units.map(unit => json(unit.base + '/v1/world/context/views', { refs: [unit.target.ref], detail: false, sheet: false })));
  // Trigger exactly one fixture Eyes job while a real architectural Chrome is running.
  await until(() => units.some(unit => events(unit).some(e => e.kind === '[context-phase]' && e.event.phase === 'spawned')));
  writeFileSync(resolve(units[0].directory, 'request-eyes.json'), JSON.stringify({ kind: 'one-fixture-frame' }));
  const lockSamples = [];
  await until(async () => {
    const all = units.flatMap(events); assert.ok(all.filter(e => e.kind === '[context-job]' && e.event.phase === 'start').length <= 4);
    try { const holder = readJson(resolve(cfg.lockDir, 'render.lock/holder')).holder; lockSamples.push({ at: Date.now(), pid: holder.pid, start: holder.start }); } catch {}
    for (const unit of units) if (!unit.view || unit.view.status === 'pending') unit.view = (await json(unit.base + '/v1/world/context/views', { refs: [unit.target.ref], detail: false, sheet: false })).views[0];
    for (const unit of units) assert.ok(['pending', 'ready'].includes(unit.view.status), `${unit.role}: capture unavailable (retained; no retry)`);
    const finished = units.every(unit => {
      const phases = events(unit).filter(e => e.kind === '[context-phase]');
      return phases.filter(e => e.event.phase === 'spawned').length > 0 && phases.filter(e => e.event.phase === 'spawned').length === phases.filter(e => e.event.phase === 'stopped').length;
    });
    return units.every(unit => unit.view.status === 'ready') && finished && existsSync(resolve(units[0].directory, 'eyes.json'));
  });
  report.lockSamples = lockSamples;
  const intervals = units.flatMap(unit => {
    const spans = [], phases = events(unit).filter(e => e.kind === '[context-phase]'); let start;
    for (const row of phases) { if (row.event.phase === 'spawned') { assert.equal(start, undefined); start = row.event.at; } if (row.event.phase === 'stopped' && start !== undefined) { spans.push({ role: unit.role, start, end: row.event.at }); start = undefined; } }
    assert.equal(start, undefined, 'renderer cleanup trace complete'); return spans;
  }).sort((a, b) => a.start - b.start);
  check('bounded completed architectural capture intervals', intervals.length >= 2 && intervals.length <= 4, intervals);
  check('architectural intervals do not overlap across PrivateTmp units', intervals.every((row, i) => i === 0 || intervals[i - 1].end <= row.start), intervals);
  const jobStarts = units.map(unit => events(unit).find(e => e.kind === '[context-job]' && e.event.phase === 'start')?.event.at);
  check('both requests contended before first renderer finished', jobStarts.every(Number.isFinite) && Math.max(...jobStarts) < intervals[0].end, { admissionAt, jobStarts });
  check('exactly two successful context PNG jobs', units.flatMap(events).filter(e => e.kind === '[context-job]' && e.event.phase === 'finish' && e.event.ready).length === 2);
  check('shared lock holder belongs to an isolated main', lockSamples.length > 0 && lockSamples.every(s => units.some(u => u.ready.mainPid === s.pid)), lockSamples);
  const eyes = readJson(resolve(units[0].directory, 'eyes.json')); report.isolatedEyes = eyes;
  check('one successful isolated Eyes frame overlaps actual architectural capture', eyes.bytes > 0 && eyes.status.renders === 1 && eyes.status.failures === 0 && eyes.frameTick !== null && intervals.some(i => eyes.begin < i.end && eyes.end > i.start), eyes);
  for (const unit of units) {
    const first = Buffer.from(await (await request(unit.base + unit.view.url)).arrayBuffer()); assert.ok(first.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')));
    writeFileSync(resolve(unit.directory, 'context.png'), first);
    const before = events(unit).filter(e => e.kind === '[context-job]' && e.event.phase === 'start').length;
    const cached = (await json(unit.base + '/v1/world/context/views', { refs: [unit.target.ref], detail: false, sheet: false })).views[0];
    const second = Buffer.from(await (await request(unit.base + cached.url)).arrayBuffer());
    check(unit.role + ' exact cached key/URL/bytes with no render', cached.key === unit.view.key && cached.url === unit.view.url && hash(first) === hash(second) && events(unit).filter(e => e.kind === '[context-job]' && e.event.phase === 'start').length === before, { ref: cached.ref, key: cached.key, url: cached.url, sha256: hash(first), bytes: first.length });
  }
  await delay(1000, undefined, { signal: abort.signal });
  for (const unit of units) { const rows = report.queries.filter(q => q.role === unit.role && q.at >= admissionAt); check(unit.role + ' live query/tick continuity', rows.length > 1 && rows.every(q => !q.error && Number.isFinite(q.tick)) && rows.at(-1).tick > rows[0].tick, { count: rows.length, maxMs: Math.max(...rows.map(q => q.ms)), firstTick: rows[0]?.tick, lastTick: rows.at(-1)?.tick }); }
  report.functionalPass = true;
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally {
  closing = true; monitoring = false; abort.abort(Error('cleanup')); clearTimeout(timer);
  await Promise.allSettled([monitor, queryMonitor]);
  await Promise.all(units.filter(u => u.admitted).map(u => systemctl('stop', '--no-block', u.name).catch(error => { report.cleanup[u.role] = String(error); })));
  await delay(5000);
  await Promise.all(units.filter(u => u.admitted).map(async unit => {
    try {
      if (unit.cgroup && existsSync(unit.cgroup) && counters(unit.cgroup).processes.length) await systemctl('kill', '--kill-whom=all', '--signal=SIGKILL', unit.name);
      await portFree(unit.port);
      const remaining = unit.cgroup && existsSync(unit.cgroup) ? counters(unit.cgroup).processes : [];
      report.cleanup[unit.role] = { remaining, portClosed: true, complete: remaining.length === 0 };
    } catch (error) { report.cleanup[unit.role] = { complete: false, error: String(error) }; }
  }));
  try { const holder = readJson(resolve(cfg.lockDir, 'render.lock/holder')).holder; report.cleanup.lockHolder = holder.pid; report.cleanup.ownedLockRemains = units.some(u => u.ready?.mainPid === holder.pid); } catch { report.cleanup.ownedLockRemains = false; }
  report.finishedAt = new Date().toISOString(); report.within190s = Date.now() - began <= 190000;
  report.pass = report.functionalPass === true && !failure && report.within190s && !report.cleanup.ownedLockRemains && units.every(u => report.cleanup[u.role]?.complete);
  if (!report.pass) process.exitCode = 1;
  report.monitorFailure = failure; save(); console.log(JSON.stringify({ out: cfg.out, pass: report.pass, error: report.error, monitorFailure: failure, cleanup: report.cleanup }));
}
