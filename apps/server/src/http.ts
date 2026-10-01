import { bodyLimit } from 'hono/body-limit';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono, type Context } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { adminSchema, commandSchema, inviteSchema, pairApproveSchema, pairExchangeSchema, pairStartSchema, publicEvent, setIntentSchema } from '@sim/protocol';
import { newId, type Auth } from './auth.ts';
import type { Brain } from './brain.ts';
import type { Config } from './config.ts';
import type { Db, SoulRow, UserRow } from './db.ts';
import type { Hub } from './hub.ts';
import { cardGrammar } from '@sim/brain';
import { skillMd } from './skill.ts';
import { ApiError, type Souls } from './souls.ts';
import { WORLD_ID, type WorldHost } from './world.ts';

type Deps = { cfg: Config; db: Db; host: WorldHost; auth: Auth; hub: Hub; brain: Brain; souls: Souls };

export function buildApp(d: Deps) {
  const app = new Hono();
  const bearer = (c: Context) => c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  const ip = (c: Context) => (c.req.header('x-forwarded-for') ?? 'local').split(',')[0].trim();
  const requireUser = async (c: Context): Promise<UserRow> => { const u = await d.auth.userFromToken(bearer(c)); if (!u) throw new ApiError(401, 'unauthorized', 'sign in first'); return u; };
  const requireAdmin = async (c: Context): Promise<UserRow> => { const u = await requireUser(c); if (u.role !== 'admin') throw new ApiError(403, 'forbidden', 'admin only'); return u; };
  const ownSoul = (u: UserRow, id: string): SoulRow => { const s = d.db.soul(id); if (!s || s.retired_at) throw new ApiError(404, 'not-found', 'no such soul'); if (s.owner !== u.id && u.role !== 'admin') throw new ApiError(403, 'forbidden', 'not your soul'); return s; };
  const agentSoul = (c: Context): SoulRow => { const s = d.souls.soulFromToken(bearer(c)); if (!s) throw new ApiError(401, 'unauthorized', 'missing or invalid soul token; pair again (see /skill.md)'); return s; };
  /** Public base URL as the caller reached us (works on any hostname pointing at the box). */
  const baseOf = (c: Context) => { const host = c.req.header('x-forwarded-host') ?? c.req.header('host'); const proto = c.req.header('x-forwarded-proto') ?? (host?.startsWith('localhost') || host?.startsWith('127.') ? 'http' : 'https'); return host ? `${proto}://${host}` : d.cfg.publicUrl; };
  const body = async (c: Context) => { try { return await c.req.json(); } catch { throw new ApiError(400, 'bad-json', 'body must be JSON'); } };
  const limitIp = (c: Context, key: string, max: number, windowMs: number) => { const l = d.souls.limits.allow(`${key}:${ip(c)}`, max, windowMs); if (!l.ok) throw new ApiError(429, 'rate-limited', 'too many requests', { retry_after: l.retryAfter }); };

  app.onError((err, c) => {
    if (err instanceof ApiError) { if (err.status === 429 && err.extra?.retry_after) c.header('Retry-After', String(err.extra.retry_after)); return c.json({ ok: false, code: err.code, message: err.message, ...err.extra }, err.status as 400); }
    console.error('[http]', err);
    return c.json({ ok: false, code: 'internal', message: 'internal error' }, 500);
  });
  app.use('*', async (c, next) => { await next(); c.header('X-Robots-Tag', 'noindex, nofollow'); });
  // Nothing a person or an agent sends is large: a command, an intent, a few cards.
  app.use('/v1/*', bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ ok: false, code: 'too-large', message: 'request body is larger than 64 KB' }, 413) }));

  // ---- public
  app.get('/healthz', (c) => c.json({ ok: true, tick: d.host.engine.world.tick, clients: d.hub.clients.size, paused: d.host.paused, build: d.cfg.build }));
  app.get('/v1/config', (c) => c.json({ privyAppId: d.cfg.privyAppId, publicUrl: baseOf(c), worldId: WORLD_ID, authReady: d.auth.ready, devAuth: d.auth.devAuth, inviteRequired: d.cfg.inviteRequired, build: d.cfg.build }));
  app.get('/v1/world', (c) => c.json(d.souls.worldSummary()));
  app.get('/v1/debug/world', (c) => c.json(d.host.engine.world));
  app.get('/v1/kernel', (c) => c.json(d.host.kernelView()));
  app.get('/v1/plays', (c) => c.json({ plays: d.host.recentPlays.slice(-Math.min(200, Number(c.req.query('limit') ?? 60))) }));
  app.get('/v1/talk', (c) => c.json({ lines: d.db.recentTalk(Math.min(200, Number(c.req.query('limit') ?? 60))) }));
  app.get('/cards.md', (c) => c.text(cardGrammar(d.host.engine.describeVerbs().filter((v) => v.verb !== 'do_activity')), 200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=60' }));
  app.get('/v1/debug/verbs', (c) => c.json({ rulesVersion: d.host.engine.rulesVersion, dt: d.host.engine.dt, verbs: d.host.engine.describeVerbs() }));
  app.get('/v1/log', (c) => c.json({ events: d.db.events(WORLD_ID, Number(c.req.query('after') ?? 0), Math.min(1000, Number(c.req.query('limit') ?? 200))).map(publicEvent) }));
  const skill = (c: Context) => c.text(skillMd(baseOf(c)), 200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=60' });
  app.get('/skill.md', skill);
  app.get('/v1/skill.md', skill);

  // ---- signed-in users
  const mySouls = (u: UserRow) => d.db.soulsOf(u.id).map((s) => ({ id: s.id, name: s.name, description: s.description, entityId: s.entity_id, hasToken: !!s.token_hash, tokenLabel: s.token_label, tokenCreatedAt: s.token_created_at, tokenLastUsed: s.token_last_used }));
  app.get('/v1/me', async (c) => { const u = await requireUser(c); return c.json({ me: d.auth.me(u), souls: mySouls(u), maxSouls: d.cfg.maxSoulsPerUser }); });
  app.post('/v1/invite', async (c) => {
    const u = await requireUser(c); const p = inviteSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'code is required');
    d.souls.redeemInvite(u, p.data.code); d.hub.refreshMe(u.id); return c.json({ ok: true });
  });
  app.post('/v1/souls', async (c) => {
    const u = await requireUser(c); d.souls.requireInvited(u);
    const lim = d.souls.limits.allow(`create:${u.id}`, 5, 3600_000); if (!lim.ok) throw new ApiError(429, 'rate-limited', 'too many new souls this hour', { retry_after: lim.retryAfter });
    const s = await d.souls.create(u.id, await body(c)); d.hub.refreshMe(u.id);
    return c.json({ ok: true, soul: { id: s.id, name: s.name, description: s.description, entityId: s.entity_id } });
  });
  app.delete('/v1/souls/:id', async (c) => { const u = await requireUser(c); await d.souls.retire(ownSoul(u, c.req.param('id'))); d.hub.refreshMe(u.id); return c.json({ ok: true }); });
  app.get('/v1/souls/:id', async (c) => { const u = await requireUser(c); return c.json(d.souls.dashboard(ownSoul(u, c.req.param('id')))); });
  app.get('/v1/souls/:id/timeline', async (c) => { const u = await requireUser(c); return c.json({ events: d.souls.timeline(ownSoul(u, c.req.param('id')), Math.min(200, Number(c.req.query('limit') ?? 80))) }); });
  app.get('/v1/souls/:id/deck', async (c) => { const u = await requireUser(c); return c.json(d.souls.deck(ownSoul(u, c.req.param('id')))); });
  app.get('/v1/souls/:id/talk', async (c) => { const u = await requireUser(c); return c.json({ lines: d.db.recentTalk(60, ownSoul(u, c.req.param('id')).id) }); });
  app.post('/v1/souls/:id/cards', async (c) => { const u = await requireUser(c); d.souls.requireInvited(u); return c.json(await d.souls.proposeCards(ownSoul(u, c.req.param('id')), await body(c))); });
  app.get('/v1/souls/:id/perceive', async (c) => { const u = await requireUser(c); return c.json(d.souls.perceive(ownSoul(u, c.req.param('id')))); });
  app.post('/v1/souls/:id/command', async (c) => {
    const u = await requireUser(c); d.souls.requireInvited(u); const s = ownSoul(u, c.req.param('id'));
    const p = commandSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'text is required (1–280 characters)');
    return c.json(await d.souls.command(s, p.data.text));
  });
  app.post('/v1/souls/:id/intent', async (c) => {
    const u = await requireUser(c); d.souls.requireInvited(u); const s = ownSoul(u, c.req.param('id'));
    const p = setIntentSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'body must be { intent: { agenda: [{card, target?, of?}], note? } } or { intent: { goal, target?, note? } }; see /skill.md');
    const r = await d.souls.setIntent(s, p.data.intent, 'web'); return c.json({ ok: true, intent: r.intent, text: r.text, tick: r.event.tick, seq: r.event.seq });
  });
  app.post('/v1/souls/:id/pair', async (c) => { const u = await requireUser(c); d.souls.requireInvited(u); return c.json({ ok: true, ...d.souls.pairCode(ownSoul(u, c.req.param('id')), baseOf(c)) }); });
  app.post('/v1/souls/:id/revoke', async (c) => { const u = await requireUser(c); d.db.setSoulToken(ownSoul(u, c.req.param('id')).id, null); return c.json({ ok: true }); });
  app.post('/v1/souls/:id/shot', async (c) => {
    const u = await requireUser(c); const s = ownSoul(u, c.req.param('id')); const m = d.host.minds.get(s.id); if (!m) throw new ApiError(409, 'not-in-world', 'not in the world');
    const lim = d.souls.limits.allow(`shot:${s.id}`, 12, 60_000); if (!lim.ok) throw new ApiError(429, 'rate-limited', 'slow down', { retry_after: lim.retryAfter });
    return c.json({ ok: true, shot: await d.brain.shotFor(m) });
  });
  // approving an agent that asked to be paired
  app.get('/v1/pair/:code', async (c) => { await requireUser(c); return c.json(d.souls.pairInfo(c.req.param('code'))); });
  app.post('/v1/pair/approve', async (c) => {
    const u = await requireUser(c); d.souls.requireInvited(u); const p = pairApproveSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'body must be { code, soulId }');
    d.souls.pairApprove(u, p.data.code, ownSoul(u, p.data.soulId)); return c.json({ ok: true });
  });
  // model calls: admins see all; owners see calls about their own Souls
  app.get('/v1/brain', async (c) => {
    const u = await requireUser(c);
    return c.json({ calls: d.db.brainCalls(Math.min(500, Number(c.req.query('limit') ?? 100)), { tier: c.req.query('tier') || undefined, soulIds: u.role === 'admin' ? (c.req.query('soul') ? [c.req.query('soul')!] : null) : d.db.soulsOf(u.id).map((s) => s.id).filter((id) => !c.req.query('soul') || id === c.req.query('soul')) }) });
  });
  app.get('/v1/prompt/:hash', async (c) => { await requireUser(c); const t = d.db.prompt(c.req.param('hash')); if (!t) throw new ApiError(404, 'not-found', 'no such prompt'); return c.text(t); });

  // ---- admin
  app.get('/v1/spend', async (c) => { await requireAdmin(c); return c.json(d.brain.spendReport()); });
  app.get('/v1/admin/clients', async (c) => { await requireAdmin(c); return c.json({ clients: d.hub.clientList(), users: d.db.countUsers() }); });
  app.get('/v1/admin/invites', async (c) => { await requireAdmin(c); return c.json({ invites: d.db.invites(), required: d.cfg.inviteRequired }); });
  app.post('/v1/admin', async (c) => {
    const u = await requireAdmin(c);
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
      case 'adopt_vocabulary': { const e = await d.host.adoptVocabulary(who); return c.json({ ok: true, tick: e.tick, seq: e.seq }); }
      case 'attune': { for (const m of d.host.minds.values()) void d.brain.attune(m); break; }
      case 'invite': { const code = newId('sim').replace('_', '-'); d.db.createInvite(code, a.uses, a.note ?? null, u.id); return c.json({ ok: true, code, uses: a.uses }); }
    }
    return c.json({ ok: true, clockRate: d.host.clockRate, paused: d.host.paused, brainMode: d.brain.mode, budget: d.brain.budget });
  });

  // ---- agents: pairing (no auth yet) and the per-Soul API (bearer = Soul token)
  app.post('/v1/agent/pair', async (c) => {
    limitIp(c, 'pair', 20, 60_000); const p = pairExchangeSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'body must be { "code": "XXXX-XXXX", "agent": "optional name" }');
    const r = d.souls.pairExchange(p.data.code, p.data.agent);
    return c.json({ ok: true, token: r.token, soul: r.soul, base: baseOf(c), next: 'Save the token (see skill.md), then call GET /v1/agent/perceive.' }, 200, { 'cache-control': 'no-store' });
  });
  app.post('/v1/agent/pair/start', async (c) => { limitIp(c, 'pairstart', 6, 60_000); const p = pairStartSchema.safeParse(await body(c).catch(() => ({}))); return c.json({ ok: true, ...d.souls.pairStart(p.success ? p.data.agent : undefined, baseOf(c)) }); });
  app.get('/v1/agent/pair/poll', (c) => { limitIp(c, 'pairpoll', 60, 60_000); return c.json({ ok: true, ...d.souls.pairPoll(c.req.query('poll_token') ?? '') }, 200, { 'cache-control': 'no-store' }); });
  app.get('/v1/agent/me', (c) => { const s = agentSoul(c); return c.json({ soul: { id: s.id, name: s.name, description: s.description }, paired_as: s.token_label, since: s.token_created_at }); });
  app.get('/v1/agent/status', (c) => c.json(d.souls.status(agentSoul(c))));
  app.get('/v1/agent/perceive', (c) => c.json(d.souls.perceive(agentSoul(c))));
  app.get('/v1/agent/world', (c) => { agentSoul(c); return c.json(d.souls.worldSummary()); });
  app.get('/v1/agent/log', (c) => c.json({ events: d.souls.soulLog(agentSoul(c)) }));
  app.get('/v1/agent/wait', async (c) => c.json(await d.souls.wait(agentSoul(c), Number(c.req.query('seconds') ?? 30))));
  app.post('/v1/agent/intent', async (c) => {
    const s = agentSoul(c); const p = setIntentSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'body must be { intent: { agenda: [{card, target?, of?}], note? } } or { intent: { goal, target?, note? } }; see /skill.md');
    const r = await d.souls.setIntent(s, p.data.intent, 'api'); return c.json({ ok: true, accepted_at_tick: r.event.tick, seq: r.event.seq, intent: r.intent, text: r.text, status: d.souls.status(s) });
  });
  app.post('/v1/agent/command', async (c) => {
    const s = agentSoul(c); const p = commandSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'text is required (1–280 characters)');
    return c.json(await d.souls.command(s, p.data.text, 'api'));
  });
  app.get('/v1/agent/deck', (c) => c.json(d.souls.deck(agentSoul(c))));
  app.post('/v1/agent/cards', async (c) => c.json(await d.souls.proposeCards(agentSoul(c), await body(c))));
  app.post('/v1/agent/release', (c) => { const s = agentSoul(c); d.db.setSoulToken(s.id, null); return c.json({ ok: true }); });

  // ---- static web app (SPA)
  if (existsSync(d.cfg.webDir)) {
    const index = readFileSync(join(d.cfg.webDir, 'index.html'), 'utf8');
    app.use('/assets/*', async (c, next) => { await next(); if (c.res.ok) c.header('Cache-Control', 'public, max-age=31536000, immutable'); });
    app.use('/assets/*', serveStatic({ root: d.cfg.webDir }));
    app.get('*', (c) => (c.req.path.startsWith('/v1/') || c.req.path.startsWith('/mcp') ? c.json({ ok: false, code: 'not-found', message: 'no such route' }, 404) : c.html(index, 200, { 'Cache-Control': 'no-cache' })));
  } else app.get('/', (c) => c.text('Sim server is running. The web app has not been built (pnpm build).'));
  return app;
}
