#!/usr/bin/env node
// World launcher (spec <eden4>/29 WP6): one local Node process that keeps a
// registry of entity worlds, runs one Sim server per world on a private port,
// and fronts them all on one origin.
//
//   node tools/world-launcher/launcher.mjs [--port 4980] [--data <dir>] [--range 5101-5149]
//
//   GET  /                       the web app (homepage: worlds + New world)
//   GET  /__sim/worlds.json      local-worlds/1, extended with slug/name/template/god/entities
//   GET  /__sim/templates.json   genesis templates (worlds/templates/*.json) + the empty plain
//   POST /__sim/worlds           {name, template} → creates, waits for /healthz → {slug, url}
//   GET  /__sim/worlds/<slug>    one world + what the launcher has seen (looks, agent, previews)
//   GET  /__sim/launcher         children, ports, pids, restarts (diagnostics)
//   /w/<slug>/*                  proxied to that world (HTTP, SSE, WebSocket); started on demand
//
// Local only: binds 127.0.0.1, fake minds, dev auth, no credentials, no tunnels.
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Registry, SLUG_RE, listTemplates, slugFor } from './registry.mjs';
import { ChildPool } from './children.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '../..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
const json = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }).end(JSON.stringify(body)); };
const MAX_WORLDS = 200;

/**
 * @param {{ port?: number, dataDir?: string, range?: [number, number], root?: string, webDir?: string,
 *           templatesDir?: string, marsWebDir?: string, eager?: number, command?: Function, log?: (s: string) => void }} cfg
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
  const registry = new Registry(dataDir);
  /** What the launcher sees go past, per world (not persisted beyond the registry's own fields). */
  const seen = new Map();
  const seenOf = (slug) => { let s = seen.get(slug); if (!s) { s = { looks: registry.get(slug)?.looks ?? 0, lastLookAt: registry.get(slug)?.lastLookAt ?? null, agentSeenAt: registry.get(slug)?.agentSeenAt ?? null, previews: [] }; seen.set(slug, s); } return s; };
  const stats = new Map();   // slug → { at, god, entities, seq }
  const pool = new ChildPool({ root, range, logDir: join(dataDir, 'logs'), marsWebDir, publicOrigin: origin, command: cfg.command, onChange: (slug) => { const s = pool.status(slug); if (s.port && registry.get(slug) && registry.get(slug).port !== s.port) registry.update(slug, { port: s.port }); } });
  const worldEnv = (w) => ({ ...w, dataDir: registry.worldDir(w.slug), templateFile: w.template && w.template !== 'empty' ? listTemplates(templatesDir).find((t) => t.id === w.template)?.file ?? null : null });

  // ---------- reads
  async function refreshStats(w) {
    const st = pool.status(w.slug);
    if (st.status !== 'running') return;
    const prev = stats.get(w.slug);
    if (prev && Date.now() - prev.at < 3000) return;
    try {
      const r = await fetch(`http://127.0.0.1:${st.port}/w/${w.slug}/v1/god/status`, { signal: AbortSignal.timeout(1500) });
      if (!r.ok) return;
      const s = await r.json();
      stats.set(w.slug, { at: Date.now(), god: !!s.hasOwner, entities: s.entities, seq: s.seq });
      if (w.god !== !!s.hasOwner || w.entities !== s.entities) registry.update(w.slug, { god: !!s.hasOwner, entities: s.entities, seq: s.seq });
    } catch { /* busy; keep the cached numbers */ }
  }
  const describe = (w) => {
    const st = pool.status(w.slug), s = stats.get(w.slug), t = listTemplates(templatesDir).find((x) => x.id === w.template);
    return { key: w.slug, worldKey: w.slug, slug: w.slug, name: w.name, basePath: `/w/${w.slug}`, configPath: `/w/${w.slug}/v1/config`, url: `/w/${w.slug}/?dev=1`, template: w.template, templateName: t?.name ?? (w.template === 'empty' ? 'Empty plain' : w.template), createdAt: w.createdAt, owner: w.owner ?? null, god: s?.god ?? w.god ?? false, entities: s?.entities ?? w.entities ?? null, seq: s?.seq ?? w.seq ?? null, status: st.status, restarts: st.restarts ?? 0 };
  };
  async function worldsJson() {
    await Promise.all(registry.worlds.map(refreshStats));
    return { contract: 'local-worlds/1', launcher: 'world-launcher/1', worlds: [...registry.worlds].sort((a, b) => b.createdAt - a.createdAt).map(describe), templates: listTemplates(templatesDir).map(({ file: _f, ...t }) => t), limits: { maxWorlds: MAX_WORLDS, childPorts: range } };
  }

  // ---------- create
  let creating = Promise.resolve();
  async function createWorld(body) {
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
    try { await pool.ensure(worldEnv(entry)); }
    catch (e) {
      await pool.stop(slug); pool.kids.delete(slug); registry.remove(slug);
      return [500, { ok: false, code: 'boot-failed', message: e.message }];
    }
    const ms = Math.round(performance.now() - t0);
    log(`created ${slug} (${t.id}) on :${pool.status(slug).port} in ${ms} ms`);
    await refreshStats(entry);
    return [201, { ok: true, slug, url: `/w/${slug}/?dev=1&new=1`, bootMs: ms, world: describe(entry) }];
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
    const s = seenOf(slug), rest = url.pathname.slice(`/w/${slug}`.length) || '/';
    // `god look` loads the page with ?shot=1 (29 WP0): count it as a look.
    if (req.method === 'GET' && (rest === '/' || rest === '') && url.searchParams.get('shot') === '1') { s.looks++; s.lastLookAt = Date.now(); registry.update(slug, { looks: s.looks, lastLookAt: s.lastLookAt }); }
    // an agent (not a browser) using a god token
    const auth = req.headers.authorization ?? '', ua = req.headers['user-agent'] ?? '';
    if (!s.agentSeenAt && rest.startsWith('/v1/god/') && /^Bearer god_/i.test(auth) && !/Mozilla\//.test(ua)) { s.agentSeenAt = Date.now(); registry.update(slug, { agentSeenAt: s.agentSeenAt }); }
    return rest;
  }
  function proxyHttp(req, res, targetPort, { tee } = {}) {
    const up = request({ hostname: '127.0.0.1', port: targetPort, path: req.url, method: req.method, headers: { ...req.headers, 'x-forwarded-for': req.socket.remoteAddress ?? '127.0.0.1' } }, (r) => {
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
      if ((req.headers.accept ?? '').includes('text/html')) { res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><meta charset="utf-8"><title>No such world</title><body style="font:16px system-ui;max-width:640px;margin:12vh auto;padding:0 20px"><h1>No world called “${slug.replace(/[<>&"]/g, '')}” here</h1><p><a href="/">See the worlds on this computer</a>, or make a new one.</p>`); return; }
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
    const path = url.pathname;
    try {
      if (path === '/__sim/worlds.json' && req.method === 'GET') { json(res, 200, await worldsJson()); return; }
      if (path === '/__sim/templates.json' && req.method === 'GET') { json(res, 200, { templates: listTemplates(templatesDir).map(({ file: _f, ...t }) => t) }); return; }
      if (path === '/__sim/worlds' && req.method === 'POST') {
        const chunks = []; let n = 0;
        for await (const c of req) { n += c.length; if (n > 16_384) { json(res, 413, { ok: false, code: 'too-large' }); return; } chunks.push(c); }
        let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { json(res, 400, { ok: false, code: 'bad-json' }); return; }
        const run = creating.then(() => createWorld(body)); creating = run.catch(() => {});
        const [status, out] = await run; json(res, status, out); return;
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
      if (path === '/__sim/launcher' && req.method === 'GET') { json(res, 200, { origin, dataDir, range, children: registry.worlds.map((w) => ({ slug: w.slug, ...pool.status(w.slug) })) }); return; }
      const world = path.match(/^\/w\/([^/]+)(?:\/|$)/)?.[1];
      if (world) {
        if (!SLUG_RE.test(world)) { json(res, 404, { ok: false, code: 'world.not-served' }); return; }
        if (path === `/w/${world}`) { res.writeHead(308, { location: `/w/${world}/${url.search}` }).end(); return; }
        await toWorld(req, res, world, url); return;
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (path === '/' || path === '/index.html') { if (serveFile(res, join(webDir, 'index.html'), 'no-cache')) return; res.writeHead(500, { 'content-type': 'text/plain' }).end('The web app is not built: pnpm --filter @sim/web build'); return; }
        if (path.startsWith('/assets/')) { const f = inside(webDir, path); if (f && serveFile(res, f, 'public, max-age=31536000, immutable')) return; }
        if (path.startsWith('/world-assets/')) { const f = inside(join(root, 'worlds'), decodeURIComponent(path.slice('/world-assets'.length))); if (f && serveFile(res, f, 'public, max-age=3600')) return; }
      }
      // Anything else a world page asks for (Mars assets, engine files, …): any running world serves it.
      const p = anyRunning();
      if (p) { proxyHttp(req, res, p); return; }
      json(res, 404, { ok: false, code: 'not-found' });
    } catch (e) {
      log(`error ${req.method} ${path}: ${e.message}`);
      if (!res.headersSent) json(res, 500, { ok: false, code: 'internal', message: e.message }); else res.destroy();
    }
  });
  server.requestTimeout = 0; server.timeout = 0; server.keepAliveTimeout = 5_000;
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  server.on('upgrade', async (req, socket, head) => {
    const slug = (req.url ?? '').match(/^\/w\/([a-z][a-z0-9-]{0,31})(?:[/?]|$)/)?.[1];
    const w = slug && registry.get(slug);
    if (!w) { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return; }
    let p; try { p = await pool.ensure(worldEnv(w)); } catch { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return; }
    const up = connect(p, '127.0.0.1', () => {
      up.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${Object.entries(req.headers).flatMap(([k, v]) => Array.isArray(v) ? v.map((x) => `${k}: ${x}`) : [`${k}: ${v}`]).join('\r\n')}\r\n\r\n`);
      if (head.length) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on('error', () => socket.destroy()); socket.on('error', () => up.destroy()); socket.on('close', () => up.destroy()); up.on('close', () => socket.destroy());
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(port, '127.0.0.1', yes); });
  log(`${origin}  (data ${dataDir}, worlds ${registry.worlds.length}, children ${range[0]}–${range[1]})`);

  // Eagerly wake the most recent worlds so the homepage numbers are live; the rest start on first visit.
  const eager = cfg.eager ?? 4;
  for (const w of [...registry.worlds].sort((a, b) => b.createdAt - a.createdAt).slice(0, eager)) pool.ensure(worldEnv(w)).then((p) => log(`woke ${w.slug} on :${p}`), (e) => log(`could not wake ${w.slug}: ${e.message}`));

  let closed = false;
  return {
    server, url: origin, registry, pool, dataDir,
    close: async () => { if (closed) return; closed = true; const done = new Promise((r) => server.close(r)); for (const s of sockets) s.destroy(); await pool.closeAll(); await done; },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const flag = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const range = flag('range')?.split('-').map(Number);
  try {
    const l = await openLauncher({ port: flag('port') ? Number(flag('port')) : undefined, dataDir: flag('data'), range: range?.length === 2 ? range : undefined, eager: flag('eager') ? Number(flag('eager')) : undefined });
    let stopping = false;
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { if (stopping) return; stopping = true; console.log(`[launcher] ${sig}: stopping worlds…`); void l.close().then(() => process.exit(0)); });
  } catch (e) { console.error(`[launcher] refused: ${e.message}`); process.exitCode = 1; }
}
