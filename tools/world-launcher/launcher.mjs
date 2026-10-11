#!/usr/bin/env node
// World launcher (spec <eden4>/29 WP6): one local Node process that keeps a
// registry of entity worlds, runs one Sim server per world on a private port,
// and fronts them all on one origin.
//
//   node tools/world-launcher/launcher.mjs [--port 4980] [--data <dir>] [--range 5101-5149]
//        [--auth-env <clerk.env> --public-origin https://sim.eden.art] [--soul-cli <eden-agent.mjs>] [--soul-skill <skill.md>] [--soul-instructions <instructions.md>]
//
//   GET  /                       the web app (homepage: worlds + New world)
//   GET  /__sim/worlds.json      local-worlds/1, extended with slug/name/template/god/entities
//   GET  /__sim/templates.json   genesis templates (worlds/templates/*.json) + the empty plain
//   POST /__sim/worlds           {name, template} → creates, waits for /healthz → {slug, url}
//   GET  /__sim/worlds/<slug>    one world + what the launcher has seen (looks, agent, previews)
//   GET  /__sim/launcher         children, ports, pids, restarts (diagnostics; direct local requests only)
//   GET  /__sim/healthz          {ok, build, worlds, running, caps, memAvailableMb} (also /healthz)
//   POST /__sim/op/create-world  operator only (direct loopback requests; anything through a reverse proxy is refused):
//                                {name, template, owner | ownerOf, godName?} → a world born owned by an existing account
//                                (`owner` = account id, or `ownerOf` = the slug of a world whose god it is). CLI: op.mjs
//   /w/<slug>/*                  proxied to that world (HTTP, SSE, WebSocket); started on demand
//
// --base /worlds puts all of the above under one path prefix (/worlds/, /worlds/__sim/…, /worlds/w/<slug>/…,
// /worlds/assets/…), so one reverse-proxy rule serves the launcher beside another release on the same origin
// without touching its /, /assets, /__sim, /v1 or /w/<its worlds>. Worlds then run with WORLD_PATH=<base>/w/<slug>
// (their API, WebSocket, skill and CLI URLs carry the prefix) and the web build must be made with
// `vite build --base <base>/` plus apps/web/src/base-path.ts (tools/world-launcher/deploy/release.sh does both).
//
// Production (lane P3; tools/world-launcher/deploy/): --base /worlds --public-origin https://sim.eden.art
// --auth-env <path> --max-worlds N --max-running N --min-free-mb N --world-heap-mb N --create-limit N. Children run edge
// minds; dev auth only on an http origin.
//
// Sign-in: dev auth (local names) by default. With --auth-env <file> (or SIM_AUTH_ENV_FILE) every world signs in
// with Clerk: children read the file by path (node --env-file), dev tokens are refused, all worlds share one
// account registry (<data>/accounts.sqlite), and POST /__sim/worlds needs the creator's Clerk session token —
// the new world is claimed for them at birth. The launcher itself learns only the public Clerk settings.
// --public-origin is the origin people use (it must be one of CLERK_AUTHORIZED_PARTIES).
//
// Every world serves ONE skill at /w/<slug>/SKILL.md (God mode + Soul mode). Its Soul mode points at the Soul CLI 1.9
// and its guides, served as is by every world (/eden-agent.mjs, /skill.md, /instructions.md). By default these are the
// pinned copies in tools/world-launcher/soul/ (SOURCES.json: shas and provenance); --soul-cli / --soul-skill /
// --soul-instructions override them.
//
// Local only: binds 127.0.0.1, edge minds (owners' agents think; the world pays for none), no credentials, no tunnels.
import { execFileSync } from 'node:child_process';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Registry, SLUG_RE, listTemplates, slugFor } from './registry.mjs';
import { ChildPool } from './children.mjs';
import { decorateCommand, memAvailableMb, productionSettings } from './production.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '../..');
/** The Soul CLI and guides every world serves unless overridden (tools/world-launcher/soul/SOURCES.json). */
export const SOUL = { cli: join(here, 'soul/eden-agent.mjs'), skill: join(here, 'soul/skill.md'), instructions: join(here, 'soul/instructions.md') };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
const json = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }).end(JSON.stringify(body)); };
const BUILD = (() => { try { return readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../BUILD'), 'utf8').trim(); } catch { return 'dev'; } })();
/** Direct requests from this machine (not through a reverse proxy, which adds x-forwarded-for). */
const direct = (req) => !req.headers['x-forwarded-for'] && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');

/**
 * @param {{ port?: number, dataDir?: string, range?: [number, number], root?: string, webDir?: string,
 *           templatesDir?: string, marsWebDir?: string, eager?: number, idleMs?: number, command?: Function, log?: (s: string) => void,
 *           publicOrigin?: string, devAuth?: boolean, authEnvFile?: string, maxWorlds?: number, maxRunning?: number,
 *           minFreeMb?: number, worldHeapMb?: number, createLimit?: number, base?: string,
 *           soulCli?: string, soulSkill?: string, soulInstructions?: string }} cfg
 * Without the production fields the launcher behaves as it always did locally (dev auth, 200 worlds, origin = bind).
 */
export async function openLauncher(cfg = {}) {
  const root = resolve(cfg.root ?? ROOT);
  const port = cfg.port ?? 4980;
  const range = cfg.range ?? [5101, 5149];
  if (!Number.isInteger(port) || !range.every(Number.isInteger) || range[0] > range[1]) throw new Error('launcher: explicit integer port and child range required');
  if (port >= range[0] && port <= range[1]) throw new Error('launcher: the proxy port must be outside the child range');
  const dataDir = resolve(cfg.dataDir ?? join(root, '.lane/launcher'));
  const webDir = resolve(cfg.webDir ?? join(root, 'apps/web/dist'));
  const templatesDir = resolve(cfg.templatesDir ?? join(root, 'worlds/templates'));
  const marsWebDir = cfg.marsWebDir ?? (existsSync(join(root, '.lane/mars-web')) ? join(root, '.lane/mars-web') : undefined);
  const log = cfg.log ?? ((s) => console.log(`[launcher] ${s}`));
  const origin = `http://127.0.0.1:${port}`;
  const publicOrigin = (cfg.publicOrigin ?? origin).replace(/\/$/, '');
  const authEnvFile = cfg.authEnvFile ?? process.env.SIM_AUTH_ENV_FILE;
  const prod = { ...productionSettings({ ...cfg, authEnvFile, range }, origin), build: BUILD };
  const auth = clerkAuth(authEnvFile, dataDir, publicOrigin);
  const MAX_WORLDS = prod.maxWorlds;
  const behindProxy = publicOrigin !== origin;
  const B = prod.base, wp = (slug) => `${B}/w/${slug}`;
  const registry = new Registry(dataDir);
  const createLimit = cfg.createLimit ?? Infinity, made = new Map();
  /** Open WebSocket (upgraded) connections per world: a world someone is watching never goes to sleep. */
  const live = new Map();
  /** What the launcher sees go past, per world (not persisted beyond the registry's own fields). */
  const seen = new Map();
  const seenOf = (slug) => { let s = seen.get(slug); if (!s) { s = { looks: registry.get(slug)?.looks ?? 0, lastLookAt: registry.get(slug)?.lastLookAt ?? null, agentSeenAt: registry.get(slug)?.agentSeenAt ?? null, previews: [] }; seen.set(slug, s); } return s; };
  const stats = new Map();   // slug → { at, god, entities, seq }
  const pool = new ChildPool({ root, range, logDir: join(dataDir, 'logs'), pidFile: join(dataDir, 'children.json'), idleMs: cfg.idleMs, marsWebDir, publicOrigin, auth: auth?.child, soulCliFile: resolve(cfg.soulCli ?? SOUL.cli), soulSkillFile: resolve(cfg.soulSkill ?? SOUL.skill), soulInstructionsFile: resolve(cfg.soulInstructions ?? SOUL.instructions), command: cfg.command, healthPath: (s) => `${wp(s)}/healthz`,
    maxRunning: prod.maxRunning, minFreeMb: prod.minFreeMb, busy: (slug) => (live.get(slug) ?? 0) > 0, decorate: (c) => decorateCommand({ ...c, env: { ...c.env, WEB_DIR: webDir } }, prod), /* worlds serve the same web build, with its --base */ onChange: (slug) => { const s = pool.status(slug); if (s.port && registry.get(slug) && registry.get(slug).port !== s.port) registry.update(slug, { port: s.port }); } });
  const worldEnv = (w) => ({ ...w, dataDir: registry.worldDir(w.slug), templateFile: w.template && w.template !== 'empty' ? listTemplates(templatesDir, { all: true }).find((t) => t.id === w.template)?.file ?? null : null });

  // ---------- reads
  async function refreshStats(w) {
    const st = pool.status(w.slug);
    if (st.status !== 'running') return;
    const prev = stats.get(w.slug);
    if (prev && Date.now() - prev.at < 3000) return;
    try {
      const r = await fetch(`http://127.0.0.1:${st.port}${wp(w.slug)}/v1/god/status`, { signal: AbortSignal.timeout(1500) });
      if (!r.ok) return;
      const s = await r.json();
      // who lives here (the public list the world page shows): the homepage's Souls count
      const souls = await fetch(`http://127.0.0.1:${st.port}${wp(w.slug)}/v1/world/souls`, { signal: AbortSignal.timeout(1500) }).then((x) => (x.ok ? x.json() : null)).then((d) => (Array.isArray(d?.souls) ? d.souls.length : null)).catch(() => null);
      stats.set(w.slug, { at: Date.now(), god: !!s.hasOwner, entities: s.entities, seq: s.seq, souls: souls ?? prev?.souls ?? w.souls ?? null });
      if (w.god !== !!s.hasOwner || w.entities !== s.entities || (souls !== null && w.souls !== souls)) registry.update(w.slug, { god: !!s.hasOwner, entities: s.entities, seq: s.seq, ...(souls !== null ? { souls } : {}) });
    } catch { /* busy; keep the cached numbers */ }
  }
  const describe = (w) => {
    const st = pool.status(w.slug), s = stats.get(w.slug), t = listTemplates(templatesDir, { all: true }).find((x) => x.id === w.template);
    return { key: w.slug, worldKey: w.slug, slug: w.slug, name: w.name, basePath: wp(w.slug), configPath: `${wp(w.slug)}/v1/config`, url: auth ? `${wp(w.slug)}/` : `${wp(w.slug)}/?dev=1`, template: w.template, templateName: t?.name ?? (w.template === 'empty' ? 'Empty plain' : w.template), createdAt: w.createdAt, owner: w.owner ?? null, god: s?.god ?? w.god ?? false, entities: s?.entities ?? w.entities ?? null, seq: s?.seq ?? w.seq ?? null, souls: s?.souls ?? w.souls ?? null, godName: (s?.god ?? w.god) ? (w.godName ?? null) : null, status: st.status, restarts: st.restarts ?? 0 };
  };
  async function worldsJson() {
    await Promise.all(registry.worlds.map(refreshStats));
    return { contract: 'local-worlds/1', launcher: 'world-launcher/1', worlds: [...registry.worlds].sort((a, b) => b.createdAt - a.createdAt).map(describe), templates: listTemplates(templatesDir).map(({ file: _f, ...t }) => t), limits: { maxWorlds: MAX_WORLDS, maxRunning: prod.maxRunning, childPorts: range }, auth: auth ? auth.public : { provider: 'dev' } };
  }

  // ---------- create
  let creating = Promise.resolve();
  /** Under Clerk, cheaply refuse a bad creator token before booting anything (when some world is awake to ask). */
  async function creatorOk(authorization) {
    const awake = registry.worlds.map((w) => ({ w, s: pool.status(w.slug) })).find((x) => x.s.status === 'running');
    if (!awake) return true;  // nobody to ask yet: the claim after boot decides
    try { const r = await fetch(`http://127.0.0.1:${awake.s.port}${wp(awake.w.slug)}/v1/account/session`, { headers: { authorization }, signal: AbortSignal.timeout(5000) }); return r.status !== 401; }
    catch { return true; }
  }
  /** `op.owner`: the operator's create (direct loopback only, below): the world is born owned by that existing account
   *  (WORLD_OWNER_ID on its first boot only matters while it has no store yet), with no sign-in and no claim. */
  async function createWorld(body, authorization, op = null) {
    if (!op && auth && !/^Bearer\s+\S+/i.test(authorization ?? '')) return [401, { ok: false, code: 'signin-required', message: 'sign in first: a new world belongs to whoever makes it' }];
    if (!op && auth && !(await creatorOk(authorization))) return [401, { ok: false, code: 'signin-required', message: 'your sign-in was not accepted; sign in again' }];
    const name = typeof body?.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
    if (!name || name.length > 60) return [400, { ok: false, code: 'invalid', message: 'name: 1–60 characters' }];
    const templates = listTemplates(templatesDir);
    const template = typeof body?.template === 'string' ? body.template : 'empty';
    const t = templates.find((x) => x.id === template);
    if (!t) return [400, { ok: false, code: 'invalid', message: `unknown template ${template}; one of ${templates.map((x) => x.id).join(', ')}` }];
    if (registry.worlds.length >= MAX_WORLDS) return [409, { ok: false, code: 'full', message: `this launcher holds at most ${MAX_WORLDS} worlds` }];
    const slug = slugFor(name, registry.slugs());
    const entry = { slug, name, template: t.id, port: null, createdAt: Date.now(), ...(typeof body?.creator === 'string' && body.creator ? { createdBy: body.creator.slice(0, 40) } : {}) };
    rmSync(registry.worldDir(slug), { recursive: true, force: true });
    mkdirSync(registry.worldDir(slug), { recursive: true });
    registry.add(entry);
    const t0 = performance.now();
    try { await pool.ensure(op ? { ...worldEnv(entry), bornOwner: op.owner } : worldEnv(entry)); }
    catch (e) {
      await pool.stop(slug); pool.kids.delete(slug); registry.remove(slug); rmSync(registry.worldDir(slug), { recursive: true, force: true });
      if (e.code === 'capacity') return [503, { ok: false, code: 'capacity', message: e.message }];
      return [500, { ok: false, code: 'boot-failed', message: e.message }];
    }
    const ms = Math.round(performance.now() - t0);
    // The creator is the one god: the new world claims them now, with their own sign-in (Clerk: required).
    let owner = op ? op.owner : null;
    if (op) {
      const got = worldOwner(slug);
      if (got !== op.owner) {
        await pool.stop(slug); pool.kids.delete(slug); registry.remove(slug); rmSync(registry.worldDir(slug), { recursive: true, force: true });
        return [500, { ok: false, code: 'owner-mismatch', message: `the new world booted owned by ${got ?? 'nobody'}, not ${op.owner}; removed` }];
      }
    } else if (authorization) {
      const port = pool.status(slug).port;
      const r = await fetch(`http://127.0.0.1:${port}${wp(slug)}/v1/god/claim`, { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15_000) }).catch((e) => ({ ok: false, status: 0, json: async () => ({ message: e.message }) }));
      const d = await r.json().catch(() => ({}));
      if (r.ok) owner = d.owner ?? null;
      else if (auth) {
        await pool.stop(slug); pool.kids.delete(slug); registry.remove(slug); rmSync(registry.worldDir(slug), { recursive: true, force: true });
        return [r.status === 403 ? 403 : 401, { ok: false, code: 'signin-required', message: `the new world could not make you its god: ${d.message ?? r.status}; sign in again and retry` }];
      } else log(`created ${slug} unclaimed: the creator's dev sign-in was refused (${r.status})`);
    }
    // the name the creator chose to show as this world's god on the homepage (optional; never their account id or email)
    const godName = typeof body?.godName === 'string' ? body.godName.trim().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} _'.-]/gu, '').slice(0, 32) : '';
    if (owner && godName) registry.update(slug, { godName });
    log(`created ${slug} (${t.id}) on :${pool.status(slug).port} in ${ms} ms${op ? `, owned by ${op.owner} (operator)` : owner ? ', claimed by its creator' : ''}`);
    await refreshStats(entry);
    return [201, { ok: true, slug, url: auth ? `${wp(slug)}/?new=1` : `${wp(slug)}/?dev=1&new=1`, bootMs: ms, claimed: !!owner, ...(op ? { owner } : {}), world: describe(entry) }];
  }

  // ---------- operator (direct loopback only)
  /** The god of a world, read from its own store (read-only), or null. */
  function worldOwner(slug) {
    const file = join(registry.worldDir(slug), 'sim.db');
    if (!existsSync(file)) return null;
    const db = new DatabaseSync(file, { readOnly: true });
    try { const r = db.prepare('SELECT body FROM world_meta_v1 WHERE world_id=?').get(`${slug}-1`); return r ? JSON.parse(r.body).owner ?? null : null; }
    finally { db.close(); }
  }
  /** Under Clerk: is this an account of the shared registry (account id only; nothing else is read)? */
  function accountExists(id) {
    if (!auth) return true;
    if (!existsSync(auth.child.registryPath)) return false;
    const db = new DatabaseSync(auth.child.registryPath, { readOnly: true });
    try { return !!db.prepare('SELECT 1 FROM provider_accounts_v1 WHERE account_id=?').get(id); }
    finally { db.close(); }
  }
  async function opCreateWorld(body) {
    let owner = typeof body?.owner === 'string' ? body.owner.trim() : '';
    if (!owner && typeof body?.ownerOf === 'string') {
      const of = registry.get(body.ownerOf); if (!of) return [404, { ok: false, code: 'not-found', message: `no world ${body.ownerOf}` }];
      owner = worldOwner(of.slug) ?? '';
      if (!owner) return [409, { ok: false, code: 'no-owner', message: `${of.slug} has no god` }];
    }
    if (!/^[A-Za-z0-9_:.-]{3,96}$/.test(owner)) return [400, { ok: false, code: 'invalid', message: 'owner (account id) or ownerOf (slug of a world it owns) is required' }];
    if (!accountExists(owner)) return [404, { ok: false, code: 'no-account', message: `no account ${owner} in this launcher's account registry` }];
    const run = creating.then(() => createWorld(body, undefined, { owner })); creating = run.catch(() => {});
    return run;
  }

  // ---------- static (the web app itself; everything else comes from a world)
  function serveFile(res, file, cache) {
    let st; try { st = statSync(file); } catch { return false; }
    if (!st.isFile()) return false;
    res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'content-length': st.size, 'cache-control': cache });
    createReadStream(file).pipe(res);
    return true;
  }
  const inside = (base, rel) => { const p = normalize(join(base, rel)); return p === base || p.startsWith(base + sep) ? p : null; };

  // ---------- proxy
  const anyRunning = () => registry.worlds.map((w) => pool.status(w.slug)).find((s) => s.status === 'running')?.port ?? null;
  function observe(slug, req, url) {
    const s = seenOf(slug), rest = url.pathname.slice(wp(slug).length) || '/';
    // `god look` loads the page with ?shot=1 (29 WP0): count it as a look.
    if (req.method === 'GET' && (rest === '/' || rest === '') && url.searchParams.get('shot') === '1') { s.looks++; s.lastLookAt = Date.now(); registry.update(slug, { looks: s.looks, lastLookAt: s.lastLookAt }); }
    // an agent (not a browser) using a god token
    const auth = req.headers.authorization ?? '', ua = req.headers['user-agent'] ?? '';
    if (!s.agentSeenAt && rest.startsWith('/v1/god/') && /^Bearer god_/i.test(auth) && !/Mozilla\//.test(ua)) { s.agentSeenAt = Date.now(); registry.update(slug, { agentSeenAt: s.agentSeenAt }); }
    return rest;
  }
  function proxyHttp(req, res, targetPort, { tee, path } = {}) {
    // Behind Caddy (a public origin other than our own) keep the visitor's x-forwarded-for, so per-person limits in
    // the worlds see people, not the proxy; locally it is set to the connecting address as before.
    const xff = behindProxy && req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'] : (req.socket.remoteAddress ?? '127.0.0.1');
    const up = request({ hostname: '127.0.0.1', port: targetPort, path: path ?? req.url, method: req.method, headers: { ...req.headers, 'x-forwarded-for': xff } }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      if (tee && (r.statusCode ?? 0) < 300) { const chunks = []; r.on('data', (c) => { if (chunks.length < 64) chunks.push(c); }); r.on('end', () => { try { tee(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { /* not json */ } }); }
      r.pipe(res);
    });
    up.on('error', () => { if (!res.headersSent) json(res, 502, { ok: false, code: 'world.unavailable' }); else res.destroy(); });
    req.on('aborted', () => up.destroy()); res.on('close', () => up.destroy());
    req.pipe(up);
  }
  async function toWorld(req, res, slug, url) {
    const w = registry.get(slug);
    if (!w) {
      if ((req.headers.accept ?? '').includes('text/html')) { res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><meta charset="utf-8"><title>No such world</title><body style="font:16px system-ui;max-width:640px;margin:12vh auto;padding:0 20px"><h1>No world called “${slug.replace(/[<>&"]/g, '')}” here</h1><p><a href="${B}/">See the worlds here</a>, or make a new one.</p>`); return; }
      json(res, 404, { ok: false, code: 'world.not-served', slug }); return;
    }
    let p;
    try { p = await pool.ensure(worldEnv(w)); }
    catch (e) { json(res, 503, { ok: false, code: 'world.unavailable', slug, message: e.message }, { 'retry-after': '3' }); return; }
    const rest = observe(slug, req, url);
    const tee = req.method === 'POST' && rest === '/v1/god/preview' ? (body) => { if (typeof body?.id !== 'string') return; const s = seenOf(slug); s.previews.unshift({ id: body.id, accepted: !!body.accepted, summary: body.summary ?? null, failures: body.failures ?? null, at: Date.now() }); s.previews.length = Math.min(s.previews.length, 20); } : undefined;
    proxyHttp(req, res, p, { tee });
  }

  const sockets = new Set();
  const server = createServer(async (req, res) => {
    let url; try { url = new URL(req.url ?? '/', origin); } catch { json(res, 400, { ok: false, code: 'bad-url' }); return; }
    // Under --base everything of ours is <base>/…; `path` is the part after the base. Outside the base only the
    // public static files a world page also asks for at the root (/modular, /mars-assets, …) are answered, the way
    // the other release on the origin answers them in production; the rest is not ours.
    let path = url.pathname, outside = false;
    if (B) {
      if (path === B) { res.writeHead(308, { location: `${B}/${url.search}` }).end(); return; }
      if (path.startsWith(`${B}/`)) path = path.slice(B.length); else outside = true;
    }
    try {
      if (outside) {
        if (path === '/healthz' && direct(req)) { json(res, 200, { ok: true, service: 'world-launcher', base: B, build: BUILD }); return; }
        const p = (req.method === 'GET' || req.method === 'HEAD') && /^\/(modular|mars-assets|engine|browser|models|history|2020|world-assets)\/|^\/data\/manifest\.json$/.test(path) && anyRunning();
        if (p) { proxyHttp(req, res, p); return; }
        json(res, 404, { ok: false, code: 'not-found', message: `this server answers under ${B}/` }); return;
      }
      if (path === '/__sim/worlds.json' && req.method === 'GET') { json(res, 200, await worldsJson()); return; }
      if (path === '/__sim/templates.json' && req.method === 'GET') { json(res, 200, { templates: listTemplates(templatesDir).map(({ file: _f, ...t }) => t) }); return; }
      if (path === '/__sim/worlds' && req.method === 'POST') {
        const chunks = []; let n = 0;
        for await (const c of req) { n += c.length; if (n > 16_384) { json(res, 413, { ok: false, code: 'too-large' }); return; } chunks.push(c); }
        let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { json(res, 400, { ok: false, code: 'bad-json' }); return; }
        // per-client creation limit (production): the first x-forwarded-for hop is the visitor Caddy saw
        const who = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
        const recent = (made.get(who) ?? []).filter((t) => Date.now() - t < 10 * 60_000);
        if (recent.length >= createLimit) { json(res, 429, { ok: false, code: 'slow-down', message: `at most ${createLimit} new worlds per 10 minutes from one place` }, { 'retry-after': '120' }); return; }
        const run = creating.then(() => createWorld(body, req.headers.authorization)); creating = run.catch(() => {});
        const out = await run; if (out[0] === 201) made.set(who, [...recent, Date.now()]);
        json(res, out[0], out[1]); return;
      }
      if (path === '/__sim/op/create-world' && req.method === 'POST') {
        // operator only: a request through the reverse proxy carries x-forwarded-for and is refused
        if (!direct(req)) { json(res, 403, { ok: false, code: 'local-only', message: 'operator commands are accepted only from this machine' }); return; }
        const chunks = []; for await (const c of req) chunks.push(c);
        let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { json(res, 400, { ok: false, code: 'bad-json' }); return; }
        const out = await opCreateWorld(body); json(res, out[0], out[1]); return;
      }
      const one = path.match(/^\/__sim\/worlds\/([a-z][a-z0-9-]{0,31})(\/previews)?$/);
      if (one && req.method === 'GET') {
        const w = registry.get(one[1]); if (!w) { json(res, 404, { ok: false, code: 'not-found' }); return; }
        await refreshStats(w);
        const s = seenOf(w.slug);
        if (one[2]) {
          // previews are the god's unpublished plans: only for a holder of this world's god token
          const st = pool.status(w.slug); const auth = req.headers.authorization;
          const okToken = st.status === 'running' && auth && await fetch(`http://127.0.0.1:${st.port}/w/${w.slug}/v1/god/edits?limit=1`, { headers: { authorization: auth }, signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false);
          if (!okToken) { json(res, 401, { ok: false, code: 'unauthorized', message: 'a god token for this world is required' }); return; }
          json(res, 200, { previews: s.previews }); return;
        }
        json(res, 200, { world: describe(w), seen: { looks: s.looks, lastLookAt: s.lastLookAt, agentSeenAt: s.agentSeenAt, previews: s.previews.length } }); return;
      }
      if (path === '/__sim/launcher' && req.method === 'GET') {
        if (!direct(req)) { json(res, 404, { ok: false, code: 'not-found' }); return; }
        json(res, 200, { origin, publicOrigin: prod.publicOrigin, devAuth: prod.devAuth, dataDir, range, maxWorlds: MAX_WORLDS, maxRunning: prod.maxRunning, minFreeMb: prod.minFreeMb, memAvailableMb: memAvailableMb(), children: registry.worlds.map((w) => ({ slug: w.slug, viewers: live.get(w.slug) ?? 0, ...pool.status(w.slug) })) }); return;
      }
      if ((path === '/__sim/healthz' || path === '/healthz') && (req.method === 'GET' || req.method === 'HEAD')) {
        const running = registry.worlds.filter((w) => pool.status(w.slug).status === 'running').length;
        json(res, 200, { ok: true, service: 'world-launcher', build: BUILD, auth: auth ? 'clerk' : 'dev', worlds: registry.worlds.length, running, maxWorlds: MAX_WORLDS, maxRunning: prod.maxRunning, ...(direct(req) ? { memAvailableMb: memAvailableMb() } : {}) }); return;
      }
      const world = path.match(/^\/w\/([^/]+)(?:\/|$)/)?.[1];
      if (world) {
        if (!SLUG_RE.test(world)) { json(res, 404, { ok: false, code: 'world.not-served' }); return; }
        if (path === `/w/${world}`) { res.writeHead(308, { location: `${wp(world)}/${url.search}` }).end(); return; }
        await toWorld(req, res, world, url); return;
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (path === '/' || path === '/index.html') { if (serveFile(res, join(webDir, 'index.html'), 'no-cache')) return; res.writeHead(500, { 'content-type': 'text/plain' }).end('The web app is not built: pnpm --filter @sim/web build'); return; }
        if (path.startsWith('/assets/')) { const f = inside(webDir, path); if (f && serveFile(res, f, 'public, max-age=31536000, immutable')) return; }
        if (path.startsWith('/world-assets/')) { const f = inside(join(root, 'worlds'), decodeURIComponent(path.slice('/world-assets'.length))); if (f && serveFile(res, f, 'public, max-age=3600')) return; }
      }
      // Anything else a world page asks for (Mars assets, engine files, …): any running world serves it (base stripped).
      const p = anyRunning();
      if (p) { proxyHttp(req, res, p, { path: B ? path + url.search : undefined }); return; }
      json(res, 404, { ok: false, code: 'not-found' });
    } catch (e) {
      log(`error ${req.method} ${path}: ${e.message}`);
      if (!res.headersSent) json(res, 500, { ok: false, code: 'internal', message: e.message }); else res.destroy();
    }
  });
  server.requestTimeout = 0; server.timeout = 0; server.keepAliveTimeout = 5_000;
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  server.on('upgrade', async (req, socket, head) => {
    const u = req.url ?? '', rel = !B ? u : u.startsWith(`${B}/`) ? u.slice(B.length) : '';
    const slug = rel.match(/^\/w\/([a-z][a-z0-9-]{0,31})(?:[/?]|$)/)?.[1];
    const w = slug && registry.get(slug);
    if (!w) { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return; }
    let p; try { p = await pool.ensure(worldEnv(w)); } catch { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return; }
    const up = connect(p, '127.0.0.1', () => {
      up.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${Object.entries(req.headers).flatMap(([k, v]) => Array.isArray(v) ? v.map((x) => `${k}: ${x}`) : [`${k}: ${v}`]).join('\r\n')}\r\n\r\n`);
      if (head.length) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on('error', () => socket.destroy()); socket.on('error', () => up.destroy()); socket.on('close', () => up.destroy()); up.on('close', () => socket.destroy());
    live.set(slug, (live.get(slug) ?? 0) + 1);
    let gone = false;
    const left = () => { if (gone) return; gone = true; const n = (live.get(slug) ?? 1) - 1; if (n > 0) live.set(slug, n); else live.delete(slug); const k = pool.state(slug); if (k) k.lastUsed = Date.now(); };
    socket.once('end', left); socket.once('close', left);
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(port, '127.0.0.1', yes); });
  for (const r of await pool.reapOrphans()) log(`stopped ${r.slug} (pid ${r.pid}) left running by an earlier launcher`);
  log(`${origin}${B}/  (data ${dataDir}, worlds ${registry.worlds.length}/${MAX_WORLDS}, running cap ${prod.maxRunning}, children ${range[0]}–${range[1]}, sign-in ${auth ? `Clerk for ${publicOrigin}` : 'dev names'}, build ${BUILD})`);

  // Eagerly wake the most recent worlds so the homepage numbers are live; the rest start on first visit.
  const eager = cfg.eager ?? 4;
  for (const w of [...registry.worlds].sort((a, b) => b.createdAt - a.createdAt).slice(0, eager)) pool.ensure(worldEnv(w)).then((p) => log(`woke ${w.slug} on :${p}`), (e) => log(`could not wake ${w.slug}: ${e.message}`));

  let closed = false;
  return {
    server, url: origin, registry, pool, dataDir, auth: auth?.public ?? { provider: 'dev' },
    close: async () => { if (closed) return; closed = true; const done = new Promise((r) => server.close(r)); for (const s of sockets) s.destroy(); await pool.closeAll(); await done; },
  };
}

/**
 * Clerk mode from an env file, used by path only: a one-shot `node --env-file` child hands back just the public
 * settings (publishable key, issuer) for the homepage. Nothing else in the file is read here or logged.
 */
export function clerkAuth(envFile, dataDir, publicOrigin) {
  if (!envFile) return null;
  const file = resolve(envFile);
  if (!existsSync(file)) throw new Error(`launcher: --auth-env file not found: ${file}`);
  const out = execFileSync(process.execPath, [`--env-file=${file}`, '-e', 'process.stdout.write(JSON.stringify({k:process.env.CLERK_PUBLISHABLE_KEY??"",i:process.env.CLERK_ISSUER_URL??""}))'], { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 10_000 });
  const { k, i } = JSON.parse(out);
  if (!/^pk_(live|test)_[A-Za-z0-9+/=_-]+$/.test(k) || !/^https:\/\/[^/]+$/.test(i)) throw new Error('launcher: the --auth-env file must set CLERK_PUBLISHABLE_KEY and CLERK_ISSUER_URL (https origin)');
  return {
    child: { envFile: file, registryPath: join(resolve(dataDir), 'accounts.sqlite') },
    public: { provider: 'clerk', clerkPublishableKey: k, clerkIssuer: i, authenticationOrigin: publicOrigin },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const flag = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const range = flag('range')?.split('-').map(Number);
  try {
    const num = (k) => (flag(k) === undefined ? undefined : Number(flag(k)));
    const l = await openLauncher({ port: num('port'), dataDir: flag('data'), range: range?.length === 2 ? range : undefined, eager: num('eager'),
      publicOrigin: flag('public-origin'), authEnvFile: flag('auth-env') ?? flag('auth-env-file'), devAuth: argv.includes('--dev-auth') ? true : undefined,
      maxWorlds: num('max-worlds'), maxRunning: num('max-running'), minFreeMb: num('min-free-mb'), worldHeapMb: num('world-heap-mb'), idleMs: num('idle-ms'), createLimit: num('create-limit'),
      marsWebDir: flag('mars-web'), webDir: flag('web'), base: flag('base'), soulCli: flag('soul-cli'), soulSkill: flag('soul-skill'), soulInstructions: flag('soul-instructions') });
    let stopping = false;
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { if (stopping) return; stopping = true; console.log(`[launcher] ${sig}: stopping worlds…`); void l.close().then(() => process.exit(0)); });
  } catch (e) { console.error(`[launcher] refused: ${e.message}`); process.exitCode = 1; }
}
