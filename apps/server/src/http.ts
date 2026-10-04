import { bodyLimit } from 'hono/body-limit';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono, type Context } from 'hono';
import { decodeJwt } from 'jose';
import { serveStatic } from '@hono/node-server/serve-static';
import { adminSchema, commandSchema, inviteSchema, pairApproveSchema, pairExchangeSchema, pairPollSchema, pairStartSchema, publicEvent, setIntentSchema } from '@sim/protocol';
import { newId, type Auth } from './auth.ts';
import type { Brain } from './brain.ts';
import type { Config } from './config.ts';
import type { Db, SoulRow, UserRow } from './db.ts';
import type { Hub } from './hub.ts';
import { cardGrammar } from '@sim/brain';
import { skillMd } from './skill.ts';
import { agentReader } from './agent-reader.ts';
import { ApiError, type Souls } from './souls.ts';
import { mountMarsStatic } from './mars-static.ts';
import type {TakeArchive} from './take-archive.ts';
import { checkAcceptanceGuard,type AcceptanceGuard,type WorldHost } from './world.ts';
import {captureRenderScene} from '@sim/engine-contract';
import type {CandidateStationV1} from './station.ts';
import { intentTransportError, intentLookupError, type IntentControlV2, type IntentIdentityV2 } from './intent-control.ts';

type Deps = { cfg: Config; db: Db; host: WorldHost; auth: Auth; hub: Hub; brain: Brain; souls: Souls; takes?: TakeArchive; station?:CandidateStationV1; intentV2?:IntentControlV2 };

export function buildApp(d: Deps) {
  if(d.station&&d.station.host!==d.host)throw new Error('station must belong to selected host');
  if(d.intentV2&&(d.intentV2.host!==d.host||d.intentV2.brain!==d.brain||d.intentV2.souls!==d.souls))throw new Error('intent transport must belong to selected host');
  const app = new Hono();
  const bearer = (c: Context) => c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  const ip = (c: Context) => (c.req.header('x-forwarded-for') ?? 'local').split(',')[0].trim();
  const requireUser = async (c: Context): Promise<UserRow> => { const u = await d.auth.userFromToken(bearer(c)); if (!u) throw new ApiError(401, 'unauthorized', 'sign in first'); return u; };
  const requireAdmin = async (c: Context): Promise<UserRow> => { const u = await requireUser(c); if (u.role !== 'admin') throw new ApiError(403, 'forbidden', 'admin only'); return u; };
  // Authentication establishes identity across an await; it does not freeze
  // the role/invitation used to serialize a private candidate view.
  const privateUser=(authenticated:UserRow,requireInvitation=true):UserRow=>{
    if(!d.souls.lifecycle)return authenticated;
    const current=d.db.user(authenticated.id);if(!current)throw new ApiError(401,'unauthorized','sign in first');
    if(requireInvitation)d.souls.requireInvited(current);return current;
  };
  const ownSoul = (authenticated: UserRow, id: string): SoulRow => { const u=privateUser(authenticated),s = d.db.soul(id); if (!s || s.retired_at || s.world_id !== d.host.worldId) throw new ApiError(404, 'not-found', 'no such soul'); if (s.owner !== u.id && u.role !== 'admin') throw new ApiError(403, 'forbidden', 'not your soul'); d.souls.requireControlReady(s); return s; };
  const agentSoul = (c: Context): SoulRow => { const s = d.souls.soulFromToken(bearer(c)); if (!s) throw new ApiError(401, 'unauthorized', 'missing or invalid soul token; pair again (see /skill.md)'); return s; };
  const controlReply=async(c:Context,guard:AcceptanceGuard|undefined,run:()=>Promise<object>)=>{
    const result=await run();if(guard)checkAcceptanceGuard(guard);return c.json(result);
  };
  /** Public base URL as the caller reached us (works on any hostname pointing at the box). */
  const baseOf = (c: Context) => { const host = c.req.header('x-forwarded-host') ?? c.req.header('host'); const proto = c.req.header('x-forwarded-proto') ?? (host?.startsWith('localhost') || host?.startsWith('127.') ? 'http' : 'https'); return host ? `${proto}://${host}${d.cfg.worldPath}` : d.cfg.publicUrl; };
  /** A whole number from the query string, clamped at both ends (to SQLite, LIMIT -1 means no limit at all). */
  const intQ = (c: Context, name: string, def: number, min: number, max: number) => { const n = Math.floor(Number(c.req.query(name) ?? def)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
  const body = async (c: Context) => { try { return await c.req.json(); } catch { throw new ApiError(400, 'bad-json', 'body must be JSON'); } };
  const limitIp = (c: Context, key: string, max: number, windowMs: number) => { const l = d.souls.limits.allow(`${key}:${ip(c)}`, max, windowMs); if (!l.ok) throw new ApiError(429, 'rate-limited', 'too many requests', { retry_after: l.retryAfter }); };

  app.onError((err, c) => {
    if (err instanceof ApiError) { if (err.status === 429 && err.extra?.retry_after) c.header('Retry-After', String(err.extra.retry_after)); return c.json({ ok: false, code: err.code, message: err.message, ...err.extra }, err.status as 400); }
    console.error('[http]', err);
    return c.json({ ok: false, code: 'internal', message: 'internal error' }, 500);
  });
  app.use('*', async (c, next) => { await next(); c.header('X-Robots-Tag', 'noindex, nofollow'); c.header('X-Frame-Options', 'DENY'); c.header('Content-Security-Policy', "frame-ancestors 'none'"); });
  // Nothing a person or an agent sends is large: a command, an intent, a few cards.
  // Apply before parsing/auth/rate errors as well as successful secret responses.
  for (const path of ['/v1/agent/pair', '/v1/agent/pair/*', '/v1/pair/*', '/v1/souls/:id/pair'])
    app.use(path, async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
  for(const path of ['/v1/souls/:id/intent-v2','/v1/souls/:id/intent-v2/*','/v1/agent/intent-v2','/v1/agent/intent-v2/*'])
    app.use(path,async(c,next)=>{c.header('Cache-Control','no-store');await next();});
  for(const path of ['/v1/lifecycle','/v1/lifecycle/*','/v1/me','/v1/souls','/v1/souls/*','/v1/agent/*'])
    app.use(path,async(c,next)=>{if(d.souls.lifecycle)c.header('Cache-Control','no-store');await next();});
  app.use('/v1/brain',async(c,next)=>{if(d.souls.lifecycle)c.header('Cache-Control','no-store');await next();});
  app.use('/v1/*', bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ ok: false, code: 'too-large', message: 'request body is larger than 64 KB' }, 413) }));

  // ---- public
  app.get('/healthz', (c) => c.json({ ok: true, tick: d.host.engine.world.tick, clients: d.hub.clients.size, paused: d.host.paused, build: d.cfg.build, worldId: d.host.worldId }));
  app.get('/v1/config', (c) => c.json({ privyAppId: d.cfg.privyAppId, publicUrl: baseOf(c), worldId: d.host.worldId, worldKey: d.cfg.worldKey, worldPath: d.cfg.worldPath, authReady: d.auth.ready, devAuth: d.auth.devAuth, inviteRequired: d.cfg.inviteRequired, build: d.cfg.build }));
  app.get('/v1/world', (c) => c.json(d.souls.worldSummary()));
  app.get('/v1/debug/world', (c) => c.json(d.host.engine.world));
  app.get('/v1/scene', c => {
    const scene=d.host.engine.renderScene?.()??{scene:null};
    return c.json({...scene,renderSceneRef:captureRenderScene(d.host.engine.rulesVersion,scene).ref},200,{'Cache-Control':'no-store'});
  });
  app.get('/v1/station',c=>d.station?c.json(d.station.view(),200,{'Cache-Control':'no-store'}):
    c.json({ok:false,code:'not-found'},404,{'Cache-Control':'no-store'}));
  app.get('/v1/station/history',c=>{
    if(!d.station)return c.json({ok:false,code:'not-found'},404,{'Cache-Control':'no-store'});
    const q=c.req.query(),at=Number(q.tick);
    if(Object.keys(q).some(k=>!['worldId','epoch','rulesVersion','tick'].includes(k))||q.worldId!==d.host.worldId||!q.epoch||!q.rulesVersion||q.tick===undefined||q.tick.trim()==='')
      return c.json({ok:false,code:'not-found'},404,{'Cache-Control':'no-store'});
    try{return c.json(d.station.history({worldId:q.worldId,epoch:q.epoch,rulesVersion:q.rulesVersion},at),200,{'Cache-Control':'no-store'});}
    catch{return c.json({ok:false,code:'not-found'},404,{'Cache-Control':'no-store'});}
  });
  app.get('/v1/scenes/:hash', c => {
    const hash=c.req.param('hash');
    const capture=/^[a-f0-9]{64}$/.test(hash)?d.db.renderSceneCapture(d.host.worldId,hash):undefined;
    if(!capture)return c.json({ok:false,code:'not-found',message:'No recorded render scene for this world.'},404,{'Cache-Control':'no-store'});
    return c.json({worldId:d.host.worldId,...capture},200,{'Cache-Control':'no-store'});
  });
  app.get('/v1/takes', async c => { const from=intQ(c,'from',0,0,Number.MAX_SAFE_INTEGER),to=intQ(c,'to',d.host.engine.world.tick,0,Number.MAX_SAFE_INTEGER),limit=intQ(c,'limit',120,1,120); const takes=d.takes?await d.takes.read(from,to,limit):d.db.takes(d.host.worldId,from,to,limit); return c.json({serverTick:d.host.engine.world.tick,...takes},200,{'Cache-Control':'no-store'}); });
  app.get('/v1/take', c => c.json({ serverTick: d.host.engine.world.tick, chunks: d.host.engine.takeChunks?.(intQ(c, 'after', -1, -1, Number.MAX_SAFE_INTEGER)) ?? [] }, 200, { 'Cache-Control': 'no-store' }));
  app.get('/v1/kernel', (c) => c.json(d.host.kernelView()));
  app.get('/v1/plays', (c) => c.json({ plays: d.host.recentPlays.slice(-intQ(c, 'limit', 60, 1, 200)) }));
  app.get('/v1/talk', (c) => c.json({ lines: d.db.recentTalk(intQ(c, 'limit', 60, 1, 200)) }));
  app.get('/cards.md', (c) => c.text(cardGrammar(d.host.engine.describeVerbs().filter((v) => v.verb !== 'do_activity')), 200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=60' }));
  app.get('/v1/debug/verbs', (c) => c.json({ rulesVersion: d.host.engine.rulesVersion, dt: d.host.engine.dt, verbs: d.host.engine.describeVerbs() }));
  app.get('/v1/log', (c) => c.json({ events: d.db.events(d.host.worldId, intQ(c, 'after', 0, 0, Number.MAX_SAFE_INTEGER), intQ(c, 'limit', 200, 1, 1000)).map(publicEvent) }));
  const skill = (c: Context) => c.text(skillMd(baseOf(c)), 200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=60' });
  app.get('/skill.md', skill);
  app.get('/v1/skill.md', skill);
  // Selected-world text producer, before the SPA fallback. Origin/prefix come
  // from approved server configuration, never forwarded or caller headers.
  app.get('/llms.txt', c => {
    try { return c.text(agentReader(d.cfg), 200, { 'content-type':'text/plain; charset=utf-8', 'cache-control':'public, max-age=60' }); }
    catch { return c.text('World agent instructions are unavailable.', 503, { 'cache-control':'no-store' }); }
  });
  app.get('/w/:key/llms.txt', c => c.text('No agent reader for this world on this process.', 404));

  // Candidate versioned adapters are installed only by explicit dependency
  // injection. No default capability advertisement or legacy fallback.
  const intentService=()=>{if(!d.intentV2)throw new ApiError(404,'not-found','direction version unavailable');return d.intentV2;};
  const intentIdentity=async(c:Context):Promise<IntentIdentityV2>=>{
    const user=await requireUser(c),token=bearer(c)!;
    if(d.auth.devAuth&&token.startsWith('dev:'))return {userId:user.id,expiresAt:Infinity};
    // userFromToken has verified this exact token. Bind its actual expiry to
    // synchronous effect/final-response guards without trusting a client claim.
    try {const exp=decodeJwt(token).exp;if(typeof exp!=='number'||!Number.isFinite(exp))throw new Error();
      return {userId:user.id,expiresAt:exp*1000};}
    catch {throw new ApiError(401,'unauthorized','sign in first');}
  };
  app.post('/v1/souls/:id/intent-v2',async c=>{
    try {const service=intentService(),scope=service.ownerScope(await intentIdentity(c),c.req.param('id'));
      const receipt=await service.submit(scope,await body(c));service.guard(scope);
      return c.json(receipt,receipt.phase==='received'?202:200);}
    catch(error){throw intentTransportError(error);}
  });
  app.post('/v1/agent/intent-v2',async c=>{
    try {const service=intentService(),scope=service.agentScope(bearer(c));
      const receipt=await service.submit(scope,await body(c));service.guard(scope);
      return c.json(receipt,receipt.phase==='received'?202:200);}
    catch(error){throw intentTransportError(error);}
  });
  app.get('/v1/souls/:id/intent-v2/requests/:requestId',async c=>{
    const service=intentService(),identity=await intentIdentity(c);
    try {const scope=service.ownerScope(identity,c.req.param('id')),receipt=service.lookup(scope,c.req.param('requestId'));
      return c.json(receipt,receipt.phase==='received'?202:200);}
    catch(error){throw intentLookupError(error);}
  });
  app.get('/v1/agent/intent-v2/requests/:requestId',c=>{
    const service=intentService();let scope;
    try {scope=service.agentScope(bearer(c));}catch(error){throw intentTransportError(error);}
    try {const receipt=service.lookup(scope,c.req.param('requestId'));return c.json(receipt,receipt.phase==='received'?202:200);}
    catch(error){throw intentLookupError(error);}
  });

  // ---- signed-in users
  const mySouls = (u: UserRow) => d.db.soulsOf(u.id).filter(s=>!d.souls.lifecycle||(s.world_id===d.host.worldId&&d.souls.invited(u)&&d.souls.controlReady(s))).map((s) => ({ id: s.id, name: s.name, description: s.description, entityId: s.entity_id, hasToken: !!s.token_hash, tokenLabel: s.token_label, tokenCreatedAt: s.token_created_at, tokenLastUsed: s.token_last_used }));
  app.get('/v1/me', async (c) => { const u = privateUser(await requireUser(c),false),souls=mySouls(u); return c.json({ me: {...d.auth.me(u),...(d.souls.lifecycle?{souls:souls.map(s=>s.id)}:{})}, souls, maxSouls: d.cfg.maxSoulsPerUser,
    ...(d.souls.lifecycle?{lifecycleRequests:d.souls.invited(u)?d.souls.lifecycleHistory(u.id):{contract:'owner-lifecycle-list/1',worldId:d.host.worldId,requests:[],nextCursor:null}}:{}) }); });
  app.get('/v1/lifecycle',async c=>{c.header('Cache-Control','no-store');const u=await requireUser(c);return c.json(d.souls.lifecycleHistory(u.id,c.req.query('cursor')??null,c.req.query('owner')??u.id));});
  app.get('/v1/lifecycle/:requestId',async c=>{c.header('Cache-Control','no-store');const u=await requireUser(c);return c.json({lifecycle:d.souls.lifecycleReceipt(u.id,c.req.param('requestId'))});});
  const lifecycleOptIn=(c:Context)=>{
    const header=c.req.header('X-Sim-Lifecycle');
    if(header!==undefined&&(header!=='1'||!d.souls.lifecycle))throw new ApiError(400,'lifecycle-unavailable','this lifecycle opt-in is unavailable');
    return header==='1';
  };
  const lifecycleReply=async(c:Context,userId:string,requestId:string,optIn:boolean)=>{
    if(!optIn)await d.souls.waitLifecycle(userId,requestId);
    const user=await requireUser(c),lifecycle=d.souls.lifecycleReceipt(user.id,requestId);
    if(user.id!==userId)throw new ApiError(404,'not-found','no such lifecycle');
    c.header('Cache-Control','no-store');
    if(lifecycle.state==='refused')return c.json({ok:false,code:'arrival-unavailable',message:'No safe arrival is available.',lifecycle},409);
    const terminal=(lifecycle.state==='admitted'&&lifecycle.ready)||lifecycle.state==='retired';
    if(optIn)return c.json({lifecycle},terminal?200:202);
    if(!terminal)return c.json({ok:false,code:'lifecycle-pending',message:'Completion is unconfirmed; refresh the private lifecycle receipt.',lifecycle},503);
    if(lifecycle.operation==='retire')return c.json({ok:true});
    const soul=d.db.soul(lifecycle.soulId)!;return c.json({ok:true,soul:{id:soul.id,name:soul.name,description:soul.description,entityId:soul.entity_id}});
  };
  app.post('/v1/invite', async (c) => {
    const u = await requireUser(c); const p = inviteSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'code is required');
    d.souls.redeemInvite(u, p.data.code); d.hub.refreshMe(u.id); return c.json({ ok: true });
  });
  app.post('/v1/souls', async (c) => {
    const u = await requireUser(c); d.souls.requireInvited(u);
    const optIn=lifecycleOptIn(c);
    const lim = d.souls.limits.allow(`create:${u.id}`, 5, 3600_000); if (!lim.ok) throw new ApiError(429, 'rate-limited', 'too many new souls this hour', { retry_after: lim.retryAfter });
    if(d.souls.lifecycle){const op=d.souls.acceptLifecycleCreate(u.id,await body(c));d.hub.refreshMe(u.id);return lifecycleReply(c,u.id,op.requestId,optIn);}
    const s = await d.souls.create(u.id, await body(c)); d.hub.refreshMe(u.id);
    return c.json({ ok: true, soul: { id: s.id, name: s.name, description: s.description, entityId: s.entity_id } });
  });
  app.delete('/v1/souls/:id', async (c) => { const u = await requireUser(c),optIn=lifecycleOptIn(c),soul=ownSoul(u,c.req.param('id'));if(d.souls.lifecycle){const op=d.souls.acceptLifecycleRetire(u.id,soul);d.hub.refreshMe(soul.owner);return lifecycleReply(c,u.id,op.requestId,optIn);}await d.souls.retire(soul); d.hub.refreshMe(u.id); return c.json({ ok: true }); });
  app.get('/v1/souls/:id', async (c) => { const u = await requireUser(c); return c.json(d.souls.dashboard(ownSoul(u, c.req.param('id')))); });
  app.get('/v1/souls/:id/timeline', async (c) => { const u = await requireUser(c); return c.json({ events: d.souls.timeline(ownSoul(u, c.req.param('id')), intQ(c, 'limit', 80, 1, 200)) }); });
  app.get('/v1/souls/:id/deck', async (c) => { const u = await requireUser(c); return c.json(d.souls.deck(ownSoul(u, c.req.param('id')))); });
  app.get('/v1/souls/:id/talk', async (c) => { const u = await requireUser(c); return c.json({ lines: d.db.recentTalk(60, ownSoul(u, c.req.param('id')).id) }); });
  app.post('/v1/souls/:id/cards', async (c) => { const u = await requireUser(c); d.souls.requireInvited(u);const s=ownSoul(u,c.req.param('id')),input=await body(c),guard=d.souls.ownerControlGuard(s,u.id);return controlReply(c,guard,()=>d.souls.proposeCards(s,input,guard)); });
  app.get('/v1/souls/:id/perceive', async (c) => { const u = await requireUser(c); return c.json(d.souls.perceive(ownSoul(u, c.req.param('id')))); });
  app.post('/v1/souls/:id/command', async (c) => {
    const u = await requireUser(c); d.souls.requireInvited(u); const s = ownSoul(u, c.req.param('id'));
    const p = commandSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'text is required (1–280 characters)');
    const guard=d.souls.ownerControlGuard(s,u.id);return controlReply(c,guard,()=>d.souls.command(s,p.data.text,'web',guard));
  });
  app.get('/v1/souls/:id/mandate',async c=>{const u=await requireUser(c);return c.json({rules:d.souls.rules(ownSoul(u,c.req.param('id')))});});
  app.post('/v1/souls/:id/mandate',async c=>{const u=await requireUser(c);d.souls.requireInvited(u);const s=ownSoul(u,c.req.param('id')),input=await body(c),guard=d.souls.ownerControlGuard(s,u.id);return controlReply(c,guard,()=>d.souls.steer(s,input,'web',guard));});
  app.delete('/v1/souls/:id/mandate/:rule',async c=>{const u=await requireUser(c),s=ownSoul(u,c.req.param('id')),guard=d.souls.ownerControlGuard(s,u.id);return controlReply(c,guard,()=>d.souls.removeRule(s,c.req.param('rule'),guard));});
  app.post('/v1/souls/:id/intent', async (c) => {
    const u = await requireUser(c); d.souls.requireInvited(u); const s = ownSoul(u, c.req.param('id'));
    const p = setIntentSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'body must be { intent: { agenda: [{card, target?, of?}], note? } } or { intent: { goal, target?, note? } }; see /skill.md');
    const guard=d.souls.ownerControlGuard(s,u.id);return controlReply(c,guard,async()=>{const r=await d.souls.setIntent(s,p.data.intent,'web',guard);return {ok:true,intent:r.intent,text:r.text,tick:r.event.tick,seq:r.event.seq};});
  });
  app.post('/v1/souls/:id/pair', async (c) => { const u = await requireUser(c); d.souls.requireInvited(u); return c.json({ ok: true, ...d.souls.pairCode(ownSoul(u, c.req.param('id')), baseOf(c), u) }); });
  app.post('/v1/souls/:id/revoke', async (c) => { const u = await requireUser(c); d.db.setSoulToken(ownSoul(u, c.req.param('id')).id, null); return c.json({ ok: true }); });
  app.post('/v1/souls/:id/shot', async (c) => {
    const u = await requireUser(c); const s = ownSoul(u, c.req.param('id')); const m = d.host.minds.get(s.id); if (!m) throw new ApiError(409, 'not-in-world', 'not in the world');
    const lim = d.souls.limits.allow(`shot:${s.owner}`, 12, 60_000); if (!lim.ok) throw new ApiError(429, 'rate-limited', 'slow down', { retry_after: lim.retryAfter });
    const guard=d.souls.ownerControlGuard(s,u.id);if(guard)checkAcceptanceGuard(guard);
    return controlReply(c,guard,async()=>({ok:true,shot:await d.brain.shotFor(m)}));
  });
  // approving an agent that asked to be paired
  app.get('/v1/pair/:code', async (c) => { await requireUser(c); return c.json(d.souls.pairInfo(c.req.param('code'))); });
  app.post('/v1/pair/approve', async (c) => {
    const u = await requireUser(c); d.souls.requireInvited(u); const p = pairApproveSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'body must be { code, soulId }');
    d.souls.pairApprove(u, p.data.code, ownSoul(u, p.data.soulId)); return c.json({ ok: true });
  });
  // model calls: admins see all; owners see calls about their own Souls
  app.get('/v1/brain', async (c) => {
    const u = privateUser(await requireUser(c));
    return c.json({ calls: d.db.brainCalls(intQ(c, 'limit', 100, 1, 500), { tier: c.req.query('tier') || undefined, ...(d.souls.lifecycle?{worldId:d.host.worldId}:{}), soulIds: u.role === 'admin' ? (c.req.query('soul') ? [c.req.query('soul')!] : null) : (d.souls.lifecycle?mySouls(u):d.db.soulsOf(u.id)).map((s) => s.id).filter((id) => !c.req.query('soul') || id === c.req.query('soul')) }) });
  });
  app.get('/v1/prompt/:hash', async (c) => {
    c.header('Cache-Control', 'no-store');
    const u = privateUser(await requireUser(c));
    const t = d.db.prompt(c.req.param('hash'), { worldId: d.host.worldId, userId: u.id, admin: u.role === 'admin',...(d.souls.lifecycle&&u.role!=='admin'?{soulIds:mySouls(u).map(s=>s.id)}:{}) });
    if (t === null) throw new ApiError(404, 'not-found', 'no such prompt');
    return c.text(t);
  });

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
      case 'budget': d.brain.budget = Math.min(1, a.usdPerDay); void d.host.enqueue('admin', who, { action: 'budget', usdPerDay: a.usdPerDay }); break;
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
  app.post('/v1/agent/pair/poll', async (c) => {
    limitIp(c, 'pairpoll', 60, 60_000);
    const p = pairPollSchema.safeParse(await body(c));
    if (!p.success) throw new ApiError(400, 'invalid', 'body must be { poll_token }');
    return c.json({ ok: true, ...d.souls.pairPoll(p.data.poll_token) });
  });
  // Legacy compatibility only; the audited launcher uses the POST body above.
  app.get('/v1/agent/pair/poll', (c) => { limitIp(c, 'pairpoll', 60, 60_000); return c.json({ ok: true, ...d.souls.pairPoll(c.req.query('poll_token') ?? '') }, 200, { 'cache-control': 'no-store' }); });
  app.get('/v1/agent/me', (c) => { const s = agentSoul(c); return c.json({ soul: { id: s.id, name: s.name, description: s.description }, paired_as: s.token_label, since: s.token_created_at }); });
  app.get('/v1/agent/status', (c) => c.json(d.souls.status(agentSoul(c))));
  app.get('/v1/agent/perceive', (c) => c.json(d.souls.perceive(agentSoul(c))));
  app.get('/v1/agent/world', (c) => { agentSoul(c); return c.json(d.souls.worldSummary()); });
  app.get('/v1/agent/log', (c) => c.json({ events: d.souls.soulLog(agentSoul(c)) }));
  app.get('/v1/agent/wait', async (c) => {const s=agentSoul(c),guard=d.souls.agentControlGuard(s,bearer(c));return controlReply(c,guard,()=>d.souls.wait(s,intQ(c,'seconds',30,1,55)));});
  app.post('/v1/agent/intent', async (c) => {
    const s = agentSoul(c); const p = setIntentSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'body must be { intent: { agenda: [{card, target?, of?}], note? } } or { intent: { goal, target?, note? } }; see /skill.md');
    const guard=d.souls.agentControlGuard(s,bearer(c));return controlReply(c,guard,async()=>{const r=await d.souls.setIntent(s,p.data.intent,'api',guard);return {ok:true,accepted_at_tick:r.event.tick,seq:r.event.seq,intent:r.intent,text:r.text,status:d.souls.status(s)};});
  });
  app.post('/v1/agent/command', async (c) => {
    const s = agentSoul(c); const p = commandSchema.safeParse(await body(c)); if (!p.success) throw new ApiError(400, 'invalid', 'text is required (1–280 characters)');
    const guard=d.souls.agentControlGuard(s,bearer(c));return controlReply(c,guard,()=>d.souls.command(s,p.data.text,'api',guard));
  });
  app.get('/v1/agent/mandate',c=>c.json({rules:d.souls.rules(agentSoul(c))}));
  app.post('/v1/agent/mandate',async c=>{const s=agentSoul(c),input=await body(c),guard=d.souls.agentControlGuard(s,bearer(c));return controlReply(c,guard,()=>d.souls.steer(s,input,'api',guard));});
  app.delete('/v1/agent/mandate/:rule',async c=>{const s=agentSoul(c),guard=d.souls.agentControlGuard(s,bearer(c));return controlReply(c,guard,()=>d.souls.removeRule(s,c.req.param('rule'),guard));});
  app.get('/v1/agent/deck', (c) => c.json(d.souls.deck(agentSoul(c))));
  app.post('/v1/agent/cards', async (c) => {const s=agentSoul(c),input=await body(c),guard=d.souls.agentControlGuard(s,bearer(c));return controlReply(c,guard,()=>d.souls.proposeCards(s,input,guard));});
  app.post('/v1/agent/release', (c) => { const s = agentSoul(c); d.db.setSoulToken(s.id, null); return c.json({ ok: true }); });

  // ---- static web app (SPA)
  const worldAssets = new URL('../../../worlds', import.meta.url).pathname;
  app.get('/world-assets/*', serveStatic({ root: worldAssets, rewriteRequestPath: p => p.replace(/^\/world-assets/, '') }));
  app.get('/buildings', c => c.html(`<main style="max-width:1100px;margin:auto;font:18px system-ui;padding:24px"><a href="/">Sim worlds</a><h1>Ceramic Tower and Minaret Temple</h1><p>First procedural versions, rebuilt after Vanessa Rosa's ceramics. Open rooms and shafts are sized for floating heads.</p><img style="width:100%" src="/world-assets/littlemartians/buildings/previews/both.jpg" alt="Ceramic Tower and Minaret Temple"/><h2>Inside the rooms</h2><img style="width:48%" src="/world-assets/littlemartians/buildings/previews/ceramic-tower-inside-L1.jpg" alt="Tower second room"/><img style="width:48%" src="/world-assets/littlemartians/buildings/previews/minaret-temple-inside-L1.jpg" alt="Temple domed room"/></main>`));
  if (existsSync(d.cfg.marsWebDir)) mountMarsStatic(app, d.cfg.marsWebDir);
  if (existsSync(d.cfg.webDir)) {
    const index = readFileSync(join(d.cfg.webDir, 'index.html'), 'utf8');
    app.use('/assets/*', async (c, next) => { await next(); if (c.res.ok) c.header('Cache-Control', 'public, max-age=31536000, immutable'); });
    app.use('/assets/*', serveStatic({ root: d.cfg.webDir }));
    app.get('*', (c) => (c.req.path.startsWith('/v1/') || c.req.path.startsWith('/mcp') ? c.json({ ok: false, code: 'not-found', message: 'no such route' }, 404) : c.html(index, 200, { 'Cache-Control': 'no-cache' })));
  } else app.get('/', (c) => c.text('Sim server is running. The web app has not been built (pnpm build).'));
  return app;
}
