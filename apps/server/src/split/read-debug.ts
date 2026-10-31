// Stage B (lane B-facade): diagnosis only (SIM_READ_DEBUG=1). What a Soul's `here` saw of the campfires around it, and the
// sight solids it read them against: the same facts from main's ledger and a read worker's, to compare by Soul.
import {Perception} from '../edge/perception/here.ts';
import {isCampfire} from '../edge/ledger/fire.ts';
import type {EdgeLedger} from '../edge/ledger/ledger.ts';
import type {EdgeSoul} from '../edge/contract.ts';

export function fireFacts(L: EdgeLedger, soul: EdgeSoul) {
  const P = new Perception(L, soul), w = (L as unknown as {mw: {world: {entities: Record<string, {pose: {p: number[]}; def?: string}>}}}).mw.world;
  const solids = P.solids(), out: unknown[] = [];
  for (const [id, e] of Object.entries(w.entities)) {
    if (!isCampfire(e as never)) continue;
    const at: [number, number] = [e.pose.p[0], e.pose.p[2]], d = P.dist(at); if (d > 80) continue;
    out.push({id, d, sees: P.sees(at), enc: L.enclosureAtPoint(at[0], at[1], 0), mine: P.enclosure});
  }
  const Q = P as unknown as {objectKinds: Map<string, string>};
  const things = P.things().map(t => `${t.kind === 'spot' ? (t.capability?.split(':')[0] ?? 'spot') : t.kind === 'object' ? (Q.objectKinds.get(t.id) ?? 'object') : t.kind}|${t.id}|${t.distance}`).filter(x => x.startsWith('fire'));
  return {name: soul.name, solids: solids.length, fires: out, things, entities: Object.keys(w.entities).length};
}
