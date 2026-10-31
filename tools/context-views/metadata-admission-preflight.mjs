#!/usr/bin/env node
// One root-approved two-phase diagnostic. Parent watchdog remains outside both
// CPU-bound probe processes; no Chrome, inference, or image capture is allowed.
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { loadavg } from 'node:os';
import { freeMemGb } from '../playtest/lib/platform.mjs';
import { sourceReceipt } from './source-receipt.mjs';
import { measureSlot } from '../lib/paths.mjs';
const launched = Date.now(), totalDeadline = launched + 90000, workDeadline = totalDeadline - 5000;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(process.argv[2]), phaseB = resolve(process.argv[3]);
const slot = measureSlot();
const claim = `${new Date(launched).toISOString()} context-metadata-admission pid=${process.pid} until=${new Date(totalDeadline).toISOString()}`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { startedAt: new Date(launched).toISOString(), runnerPid: process.pid, totalDeadline: new Date(totalDeadline).toISOString(), phases: [], cleanup: {}, ambient: { load: loadavg(), freeGiB: freeMemGb() } };
let claimed = false, active, watchdog;
mkdirSync(output); // Never overwrite a previous diagnostic.
const save = () => writeFileSync(resolve(output, 'summary.json'), JSON.stringify(report, null, 2));
const groupMembers = group => execFileSync('ps', ['-axo', 'pid=,pgid=,lstart='], { encoding: 'utf8', timeout: 500, env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } }).split('\n').flatMap(line => {
  const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.{24})$/);
  return match && +match[2] === group ? [{ pid: +match[1], group, start: match[3] }] : [];
});
function terminate(record, signal) {
  const rows = groupMembers(record.pid), leader = rows.find(row => row.pid === record.pid);
  if (leader && record.start && leader.start !== record.start) throw Error('probe process group identity changed');
  // This detached group was created solely for the probe and its server. If its
  // leader exits first, remaining same-group descendants still belong to it.
  if (rows.length) { try { process.kill(-record.pid, signal); } catch {} }
  return rows;
}
async function run(name, args, env, deadline) {
  if (Date.now() >= workDeadline) throw Error('combined diagnostic deadline');
  const fd = openSync(resolve(output, name + '.log'), 'wx');
  const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  const record = { name, pid: child.pid, startedAt: new Date().toISOString() }; report.phases.push(record);
  record.start = groupMembers(child.pid).find(row => row.pid === child.pid)?.start;
  if (!record.start) { child.kill('SIGKILL'); throw Error('probe process identity unavailable'); }
  active = record; save(); console.log(JSON.stringify(record));
  let killer;
  const timer = setTimeout(() => {
    record.timeout = true;
    try { terminate(record, 'SIGTERM'); } catch (error) { record.cleanupError = String(error); }
    killer = setTimeout(() => { try { terminate(record, 'SIGKILL'); } catch (error) { record.cleanupError = String(error); } }, 500);
  }, Math.max(1, deadline - Date.now()));
  try {
    const code = await new Promise((yes, no) => { child.once('exit', (code, signal) => { record.signal = signal; yes(code); }); child.once('error', no); });
    record.exitCode = code;
  } finally {
    clearTimeout(timer); clearTimeout(killer);
    record.remainingBeforeCleanup = terminate(record, 'SIGKILL');
    await new Promise(resolve => setTimeout(resolve, 50));
    record.remaining = groupMembers(record.pid); record.endedAt = new Date().toISOString(); active = undefined; save();
  }
  if (record.timeout || record.exitCode !== 0 || record.remaining.length || record.cleanupError) throw Error(`${name} failed; retain its receipt/log`);
}
try {
  if (!process.env.WEB_DIR || !process.env.CONTEXT_ADMISSION_PROBE_SHA) throw Error('own WEB_DIR and reviewed phaseB SHA required');
  const phaseBHash = hash(readFileSync(phaseB));
  if (phaseBHash !== process.env.CONTEXT_ADMISSION_PROBE_SHA) throw Error('phaseB source changed since review');
  report.phaseB = { path: phaseB, sha256: phaseBHash }; report.sourceReceipt = sourceReceipt(root, process.env.WEB_DIR);
  if (loadavg()[0] >= 10 || freeMemGb() < 6) throw Error('ambient requires load1<10/free>=6GiB');
  const current = readFileSync(slot, 'utf8');
  if (current.split('\n').some(line => line.trim() && !line.startsWith('#'))) throw Error('measurement slot held');
  await new Promise((yes, no) => { const server = createServer(); server.once('error', no); server.listen(5981, '127.0.0.1', () => server.close(yes)); });
  writeFileSync(slot, current + '\n' + claim + '\n'); claimed = true;
  watchdog = setTimeout(() => { report.deadlineReached = true; if (active) try { terminate(active, 'SIGKILL'); } catch (error) { report.watchdogError = String(error); } }, Math.max(1, workDeadline - Date.now()));
  console.log(JSON.stringify({ claim, output, workDeadline: new Date(workDeadline).toISOString() })); save();
  const phaseAEnd = Math.min(workDeadline, Date.now() + 50000), phaseAOutput = resolve(output, 'served-metadata');
  await run('served-metadata', ['tools/context-views/metadata-preflight.mjs', phaseAOutput], { CONTEXT_PARENT_CLAIM: claim, CONTEXT_METADATA_DEADLINE: new Date(phaseAEnd).toISOString() }, Math.min(workDeadline, phaseAEnd + 3000));
  const admissionReceipt = resolve(phaseAOutput, 'summary.json'), metadata = JSON.parse(readFileSync(admissionReceipt, 'utf8'));
  if (metadata.error || !metadata.admissionRef || metadata.requests?.[0]?.status !== 200) throw Error('actual served metadata did not establish target');
  report.admissionRef = metadata.admissionRef;
  await run('service-admission', [phaseB, resolve(output, 'service-admission')], { CONTEXT_MEASURE_CLAIM: claim, CONTEXT_ADMISSION_RECEIPT: admissionReceipt, CONTEXT_ADMISSION_DEADLINE: new Date(workDeadline - 1000).toISOString(), SIM_CONTEXT_TIMINGS: '1' }, workDeadline);
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally {
  clearTimeout(watchdog);
  if (active) try { terminate(active, 'SIGKILL'); } catch (error) { report.cleanup.error = String(error); }
  report.cleanup.groups = report.phases.map(phase => {
    try { return { group: phase.pid, remaining: groupMembers(phase.pid) }; }
    catch (error) { report.cleanup.error = String(error); return { group: phase.pid, unverified: true }; }
  });
  await new Promise(resolve => { const server = createServer(); server.once('error', () => { report.cleanup.port5981Closed = false; resolve(); }); server.listen(5981, '127.0.0.1', () => server.close(() => { report.cleanup.port5981Closed = true; resolve(); })); });
  if (claimed) writeFileSync(slot, readFileSync(slot, 'utf8').split('\n').filter(line => line !== claim).join('\n'));
  report.cleanup.slotReleased = !readFileSync(slot, 'utf8').split('\n').includes(claim);
  report.endedAt = new Date().toISOString(); report.cleanup.withinDeadline = Date.now() <= totalDeadline;
  report.cleanup.complete = !report.cleanup.error && report.cleanup.port5981Closed && report.cleanup.slotReleased && report.cleanup.groups.every(group => !group.unverified && !group.remaining.length);
  if (!report.cleanup.complete || !report.cleanup.withinDeadline) process.exitCode = 1;
  save(); console.log(JSON.stringify({ output, error: report.error, cleanup: report.cleanup, endedAt: report.endedAt }));
}
