// HTTP for the entity world: public reads for viewers, god writes behind a god
// token, pairing, prayers. Mounted like the edge routes (plain app.get/post).
import type { Context, Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { TILE_N } from '@sim/ground';
import { ApiError } from '../souls.ts';
import type { UserRow } from '../db.ts';
import type { GodMode } from './god.ts';
import { godSchema } from './schema.ts';
import { runQuery } from './query.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type GodDeps = {
  god: GodMode;
  /** Human world name for the welcome text. */
  worldName: string;
  requireUser: (c: Context) => Promise<UserRow>;
  /** Resolve a Soul from a bearer token for `pray`; null when the token is not a Soul's. */
  soulFromBearer: (c: Context) => { id: string; name: string } | null;
  baseOf: (c: Context) => string;
  limitIp: (c: Context, key: string, max: number, windowMs: number) => void;
};

const codeSchema = z.object({ code: z.string().min(4).max(12) });
const prayerSchema = z.object({ text: z.string().min(1).max(2000) });
const answerSchema = z.object({ prayer: z.string(), text: z.string().min(1).max(4000) });
const noStore = { 'cache-control': 'no-store' };

export function mountGodRoutes(app: Hono, d: GodDeps) {
  const bearer = (c: Context) => c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  const requireGod = (c: Context) => { if (!d.god.godFromToken(bearer(c))) throw new ApiError(401, 'unauthorized', 'missing or invalid god token; pair with POST /v1/god/pair/start'); };
  const body = async (c: Context) => { try { return await c.req.json(); } catch { throw new ApiError(400, 'bad-json', 'body must be JSON'); } };

  // ---- public reads (the renderer's view of the world; Gene: topology and placements are public)
  app.get('/v1/world/snapshot', (c) => c.json(d.god.publicSnapshot(), 200, noStore));
  app.get('/v1/world/seq', (c) => c.json({ seq: d.god.model.editSeq, entities: d.god.model.entities.size }, 200, noStore));
  app.get('/v1/world/ground', (c) => c.json({ contract: 'ground/1', ground: d.god.model.ground(), tiles: d.god.tileHashes() }, 200, noStore));
  app.get('/v1/world/tiles/:tx/:tz', (c) => {
    const tx = Number(c.req.param('tx')), tz = Number(c.req.param('tz'));
    if (!Number.isInteger(tx) || !Number.isInteger(tz)) throw new ApiError(400, 'invalid', 'tile indices must be integers');
    const t = d.god.tile(tx, tz);
    if (!t) throw new ApiError(404, 'not-found', 'tile outside the world');
    const hash = d.god.model.terrain.hash(tx, tz);
    if (c.req.header('if-none-match') === `"${hash}"`) return c.body(null, 304);
    return c.body(new Uint8Array(t.buffer, t.byteOffset, t.byteLength) as never, 200, { 'content-type': 'application/octet-stream', 'x-tile-n': String(TILE_N), etag: `"${hash}"`, 'cache-control': 'public, max-age=60' });
  });
  app.get('/v1/world/entities/:id{.+}', (c) => { const e = d.god.model.get(c.req.param('id')); if (!e) throw new ApiError(404, 'not-found', 'no such entity'); return c.json({ entity: e, path: d.god.model.pathOf(e.id), pose: d.god.model.worldPose(e) }, 200, noStore); });

  // ---- onboarding: who am I here, the welcome text, the skill and CLI files
  const skillDir = resolve(new URL('../../../../tools/god-skill/', import.meta.url).pathname);
  const serveFile = (name: string, type: string) => (c: Context) => { try { return c.body(readFileSync(resolve(skillDir, name), 'utf8'), 200, { 'content-type': type, 'cache-control': 'no-cache' }); } catch { throw new ApiError(404, 'not-found', `${name} is not available on this server`); } };
  app.get('/god/SKILL.md', serveFile('SKILL.md', 'text/markdown; charset=utf-8'));
  app.get('/god/skill.md', serveFile('SKILL.md', 'text/markdown; charset=utf-8'));
  app.get('/god/eden-god.mjs', serveFile('eden-god.mjs', 'text/javascript; charset=utf-8'));
  app.get('/v1/god/status', async (c) => {
    let user: UserRow | null = null; try { user = await d.requireUser(c); } catch { /* visitor */ }
    const god = d.god.godFromToken(bearer(c));
    const you = god ? 'god' : user && d.god.owner === user.id ? 'owner' : user && !d.god.owner ? 'claimant' : user ? 'visitor' : 'anonymous';
    return c.json({ worldId: d.god.opts.worldId, name: d.worldName, hasOwner: !!d.god.owner, you, pending: you === 'owner' || you === 'god' ? d.god.pendingPairings() : [], entities: d.god.model.entities.size, seq: d.god.model.editSeq, base: d.baseOf(c) }, 200, noStore);
  });
  app.get('/v1/god/welcome', async (c) => { const u = await d.requireUser(c); if (!d.god.canApprove(u)) throw new ApiError(403, 'forbidden', 'only this world\'s owner'); return c.text(d.god.welcome(d.baseOf(c), d.worldName), 200, { 'content-type': 'text/markdown; charset=utf-8', ...noStore }); });
  app.get('/v1/god/pairings', async (c) => { const u = await d.requireUser(c); if (!d.god.canApprove(u)) throw new ApiError(403, 'forbidden', 'only this world\'s owner'); return c.json({ pending: d.god.pendingPairings() }, 200, noStore); });

  // ---- pairing (agent-initiated, approved by the world's owner in the browser)
  app.post('/v1/god/pair/start', async (c) => { d.limitIp(c, 'godpairstart', 6, 60_000); const b = await body(c).catch(() => ({})); return c.json({ ok: true, ...d.god.pairStart(typeof b?.agent === 'string' ? b.agent : undefined, d.baseOf(c)) }, 200, noStore); });
  app.get('/v1/god/pair/:code', async (c) => { await d.requireUser(c); return c.json(d.god.pairInfo(c.req.param('code')), 200, noStore); });
  app.post('/v1/god/pair/approve', async (c) => { const u = await d.requireUser(c); const p = codeSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'body must be { code }'); d.god.pairApprove(u, p.data.code); return c.json({ ok: true }, 200, noStore); });
  app.post('/v1/god/pair/poll', async (c) => { d.limitIp(c, 'godpairpoll', 60, 60_000); const b = await body(c); if (typeof b?.poll_token !== 'string') throw new ApiError(400, 'invalid', 'body must be { poll_token }'); return c.json({ ok: true, ...d.god.pairPoll(b.poll_token) }, 200, noStore); });
  /** Owner shortcut for local/dev: mint a god token directly with the owner's own identity. */
  app.post('/v1/god/mint', async (c) => { const u = await d.requireUser(c); const b = await body(c).catch(() => ({})); return c.json({ ok: true, token: d.god.mintFor(u, typeof b?.label === 'string' ? b.label : 'owner'), world: d.god.opts.worldId }, 200, noStore); });

  // ---- god
  app.get('/v1/god/schema', (c) => c.json(godSchema(), 200, { 'cache-control': 'public, max-age=60' }));
  app.post('/v1/god/query', async (c) => c.json(runQuery(d.god.model, await body(c)), 200, noStore));
  app.post('/v1/god/preview', async (c) => { requireGod(c); return c.json(d.god.preview(await body(c)), 200, noStore); });
  app.get('/v1/god/preview/:id', (c) => { const v = d.god.getPreview(c.req.param('id')); if (!v) throw new ApiError(404, 'not-found', 'preview expired or unknown'); return c.json({ id: c.req.param('id'), diff: v.diff, failures: v.failures ?? null }, 200, noStore); });
  app.get('/v1/god/snapshot', (c) => { requireGod(c); return c.json(d.god.godSnapshot(), 200, noStore); });
  app.get('/v1/god/defs', (c) => {
    requireGod(c);
    const q = (c.req.query('q') ?? '').toLowerCase().trim(), tag = c.req.query('tag');
    let defs = d.god.godSnapshot().library as { name: string; ref: string; description: string; tags: string[] }[];
    if (tag) defs = defs.filter((x) => x.tags.includes(tag));
    if (q) { const words = q.split(/\s+/); defs = defs.map((x) => ({ x, score: words.reduce((acc, w) => acc + (x.name.includes(w) ? 3 : 0) + (x.tags.some((t) => t.includes(w)) ? 2 : 0) + (x.description.toLowerCase().includes(w) ? 1 : 0), 0) })).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).map((r) => r.x); }
    return c.json({ defs, count: defs.length }, 200, noStore);
  });
  app.post('/v1/god/dryrun', async (c) => { requireGod(c); return c.json(d.god.dryrun(await body(c)), 200, noStore); });
  app.post('/v1/god/act', async (c) => { requireGod(c); const b = await body(c); const r = d.god.act(b, typeof b?.note === 'string' ? b.note : undefined); return c.json(r, 200, noStore); });
  app.post('/v1/god/undo', (c) => { requireGod(c); const g = c.req.query('group'); return c.json(g ? d.god.undoGroup(g) : d.god.undo(), 200, noStore); });
  app.post('/v1/god/redo', (c) => { requireGod(c); return c.json(d.god.redo(), 200, noStore); });
  app.get('/v1/god/edits', (c) => { requireGod(c); return c.json({ edits: d.god.store.edits(Math.min(200, Number(c.req.query('limit') ?? 50) || 50)) }, 200, noStore); });
  app.get('/v1/god/prayers', (c) => { requireGod(c); return c.json({ prayers: d.god.store.prayers({ unanswered: c.req.query('all') !== '1', limit: 100 }) }, 200, noStore); });
  app.post('/v1/god/answer', async (c) => { requireGod(c); const p = answerSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'body must be { prayer, text }'); const row = d.god.answer(p.data.prayer, p.data.text); if (!row) throw new ApiError(404, 'not-found', 'no such prayer'); return c.json({ ok: true, prayer: row }, 200, noStore); });
  app.get('/v1/god/stream', (c) => {
    requireGod(c);
    const after = Number(c.req.header('last-event-id') ?? c.req.query('after') ?? 0) || 0;
    c.header('Cache-Control', 'no-cache, no-transform'); c.header('X-Accel-Buffering', 'no');
    const response = streamSSE(c, async (stream) => {
      const ac = new AbortController();
      stream.onAbort(() => ac.abort());
      c.req.raw.signal?.addEventListener('abort', () => ac.abort(), { once: true });
      await stream.write(`: ${' '.repeat(2048)}\n\n`);
      await stream.writeSSE({ event: 'hello', retry: 3000, data: JSON.stringify({ contract: 'god/1', world: d.god.opts.worldId, head: d.god.head, seq: d.god.model.editSeq }) });
      const queue: Promise<void>[] = [];
      const unsub = d.god.subscribe(after, (e) => { queue.push(stream.writeSSE({ id: String(e.id), event: e.event, data: JSON.stringify(e.data) }).catch(() => ac.abort())); });
      try { while (!ac.signal.aborted) { await new Promise((r) => setTimeout(r, 15_000)); if (!ac.signal.aborted) await stream.write(`: keepalive ${Date.now()}\n\n`); } }
      catch { /* client gone */ }
      finally { unsub(); }
    });
    response.headers.set('Cache-Control', 'no-cache, no-transform');
    return response;
  });

  // ---- Souls: pray (Soul token), read my prayers and any answers
  app.post('/v1/god/pray', async (c) => { const s = d.soulFromBearer(c); if (!s) throw new ApiError(401, 'unauthorized', 'a Soul token is required to pray'); const p = prayerSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'body must be { text }'); return c.json({ ok: true, prayer: d.god.pray(s, p.data.text), note: 'The god reads prayers when it is present; an answer, if any, appears under GET /v1/god/prayers/mine.' }, 200, noStore); });
  app.get('/v1/god/prayers/mine', (c) => { const s = d.soulFromBearer(c); if (!s) throw new ApiError(401, 'unauthorized', 'a Soul token is required'); return c.json({ prayers: d.god.prayersFor(s.id) }, 200, noStore); });
  app.get('/v1/world/constitution', (c) => c.text(d.god.model.state.constitution || '(this world has no constitution yet)', 200, { 'content-type': 'text/markdown; charset=utf-8', ...noStore }));
}
