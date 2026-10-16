// Pre-warm for a release handover (keeper.mjs, lane r31t): with SIM_STANDBY=1 a world process loads all of its code,
// prints STANDBY_MARK and then waits for SIGUSR2 before it opens its database or its port. The launcher starts it while
// the previous release's process still serves the world, stops that one (snapshot saved, process gone), then sends
// SIGUSR2: the visible pause is only the stop plus opening the data, not the module loading. Nothing is opened before
// the signal, so the world still has exactly one writer. SIGTERM while waiting exits at once (nothing to save).
export const STANDBY_MARK = '[standby] ready';

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
