// strict/1 (EDGE-CONTRACT-v1 §8.4): an id-shaped target that names nothing in this world is refused, never
// swapped for something else. `walk:eden-pond-north` (no such place) used to resolve to the nearest walkable place
// and "complete". Plain words keep resolving (walk:pond, "walk to the pond", "go for a swim").
import type {WorldState as NativeWorld} from '../../../../../mars/viewer/engine/world/types.ts';
import type {EdgeLedger} from '../ledger/ledger.ts';
import type {EdgeCapability, EdgeSoul} from '../contract.ts';

/** An id, not words: lower-case, no spaces, at least one of - . _ (e.g. eden-pond-north, region-park.pond, s_123). */
export const ID_SHAPED = /^[a-z0-9]+(?:[-._][a-z0-9]+)+$/;

/** Every id a capability target may name here: capability targets, places, Souls, engine bodies and fixtures,
 *  activity spots, lasting objects, items and invitations. */
export function knownIds(ledger: EdgeLedger, caps: EdgeCapability[]): Set<string> {
  const out = new Set<string>();
  for (const c of caps) {out.add(c.id.slice(c.id.indexOf(':') + 1)); if (c.target) out.add(c.target.id); if (c.object) out.add(c.object);}
  for (const id of ledger.places.byId.keys()) out.add(id);
  for (const m of ledger.host.minds.values()) out.add(m.soulId);
  for (const id of Object.keys((ledger.mw.world as NativeWorld).entities)) out.add(id);
  for (const s of ledger.spots.spots) out.add(s.id);
  try {for (const o of ledger.comms?.objects.all() ?? []) out.add(o.id);} catch {/* objects optional */}
  try {for (const i of ledger.together.publicItems()) out.add(i.id);} catch {/* items optional */}
  return out;
}

export type StrictRefusal = {code: string; reason: string; did_you_mean: {id: string; label: string}[]};

/** `verb:<id>` where <id> is id-shaped and names nothing here → a refusal (with the closest offered ids). */
export function strictCheck(ledger: EdgeLedger, soul: EdgeSoul, input: string, caps: EdgeCapability[]): StrictRefusal | null {
  const i = input.indexOf(':'); if (i <= 0) return null;
  const verb = input.slice(0, i).trim().toLowerCase(), target = input.slice(i + 1).trim();
  if (!ID_SHAPED.test(target) || caps.some(c => c.id === input)) return null;
  if (verb === 'accept' || verb === 'decline') return null;          // invitation ids are checked by together/1
  const known = knownIds(ledger, caps); if (known.has(target)) return null;
  // the closest real ids: same verb first, by shared words
  const words = target.split(/[-._]+/).filter(w => w.length > 2 && w !== 'eden');
  const score = (c: EdgeCapability) => (c.verb === verb ? 10 : 0) + (c.target?.kind === 'place' ? 2 : 0) + words.filter(w => (c.id + ' ' + c.label).toLowerCase().includes(w)).length * 3 + (c.available ? 1 : 0);
  const did = caps.filter(c => words.some(w => (c.id + ' ' + c.label).toLowerCase().includes(w)) || c.verb === verb).map(c => ({c, s: score(c)}))
    .sort((a, b) => b.s - a.s || a.c.id.localeCompare(b.c.id)).slice(0, 5).map(({c}) => ({id: c.id, label: c.label}));
  void soul;
  return {code: 'capability.unknown', reason: `"${target}" is not an id in this world (no place, Soul or thing has it), so nothing was done. Use an id from capabilities or the map, or say it in plain words.`, did_you_mean: did};
}
