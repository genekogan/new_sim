// Pre-warm for a release handover (keeper.mjs, lane r31t): with SIM_STANDBY=1 a world process loads all of its code,
// prints STANDBY_MARK and then waits for SIGUSR2 before it opens its database or its port. The launcher starts it while
// the previous release's process still serves the world, stops that one (snapshot saved, process gone), then sends
// SIGUSR2: the visible pause is only the stop plus opening the data, not the module loading. Nothing is opened before
// the signal, so the world still has exactly one writer. SIGTERM while waiting exits at once (nothing to save).
import { DatabaseSync } from 'node:sqlite';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

export const STANDBY_MARK = '[standby] ready';

/** G9 (lane Z1): the pre-warm also runs the boot's heaviest step once, on a READ-ONLY connection (it cannot write: SQLite
 *  refuses), so the restore after the signal runs warm code over cached pages. The rehearsed engine is thrown away: the
 *  real boot still restores the snapshot the previous process saves as it stops. Best effort: any failure is only logged. */
export function rehearseRestore(dbPath: string, worldId: string, factory: { rulesVersion: string; restore(runtime: never): unknown; canRestoreSnapshot?(v: string): boolean }, prepare?: (db: DatabaseSync) => void): void {
  // (lane Z1b) a restored Mars engine also builds its static navigation grids here and keeps them for the boot after
  // the go (MarsEngine.warmStaticGridsForBootV1): that boot's first tick otherwise builds them inside the pause
  const t0 = performance.now();
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    prepare?.(db);   // what the boot registers before it restores (an entity world's ground recipes)
    const r = db.prepare('SELECT tick, rules_version, snapshot FROM snapshots WHERE world_id = ? ORDER BY tick DESC LIMIT 1').get(worldId) as { tick: number; rules_version: string; snapshot: string } | undefined;
    if (!r || (r.rules_version !== factory.rulesVersion && !factory.canRestoreSnapshot?.(r.rules_version))) return;
    const engine = factory.restore((JSON.parse(r.snapshot) as { runtime: never }).runtime) as { warmStaticGridsForBootV1?(): number } | undefined;
    const restored = performance.now(), kept = engine?.warmStaticGridsForBootV1?.() ?? 0;
    console.log(`[standby] rehearsed the restore of tick ${r.tick} (read-only) in ${Math.round(restored - t0)} ms${kept ? `; built its static grids for the boot in ${Math.round(performance.now() - restored)} ms` : ''}`);
  } catch (e) { console.log(`[standby] restore rehearsal skipped: ${(e as Error).message}`); }
  finally { try { db?.close(); } catch { /* closed */ } }
  collectRehearsal();
}

/** (lane Z1b) One full garbage collection after the rehearsal, still before the go: the thrown-away engine is otherwise
 *  collected lazily and the world keeps its pages (Eden's fork ran ~220 MB bigger). Best effort. */
function collectRehearsal(): void {
  try { setFlagsFromString('--expose-gc'); (runInNewContext('gc') as () => void)(); } catch { /* no gc: the heap shrinks later */ }
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
