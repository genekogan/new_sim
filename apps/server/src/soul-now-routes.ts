// LINK tranche (COMMON-LINK §2): the agent sets its public `now` line with an optional `now` on the edge calls that already
// cost a request (act, say, inbox ack/result: in the JSON body; wait: the `now` query parameter), or alone with
// POST /v1/edge/self/now {text}. The field is validated before the call runs (a bad line refuses the whole call, so the
// agent learns at once), removed from the body the handler sees, and stored only when the call answers 2xx.
import type {Context, Hono} from 'hono';
import type {Souls} from './souls.ts';
import type {WorldHost} from './world.ts';
import {ApiError} from './souls.ts';
import {cleanNow, NowInvalid} from './soul-now.ts';
import {soulLink} from './soul-link.ts';
import type {AgentInbox} from './inbox.ts';

type Deps = {host: WorldHost; souls: Souls; inbox?: () => AgentInbox | undefined};
const BODY_PATHS = ['/v1/edge/act', '/v1/edge/say', '/v1/edge/inbox/:id/ack', '/v1/edge/inbox/:id/result'];

export function mountSoulNow(app: Hono, d: Deps) {
  const bearer = (c: Context) => c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  const soulOf = (c: Context) => { const s = d.souls.soulFromToken(bearer(c)); return s && s.world_id === d.host.worldId && !s.retired_at ? s : null; };
  const invalid = (e: unknown): never => { throw new ApiError(400, 'now.invalid', e instanceof NowInvalid ? e.message : 'now must be a string (≤140 characters) or null'); };
  const check = (raw: unknown) => { try { cleanNow(raw); } catch (e) { invalid(e); } };
  const store = (c: Context, soulId: string, raw: unknown) => { if (c.res.status >= 200 && c.res.status < 300) d.host.soulNow.set(soulId, raw); };
  for (const path of BODY_PATHS) app.post(path, async (c, next) => {
    const soul = soulOf(c);
    if (!soul || !(c.req.header('content-type') ?? '').includes('json')) return next();
    // Read a clone: the original stream stays untouched for the body limit and the handler when there is no `now`.
    let body: unknown; try { body = JSON.parse(await c.req.raw.clone().text()); } catch { return next(); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.hasOwn(body, 'now')) return next();
    const {now: raw, ...rest} = body as Record<string, unknown>;
    check(raw);
    // The handler (and the idempotency key's body hash) sees the call without `now`.
    const text = JSON.stringify(rest), headers = new Headers(c.req.raw.headers); headers.set('content-length', String(Buffer.byteLength(text)));
    const req = c.req as unknown as {raw: Request; bodyCache: Record<string, unknown>};
    req.raw = new Request(c.req.raw.url, {method: 'POST', headers, body: text, signal: c.req.raw.signal}); req.bodyCache = {};
    await next();
    store(c, soul.id, raw);
  });
  app.get('/v1/edge/wait', async (c, next) => {
    const raw = c.req.query('now'), soul = raw === undefined ? null : soulOf(c);
    if (!soul) return next();
    check(raw);
    // `now=` (empty) clears, like null in a body. Stored at once: the wait's answer may come up to 55 s later.
    d.host.soulNow.set(soul.id, raw === '' ? null : raw);
    return next();
  });
  // The agent's own view of its link (CLI `status`): the same value its owner sees, without the owner's pending requests.
  app.get('/v1/edge/self/link', async c => {
    const soul = d.souls.soulFromToken(bearer(c));
    if (!soul || soul.world_id !== d.host.worldId || soul.retired_at) { const r = d.souls.controlRefusal(bearer(c)); throw new ApiError(401, r.code, r.message, r.extra); }
    c.header('Cache-Control', 'no-store');
    return c.json({soulId: soul.id, link: soulLink(d.souls, d.inbox?.(), soul, null), now: d.host.nowOf(soul.id)});
  });
  app.post('/v1/edge/self/now', async c => {
    const soul = d.souls.soulFromToken(bearer(c));
    if (!soul || soul.world_id !== d.host.worldId || soul.retired_at) { const r = d.souls.controlRefusal(bearer(c)); throw new ApiError(401, r.code, r.message, r.extra); }
    const r = d.souls.limits.allow(`edge-now:${soul.id}`, 30, 60_000);
    if (!r.ok) throw new ApiError(429, 'rate-limited', 'too many requests; slow down', {retry_after: r.retryAfter});
    let body: unknown; try { body = await c.req.json(); } catch { throw new ApiError(400, 'invalid', 'body must be JSON {text: string | null}'); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.hasOwn(body, 'text')) throw new ApiError(400, 'invalid', 'body must be JSON {text: string | null}');
    const raw = (body as {text: unknown}).text; check(raw);
    c.header('Cache-Control', 'no-store');
    return c.json({ok: true, now: d.host.soulNow.set(soul.id, raw)});
  });
}
