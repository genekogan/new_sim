// Chrome shares the same ownership/stale/release contract as state and keeper startup locks.
// Slots (the team's <team>/ops/chrome-lease.mjs scheme): headless Chrome renders through the GPU, so a few
// run at once. Slot 0 is /tmp/eden-chrome-lease, slot i is /tmp/eden-chrome-lease.<i>; CHROME_LEASE_SLOTS (default 3) of
// them. Every slot is one eden-lock/1 directory; older CLIs and lanes take slot 0 only, the team's lease any of them.
import { acquireLock, CHROME_LOCK, LOCK_TTL_MS } from './locks.mjs';
export const CHROME_SLOTS = 3;
export function chromeSlotCount(env = process.env) {
  const n = Number(env.CHROME_LEASE_SLOTS ?? CHROME_SLOTS);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, 16) : CHROME_SLOTS;
}
export const chromeSlotDirs = (base = CHROME_LOCK, slots = chromeSlotCount()) => Array.from({ length: slots }, (_, i) => (i === 0 ? base : `${base}.${i}`));
// waitMs: the browsers are shared by every god and test lane on the machine; a look's own deadline (120 s by default)
// bounds the whole wait, so wait most of it here rather than failing after 25 s while other looks finish.
// The returned release() carries `.dir`, the slot it holds.
export async function chromeLease(label = 'unknown', { waitMs = 110_000, staleMs = LOCK_TTL_MS, leaseDir = CHROME_LOCK, slots = chromeSlotCount() } = {}) {
  const started = Date.now(), dirs = chromeSlotDirs(leaseDir, slots);
  for (;;) {
    const busy = [];
    for (const dir of dirs) {
      try { const release = acquireLock(dir, { label, ttlMs: staleMs }); release.dir = dir; return release; }
      catch (e) { if (e.code !== 'lock.busy') throw e; busy.push(e); }
    }
    if (Date.now() - started >= waitMs) {
      const e = busy[0];
      e.message = `chrome lease busy: ${dirs.length === 1 ? e.message : `all ${dirs.length} slots held (${busy.map(b => b.message.replace(/^lock\.busy: /, '').replace(/; run doctor$/, '')).join('; ')}); run doctor`}`;
      e.locks = busy.map(b => b.lock); throw e;
    }
    // Each busy slot is probed for a dead holder (a `ps` per live JSON holder), so poll a few times a second, not 10×.
    await new Promise(r => setTimeout(r, Math.min(200 + Math.random() * 200, Math.max(1, waitMs - (Date.now() - started)))));
  }
}
