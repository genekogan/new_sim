// L3 item 5 (server reliability, 2026-10-31): paged listings. On the live Eden 2026 copy one `capabilities` response was
// 9,218 offers / 2.86 MB (8,281 of them object actions, mostly "say you will come" to calendar items that are over) and
// one `observe` 4.16 MB (its `here.objects` listed all 8,293 objects the Soul may see). Agents read these into their
// context, so the listing is a page: everything within the Soul's reach, then the nearest of the rest, at most
// LISTING.max offers and LISTING.bytes of JSON; the rest is summarised and stays reachable by id or by words (act and
// resolve read the whole menu) or in full on request. Pure: callers pass where each entry is.
import type {EdgeCapability} from '../contract.ts';

export type LoadLevel = 'green' | 'amber' | 'red' | 'black';
type V2 = [number, number];
/** Where an entry is: a point, 'here' (at the Soul: its own place, a thing in hand), or null (no place: a gesture, a mark). */
export type Where = V2 | 'here' | null;

/** The dial (LOAD-CONTRACT §1, "menu listing radius"): green lists the nearest of everything (up to the page size),
 *  amber two 32 m cells, red and black one. Offers within REACH are listed at every level (still bounded by the page). */
export const LISTING = {max: 300, bytes: 90_000, reach: 30, radius: {green: Infinity, amber: 64, red: 32, black: 32} as Record<LoadLevel, number>};
/** Offers that answer someone (an invitation to me) or stop something lead and are always listed. */
const ALWAYS = new Set(['accept', 'decline', 'ask-to-stop', 'stand']);

export type Omitted = {count: number; byVerb: Record<string, number>; note: string};

const dist = (me: V2 | null, w: Where) => w === null || w === 'here' ? 0 : me ? Math.hypot(w[0] - me[0], w[1] - me[1]) : Infinity;

/** The page of a Soul's menu to list (original order kept: activities and invitations lead) and what it leaves out. */
export function pageCapabilities(caps: EdgeCapability[], whereOf: (c: EdgeCapability) => Where, me: V2 | null, level: LoadLevel = 'green'): {listed: EdgeCapability[]; omitted: Omitted | null} {
  const size = caps.map(c => JSON.stringify(c).length + 1), total = size.reduce((a, b) => a + b, 2);
  if (level === 'green' && caps.length <= LISTING.max && total <= LISTING.bytes) return {listed: caps, omitted: null};
  const radius = LISTING.radius[level];
  // rank: always-listed first, then entries without a place or at the Soul, then by distance (available before not)
  const ranked = caps.map((c, i) => {
    const w = whereOf(c), d = dist(me, w), always = ALWAYS.has(c.verb);
    const band = always ? 0 : w === null || w === 'here' ? 1 : d <= LISTING.reach ? 2 : d <= radius ? 3 : 9;
    return {i, band, d: c.available === false && !always ? d + 1e6 : d};
  }).filter(x => x.band < 9).sort((a, b) => a.band - b.band || a.d - b.d || a.i - b.i);
  const keep = new Set<number>(); let bytes = 2;
  for (const x of ranked) {
    if (keep.size >= LISTING.max || (bytes + size[x.i]! > LISTING.bytes && x.band > 0)) break;
    keep.add(x.i); bytes += size[x.i]!;
  }
  const listed = caps.filter((_, i) => keep.has(i)), left = caps.filter((_, i) => !keep.has(i));
  if (!left.length) return {listed, omitted: null};
  const byVerb: Record<string, number> = {}; for (const c of left) byVerb[c.verb] = (byVerb[c.verb] ?? 0) + 1;
  return {listed, omitted: {count: left.length, byVerb: Object.fromEntries(Object.entries(byVerb).sort((a, b) => b[1] - a[1]).slice(0, 12)),
    note: `${left.length} more offers farther off are not listed: act on one by id or in plain words (POST /v1/edge/resolve or /v1/edge/act), or GET /v1/edge/capabilities?all=1 for the whole list.`}};
}

/** A Soul's view of nearby objects: those here or within reach (not over), then per kind the nearest few (over ones last),
 *  bounded by LISTING.bytes; the rest counted by kind. */
export type ObjectView = {id: string; kind: string; here?: boolean; public?: unknown};
export const OBJECTS_PER_KIND = 6;
export function pageObjects<T extends ObjectView>(objs: T[], whereOf: (o: T) => Where, me: V2 | null): {listed: T[]; omitted: {count: number; byKind: Record<string, number>; note: string} | null} {
  const size = objs.map(o => JSON.stringify(o).length + 1), total = size.reduce((a, b) => a + b, 2);
  if (total <= LISTING.bytes / 3) return {listed: objs, omitted: null};
  const over = (o: T) => (o.public as {phase?: unknown} | undefined)?.phase === 'over';
  const ranked = objs.map((o, i) => {const w = whereOf(o), d = o.here ? 0 : dist(me, w); return {i, kind: o.kind, near: !over(o) && (o.here || d <= LISTING.reach), d: over(o) ? d + 1e6 : d};})
    .sort((a, b) => +b.near - +a.near || a.d - b.d || a.i - b.i);
  const keep = new Set<number>(), perKind = new Map<string, number>(); let bytes = 2;
  for (const x of ranked) {
    const n = perKind.get(x.kind) ?? 0;
    if (!x.near && n >= OBJECTS_PER_KIND) continue;
    if (bytes + size[x.i]! > LISTING.bytes / 3 && keep.size) break;
    keep.add(x.i); perKind.set(x.kind, n + 1); bytes += size[x.i]!;
  }
  const listed = objs.filter((_, i) => keep.has(i)), left = objs.filter((_, i) => !keep.has(i));
  if (!left.length) return {listed, omitted: null};
  const byKind: Record<string, number> = {}; for (const o of left) byKind[o.kind] = (byKind[o.kind] ?? 0) + 1;
  return {listed, omitted: {count: left.length, byKind, note: `${left.length} more objects farther off or over are not listed: GET /v1/edge/observe?include=objects for all of them.`}};
}
