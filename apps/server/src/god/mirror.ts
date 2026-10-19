// G2 (tranche 2026-10-19): the CLI's world mirror as deltas.
//
// The CLI keeps a mirror: the god snapshot plus the layout rows (query `layout`). It used to refetch both after
// every edit and whenever the seq moved: ~320 KB gzip per edit in a small world, 1.6 MB of it the library.
// Here the server remembers, for the last few mirror states it handed out, a hash per layout row and per snapshot
// entity, and answers "what changed since the state with this guard hash" with only the changed rows/entities, the
// ids that went, the small top-level fields, the in-use defs only when they changed, and the library only when the
// client's library hash differs. The guard hash (over every id and row/entity hash, in order) lets the client check
// its patched mirror against the server's and refresh in full on any mismatch. The diff is by content, so
// neighbours that an edit touched (slot use, a parent's children) come along without knowing why they changed.
import { createHash } from 'node:crypto';
import type { GodMode } from './god.ts';
import { runQuery } from './query.ts';

export type MirrorWant = { since?: number; builds?: number; have?: string; lib?: string };
type State = { guard: string; seq: number; rows: Map<string, string>; ents: Map<string, string>; defs: string; order: string[] };
const KEEP = 16;
const memo = new WeakMap<object, State[]>();
/** Same function as the CLI's (tools/god-skill/lib/mirror.mjs): sha1, base64url, 16 chars. */
export const mirrorHash = (s: string) => createHash('sha1').update(s).digest('base64url').slice(0, 16);
const guardOf = (rows: [string, string][], ents: [string, string][], defs: string) =>
  mirrorHash(`${rows.map(([id, h]) => `${id}:${h}`).join(',')}|${ents.map(([id, h]) => `${id}:${h}`).join(',')}|${defs}`);

/** The library's identity: the shared library's id@version plus the world's own named defs (content-hashed). A library
 *  def the world adopted on first use is the same def (and the same object): it does not change the identity, so the
 *  client keeps its copy (only the list order differs, which no reader depends on). */
export function libraryHash(god: GodMode) {
  const m = god.model, own = [...m.defs.keys()].filter((k) => !k.startsWith('sha:') && m.library?.get(m.defs.get(k)!.ref) !== m.defs.get(k)).map((k) => `${k}:${m.defs.get(k)!.hash}`);
  return mirrorHash(`${m.library ? `${m.library.id}@${m.library.version}` : '-'}|${own.join(',')}`);
}

/** Is the client's mirror current (same edit seq and builds revision: the rule GET /v1/world/seq gave the CLI)? Cheap. */
export const mirrorCurrent = (god: GodMode, want: MirrorWant) => want.since === god.model.editSeq && want.builds === god.builds.publicList().rev;

/** The mirror for a client that has `want` (or nothing): a delta when the server still knows the client's state,
 *  else the whole mirror (without the library when the client's library hash matches). `child`: a helper token
 *  (no prayers, as in GET /v1/god/snapshot). */
export function mirrorPayload(god: GodMode, want: MirrorWant = {}, { child = false } = {}) {
  const lib = libraryHash(god), withLib = want.lib !== lib;
  const snap = god.godSnapshotOf(withLib) as Record<string, unknown> & { entities: { id: string }[]; defs: unknown[]; library?: unknown[] };
  if (child) snap.prayers = [];
  const rows = (runQuery(god.model, { layout: { obbs: true } }).layout as { entities: { id: string }[] }).entities;
  const rowH: [string, string][] = rows.map((r) => [r.id, mirrorHash(JSON.stringify(r))]);
  const entH: [string, string][] = snap.entities.map((e) => [e.id, mirrorHash(JSON.stringify(e))]);
  const defsH = mirrorHash(JSON.stringify(snap.defs));
  const guard = guardOf(rowH, entH, defsH);
  const states = memo.get(god) ?? [];
  const base = want.have ? states.find((s) => s.guard === want.have) : undefined;
  const now: State = { guard, seq: snap.seq as number, rows: new Map(rowH), ents: new Map(entH), defs: defsH, order: rowH.map(([id]) => id) };
  if (!states.some((s) => s.guard === guard)) { states.push(now); if (states.length > KEEP) states.shift(); memo.set(god, states); }
  const { entities, defs, library, ...top } = snap;
  const head = { contract: 'mirror/1', seq: snap.seq, buildsRev: snap.buildsRev, guard, libraryHash: lib, ...(withLib ? { library } : {}) };
  if (!base) return { ...head, full: true, top, entities, defs, rows };
  const changed = <T extends { id: string }>(list: T[], hs: [string, string][], was: Map<string, string>) => list.filter((x, i) => was.get(x.id) !== hs[i][1]);
  const gone = (was: Map<string, string>, is: Map<string, string>) => [...was.keys()].filter((id) => !is.has(id));
  // Row order is the model's insertion order: an entity an edit replaced moves to the end. `rowsTail` is the shortest
  // suffix of the current order after which the rest is in the client's order: the client keeps its other rows where
  // they are and appends these (changed or not) in this order.
  const pos = new Map(base.order.map((id, i) => [id, i])), ids = now.order;
  let q = 0; for (let last = -1; q < ids.length; q++) { const p = pos.get(ids[q]); if (p === undefined || p <= last) break; last = p; }
  return {
    ...head, full: false, since: base.guard, top, rowsTail: ids.slice(q),
    entities: changed(entities, entH, base.ents), entitiesGone: gone(base.ents, now.ents),
    rows: changed(rows, rowH, base.rows), rowsGone: gone(base.rows, now.rows),
    ...(defsH !== base.defs ? { defs } : {}),
  };
}
