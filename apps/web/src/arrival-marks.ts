// Lane W1: User Timing marks along a page's arrival (sim:<name>, the first time each happens), for the speed probes
// (performance.getEntriesByType('mark')). One mark per name per page; never throws.
const marked = new Set<string>(), markedAt = new Map<string, number>(), waiting = new Map<string, Array<() => void>>();
export function arrivalMark(name: string) {
  if (marked.has(name)) return; marked.add(name);
  try { markedAt.set(name, performance.now()); } catch { /* no clock */ }
  try { performance.mark('sim:' + name); } catch { /* no User Timing */ }
  const w = waiting.get(name); waiting.delete(name); for (const fn of w ?? []) { try { fn(); } catch { /* a listener never breaks the arrival */ } }
}
/** Resolves the first time `name` is marked (at once if it already was). No timer: nothing polls while it waits. */
export function whenMarked(name: string): Promise<void> {
  if (marked.has(name)) return Promise.resolve();
  return new Promise((resolve) => { const w = waiting.get(name) ?? []; w.push(resolve); waiting.set(name, w); });
}
/** Whether this page's arrival is over: its card went away or its first live frame was drawn (or `fallbackMs` passed,
 *  for pages that never show either, e.g. a shot). Work nobody sees during the arrival waits for this. */
export function arrivalOver(fallbackMs = 20_000): boolean {
  if (marked.has('card-done') || marked.has('first-live-frame')) return true;
  try { return performance.now() > fallbackMs; } catch { return true; }
}

/** ?shot readiness (R, 3.16 lookcheck): resolves once the arrival card has gone and its .25 s fade is over (card-done
 *  plus `fadeMs`), or after `timeoutMs`, or on abort. A picture is never taken through the card. */
export function whenArrivalCardGone(opts: { timeoutMs?: number; fadeMs?: number; signal?: AbortSignal; now?: () => number; wait?: (fn: () => void) => void } = {}): Promise<boolean> {
  const now = opts.now ?? (() => performance.now()), wait = opts.wait ?? ((fn) => setTimeout(fn, 50));
  const fade = opts.fadeMs ?? 320, until = now() + (opts.timeoutMs ?? 15_000);
  return new Promise((resolve) => {
    const check = () => {
      if (opts.signal?.aborted) return resolve(false);
      const at = markedAt.get('card-done');
      if (at !== undefined && now() - at >= fade) return resolve(true);
      if (now() >= until) return resolve(false);
      wait(check);
    };
    check();
  });
}
