// Mounts the EDGE-CONTRACT-v1 surface under /v1/edge. Ledger verbs here; Comms registers its own.
import type {Context, Hono} from 'hono';
import {EDGE_CONTRACT, EdgeError, edgeBody, type EdgeDeps, type EdgeSoul} from './contract.ts';
import type {EdgeLedger} from './ledger/ledger.ts';
import {registerEdgeComms} from './comms/index.ts';
import {hereFrame} from './perception/here.ts';
import {aroundFrame} from './perception/around.ts';
import {registerEdgeEvents} from './events/index.ts';
import {mountIdempotency} from './events/idempotency.ts';
import {mountSchema,EDGE_ACT_VERBS} from './events/schema.ts';
import {mountBootRoutes} from './boot/routes.ts';
import {INTENT_VERBS} from './intents/intents.ts';
import {mountOutcomeRoutes} from './outcomes/routes.ts';
import {mountPersonalReminders} from './reminders/routes.ts';
import {registerEdgePlans} from './plans/index.ts';
import type {Plans} from './plans/plans.ts';
import {mountEdgeEyes} from './eyes/routes.ts';
import {mountBodyRoutes} from './body/routes.ts';
import {livePlatforms} from './eyes/platforms.ts';
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
  mountBootRoutes(app,deps,[...EDGE_ACT_VERBS,...INTENT_VERBS]);
  mountOutcomeRoutes(app,deps);
  mountBodyRoutes(app,deps);
  // EVENTS-v1: idempotency keys guard act/say/converse/plan writes; it must be mounted before those routes.
  mountIdempotency(app, deps);
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
  app.post('/v1/edge/act', wrap(async c => {const s = deps.soul(c); limit(s, 'act', 60); const body = await c.req.json().catch(() => { throw new EdgeError(400, 'invalid', 'body must be JSON {capability, params?, clientRef?} or {verb, target, …}'); }); return L.act(s, body ?? {});}));
  // perception/1 + intents/1 (Core-A, EDGE-CONTRACT-v1 §8): a compact first-person frame, and the dry run of act.
  app.get('/v1/edge/here', wrap(c => {const s = deps.soul(c); limit(s, 'here', 240); const modern=(c.req.query('include')??'').split(',').includes('doHere');return {tick: deps.host.engine.world.tick, here: hereFrame(L, s,{doHere:modern}),...(modern?{apiContract:'eden-edge/1.1'}:{})};}));
  // knowledge/1: look around / explore — more of what is near, places close by, and secret places found (remembered).
  app.get('/v1/edge/around', wrap(c => {const s = deps.soul(c); limit(s, 'around', 30); return {tick: deps.host.engine.world.tick, around: aroundFrame(L, s)};}));
  app.post('/v1/edge/resolve', wrap(async c => {const s = deps.soul(c); limit(s, 'resolve', 120); const body = await c.req.json().catch(() => { throw new EdgeError(400, 'invalid', 'body must be JSON {verb, target} or {capability}'); }); if (!body || typeof body !== 'object' || (body.verb === undefined && body.capability === undefined)) throw new EdgeError(400, 'invalid', 'body must be JSON {verb, target} or {capability}'); return {tick: deps.host.engine.world.tick, resolve: L.intents.dryRun(s, body)};}));
  app.get('/v1/edge/receipts/:id', wrap(c => {const s = deps.soul(c); const r = L.receipt(s.soulId, c.req.param('id') ?? ''); if (!r) throw new EdgeError(404, 'not-found', 'no such receipt for this Soul'); return {receipt: r};}));
  app.get('/v1/edge/public/souls/:soulId', wrap(c => L.publicSoul(c.req.param('soulId') ?? '')));
  app.get('/v1/edge/metrics', wrap(c => {const m = Number(c.req.query('minutes') ?? 60); return L.metrics(Number.isFinite(m) && m >= 1 && m <= 10080 ? m * 60_000 : 3600_000);}));
  // Public: map knowledge (names, kinds, enclosure, capacity, public schedule) never lists occupants (§5).
  app.get('/v1/edge/map', wrap(() => ({places: L.map()})));
  app.get('/v1/edge/platforms',wrap(()=>({worldId:deps.host.worldId,tick:deps.host.engine.world.tick,...livePlatforms(L)})));
  // Public: rides (carrier/1) for viewers — position, phase, route, riders' public names; no owner data.
  app.get('/v1/edge/rides', wrap(() => ({tick: deps.host.engine.world.tick, rides: L.rides()})));
  // Public: small things lying in the world (together/1 items put down by Souls) for viewers to draw; no owner data.
  app.get('/v1/edge/items', wrap(() => ({tick: deps.host.engine.world.tick, items: L.together.publicItems()})));
  // Eyes (M3): GET /v1/edge/view first-person sight + alt caption; render worker only when EDGE_EYES=<viewer url>.
  const eyes = mountEdgeEyes(app, deps);
  const comms = registerEdgeComms(app, deps, {stewardToken: process.env.EDGE_STEWARD_TOKEN || undefined, fading: process.env.EDGE_FADING === '1'});
  L.attachComms(comms);
  // EVENTS-v1 (tranche agent-minds M1/M2/M4): push stream (SSE + WS), digest, world.notice, server-side plans, schema.
  let plans: Plans | null = null;
  const events = registerEdgeEvents(app, deps, comms, {placeName: id => L.places.byId.get(id)?.name ?? null, planSummary: id => plans?.summary(id) ?? null,
    bootNotice: process.env.EDGE_BOOT_NOTICE === '1' ? `The world server restarted${deps.build ? ` (${deps.build})` : ''}. Plans and open acts carried on; read the digest if you missed anything.` : null});
  plans = registerEdgePlans(app, deps, comms, events, L);
  const reminders=mountPersonalReminders(app,deps,comms);
  mountSchema(app);
  const close = comms.close;
  return Object.assign(comms, {events, plans, close() { reminders.close(); plans?.close(); events.close(); eyes.close(); close(); }});
}
