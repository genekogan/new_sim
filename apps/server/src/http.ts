import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono, type Context } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { adminSchema, commandSchema, setIntentSchema } from '@sim/protocol';
import type { Auth } from './auth.ts';
import type { Brain } from './brain.ts';
import type { Config } from './config.ts';
import type { Db, SoulRow, UserRow } from './db.ts';
import type { Hub } from './hub.ts';
import { skillMd } from './skill.ts';
import { ApiError, type Souls } from './souls.ts';
import { WORLD_ID, type WorldHost } from './world.ts';

type Deps = { cfg: Config; db: Db; host: WorldHost; auth: Auth; hub: Hub; brain: Brain; souls: Souls };

export function buildApp(d: Deps) {
  const app = new Hono();
  const bearer = (c: Context) => c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  const requireUser = async (c: Context): Promise<UserRow> => { const u = await d.auth.userFromToken(bearer(c)); if (!u) throw new ApiError(401, 'unauthorized', 'sign in first'); return u; };
  const ownSoul = (u: UserRow, id: string): SoulRow => { const s = d.db.soul(id); if (!s || s.retired_at) throw new ApiError(404, 'not-found', 'no such soul'); if (s.owner !== u.id && u.role !== 'admin') throw new ApiError(403, 'forbidden', 'not your soul'); return s; };
  const agentSoul = (c: Context): SoulRow => { const s = d.souls.soulFromToken(bearer(c)); if (!s) throw new ApiError(401, 'unauthorized', 'missing or invalid soul token'); return s; };
  /** Public base URL as the caller reached us (works on any hostname pointing at the box). */
  const baseOf = (c: Context) => { const host = c.req.header('x-forwarded-host') ?? c.req.header('host'); const proto = c.req.header('x-forwarded-proto') ?? (host?.startsWith('localhost') || host?.startsWith('127.') ? 'http' : 'https'); return host ? `${proto}://${host}` : d.cfg.publicUrl; };
  const body = async (c: Context) => { try { return await c.req.json(); } catch { throw new ApiError(400, 'bad-json', 'body must be JSON'); } };

  app.onError((err, c) => {
    if (err instanceof ApiError) { if (err.status === 429 && err.extra?.retry_after) c.header('Retry-After', String(err.extra.retry_after)); return c.json({ ok: false, code: err.code, message: err.message, ...err.extra }, err.status as 400); }
    console.error('[http]', err);
    return c.json({ ok: false, code: 'internal', message: 'internal error' }, 500);
  });

  app.use('*', async (c, next) => { await next(); c.header('X-Robots-Tag', 'noindex, nofollow'); });

  // ---- public
  app.get('/healthz', (c) => c.json({ ok: true, tick: d.host.engine.world.tick, clients: d.hub.clients.size, paused: d.host.paused }));
  app.get('/v1/config', (c) => c.json({ privyAppId: d.cfg.privyAppId, publicUrl: d.cfg.publicUrl, worldId: WORLD_ID, authReady: d.auth.ready, devAuth: d.auth.devAuth }));
  app.get('/v1/world', (c) => c.json(d.souls.worldSummary()));
  app.get('/v1/debug/world', (c) => c.json(d.host.engine.world));
  app.get('/v1/debug/verbs', (c) => c.json({ rulesVersion: d.host.engine.rulesVersion, dt: d.host.engine.dt, verbs: d.host.engine.describeVerbs() }));
  app.get('/v1/log', (c) => c.json({ events: d.db.events(WORLD_ID, Number(c.req.query('after') ?? 0), Math.min(1000, Number(c.req.query('limit') ?? 200))) }));
  app.get('/v1/skill.md', (c) => c.text(skillMd(baseOf(c)), 200, { 'content-type': 'text/markdown; charset=utf-8' }));
  app.get('/claim/:code', (c) => {
    const { soul, token } = d.souls.redeemClaim(c.req.param('code'));
    return c.text(`# Sim: token for the Soul "${soul.name}"\n\nTOKEN: ${token}\n\nUse it as \`Authorization: Bearer <TOKEN>\`. Keep it private; it steers this one Soul only and its owner can revoke it.\nNext: read ${baseOf(c)}/v1/skill.md\nQuick check: curl -s -H "Authorization: Bearer ${token}" ${baseOf(c)}/v1/agent/status\n`, 200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store' });
  });

  // ---- signed-in users
  app.get('/v1/me', async (c) => { const u = await requireUser(c); return c.json({ me: d.auth.me(u), souls: d.db.soulsOf(u.id).map((s) => ({ id: s.id, name: s.name, description: s.description, entityId: s.entity_id, hasToken: !!s.token_hash, tokenCreatedAt: s.token_created_at })) }); });
  app.post('/v1/souls', async (c) => {
    const u = await requireUser(c);
    const lim = d.souls.limits.allow(`create:${u.id}`, 5, 3600_000); if (!lim.ok) throw new ApiError(429, 'rate-limited', 'too many new souls this hour', { retry_after: lim.retryAfter });
    const s = await d.souls.create(u.id, await body(c)); d.hub.refreshMe(u.id);
    return c.json({ ok: true, soul: { id: s.id, name: s.name, description: s.description, entityId: s.entity_id } });
  });
  app.delete('/v1/souls/:id', async (c) => { const u = await requireUser(c); await d.souls.retire(ownSoul(u, c.req.param('id'))); d.hub.refreshMe(u.id); return c.json({ ok: true }); });
  app.get('/v1/souls/:id', async (c) => { const u = await requireUser(c); return c.json(d.souls.status(ownSoul(u, c.req.param('id')))); });
  app.post('/v1/souls/:id/command', async (c) => {
    const u = await requireUser(c); const s = ownSoul(u, c.req.param('id'));
    const p = commandSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'text is required (1–280 characters)');
    return c.json(await d.souls.command(s, p.data.text));
  });
  app.post('/v1/souls/:id/intent', async (c) => {
    const u = await requireUser(c); const s = ownSoul(u, c.req.param('id'));
    const p = setIntentSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'body must be { intent: { goal, target?, note? } }');
    const r = await d.souls.setIntent(s, p.data.intent, 'web'); return c.json({ ok: true, intent: r.intent, text: r.text, tick: r.event.tick, seq: r.event.seq });
  });
  app.post('/v1/souls/:id/claim', async (c) => { const u = await requireUser(c); return c.json({ ok: true, ...d.souls.mintClaim(ownSoul(u, c.req.param('id')), baseOf(c)) }); });
  app.post('/v1/souls/:id/revoke', async (c) => { const u = await requireUser(c); d.db.setSoulToken(ownSoul(u, c.req.param('id')).id, null); return c.json({ ok: true }); });
  app.post('/v1/souls/:id/shot', async (c) => {
    const u = await requireUser(c); const s = ownSoul(u, c.req.param('id')); const m = d.host.minds.get(s.id); if (!m) throw new ApiError(409, 'not-in-world', 'not in the world');
    const lim = d.souls.limits.allow(`shot:${s.id}`, 12, 60_000); if (!lim.ok) throw new ApiError(429, 'rate-limited', 'slow down', { retry_after: lim.retryAfter });
    return c.json({ ok: true, shot: await d.brain.shotFor(m) });
  });
  app.get('/v1/brain', async (c) => { await requireUser(c); return c.json({ calls: d.db.brainCalls(Math.min(500, Number(c.req.query('limit') ?? 100)), c.req.query('tier') || undefined) }); });

  // ---- admin
  app.get('/v1/admin/clients', async (c) => { const u = await requireUser(c); if (u.role !== 'admin') throw new ApiError(403, 'forbidden', 'admin only'); return c.json({ clients: d.hub.clientList(), users: d.db.countUsers() }); });
  app.post('/v1/admin', async (c) => {
    const u = await requireUser(c); if (u.role !== 'admin') throw new ApiError(403, 'forbidden', 'admin only');
    const p = adminSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', p.error.message);
    const a = p.data, who = 'admin';
    switch (a.action) {
      case 'pause': d.host.setPaused(true, who); break;
      case 'resume': d.host.setPaused(false, who); break;
      case 'clock_rate': d.host.setClockRate(a.rate, who, 'admin'); break;
      case 'narrate': void d.brain.narrate(a.region, 'admin'); break;
      case 'brain_mode': d.brain.setMode(a.mode); void d.host.enqueue('admin', who, { action: 'brain_mode', mode: a.mode }); break;
      case 'budget': d.brain.budget = a.usdPerDay; void d.host.enqueue('admin', who, { action: 'budget', usdPerDay: a.usdPerDay }); break;
      case 'snapshot': return c.json({ ok: true, snapshot: d.host.saveSnapshot() });
    }
    return c.json({ ok: true, clockRate: d.host.clockRate, paused: d.host.paused, brainMode: d.brain.mode, budget: d.brain.budget });
  });

  // ---- agent API (bearer = per-soul token)
  app.get('/v1/agent/status', (c) => c.json(d.souls.status(agentSoul(c))));
  app.get('/v1/agent/world', (c) => { agentSoul(c); return c.json(d.souls.worldSummary()); });
  app.get('/v1/agent/log', (c) => c.json({ events: d.souls.soulLog(agentSoul(c)) }));
  app.post('/v1/agent/intent', async (c) => {
    const s = agentSoul(c); const p = setIntentSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'body must be { intent: { goal, target?, note? } }');
    const r = await d.souls.setIntent(s, p.data.intent, 'api'); return c.json({ ok: true, accepted_at_tick: r.event.tick, seq: r.event.seq, intent: r.intent, text: r.text, status: d.souls.status(s) });
  });
  app.post('/v1/agent/release', (c) => { const s = agentSoul(c); d.db.setSoulToken(s.id, null); return c.json({ ok: true }); });

  // ---- static web app (SPA)
  if (existsSync(d.cfg.webDir)) {
    const index = readFileSync(join(d.cfg.webDir, 'index.html'), 'utf8');
    app.use('/assets/*', serveStatic({ root: d.cfg.webDir }));
    app.get('*', (c) => (c.req.path.startsWith('/v1/') || c.req.path.startsWith('/mcp') ? c.json({ ok: false, code: 'not-found', message: 'no such route' }, 404) : c.html(index)));
  } else app.get('/', (c) => c.text('Sim server is running. The web app has not been built (pnpm build).'));
  return app;
}
