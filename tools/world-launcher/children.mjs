// World processes behind the launcher: one `apps/server/src/main.ts` per world on
// a free port from a private range, edge minds (no server thinking), dev auth, its own data dir.
// Crashed children restart with exponential backoff; a stop is final.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { memAvailableMb, rotateLog } from './production.mjs';

/** Printed by a world process started with SIM_STANDBY=1 once its code is loaded (apps/server/src/standby.ts). */
export const STANDBY_MARK = '[standby] ready';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const backoffMs = (n) => Math.min(30_000, 500 * 2 ** Math.max(0, n));

/** True when nothing listens on 127.0.0.1:port (we can bind it ourselves). */
export function portFree(port) {
  return new Promise((yes) => {
    const s = createServer();
    s.once('error', () => yes(false));
    s.listen(port, '127.0.0.1', () => s.close(() => yes(true)));
  });
}

export class ChildPool {
  /**
   * @param {{ root: string, range: [number, number], logDir: string, marsWebDir?: string, publicOrigin: string,
   *           command?: (w: object, port: number) => { cmd: string, args: string[], env?: object },
   *           healthPath?: (slug: string) => string, onChange?: (slug: string) => void, pidFile?: string, idleMs?: number,
   *           maxRunning?: number, minFreeMb?: number, busy?: (slug: string) => boolean,
   *           decorate?: (c: { cmd: string, args: string[], env?: object }) => { cmd: string, args: string[], env?: object },
   *           soulCliFile?: string | null, soulSkillFile?: string | null, soulInstructionsFile?: string | null }} o
   * maxRunning / minFreeMb: before a world boots, idle worlds are put to sleep until it fits; when none can sleep the
   * boot is refused (error.code 'capacity'). busy(slug): a world with live viewers is never put to sleep.
   */
  constructor(o) {
    this.o = o;
    this.kids = new Map();   // slug → state
    this.closing = false;
    /** Handed over to a newer launcher (keeper.mjs): no world of this pool may start or restart again. */
    this.fenced = false;
    this.gate = null; this.inflight = new Set();
    mkdirSync(o.logDir, { recursive: true });
  }

  // ---------- handover between launcher generations (keeper.mjs; lane C4 downtime)
  /** A world still run by the previous launcher (its child, its port): proxied to as is until takeOver(). Never booted,
   *  stopped, put to sleep or restarted by this pool while adopted, so its database has exactly one writer. */
  adopt(world, { port, pid, script }) {
    this.kids.set(world.slug, { slug: world.slug, world, restarts: 0, crashes: 0, status: 'running', port, child: null, adopted: { pid, script }, upSince: Date.now(), lastExit: null, ready: null, stopped: false, lastUsed: Date.now() });
    this.savePids();
  }
  /** Take an adopted world over: `release(slug)` makes the previous launcher stop it (snapshot saved, process gone);
   *  then it boots here on the same data. Requests that arrive meanwhile wait on `ready` instead of failing. */
  takeOver(slug, release, { timeoutMs = 180_000 } = {}) {
    const k = this.kids.get(slug);
    if (!k?.adopted) return Promise.resolve(k?.port ?? null);
    k.status = 'handover'; this.o.onChange?.(slug);
    k.ready = (async () => {
      // pre-warm: the next process loads its code while the previous one still serves (no database, no port yet)
      const warm = !this.o.prewarm ? null : await this.standby(k).catch((e) => { k.lastWarm = { ok: false, error: e.message }; return null; });
      const paused = Date.now(); k.pauseStart = paused;   // from here the world does not answer until the new process does
      try { await release(slug); }
      catch (e) { warm?.child.kill('SIGTERM'); k.status = 'failed'; k.lastError = `handover: ${e.message}`; this.o.onChange?.(slug); throw e; }
      k.adopted = null; this.savePids();
      if (this.closing || this.fenced) { warm?.child.kill('SIGTERM'); k.status = 'stopped'; throw new Error(`world ${slug}: this launcher is closing`); }
      if (warm && warm.child.exitCode === null && warm.child.signalCode === null) {
        k.status = 'starting'; k.port = warm.port; k.asleep = false; this.attach(k, warm);
        warm.child.kill('SIGUSR2');   // open the data and the port now
        const run = this.healthy(k, warm, timeoutMs);
        this.inflight.add(run); run.then(() => this.inflight.delete(run), () => this.inflight.delete(run));
        return run;
      }
      return this.boot(k, timeoutMs);   // no standby process (old release, or it failed): a cold boot, as before
    })().finally(() => { k.ready = null; });
    return k.ready;
  }
  /** Start the world's next process in standby (SIM_STANDBY=1, apps/server/src/standby.ts) on its current port, which
   *  is free again once the previous process is released; resolves when it reports its code loaded. */
  async standby(k, timeoutMs = 60_000) {
    const t0 = Date.now(), run = this.launch(k, k.port, { SIM_STANDBY: '1' }, { rotate: false });
    await new Promise((yes, no) => {
      let buf = '';
      const t = setTimeout(() => done(new Error(`no standby mark in ${timeoutMs / 1000}s`)), timeoutMs);
      const onData = (d) => { buf = (buf + d).slice(-4096); if (buf.includes(STANDBY_MARK)) done(null); };
      const onExit = () => done(new Error('exited while loading'));
      const done = (e) => { clearTimeout(t); run.child.stdout.off('data', onData); run.child.off('exit', onExit); if (e) { run.child.kill('SIGKILL'); no(e); } else yes(); };
      run.child.stdout.on('data', onData); run.child.once('exit', onExit);
    });
    k.lastWarm = { ok: true, ms: Date.now() - t0 };
    return run;
  }
  /** Preparing a handover: hold every new boot at the gate (unpause() lets them go on; fence() refuses them). */
  pause() { if (!this.gate) { let open; const p = new Promise((r) => { open = r; }); this.gate = { p, open }; } }
  unpause() { const g = this.gate; this.gate = null; g?.open(); }
  /** Boots already past the gate (spawned), settled: after pause() nothing new starts, so the running set is final. */
  async settled() { await Promise.allSettled([...this.inflight]); }
  /** After a handover: refuse every start and restart; children that exit stay stopped. */
  fence() { this.fenced = true; for (const k of this.kids.values()) if (k.timer) { clearTimeout(k.timer); k.timer = null; } this.unpause(); }
  /** This pool's canary failed (keeper.mjs hands back to the previous launcher): the world is never started here again
   *  and the pid file is the previous launcher's alone. */
  handBack(slug) { const k = this.kids.get(slug); if (k) k.handedBack = true; this.o.pidFile = null; }
  /** The next launcher's canary failed (keeper.mjs): this pool runs its worlds again. */
  unfence() { this.fenced = false; }
  /** The running children, for the next launcher to adopt. */
  handoverList() { return [...this.kids.values()].filter((k) => k.child && k.status === 'running').map((k) => ({ slug: k.slug, port: k.port, pid: k.child.pid, script: k.script })); }

  /** Children a previous launcher left running (it was killed hard): stop them before anyone opens their databases again. */
  async reapOrphans() {
    if (!this.o.pidFile || !existsSync(this.o.pidFile)) return [];
    let rec = {}; try { rec = JSON.parse(readFileSync(this.o.pidFile, 'utf8')); } catch { return []; }
    const reaped = [];
    for (const [slug, { pid, script }] of Object.entries(rec)) {
      if (!Number.isInteger(pid) || pid === process.pid) continue;
      let cmdline = '';
      try { process.kill(pid, 0); cmdline = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }); } catch { continue; }
      if (!script || !cmdline.includes(script)) continue;   // the pid was reused by something else: leave it alone
      try { process.kill(pid, 'SIGTERM'); } catch { continue; }
      for (let i = 0; i < 50; i++) { try { process.kill(pid, 0); } catch { break; } await sleep(100); }
      try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
      reaped.push({ slug, pid });
    }
    this.savePids();
    return reaped;
  }
  savePids() {
    if (!this.o.pidFile) return;
    const rec = {};
    for (const k of this.kids.values()) if (k.child?.pid) rec[k.slug] = { pid: k.child.pid, port: k.port, script: k.script }; else if (k.adopted?.pid) rec[k.slug] = { pid: k.adopted.pid, port: k.port, script: k.adopted.script };
    const tmp = `${this.o.pidFile}.${process.pid}.tmp`;
    try { writeFileSync(tmp, JSON.stringify(rec, null, 2) + '\n'); renameSync(tmp, this.o.pidFile); } catch { /* best effort */ }
  }
  /** Put the least recently used idle world to sleep to free a port (it wakes on its next visit). */
  async evictIdle(except) {
    const idleMs = this.o.idleMs ?? 60_000, now = Date.now();
    const victim = [...this.kids.values()].filter((k) => k.slug !== except && k.status === 'running' && !k.adopted && now - (k.lastUsed ?? 0) > idleMs && !this.o.busy?.(k.slug)).sort((a, b) => (a.lastUsed ?? 0) - (b.lastUsed ?? 0))[0];
    if (!victim) return null;
    await this.stop(victim.slug);
    victim.asleep = true;
    return victim.slug;
  }
  state(slug) { return this.kids.get(slug) ?? null; }
  status(slug) {
    const k = this.kids.get(slug);
    if (!k) return { status: 'stopped' };
    return { status: k.asleep && k.status === 'stopped' ? 'asleep' : k.status, port: k.port, pid: k.child?.pid ?? k.adopted?.pid ?? null, ...(k.adopted ? { adopted: true } : {}), restarts: k.restarts, upSince: k.upSince, lastExit: k.lastExit };
  }
  /** Ports held by live or (re)starting children; a sleeping world's old port is free for anyone. */
  usedPorts(except) { return new Set([...this.kids.values()].filter((k) => k.slug !== except && (k.child || k.adopted || k.status === 'starting' || k.status === 'restarting' || k.status === 'handover')).map((k) => k.port).filter(Boolean)); }
  async pickPort(prefer, self) {
    const [lo, hi] = this.o.range, used = this.usedPorts(self);
    if (prefer && prefer >= lo && prefer <= hi && !used.has(prefer) && await portFree(prefer)) return prefer;
    for (let p = lo; p <= hi; p++) if (!used.has(p) && await portFree(p)) return p;
    throw new Error(`no free port in ${lo}–${hi}`);
  }

  /** Start (or join the start of) a world; resolves with its port once /healthz answers. */
  ensure(world, { timeoutMs = 90_000 } = {}) {
    if (this.fenced) { const e = new Error(`world ${world.slug} is served by a newer launcher`); e.code = 'handed-over'; return Promise.reject(e); }
    let k = this.kids.get(world.slug);
    if (k?.handedBack) { const e = new Error(`world ${world.slug} is going back to the previous launcher`); e.code = 'handed-back'; return Promise.reject(e); }
    if (k) k.lastUsed = Date.now();
    if (k && (k.status === 'running')) return Promise.resolve(k.port);
    if (k?.ready) return k.ready;
    // adopted but its handover failed: the previous launcher may still hold its database, so it is never started here
    if (k?.adopted) { const e = new Error(`world ${world.slug} could not be taken over from the previous launcher${k.lastError ? `: ${k.lastError}` : ''}`); e.code = 'handover-failed'; return Promise.reject(e); }
    k = k ?? { slug: world.slug, world, restarts: 0, crashes: 0, status: 'starting', port: null, child: null, upSince: null, lastExit: null, ready: null, stopped: false, lastUsed: Date.now() };
    k.world = world; k.stopped = false;
    if (k.timer) { clearTimeout(k.timer); k.timer = null; }  // someone is waiting: restart now, not after the backoff
    this.kids.set(world.slug, k);
    k.ready = this.boot(k, timeoutMs).finally(() => { k.ready = null; });
    return k.ready;
  }

  /** Live (or booting) children other than `except`. */
  running(except) { return [...this.kids.values()].filter((k) => k.slug !== except && (k.child || k.adopted || k.status === 'starting' || k.status === 'restarting' || k.status === 'handover')).length; }
  /** Make room for one more world under the running cap and the free-memory floor, sleeping idle worlds if needed. */
  async makeRoom(slug) {
    const { maxRunning = Infinity, minFreeMb = 0 } = this.o;
    for (;;) {
      const full = this.running(slug) >= maxRunning, low = minFreeMb > 0 && memAvailableMb() < minFreeMb;
      if (!full && !low) return;
      if (!(await this.evictIdle(slug))) {
        const e = new Error(full ? `all ${maxRunning} world slots are in use; try again in a minute` : `the server is low on memory (under ${minFreeMb} MB free); try again in a minute`);
        e.code = 'capacity'; throw e;
      }
      await sleep(200);   // the sleeper's memory takes a moment to come back
    }
  }

  async boot(k, timeoutMs) {
    while (this.gate) await this.gate.p;
    if (this.fenced) { k.status = 'stopped'; const e = new Error(`world ${k.slug} is served by a newer launcher`); e.code = 'handed-over'; throw e; }
    const run = this.spawnAndWait(k, timeoutMs);
    this.inflight.add(run); run.then(() => this.inflight.delete(run), () => this.inflight.delete(run));
    return run;
  }
  async spawnAndWait(k, timeoutMs) {
    k.status = 'starting'; this.o.onChange?.(k.slug);
    try { await this.makeRoom(k.slug); } catch (e) { k.status = 'failed'; this.o.onChange?.(k.slug); throw e; }
    let port;
    try { port = await this.pickPort(k.port ?? k.world.port, k.slug); }
    catch (e) {
      if (!(await this.evictIdle(k.slug))) throw e;
      for (let i = 0; ; i++) { try { port = await this.pickPort(k.port ?? k.world.port, k.slug); break; } catch (again) { if (i >= 50) throw again; await sleep(100); } }  // the sleeper's socket takes a moment to close
    }
    k.port = port; k.asleep = false;
    const run = this.launch(k, port);
    this.attach(k, run);
    return this.healthy(k, run, timeoutMs);
  }
  /** Spawn one world process on `port` (its log appended to the world's log file); not yet the world's child. */
  launch(k, port, extraEnv = {}, { rotate = true } = {}) {
    const base = (this.o.command ?? defaultCommand)(k.world, port, this.o);
    const { cmd, args, env } = this.o.decorate ? this.o.decorate(base) : base;
    const logFile = join(this.o.logDir, `${k.slug}.log`);
    if (rotate) rotateLog(logFile);
    const log = createWriteStream(logFile, { flags: 'a' });
    log.write(`\n--- ${new Date().toISOString()} start ${k.slug} on :${port} (restart ${k.restarts})${extraEnv.SIM_STANDBY ? ' standby' : ''}\n`);
    const child = spawn(cmd, args, { cwd: this.o.root, env: { ...env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
    const run = { child, port, script: args.find((a) => !a.startsWith('-')) ?? args[0], exited: false };
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    child.once('exit', (code, signal) => { run.exited = true; log.end(`--- exit ${code ?? signal}\n`); this.onExit(k, child, code, signal); });
    child.once('error', (e) => { log.write(`--- spawn error ${e.message}\n`); });
    return run;
  }
  /** The process becomes this world's child (crash restarts, stop, pid file). */
  attach(k, run) { k.child = run.child; k.script = run.script; this.savePids(); }
  /** Resolve with the port once the world answers /healthz; a process that exits or never answers fails the boot. */
  async healthy(k, run, timeoutMs) {
    const { child, port } = run;
    const health = `http://127.0.0.1:${port}${(this.o.healthPath ?? ((s) => `/w/${s}/healthz`))(k.slug)}`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !run.exited && !k.stopped) {
      try { const r = await fetch(health, { signal: AbortSignal.timeout(1500) }); if (r.ok) { k.status = 'running'; k.upSince = Date.now(); this.o.onChange?.(k.slug); return port; } } catch { /* booting */ }
      await sleep(150);
    }
    if (!run.exited) child.kill('SIGKILL');
    k.status = 'failed'; this.o.onChange?.(k.slug);
    throw new Error(run.exited ? `world ${k.slug} exited while booting (see ${join(this.o.logDir, k.slug + '.log')})` : `world ${k.slug} did not answer /healthz within ${timeoutMs / 1000}s`);
  }

  onExit(k, child, code, signal) {
    if (k.child !== child) return;
    k.child = null; k.lastExit = { code, signal, at: Date.now() }; this.savePids();
    if (this.closing || k.stopped || this.fenced) { k.status = 'stopped'; this.o.onChange?.(k.slug); return; }
    if (k.status === 'starting') return;  // boot() reports it (to ensure()'s caller, or to the restart loop)
    this.scheduleRestart(k);
  }
  /** A crash after a good run: restart with backoff (the count resets after a minute of health). */
  scheduleRestart(k) {
    if (k.upSince && Date.now() - k.upSince > 60_000) k.crashes = 0;
    const wait = backoffMs(k.crashes++);
    k.status = 'restarting'; k.restarts++; k.upSince = null; k.nextTryAt = Date.now() + wait; this.o.onChange?.(k.slug);
    k.timer = setTimeout(() => {
      k.timer = null;
      if (this.closing || k.stopped || this.fenced) return;
      k.ready = this.boot(k, 90_000).finally(() => { k.ready = null; });
      k.ready.catch((e) => { k.lastError = e.message; if (!this.closing && !k.stopped) this.scheduleRestart(k); });
    }, wait);
  }

  async stop(slug) {
    const k = this.kids.get(slug); if (!k) return;
    if (k.adopted) return;   // the previous launcher's child: only it stops it (handover release)
    k.stopped = true; if (k.timer) clearTimeout(k.timer);
    const c = k.child; if (!c) { k.status = 'stopped'; return; }
    c.kill('SIGTERM');
    await Promise.race([new Promise((r) => c.once('exit', r)), sleep(10_000)]);
    if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
    k.status = 'stopped';
  }
  async closeAll() { this.closing = true; await Promise.all([...this.kids.keys()].map((s) => this.stop(s))); }
}

/** The Sim server for one entity world (same env as tools/god-skill/dev-world.mjs).
 *  With `o.auth.envFile` (Clerk, production sign-in) the child reads its Clerk settings from that file by path
 *  (`node --env-file`); dev auth is off and every world shares one account registry, so a person is the same
 *  account in every world. Settings set here win over the file. */
export function defaultCommand(world, port, o) {
  const marsWeb = o.marsWebDir ? resolve(o.marsWebDir) : null;
  const clerk = o.auth?.envFile ? o.auth : null;
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG,
    // fake minds and no model keys: $0 model spend, always
    ANTHROPIC_API_KEY: '', TYPESAFE_API_KEY: '', OPENAI_API_KEY: '', BRAIN_MODE: 'fake',
    WORLD_KEY: world.slug, WORLD_ID: `${world.slug}-1`, WORLD_NAME: world.name ?? '', ENGINE: 'mars', PORT: String(port), HOST: '127.0.0.1',
    DEV_AUTH: clerk ? '0' : '1', SEED_NATIVES: '0', DATA_DIR: world.dataDir, PUBLIC_URL: o.publicOrigin, ENABLE_WORLD_ENGINE: '1',
    WORLD_PATH: `/w/${world.slug}`,
    // The launcher verifies signed-in creators before genesis, then confirms the same principal by claiming.
    ...(clerk ? { AUTH_PROVIDER: 'clerk', ACCOUNT_AUTH_REQUIRED: '1', ACCOUNT_REGISTRY_PATH: clerk.registryPath, INVITE_REQUIRED: '0', WORLD_OWNER_ID: '' } : {}),
    // Verified creator or loopback operator account only; user JSON cannot supply this value.
    ...(world.bornOwner ? { WORLD_OWNER_ID: world.bornOwner } : {}),
    // anyone signed in may join as a Soul under dev sign-in too (Clerk sets it above; edge minds: config default + production)
    ...(clerk ? {} : { INVITE_REQUIRED: '0' }),
    // Native Soul arrival/removal (lifecycle), so a Soul is made exactly as on the live worlds: the agent's create-soul,
    // and under Clerk the human's approval of it (main's accounts/). Lane P2.
    SOUL_LIFECYCLE: '1',
    // Souls fade and are lifted up after an hour without an action (green → yellow → red → beam-up), as on /w/eden (R4-LIVE)
    EDGE_FADING: '1',
    // Soul mode of the world's one skill (/SKILL.md) points at Codex's Soul skill (/skill.md) and CLI (/eden-agent.mjs),
    // served as is from the published files when the launcher is given them (--soul-skill, --soul-cli).
    ...(o.soulSkillFile && existsSync(o.soulSkillFile) ? { EDGE_SKILL_FILE: resolve(o.soulSkillFile) } : {}),
    ...(o.soulCliFile && existsSync(o.soulCliFile) ? { EDGE_CLI_FILE: resolve(o.soulCliFile) } : {}),
    ...(o.soulInstructionsFile && existsSync(o.soulInstructionsFile) ? { EDGE_INSTRUCTIONS_FILE: resolve(o.soulInstructionsFile) } : {}),
    ...(marsWeb && existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}),
    ...(world.templateFile ? { GENESIS_FILE: world.templateFile } : {}),
    // Travel between worlds (M3): the launcher's loopback relay and this run's site key (docs/sim/TRAVEL.md)
    ...(o.site?.url && o.site?.key ? { SIM_SITE_URL: o.site.url, SIM_SITE_KEY: o.site.key } : {}),
    // M4 shared library: one directory per launcher, <data>/library (Gene 2026-10-16 default)
    ...(o.libraryDir ? { SIM_LIBRARY_DIR: o.libraryDir } : {}),
    // Y4b co-builder tokens: off unless the launcher runs with --cobuilders (one god per world, Gene 2026-10-16)
    ...(o.cobuilders ? { SIM_COBUILDERS: '1' } : {}),
  };
  return { cmd: process.execPath, args: [...(clerk ? [`--env-file=${resolve(clerk.envFile)}`] : []), 'apps/server/src/main.ts'], env };
}

/** A fork of an old world (launcher op register-fork; tools/world-launcher/fork-world.mjs): main's old-world entry points
 *  under the launcher's base, Clerk with the forks' own account registry (the old worlds' accounts, so their Souls keep
 *  their owners), no world-engine flag (config.worldEngine stays off for the old keys), fake brain, no model keys. */
export function forkCommand(world, port, o) {
  const marsWeb = o.marsWebDir ? resolve(o.marsWebDir) : null;
  const clerk = o.auth?.envFile ? o.auth : null;
  if (!clerk) throw new Error(`fork ${world.slug}: forks sign in with Clerk; start the launcher with --auth-env`);
  if (!world.fork?.descriptor || !world.fork?.accounts) throw new Error(`fork ${world.slug}: descriptor and account registry required`);
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG,
    ANTHROPIC_API_KEY: '', TYPESAFE_API_KEY: '', OPENAI_API_KEY: '', BRAIN_MODE: 'fake', MIND_DRIVER: 'edge',
    WORLD_KEY: world.slug, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: world.dataDir, PUBLIC_URL: o.publicOrigin,
    WORLD_PATH: `/w/${world.slug}`, DEV_AUTH: '0', AUTH_PROVIDER: 'clerk', ACCOUNT_AUTH_REQUIRED: '1', ACCOUNT_REGISTRY_PATH: world.fork.accounts,
    SIM_FORK: world.slug,
    ...(o.soulCliFile && existsSync(o.soulCliFile) ? { EDGE_CLI_FILE: resolve(o.soulCliFile) } : {}),
    ...(marsWeb && existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}),
  };
  return { cmd: process.execPath, args: [`--env-file=${resolve(clerk.envFile)}`, '--experimental-transform-types', 'tools/world-launcher/fork-world.mjs', world.fork.descriptor], env };
}
