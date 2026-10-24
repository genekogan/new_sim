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
//   GET  /__sim/healthz          {ok, build, worlds, running, caps, memAvailableMb} (also /healthz); clientErrorsNew = error kinds
//                                pages first reported since this build went live (client-errors.mjs)
//   GET  /__sim/health           the site owner's health page (health-dash.mjs): a data-free shell; ?json=1 = build, host, every
//                                world, backups, arrivals, new errors, alerts, for loopback or a site owner's Clerk session
//   POST /__sim/client-errors    a page's error beacon (apps/web/src/client-errors.ts); GET: the operator's summary (direct
//                                loopback only; op.mjs client-errors): top errors by count, world, browser, first/last seen, build
//   POST /__sim/op/create-world  operator only (direct loopback requests; anything through a reverse proxy is refused):
//                                {name, template, owner | ownerOf, godName?, slug?, unlisted?} → a world born owned by an existing account
//                                (`owner` = account id, or `ownerOf` = the slug of a world whose god it is). CLI: op.mjs
//   POST /__sim/op/register-fork operator only: {slug: eden|mars|littlemartians, descriptor, accounts?} → serve a copy of an
//                                old world (already in <data>/worlds/<slug>/sim.db) under <base>/w/<slug> (fork-world.mjs)
//   POST /__sim/op/remove-fork   operator only: {slug} → stop and unregister a fork (its data stays)
//   POST /__sim/op/set-claimable operator only: {slug, claimable} → a world with no god that nobody may claim (false)
//   POST /__sim/op/set-unlisted  operator only: {slug, unlisted} → left out of worlds.json (the public list), still served
//                                at its URL (listing.mjs; bench worlds and "… (scratch)" names are unlisted by default)
//   POST /__sim/op/archive-world operator only: {slug, reason?} → stop it, move <data>/worlds/<slug> to <data>/archive/<id>/world,
//                                unregister it (never deletes; worldops.mjs). restore-world {id} puts it back; list-archive;
//                                audit {slug?} reads <data>/audit.jsonl
//   POST /__sim/worlds/<slug>/unlisted the world's owner (signed in, or their own agent's god token): {unlisted: true|false}
//   POST /__sim/op/soul-pending|soul-approve|soul-message|soul-inbox|soul-delete, /__sim/op/set-test  operator only: TEST Souls
//                                on worlds flagged test (op-souls.mjs, apps/server/src/op-souls.ts); /__sim/op/god-pending|
//                                god-approve: the owner's god pairing on a scratch test world (the release probe's god folder)
//   POST /__sim/worlds/<slug>/archive  the world's owner (signed in, or their own agent's god token): {confirm: <slug>, reason?}
//   co-builders and handoff (handoff.mjs), under /__sim/worlds/<slug>/ (co-builders OFF unless --cobuilders or
//   SIM_COBUILDERS=1; one god per world, Gene 2026-10-16): owner: GET cobuilders, POST cobuilders/invite {to?},
//   cobuilders/remove {account}, transfer {to?}, offers/cancel; anyone with the link: GET offer?code=, POST offer/accept
//   {code} (signed in: that is the consent); a co-builder's agent: POST cobuild/pair/start|poll, approved by the co-builder
//   (POST cobuild/pair/approve {code}).
//   /w/<slug>/*                  proxied to that world (HTTP, SSE, WebSocket); started on demand
//
// --base /worlds puts all of the above under one path prefix (/worlds/, /worlds/__sim/…, /worlds/w/<slug>/…,
// /worlds/assets/…), so one reverse-proxy rule serves the launcher beside another release on the same origin
// without touching its /, /assets, /__sim, /v1 or /w/<its worlds>. Worlds then run with WORLD_PATH=<base>/w/<slug>
// (their API, WebSocket, skill and CLI URLs carry the prefix) and the web build must be made with
// `vite build --base <base>/` plus apps/web/src/base-path.ts (tools/world-launcher/deploy/release.sh does both).
//
// --old-worlds-root (stage `legacy`, deploy/old-worlds/README.md): the three original worlds at the site root, moved off
// the laptop. No --base; only the forks eden/mars/littlemartians (op register-fork), served at /w/<key> exactly where the
// laptop served them, and the root web build's "Sim" world list at /. Nothing new is created here (new worlds live under
// /worlds). Root paths a world page asks for go where the laptop proxy sent them (tools/core/multiworld/proxy.mjs
// worldForPath), with the laptop's public settings (INVITE_REQUIRED=0, SEED_NATIVES=0). The old->new redirect switch is <data>/redirects.json (redirects.mjs), read per request, off by default.
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
// Under the keeper (keeper.mjs; deploy/sim-worlds@.service) the launcher is one *generation*: it does not listen; the
// keeper passes it each connection, and on a release (systemctl reload) a newer generation adopts this one's running worlds
// and takes them over one at a time (handover below), so the port never closes and no world has two writers.
//
// Local only: binds 127.0.0.1, edge minds (owners' agents think; the world pays for none), no credentials, no tunnels.
import { execFileSync } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, request } from 'node:http';
import { clientErrors } from './client-errors.mjs';
import { healthDash } from './health-dash.mjs';
import { connect } from 'node:net';
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { brotliCompressSync, gzipSync, constants as zlibConstants } from 'node:zlib';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { FORK_SLUGS, RESERVED, Registry, SLUG_RE, cachedTemplates, slugFor } from './registry.mjs';
import { ChildPool, compileCacheDir, defaultCommand, forkCommand } from './children.mjs';
import { legacyWorldFor, redirectSwitch } from './redirects.mjs';
import { verifiedCreator } from './creator-auth.mjs';
import { creationPolicy, checkAccountCreation } from './creation-policy.mjs';
import { EXISTING_WORLDS, decorateCommand, memAvailableMb, productionSettings } from './production.mjs';
import { makeHandoff } from './handoff.mjs';
import { launcherFlood } from './flood.mjs';
import { archiveWorld, archivedSlugs, listArchive, readAudit, restoreWorld, tokenLabel } from './worldops.mjs';
import { isUnlisted, publicWorlds } from './listing.mjs';
import { opSoul, opSetTest } from './op-souls.mjs';
// The host check's last result, if the sim-worlds-health timer runs; stale (>30 min) counts as not ok.
function hostHealth(dataDir) {
  try { const h = JSON.parse(readFileSync(join(dataDir, 'host-health.json'), 'utf8')); const stale = Date.now() - Date.parse(h.at) > 30 * 60e3; return stale ? { ...h, ok: false, stale: true, codes: ['stale'] } : h; } catch { return null; }
}

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '../..');
/** The Soul CLI and guides every world serves unless overridden (tools/world-launcher/soul/SOURCES.json). */
/** Keep-alive idle timeout of the public server: longer than Caddy's upstream idle timeout (2 min). */
export const KEEP_ALIVE_MS = 130_000;
/** Freeze a world nobody has asked anything for this long (children.mjs freezeIdle; --sleep-ms, 0 = never). Lane P3. */
export const SLEEP_MS = 10 * 60_000;
/** A world asleep this long more exits, giving its memory back; its next visit cold-boots it (children.mjs releaseIdle;
 *  SIM_WORLD_IDLE_EXIT_MIN minutes, default 60; 0 = never; SIM_WORLD_IDLE_EXIT_FORKS=1 includes the old-engine forks). Lane SLEEP. */
export function idleExitMs(env = process.env) {
  const v = Number(env.SIM_WORLD_IDLE_EXIT_MIN ?? 60);
  return Number.isFinite(v) && v >= 0 ? v * 60_000 : 60 * 60_000;
}
/** Reads that only report on a world (health, config, the homepage's numbers): answered, but not a visit. */
// the Eyes render worker inside a world (apps/server/src/edge/eyes, user agent tag EdenEyes/1, same test as isEyesAgent in
// browser-config.mjs) is the world looking at itself: its page and socket neither keep the world awake nor count as use
const EYES_UA = /EdenEyes\/1/;
export const eyesAgent = (ua) => typeof ua === 'string' && EYES_UA.test(ua);
const PASSIVE_READ = /\/w\/[a-z][a-z0-9-]{0,31}\/(?:healthz|v1\/config|v1\/god\/status|v1\/world\/souls)\/?$/;
export const SOUL = { controllerCli: join(here, 'soul/eden.mjs'), cli: join(here, 'soul/eden-agent.mjs'), skill: join(here, 'soul/skill.md'), instructions: join(here, 'soul/instructions.md') };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
const json = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }).end(JSON.stringify(body)); };
const BUILD = (() => { try { return readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../BUILD'), 'utf8').trim(); } catch { return 'dev'; } })();
/** Direct requests from this machine (not through a reverse proxy, which adds x-forwarded-for). */
/** World routes that make someone a world's god while it has none (blocked on a world marked not claimable). */
const CLAIM_PATHS = new Set(['/v1/god/claim', '/v1/god/mint', '/v1/god/pair/approve']);
const sameName = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const direct = (req) => !req.headers['x-forwarded-for'] && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');

/**
 * @param {{ port?: number, dataDir?: string, range?: [number, number], root?: string, webDir?: string,
 *           templatesDir?: string, marsWebDir?: string, eager?: number, idleMs?: number, sleepMs?: number, exitMs?: number, exitForks?: boolean, command?: Function, log?: (s: string) => void,
 *           publicOrigin?: string, devAuth?: boolean, authEnvFile?: string, maxWorlds?: number, maxRunning?: number,
 *           minFreeMb?: number, worldHeapMb?: number, createLimit?: number, base?: string,
 *           soulCli?: string, soulSkill?: string, soulInstructions?: string, maxWorldsPerAccount?: number,
 *           newAccountHours?: number, newAccountWorldLimit?: number, newAccountCreateLimit?: number, newAccountWindowMinutes?: number }} cfg
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
  const templateList = cachedTemplates(templatesDir);   // P2: never parse ~2 MB of templates per proxied request
  const marsWebDir = cfg.marsWebDir ?? (existsSync(join(root, '.lane/mars-web')) ? join(root, '.lane/mars-web') : undefined);
  const log = cfg.log ?? ((s) => console.log(`[launcher] ${s}`));
  const flood = process.env.SIM_FLOOD === '0' ? () => null : launcherFlood({ log, limits: cfg.floodLimits });   // P2 coarse ceiling, see flood.mjs
  const errors = clientErrors({ dir: join(dataDir, 'client-errors'), build: BUILD, log, limits: cfg.clientErrorLimits });   // lane ERR, client-errors.mjs
  const origin = `http://127.0.0.1:${port}`;
  const publicOrigin = (cfg.publicOrigin ?? origin).replace(/\/$/, '');
  const authEnvFile = cfg.authEnvFile ?? process.env.SIM_AUTH_ENV_FILE;
  const prod = { ...productionSettings({ ...cfg, authEnvFile, range }, origin), build: BUILD };
  const auth = clerkAuth(authEnvFile, dataDir, publicOrigin);
  const MAX_WORLDS = prod.maxWorlds;
  const behindProxy = publicOrigin !== origin;
  const B = prod.base, wp = (slug) => `${B}/w/${slug}`;
  const oldRoot = cfg.oldWorldsRoot === true;
  if (oldRoot && B) throw new Error('launcher: --old-worlds-root serves the original worlds at the site root; drop --base');
  if (oldRoot && !authEnvFile) throw new Error('launcher: --old-worlds-root needs --auth-env (the original worlds sign in with Clerk)');
  const redirects = oldRoot ? redirectSwitch(join(dataDir, 'redirects.json'), log) : null;
  const registry = new Registry(dataDir);
  const accountPolicy = creationPolicy(cfg);
  /** Handover state (keeper.mjs): 'active' → 'preparing' → 'retired' (or back to 'active' when the next one fails). */
  let phase = 'active', retiredTo = null, gate = null, retiredPidFile = null, handBack = null;
  /** After a failed canary: resolves true once this launcher is retired (the keeper switched back), false after 30 s. */
  const handedBack = () => (retiredTo ? Promise.resolve(true) : handBack ? Promise.race([handBack.p.then(() => true), new Promise((r) => setTimeout(() => r(false), 30_000).unref())]) : Promise.resolve(false));
  /** The canary world under test here: { slug, passed: Promise<boolean> }. A request that failed on it waits for the verdict. */
  let canaryRun = null;
  const waitHandBack = async (slug, e) => (e.code === 'handed-back' || canaryRun?.slug === slug) && (await canaryRun?.passed) === false && handedBack();
  const adopting = Array.isArray(cfg.adopt) ? cfg.adopt : null;
  const createLimit = cfg.createLimit ?? Infinity, made = new Map();
  /** Open WebSocket (upgraded) connections per world: a world someone is watching never goes to sleep. */
  const live = new Map();
  /** HTTP requests in flight per world (a god's long-poll listen): such a world is not idle either. */
  const httpLive = new Map();
  /** What the launcher sees go past, per world (not persisted beyond the registry's own fields). */
  const seen = new Map();
  const seenOf = (slug) => { let s = seen.get(slug); if (!s) { s = { looks: registry.get(slug)?.looks ?? 0, lastLookAt: registry.get(slug)?.lastLookAt ?? null, agentSeenAt: registry.get(slug)?.agentSeenAt ?? null, previews: [] }; seen.set(slug, s); } return s; };
  const stats = new Map();   // slug → { at, god, entities, seq }
  // Travel between worlds (M3, docs/sim/TRAVEL.md): worlds reach each other only through this launcher's loopback relay,
  // with a key made fresh for this run and handed to the children in their environment.
  const siteKey = randomBytes(32).toString('hex');
  const siteOk = (req) => { const h = String(req.headers['x-sim-site-key'] ?? ''); return direct(req) && h.length === siteKey.length && timingSafeEqual(Buffer.from(h), Buffer.from(siteKey)); };
  const pool = new ChildPool({ root, range, site: { url: `${origin}${prod.base}`, key: siteKey }, logDir: join(dataDir, 'logs'), pidFile: join(dataDir, 'children.json'), libraryDir: join(dataDir, 'library'), compileCache: cfg.compileCache === false || process.env.SIM_COMPILE_CACHE === '0' ? null : compileCacheDir(dataDir, BUILD), cobuilders: cfg.cobuilders ?? process.env.SIM_COBUILDERS === '1', idleMs: cfg.idleMs, marsWebDir, publicOrigin, auth: auth?.child, soulCliFile: resolve(cfg.soulCli ?? SOUL.cli), soulControllerCliFile: resolve(cfg.soulControllerCli ?? SOUL.controllerCli), soulSkillFile: resolve(cfg.soulSkill ?? SOUL.skill), soulInstructionsFile: resolve(cfg.soulInstructions ?? SOUL.instructions), command: cfg.command ?? ((w, p, o) => (w.fork ? forkCommand : defaultCommand)(w, p, o)), healthPath: (s) => `${wp(s)}/healthz`,
    maxRunning: prod.maxRunning, minFreeMb: prod.minFreeMb, /* handover pre-warm: only world commands that know SIM_STANDBY (this release's own) */ prewarm: cfg.prewarm ?? (!cfg.command && process.env.SIM_PREWARM !== '0'), busy: (slug) => (live.get(slug) ?? 0) > 0 || (httpLive.get(slug) ?? 0) > 0, sleepMs: cfg.sleepMs ?? SLEEP_MS, exitMs: cfg.exitMs ?? idleExitMs(), exitForks: cfg.exitForks ?? process.env.SIM_WORLD_IDLE_EXIT_FORKS === '1', decorate: (c) => { const d = decorateCommand({ ...c, env: { ...c.env, WEB_DIR: webDir } }, prod); if (d.env.SIM_FORK) { d.env.NODE_OPTIONS = `--max-old-space-size=${cfg.forkHeapMb ?? 1536}`; if (oldRoot) Object.assign(d.env, { SIM_FORK_ROOT: '1', INVITE_REQUIRED: '0', SEED_NATIVES: '0' }); } return d; }, /* worlds serve the same web build, with its --base */ onChange: (slug) => { const s = pool.status(slug); if (s.port && registry.get(slug) && registry.get(slug).port !== s.port) registry.update(slug, { port: s.port }); } });
  const worldEnv = (w) => ({ ...w, dataDir: registry.worldDir(w.slug), templateFile: w.template && w.template !== 'empty' ? templateList({ all: true }).find((t) => t.id === w.template)?.file ?? null : null });

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
    const st = pool.status(w.slug), s = stats.get(w.slug), t = templateList({ all: true }).find((x) => x.id === w.template);
    // two worlds with the same shown name are told apart by their slug (the address people see), e.g. "Mars · my-mars-2"
    const twin = registry.worlds.some((x) => x !== w && sameName(x.name, w.name));
    return { nameTag: twin ? w.slug : null, claimable: w.claimable !== false, unlisted: isUnlisted(w), key: w.slug, worldKey: w.slug, slug: w.slug, name: w.name, basePath: wp(w.slug), configPath: `${wp(w.slug)}/v1/config`, url: auth ? `${wp(w.slug)}/` : `${wp(w.slug)}/?dev=1`, template: w.template, templateName: t?.name ?? (w.template === 'empty' ? 'Empty plain' : w.template), createdAt: w.createdAt, owner: w.owner ?? null, god: s?.god ?? w.god ?? false, entities: s?.entities ?? w.entities ?? null, seq: s?.seq ?? w.seq ?? null, souls: s?.souls ?? w.souls ?? null, godName: (s?.god ?? w.god) ? (w.godName ?? null) : null, status: st.status, restarts: st.restarts ?? 0 };
  };
  async function worldsJson() {
    await Promise.all(registry.worlds.map(refreshStats));
    return { contract: 'local-worlds/1', launcher: 'world-launcher/1', worlds: publicWorlds(registry.worlds, (w) => stats.get(w.slug)?.souls ?? w.souls).map(describe), templates: templateList().map(({ file: _f, ...t }) => t), limits: { maxWorlds: MAX_WORLDS, maxRunning: prod.maxRunning, childPorts: range }, auth: auth ? auth.public : { provider: 'dev' } };
  }

  /** A world the site admin marked not claimable, while it still has no god: nobody may claim it or mint for it. */
  const claimLocked = (w) => w.claimable === false && !(safeOwner(w.slug) ?? (stats.get(w.slug)?.god || w.god));
  const safeOwner = (slug) => { try { return worldOwner(slug); } catch { return null; } };
  /** Worlds being archived right now: no request may wake them again. */
  const closing = new Set();

  // ---------- who is asking (for the owner's own operations)
  /** The signed-in account behind an Authorization header: Clerk (verified here) or, locally, the world's dev sign-in. */
  async function whoIs(w, authorization) {
    if (!/^Bearer\s+\S+/i.test(authorization ?? '')) return null;
    if (auth) return verifiedCreator(authorization, auth.child, publicOrigin, root);
    try {
      const p = await pool.ensure(worldEnv(w));
      const r = await fetch(`http://127.0.0.1:${p}${wp(w.slug)}/v1/me`, { headers: { authorization }, signal: AbortSignal.timeout(5000) });
      const id = r.ok ? (await r.json())?.me?.userId : null; // the world's /v1/me (auth.me): { me: { userId, … } }
      return typeof id === 'string' && id ? id : null;
    } catch { return null; }
  }
  /** {account, via, cobuilder?}: a god token of this world (the owner's agent, or a co-builder's), or a signed-in person. */
  async function actorOf(w, authorization) {
    const tok = /^Bearer\s+(god_\S+)$/i.exec(authorization ?? '')?.[1];
    if (tok) {
      const label = tokenLabel(join(registry.worldDir(w.slug), 'sim.db'), `${w.slug}-1`, tok);
      if (label === null) return null;
      const co = /^cobuilder:([^:]+):/.exec(label);
      return co ? { account: co[1], via: 'token', cobuilder: true } : { account: safeOwner(w.slug), via: 'token' };
    }
    const id = await whoIs(w, authorization);
    return id ? { account: id, via: 'session' } : null;
  }
  const isOwner = (w, a) => !!a?.account && !a.cobuilder && a.account === safeOwner(w.slug);

  // ---------- archive-first delete (H4): the owner (their browser or their own agent) or the operator
  async function archive(w, by, reason) {
    closing.add(w.slug);
    try { const r = await archiveWorld({ registry, pool, dataDir }, w.slug, by, reason); seen.delete(w.slug); stats.delete(w.slug); log(`archived ${w.slug} → ${r.archive} (by ${by})`); return [200, { ok: true, ...r }]; }
    finally { closing.delete(w.slug); }
  }
  // Gene 2026-10-16: one god per world; co-builders are off unless asked for (--cobuilders or SIM_COBUILDERS=1).
  const cobuilders = cfg.cobuilders ?? process.env.SIM_COBUILDERS === '1';
  // lane DASH: the site owner's health page (health-dash.mjs)
  const dash = healthDash({ dataDir, build: BUILD, base: B, registry, pool, live, stats, refreshStats, errors, hostHealth: () => hostHealth(dataDir), auth, wp,
    verify: (a) => (auth ? verifiedCreator(a, auth.child, publicOrigin, root) : Promise.resolve(null)), worldOwner: safeOwner });
  const handoff = makeHandoff({ registry, pool, dataDir, wp, publicOrigin, actorOf, isOwner, closing, log, cobuilders });
  async function ownerArchive(w, body, authorization) {
    const a = await actorOf(w, authorization);
    if (!isOwner(w, a)) return [403, { ok: false, code: 'forbidden', message: "only this world's owner (or the site admin) may archive it" }];
    if (body?.confirm !== w.slug) return [400, { ok: false, code: 'confirm', message: `send {"confirm":"${w.slug}"} to archive this world` }];
    return archive(w, a.account, body?.reason);
  }

  // ---------- create
  let creating = Promise.resolve();
  /** `op.owner`: the operator's create (direct loopback only, below): the world is born owned by that existing account
   *  (WORLD_OWNER_ID on its first boot only matters while it has no store yet), with no sign-in and no claim. */
  async function createWorld(body, authorization, op = null) {
    if (!op && auth && !/^Bearer\s+\S+/i.test(authorization ?? '')) return [401, { ok: false, code: 'signin-required', message: 'sign in first: a new world belongs to whoever makes it' }];
    const creator = !op && auth ? await verifiedCreator(authorization, auth.child, publicOrigin, root) : null;
    if (!op && auth && !creator) return [401, { ok: false, code: 'signin-required', message: 'your sign-in was not accepted; sign in again' }];
    const name = typeof body?.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
    if (!name || name.length > 60) return [400, { ok: false, code: 'invalid', message: 'name: 1–60 characters' }];
    const templates = templateList();
    const template = typeof body?.template === 'string' ? body.template : 'empty';
    const t = templates.find((x) => x.id === template);
    if (!t) return [400, { ok: false, code: 'invalid', message: `unknown template ${template}; one of ${templates.map((x) => x.id).join(', ')}` }];
    if (!op && creator) {
      const db = new DatabaseSync(auth.child.registryPath, { readOnly: true });
      let account;
      try { account = db.prepare('SELECT created_at FROM provider_accounts_v1 WHERE account_id=?').get(creator); }
      finally { db.close(); }
      // Read actual world ownership for old registry rows too: pre-cap worlds did not persist owner in worlds.json.
      const worlds = registry.worlds.filter(w => !w.fork && worldOwner(w.slug) === creator);
      const refusal = checkAccountCreation(accountPolicy, { createdAt: account?.created_at, worlds });
      if (refusal) { const { status, ...body } = refusal; return [status, body]; }
    }
    // the name the creator chose to show as this world's god on the homepage (optional; never their account id or email)
    const godName = typeof body?.godName === 'string' ? body.godName.trim().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} _'.-]/gu, '').slice(0, 32) : '';
    // The label is self-chosen text, so one person must not be able to wear another god's label on the homepage.
    const verifiedOwner = op?.owner ?? creator;
    if (godName && verifiedOwner) {
      const key = godName.toLocaleLowerCase();
      if (registry.worlds.some((w) => !w.fork && typeof w.godName === 'string' && w.godName.toLocaleLowerCase() === key && worldOwner(w.slug) !== verifiedOwner))
        return [409, { ok: false, code: 'god-name-taken', message: `"${godName}" is already shown as the god of someone else's world; choose another name to show.` }];
    }
    if (registry.worlds.length >= MAX_WORLDS) return [409, { ok: false, code: 'full', message: `this launcher holds at most ${MAX_WORLDS} worlds` }];
    const taken = new Set([...registry.slugs(), ...archivedSlugs(dataDir)]);
    // An operator may choose the slug (e.g. eden-2026 under /worlds/w/); the public path always derives one from the name.
    // Never a reserved or old-world key, never one in use or archived, never over an existing world directory.
    const chosen = op && typeof body?.slug === 'string' && body.slug ? body.slug : null;
    if (chosen && (!SLUG_RE.test(chosen) || RESERVED.has(chosen) || EXISTING_WORLDS.includes(chosen) || FORK_SLUGS.includes(chosen)))
      return [400, { ok: false, code: 'invalid', message: `slug ${JSON.stringify(chosen)}: lowercase a-z0-9-, starting with a letter, not a reserved name` }];
    if (chosen && (taken.has(chosen) || existsSync(registry.worldDir(chosen))))
      return [409, { ok: false, code: 'exists', message: `slug ${chosen} is in use, archived, or has data on disk` }];
    const slug = chosen ?? slugFor(name, taken);
    const entry = { slug, name, template: t.id, port: null, createdAt: Date.now(), ...(typeof body?.creator === 'string' && body.creator ? { createdBy: body.creator.slice(0, 40) } : {}), ...(op && typeof body?.unlisted === 'boolean' ? { unlisted: body.unlisted } : {}) };
    rmSync(registry.worldDir(slug), { recursive: true, force: true });
    mkdirSync(registry.worldDir(slug), { recursive: true });
    registry.add(entry);
    const t0 = performance.now();
    const bornOwner = op?.owner ?? creator;
    try { await pool.ensure(bornOwner ? { ...worldEnv(entry), bornOwner } : worldEnv(entry)); }
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
      if (r.ok && (!creator || d.owner === creator)) owner = d.owner ?? null;
      else if (auth) {
        await pool.stop(slug); pool.kids.delete(slug); registry.remove(slug); rmSync(registry.worldDir(slug), { recursive: true, force: true });
        return [r.status === 403 ? 403 : 401, { ok: false, code: 'signin-required', message: `the new world could not make you its god: ${d.message ?? r.status}; sign in again and retry` }];
      } else log(`created ${slug} unclaimed: the creator's dev sign-in was refused (${r.status})`);
    }
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

  // ---------- operator: forks of the old worlds (lane FORKS). Only FORK_SLUGS, only from this machine, only onto a
  // copy of the world's database already in <data>/worlds/<slug>/sim.db; never created empty and never deleted here.
  async function opRegisterFork(body) {
    const slug = typeof body?.slug === 'string' ? body.slug : '';
    if (!FORK_SLUGS.includes(slug)) return [400, { ok: false, code: 'invalid', message: `slug: one of ${FORK_SLUGS.join(', ')}` }];
    if (registry.get(slug)) return [409, { ok: false, code: 'exists', message: `${slug} is already registered` }];
    if (!auth) return [409, { ok: false, code: 'needs-clerk', message: 'forks sign in with Clerk (start the launcher with --auth-env)' }];
    const descriptor = typeof body?.descriptor === 'string' ? body.descriptor : '';
    const accounts = typeof body?.accounts === 'string' ? body.accounts : join(dataDir, 'forks', 'accounts.sqlite');
    for (const [k, f] of Object.entries({ descriptor, accounts })) if (!f.startsWith('/') || !existsSync(f)) return [400, { ok: false, code: 'invalid', message: `${k}: an existing absolute path` }];
    if (resolve(accounts) === resolve(auth.child.registryPath)) return [400, { ok: false, code: 'invalid', message: "a fork keeps the old worlds' account registry, never the launcher's" }];
    let d; try { d = JSON.parse(readFileSync(descriptor, 'utf8')); } catch (e) { return [400, { ok: false, code: 'invalid', message: `descriptor: ${e.message}` }]; }
    if ((d.worldKey ?? 'eden') !== slug) return [400, { ok: false, code: 'invalid', message: `descriptor is for ${d.worldKey ?? 'eden'}, not ${slug}` }];
    if (!existsSync(join(registry.worldDir(slug), 'sim.db'))) return [409, { ok: false, code: 'no-data', message: `copy the world first: ${join(registry.worldDir(slug), 'sim.db')}` }];
    const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 60) : ({ eden: 'Eden', mars: 'Mars', littlemartians: 'Little Martians' })[slug];
    const entry = { slug, name, template: 'fork', fork: { of: slug, descriptor, accounts }, port: null, createdAt: Date.now() };
    registry.add(entry);
    const t0 = performance.now();
    try { await pool.ensure(worldEnv(entry), { timeoutMs: 180_000 }); }
    catch (e) { await pool.stop(slug); pool.kids.delete(slug); registry.remove(slug); return [500, { ok: false, code: 'boot-failed', message: `${e.message} (registration undone; data kept)` }]; }
    log(`registered fork ${slug} on :${pool.status(slug).port} in ${Math.round(performance.now() - t0)} ms`);
    return [201, { ok: true, slug, url: `${wp(slug)}/`, bootMs: Math.round(performance.now() - t0), world: describe(entry) }];
  }
  /** Site admin: mark a world claimable or not (only matters while it has no god). */
  function opSetClaimable(body) {
    const w = registry.get(typeof body?.slug === 'string' ? body.slug : '');
    if (!w) return [404, { ok: false, code: 'not-found', message: 'no world by that slug' }];
    if (typeof body?.claimable !== 'boolean') return [400, { ok: false, code: 'invalid', message: 'claimable: true or false' }];
    registry.update(w.slug, { claimable: body.claimable });
    log(`${w.slug} is ${body.claimable ? 'claimable again' : 'not claimable'} (operator)`);
    return [200, { ok: true, slug: w.slug, claimable: body.claimable, hasGod: !!safeOwner(w.slug) }];
  }
  /** Site admin or the world's owner: list the world on the public homepage or not (its URL keeps working either way). */
  function setUnlisted(w, unlisted, by) {
    if (typeof unlisted !== 'boolean') return [400, { ok: false, code: 'invalid', message: 'unlisted: true or false' }];
    registry.update(w.slug, { unlisted });
    log(`${w.slug} is ${unlisted ? 'unlisted' : 'listed'} (${by})`);
    return [200, { ok: true, slug: w.slug, unlisted }];
  }
  function opSetUnlisted(body) {
    const w = registry.get(typeof body?.slug === 'string' ? body.slug : '');
    return w ? setUnlisted(w, body?.unlisted, 'operator') : [404, { ok: false, code: 'not-found', message: 'no world by that slug' }];
  }
  async function ownerSetUnlisted(w, body, authorization) {
    const a = await actorOf(w, authorization);
    if (!isOwner(w, a)) return [403, { ok: false, code: 'forbidden', message: "only this world's owner (or the site admin) may list or unlist it" }];
    return setUnlisted(w, body?.unlisted, a.account);
  }
  async function opRemoveFork(body) {
    const w = registry.get(typeof body?.slug === 'string' ? body.slug : '');
    if (!w?.fork) return [404, { ok: false, code: 'not-found', message: 'no fork by that slug' }];
    await pool.stop(w.slug); pool.kids.delete(w.slug); registry.remove(w.slug);
    log(`removed fork ${w.slug} (data kept in ${registry.worldDir(w.slug)})`);
    return [200, { ok: true, slug: w.slug, dataKept: registry.worldDir(w.slug) }];
  }

  // ---------- static (the web app itself; everything else comes from a world)
  // Lane W1: with the request, a static file also gets a validator (ETag/Last-Modified, 304 on a match) and, for models and
  // JSON (GLBs went uncompressed: the humanoid kit's rig is 530 KB), a brotli or gzip body made once per file version.
  const packed = new Map();
  function serveFile(res, file, cache, req) {
    let st; try { st = statSync(file); } catch { return false; }
    if (!st.isFile()) return false;
    const headers = { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': cache };
    if (!req) { res.writeHead(200, { ...headers, 'content-length': st.size }); createReadStream(file).pipe(res); return true; }
    const etag = `W/"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    Object.assign(headers, { etag, 'last-modified': st.mtime.toUTCString() });
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers).end(); return true; }
    const accept = String(req.headers['accept-encoding'] ?? '');
    // P1 phones: the web build's own .br/.gz (deploy/precompress.mjs, made at release time), when the browser takes them
    if (/\.(js|mjs|css|wasm|svg|json)$/i.test(file)) for (const [e, ext] of [['br', '.br'], ['gzip', '.gz']]) {
      if (!new RegExp(`\\b${e}\\b`).test(accept)) continue;
      let pst; try { pst = statSync(file + ext); } catch { continue; }
      if (!pst.isFile() || pst.mtimeMs < st.mtimeMs) continue;
      res.writeHead(200, { ...headers, 'content-encoding': e, vary: 'Accept-Encoding', 'content-length': pst.size });
      if (req.method === 'HEAD') res.end(); else createReadStream(file + ext).pipe(res);
      return true;
    }
    const enc = /\.(glb|json|bin)$/i.test(file) && st.size >= 1024 && st.size <= 32 << 20
      ? (/\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null) : null;
    if (!enc) { res.writeHead(200, { ...headers, 'content-length': st.size }); if (req.method === 'HEAD') res.end(); else createReadStream(file).pipe(res); return true; }
    const key = `${file}|${enc}`; let hit = packed.get(key);
    if (!hit || hit.etag !== etag) {
      const raw = readFileSync(file);
      hit = { etag, body: enc === 'br' ? brotliCompressSync(raw, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 9, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.length } }) : gzipSync(raw, { level: 9 }) };
      packed.set(key, hit); if (packed.size > 256) packed.delete(packed.keys().next().value);
    }
    res.writeHead(200, { ...headers, 'content-encoding': enc, vary: 'Accept-Encoding', 'content-length': hit.body.length });
    res.end(req.method === 'HEAD' ? undefined : hit.body);
    return true;
  }
  const inside = (base, rel) => { const p = normalize(join(base, rel)); return p === base || p.startsWith(base + sep) ? p : null; };

  // ---------- proxy
  // Shared static files (/modular, /engine, …) come from a running world on this release's server. An old-world fork
  // (fork-world.mjs, the old engine) doesn't serve this release's /modular/humanoid kit, so it answers only when no
  // release world runs (release 3 walk: with the eden fork first awake, every page's humanoid kit.json was a 404).
  const oldWorldPort = async (path) => {
    const slug = legacyWorldFor(path), w = slug && registry.get(slug);
    if (!w) return anyRunning();
    try { return await pool.ensure(worldEnv(w)); } catch { return anyRunning(); }
  };
  const anyRunning = () => {
    const up = registry.worlds.filter((w) => pool.status(w.slug).status === 'running');
    let w = up.find((x) => !x.fork) ?? up[0];
    if (!w) { const frozen = registry.worlds.filter((x) => pool.state(x.slug)?.frozen); w = frozen.find((x) => !x.fork) ?? frozen[0]; if (w) pool.thaw(pool.state(w.slug)); }   // all asleep: wake one
    return w ? pool.status(w.slug).port ?? null : null;
  };
  // P2: a public page GET must not rewrite worlds.json synchronously each time (a look loop would): one save per 2 s at most
  let saveTimer = null;
  const saveSoon = () => { if (saveTimer) return; saveTimer = setTimeout(() => { saveTimer = null; registry.save(); }, 2000); saveTimer.unref?.(); };
  // P2: a refusal is held for a second before it is sent, so a flooder that waits for each answer (every HTTP client does)
  // sends at most one request a second per connection instead of thousands: the cheapest work for this shared loop is a
  // timer. At most 2,000 refusals are held at once; past that the connection is closed at once.
  let held = 0;
  function refuseSlowly(req, res, flooded) {
    if (held >= 2000) { res.shouldKeepAlive = false; json(res, flooded.status, flooded.body, { ...flooded.headers, connection: 'close' }); return; }
    held++; let done = false;
    const finish = () => { if (done) return; done = true; held--; clearTimeout(timer); };
    const timer = setTimeout(() => { finish(); if (!res.destroyed) json(res, flooded.status, flooded.body, flooded.headers); }, 1000);
    res.once('close', finish);
  }
  function observe(slug, req, url) {
    const s = seenOf(slug), rest = url.pathname.slice(wp(slug).length) || '/';
    // `god look` loads the page with ?shot=1 (29 WP0): count it as a look.
    if (req.method === 'GET' && (rest === '/' || rest === '') && url.searchParams.get('shot') === '1') { s.looks++; s.lastLookAt = Date.now(); const w = registry.get(slug); if (w) { Object.assign(w, { looks: s.looks, lastLookAt: s.lastLookAt }); saveSoon(); } }
    // an agent (not a browser) using a god token
    const auth = req.headers.authorization ?? '', ua = req.headers['user-agent'] ?? '';
    if (!s.agentSeenAt && rest.startsWith('/v1/god/') && /^Bearer god_/i.test(auth) && !/Mozilla\//.test(ua)) { s.agentSeenAt = Date.now(); registry.update(slug, { agentSeenAt: s.agentSeenAt }); }
    return rest;
  }
  // the client hung up while we waited (a world booting, a retry, a hand-back): nothing is sent on its behalf, or a
  // long-poll listen would reach the world as a ghost and could supersede the agent's real listener
  const clientGone = (req, res) => res.destroyed || req.socket.destroyed;
  function proxyHttp(req, res, targetPort, { tee, path, retry } = {}) {
    if (clientGone(req, res)) return;
    // Behind Caddy (a public origin other than our own) keep the visitor's x-forwarded-for, so per-person limits in
    // the worlds see people, not the proxy; locally it is set to the connecting address as before.
    const xff = behindProxy && req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'] : (req.socket.remoteAddress ?? '127.0.0.1');
    const up = request({ hostname: '127.0.0.1', port: targetPort, path: path ?? req.url, method: req.method, headers: { ...req.headers, 'x-forwarded-for': xff } }, (r) => {
      // hop-by-hop headers stay on their hop: an upstream `connection: keep-alive` would turn this server's own choice
      // back on (forward() closes after its response; Node lets a user connection header override that)
      const { connection: _c, 'keep-alive': _k, ...headers } = r.headers;
      res.writeHead(r.statusCode ?? 502, headers);
      if (tee && (r.statusCode ?? 0) < 300) { const chunks = []; r.on('data', (c) => { if (chunks.length < 64) chunks.push(c); }); r.on('end', () => { try { tee(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { /* not json */ } }); }
      r.pipe(res);
    });
    // A world that was just handed over (or restarted) refused the connection before answering: a GET/HEAD is asked again
    // once (the retry waits for the world to be back), so a page or poll in flight sees a short wait, not an error.
    up.on('error', () => { if (!res.headersSent && retry) retry(); else if (!res.headersSent) json(res, 502, { ok: false, code: 'world.unavailable' }); else res.destroy(); });
    req.on('aborted', () => up.destroy()); res.on('close', () => up.destroy());
    if (req.readableEnded) up.end(); else req.pipe(up);   // a retried GET: its (empty) body was already read
  }
  async function toWorld(req, res, slug, url, retried = false) {
    const w = registry.get(slug);
    if (w && closing.has(slug)) { json(res, 503, { ok: false, code: 'world.closing', slug }, { 'retry-after': '5' }); return; }
    if (!w) {
      if ((req.headers.accept ?? '').includes('text/html')) { res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>No such world</title><body style="font:16px system-ui;max-width:640px;margin:12vh auto;padding:0 20px"><h1>No world called “${slug.replace(/[<>&"]/g, '')}” here</h1><p><a href="${B}/">See the worlds here</a>, or make a new one.</p>`); return; }
      json(res, 404, { ok: false, code: 'world.not-served', slug }); return;
    }
    // P2: one flooding visitor or agent is refused here (every world shares this loop), before its world is contacted: a
    // refusal neither boots nor wakes a sleeping world, keeps it awake, counts as its use, nor counts as a look or an agent
    const flooded = retried ? null : flood(req, url.pathname.slice(wp(slug).length) || '/', behindProxy, slug);
    if (flooded) { refuseSlowly(req, res, flooded); return; }
    // a monitor's or the homepage's read (health, config, status, no token) is answered, waking the world if it sleeps, but
    // is not a visit: it neither keeps the world awake nor counts as its last use (lane P3; sim-watch polls every 5 min)
    const passive = (PASSIVE_READ.test(url.pathname) && (req.method === 'GET' || req.method === 'HEAD') && !req.headers.authorization) || eyesAgent(req.headers['user-agent']);
    let p;
    try { p = await pool.ensure(worldEnv(w), { passive }); }
    catch (e) {
      if (e.code === 'handed-over' && retiredTo) { forward(req, res); return; }
      // our canary failed and the world is going back to the previous launcher: wait for the keeper to switch back
      if (await waitHandBack(slug, e)) { forward(req, res); return; }
      json(res, 503, { ok: false, code: 'world.unavailable', slug, message: e.message }, { 'retry-after': '3' }); return;
    }
    if (clientGone(req, res)) return;   // before httpLive: a closed response never fires 'close' again to undo it
    // a request in flight (a god's long-poll listen, a slow upload) keeps the world awake (pool busy), and its end counts as use
    httpLive.set(slug, (httpLive.get(slug) ?? 0) + 1);
    res.once('close', () => { const n = (httpLive.get(slug) ?? 1) - 1; if (n > 0) httpLive.set(slug, n); else httpLive.delete(slug); const k = pool.state(slug); if (k && !passive) k.lastUsed = Date.now(); });
    const rest = retried ? url.pathname : observe(slug, req, url);
    if (req.method === 'POST' && CLAIM_PATHS.has(rest) && claimLocked(w)) { json(res, 403, { ok: false, code: 'not-claimable', message: 'this world is not open for claiming' }); return; }
    const tee = req.method === 'POST' && rest === '/v1/god/preview' ? (body) => { if (typeof body?.id !== 'string') return; const s = seenOf(slug); s.previews.unshift({ id: body.id, accepted: !!body.accepted, summary: body.summary ?? null, failures: body.failures ?? null, at: Date.now() }); s.previews.length = Math.min(s.previews.length, 20); } : undefined;
    const again = !retried && (req.method === 'GET' || req.method === 'HEAD') ? () => void toWorld(req, res, slug, url, true).catch(() => { if (!res.headersSent) json(res, 502, { ok: false, code: 'world.unavailable' }); }) : undefined;
    proxyHttp(req, res, p, { tee, retry: again });
  }
  /** Retired (a newer launcher serves now): anything still arriving here, on a connection opened before the switch,
   *  goes to the keeper's port, i.e. to the newer launcher; the connection closes after this response. */
  function forward(req, res) { res.shouldKeepAlive = false; proxyHttp(req, res, port, { path: req.url }); }

  const sockets = new Set();
  const server = createServer(async (req, res) => {
    const sock = req.socket; sock.simBusy = (sock.simBusy ?? 0) + 1; res.once('close', () => { sock.simBusy--; });
    if (closed) res.shouldKeepAlive = false;   // stopping: answered, then this connection ends (see close())
    if (retiredTo) { forward(req, res); return; }
    // while the next launcher is being prepared, creations and operator changes wait: they run here if it fails, there if not
    if (gate && req.method === 'POST' && (req.url ?? '').startsWith(`${B}/__sim/`)) { await gate.p; if (retiredTo) { forward(req, res); return; } }
    let url; try { url = new URL(req.url ?? '/', origin); } catch { json(res, 400, { ok: false, code: 'bad-url' }); return; }
    // Under --base everything of ours is <base>/…; `path` is the part after the base. Outside the base only the
    // public static files a world page also asks for at the root (/modular, /mars-assets, …) are answered, the way
    // the other release on the origin answers them in production; the rest is not ours.
    let path = url.pathname, outside = false;
    if (B) {
      if (path === B) { res.writeHead(308, { location: `${B}/${url.search}` }).end(); return; }
      if (path.startsWith(`${B}/`)) path = path.slice(B.length); else outside = true;
    }
    dash.noteWatch(req);   // lane DASH: sim-watch's last check (and what it saw down)
    try {
      if (outside) {
        if (path === '/healthz' && direct(req)) { json(res, 200, { ok: true, service: 'world-launcher', base: B, build: BUILD }); return; }
        const p = (req.method === 'GET' || req.method === 'HEAD') && /^\/(modular|mars-assets|engine|browser|models|history|2020|world-assets)\/|^\/data\/manifest\.json$/.test(path) && anyRunning();
        if (p) { proxyHttp(req, res, p); return; }
        json(res, 404, { ok: false, code: 'not-found', message: `this server answers under ${B}/` }); return;
      }
      if (path === '/__sim/client-errors') {
        // lane ERR: a page's error beacon (anyone; body-capped, per-address and site-wide limits) and the operator's summary
        if (req.method === 'POST') {
          const chunks = []; let n = 0;
          for await (const c of req) { n += c.length; if (n > 8192) { json(res, 413, { ok: false, code: 'too-large' }); return; } chunks.push(c); }
          const who = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
          const [st, out] = errors.ingest(who, req.headers['user-agent'], Buffer.concat(chunks));
          if (out) json(res, st, out); else res.writeHead(st, { 'cache-control': 'no-store' }).end(); return;
        }
        if (req.method === 'GET' && direct(req)) { json(res, 200, errors.summary({ limit: url.searchParams.get('limit'), world: url.searchParams.get('world') || undefined })); return; }
        json(res, 404, { ok: false, code: 'not-found' }); return;
      }
      if (path === '/__sim/health' && (req.method === 'GET' || req.method === 'HEAD')) {
        // lane DASH: the page shell for anyone (no data in it); ?json=1 for the operator on loopback or a site owner's session
        if (!url.searchParams.has('json')) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' }).end(req.method === 'HEAD' ? undefined : dash.shell()); return; }
        const t0 = performance.now(), may = await dash.allowed(req, direct(req));
        if (may !== 200) { json(res, may, { ok: false, code: may === 401 ? 'sign-in' : may === 403 ? 'not-owner' : 'busy' }); return; }
        const d = await dash.json(); json(res, 200, d, { 'server-timing': `dash;dur=${(performance.now() - t0).toFixed(1)}` }); return;
      }
      if (path === '/__sim/worlds.json' && req.method === 'GET') { json(res, 200, await worldsJson()); return; }
      if (path === '/__sim/templates.json' && req.method === 'GET') { json(res, 200, { templates: templateList().map(({ file: _f, ...t }) => t) }); return; }
      if (oldRoot && req.method === 'POST' && (path === '/__sim/worlds' || path === '/__sim/op/create-world')) {
        json(res, 403, { ok: false, code: 'creation.elsewhere', message: 'This server keeps the original worlds. Make new worlds at /worlds/.', url: '/worlds/' }); return;
      }
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
        json(res, out[0], out[1], out[1].retry_after ? { 'retry-after': String(out[1].retry_after) } : {}); return;
      }
      if (path === '/__sim/op/create-world' && req.method === 'POST') {
        // operator only: a request through the reverse proxy carries x-forwarded-for and is refused
        if (!direct(req)) { json(res, 403, { ok: false, code: 'local-only', message: 'operator commands are accepted only from this machine' }); return; }
        const chunks = []; for await (const c of req) chunks.push(c);
        let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { json(res, 400, { ok: false, code: 'bad-json' }); return; }
        const out = await opCreateWorld(body); json(res, out[0], out[1]); return;
      }
      const forkOp = path.match(/^\/__sim\/op\/(register-fork|remove-fork|set-claimable|set-unlisted|archive-world|restore-world|list-archive|audit)$/)?.[1];
      if (forkOp && req.method === 'POST') {
        if (!direct(req)) { json(res, 403, { ok: false, code: 'local-only', message: 'operator commands are accepted only from this machine' }); return; }
        const chunks = []; for await (const c of req) chunks.push(c);
        let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { json(res, 400, { ok: false, code: 'bad-json' }); return; }
        const out = await ({ 'register-fork': opRegisterFork, 'remove-fork': opRemoveFork, 'set-claimable': opSetClaimable, 'set-unlisted': opSetUnlisted,
          'archive-world': (b) => { const w = registry.get(typeof b?.slug === 'string' ? b.slug : ''); return w ? archive(w, 'operator', b?.reason) : [404, { ok: false, code: 'not-found', message: 'no world by that slug' }]; },
          'restore-world': (b) => { const r = restoreWorld({ registry, dataDir }, b?.id, 'operator'); if (r[0] === 200) log(`restored ${r[1].slug} from ${r[1].id} (operator)`); return r; },
          'list-archive': () => [200, { ok: true, archive: listArchive(dataDir) }],
          'audit': (b) => [200, { ok: true, audit: readAudit(dataDir, typeof b?.slug === 'string' ? b.slug : undefined) }] })[forkOp](body); json(res, out[0], out[1]); return;
      }
      // lane OPS2: the operator's TEST-Soul commands and the test-world flag (op-souls.mjs), direct loopback only
      const soulOp = path.match(/^\/__sim\/op\/(?:soul-(pending|approve|message|inbox|delete)|(set-test)|(god-pending|god-approve))$/);
      if (soulOp && req.method === 'POST') {
        if (!direct(req)) { json(res, 403, { ok: false, code: 'local-only', message: 'operator commands are accepted only from this machine' }); return; }
        const chunks = []; let n = 0;
        for await (const c of req) { n += c.length; if (n > 16_384) { json(res, 413, { ok: false, code: 'too-large' }); return; } chunks.push(c); }
        let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { json(res, 400, { ok: false, code: 'bad-json' }); return; }
        const out = soulOp[2] ? opSetTest({ body, registry, dataDir, log }) : await opSoul({ verb: soulOp[1] ?? soulOp[3], body, registry, dataDir, log,
          ensure: (w) => pool.ensure(worldEnv(w)),
          call: async (w, p, sub, b) => { const r = await fetch(`http://127.0.0.1:${p}${wp(w.slug)}${sub}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sim-site-key': siteKey }, body: JSON.stringify(b), signal: AbortSignal.timeout(30_000) }); return [r.status, await r.json().catch(() => ({ ok: false, code: 'bad-reply' }))]; } });
        json(res, out[0], out[1]); return;
      }
      const own = path.match(/^\/__sim\/worlds\/([a-z][a-z0-9-]{0,31})\/(archive|unlisted|offer|offer\/accept|offers\/cancel|transfer|cobuilders|cobuilders\/(?:invite|remove)|cobuild\/pair\/(?:start|poll|approve))$/);
      if (own && (req.method === 'POST' || req.method === 'GET')) {
        const w = registry.get(own[1]); if (!w || closing.has(w.slug)) { json(res, 404, { ok: false, code: 'not-found' }); return; }
        let body = Object.fromEntries(url.searchParams);
        if (req.method === 'POST') {
          const chunks = []; let n = 0;
          for await (const c of req) { n += c.length; if (n > 16_384) { json(res, 413, { ok: false, code: 'too-large' }); return; } chunks.push(c); }
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { json(res, 400, { ok: false, code: 'bad-json' }); return; }
        }
        const out = own[2] === 'archive' || own[2] === 'unlisted' ? (req.method === 'POST' ? await (own[2] === 'archive' ? ownerArchive : ownerSetUnlisted)(w, body, req.headers.authorization) : null) : await handoff(w, own[2], req.method, body, req.headers.authorization);
        if (!out) { json(res, 405, { ok: false, code: 'method' }); return; }
        json(res, out[0], out[1]); return;
      }
      if (path.startsWith('/__sim/site/')) {
        // the worlds' travel relay: this machine only, with the run's site key
        if (!siteOk(req)) { json(res, 404, { ok: false, code: 'not-found' }); return; }
        if (path === '/__sim/site/worlds' && req.method === 'GET') { json(res, 200, { worlds: registry.worlds.filter((w) => !w.fork).map((w) => ({ slug: w.slug, name: w.name })) }); return; }
        if (path === '/__sim/site/relay' && req.method === 'POST') {
          const chunks = []; let n = 0;
          for await (const c of req) { n += c.length; if (n > 256_000) { json(res, 413, { ok: false, code: 'too-large' }); return; } chunks.push(c); }
          let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { json(res, 400, { ok: false, code: 'bad-json' }); return; }
          if (typeof body?.path !== 'string' || !/^\/v1\/site\/(arrive|where|where-is|presence|release)$/.test(body.path)) { json(res, 400, { ok: false, code: 'invalid', message: 'not a site path' }); return; }
          const w = typeof body.to === 'string' ? registry.get(body.to) : null;
          if (!w || w.fork) { json(res, 404, { ok: false, code: 'travel.unknown-world', message: `There is no world "${String(body.to ?? '').slice(0, 40)}" on this site.` }); return; }
          let p; try { p = await pool.ensure(worldEnv(w)); } catch (e) { json(res, 503, { ok: false, code: e.code === 'capacity' ? 'travel.capacity' : 'travel.unreachable', message: `${w.name} cannot take anyone right now: ${e.message}` }); return; }
          try {
            const r = await fetch(`http://127.0.0.1:${p}${wp(w.slug)}${body.path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sim-site-key': siteKey }, body: JSON.stringify(body.body ?? {}), signal: AbortSignal.timeout(55_000) });
            const data = await r.json().catch(() => ({ ok: false, code: 'travel.unreachable' }));
            log(`travel relay ${body.path} → ${w.slug}: ${r.status}${data?.code ? ` ${data.code}` : ''}`);
            json(res, r.status, data);
          } catch (e) { json(res, 504, { ok: false, code: 'travel.unreachable', message: `${w.name} did not answer: ${e.message}` }); }
          return;
        }
        json(res, 404, { ok: false, code: 'not-found' }); return;
      }
      const one = path.match(/^\/__sim\/worlds\/([a-z][a-z0-9-]{0,31})(\/previews)?$/);
      if (one && req.method === 'GET') {
        const w = registry.get(one[1]); if (!w) { json(res, 404, { ok: false, code: 'not-found' }); return; }
        await refreshStats(w);
        const s = seenOf(w.slug);
        if (one[2]) {
          // previews are the god's unpublished plans: only for a holder of this world's god token
          if (pool.state(w.slug)?.frozen) pool.thaw(pool.state(w.slug));   // asleep: the token is checked by the world itself
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
        const host = hostHealth(dataDir); // deploy/host-health.mjs (timer): `hostOk` (+ short `hostCodes` when not ok) public, the numbers loopback-only
        json(res, 200, { ok: true, service: 'world-launcher', build: BUILD, auth: auth ? 'clerk' : 'dev', worlds: registry.worlds.length, running, maxWorlds: MAX_WORLDS, maxRunning: prod.maxRunning, ...(host ? { hostOk: host.ok, ...(host.ok ? {} : { hostCodes: host.codes ?? [] }) } : {}), clientErrorsNew: errors.newSinceRelease(), ...(direct(req) ? { memAvailableMb: memAvailableMb(), ...(host ? { host } : {}) } : {}) }); return;
      }
      const to = redirects?.target(req, path, url);
      if (to) { res.writeHead(302, { location: to, 'cache-control': 'no-store' }).end(); return; }
      const world = path.match(/^\/w\/([^/]+)(?:\/|$)/)?.[1];
      if (world) {
        if (!SLUG_RE.test(world)) { json(res, 404, { ok: false, code: 'world.not-served' }); return; }
        if (path === `/w/${world}`) { res.writeHead(308, { location: `${wp(world)}/${url.search}` }).end(); return; }
        // a world's site routes answer the relay above, never the public proxy
        if (path.startsWith(`/w/${world}/v1/site/`)) { json(res, 404, { ok: false, code: 'not-found' }); return; }
        await toWorld(req, res, world, url); return;
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (path === '/' || path === '/index.html') { if (serveFile(res, join(webDir, 'index.html'), 'no-cache')) return; res.writeHead(500, { 'content-type': 'text/plain' }).end('The web app is not built: pnpm --filter @sim/web build'); return; }
        // lane P4: the installable-app manifest beside the world list (apps/web/src/pwa-manifest.ts)
        if (path === '/manifest.webmanifest' && serveFile(res, join(webDir, 'manifest.webmanifest'), 'public, max-age=3600', req)) return;
        if (path.startsWith('/assets/')) { const f = inside(webDir, path); if (f && serveFile(res, f, 'public, max-age=31536000, immutable', req)) return; }  // P1: req = ETag/304 + precompressed .br/.gz
        // this release's /modular (the humanoid kit and the environment GLBs; release.sh links the commit's own copy into
        // mars-web): served here, so composed bodies and characters never depend on which world happens to be awake. An
        // old-world fork has no humanoid kit, and its descriptor's mars-web is the copy sealed at cutover (legacy: the
        // 3.19 character wire files *.mesh.glb + clips-*.glb were a 404 there and /w/eden never drew). A file this release
        // lacks still goes to a world below.
        if (path.startsWith('/modular/') && marsWebDir && !/[\\%]|\.\./.test(path) && /\.(glb|json|bin|webp|png|jpe?g|svg)$/i.test(path)) { const f = inside(join(marsWebDir, 'modular'), path.slice('/modular'.length)); if (f && serveFile(res, f, 'public, max-age=86400, stale-while-revalidate=604800', req)) return; }
        if (path.startsWith('/world-assets/')) { const f = inside(join(root, 'worlds'), decodeURIComponent(path.slice('/world-assets'.length))); if (f && serveFile(res, f, 'public, max-age=3600', req)) return; }
      }
      // Anything else a world page asks for (Mars assets, engine files, …): any running world serves it (base stripped).
      // Original worlds at the root: the world the laptop proxy sent that path to (woken if asleep), as before the move.
      const p = oldRoot ? await oldWorldPort(path) : anyRunning();
      if (p) { proxyHttp(req, res, p, { path: B ? path + url.search : undefined }); return; }
      json(res, 404, { ok: false, code: 'not-found' });
    } catch (e) {
      log(`error ${req.method} ${path}: ${e.message}`);
      if (!res.headersSent) json(res, 500, { ok: false, code: 'internal', message: e.message }); else res.destroy();
    }
  });
  // Idle keep-alive connections outlive the proxy's own idle timeout (Caddy's upstream default is 2 min), so the proxy, not
  // this server, closes them: a server-side close races a request the proxy is sending on that connection, and a POST
  // lost that way is a 502 page (Node's 5 s default did this between releases too). headersTimeout stays above it.
  server.requestTimeout = 0; server.timeout = 0; server.keepAliveTimeout = KEEP_ALIVE_MS; server.headersTimeout = KEEP_ALIVE_MS + 5_000;
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  /** Pipe an upgrade to a port; `refused` (optional) runs instead when nothing answers there before the pipe starts. */
  function pipeUpgrade(req, socket, head, p, refused) {
    let piped = false;
    const up = connect(p, '127.0.0.1', () => {
      piped = true;
      up.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${Object.entries(req.headers).flatMap(([k, v]) => Array.isArray(v) ? v.map((x) => `${k}: ${x}`) : [`${k}: ${v}`]).join('\r\n')}\r\n\r\n`);
      if (head.length) up.write(head);
      socket.pipe(up).pipe(socket);
    });
    up.on('error', () => { if (!piped && refused) { up.destroy(); refused(); } else socket.destroy(); });
    socket.on('error', () => up.destroy()); socket.on('close', () => up.destroy()); up.on('close', () => { if (piped || !refused) socket.destroy(); });
  }
  server.on('upgrade', async (req, socket, head) => {
    socket.simUpgraded = true;
    if (retiredTo) { pipeUpgrade(req, socket, head, port); return; }
    const u = req.url ?? '', rel = !B ? u : u.startsWith(`${B}/`) ? u.slice(B.length) : '';
    const slug = rel.match(/^\/w\/([a-z][a-z0-9-]{0,31})(?:[/?]|$)/)?.[1];
    const w = slug && !closing.has(slug) && registry.get(slug);
    if (!w) { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return; }
    const eyes = eyesAgent(req.headers['user-agent']);
    const attach = async (again) => {
      let p; try { p = await pool.ensure(worldEnv(w), { passive: eyes }); }
      catch (e) { if ((e.code === 'handed-over' && retiredTo) || (await waitHandBack(slug, e))) pipeUpgrade(req, socket, head, port); else socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return; }
      // a world being handed over may refuse once (its old process just stopped): ask again, which waits for the new one
      pipeUpgrade(req, socket, head, p, again ? () => void attach(false) : undefined);
    };
    await attach(true);
    if (eyes) return; // not a watcher: never holds the world awake (busy) nor counts as use
    live.set(slug, (live.get(slug) ?? 0) + 1);
    let gone = false;
    const left = () => { if (gone) return; gone = true; const n = (live.get(slug) ?? 1) - 1; if (n > 0) live.set(slug, n); else live.delete(slug); const k = pool.state(slug); if (k) k.lastUsed = Date.now(); };
    socket.once('end', left); socket.once('close', left);
  });
  // declared before listen(): a request that arrives while orphans are reaped below must not hit its temporal dead zone (P2)
  let closed = false;
  // Under the keeper the port is the keeper's: connections arrive through accept() instead of listen().
  if (cfg.listen !== false) await new Promise((yes, no) => { server.once('error', no); server.listen(port, '127.0.0.1', yes); });
  if (adopting) {
    // a handover: these worlds still run under the previous launcher; proxy to them until takeOver() (no orphan reaping:
    // every child in children.json is alive and owned by it)
    for (const a of adopting) { const w = registry.get(a.slug); if (w && Number.isInteger(a.port) && Number.isInteger(a.pid)) pool.adopt(worldEnv(w), a); }
    log(`adopted ${pool.kids.size} running world(s) from the previous launcher: ${[...pool.kids.keys()].join(', ') || 'none'}`);
  } else for (const r of await pool.reapOrphans()) log(`stopped ${r.slug} (pid ${r.pid}) left running by an earlier launcher`);
  log(`${origin}${B}/  (data ${dataDir}, worlds ${registry.worlds.length}/${MAX_WORLDS}, running cap ${prod.maxRunning}, children ${range[0]}–${range[1]}, sign-in ${auth ? `Clerk for ${publicOrigin}` : 'dev names'}, build ${BUILD})`);

  // Eagerly wake the most recent worlds so the homepage numbers are live; the rest start on first visit.
  const wakeRecent = () => { for (const w of [...registry.worlds].sort((a, b) => b.createdAt - a.createdAt).slice(0, cfg.eager ?? 4)) if (pool.status(w.slug).status !== 'running') pool.ensure(worldEnv(w)).then((p) => log(`woke ${w.slug} on :${p}`), (e) => log(`could not wake ${w.slug}: ${e.message}`)); };
  if (!adopting) wakeRecent();   // a handover wakes nothing until it has taken over (takeOverAll)
  // idle worlds sleep (frozen in place) and wake on their next request; see ChildPool.freezeIdle
  const sleepMs = cfg.sleepMs ?? SLEEP_MS;
  // ...and a world asleep for exitMs more exits (its memory given back) and cold-boots on its next request; see ChildPool.releaseIdle
  const exitMs = pool.o.exitMs ?? 0;
  let releasing = false;
  const sweep = sleepMs > 0 ? setInterval(() => {
    for (const slug of pool.freezeIdle()) log(`${slug} is asleep (nobody for ${sleepMs / 1000} s)`);
    if (exitMs > 0 && !releasing) {
      releasing = true;
      pool.releaseIdle().then((slugs) => { for (const slug of slugs) log(`${slug} gave its memory back (asleep for ${exitMs / 60_000} min: process exited; its next visit wakes it)`); }, (e) => log(`releasing idle worlds: ${e.message}`)).finally(() => { releasing = false; });
    }
  }, Math.min(15_000, Math.max(250, Math.min(sleepMs, exitMs || sleepMs) / 4))) : null;
  sweep?.unref();

  return {
    server, url: origin, registry, pool, dataDir, auth: auth?.public ?? { provider: 'dev' }, build: BUILD,
    /** Keeper: a connection accepted on the public port, passed to this launcher. */
    accept(socket) { server.emit('connection', socket); socket.resume(); },
    /** Keeper, step 1: finish creations, hold new boots and writes, report the running worlds for the next launcher. */
    async prepareHandover() {
      if (phase !== 'active') throw new Error(`cannot prepare a handover while ${phase}`);
      phase = 'preparing'; let open; gate = { p: new Promise((r) => { open = r; }), open };
      pool.pause();
      await creating; await pool.settled();
      registry.frozen = true; pool.savePids(); const pidFile = pool.o.pidFile; pool.o.pidFile = null; gate.pidFile = pidFile;
      return pool.handoverList();
    },
    /** Keeper: the next launcher failed before it served anyone; carry on as before. */
    resumeHandover() {
      if (phase !== 'preparing') return;
      phase = 'active'; registry.frozen = false; pool.o.pidFile = gate.pidFile; pool.savePids(); registry.save();
      const g = gate; gate = null; pool.unpause(); g.open();
      log('handover abandoned: serving on as before');
    },
    /** Keeper, step 3: the next launcher serves new connections; anything still arriving here is forwarded to it. No
     *  world starts here again. Idle connections are NOT closed here: the proxy in front (Caddy) may be sending a request
     *  on one at this very instant, and a POST whose connection closes under it cannot be replayed (Caddy answers 502;
     *  measured 4 in ~9800 requests at one switch). Each connection instead closes cleanly after its next response
     *  (forward() answers with Connection: close), and whatever is still idle closes at exit. */
    retire() {
      phase = 'retired'; retiredTo = port; pool.fence(); errors.flush(); retiredPidFile = gate?.pidFile ?? retiredPidFile;
      const g = gate; gate = null; g?.open(); handBack?.open();
    },
    /** Keeper, canary failed (the next launcher could not run its first world and has stopped it): serve again as
     *  before, booting that world here on this release's code. The other worlds never left this launcher. */
    async unretire(slug) {
      if (phase !== 'retired') throw new Error(`cannot unretire while ${phase}`);
      phase = 'active'; retiredTo = null; pool.unfence(); registry.frozen = false; pool.o.pidFile = retiredPidFile; pool.savePids(); registry.save();
      log(`the next launcher's canary failed: serving on as before${slug ? `, booting ${slug} here again` : ''}`);
      const w = slug ? registry.get(slug) : null;
      return w ? pool.ensure(worldEnv(w)) : null;
    },
    /** Keeper, step 4 (on the old launcher): stop one world so the next one can boot it on the same data. */
    async releaseWorld(slug) { if (phase !== 'retired') throw new Error('release before retire'); await pool.stop(slug); return pool.status(slug); },
    /** Keeper, step 4 (on the new launcher): take every adopted world over, `concurrency` at a time; per-world results. */
    async takeOverAll(release, { concurrency = 1, canary = false } = {}) {
      const todo = [...pool.kids.values()].filter((k) => k.adopted).map((k) => k.slug), out = {};
      const one = async (slug) => {
        const t0 = performance.now();
        try {
          const p = await pool.takeOver(slug, release);
          const k = pool.state(slug);
          // ms: the world's visible pause (old process stopping + new one opening); totalMs adds the pre-warm before it
          const total = Math.round(performance.now() - t0);
          out[slug] = { ok: true, ms: k?.pauseStart ? Date.now() - k.pauseStart : total, totalMs: total, port: p, ...(k?.lastWarm ? { warm: k.lastWarm } : {}) }; log(`took over ${slug} on :${p} in ${out[slug].ms} ms${k?.releaseMs != null ? ` (previous process stopped in ${k.releaseMs} ms)` : ''}${k?.lastWarm?.ok ? ` (pre-warmed ${k.lastWarm.ms} ms before)` : ''}`);
        } catch (e) { out[slug] = { ok: false, ms: Math.round(performance.now() - t0), error: e.message }; log(`could not take over ${slug}: ${e.message}`); }
      };
      // canary: one world moves first and must also answer its config (as the release's boot smoke asks); if it cannot,
      // nothing else moves and the keeper hands back to the previous launcher, which boots that one world again
      if (canary && todo.length) {
        const pick = todo.find((s) => !registry.get(s)?.fork) ?? todo[0];
        todo.splice(todo.indexOf(pick), 1);
        let verdict; canaryRun = { slug: pick, passed: new Promise((r) => { verdict = r; }) };
        await one(pick);
        if (out[pick].ok) {
          const r = await fetch(`http://127.0.0.1:${out[pick].port}${wp(pick)}/v1/config`, { signal: AbortSignal.timeout(10_000) }).catch((e) => ({ ok: false, status: e.message }));
          if (!r.ok) { out[pick] = { ...out[pick], ok: false, error: `canary: /v1/config answered ${r.status}` }; await pool.stop(pick); }
        }
        if (!out[pick].ok) { let open; handBack = { p: new Promise((r) => { open = r; }), open }; pool.handBack(pick); verdict(false); log(`canary ${pick} failed on this release: handing back`); return { worlds: out, canaryFailed: pick }; }
        out[pick].canary = true; verdict(true); canaryRun = null;
      }
      const lanes = Array.from({ length: Math.max(1, concurrency) }, async () => { while (todo.length) await one(todo.shift()); });
      await Promise.all(lanes);
      wakeRecent();
      return { worlds: out };
    },
    /** Open (non-upgraded) requests still being answered here. */
    busy() { let n = 0; for (const s of sockets) if (s.simBusy && !s.simUpgraded) n++; return n; },
    /** Stop. When systemd holds the port (keeper under socket activation, SIM_PORT_HELD=1), new connections wait in its
     *  backlog for the next keeper, so this launcher can end its own gently first: each connection ends after its next
     *  answer (Connection: close; none is cut under a request the proxy is sending), requests in flight finish while
     *  their worlds still run, and only connections idle through `idleMs` (or anything after `drainMs`) are cut. Without
     *  a held port every moment here is refused connections, so it stops at once, as before. After a handover (`gentle`)
     *  the keeper's port is served by the next launcher, so that exit is gentle too. */
    close: async ({ drainMs = 3_000, idleMs = 1_500, gentle = process.env.SIM_PORT_HELD === '1' } = {}) => {
      if (closed) return; closed = true; clearInterval(sweep); errors.flush();
      const live = () => [...sockets].filter((s) => !s.simUpgraded);
      if (gentle) for (const t0 = Date.now(); live().length && Date.now() - t0 < drainMs && (Date.now() - t0 < idleMs || live().some((s) => s.simBusy));) await new Promise((r) => setTimeout(r, 20));
      const done = new Promise((r) => server.close(() => r()));   // (Node's close() also cuts idle connections: only now)
      for (const s of sockets) s.destroy(); await pool.closeAll(); await done;
    },
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

/**
 * One generation under the keeper (keeper.mjs): connections and handover steps arrive as IPC messages.
 *   conn (+ socket)  a connection on the public port          prepare → prepared {children}   resume
 *   retire           the next generation serves now           release {id, slug} → released {id, ok}
 *   take-over        adopt → own every world (asks release)   exit                            (keeper is gone: stop)
 */
function serveKeeper(l, stop) {
  let n = 0; const waiting = new Map();
  const ask = (m) => new Promise((yes, no) => { const id = ++n; waiting.set(id, { yes, no }); process.send({ ...m, id }); });
  process.on('message', (m, handle) => {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'conn') { if (handle) l.accept(handle); return; }
    const reply = (p) => p.then((r) => process.send({ t: `${m.t}-done`, id: m.id, ok: true, ...r }), (e) => process.send({ t: `${m.t}-done`, id: m.id, ok: false, error: e.message }));
    if (m.t === 'prepare') reply(l.prepareHandover().then((children) => ({ children })));
    else if (m.t === 'resume') l.resumeHandover();
    else if (m.t === 'retire') l.retire();
    else if (m.t === 'release') reply(l.releaseWorld(m.slug).then((st) => ({ slug: m.slug, status: st.status })));
    else if (m.t === 'release-done') { const w = waiting.get(m.id); waiting.delete(m.id); if (w) (m.ok ? w.yes() : w.no(new Error(m.error ?? 'the previous launcher could not stop it'))); }
    else if (m.t === 'take-over') reply(l.takeOverAll((slug) => ask({ t: 'release', slug }), { concurrency: Number(process.env.SIM_HANDOVER_CONCURRENCY ?? 1), canary: m.canary === true }));
    else if (m.t === 'unretire') reply(l.unretire(m.slug).then((p) => ({ slug: m.slug ?? null, port: p ?? null })));
    else if (m.t === 'exit') {
      // the last forwarded responses finish (up to 10 s), then this generation is gone
      const t0 = Date.now(); const done = () => (l.busy() === 0 || Date.now() - t0 > 10_000 ? stop('handed over', true) : setTimeout(done, 100)); done();
    }
  });
  process.on('disconnect', () => stop('keeper gone'));
  process.send({ t: 'ready', build: l.build, pid: process.pid });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const flag = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const range = flag('range')?.split('-').map(Number);
  const underKeeper = process.env.SIM_KEEPER === '1' && typeof process.send === 'function';
  try {
    const num = (k) => (flag(k) === undefined ? undefined : Number(flag(k)));
    const l = await openLauncher({ port: num('port'), dataDir: flag('data'), range: range?.length === 2 ? range : undefined, eager: num('eager'),
      publicOrigin: flag('public-origin'), authEnvFile: flag('auth-env') ?? flag('auth-env-file'), devAuth: argv.includes('--dev-auth') ? true : undefined,
      maxWorlds: num('max-worlds'), maxRunning: num('max-running'), minFreeMb: num('min-free-mb'), worldHeapMb: num('world-heap-mb'), idleMs: num('idle-ms'), sleepMs: num('sleep-ms'), exitMs: flag('idle-exit-min') === undefined ? undefined : num('idle-exit-min') * 60_000, createLimit: num('create-limit'),
      maxWorldsPerAccount: num('max-worlds-per-account'), newAccountHours: num('new-account-hours'), newAccountWorldLimit: num('new-account-world-limit'), newAccountCreateLimit: num('new-account-create-limit'), newAccountWindowMinutes: num('new-account-window-minutes'),
      marsWebDir: flag('mars-web'), cobuilders: argv.includes('--cobuilders') ? true : undefined, webDir: flag('web'), base: flag('base'), oldWorldsRoot: argv.includes('--old-worlds-root') ? true : undefined, soulCli: flag('soul-cli'), soulSkill: flag('soul-skill'), soulInstructions: flag('soul-instructions'),
      ...(underKeeper ? { listen: false, adopt: process.env.SIM_ADOPT ? JSON.parse(process.env.SIM_ADOPT) : null } : {}) });
    let stopping = false;
    const stop = (why, gentle) => { if (stopping) return; stopping = true; console.log(`[launcher] ${why}: stopping worlds…`); void l.close(gentle ? { gentle } : {}).then(() => process.exit(0)); };
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => stop(sig));
    if (underKeeper) serveKeeper(l, stop);
  } catch (e) { console.error(`[launcher] refused: ${e.message}`); process.exitCode = 1; if (underKeeper) process.disconnect?.(); }
}
