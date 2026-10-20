// Pre-warm for a release handover (keeper.mjs, lane r31t): with SIM_STANDBY=1 a world process loads all of its code,
// prints STANDBY_MARK and then waits for SIGUSR2 before it opens its database or its port. The launcher starts it while
// the previous release's process still serves the world, stops that one (snapshot saved, process gone), then sends
// SIGUSR2: the visible pause is only the stop plus opening the data, not the module loading. Nothing is opened before
// the signal, so the world still has exactly one writer. SIGTERM while waiting exits at once (nothing to save).
import { DatabaseSync } from 'node:sqlite';

export const STANDBY_MARK = '[standby] ready';

/** G9 (lane Z1): the pre-warm also runs the boot's heaviest step once, on a READ-ONLY connection (it cannot write: SQLite
 *  refuses), so the restore after the signal runs warm code over cached pages. The rehearsed engine is thrown away: the
 *  real boot still restores the snapshot the previous process saves as it stops. Best effort: any failure is only logged. */
export function rehearseRestore(dbPath: string, worldId: string, factory: { rulesVersion: string; restore(runtime: never): unknown; canRestoreSnapshot?(v: string): boolean }): void {
  const t0 = performance.now();
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const r = db.prepare('SELECT tick, rules_version, snapshot FROM snapshots WHERE world_id = ? ORDER BY tick DESC LIMIT 1').get(worldId) as { tick: number; rules_version: string; snapshot: string } | undefined;
    if (!r || (r.rules_version !== factory.rulesVersion && !factory.canRestoreSnapshot?.(r.rules_version))) return;
    factory.restore((JSON.parse(r.snapshot) as { runtime: never }).runtime);
    console.log(`[standby] rehearsed the restore of tick ${r.tick} (read-only) in ${Math.round(performance.now() - t0)} ms`);
  } catch (e) { console.log(`[standby] restore rehearsal skipped: ${(e as Error).message}`); }
  finally { try { db?.close(); } catch { /* closed */ } }
}

export async function standby(warm: () => Promise<unknown> = async () => {}): Promise<void> {
  if (process.env.SIM_STANDBY !== '1') return;
  // best effort: whatever fails to load here fails the same way after the signal, where it is reported as before
  try { await warm(); } catch (e) { console.log(`[standby] warm-up incomplete: ${(e as Error).message}`); }
  await new Promise<void>((go) => {
    // signal listeners alone do not keep a process alive; a launcher that died meanwhile never sends the signal: go too
    const parent = process.ppid, hold = setInterval(() => { if (process.ppid !== parent) process.exit(0); }, 1000);
    const quit = () => process.exit(0);
    process.once('SIGTERM', quit); process.once('SIGINT', quit);
    process.once('SIGUSR2', () => { clearInterval(hold); process.off('SIGTERM', quit); process.off('SIGINT', quit); go(); });
    console.log(`${STANDBY_MARK} pid ${process.pid}`);
  });
  console.log('[standby] go');
}
