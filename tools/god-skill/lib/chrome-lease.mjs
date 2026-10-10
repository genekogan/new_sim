// One software-rendered Chrome at a time across all lanes (the machine is shared by ~10 agents;
// concurrent swiftshader renders starve each other and every screenshot times out).
//   const release = await chromeLease('my-lane');  … launch, screenshot, browser.close() …  release();
// The lease is a directory (atomic mkdir); stale leases older than 15 minutes are broken.
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';

const LEASE = '/tmp/eden-chrome-lease';
export async function chromeLease(holder = 'unknown', { waitMs = 20 * 60_000, staleMs = 15 * 60_000 } = {}) {
  const t0 = Date.now();
  for (;;) {
    try { mkdirSync(LEASE); writeFileSync(`${LEASE}/holder`, `${holder} ${process.pid} ${new Date().toISOString()}\n`); break; }
    catch {
      try { if (Date.now() - statSync(LEASE).mtimeMs > staleMs) { rmSync(LEASE, { recursive: true, force: true }); continue; } } catch { continue; }
      if (Date.now() - t0 > waitMs) throw new Error(`chrome lease busy for ${Math.round(waitMs / 60000)} min`);
      await new Promise((r) => setTimeout(r, 3000 + Math.random() * 2000));
    }
  }
  let released = false;
  const release = () => { if (!released) { released = true; rmSync(LEASE, { recursive: true, force: true }); } };
  process.once('exit', release);
  return release;
}
