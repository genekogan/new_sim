// Custody starts only at the pinned native Codex binary. Measurement children
// are never registered; registering an owned child may itself sample processes.
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const identity = row => `${row.pid}:${row.start}`;
const live = row => !row.state.includes('Z') && !/(?:^|\/|\()ps(?:\)|\s|$)/.test(row.executable) && !/<defunct>/.test(row.executable);
export function parseProcessRows(output) {
  return output.split('\n').flatMap(line => {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.{24})\s+(.+)$/);
    return m ? [{ pid: +m[1], parent: +m[2], group: +m[3], state: m[4], start: m[5], executable: m[6] }] : [];
  });
}
export function processRows() {
  return parseProcessRows(execFileSync('ps', ['-axo', 'pid=,ppid=,pgid=,state=,lstart=,comm='], {
    encoding: 'utf8', timeout: 1000, env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
  }));
}
function tree(rows, seeds) {
  const ids = new Set(seeds); let changed = true;
  while (changed) { changed = false; for (const row of rows) if (ids.has(row.parent) && !ids.has(row.pid)) { ids.add(row.pid); changed = true; } }
  return ids;
}
export function createCustodyTracker({ rootPid, baselineRows, codexBinary }) {
  const initialTree = tree(baselineRows, [rootPid]);
  const baseline = new Set(baselineRows.filter(row => initialTree.has(row.pid) && row.pid !== rootPid).map(identity));
  const known = new Map(); let sawCodex = false;
  return { update(rows) {
    const active = rows.filter(live), byPid = new Map(active.map(row => [row.pid, row]));
    const excluded = tree(active, active.filter(row => baseline.has(identity(row))).map(row => row.pid));
    const rootTree = tree(active, [rootPid]);
    const roots = active.filter(row => row.executable === codexBinary && rootTree.has(row.pid) && !excluded.has(row.pid));
    const selected = new Set(active.filter(row => known.has(identity(row))).map(row => row.pid));
    for (const row of roots) {
      sawCodex = true; selected.add(row.pid);
      // Retain only the observed native binary's new launcher ancestry, stopping
      // before the harness or any pre-existing fixture process.
      let parent = byPid.get(row.parent);
      while (parent && parent.pid !== rootPid && rootTree.has(parent.pid) && !excluded.has(parent.pid)) {
        selected.add(parent.pid); parent = byPid.get(parent.parent);
      }
    }
    const owned = tree(active, selected), added = [];
    for (const row of active) if (owned.has(row.pid) && !excluded.has(row.pid) && row.pid !== rootPid && !known.has(identity(row))) {
      known.set(identity(row), row); added.push(row);
    }
    return { added, live: active.filter(row => known.has(identity(row))), identities: [...known.values()], sawCodex };
  } };
}
export function killTargets(rows) {
  const leaders = new Set(rows.filter(row => row.pid === row.group).map(row => row.pid));
  return [...new Set(rows.map(row => leaders.has(row.group) ? -row.group : row.pid))];
}
export function watchAdapter({ signal, deadline, codexBinary, registerProcess = () => {} }) {
  if (!codexBinary?.startsWith('/')) throw Error('pinned native Codex binary required for custody');
  const tracker = createCustodyTracker({ rootPid: process.pid, baselineRows: processRows(), codexBinary });
  const registrations = []; let samplingError = null, closed = false, last;
  const sample = () => {
    last = tracker.update(processRows());
    for (const row of last.added) registrations.push(Promise.resolve(registerProcess(row.pid, 'other')).catch(error => { samplingError = String(error.message); }));
    return last.live;
  };
  const kill = () => {
    for (const target of killTargets(sample())) try { process.kill(target, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
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
    return { identities: last.identities, sawCodex: last.sawCodex, remaining, samplingError };
  } };
}
