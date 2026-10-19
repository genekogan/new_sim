// Lane W1: User Timing marks along a page's arrival (sim:<name>, the first time each happens), for the speed probes
// (performance.getEntriesByType('mark')). One mark per name per page; never throws.
const marked = new Set<string>();
export function arrivalMark(name: string) {
  if (marked.has(name)) return; marked.add(name);
  try { performance.mark('sim:' + name); } catch { /* no User Timing */ }
}
