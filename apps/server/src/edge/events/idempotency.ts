// EVENTS-v1 robustness: idempotency keys on act / say / converse / plan writes. A retry after a 502 with the same
// `Idempotency-Key` header (or `idempotencyKey` body field) returns the original response instead of acting twice.
// Responses are kept 24 h per Soul and route; 5xx/429 answers are not kept (a retry should really retry).
import {createHash} from 'node:crypto';
import type {Context, Hono, MiddlewareHandler} from 'hono';
import {EDGE_CONTRACT, EdgeError, type EdgeDeps} from '../contract.ts';

export const IDEMPOTENCY_TTL_MS = 24 * 3600_000;
const KEY = /^[\x21-\x7e]{1,100}$/;

export function idempotency(deps: EdgeDeps, now: () => number = Date.now): MiddlewareHandler {
  const db = deps.db.db, world = deps.host.worldId;
  db.exec('CREATE TABLE IF NOT EXISTS edge_idempotency_v1 (world_id TEXT NOT NULL, soul_id TEXT NOT NULL, route TEXT NOT NULL, key TEXT NOT NULL, hash TEXT NOT NULL, status INTEGER NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (world_id, soul_id, route, key)) WITHOUT ROWID;');
  const inflight = new Map<string, Promise<void>>(), seen = new WeakSet<Request>();
  let writes = 0;
  return async (c: Context, next) => {
    if (c.req.method !== 'POST' && c.req.method !== 'PATCH' && c.req.method !== 'DELETE') return next();
    if (seen.has(c.req.raw)) return next();               // mounted on overlapping paths: once per request
    seen.add(c.req.raw);
    let body: unknown = undefined, text = '';
    try { text = await c.req.text(); body = text ? JSON.parse(text) : undefined; } catch { /* the route reports bad JSON */ }
    const fromBody = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).idempotencyKey : undefined;
    const key = c.req.header('idempotency-key') ?? (typeof fromBody === 'string' ? fromBody : undefined);
    if (key === undefined) return next();
    if (!KEY.test(key)) return c.json({contract: EDGE_CONTRACT, error: {code: 'invalid', message: 'Idempotency-Key must be 1..100 printable characters'}}, 400);
    let soulId: string;
    try { soulId = deps.soul(c).soulId; } catch (error) { if (error instanceof EdgeError) return next(); throw error; }
    const route = `${c.req.method} ${c.req.path}`, id = `${soulId}|${route}|${key}`;
    const hash = createHash('sha256').update(text.replace(/"idempotencyKey"\s*:\s*"[^"]*"\s*,?/, '')).digest('hex').slice(0, 32);
    const stored = () => db.prepare('SELECT hash, status, body FROM edge_idempotency_v1 WHERE world_id = ? AND soul_id = ? AND route = ? AND key = ? AND at >= ?').get(world, soulId, route, key, now() - IDEMPOTENCY_TTL_MS) as {hash: string; status: number; body: string} | undefined;
    const replay = (s: {hash: string; status: number; body: string}) => {
      if (s.hash !== hash) return c.json({contract: EDGE_CONTRACT, error: {code: 'idempotency-key-reused', message: 'this Idempotency-Key was already used with a different request body'}}, 409);
      c.header('Idempotent-Replay', 'true');
      return c.body(s.body, s.status as 200, {'content-type': 'application/json'});
    };
    const prior = inflight.get(id);
    if (prior) { await prior; const s = stored(); if (s) return replay(s); }
    else { const s = stored(); if (s) return replay(s); }
    let done!: () => void;
    inflight.set(id, new Promise<void>(res => { done = res; }));
    try {
      await next();
      const res = c.res;
      if (res && res.status < 500 && res.status !== 429) {
        const out = await res.clone().text();
        db.prepare('INSERT OR REPLACE INTO edge_idempotency_v1 (world_id, soul_id, route, key, hash, status, body, at) VALUES (?,?,?,?,?,?,?,?)').run(world, soulId, route, key, hash, res.status, out, now());
        if (++writes % 200 === 0) db.prepare('DELETE FROM edge_idempotency_v1 WHERE world_id = ? AND at < ?').run(world, now() - IDEMPOTENCY_TTL_MS);
      }
    } finally { inflight.delete(id); done(); }
  };
}

/** Mount before the routes it guards (Hono runs middleware in registration order). */
export function mountIdempotency(app: Hono, deps: EdgeDeps, now?: () => number) {
  const mw = idempotency(deps, now);
  for (const path of ['/v1/edge/act', '/v1/edge/say', '/v1/edge/converse', '/v1/edge/plan', '/v1/edge/plan/*', '/v1/edge/objects/*']) app.use(path, mw);
}
