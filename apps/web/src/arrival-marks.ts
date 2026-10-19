// Lane W1: User Timing marks along a page's arrival (sim:<name>, the first time each happens), for the speed probes
// (performance.getEntriesByType('mark')). One mark per name per page; never throws.
const marked = new Set<string>();
export function arrivalMark(name: string) {
  if (marked.has(name)) return; marked.add(name);
  try { performance.mark('sim:' + name); } catch { /* no User Timing */ }
}
/** Whether this page's arrival is over: its card went away or its first live frame was drawn (or `fallbackMs` passed,
 *  for pages that never show either, e.g. a shot). Work nobody sees during the arrival waits for this. */
export function arrivalOver(fallbackMs = 20_000): boolean {
  if (marked.has('card-done') || marked.has('first-live-frame')) return true;
  try { return performance.now() > fallbackMs; } catch { return true; }
}
