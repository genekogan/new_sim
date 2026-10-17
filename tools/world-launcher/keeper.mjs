#!/usr/bin/env node
// Keeper: the world launcher's stable front, so a release never closes the port (lane C4 `downtime`, backlog G9).
//
//   node tools/world-launcher/keeper.mjs --link <release dir or stage symlink> [launcher args: --port … --data … …]
//
// The keeper holds the launcher's port and runs the launcher itself as a child (a *generation*) from realpath(--link),
// passing it every accepted connection as a socket handle (no bytes are copied here). It is small and changes rarely;
// the launcher and the worlds change with each release.
//
// SIGHUP (systemctl reload sim-worlds@<stage>) hands over to a new generation started from wherever --link points now:
//   1 prepare   the old generation finishes creations, holds new boots and registry writes, reports its running worlds
//   2 start     the new generation starts, adopting those worlds (it proxies to them; it boots nothing yet)
//   3 switch    once it is up, every new connection goes to it; the old one forwards whatever still reaches it
//   4 take over one world at a time: the old generation stops it (snapshot saved, process gone), the new one boots it on
//               the same data. Requests and viewer sockets for that world wait for it instead of failing.
//   5 exit      the old generation finishes its last responses and exits
// Canary (step 4, first world): one world moves first, pre-warmed, and must answer /v1/config. If it cannot, nothing
// else moves: the old generation serves again and boots that world on its own code, the new one exits, and keeper.json
// says `rolled-back` (activate.sh then points the stage link back; no reload). Pre-warm: each world's new process loads
// its code in standby while the old one still serves, so a world's pause is only stop + open (children.mjs standby()).
// If the new generation fails before step 3, the old one resumes as if nothing happened (nothing was touched).
// A world that cannot be taken over is reported and stays down (never booted twice); release.sh rolls back.
//
// Status: <data>/keeper.json (keeper pid and sha, active generation and build, last handover with per-world times).
// The keeper writes nothing else. Port, data and other launcher settings change only with a full restart.
import { fork } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
export const keeperSha = () => createHash('sha256').update(readFileSync(SELF)).digest('hex');

const argv = process.argv.slice(2);
let link = null; const rest = [];
for (let i = 0; i < argv.length; i++) { if (argv[i] === '--link') link = argv[++i]; else rest.push(argv[i]); }
const flag = (k) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : undefined; };
const log = (s) => console.log(`[keeper] ${s}`);
if (!link) { console.error('[keeper] --link <release dir or symlink> is required'); process.exit(2); }
link = resolve(link);
const port = Number(flag('port') ?? 4980);
// a generation runs with cwd = its release: a relative --data would land in each release, so pin it now
const di = rest.indexOf('--data');
if (di >= 0 && !isAbsolute(rest[di + 1])) rest[di + 1] = resolve(rest[di + 1]);
const dataDir = di >= 0 ? rest[di + 1] : join(realpathSync(link), '.lane/launcher');
mkdirSync(dataDir, { recursive: true });
const STATUS = join(dataDir, 'keeper.json');
const CONCURRENCY = Number(process.env.SIM_HANDOVER_CONCURRENCY ?? 1);
// canary take-over (default on; SIM_HANDOVER_CANARY=0 moves every world without a first proof, as before)
const CANARY = process.env.SIM_HANDOVER_CANARY !== '0';

const status = { keeper: { pid: process.pid, sha: keeperSha(), startedAt: new Date().toISOString(), link, port }, active: null, handover: null };
function writeStatus() {
  const tmp = `${STATUS}.${process.pid}.tmp`;
  try { writeFileSync(tmp, JSON.stringify(status, null, 2) + '\n'); renameSync(tmp, STATUS); } catch (e) { log(`status not written: ${e.message}`); }
}

// ---------- generations
let genN = 0, active = null, stopping = false;
const gens = new Set();
const readBuild = (dir) => { try { return readFileSync(join(dir, 'BUILD'), 'utf8').trim(); } catch { return 'dev'; } };
function spawnGen(extraEnv = {}) {
  const dir = realpathSync(link);
  const script = join(dir, 'tools/world-launcher/launcher.mjs');
  if (!existsSync(script)) throw new Error(`no launcher in ${dir}`);
  const child = fork(script, rest, { cwd: dir, env: { ...process.env, SIM_KEEPER: '1', ...extraEnv }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], serialization: 'json' });
  const g = { n: ++genN, child, dir, build: readBuild(dir), pid: child.pid, up: false, exited: null, waiting: new Map(), onMsg: [] };
  let ready; g.ready = new Promise((yes, no) => { ready = { yes, no }; });
  child.on('message', (m) => onGenMessage(g, m, ready));
  child.on('exit', (code, signal) => { g.exited = { code, signal }; gens.delete(g); ready.no(new Error(`generation ${g.n} exited (${code ?? signal}) before it was ready`)); for (const w of g.waiting.values()) w.no(new Error(`generation ${g.n} exited`)); g.waiting.clear(); onGenExit(g); });
  gens.add(g);
  log(`generation ${g.n} (${g.build}) starting from ${dir}, pid ${g.pid}`);
  return g;
}
let askN = 0;
/** Send a step to a generation and wait for its `<t>-done` reply. */
function ask(g, m, timeoutMs) {
  return new Promise((yes, no) => {
    const id = `k${++askN}`; const t = setTimeout(() => { g.waiting.delete(id); no(new Error(`${m.t}: no answer from generation ${g.n} in ${timeoutMs / 1000}s`)); }, timeoutMs);
    g.waiting.set(id, { yes: (r) => { clearTimeout(t); yes(r); }, no: (e) => { clearTimeout(t); no(e); } });
    try { g.child.send({ ...m, id }); } catch (e) { clearTimeout(t); g.waiting.delete(id); no(e); }
  });
}
function onGenMessage(g, m, ready) {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'ready') { g.up = true; if (m.build) g.build = m.build; ready.yes(); return; }
  if (typeof m.t === 'string' && m.t.endsWith('-done') && g.waiting.has(m.id)) { const w = g.waiting.get(m.id); g.waiting.delete(m.id); if (m.ok) w.yes(m); else w.no(new Error(m.error ?? `${m.t} failed`)); return; }
  // the new generation asks the old one to stop a world (step 4); relayed, answered with release-done
  if (m.t === 'release') {
    const from = handing?.old;
    const answer = (ok, error) => { try { g.child.send({ t: 'release-done', id: m.id, ok, ...(error ? { error } : {}) }); } catch { /* gone */ } };
    if (!from || from.exited) { answer(false, 'the previous launcher is gone; its world may still be running (a full restart reaps it)'); return; }
    ask(from, { t: 'release', slug: m.slug }, 60_000).then(() => answer(true), (e) => answer(false, e.message));
  }
}

// ---------- connections: every one goes to the active generation; none is refused while one is coming up
const queue = [];
function dispatch(sock) {
  if (!active?.up || active.exited) { queue.push(sock); sock.queuedAt = Date.now(); return; }
  try { active.child.send({ t: 'conn' }, sock, (err) => { if (err) { queue.push(sock); } }); }
  catch { queue.push(sock); }
}
function flush() { while (queue.length && active?.up && !active.exited) dispatch(queue.shift()); }
// a connection nobody could take within a minute is closed (the keeper never answers HTTP itself)
setInterval(() => { const now = Date.now(); for (let i = queue.length - 1; i >= 0; i--) if (now - queue[i].queuedAt > 60_000) queue.splice(i, 1)[0].destroy(); }, 1000).unref();
const server = createServer({ pauseOnConnect: true }, dispatch);
server.on('error', (e) => { log(`port ${port}: ${e.message}`); process.exit(1); });

// ---------- a crashed active generation is replaced (its orphaned worlds are reaped by the next one)
let crashes = [];
function onGenExit(g) {
  if (stopping) return;
  if (g === active) {
    log(`active generation ${g.n} exited (${g.exited.code ?? g.exited.signal}); starting another`);
    active = null; status.active = null; writeStatus();
    crashes = [...crashes.filter((t) => Date.now() - t < 60_000), Date.now()];
    if (crashes.length > 5) { log('5 crashes in a minute: giving up (systemd restarts the unit)'); process.exit(1); }
    if (handing) return;   // the handover in progress decides what runs next
    setTimeout(() => void startFresh().catch((e) => log(`could not start a generation: ${e.message}`)), 1000 * crashes.length);
  }
}
async function startFresh() {
  const g = spawnGen();
  await withTimeout(g.ready, 120_000, 'generation start');
  activate(g);
}
function activate(g) {
  active = g; status.active = { gen: g.n, build: g.build, pid: g.pid, dir: g.dir, since: new Date().toISOString() }; writeStatus();
  flush();
  log(`generation ${g.n} (${g.build}) serves :${port}`);
}
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what}: no answer in ${ms / 1000}s`)), ms).unref())]);

// ---------- handover (SIGHUP)
let handing = null, again = false;
async function handover() {
  if (stopping) return;
  if (handing) { again = true; log('a handover is in progress; the next one starts after it'); return; }
  if (!active) { log('no active generation: starting one'); await startFresh(); return; }
  const old = active, t0 = Date.now(), h = { state: 'preparing', from: old.build, to: null, startedAt: new Date().toISOString(), worlds: {} };
  handing = { old }; status.handover = h; writeStatus();
  let next = null;
  try {
    const prep = await ask(old, { t: 'prepare' }, 60_000);
    h.adopted = prep.children.map((c) => c.slug); h.state = 'starting';
    next = spawnGen({ SIM_ADOPT: JSON.stringify(prep.children) }); h.to = next.build; writeStatus();
    await withTimeout(next.ready, 120_000, 'new generation start');
  } catch (e) {
    h.state = 'failed'; h.error = e.message; h.endedAt = new Date().toISOString(); h.ms = Date.now() - t0;
    log(`handover failed before the switch (${e.message}); generation ${old.n} serves on`);
    if (next && !next.exited) { next.child.kill('SIGTERM'); await withTimeout(new Promise((r) => next.child.once('exit', r)), 40_000, 'stopping the new generation').catch(() => next.child.kill('SIGKILL')); }
    try { old.child.send({ t: 'resume' }); } catch { /* gone */ }
    handing = null; writeStatus();
    if (old.exited) await startFresh().catch((e2) => log(`could not start a generation: ${e2.message}`));
    if (again) { again = false; void handover(); } return;
  }
  // step 3: the switch
  activate(next); h.switchedAt = Date.now() - t0;
  try { old.child.send({ t: 'retire' }); } catch { /* gone */ }
  h.state = 'taking-over'; writeStatus();
  let canaryFailed = null;
  try {
    const r = await ask(next, { t: 'take-over', canary: CANARY }, 30 * 60_000);
    h.worlds = r.worlds ?? {}; canaryFailed = r.canaryFailed ?? null;
  } catch (e) { h.error = e.message; }
  // canary: the first world could not run on the new release, and nothing else has moved. The old generation serves
  // again (it boots that world on its own code), then the new one goes. No reload, no further world blinks.
  if (canaryFailed && !old.exited) {
    h.state = 'handing-back'; h.canary = canaryFailed; writeStatus();
    try {
      await ask(old, { t: 'unretire', slug: canaryFailed }, 180_000);
      activate(old); h.switchedBackAt = Date.now() - t0;
      // the new generation forwards what it still holds (requests waiting for the canary world) to the old one, then goes
      try { next.child.send({ t: 'retire' }); next.child.send({ t: 'exit' }); } catch { /* gone */ }
      await withTimeout(new Promise((r) => (next.exited ? r() : next.child.once('exit', r))), 45_000, 'new generation exit').catch(() => { log(`generation ${next.n} did not exit; killing it`); next.child.kill('SIGKILL'); });
      h.state = 'rolled-back'; h.endedAt = new Date().toISOString(); h.ms = Date.now() - t0;
      log(`handover ${h.from} → ${h.to}: canary ${canaryFailed} failed (${h.worlds[canaryFailed]?.error ?? '?'}); generation ${old.n} (${old.build}) serves on, in ${h.ms} ms`);
      handing = null; writeStatus();
      if (again) { again = false; void handover(); }
      return;
    } catch (e) { h.error = `hand back: ${e.message}`; log(`could not hand back to generation ${old.n}: ${e.message}`); }
  }
  const failed = Object.entries(h.worlds).filter(([, w]) => !w.ok).map(([s]) => s);
  // step 5: the old generation goes (its worlds are all stopped by now, or reported above)
  if (!old.exited) {
    try { old.child.send({ t: 'exit' }); } catch { /* gone */ }
    await withTimeout(new Promise((r) => (old.exited ? r() : old.child.once('exit', r))), 45_000, 'old generation exit').catch(() => { log(`generation ${old.n} did not exit; killing it`); old.child.kill('SIGKILL'); });
  }
  h.state = failed.length || h.error ? 'failed' : 'done'; if (failed.length) h.failed = failed;
  h.endedAt = new Date().toISOString(); h.ms = Date.now() - t0;
  log(`handover ${h.from} → ${h.to}: ${h.state} in ${h.ms} ms (${Object.entries(h.worlds).map(([s, w]) => `${s} ${w.ok ? `${w.ms} ms` : 'FAILED'}`).join(', ') || 'no running worlds'})`);
  handing = null; writeStatus();
  // the new generation died during the take-over: with the old one gone too, start clean (it reaps any orphan world)
  if (!active && !stopping) await startFresh().catch((e) => log(`could not start a generation: ${e.message}`));
  if (again) { again = false; void handover(); }
}

// ---------- start and stop
async function shutdown(sig, code = 0) {
  if (stopping) return; stopping = true;
  log(`${sig}: stopping ${gens.size} generation(s)`);
  server.close(); for (const s of queue.splice(0)) s.destroy();
  const all = [...gens];
  for (const g of all) { try { g.child.kill('SIGTERM'); } catch { /* gone */ } }
  await withTimeout(Promise.all(all.map((g) => (g.exited ? null : new Promise((r) => g.child.once('exit', r))))), 35_000, 'generations stop').catch(() => { for (const g of all) if (!g.exited) g.child.kill('SIGKILL'); });
  status.active = null; writeStatus();
  process.exit(code);
}
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => void shutdown(sig));
process.on('SIGHUP', () => { log('SIGHUP: handover'); void handover().catch((e) => log(`handover error: ${e.message}`)); });

// systemd socket activation (deploy/sim-worlds@.socket, optional): systemd holds the port across restarts, so a restart
// (or a crash) queues new connections in the socket's backlog instead of refusing them (no Caddy 502 page); they are
// answered once the next keeper is up. LISTEN_FDS=1: fd 3 is our listening socket. Without it, the keeper binds itself.
const activated = process.env.LISTEN_FDS === '1' && (!process.env.LISTEN_PID || Number(process.env.LISTEN_PID) === process.pid);
for (const k of ['LISTEN_FDS', 'LISTEN_PID', 'LISTEN_FDNAMES']) delete process.env[k];   // not for the launcher or the worlds
if (activated) process.env.SIM_PORT_HELD = '1';   // tells each generation it may end its connections gently when it stops
await new Promise((yes) => (activated ? server.listen({ fd: 3 }, yes) : server.listen(port, '127.0.0.1', yes)));
if (activated && server.address()?.port !== port) { log(`the socket from systemd is ${JSON.stringify(server.address())}, not 127.0.0.1:${port}: fix the .socket drop-in`); process.exit(1); }
log(`holding 127.0.0.1:${port}${activated ? ' (socket from systemd)' : ''} (sha ${status.keeper.sha.slice(0, 12)}, data ${dataDir}, releases from ${link})`);
writeStatus();
try { await startFresh(); }
catch (e) { log(`the first generation did not start: ${e.message}`); await shutdown('start failure', 1); }
