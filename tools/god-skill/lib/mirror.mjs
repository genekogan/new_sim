// The world mirror: the god snapshot + a world-frame layout (poses, bounds, solid footprints, slots,
// rooms) cached in .eden-god.cache.json. Every command first asks the server for its edit seq (one
// tiny request); an unchanged seq means the cache is exact and nothing else is fetched. Offline
// (server unreachable) the cache is used as is and the command says so. `follow` keeps it fresh
// from the god SSE stream.
import { existsSync, readFileSync } from 'node:fs';
import { atomicWrite, call, load, ok } from './state.mjs';
import { isFlagDef } from './solver.mjs';
import { noticeInboxHeader } from './inbox-notice.mjs';

export const CACHE = '.eden-god.cache.json';
let memo = null;

function readCache() { try { return existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : null; } catch { return null; } }
function writeCache(c) { try { atomicWrite(CACHE, JSON.stringify(c)); } catch { /* read-only folder: memory only */ } }

/** The mirror, fresh unless the server is unreachable. `{ fresh: true }` refetches regardless. */
export async function mirror({ fresh = false } = {}) {
  const world = load().world;
  if (memo && memo.world === world && !fresh) {
    const s = await call('/v1/world/seq', { as: 'none', timeoutMs: 5000 });
    if (s.status === 0) return { ...memo, offline: true };
    if (s.data.seq === memo.seq && s.data.builds === memo.buildsRev) return memo;
  }
  const cached = memo?.world === world ? memo : readCache();
  const seqR = await call('/v1/world/seq', { as: 'none', timeoutMs: 5000 });
  if (seqR.status === 0) {
    if (cached && cached.world === world) { memo = cached; return { ...cached, offline: true }; }
    throw new Error(`world unreachable (${seqR.data.message}) and no cached mirror`);
  }
  if (!fresh && cached && cached.world === world && cached.seq === seqR.data.seq && cached.buildsRev === seqR.data.builds) { memo = cached; return cached; }
  const [snap, lay] = await Promise.all([call('/v1/god/snapshot'), call('/v1/god/query', { body: { layout: { obbs: true } } })]);
  const snapshot = ok(snap, 'snapshot'), layout = ok(lay, 'layout').layout;
  memo = build(world, snapshot, layout);
  writeCache(memo);
  return memo;
}
export function invalidate() { memo = null; }

function build(world, snapshot, layout) {
  return { world, seq: snapshot.seq, buildsRev: snapshot.buildsRev, at: Date.now(), extent: snapshot.constants.extent, snapshot, rows: layout.entities };
}

/** Index helpers over a mirror. */
export function view(m) {
  const byId = new Map(m.rows.map((r) => [r.id, r]));
  const byPath = new Map(m.rows.map((r) => [r.path, r]));
  const lib = new Map();
  // The god library carries active named revisions; in-use defs can also contain older hash-pinned content.
  for (const d of [...(m.snapshot.defs ?? []), ...(m.snapshot.library ?? [])]) { lib.set('sha:' + d.hash, d); lib.set(d.ref, d); if (d.ref.startsWith('core-')) lib.set('core/' + d.ref.slice(5), d); }
  const get = (ref) => {
    if (!ref) return null;
    const r = String(ref).replace(/^flag:/, '');
    return byId.get(r) ?? byPath.get(r) ?? m.rows.find((x) => x.name === r && x.parent === m.rows.find((p) => p.id === x.parent)?.id) ?? m.rows.find((x) => x.name === r) ?? m.rows.find((x) => isFlagDef(lib.get(x.def)?.ref ?? x.def) && m.snapshot.entities.find((e) => e.id === x.id)?.state?.label === r) ?? null;
  };
  const entity = (id) => m.snapshot.entities.find((e) => e.id === id) ?? null;
  const children = (id) => m.rows.filter((r) => r.parent === id);
  const def = (ref) => lib.get(ref) ?? lib.get(normDef(ref)) ?? null;
  const refs = [...new Set([...(m.snapshot.defs ?? []), ...(m.snapshot.library ?? [])].map((d) => d.ref).filter(Boolean))];
  return { m, rows: m.rows, byId, byPath, get, entity, children, def, refs, extent: m.extent };
}
export const normDef = (d) => (d.includes('@') || d.startsWith('sha:') ? d : `core/${d}@1`);
/** An unknown def ref that names exactly one library def (harvest P0 #8): `core/<local>@k` → `<local>@k`, `<name>` (no
 *  version) → its only version, `<name>@k` → `core/<name>@k`. Returns the library ref, or null when the ref is known,
 *  unknown, or ambiguous (several versions/namespaces), so the caller refuses as before. */
export function resolveDef(v, ref) {
  const s = String(ref ?? '').trim();
  if (!s || s.startsWith('sha:') || v.def(s)) return null;
  const m = /^(?:core[/-])?([a-z0-9][a-z0-9._-]*?)(?:@(\d+))?$/i.exec(s); if (!m) return null;
  const [, name, ver] = m, hits = new Set();
  for (const r of v.refs ?? []) {
    const d = /^(core[/-])?(.+)@(\d+)$/.exec(r);
    if (d && d[2] === name && (!ver || d[3] === ver)) hits.add(d[1] ? `core/${d[2]}@${d[3]}` : r);
  }
  return hits.size === 1 ? [...hits][0] : null;
}

/** follow [seconds]: keep the mirror fresh from the god stream (refetch on every diff). */
export async function follow(seconds = 3600, onEvent = () => {}) {
  const s = load();
  const r = await fetch(s.world + '/v1/god/stream', { headers: { authorization: `Bearer ${s.token}`, accept: 'text/event-stream' }, signal: AbortSignal.timeout(seconds * 1000) });
  noticeInboxHeader(r.headers);
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i); buf = buf.slice(i + 2); if (frame.startsWith(':')) continue;
        const ev = /^event: (.*)$/m.exec(frame)?.[1], data = /^data: (.*)$/m.exec(frame)?.[1];
        if (ev === 'diff') { invalidate(); await mirror({ fresh: true }); }
        if (ev) onEvent({ event: ev, data: data ? JSON.parse(data) : null });
      }
    }
  } catch { /* timeout or closed */ }
  return { ended: true };
}
