/** Shared outside flood for the building design check and post-placement admission. */
export function reachableFromOutside(edges: Iterable<readonly [string, string]>): Set<string> {
  const adj = new Map<string, Set<string>>();
  for (const [a, b] of edges) {
    (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
    (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
  }
  const seen = new Set(['outside']), queue = ['outside'];
  for (let i = 0; i < queue.length; i++) for (const next of adj.get(queue[i]) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  return seen;
}
