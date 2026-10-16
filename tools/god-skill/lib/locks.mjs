// eden-lock/1: shared by the CLI and server. Never store credentials in holder records.
import { spawnSync } from 'node:child_process';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';

export const CHROME_LOCK = '/tmp/eden-chrome-lease';
export const LOCK_TTL_MS = 30_000;
const ownStart = new Date(Date.now() - process.uptime() * 1000).toISOString();
let selfStart;
export function processStart(pid = process.pid) {
  if (pid === process.pid && selfStart) return selfStart;
  const r = spawnSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', timeout: 1000, env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } });
  const start = r.status === 0 && r.stdout.trim() ? `ps:${r.stdout.trim()}` : null;
  if (pid === process.pid) return selfStart = start ?? `node:${ownStart}`;
  return start;
}
let self;
export function holder(label = 'eden-god') {
  self ??= { pid: process.pid, host: hostname(), start: processStart() ?? new Date(Date.now() - process.uptime() * 1000).toISOString() };
  return { ...self, label };
}
export function parseHolder(raw) {
  try {
    const h = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (h && Number.isSafeInteger(h.pid) && h.pid > 0 && h.pid <= 0x7fffffff && typeof h.host === 'string' && h.host.length <= 255 && typeof h.start === 'string' && h.start.length <= 100) return { pid: h.pid, host: h.host, start: h.start, label: String(h.label ?? '').slice(0, 100) };
  } catch { /* legacy lease text */ }
  return undefined;
}
export function liveness(h) {
  if (!h || h.host !== hostname()) return 'unknown';
  try { process.kill(h.pid, 0); } catch (e) { return e.code === 'ESRCH' ? 'dead' : 'unknown'; }
  const start = processStart(h.pid);
  if (h.pid !== process.pid && h.start.startsWith('node:')) return 'unknown';
  return start ? (start === h.start ? 'alive' : 'recycled') : 'unknown';
}
export function lockStatus(h, heartbeatAt, ttlMs = LOCK_TTL_MS, now = Date.now()) {
  const live = liveness(h), expired = now - heartbeatAt > ttlMs;
  return { holder: h ?? null, heartbeatAt, ttlMs, liveness: live, stale: live === 'dead' || live === 'recycled' || (live !== 'alive' && expired), reason: live === 'dead' || live === 'recycled' ? live : expired && live !== 'alive' ? 'expired' : live };
}
function snapshot(path) {
  const stat = statSync(path); let raw = '';
  try { raw = readFileSync(`${path}/holder`, 'utf8'); } catch { /* incomplete mkdir: TTL grace */ }
  let record; try { record = JSON.parse(raw); } catch { /* old format */ }
  const h = parseHolder(record?.holder);
  // Old clients did not record host/start; retain their live PID protection during migration.
  const beat = Number.isFinite(record?.heartbeatAt) ? record.heartbeatAt : stat.mtimeMs;
  const ttl = Number.isFinite(record?.ttlMs) && record.ttlMs > 0 ? record.ttlMs : LOCK_TTL_MS;
  let status = lockStatus(h, beat, ttl);
  if (!h && raw.trim()) {
    const pid = Number(raw.trim().split(/\s+/).at(-2));
    if (Number.isSafeInteger(pid) && pid > 0 && pid <= 0x7fffffff) {
      try { process.kill(pid, 0); status = { ...status, stale: false, liveness: 'unknown', reason: 'legacy-live-pid' }; }
      catch (e) { status = { ...status, stale: e.code === 'ESRCH', reason: e.code === 'ESRCH' ? 'dead' : 'unknown' }; }
    }
  }
  return { stat, raw, record, status };
}
const same = (a, b) => a.stat.dev === b.stat.dev && a.stat.ino === b.stat.ino && a.stat.ctimeMs === b.stat.ctimeMs && a.raw === b.raw;
export function inspectLock(path, ttlMs) {
  try { const s = snapshot(path); if (!s.record && ttlMs) s.status = { ...s.status, ...(s.status.reason === 'expired' || !s.raw ? { stale: Date.now() - s.stat.mtimeMs > ttlMs } : {}), ttlMs }; return { path, present: true, ...s.status }; }
  catch (e) { if (e.code === 'ENOENT') return { path, present: false, stale: false, holder: null }; throw e; }
}
export function breakLock(path, { ttlMs } = {}) {
  let unlock;
  try {
    const before = snapshot(path);
    const stale = !before.record && ttlMs && (!before.raw || before.status.reason === 'expired') ? Date.now() - before.stat.mtimeMs > ttlMs : before.status.stale;
    if (!stale) return false;
    // Serialize reclaimers too: two waiters must not both remove a replacement owner.
    try { unlock = acquireLock(`${path}.reclaim`, { label: 'stale lock recovery' }); }
    catch (e) { if (e.code === 'lock.busy') return false; throw e; }
    if (!same(before, snapshot(path))) return false;
    rmSync(path, { recursive: true, force: true }); return true;
  } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
  finally { unlock?.(); }
}
export class LockBusy extends Error {
  constructor(path, status) { super(`lock.busy: ${path} held by ${status.holder ? `${status.holder.label} pid=${status.holder.pid} host=${status.holder.host} start=${status.holder.start}` : status.reason ?? 'unknown holder'}; run doctor`); this.code = 'lock.busy'; this.lock = { path, ...status }; }
}
const owned = new Map();
// detail: false skips the busy holder's full status (a second `ps`) for pollers that only need to know it is busy.
export function acquireLock(path, { label = 'eden-god', ttlMs = LOCK_TTL_MS, reentrant = false, detail = true } = {}) {
  path = resolve(path);
  if (reentrant && owned.has(path)) return () => {};
  for (;;) {
    try { mkdirSync(path, { mode: 0o700 }); break; }
    catch (e) { if (e.code !== 'EEXIST') throw e; if (breakLock(path, { ttlMs })) continue; throw new LockBusy(path, detail ? inspectLock(path, ttlMs) : { present: true, holder: null, reason: 'held' }); }
  }
  const record = { schema: 'eden-lock/1', holder: holder(label), acquiredAt: Date.now(), heartbeatAt: Date.now(), ttlMs, nonce: randomUUID() };
  try { writeFileSync(`${path}/holder`, JSON.stringify(record) + '\n', { mode: 0o600 }); }
  catch (e) { rmSync(path, { recursive: true, force: true }); throw e; }
  let original = snapshot(path), released = false;
  // The directory's mtime is refreshed too: an in-place holder write leaves it unchanged, and the team's Chrome lease
  // (team/ops/chrome-lease.mjs) breaks any slot whose directory is 15 minutes old.
  const heartbeat = setInterval(() => {
    try { if (!same(original, snapshot(path))) return; const now = Date.now(); record.heartbeatAt = now; writeFileSync(`${path}/holder`, JSON.stringify(record) + "\n", { mode: 0o600 }); utimesSync(path, new Date(now), new Date(now)); original = snapshot(path); } catch { /* release/replacement wins */ }
  }, Math.max(10, Math.min(5000, ttlMs / 3)));
  heartbeat.unref();
  const release = () => { if (released) return; released = true; clearInterval(heartbeat); owned.delete(path); process.removeListener('exit', release); try { if (same(original, snapshot(path))) rmSync(path, { recursive: true, force: true }); } catch (e) { if (e.code !== 'ENOENT') throw e; } };
  owned.set(path, release); process.once('exit', release); return release;
}
