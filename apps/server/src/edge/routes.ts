// Mounts the EDGE-CONTRACT-v1 surface under /v1/edge. Ledger verbs here; Comms registers its own.
import type {Context, Hono} from 'hono';
import {EDGE_CONTRACT, EdgeError, edgeBody, type EdgeDeps, type EdgeSoul} from './contract.ts';
import type {EdgeLedger} from './ledger/ledger.ts';
import {registerEdgeComms} from './comms/index.ts';
import type {WorldHost} from '../world.ts';
import type {Souls} from '../souls.ts';

export function edgeSoulResolver(host: WorldHost, souls: Souls, bearer: (c: Context) => string | undefined) {
  return (c: Context): EdgeSoul => {
    const s = souls.soulFromToken(bearer(c));
    if (!s || s.retired_at || s.world_id !== host.worldId) throw new EdgeError(401, 'unauthorized', 'missing or invalid Soul token; pair again (see the skill)');
    const m = host.minds.get(s.id); if (!m) throw new EdgeError(404, 'not-found', 'this Soul has no body in the world');
    return {soulId: s.id, entityId: m.entityId, name: m.name, owner: s.owner};
  };
}
export function mountEdgeRoutes(app: Hono, deps: EdgeDeps & {ledger: EdgeLedger}) {
  const L = deps.ledger;
  const wrap = (fn: (c: Context) => unknown | Promise<unknown>) => async (c: Context) => {
    c.header('Cache-Control', 'no-store');
    try {return c.json(edgeBody(await fn(c) as object));}
    catch (error) {
      if (error instanceof EdgeError) return c.json({contract: EDGE_CONTRACT, error: {code: error.code, message: error.message}}, error.status as 400);
      console.error('[edge] ledger fault', c.req.method, c.req.path, error instanceof Error ? (error.stack ?? error.message).split('\n').slice(0, 4).join(' | ') : String(error));
      return c.json({contract: EDGE_CONTRACT, error: {code: 'unavailable', message: 'the ledger could not answer; retry'}}, 503);
    }
  };
  const limit = (s: EdgeSoul, key: string, n: number) => {const r = deps.souls.limits.allow(`edge-${key}:${s.soulId}`, n, 60_000); if (!r.ok) throw new EdgeError(429, 'rate-limited', 'too many requests; slow down');};
  app.get('/v1/edge/observe', wrap(c => {const s = deps.soul(c); limit(s, 'observe', 240); return L.observe(s, new Set((c.req.query('include') ?? '').split(',').filter(Boolean)));}));
  app.get('/v1/edge/capabilities', wrap(c => {const s = deps.soul(c); limit(s, 'capabilities', 240); return {tick: deps.host.engine.world.tick, capabilities: L.capabilities(s)};}));
  app.post('/v1/edge/act', wrap(async c => {const s = deps.soul(c); limit(s, 'act', 60); const body = await c.req.json().catch(() => { throw new EdgeError(400, 'invalid', 'body must be JSON {capability, params?, clientRef?}'); }); return L.act(s, body ?? {});}));
  app.get('/v1/edge/receipts/:id', wrap(c => {const s = deps.soul(c); const r = L.receipt(s.soulId, c.req.param('id') ?? ''); if (!r) throw new EdgeError(404, 'not-found', 'no such receipt for this Soul'); return {receipt: r};}));
  app.get('/v1/edge/public/souls/:soulId', wrap(c => L.publicSoul(c.req.param('soulId') ?? '')));
  app.get('/v1/edge/metrics', wrap(c => {const m = Number(c.req.query('minutes') ?? 60); return L.metrics(Number.isFinite(m) && m >= 1 && m <= 10080 ? m * 60_000 : 3600_000);}));
  // Public: map knowledge (names, kinds, enclosure, capacity, public schedule) never lists occupants (§5).
  app.get('/v1/edge/map', wrap(() => ({places: L.map()})));
  const comms = registerEdgeComms(app, deps, {stewardToken: process.env.EDGE_STEWARD_TOKEN || undefined, fading: process.env.EDGE_FADING === '1'});
  L.attachComms(comms);
  return comms;
}
