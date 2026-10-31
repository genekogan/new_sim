// A stand-in world for the launcher's tests: answers the few routes the launcher
// touches (healthz, god status), streams SSE, and echoes a raw WebSocket-style
// upgrade. Not a Sim server; never used outside tests.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getHeapStatistics } from 'node:v8';
import { Worker } from 'node:worker_threads';
const slug = process.env.WORLD_KEY, port = Number(process.env.PORT);
const base = process.env.WORLD_PATH ?? `/w/${slug}`;
const server = createServer((req, res) => {
  const path = req.url.startsWith(base) ? req.url.slice(base.length) || '/' : req.url;
  res.setHeader('x-sim-load', LEVELS[L[3]] ?? 'green');   // LOAD-CONTRACT §3 (set with /level?l=red)
  if (process.env.FAKE_HITS) appendFileSync(process.env.FAKE_HITS, `${path}\n`);   // which requests reached the world
  if (path === '/healthz') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, worldId: `${slug}-1`, genesis: process.env.GENESIS_FILE ?? null, pid: process.pid, ...(process.env.FAKE_TICK_MS ? { tickMs: { avg: Number(process.env.FAKE_TICK_MS), max: 2 * Number(process.env.FAKE_TICK_MS), n: 400 }, clockRate: 1 } : {}) }));
  if (path === '/argv') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ execArgv: process.execArgv, heapMb: process.env.SIM_WORLD_HEAP_MB ?? null, nodeOptions: process.env.NODE_OPTIONS ?? null, limitMb: Math.round(getHeapStatistics().heap_size_limit / 2 ** 20) }));
  if (path === '/v1/world/snapshot') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ tick: Date.now(), slug }));
  if (path === '/v1/edge/inbox/listen') { const t = setTimeout(() => res.end('{"items":[]}'), 30_000); req.on('close', () => clearTimeout(t)); return; }   // a long-poll
  if (path === '/v1/config') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ worldId: `${slug}-1`, worldKey: slug }));
  if (path === '/v1/god/status') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ worldId: `${slug}-1`, hasOwner: false, you: 'anonymous', pending: [], entities: 3, seq: 1 }));
  if (path === '/v1/god/edits?limit=1') return req.headers.authorization === 'Bearer god_ok' ? res.writeHead(200).end('{"edits":[]}') : res.writeHead(401).end('{}');
  if (path === '/v1/god/preview' && req.method === 'POST') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'pv_test', accepted: true, summary: { upserts: 1 } }));
  if ((path === '/v1/god/claim' || path === '/v1/god/mint' || path === '/v1/god/pair/approve') && req.method === 'POST') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, claimedBy: req.headers.authorization ?? null }));
  // dev sign-in stand-in: "Bearer dev:<name>" is the account dev:<name>
  if (path === '/v1/me') { const id = /^Bearer (dev:[a-z0-9_-]+)$/i.exec(req.headers.authorization ?? '')?.[1]; return id ? res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ me: { userId: id } })) : res.writeHead(401, { 'content-type': 'application/json' }).end('{"ok":false}'); }
  if (path === '/sse') { res.writeHead(200, { 'content-type': 'text/event-stream' }); let n = 0; const t = setInterval(() => { res.write(`data: ${n++}\n\n`); if (n > 3) { clearInterval(t); res.end(); } }, 100); return; }
  if (path === '/echo' && req.method === 'POST') { res.writeHead(200, { 'x-echo': '1', 'x-host': req.headers.host ?? '', 'x-xff': req.headers['x-forwarded-for'] ?? '' }); req.pipe(res); return; }
  if (path === '/env') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(Object.fromEntries(['MIND_DRIVER', 'DEV_AUTH', 'BRAIN_MODE', 'PUBLIC_URL', 'ANTHROPIC_API_KEY', 'NODE_OPTIONS', 'FAKE_FROM_FILE', 'WORLD_PATH'].map((k) => [k, process.env[k] ?? null]))));
  if (path.startsWith('/slow')) { setTimeout(() => res.end('ok'), Number(new URL(req.url, 'http://x').searchParams.get('ms') ?? 500)); return; }   // a long-poll stand-in
  if (path === '/wedge') { res.end('stuck'); setTimeout(() => { for (;;) { /* a stuck main thread (lane L1 guard tests) */ } }, 10); return; }
  if (path.startsWith('/level')) { L[3] = LEVELS.indexOf(new URL(req.url, 'http://x').searchParams.get('l') ?? 'green'); return res.end('ok'); }
  if (path === '/crash') { res.end('bye'); setTimeout(() => process.exit(3), 10); return; }
  // a crash whose open connections outlive the process for a while (their fds handed to a short-lived helper): the
  // launcher sees the exit before the in-flight requests drop, as when a world restarts under a long-poll
  if (path.startsWith('/crash-hold')) { const ms = Number(new URL(req.url, 'http://x').searchParams.get('ms') ?? 300); res.end('bye'); setTimeout(() => { spawn(process.execPath, ['-e', `setTimeout(() => {}, ${ms})`], { stdio: ['ignore', 'ignore', 'ignore', ...[...conns].filter((s) => s !== req.socket && !s.destroyed)] }); process.exit(3); }, 10); return; }
  res.writeHead(404).end('fake: no such route ' + path);
});
const conns = new Set(); server.on('connection', (s) => { conns.add(s); s.on('close', () => conns.delete(s)); });
server.on('upgrade', (req, socket) => {
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n');
  socket.on('data', (d) => socket.write(Buffer.from(String(d).toUpperCase())));
});
if (process.env.FAKE_BOOT_FAIL === slug) process.exit(9);
// FAKE_STOP_MS: a running world takes that long to exit on SIGTERM ('never': only SIGKILL stops it).
if (process.env.FAKE_STOP_MS) process.on('SIGTERM', () => { if (process.env.FAKE_STOP_MS !== 'never') setTimeout(() => process.exit(0), Number(process.env.FAKE_STOP_MS)); });
// FAKE_LOCK=1: edge-server.mjs's single-writer lock in DATA_DIR (a live other pid in it: refuse to open, exit 7).
const lock = () => {
  if (process.env.FAKE_LOCK !== '1') return;
  const file = join(process.env.DATA_DIR, 'edge-server.lock');
  try { const { pid } = JSON.parse(readFileSync(file, 'utf8')); process.kill(pid, 0); if (pid !== process.pid) { console.log(`fork refused: another edge server (pid ${pid}) is still running on this data dir`); process.exit(7); } } catch { /* free */ }
  mkdirSync(process.env.DATA_DIR, { recursive: true }); writeFileSync(file, JSON.stringify({ pid: process.pid }));
};
// Lane L1 guard tests (LOAD-CONTRACT §4). FAKE_LIVE=1: a worker thread writes DATA_DIR/live.json every FAKE_LIVE_MS
// (200) and answers SIM_HEALTH_PORT /healthz (503 once the main thread has not turned for FAKE_TURN_MS, 30 000), so both go
// on while the main thread is stuck (/wedge). FAKE_BOOT_TICK_MS: the boot moves that often (live.json boot.tick, or a
// line of output without FAKE_LIVE); FAKE_BOOT_STUCK=1: a boot that never moves nor listens. FAKE_FLAP_MS: exits 3 that
// long after it serves; FAKE_PLANNED_MS: exits 75 (a planned restart) that long after it serves.
const LEVELS = ['green', 'amber', 'red', 'black'], L = new Float64Array(new SharedArrayBuffer(32));   // turn, serving, tick, level
L[0] = Date.now(); setInterval(() => { L[0] = Date.now(); }, 50).unref();
if (process.env.FAKE_LIVE === '1') new Worker(`
  const { workerData: w } = require('node:worker_threads'), fs = require('node:fs'), L = new Float64Array(w.buf);
  const live = () => { const now = Date.now(), serving = L[1] === 1, o = { v: 1, pid: w.pid, at: now, phase: serving ? 'serving' : 'boot:replay', loop: { lastTurnAgeMs: Math.round(now - L[0]), delayP99Ms: 1 }, level: ${JSON.stringify(LEVELS)}[L[3]] ?? 'green' }; if (!serving) o.boot = { stage: 'replay', tick: L[2], target: 1000 }; return o; };
  const write = () => { if (!w.file) return; fs.writeFileSync(w.file + '.tmp', JSON.stringify(live())); fs.renameSync(w.file + '.tmp', w.file); };
  write(); setInterval(write, w.every);
  if (w.port) require('node:http').createServer((q, r) => { const l = live(), up = l.phase === 'serving' && l.loop.lastTurnAgeMs < w.turnMs; r.writeHead(up ? 200 : 503, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: up, ...l })); }).listen(w.port, '127.0.0.1');
`, { eval: true, workerData: { buf: L.buffer, pid: process.pid, file: process.env.DATA_DIR ? join(process.env.DATA_DIR, 'live.json') : null, every: Number(process.env.FAKE_LIVE_MS ?? 200), turnMs: Number(process.env.FAKE_TURN_MS ?? 30_000), port: Number(process.env.SIM_HEALTH_PORT) || 0 } });
if (process.env.FAKE_BOOT_TICK_MS) { const t = setInterval(() => { if (L[1] === 1) return clearInterval(t); L[2]++; if (process.env.FAKE_LIVE !== '1') console.log(`replay ${L[2]}`); }, Number(process.env.FAKE_BOOT_TICK_MS)); }
server.on('listening', () => {
  L[1] = 1;
  if (process.env.FAKE_LIVE === '1') process.on('SIGUSR2', () => console.log('[report] (a process report, as lane L2 writes one)'));
  if (process.env.FAKE_FLAP_MS) setTimeout(() => process.exit(3), Number(process.env.FAKE_FLAP_MS));
  if (process.env.FAKE_PLANNED_MS) setTimeout(() => process.exit(75), Number(process.env.FAKE_PLANNED_MS));
});
// FAKE_LOAD_MS: "code loading" (before the standby mark); FAKE_BOOT_MS: opening the data. SIM_STANDBY=1 waits for SIGUSR2 between.
const open = () => { lock(); if (process.env.FAKE_BOOT_STUCK === '1') return setInterval(() => {}, 1 << 30); setTimeout(() => server.listen(port, '127.0.0.1'), Number(process.env.FAKE_BOOT_MS ?? 50)); };
setTimeout(() => {
  if (process.env.SIM_STANDBY !== '1') return open();
  const hold = setInterval(() => {}, 1 << 30);
  process.once('SIGUSR2', () => { clearInterval(hold); console.log('[standby] go'); open(); });
  process.once('SIGTERM', () => process.exit(0));
  console.log(`[standby] ready pid ${process.pid}`);
}, Number(process.env.FAKE_LOAD_MS ?? 0));
