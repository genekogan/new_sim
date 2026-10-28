// Custody around the existing adapter, never a second Codex launcher.
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const identity = row => `${row.pid}:${row.start}`;
export function processRows() {
  return execFileSync('ps', ['-axo', 'pid=,ppid=,pgid=,lstart=,comm='], {
    encoding: 'utf8', timeout: 1000, env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
  }).split('\n').flatMap(line => {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.{24})\s+(.+)$/);
    return m ? [{ pid: +m[1], parent: +m[2], group: +m[3], start: m[4], executable: m[5] }] : [];
  });
}
function descendants(rows, root) {
  const ids = new Set([root]); let changed = true;
  while (changed) { changed = false; for (const row of rows) if (ids.has(row.parent) && !ids.has(row.pid)) { ids.add(row.pid); changed = true; } }
  return rows.filter(row => ids.has(row.pid) && row.pid !== root);
}
export function watchAdapter({ signal, deadline, registerProcess = () => {} }) {
  const baseline = new Set(descendants(processRows(), process.pid).map(identity));
  const known = new Map(), registrations = []; let samplingError = null, closed = false;
  const sample = () => {
    const rows = processRows(), candidates = descendants(rows, process.pid);
    // Baseline fixture processes and their children remain owner custody.
    const excluded = new Set(rows.filter(row => baseline.has(identity(row))).map(row => row.pid));
    let changed = true;
    while (changed) { changed = false; for (const row of rows) if (excluded.has(row.parent) && !excluded.has(row.pid)) { excluded.add(row.pid); changed = true; } }
    for (const row of candidates) if (!excluded.has(row.pid) && row.executable !== 'ps' && !row.executable.endsWith('/ps') && !known.has(identity(row))) {
      known.set(identity(row), row);
      registrations.push(Promise.resolve(registerProcess(row.pid, 'other')).catch(error => { samplingError = String(error.message); }));
    }
    return rows.filter(row => known.has(identity(row)));
  };
  const kill = () => {
    for (const row of sample()) try { process.kill(row.group === row.pid ? -row.pid : row.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  const timer = setInterval(() => { try { sample(); if (signal.aborted || Date.now() >= deadline) kill(); } catch (error) { samplingError = String(error.message); } }, 50);
  const abort = () => { try { kill(); } catch (error) { samplingError = String(error.message); } };
  signal.addEventListener('abort', abort);
  return { async close() {
    if (closed) throw Error('adapter custody already closed'); closed = true;
    clearInterval(timer); signal.removeEventListener('abort', abort);
    let remaining = sample();
    if (remaining.length) {
      kill(); const until = Date.now() + 500;
      do { await delay(20); remaining = sample(); } while (remaining.length && Date.now() < until);
    }
    await Promise.all(registrations);
    return { identities: [...known.values()], remaining, samplingError };
  } };
}
