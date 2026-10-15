// Chrome shares the same ownership/stale/release contract as state and keeper startup locks.
import { acquireLock, CHROME_LOCK, LOCK_TTL_MS } from './locks.mjs';
// waitMs: one browser per machine is shared by every god and test lane; a look's own deadline (120 s by default) bounds the
// whole wait, so wait most of it here rather than failing after 25 s while another look finishes.
export async function chromeLease(label = 'unknown', { waitMs = 110_000, staleMs = LOCK_TTL_MS, leaseDir = CHROME_LOCK } = {}) {
  const started = Date.now();
  for (;;) {
    try { return acquireLock(leaseDir, { label, ttlMs: staleMs }); }
    catch (e) {
      if (e.code !== 'lock.busy') throw e;
      if (Date.now() - started >= waitMs) { e.message = `chrome lease busy: ${e.message}`; throw e; }
      await new Promise(r => setTimeout(r, Math.min(100, Math.max(1, waitMs - (Date.now() - started)))));
    }
  }
}
