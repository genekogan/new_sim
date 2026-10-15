// One software-rendered Chrome at a time across all lanes (the machine is shared by ~10 agents;
// concurrent swiftshader renders starve each other and every screenshot times out).
//   const release = await chromeLease('my-lane');  … launch, screenshot, browser.close() …  release();
// The lease is a directory (atomic mkdir). Dead holders are reclaimed immediately;
// unreadable holders expire after 15 minutes. A live PID always keeps its lease.
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';

const LEASE = '/tmp/eden-chrome-lease';
const snapshot = (dir) => {
  const stat = statSync(dir);
  let holder;
  try { holder = readFileSync(`${dir}/holder`, 'utf8'); } catch { /* unreadable: use directory age */ }
  return { stat, holder };
};
const unchanged = (a, b) => a.stat.dev === b.stat.dev && a.stat.ino === b.stat.ino && a.stat.mtimeMs === b.stat.mtimeMs && a.stat.ctimeMs === b.stat.ctimeMs && a.holder === b.holder;
const deadHolder = (holder) => {
  // Labels may contain spaces; the final fields are always PID and timestamp.
  const pid = Number(holder?.trim().split(/\s+/).at(-2));
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 0x7fffffff) return undefined;
  try { process.kill(pid, 0); return false; }
  catch (e) { return e.code === 'ESRCH'; } // EPERM (or uncertainty) must not evict a holder.
};
function reclaim(dir, staleMs) {
  try {
    const before = snapshot(dir), dead = deadHolder(before.holder);
    if (dead !== true && !(dead === undefined && Date.now() - before.stat.mtimeMs > staleMs)) return false;
    // Another waiter may already have reclaimed it. Never remove a changed holder
    // or replacement directory; go back through atomic mkdir instead.
    if (!unchanged(before, snapshot(dir))) return true;
    rmSync(dir, { recursive: true, force: true });
    return true;
  } catch (e) { if (e.code === 'ENOENT') return true; throw e; }
}
export async function chromeLease(holder = 'unknown', { waitMs = 20 * 60_000, staleMs = 15 * 60_000, leaseDir = LEASE } = {}) {
  const t0 = Date.now();
  for (;;) {
    try { mkdirSync(leaseDir); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (reclaim(leaseDir, staleMs)) continue;
      if (Date.now() - t0 > waitMs) throw new Error(`chrome lease busy for ${Math.round(waitMs / 60000)} min`);
      await new Promise((r) => setTimeout(r, 3000 + Math.random() * 2000));
      continue;
    }
    writeFileSync(`${leaseDir}/holder`, `${holder} ${process.pid} ${new Date().toISOString()}\n`);
    break;
  }
  const owned = snapshot(leaseDir);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    process.removeListener('exit', release);
    try { if (unchanged(owned, snapshot(leaseDir))) rmSync(leaseDir, { recursive: true, force: true }); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  };
  process.once('exit', release);
  return release;
}
