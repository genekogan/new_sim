// Chrome shares the same ownership/stale/release contract as state and keeper startup locks.
// Slots (the team's <team>/ops/chrome-lease.mjs scheme): headless Chrome renders through the GPU, so a few
// run at once. Slot 0 is /tmp/eden-chrome-lease, slot i is /tmp/eden-chrome-lease.<i>; CHROME_LEASE_SLOTS (default 3) of
// them. Every slot is one eden-lock/1 directory; older CLIs and lanes take slot 0 only, the team's lease any of them, this
// one the highest free slot first.
import { acquireLock, CHROME_LOCK, LOCK_TTL_MS } from './locks.mjs';
export const CHROME_SLOTS = 3;
export function chromeSlotCount(env = process.env) {
  const n = Number(env.CHROME_LEASE_SLOTS ?? CHROME_SLOTS);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, 16) : CHROME_SLOTS;
}
export const chromeSlotDirs = (base = CHROME_LOCK, slots = chromeSlotCount()) => Array.from({ length: slots }, (_, i) => (i === 0 ? base : `${base}.${i}`));
// waitMs: the browsers are shared by every god and test lane on the machine; a look's own deadline (120 s by default)
// bounds the whole wait, so wait most of it here rather than failing after 25 s while other looks finish.
// Slots are tried from the highest down, so slot 0 stays free for single-slot clients (older CLIs and releases) while
// there is spare capacity. A slot that fails for any reason other than busy (EACCES on another user's directory, a stray
// file) is skipped, not fatal; it is thrown only when no slot is merely busy. The returned release() carries `.dir`.
export async function chromeLease(label = 'unknown', { waitMs = 110_000, staleMs = LOCK_TTL_MS, leaseDir = CHROME_LOCK, slots = chromeSlotCount() } = {}) {
  const started = Date.now(), dirs = chromeSlotDirs(leaseDir, slots), order = dirs.slice().reverse();
  for (;;) {
    // Polls only learn that a slot is busy; the final scan builds each holder's full detail (a second `ps`) for the error.
    const last = Date.now() - started >= waitMs, busy = new Map(), failed = new Map();
    for (const dir of order) {
      try { const release = acquireLock(dir, { label, ttlMs: staleMs, detail: last }); release.dir = dir; return release; }
      catch (e) { (e.code === 'lock.busy' ? busy : failed).set(dir, e); }
    }
    if (!busy.size) {
      const e = failed.get(dirs[0]) ?? [...failed.values()][0];
      if (failed.size > 1) e.message = `chrome lease: no slot usable (${dirs.map(d => `${d}: ${failed.get(d).message}`).join('; ')})`;
      throw e;
    }
    if (last) {
      const e = busy.get(dirs.find(d => busy.has(d))), why = dirs.map(d => busy.has(d) ? busy.get(d).message.replace(/^lock\.busy: /, '').replace(/; run doctor$/, '') : `${d} unusable: ${failed.get(d).code ?? failed.get(d).message}`);
      e.message = `chrome lease busy: ${dirs.length === 1 ? e.message : `all ${dirs.length} slots ${failed.size ? 'held or unusable' : 'held'} (${why.join('; ')}); run doctor`}`;
      e.locks = dirs.filter(d => busy.has(d)).map(d => busy.get(d).lock); throw e;
    }
    // Each busy slot is probed for a dead holder: one `ps` per live eden-lock/1 holder (team text holders: none), so poll
    // a few times a second, not 10x.
    await new Promise(r => setTimeout(r, Math.min(200 + Math.random() * 200, Math.max(1, waitMs - (Date.now() - started)))));
  }
}
