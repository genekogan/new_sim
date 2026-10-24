// Travel routes (backlog M3; docs/sim/TRAVEL.md).
//   GET  /v1/edge/travel            the Soul's own travel status (Soul token; works while away)
//   POST /v1/edge/travel {to}       travel to a world of this site (slug or name) or "home" → {to, base, token, ...}
//   GET  /v1/souls/:id/travel       the owner's view; POST the same {to} from the web (no token is handed to a browser)
//   GET  /v1/world/visitors         public: open or closed, who is visiting, recent arrivals and departures
//   POST /v1/god/visitors {open}    the world's god (god token or the signed-in owner) opens or closes it to visitors
//   POST /v1/site/{arrive,where,where-is,presence,release}   the launcher's relay only (site key, never proxied)
import type {Context, Hono} from 'hono';
import {EDGE_CONTRACT} from '../edge/contract.ts';
import type {SoulRow} from '../db.ts';
import {siteRequestOk, Travel, TravelError, type Passport} from './travel.ts';

export type TravelRouteDeps = {
  travel: Travel;
  /** The Soul a Soul token names (no travel gate), or throws. */
  tokenSoul(c: Context): SoulRow;
  /** One of the signed-in owner's Souls, or throws. */
  ownerSoul(c: Context, id: string): Promise<SoulRow>;
  /** This world's public base URL as the caller reached it (…/w/<slug>). */
  baseOf(c: Context): string;
  /** May the caller open or close this world (its god)? */
  isGod(c: Context): Promise<boolean>;
  siteKey: string | undefined;
};

/** The base URL of another world of the same site, from this world's base (…/w/<here> → …/w/<there>). */
export const siblingBase = (base: string, here: string, there: string) => base.endsWith(`/w/${here}`) ? `${base.slice(0, -here.length)}${there}` : base.replace(/\/w\/[^/]+$/, `/w/${there}`);

export function mountTravelRoutes(app: Hono, d: TravelRouteDeps) {
  const T = d.travel;
  const fail = (c: Context, e: unknown, edge = false) => {
    if (e instanceof TravelError) return c.json({ok: false, code: e.code, message: e.message, ...e.extra, ...(edge ? {contract: EDGE_CONTRACT, error: {code: e.code, message: e.message, ...e.extra}} : {})}, e.status as 400);
    const x = e as {status?: number; code?: string; message?: string};
    if (typeof x?.status === 'number' && typeof x.code === 'string') return c.json({ok: false, code: x.code, message: x.message, ...(edge ? {contract: EDGE_CONTRACT, error: {code: x.code, message: x.message}} : {})}, x.status as 400);
    console.error('[travel]', c.req.method, c.req.path, e instanceof Error ? e.stack : e);
    return c.json({ok: false, code: 'travel.failed', message: 'travel failed; try again'}, 500);
  };
  const json = async (c: Context) => { try { return await c.req.json(); } catch { throw new TravelError(400, 'invalid', 'body must be JSON'); } };
  const withBase = (c: Context, r: Awaited<ReturnType<Travel['travel']>>) => ({...r, base: siblingBase(d.baseOf(c), T.d.slug, r.to)});
  app.get('/v1/edge/travel', async c => { c.header('Cache-Control', 'no-store'); try { return c.json(T.status(d.tokenSoul(c))); } catch (e) { return fail(c, e, true); } });
  app.post('/v1/edge/travel', async c => {
    c.header('Cache-Control', 'no-store');
    try { const s = d.tokenSoul(c), b = await json(c); return c.json(withBase(c, await T.travel(s, b?.to, {by: "agent"}))); }
    catch (e) { return fail(c, e, true); }
  });
  app.get('/v1/souls/:id/travel', async c => { c.header('Cache-Control', 'no-store'); try { return c.json(T.status(await d.ownerSoul(c, c.req.param('id')))); } catch (e) { return fail(c, e); } });
  app.post('/v1/souls/:id/travel', async c => {
    c.header('Cache-Control', 'no-store');
    try { const s = await d.ownerSoul(c, c.req.param('id')), b = await json(c); const r = withBase(c, await T.travel(s, b?.to, {by: 'owner'})); return c.json({...r, url: `${r.base}/`}); }
    catch (e) { return fail(c, e); }
  });
  app.get('/v1/world/visitors', c => c.json(T.visitors(), 200, {'cache-control': 'no-store'}));
  app.post('/v1/god/visitors', async c => {
    try {
      if (!await d.isGod(c)) throw new TravelError(403, 'forbidden', "only this world's god opens or closes it to visitors");
      const b = await json(c); if (typeof b?.open !== 'boolean') throw new TravelError(400, 'invalid', 'body must be JSON {"open": true|false}');
      return c.json({ok: true, open: T.setOpen(b.open)});
    } catch (e) { return fail(c, e); }
  });
  // ---- the launcher's relay (site key; requests through the public proxy carry x-forwarded-for and are refused)
  const site = (fn: (b: any) => unknown | Promise<unknown>) => async (c: Context) => {
    if (!siteRequestOk(d.siteKey, c.req.header('x-sim-site-key'), c.req.header('x-forwarded-for'))) return c.json({ok: false, code: 'not-found'}, 404);
    try { return c.json(await fn(await json(c))); } catch (e) { return fail(c, e); }
  };
  app.post('/v1/site/arrive', site(b => T.arrive(b as Passport)));
  app.post('/v1/site/where', site(b => T.where(b?.traveller, b?.at)));
  app.post('/v1/site/where-is', site(b => T.whereIs(b?.traveller)));
  app.post('/v1/site/presence', site(b => T.presence(b?.traveller)));
  app.post('/v1/site/release', site(b => T.release(b?.traveller, typeof b?.reason === 'string' ? b.reason.slice(0, 80) : '')));
}
