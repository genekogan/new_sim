// World processes behind the launcher: one `apps/server/src/main.ts` per world on
// a free port from a private range, fake minds, dev auth, its own data dir.
// Crashed children restart with exponential backoff; a stop is final.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

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
   *           healthPath?: (slug: string) => string, onChange?: (slug: string) => void }} o
   */
  constructor(o) {
    this.o = o;
    this.kids = new Map();   // slug → state
    this.closing = false;
    mkdirSync(o.logDir, { recursive: true });
  }
  state(slug) { return this.kids.get(slug) ?? null; }
  status(slug) {
    const k = this.kids.get(slug);
    if (!k) return { status: 'stopped' };
    return { status: k.status, port: k.port, pid: k.child?.pid ?? null, restarts: k.restarts, upSince: k.upSince, lastExit: k.lastExit };
  }
  usedPorts() { return new Set([...this.kids.values()].map((k) => k.port).filter(Boolean)); }
  async pickPort(prefer) {
    const [lo, hi] = this.o.range, used = this.usedPorts();
    if (prefer && prefer >= lo && prefer <= hi && !used.has(prefer) && await portFree(prefer)) return prefer;
    for (let p = lo; p <= hi; p++) if (!used.has(p) && await portFree(p)) return p;
    throw new Error(`no free port in ${lo}–${hi}`);
  }

  /** Start (or join the start of) a world; resolves with its port once /healthz answers. */
  ensure(world, { timeoutMs = 90_000 } = {}) {
    let k = this.kids.get(world.slug);
    if (k && (k.status === 'running')) return Promise.resolve(k.port);
    if (k?.ready) return k.ready;
    k = k ?? { slug: world.slug, world, restarts: 0, crashes: 0, status: 'starting', port: null, child: null, upSince: null, lastExit: null, ready: null, stopped: false };
    k.world = world; k.stopped = false;
    if (k.timer) { clearTimeout(k.timer); k.timer = null; }  // someone is waiting: restart now, not after the backoff
    this.kids.set(world.slug, k);
    k.ready = this.boot(k, timeoutMs).finally(() => { k.ready = null; });
    return k.ready;
  }

  async boot(k, timeoutMs) {
    k.status = 'starting'; this.o.onChange?.(k.slug);
    const port = await this.pickPort(k.port ?? k.world.port);
    k.port = port;
    const { cmd, args, env } = (this.o.command ?? defaultCommand)(k.world, port, this.o);
    const log = createWriteStream(join(this.o.logDir, `${k.slug}.log`), { flags: 'a' });
    log.write(`\n--- ${new Date().toISOString()} start ${k.slug} on :${port} (restart ${k.restarts})\n`);
    const child = spawn(cmd, args, { cwd: this.o.root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    k.child = child;
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    let exited = false;
    child.once('exit', (code, signal) => { exited = true; log.end(`--- exit ${code ?? signal}\n`); this.onExit(k, child, code, signal); });
    child.once('error', (e) => { log.write(`--- spawn error ${e.message}\n`); });
    const health = `http://127.0.0.1:${port}${(this.o.healthPath ?? ((s) => `/w/${s}/healthz`))(k.slug)}`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !exited && !k.stopped) {
      try { const r = await fetch(health, { signal: AbortSignal.timeout(1500) }); if (r.ok) { k.status = 'running'; k.upSince = Date.now(); this.o.onChange?.(k.slug); return port; } } catch { /* booting */ }
      await sleep(150);
    }
    if (!exited) child.kill('SIGKILL');
    k.status = 'failed'; this.o.onChange?.(k.slug);
    throw new Error(exited ? `world ${k.slug} exited while booting (see ${join(this.o.logDir, k.slug + '.log')})` : `world ${k.slug} did not answer /healthz within ${timeoutMs / 1000}s`);
  }

  onExit(k, child, code, signal) {
    if (k.child !== child) return;
    k.child = null; k.lastExit = { code, signal, at: Date.now() };
    if (this.closing || k.stopped) { k.status = 'stopped'; this.o.onChange?.(k.slug); return; }
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
      if (this.closing || k.stopped) return;
      k.ready = this.boot(k, 90_000).finally(() => { k.ready = null; });
      k.ready.catch((e) => { k.lastError = e.message; if (!this.closing && !k.stopped) this.scheduleRestart(k); });
    }, wait);
  }

  async stop(slug) {
    const k = this.kids.get(slug); if (!k) return;
    k.stopped = true; if (k.timer) clearTimeout(k.timer);
    const c = k.child; if (!c) { k.status = 'stopped'; return; }
    c.kill('SIGTERM');
    await Promise.race([new Promise((r) => c.once('exit', r)), sleep(10_000)]);
    if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
    k.status = 'stopped';
  }
  async closeAll() { this.closing = true; await Promise.all([...this.kids.keys()].map((s) => this.stop(s))); }
}

/** The Sim server for one entity world (same env as tools/god-skill/dev-world.mjs). */
export function defaultCommand(world, port, o) {
  const marsWeb = o.marsWebDir ? resolve(o.marsWebDir) : null;
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG,
    // fake minds and no model keys: $0 model spend, always
    ANTHROPIC_API_KEY: '', TYPESAFE_API_KEY: '', OPENAI_API_KEY: '', BRAIN_MODE: 'fake',
    WORLD_KEY: world.slug, WORLD_ID: `${world.slug}-1`, WORLD_NAME: world.name ?? '', ENGINE: 'mars', PORT: String(port), HOST: '127.0.0.1',
    DEV_AUTH: '1', SEED_NATIVES: '0', DATA_DIR: world.dataDir, PUBLIC_URL: o.publicOrigin, ENABLE_WORLD_ENGINE: '1',
    ...(marsWeb && existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}),
    ...(world.templateFile ? { GENESIS_FILE: world.templateFile } : {}),
  };
  return { cmd: process.execPath, args: ['apps/server/src/main.ts'], env };
}
