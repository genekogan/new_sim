import type {Context, Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import type {Db, UserRow} from './db.ts';
import type {GodMode} from './god/god.ts';
import {ApiError, type Souls} from './souls.ts';
import {AgentInbox, type InboxScope} from './inbox.ts';

type Deps = {db: Db; worldId: string; souls: Souls; god?: GodMode; edge?: boolean; requireUser(c: Context): Promise<UserRow>; ownerSoul(c: Context, id: string): Promise<{id: string; owner: string}>; now?: () => number};
type Agent = {kind: 'god' | 'soul'; scope: InboxScope};
export function mountAgentInbox(app: Hono, d: Deps) {
  const inbox = new AgentInbox(d.db, d.worldId, d.now);
  const bearer = (c: Context) => c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  const agent = (c: Context): Agent | null => {
    const token = bearer(c);
    if (token?.startsWith('god_') && d.god?.owner) {
      const identity = d.god.godIdentity(token);
      if (identity && identity.label !== 'browser') return {kind: 'god', scope: {scope: 'god', owner: d.god.owner}};
    }
    if (token?.startsWith('sim_')) {
      const soul = d.souls.soulFromToken(token);
      if (soul) return {kind: 'soul', scope: {scope: `soul:${soul.id}`, owner: soul.owner}};
    }
    return null;
  };
  const requireAgent = (c: Context, kind: Agent['kind']) => {
    const a = agent(c);
    if (!a || a.kind !== kind) throw new ApiError(401, 'unauthorized', 'use the paired agent credential; browser access does not receive messages');
    return a.scope;
  };
  // This middleware precedes every God/edge subroute. A human identity and the
  // Godmode browser token never count as an agent or receive a private message.
  app.use('/v1/*', async (c, next) => {
    const before = agent(c);
    if (before) inbox.touch(before.scope);
    await next();
    if (!before || c.req.raw.signal.aborted || c.res.status === 401 || c.res.status === 403) return;
    const current = agent(c);
    if (!current || current.kind !== before.kind || current.scope.owner !== before.scope.owner || current.scope.scope !== before.scope.scope) return;
    // Versioned strict contracts (intent-v2 receipts, history pages, arrivals; the MCP tools that relay them) must keep their
    // exact JSON shape: strict clients reject an extra key. They carry the inbox in the header, like binary/stream replies.
    const contract = /\/intent-v2(\/|$)/.test(c.req.path);
    if (contract || !c.res.headers.get('content-type')?.includes('application/json')) {
      if (c.res.status < 200 || c.res.status >= 300) return;
      inbox.touch(current.scope);
      const encoded = Buffer.from(JSON.stringify({inbox: inbox.deliver(current.scope)}), 'utf8').toString('base64url');
      // Binary and streaming consumers read one private header without changing
      // the image/event bytes or waiting for a streaming body to finish.
      c.res.headers.set('X-Sim-Agent-Inbox', encoded);
      c.res.headers.set('Cache-Control', 'no-store'); c.res.headers.delete('ETag');
      return;
    }
    const payload: unknown = await c.res.clone().json().catch(() => null);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
    inbox.touch(current.scope);
    const headers = new Headers(c.res.headers); headers.set('Cache-Control', 'no-store'); headers.delete('ETag'); headers.delete('Content-Length');
    c.res = new Response(JSON.stringify({...payload, inbox: inbox.deliver(current.scope)}), {status: c.res.status, headers});
  });
  for (const path of ['/v1/god/inbox', '/v1/god/inbox/*', '/v1/edge/inbox/*', '/v1/edge/owner/:soulId/inbox', ...(d.edge ? ['/v1/souls/:soulId/command'] : [])]) {
    app.use(path, async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
    app.use(path, bodyLimit({maxSize: 8192, onError: c => c.json({ok: false, code: 'too-large', message: 'message is too large'}, 413)}));
  }
  const json = async (c: Context) => { try { const b = await c.req.json(); if (!b || typeof b !== 'object' || Array.isArray(b)) throw Error(); return b as Record<string, unknown>; } catch { throw new ApiError(400, 'invalid', 'body must be a JSON object'); } };
  const limit = (key: string, max: number) => { const r = d.souls.limits.allow(key, max, 60_000); if (!r.ok) throw new ApiError(429, 'rate-limited', 'too many requests; slow down', {retry_after: r.retryAfter}); };
  const godOwner = async (c: Context): Promise<InboxScope> => {
    const u = await d.requireUser(c);
    if (!d.god?.owner || u.id !== d.god.owner) throw new ApiError(403, 'forbidden', 'only this world’s owner');
    return {scope: 'god', owner: u.id};
  };
  const soulOwner = async (c: Context): Promise<InboxScope> => {
    const soul = await d.ownerSoul(c, c.req.param('soulId')!);
    return {scope: `soul:${soul.id}`, owner: soul.owner};
  };
  const ownerRoutes = (path: string, owner: (c: Context) => Promise<InboxScope>, bucket: 'god-inbox' | 'cmd', command = false) => {
    if (!command) app.get(path, async c => c.json({inbox: inbox.view(await owner(c))}));
    app.post(path, async c => {
      const s = await owner(c), b = await json(c);
      if (command && (typeof b.text !== 'string' || !b.text.trim() || b.text.length > 280)) throw new ApiError(400, 'invalid', 'text is required (1–280 characters)');
      limit(`${bucket}:${s.owner}`, 20);
      // Recheck authority after reading the body before storing private text.
      const current = await owner(c);
      if (current.owner !== s.owner || current.scope !== s.scope) throw new ApiError(403, 'forbidden', 'owner authority changed');
      return c.json({ok: true, inbox: inbox.send(s, b.text)});
    });
  };
  if (d.god) ownerRoutes('/v1/god/inbox', godOwner, 'god-inbox');
  ownerRoutes('/v1/edge/owner/:soulId/inbox', soulOwner, 'cmd');
  // Edge Souls use the existing owner command channel; the new box endpoint is
  // an alias over its same latest record and 20/min owner bucket. Central minds
  // keep their existing translator route in http.ts.
  if (d.edge) ownerRoutes('/v1/souls/:soulId/command', soulOwner, 'cmd', true);
  const agentRoutes = (path: string, kind: Agent['kind']) => {
    const listeners = new Map<string, number>();
    app.get(`${path}/listen`, async c => {
      const s = requireAgent(c, kind), raw = c.req.query('timeoutMs'), timeout = raw === undefined ? 25_000 : Number(raw), after = c.req.query('after');
      if (!Number.isInteger(timeout) || timeout < 0 || timeout > 55_000 || (after?.length ?? 0) > 100) throw new ApiError(400, 'invalid', 'timeoutMs must be 0..55000 and after must be a message id');
      const key = JSON.stringify(s); limit(`inbox-listen:${kind}:${key}`, 120);
      if ((listeners.get(key) ?? 0) >= 2) throw new ApiError(429, 'rate-limited', 'at most two inbox listeners per agent');
      listeners.set(key, (listeners.get(key) ?? 0) + 1);
      try {
        await inbox.listen(s, after, timeout, c.req.raw.signal);
        const current = requireAgent(c, kind);
        if (current.owner !== s.owner || current.scope !== s.scope) throw new ApiError(401, 'unauthorized', 'agent authority changed');
        return c.json({inbox: inbox.view(s)});
      } finally { const count = (listeners.get(key) ?? 1) - 1; if (count) listeners.set(key, count); else listeners.delete(key); }
    });
    app.post(`${path}/:id/ack`, async c => {
      const s = requireAgent(c, kind), b = await json(c); limit(`inbox-ack:${kind}:${JSON.stringify(s)}`, 120);
      const current = requireAgent(c, kind);
      if (current.owner !== s.owner || current.scope !== s.scope) throw new ApiError(401, 'unauthorized', 'agent authority changed');
      return c.json({inbox: inbox.acknowledge(s, c.req.param('id')!, b.reply)});
    });
  };
  if (d.god) agentRoutes('/v1/god/inbox', 'god');
  agentRoutes('/v1/edge/inbox', 'soul');
  return inbox;
}
