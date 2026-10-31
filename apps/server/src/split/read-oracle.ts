// Stage B (lane B-facade, items 5–6): the read oracle. The same Soul read answered by main's ledger (LiveMenuWorld) and
// by a read worker's ledger (ReplicaMenuWorld over the stream) must be equal field for field. `diffFields` lists the
// leaf paths that differ; `tradeOff` names the one permitted, agent-visible difference (an exit or offer whose admission
// verdict has not reached the replica yet: shown with an ETA until the verdict arrives, one delta), counted apart.

export type FieldDiff = {path: string; live: unknown; replica: unknown};

/** Leaf-level differences between two JSON-like values (arrays compared index by index; extra items reported once). */
export function diffFields(live: unknown, replica: unknown, path = '', out: FieldDiff[] = [], max = 50): FieldDiff[] {
  if (out.length >= max) return out;
  if (Object.is(live, replica)) return out;
  const lo = live !== null && typeof live === 'object', ro = replica !== null && typeof replica === 'object';
  if (!lo || !ro || Array.isArray(live) !== Array.isArray(replica)) {out.push({path: path || '.', live, replica}); return out;}
  if (Array.isArray(live)) {
    const a = live as unknown[], b = replica as unknown[];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (i >= a.length || i >= b.length) {out.push({path: `${path}[${i}]`, live: a[i], replica: b[i]}); break;}
      diffFields(a[i], b[i], `${path}[${i}]`, out, max);
    }
    return out;
  }
  const a = live as Record<string, unknown>, b = replica as Record<string, unknown>;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[k] === undefined && b[k] === undefined) continue;
    diffFields(a[k], b[k], path ? `${path}.${k}` : k, out, max);
  }
  return out;
}

/** The recorded trade-off: a `here` exit the live world refuses (reachable:false, why) that the replica, without the
 *  verdict yet, shows with an ETA. Every other difference is a miss. */
export function isTradeOff(d: FieldDiff): boolean {
  if (!/^exits\[\d+\]\.(reachable|why|eta)$/.test(d.path) && !/^(capabilities|caps)\[\d+\]\.(available|why|code|reason)$/.test(d.path)) return false;
  return true;
}

export type OracleTally = {reads: number; equal: number; tradeOff: number; miss: number; examples: {read: string; soulId: string; diffs: FieldDiff[]}[]};
export const tally = (): OracleTally => ({reads: 0, equal: 0, tradeOff: 0, miss: 0, examples: []});
/** Count one comparison: equal, trade-off only, or a miss (first few kept as examples). */
export function record(t: OracleTally, read: string, soulId: string, diffs: FieldDiff[]) {
  t.reads++;
  if (!diffs.length) {t.equal++; return;}
  if (diffs.every(isTradeOff)) {t.tradeOff++; return;}
  t.miss++; if (t.examples.length < 8) t.examples.push({read, soulId, diffs: diffs.filter(d => !isTradeOff(d)).slice(0, 6)});
}
