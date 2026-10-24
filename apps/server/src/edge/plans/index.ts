// /v1/edge/plan routes (EVENTS-v1 §plans): POST a plan, GET the current one or one by id, PATCH it, DELETE (cancel).
import type {Context, Hono} from 'hono';
import type {ContentfulStatusCode} from 'hono/utils/http-status';
import {EdgeError, edgeBody, type EdgeDeps, type EdgeReceipt, type EdgeSoul, edgeErrorOf} from '../contract.ts';
import type {CommsRuntime} from '../comms/index.ts';
import {say} from '../comms/speech.ts';
import type {EventsRuntime} from '../events/index.ts';
import {Plans, type PlanActor} from './plans.ts';

export type PlanLedger = {act(soul: EdgeSoul, input: Record<string, unknown>): Promise<unknown>; receipt(soulId: string, id: string): EdgeReceipt | null};

export function registerEdgePlans(app: Hono, deps: EdgeDeps, comms: CommsRuntime, events: EventsRuntime, ledger: PlanLedger, options: {tickMs?: number} = {}) {
  const {core} = comms;
  const actor: PlanActor = {
    soul: soulId => {
      const m = deps.host.minds?.get(soulId), s = deps.db.soul(soulId);
      return m && s && !s.retired_at && s.world_id === deps.host.worldId ? {soulId, entityId: m.entityId, name: m.name, owner: m.owner} : null;
    },
    act: async (soul, input) => (await ledger.act(soul, input)) as Record<string, unknown>,
    receipt: (soulId, id) => ledger.receipt(soulId, id),
    say: (soul, text) => { const out = say(core, soul, {text}, id => comms.objects.addressees(id)); comms.fading.touch(soul.soulId); return out; },
    posture: soulId => deps.ledger.postureHold?.(soulId) ?? null,
    onReceipt: l => deps.ledger.onReceipt(l),
  };
  const plans = new Plans({db: core.db, worldId: core.worldId, now: core.now, tick: core.tick, streams: comms.streams}, actor, events.envelope, options);
  comms.fading.addHold(id => plans.holding(id));

  const failure = (c: Context, error: unknown) => {
    if (error instanceof EdgeError) return c.json(edgeBody({error: edgeErrorOf(error)}), error.status as ContentfulStatusCode);
    console.error('[edge] plans fault', c.req.method, c.req.path, error instanceof Error ? (error.stack ?? error.message).split('\n').slice(0, 4).join(' | ') : String(error));
    return c.json(edgeBody({error: {code: 'unavailable', message: 'the world could not answer; retry'}}), 503);
  };
  const route = (fn: (c: Context, soul: EdgeSoul) => object | Promise<object>) => async (c: Context) => {
    try { const soul = deps.soul(c); c.header('Cache-Control', 'no-store'); return c.json(edgeBody(await fn(c, soul))); } catch (error) { return failure(c, error); }
  };
  const json = async (c: Context): Promise<Record<string, unknown>> => {
    let body: unknown;
    try { body = await c.req.json(); } catch { throw new EdgeError(400, 'invalid', 'body must be JSON'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new EdgeError(400, 'invalid', 'body must be a JSON object');
    return body as Record<string, unknown>;
  };
  const limit = (soulId: string) => {
    const r = (deps.souls as {limits?: {allow(k: string, n: number, ms: number): {ok: boolean}}}).limits?.allow(`edge-plan:${soulId}`, 30, 60_000);
    if (r && !r.ok) throw new EdgeError(429, 'rate-limited', 'too many plan changes; slow down');
  };
  app.post('/v1/edge/plan', route(async (c, soul) => { limit(soul.soulId); const out = await plans.create(soul, await json(c)); comms.fading.touch(soul.soulId); return out; }));
  app.get('/v1/edge/plan', route((_c, soul) => plans.current(soul)));
  app.get('/v1/edge/plan/:id', route((c, soul) => plans.get(soul, c.req.param('id') ?? '')));
  app.patch('/v1/edge/plan/:id', route(async (c, soul) => { limit(soul.soulId); const out = await plans.patch(soul, c.req.param('id') ?? '', await json(c)); comms.fading.touch(soul.soulId); return out; }));
  app.delete('/v1/edge/plan/:id', route(async (c, soul) => { limit(soul.soulId); return plans.cancel(soul, c.req.param('id') ?? ''); }));
  return plans;
}
