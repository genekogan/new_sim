#!/usr/bin/env node
// Capacity bench (server-reliability tranche, lane L6). Metrics and arms are frozen in METRICS.md (v1); read it first.
// One fresh world per (arm, repeat), fake minds only ($0), scripted Souls running the world's own eden.mjs.
//
//   node tools/bench/capacity/bench.mjs --root <sim checkout> --fixture <compact sim.db | genesis:eden-2026> --out <dir>
//        [--arms n1,n6,n12,n24,incident,hostile] [--repeats 2] [--port 5151] [--heap-mb 768] [--host-label laptop]
//        [--slice "systemd-run --scope -p AllowedCPUs=6-7 -p MemoryMax=4G --uid=simworlds --gid=simworlds"]
//        [--world-user simworlds] [--world-key eden-2026] [--world-id <id; default: read from the fixture>] [--short]
//        [--cli <eden.mjs the world serves; default the root's own>]
//        [--via-launcher [--child-range 5154-5155]]   the world runs under the root's own launcher on --port (its proxy and ceilings in
//        the path); the launcher's data dir is <run>/launcher with one worlds.json row for the fixture; heap from the world's live.json
//        when it writes one (no --inspect: the launcher builds the child command), else RSS only; hostile Souls each send their own
//        X-Forwarded-For (the launcher is told it is behind a proxy, as on eden2); the world serves the root's own CLI
//
// Writes <out>/<arm>-r<k>/{result.json,commands.jsonl,world.log}, <out>/receipt.json and <out>/REPORT.md (report.mjs).
// The fixture's per-run copy is deleted after each run; the fixture itself is never written.
import { spawn, execFileSync } from 'node:child_process';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cpus, homedir, loadavg, release, hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { report } from './report.mjs';
const ROOT0 = resolve((() => { const i = process.argv.indexOf('--root'); return i < 0 ? new URL('../../..', import.meta.url).pathname : process.argv[i + 1]; })());
const { defaultCommand } = await import(pathToFileURL(join(ROOT0, 'tools/world-launcher/children.mjs')).href);
const { decorateCommand } = await import(pathToFileURL(join(ROOT0, 'tools/world-launcher/production.mjs')).href);

const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i < 0 ? d : argv[i + 1]; }, flag = (k) => argv.includes(`--${k}`);
const ROOT = resolve(opt('root', new URL('../../..', import.meta.url).pathname)), OUT = resolve(opt('out', 'bench-out'));
const FIXTURE = opt('fixture', 'genesis:eden-2026'), ARMS = opt('arms', 'n1,n6,n12,n24,incident,hostile').split(','), REPEATS = Number(opt('repeats', 2));
const VIA = flag('via-launcher'), CHILD_RANGE = opt('child-range', `${Number(opt('port', 5151)) + 1}-${Number(opt('port', 5151)) + 2}`);
const PORT = Number(opt('port', 5151)), INSPECT = PORT + 1, HEAP_MB = Number(opt('heap-mb', 768)), HOST_LABEL = opt('host-label', 'laptop');
const SLICE = opt('slice', ''), WORLD_USER = opt('world-user', ''), SLUG = opt('world-key', 'eden-2026'), SHORT = flag('short'), ENGINE = opt('engine', 'mars');
const MARS_WEB = opt('mars-web', join(ROOT, 'mars/viewer/dist'));
const CLI_FILE = resolve(opt('cli', join(ROOT, 'tools/world-launcher/soul/eden.mjs')));
if (VIA && CLI_FILE !== resolve(join(ROOT, 'tools/world-launcher/soul/eden.mjs'))) throw new Error('--via-launcher: the launcher serves its own root\'s eden.mjs; drop --cli');
if (VIA && SLICE) throw new Error('--via-launcher with --slice is not built yet (the slice would wrap the launcher, not the world)');
const PH = SHORT ? { warm: 10, idle: 10, active: 20, calib: 5 } : { warm: 60, idle: 30, active: 120, calib: 20 };
const TICK_HZ = 20, BUSY = /\b(world\.busy|world\.crowded|world\.starting|soul\.busy|soul\.slow-down|rate-limited)\b/;
const TARGETS = ['the bandstand', 'the commons', 'the pond', 'the classroom', 'the orchard', 'the kitchen', 'the garden', 'the plaza'];
const SEARCH = ['bench', 'seat', 'door', 'book', 'table'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();
const pick = (a) => a[Math.floor(Math.random() * a.length)];
mkdirSync(OUT, { recursive: true });
const log = (...a) => { const s = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`; console.log(s); appendFileSync(join(OUT, 'bench.log'), s + '\n'); };

// ------------------------------------------------------------------ host facts and fixture
const sh = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
const sha256File = (p) => new Promise((res, rej) => { const h = createHash('sha256'); createReadStream(p).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });
const genesis = FIXTURE.startsWith('genesis:') ? join(ROOT, 'worlds/templates', `${FIXTURE.slice(8)}.json`) : null;
const fixtureFile = genesis ?? resolve(FIXTURE);
if (!existsSync(fixtureFile)) throw new Error(`no fixture at ${fixtureFile}`);
function worldIdOf(db) {   // the most common world_id in the fixture (a compact copy keeps the live world's id)
  const py = "import sqlite3,sys,collections\nc=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True);n=collections.Counter()\nfor (t,) in c.execute(\"select name from sqlite_master where type='table'\"):\n  cols=[r[1] for r in c.execute(f'pragma table_info(\"{t}\")')]\n  if 'world_id' in cols:\n    for (w,k) in c.execute(f'select world_id,count(*) from \"{t}\" group by world_id'): n[w]+=k\nprint(n.most_common(1)[0][0] if n else '')";
  return sh('python3', ['-c', py, db]) || null;
}
const WORLD_ID = opt('world-id', genesis ? `${SLUG}-bench` : worldIdOf(fixtureFile));
if (VIA && WORLD_ID !== `${SLUG}-1`) throw new Error(`--via-launcher: the launcher names the world ${SLUG}-1 but the fixture's world is ${WORLD_ID}`);
const BASE = `http://127.0.0.1:${PORT}/w/${SLUG}`;
const host = {
  label: HOST_LABEL, indicative: HOST_LABEL !== 'eden2-slice', hostname: hostname(), cpu: cpus()[0]?.model, cores: cpus().length, kernel: release(), node: process.version,
  slice: SLICE || null, heapMb: HEAP_MB, sourceSha: sh('git', ['-C', ROOT, 'rev-parse', 'HEAD']), sourceDirty: !!sh('git', ['-C', ROOT, 'status', '--porcelain', '--untracked-files=no']),
  benchSha: sh('git', ['-C', new URL('.', import.meta.url).pathname, 'rev-parse', 'HEAD']),
  cli: CLI_FILE, cliSha256: await sha256File(CLI_FILE), cliVersion: /const VERSION = "([^"]+)"/.exec(readFileSync(CLI_FILE, 'utf8'))?.[1] ?? null,
  fixture: FIXTURE, fixtureSha256: await sha256File(fixtureFile), worldId: WORLD_ID, worldKey: SLUG, engine: ENGINE, phases: PH,
  viaLauncher: VIA ? { port: PORT, childRange: CHILD_RANGE, publicOrigin: `http://localhost:${PORT}` } : null,
};

// ------------------------------------------------------------------ the world process
const CLK_TCK = Number(sh('getconf', ['CLK_TCK']) ?? 100) || 100;
function procStats(pid) {   // {cpuS, rssMb}
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
    const rss = /VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
    return { cpuS: (Number(stat[11]) + Number(stat[12])) / CLK_TCK, rssMb: rss ? Number(rss[1]) / 1024 : null };
  } catch {
    const out = sh('ps', ['-o', 'time=,rss=', '-p', String(pid)]); if (!out) return null;
    const [t, rss] = out.trim().split(/\s+/), parts = t.split(':').map(Number);
    const cpuS = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
    return { cpuS, rssMb: Number(rss) / 1024 };
  }
}
async function inspector() {   // Runtime.getHeapUsage only
  const list = await (await fetch(`http://127.0.0.1:${INSPECT}/json/list`)).json();
  const ws = new WebSocket(list[0].webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const wait = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
  const call = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (wait.delete(i)) r(null); }, 5000); });
  return { heapMb: async () => { const d = await call('Runtime.getHeapUsage'); return d?.result ? d.result.usedSize / 2 ** 20 : null; }, close: () => ws.close() };
}

async function bootWorld(dir, opts = {}) { return VIA ? bootLauncher(dir, opts) : bootDirect(dir, opts); }
async function bootDirect(dir, { settle = true } = {}) {
  const data = join(dir, 'data'); mkdirSync(data, { recursive: true });
  if (!genesis) copyFileSync(fixtureFile, join(data, 'sim.db'));
  if (WORLD_USER) sh('chown', ['-R', `${WORLD_USER}:${WORLD_USER}`, dir]);
  // the launcher's own world command and production decoration, from the checkout under test (never a hand-made env):
  // ENGINE, ENABLE_WORLD_ENGINE, SOUL_LIFECYCLE, fading, unwatched pace, malloc env, fake brain, no model keys
  const soul = (f) => join(ROOT, 'tools/world-launcher/soul', f);
  // GENESIS_FILE as on the live world (the template of the same key), library dir in the run's scratch
  const template = genesis ?? (existsSync(join(ROOT, 'worlds/templates', `${SLUG}.json`)) ? join(ROOT, 'worlds/templates', `${SLUG}.json`) : undefined);
  const library = join(dir, 'library'); mkdirSync(library, { recursive: true });
  const base = defaultCommand({ slug: SLUG, dataDir: data, name: 'Capacity bench', ...(template ? { templateFile: template } : {}) }, PORT,
    { publicOrigin: `http://127.0.0.1:${PORT}`, marsWebDir: MARS_WEB, root: ROOT, libraryDir: library, soulControllerCliFile: CLI_FILE, soulCliFile: soul('eden-agent.mjs'), soulSkillFile: soul('skill.md'), soulInstructionsFile: soul('instructions.md') });
  const { cmd: node, args, env } = decorateCommand(base, { devAuth: true, publicOrigin: `http://127.0.0.1:${PORT}`, base: '', worldHeapMb: HEAP_MB, build: 'dev' });
  if (WORLD_ID) env.WORLD_ID = WORLD_ID;
  Object.assign(env, { MIND_DRIVER: 'edge', BRAIN_MODE: 'fake' });
  for (const k of Object.keys(env)) if (k.startsWith('EDGE_EYES')) delete env[k];   // no renders in the bench (Eyes off)
  const cmd = [...(SLICE ? SLICE.split(/\s+/) : []), node, `--inspect=127.0.0.1:${INSPECT}`, ...args];
  writeFileSync(join(dir, 'world-command.json'), JSON.stringify({ cmd, env: Object.fromEntries(Object.entries(env).filter(([k]) => !/KEY|TOKEN|SECRET/.test(k))) }, null, 1));
  const child = spawn(cmd[0], cmd.slice(1), { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let wlog = ''; const wl = (b) => { wlog = (wlog + b).slice(-20000); appendFileSync(join(dir, 'world.log'), b); };
  child.stdout.on('data', wl); child.stderr.on('data', wl);
  const t0 = now(); let up = false;
  while (!up && now() - t0 < 900_000) { if (child.exitCode != null) throw new Error(`world exited at boot (${child.exitCode}); ${dir}/world.log ends:\n${wlog.trim().split('\n').slice(-12).join('\n')}`); up = (await healthz()).ok; if (!up) await sleep(1000); }
  if (!up) throw new Error('world did not answer /healthz in 15 min');
  const bootS = (now() - t0) / 1000, tc = now();
  await settleWorld(() => wlog, settle, tc);
  const pids = (sh('pgrep', ['-f', `inspect=127.0.0.1:${INSPECT}`]) ?? '').split('\n').map(Number).filter(Boolean);
  const pid = pids.find((x) => /node/.test(sh('ps', ['-o', 'comm=', '-p', String(x)]) ?? '')) ?? child.pid;   // the node process, not systemd-run
  return { child, pid, data, bootS, catchUpS: (now() - tc) / 1000 };
}
// settled = the boot's perceive catch-up logged, or (it logs only when slow) 30 s up with three calm ticks; cap 300 s
async function settleWorld(wlog, settle, tc) {
  for (let calm = 0; settle && !/perceive catch-up/.test(wlog()) && now() - tc < 300_000 && !(now() - tc > 30_000 && calm >= 3); ) { await sleep(1000); const x = await healthz(); calm = x.ok && x.tickMs?.avg < 25 ? calm + 1 : 0; }
}
// --via-launcher: the root's own launcher (its proxy, flood guard and, from R1, the Soul API ceilings) in front of the world
async function bootLauncher(dir, { settle = true } = {}) {
  const ldata = join(dir, 'launcher'), data = join(ldata, 'worlds', SLUG); mkdirSync(data, { recursive: true });
  if (!genesis) copyFileSync(fixtureFile, join(data, 'sim.db'));
  const template = genesis ? FIXTURE.slice(8) : existsSync(join(ROOT, 'worlds/templates', `${SLUG}.json`)) ? SLUG : 'empty';
  writeFileSync(join(ldata, 'worlds.json'), JSON.stringify({ schema: 'world-launcher-registry/1', worlds: [{ slug: SLUG, name: 'Capacity bench', template, port: null, createdAt: Date.now(), unlisted: true, worldHeapMb: HEAP_MB }] }, null, 2) + '\n');
  const args = [join(ROOT, 'tools/world-launcher/launcher.mjs'), '--port', String(PORT), '--data', ldata, '--range', CHILD_RANGE, '--public-origin', `http://localhost:${PORT}`,
    '--world-heap-mb', String(HEAP_MB), '--mars-web', MARS_WEB, '--eager', '1'];
  // the launcher's environment: no Eyes, no handover pre-warm (one world, one port pair); children never inherit the rest
  const env = { ...process.env, SIM_PREWARM: '0' }; for (const k of Object.keys(env)) if (k.startsWith('EDGE_EYES') || /KEY|TOKEN|SECRET/.test(k)) delete env[k];
  writeFileSync(join(dir, 'world-command.json'), JSON.stringify({ launcher: [process.execPath, ...args], registry: JSON.parse(readFileSync(join(ldata, 'worlds.json'), 'utf8')) }, null, 1));
  const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let llog = ''; const ll = (b) => { llog = (llog + b).slice(-20000); appendFileSync(join(dir, 'launcher.log'), b); };
  child.stdout.on('data', ll); child.stderr.on('data', ll);
  const wlogFile = join(ldata, 'logs', `${SLUG}.log`), wlog = () => { try { return readFileSync(wlogFile, 'utf8').slice(-20000); } catch { return ''; } };
  const t0 = now(); let up = false;
  while (!up && now() - t0 < 900_000) { if (child.exitCode != null) throw new Error(`launcher exited at boot (${child.exitCode}); ${dir}/launcher.log ends:\n${llog.trim().split('\n').slice(-12).join('\n')}`); up = (await healthz()).ok; if (!up) await sleep(1000); }
  if (!up) throw new Error(`world did not answer /healthz through the launcher in 15 min; ${wlogFile}`);
  const bootS = (now() - t0) / 1000, tc = now();
  await settleWorld(wlog, settle, tc);
  const w = { child, launcherPid: child.pid, data, ldata, wlogFile, bootS, catchUpS: (now() - tc) / 1000 };
  Object.defineProperty(w, 'pid', { get: () => worldPid(ldata) ?? child.pid });   // the world's node process; a restart changes it
  return w;
}
function worldPid(ldata) { try { return JSON.parse(readFileSync(join(ldata, 'children.json'), 'utf8'))[SLUG]?.pid ?? null; } catch { return null; } }
function liveHeapMb(w) {   // LOAD-CONTRACT §4 live.json (a world that writes one); fresh within 10 s, else null
  try { const v = JSON.parse(readFileSync(join(w.data, 'live.json'), 'utf8')); const at = v.at > 1e12 ? v.at : v.at * 1000; return now() - at < 10_000 && Number.isFinite(v.heap?.usedMb) ? v.heap.usedMb : null; } catch { return null; }
}
async function launcherView() {   // the launcher's health page JSON for this world (limits, refusal counts, restarts), loopback
  try { const d = await (await fetch(`http://127.0.0.1:${PORT}/__sim/health?json=1`, { signal: AbortSignal.timeout(5000) })).json(); const x = (d.worlds ?? []).find((y) => y.slug === SLUG) ?? null;
    return x ? { status: x.status, restarts: x.restarts, limits: x.limits ?? null, refused: x.refused ?? null, lastExit: x.lastExit ?? null } : null; } catch { return null; }
}
async function stopWorld(w) {
  if (w.launcherPid) {   // the launcher stops its world; the world is killed by pid only if it outlives the launcher
    const wp = worldPid(w.ldata);
    try { process.kill(w.launcherPid, 'SIGTERM'); } catch { /* gone */ }
    for (let i = 0; i < 60 && w.child.exitCode == null; i++) await sleep(500);
    if (w.child.exitCode == null) try { process.kill(w.launcherPid, 'SIGKILL'); } catch { /* gone */ }
    if (wp) { for (let i = 0; i < 20; i++) { try { process.kill(wp, 0); } catch { break; } await sleep(500); } try { process.kill(wp, 'SIGKILL'); } catch { /* gone */ } }
    const trash = join(homedir(), '.Trash', 'eden-cleanup-20261020'); mkdirSync(trash, { recursive: true });
    try { renameSync(join(w.ldata, 'worlds'), join(trash, `bench-${Date.now()}-worlds`)); } catch { sh('mv', [join(w.ldata, 'worlds'), join(trash, `bench-${Date.now()}-worlds`)]); }
    return;
  }
  try { process.kill(w.pid, 'SIGTERM'); } catch { /* gone */ }
  for (let i = 0; i < 40 && w.child.exitCode == null; i++) await sleep(500);
  if (w.child.exitCode == null) try { process.kill(w.pid, 'SIGKILL'); } catch { /* gone */ }
  // the per-run fixture copy goes (moved to the trash dir beside it, per the no-rm rule; R empties it)
  const trash = join(homedir(), '.Trash', 'eden-cleanup-20261020'); mkdirSync(trash, { recursive: true });
  try { renameSync(w.data, join(trash, `bench-${Date.now()}-data`)); } catch { sh('mv', [w.data, join(trash, `bench-${Date.now()}-data`)]); }
}
async function healthz(timeoutMs = 5000) {
  const t = now();
  try { const r = await fetch(`${BASE}/healthz`, { signal: AbortSignal.timeout(timeoutMs) }); const d = r.ok ? await r.json() : null; return { ok: !!d, ms: now() - t, tick: d?.tick, tickMs: d?.tickMs }; }
  catch { return { ok: false, ms: timeoutMs, tick: null }; }
}

// ------------------------------------------------------------------ scripted Souls
const CLASS = { here: 'C2', observe: 'C2', caps: 'C2', resolve: 'C2', around: 'C2', act: 'C1', say: 'C1', listen: 'C0' };
function runCli(soul, args, deadlineMs, rec) {
  return new Promise((done) => {
    const t = now(), p = spawn(process.execPath, ['eden.mjs', ...args], { cwd: soul.dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '', killed = false; p.stderr.on('data', (d) => { err = (err + d).slice(-2000); }); p.stdout.resume();
    const k = setTimeout(() => { killed = true; p.kill('SIGKILL'); }, deadlineMs);
    p.on('exit', (code) => {
      clearTimeout(k);
      const outcome = killed ? 'timeout' : code === 0 ? 'ok' : /unreachable/.test(err) ? 'unreachable' : BUSY.test(err) ? 'refused' : 'error';
      const r = { soul: soul.i, cmd: args[0], cls: CLASS[args[0]] ?? 'C0', at: t, ms: now() - t, code, outcome, ...(outcome === 'error' ? { err: err.trim().split('\n').at(-1)?.slice(0, 200) } : {}) };
      rec?.(r); done(r);
    });
  });
}
async function join_(run, i) {
  const dir = join(run.dir, 'souls', `s${i}`); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'eden.mjs'), Buffer.from(await (await fetch(`${BASE}/eden.mjs`)).arrayBuffer()));
  const soul = { i, dir };
  const a = await runCli(soul, ['register', BASE], 60_000), b = await runCli(soul, ['create', `Bench${i}`], 120_000);
  if (b.outcome !== 'ok') throw new Error(`soul ${i} create: ${b.outcome} ${b.err ?? ''} (${a.outcome})`);
  soul.token = JSON.parse(readFileSync(join(dir, '.eden-agent.json'), 'utf8')).token;
  return soul;
}
const MINUTE = ['here', 'observe', 'here', 'observe', 'here', 'observe', 'caps', 'caps', 'resolve', 'resolve', 'around', 'act', 'act', 'say'];
function argsFor(op, n) {
  if (op === 'caps') return ['caps', '--search', pick(SEARCH)];
  if (op === 'resolve') return ['resolve', pick(TARGETS)];
  if (op === 'act') return n % 3 === 2 ? ['act', 'sit down'] : ['act', `go to ${pick(TARGETS)}`];
  if (op === 'say') return ['say', 'hello from the capacity bench'];
  return [op];
}
// the old user script tonight: up to 6 tries, 15 s apart, on any non-zero exit
async function oldWrapper(soul, args, deadline, rec, stop) {
  for (let i = 0; i < 6; i++) { const r = await runCli(soul, args, deadline, rec); if (r.code === 0 || stop()) return r; await sleep(15_000); }
}
function soulLoop(run, soul, wrap) {
  let n = 0;
  return (async () => {
    while (!run.stopped) {
      const plan = [...MINUTE].sort(() => Math.random() - 0.5), gap = 60_000 / plan.length;
      for (const op of plan) {
        if (run.stopped) return;
        const t = now(), args = argsFor(op, n++), deadline = CLASS[op] === 'C1' ? 90_000 : 60_000;
        if (run.mode !== 'idle') await (wrap ? oldWrapper(soul, args, deadline, run.rec, () => run.stopped) : runCli(soul, args, deadline, run.rec));
        await sleep(Math.max(0, gap * (0.7 + 0.6 * Math.random()) - (now() - t)));
      }
    }
  })();
}
function holdListen(run, soul) {   // the harness keeps one listen per Soul; restarts it 1 s after it exits
  soul.listens = 0;
  const start = () => {
    if (run.stopped) return;
    const p = spawn(process.execPath, ['eden.mjs', 'listen'], { cwd: soul.dir, stdio: ['ignore', 'ignore', 'pipe'] });
    // M9 counts a listen once it has stayed up 3 s (holding a long-poll), not one that exits at once ("already listening")
    let counted = false; const c = setTimeout(() => { counted = true; soul.listens++; run.maxListens[soul.i] = Math.max(run.maxListens[soul.i] ?? 0, soul.listens); }, 3000);
    run.procs.add(p);
    let err = ''; p.stderr.on('data', (d) => { err = (err + d).slice(-500); });
    p.on('exit', (code) => { clearTimeout(c); if (counted) soul.listens--; run.procs.delete(p); run.listenExits.push({ soul: soul.i, code, superseded: /superseded/.test(err), already: /already listening/.test(err) }); if (p === soul.held) setTimeout(() => { if (!run.stopped) soul.held = start(); }, 1000); });
    return p;
  };
  soul.held = start();
  return start;   // the incident arm calls this to relaunch without stopping the old one
}
function waitStream(run, soul) {   // C0 long-poll, in-process (no CLI process per Soul)
  (async () => {
    let cursor = 'c_0';
    while (!run.stopped) {
      try { const r = await fetch(`${BASE}/v1/edge/wait?timeout=55&after=${encodeURIComponent(cursor)}`, { headers: { authorization: `Bearer ${soul.token}` }, signal: AbortSignal.timeout(65_000) }); const d = await r.json().catch(() => ({})); cursor = d.cursor ?? cursor; if (!r.ok) await sleep(5000); }
      catch { await sleep(5000); }
    }
  })();
}
function viewer(run, hello) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/w/${SLUG}/ws`);
  ws.onopen = () => { try { ws.send(hello); } catch { /* closed */ } };
  ws.onmessage = (m) => { run.wsBytes += typeof m.data === 'string' ? m.data.length : m.data.byteLength ?? 0; };
  ws.onclose = () => { if (!run.stopped) setTimeout(() => viewer(run, hello), 2000 * (0.5 + Math.random())); };
  run.sockets.push(ws);
}
function hostile(run, soul) {   // 4 parallel loops that ignore Retry-After and retry at once
  const H = { authorization: `Bearer ${soul.token}`, ...(VIA ? { 'x-forwarded-for': `10.66.0.${soul.i + 1}` } : {}) };   // via the launcher: one address per hostile Soul
  const reqs = [
    () => fetch(`${BASE}/v1/edge/here?include=doHere`, { headers: H, signal: AbortSignal.timeout(30_000) }),
    () => fetch(`${BASE}/v1/edge/capabilities`, { headers: H, signal: AbortSignal.timeout(30_000) }),
    () => fetch(`${BASE}/v1/edge/act`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ capability: `go to ${pick(TARGETS)}` }), signal: AbortSignal.timeout(30_000) }),
    () => fetch(`${BASE}/v1/edge/say`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hostile bench' }), signal: AbortSignal.timeout(30_000) }),
  ];
  for (let k = 0; k < 4; k++) (async () => {
    let j = k;
    while (!run.stopped) {
      if (run.mode === 'idle') { await sleep(200); continue; }
      const t = now();
      try { const r = await reqs[j++ % 4](); const d = await r.json().catch(() => ({})); const code = d?.error?.code ?? d?.code;
        run.hostile[r.ok ? 'ok' : (r.status === 429 || r.status === 503) && BUSY.test(String(code)) ? 'refused' : r.status >= 500 ? 'error5xx' : 'other4xx']++; }
      catch { run.hostile.failed++; }
      run.hostile.ms.push(now() - t);
      await new Promise((r) => setImmediate(r));
    }
  })();
}

// ------------------------------------------------------------------ one run
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
async function oneRun(arm, rep) {
  const dir = join(OUT, `${arm}-r${rep}`); mkdirSync(dir, { recursive: true });
  const N = arm.startsWith('n') ? Number(arm.slice(1)) : 6, hello = await helloText();
  const run = { dir, stopped: false, mode: 'join', procs: new Set(), sockets: [], wsBytes: 0, maxListens: {}, listenExits: [], hostile: { ok: 0, refused: 0, error5xx: 0, other4xx: 0, failed: 0, ms: [] }, rec: null };
  const cmds = [], health = [], heap = [], proc = [];
  const loadBefore = loadavg();
  log(`${arm} r${rep}: boot`);
  const w = await bootWorld(dir);
  log(`${arm} r${rep}: up ${w.bootS.toFixed(1)} s, catch-up ${w.catchUpS.toFixed(1)} s, pid ${w.pid}`);
  const insp = VIA ? null : await inspector().catch(() => null);
  let phase = 'join';
  run.rec = (r) => { r.phase = phase; cmds.push(r); appendFileSync(join(dir, 'commands.jsonl'), JSON.stringify(r) + '\n'); };
  const sampler = setInterval(async () => { const h = await healthz(); health.push({ at: now(), phase, ...h }); }, 1000);
  const sampler2 = setInterval(async () => { const p = procStats(w.pid), hm = insp ? await insp.heapMb() : VIA ? liveHeapMb(w) : null, lp = w.launcherPid ? procStats(w.launcherPid) : null;
    proc.push({ at: now(), phase, ...p, heapMb: hm, ...(lp ? { launcherCpuS: lp.cpuS, launcherRssMb: lp.rssMb } : {}) }); }, 2000);
  const souls = [];
  try {
    for (let i = 0; i < N; i++) souls.push(await join_(run, i));
    log(`${arm} r${rep}: ${N} Souls joined`);
    const relaunch = souls.map((s) => holdListen(run, s));
    for (const s of souls) { waitStream(run, s); viewer(run, hello); }
    run.mode = 'idle'; const loops = souls.map((s) => soulLoop(run, s, arm === 'incident'));
    const relauncher = arm === 'incident' ? setInterval(() => { for (let i = 0; i < 3; i++) relaunch[i](); }, 20_000) : null;
    const window = async (name, s, mode) => { phase = name; run.mode = mode; const t = now(); await sleep(s * 1000); return { name, from: t, to: now() }; };
    // warm-up (load on), idle (load off), then two active windows
    run.mode = 'active'; if (arm === 'hostile') for (const s of souls) hostile(run, s);
    const windows = [await window('warm', PH.warm, 'active'), await window('idle', PH.idle, 'idle'), await window('activeA', PH.active, 'active'), await window('activeB', PH.active, 'active')];
    if (relauncher) clearInterval(relauncher);
    run.stopped = true; phase = 'drain';
    await Promise.race([Promise.all(loops), sleep(20_000)]);
    let calibration = null;
    if (arm === 'n1') calibration = await calibrate(souls[0], w, proc, windows.find((x) => x.name === 'idle'), (p) => { phase = p; });
    const result = summarize({ arm, rep, N, w, windows, cmds, health, proc, run, calibration, loadBefore, loadAfter: loadavg() });
    if (VIA) result.launcher = await launcherView();
    writeFileSync(join(dir, 'result.json'), JSON.stringify(result, null, 1));
    log(`${arm} r${rep}: ${JSON.stringify(result.headline)}`);
    return result;
  } finally {
    run.stopped = true; clearInterval(sampler); clearInterval(sampler2); insp?.close();
    for (const p of run.procs) try { p.kill('SIGTERM'); } catch { /* gone */ }
    for (const s of run.sockets) try { s.close(); } catch { /* closed */ }
    await stopWorld(w);
  }
}
async function helloText() {
  try { const { anonymousHello } = await import(pathToFileURL(join(ROOT, 'packages/client/src/hello.ts')).href); return anonymousHello(false); }
  catch { return JSON.stringify({ t: 'hello' }); }
}
async function calibrate(soul, w, proc, idleWin, setPhase) {   // M7: CPU-s per request class, 20 serial requests each, one Soul
  const idle = proc.filter((p) => p.at >= idleWin.from && p.at <= idleWin.to && p.cpuS != null);
  const idleRate = idle.length > 1 ? (idle.at(-1).cpuS - idle[0].cpuS) / ((idle.at(-1).at - idle[0].at) / 1000) : 0;
  const out = { idleCpuSPerS: idleRate };
  for (const op of ['here', 'observe', 'caps', 'resolve', 'around', 'act', 'say']) {
    setPhase(`calib-${op}`);
    const a = procStats(w.pid), t = now(), ms = [];
    for (let i = 0; i < PH.calib; i++) ms.push((await runCli(soul, argsFor(op, i), 60_000)).ms);
    const b = procStats(w.pid), el = (now() - t) / 1000;
    out[op] = { cpuSPerReq: +(((b.cpuS - a.cpuS) - idleRate * el) / PH.calib).toFixed(4), p50Ms: pct(ms, 0.5) };
  }
  return out;
}
function summarize({ arm, rep, N, w, windows, cmds, health, proc, run, calibration, loadBefore, loadAfter }) {
  const win = (name) => windows.find((x) => x.name === name), inW = (x, wd) => x.at >= wd.from && x.at <= wd.to;
  const perWindow = {};
  for (const name of ['idle', 'activeA', 'activeB']) {
    const wd = win(name), h = health.filter((x) => inW(x, wd)), hk = h.filter((x) => x.ok && x.tick != null), p = proc.filter((x) => inW(x, wd) && x.cpuS != null);
    const c = cmds.filter((x) => inW(x, wd)), C1 = c.filter((x) => x.cls === 'C1' && x.outcome !== 'timeout'), C2 = c.filter((x) => x.cls === 'C2' && x.outcome !== 'timeout');
    const secs = (wd.to - wd.from) / 1000, ticks = hk.length > 1 ? hk.at(-1).tick - hk[0].tick : null, tspan = hk.length > 1 ? (hk.at(-1).at - hk[0].at) / 1000 : null;
    const outcomes = {}; for (const x of c) { outcomes[x.cls] ??= {}; outcomes[x.cls][x.outcome] = (outcomes[x.cls][x.outcome] ?? 0) + 1; }
    perWindow[name] = {
      seconds: secs, tickService: ticks != null ? +(ticks / (tspan * TICK_HZ)).toFixed(3) : null,
      healthzP99Ms: pct(h.map((x) => x.ms), 0.99), healthzWithin1s: h.length ? +(h.filter((x) => x.ok && x.ms <= 1000).length / h.length).toFixed(3) : null,
      actP99Ms: pct(C1.map((x) => x.ms), 0.99), readP99Ms: pct(C2.map((x) => x.ms), 0.99), actP50Ms: pct(C1.map((x) => x.ms), 0.5), readP50Ms: pct(C2.map((x) => x.ms), 0.5),
      cpuSPerS: p.length > 1 ? +((p.at(-1).cpuS - p[0].cpuS) / ((p.at(-1).at - p[0].at) / 1000)).toFixed(3) : null,
      ...(p.length > 1 && p[0].launcherCpuS != null ? { launcherCpuSPerS: +((p.at(-1).launcherCpuS - p[0].launcherCpuS) / ((p.at(-1).at - p[0].at) / 1000)).toFixed(3) } : {}),
      rssMbMean: p.length ? +(p.reduce((s, x) => s + x.rssMb, 0) / p.length).toFixed(1) : null,
      heapMbMean: p.filter((x) => x.heapMb != null).length ? +(p.filter((x) => x.heapMb != null).reduce((s, x) => s + x.heapMb, 0) / p.filter((x) => x.heapMb != null).length).toFixed(1) : null,
      commands: c.length, outcomes,
    };
  }
  // M5 wedge: longest span after boot with no healthz answer
  let gap = 0, last = health[0]?.at ?? 0; for (const h of health) { if (h.ok) { gap = Math.max(gap, h.at - last); last = h.at; } } gap = Math.max(gap, (health.at(-1)?.at ?? last) - last);
  const heapPeak = Math.max(0, ...proc.map((x) => x.heapMb ?? 0)), rssPeak = Math.max(0, ...proc.map((x) => x.rssMb ?? 0));
  const worse = (k, hi) => { const a = perWindow.activeA[k], b = perWindow.activeB[k]; if (a == null) return b; if (b == null) return a; return hi ? Math.max(a, b) : Math.min(a, b); };
  const all = cmds.filter((x) => x.phase !== 'join'), timeouts = all.filter((x) => x.outcome === 'timeout').length;
  const headline = { N, tickService: worse('tickService', false), healthzP99Ms: worse('healthzP99Ms', true), actP99Ms: worse('actP99Ms', true), readP99Ms: worse('readP99Ms', true),
    heapPeakMb: +heapPeak.toFixed(1), heapPeakPctCap: +(100 * heapPeak / HEAP_MB).toFixed(1), rssPeakMb: +rssPeak.toFixed(1), wedge: gap >= 30_000, longestHealthzGapS: +(gap / 1000).toFixed(1),
    timeouts, idleCpuSPerS: perWindow.idle.cpuSPerS, activeCpuSPerS: worse('cpuSPerS', true), idleRssMb: perWindow.idle.rssMbMean, idleHeapMb: perWindow.idle.heapMbMean,
    maxListenersPerSoul: Math.max(0, ...Object.values(run.maxListens)), listenSuperseded: run.listenExits.filter((x) => x.superseded).length, listenAlready: run.listenExits.filter((x) => x.already).length };
  const h = run.hostile; const hostile = arm === 'hostile' ? { ok: h.ok, refused: h.refused, error5xx: h.error5xx, other4xx: h.other4xx, failed: h.failed, requests: h.ms.length, p99Ms: pct(h.ms, 0.99) } : undefined;
  return { arm, rep, N, bootS: w.bootS, catchUpS: w.catchUpS, headline, windows: perWindow, ...(hostile ? { hostile } : {}), ...(calibration ? { calibration } : {}), wsBytes: run.wsBytes, loadBefore, loadAfter };
}

// ------------------------------------------------------------------ main
const startup = []; for (let i = 0; i < 10; i++) { const t = now(); execFileSync(process.execPath, [CLI_FILE, 'version'], { stdio: 'ignore' }); startup.push(now() - t); }
host.cliStartupMedianMs = pct(startup, 0.5);
log(`bench: ${ARMS.join(',')} x${REPEATS} on ${HOST_LABEL}${host.indicative ? ' (INDICATIVE)' : ''}, source ${host.sourceSha?.slice(0, 9)}, fixture ${host.fixtureSha256.slice(0, 12)}, world ${WORLD_ID}`);
// preflight: boot the fixture once, 10 s up and answering, so a bad setup fails in seconds, not after every arm
{
  const dir = join(OUT, 'preflight'); mkdirSync(dir, { recursive: true });
  let w;
  try {
    const t = now(); w = await bootWorld(dir, { settle: false }); await sleep(10_000);
    const h = await healthz(); if (!h.ok || w.child.exitCode != null) throw new Error(`world not answering 10 s after boot; ${dir}/world.log`);
    log(`preflight ok: up ${w.bootS.toFixed(1)} s, tick ${h.tick}, ${((now() - t) / 1000).toFixed(0)} s`);
  } catch (e) { log(`PREFLIGHT FAILED: ${e.message}`); if (w) await stopWorld(w); process.exit(1); }
  await stopWorld(w);
}
const results = [];
for (let rep = 1; rep <= REPEATS; rep++) for (const arm of ARMS) {
  try { results.push(await oneRun(arm, rep)); } catch (e) { log(`${arm} r${rep}: FAILED ${e.message}`); results.push({ arm, rep, failed: String(e.message) }); }
}
const receipt = { v: 1, metrics: 'tools/bench/capacity/METRICS.md v1', at: new Date().toISOString(), host, arms: ARMS, repeats: REPEATS, results: results.map((r) => ({ arm: r.arm, rep: r.rep, failed: r.failed, headline: r.headline })) };
writeFileSync(join(OUT, 'receipt.json'), JSON.stringify(receipt, null, 1));
writeFileSync(join(OUT, 'REPORT.md'), report(receipt, results));
log(`done: ${join(OUT, 'REPORT.md')}`);
process.exit(0);
