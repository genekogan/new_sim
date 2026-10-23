// Lane W3 (2026-10-19): the viewer's world snapshot on the wire (server: apps/server/src/god/snapshot-wire.ts).
// `?defs=ref` returns the snapshot without its defs, ground and default-valued entity params; defs and ground come as
// content-addressed, immutable parts (/v1/world/part/<ref>: one download per browser, shared by every world and visit
// with the same set). expandSnapshot puts it back together exactly as the plain snapshot, so WorldModel.fromSnapshot
// and everything after it see no difference. Any failure falls back to the plain snapshot.
import { isPackedColumnsV1, unpackColumnsV1 } from '@sim/protocol/columns-v1';
import { entryWireUrl, takeSnapshotPrefetch, takePartPrefetch } from './snapshot-prefetch.ts';

type Spec = Record<string, { default?: unknown } | undefined>;
type Def = { name?: string; version?: number; params?: Spec };
type Entity = { def?: string; params?: Record<string, unknown> };
export type WireBody = Record<string, unknown> & { defsRef?: string; groundRef?: string; paramsDefaulted?: boolean; entities?: Entity[] | { $columnsV1: unknown } };

/** The plain snapshot from its wire pieces (params back in their def's order, as the server writes them). */
export function expandSnapshot(body: WireBody, defs: Def[], ground: unknown): Record<string, unknown> {
  const { defsRef: _d, groundRef: _g, paramsDefaulted, entities: wired = [], ...rest } = body;
  // columns/1 (lane JOINSET, `cols=1`): the entities in the column form, put back exactly first
  const entities = (isPackedColumnsV1(wired) ? unpackColumnsV1(wired) : wired) as Entity[];
  const specs = new Map(defs.map((d) => [`${d.name}@${d.version}`, d.params ?? {}]));
  const full = !paramsDefaulted ? entities : entities.map((e) => {
    const spec = e.def ? specs.get(e.def) : undefined; if (!e.params || !spec) return e;
    const params: Record<string, unknown> = {};
    for (const [k, s] of Object.entries(spec)) { if (k in e.params) params[k] = e.params[k]; else if (s && typeof s === 'object' && 'default' in s) params[k] = s.default; }
    for (const [k, v] of Object.entries(e.params)) if (!(k in params)) params[k] = v;
    return { ...e, params };
  });
  return { ...rest, ground, defs, entities: full };
}

/** PF2 (2026-10-20): a page-entry request (the snapshot, its parts) that has not answered in this long is asked for again
 *  beside it and the first answer wins. Nothing else bounds them: one stalled request held the arrival until it ended
 *  (live phone Eden 2026 with the snapshot held 20 s / 45 s arrived at 20.9 s / 45.9 s). Live answers in ~0.1-0.4 s. */
export const ENTRY_HEDGE_MS = 4_000;

/** `first`, or, when it has not answered within `ms`, whichever of it and `again()` answers first; fails when both have. */
export function hedged(first: Promise<Response>, again: () => Promise<Response>, ms = ENTRY_HEDGE_MS): Promise<Response> {
  return new Promise((resolve, reject) => {
    let settled = false, out = 1;
    const win = (r: Response) => { if (!settled) { settled = true; clearTimeout(timer); resolve(r); } };
    const lose = (e: unknown) => { if (--out === 0 && !settled) { settled = true; clearTimeout(timer); reject(e); } };
    const timer = setTimeout(() => { if (settled) return; out++; try { again().then(win, lose); } catch (e) { lose(e); } }, ms);
    first.then(win, lose);
  });
}

export type Loaded = { snap: Record<string, unknown>; response: Response };
/** The world snapshot for a viewer: the wire form when the server speaks it, else the plain one. `first` takes the
 *  page-entry prefetch (snapshot-prefetch.ts) and its edge-cacheable key. `response` is the snapshot's own (headers:
 *  moderation version, Age). Null when the world answered with an error. */
export async function loadSnapshot(plainUrl: string, signal: AbortSignal, first = false): Promise<Loaded | null> {
  const plain = async (): Promise<Loaded | null> => { const r = await fetch(plainUrl, { signal }); return r.ok ? { snap: await r.json() as Record<string, unknown>, response: r } : null; };
  try {
    const url = first ? entryWireUrl(plainUrl) : `${plainUrl}?defs=ref&cols=1`;
    const again = () => fetch(url, { signal });
    const r = await (first ? hedged(takeSnapshotPrefetch(url) ?? again(), again) : again());
    if (!r.ok) return plain();
    const defsRef = r.headers.get('x-defs-ref'), groundRef = r.headers.get('x-ground-ref');
    if (!defsRef || !groundRef) { const snap = await r.json() as Record<string, unknown>; return 'defsRef' in snap ? plain() : { snap, response: r }; } // an older server answers plainly; a wire body without its part headers is asked for again plainly
    const part = async (ref: string) => { const get = () => fetch(plainUrl.replace(/\/v1\/world\/snapshot$/, `/v1/world/part/${ref}`), { signal });
      const pre = takePartPrefetch(ref), p = await (first ? hedged(pre ?? get(), get) : pre ?? get()); if (!p.ok) throw Error(`part ${p.status}`); return p.json(); };
    const [body, defs, ground] = await Promise.all([r.json() as Promise<WireBody>, part(defsRef), part(groundRef)]);
    if (body.defsRef !== defsRef || body.groundRef !== groundRef || !Array.isArray(defs)) return plain();
    return { snap: expandSnapshot(body, defs, ground), response: r };
  } catch (e) { if (signal.aborted) throw e; return plain(); }
}
