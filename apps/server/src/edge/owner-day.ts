// OWNER-DAY: "what my Soul did today", for its owner only. A read-only view over the Soul's own
// ledger records: terminal and open act receipts (what it did), the world's refusals with its reason,
// and the Soul's own speech (what it said). Every entry carries where it happened so the page can
// move the camera there. Nothing here is another owner's private text: only this Soul's rows.
import type {Context, Hono} from 'hono';
import {EDGE_CONTRACT, EdgeError, type EdgeSoul} from './contract.ts';
import type {EdgeLedger} from './ledger/ledger.ts';
import type {Db} from '../db.ts';

export type DayEntry = {
  at: number; kind: 'did' | 'doing' | 'stopped' | 'refused' | 'said';
  text: string; reason?: string; code?: string;
  where: {x: number; z: number} | null; place?: string | null;
};

const PAST: Record<string, string> = {
  walk: 'walked to', go: 'went to', sit: 'sat down', rest: 'rested', stand: 'stood', look: 'looked', swim: 'swam',
  hug: 'hugged', make: 'made', 'pick-up': 'picked up', 'put-down': 'put down', accept: 'accepted an invitation',
  decline: 'declined an invitation', wave: 'waved', dance: 'danced', play: 'played', eat: 'ate', drink: 'drank',
  follow: 'followed', give: 'gave', greet: 'greeted', sleep: 'slept', read: 'read', watch: 'watched', visit: 'visited',
};
const DAY_MS = 86_400_000, MAX = 200;

/** Human words for a capability id like `walk:place_bakery`, `object:ride-eden-balloon:join` or `rest:here`. */
export function describeCapability(cap: string, nameOf: (id: string) => string | null): string {
  const [verb = cap, ...rest] = cap.split(':');
  if (verb === 'object') { const [obj = '', action = 'use'] = rest; return `${action === 'join' ? 'joined' : action.replace(/-/g, ' ')} ${nameOf(obj) ?? obj.replace(/[-_]/g, ' ')}`.trim(); }
  const target = rest.join(':'), named = !target || target === 'here' || target === 'ahead' ? '' : (nameOf(target) ?? target.replace(/[-_]/g, ' '));
  return `${PAST[verb] ?? verb.replace(/-/g, ' ')}${named ? ` ${named}` : ''}`;
}

const xz = (p: unknown): {x: number; z: number} | null => Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number' ? {x: p[0], z: p[1]} : null;

export function ownerDay(L: EdgeLedger, db: Db, soulId: string, since: number): DayEntry[] {
  const w = L.host.worldId, sql = db.db;
  const nameOf = (id: string) => L.places.byId.get(id)?.name ?? (L.host.nameOf(id) !== id ? L.host.nameOf(id) : null);
  const out: DayEntry[] = [];
  const ids = sql.prepare('SELECT receipt_id FROM edge_receipts_v1 WHERE world_id=? AND soul_id=? AND created_at>=? ORDER BY created_at DESC LIMIT ?').all(w, soulId, since, MAX) as {receipt_id: string}[];
  const created = sql.prepare('SELECT created_at FROM edge_receipts_v1 WHERE world_id=? AND receipt_id=?');
  for (const {receipt_id} of ids) {
    const r = L.receipt(soulId, receipt_id); if (!r) continue;
    const at = (created.get(w, receipt_id) as {created_at: number}).created_at;
    const end = r.endedAt as {pos?: unknown; place?: unknown} | undefined;
    const place = typeof end?.place === 'string' ? (nameOf(end.place) ?? end.place) : null;
    const text = describeCapability(r.capability, nameOf);
    if (r.phase === 'completed') out.push({at, kind: 'did', text, where: xz(end?.pos), place});
    else if (r.phase === 'started' || r.phase === 'waiting') out.push({at, kind: 'doing', text, where: xz(end?.pos), place});
    // `replaced` is the Soul's own next act taking over: not a failure worth an owner's attention.
    else if (r.phase === 'failed') out.push({at, kind: 'stopped', text, where: xz(end?.pos), place, ...(r.reason ? {reason: r.reason} : {}), ...(r.code ? {code: r.code} : {})});
  }
  const cols = new Set((sql.prepare('PRAGMA table_info(edge_refusals_v1)').all() as {name: string}[]).map(c => c.name));
  if (cols.has('reason')) for (const f of sql.prepare('SELECT at,capability,code,reason,x,z FROM edge_refusals_v1 WHERE world_id=? AND soul_id=? AND at>=? ORDER BY at DESC LIMIT ?').all(w, soulId, since, MAX) as {at: number; capability: string; code: string; reason: string | null; x: number | null; z: number | null}[])
    out.push({at: f.at, kind: 'refused', text: `tried: ${describeCapability(f.capability, nameOf)}`, code: f.code, reason: f.reason || `the world said no (${f.code})`, where: f.x == null || f.z == null ? null : {x: f.x, z: f.z}});
  if (sql.prepare("SELECT 1 FROM sqlite_master WHERE name='edge_comms_speech'").get())
    for (const s of sql.prepare('SELECT at,text FROM edge_comms_speech WHERE world_id=? AND soul_id=? AND at>=? ORDER BY at DESC LIMIT ?').all(w, soulId, since, MAX) as {at: number; text: string}[])
      out.push({at: s.at, kind: 'said', text: s.text, where: null});
  out.sort((a, b) => a.at - b.at);
  // Speech carries no position of its own: it happened where the body was at the act just before it.
  let last: {x: number; z: number} | null = null;
  for (const e of out) { if (e.where) last = e.where; else if (e.kind === 'said') e.where = last; }
  return out.slice(-MAX);
}

/** GET /v1/souls/:id/day?since=<ms>: owner-scoped (another account gets 403 from ownerSoul). */
export function mountOwnerDay(app: Hono, deps: {ledger: EdgeLedger; db: Db; ownerSoul?: (c: Context, id: string) => Promise<EdgeSoul>; now?: () => number}) {
  if (!deps.ownerSoul) return;
  app.get('/v1/souls/:id/day', async c => {
    c.header('Cache-Control', 'no-store');
    try {
      const s = await deps.ownerSoul!(c, c.req.param('id') ?? '');
      const now = (deps.now ?? Date.now)(), asked = Number(c.req.query('since'));
      const since = Number.isFinite(asked) && asked > 0 ? Math.max(asked, now - 2 * DAY_MS) : now - DAY_MS;
      return c.json({contract: EDGE_CONTRACT, soul: {id: s.soulId, name: s.name}, since, entries: ownerDay(deps.ledger, deps.db, s.soulId, since)});
    } catch (error) {
      if (error instanceof EdgeError) return c.json({contract: EDGE_CONTRACT, error: {code: error.code, message: error.message}}, error.status as 403);
      throw error;
    }
  });
}
