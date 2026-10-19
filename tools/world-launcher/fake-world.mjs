// A stand-in world for the launcher's tests: answers the few routes the launcher
// touches (healthz, god status), streams SSE, and echoes a raw WebSocket-style
// upgrade. Not a Sim server; never used outside tests.
import { createServer } from 'node:http';
const slug = process.env.WORLD_KEY, port = Number(process.env.PORT);
const base = process.env.WORLD_PATH ?? `/w/${slug}`;
const server = createServer((req, res) => {
  const path = req.url.startsWith(base) ? req.url.slice(base.length) || '/' : req.url;
  if (path === '/healthz') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, worldId: `${slug}-1`, genesis: process.env.GENESIS_FILE ?? null, pid: process.pid }));
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
  if (path === '/crash') { res.end('bye'); setTimeout(() => process.exit(3), 10); return; }
  res.writeHead(404).end('fake: no such route ' + path);
});
server.on('upgrade', (req, socket) => {
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n');
  socket.on('data', (d) => socket.write(Buffer.from(String(d).toUpperCase())));
});
if (process.env.FAKE_BOOT_FAIL === slug) process.exit(9);
// FAKE_LOAD_MS: "code loading" (before the standby mark); FAKE_BOOT_MS: opening the data. SIM_STANDBY=1 waits for SIGUSR2 between.
const open = () => setTimeout(() => server.listen(port, '127.0.0.1'), Number(process.env.FAKE_BOOT_MS ?? 50));
setTimeout(() => {
  if (process.env.SIM_STANDBY !== '1') return open();
  const hold = setInterval(() => {}, 1 << 30);
  process.once('SIGUSR2', () => { clearInterval(hold); console.log('[standby] go'); open(); });
  process.once('SIGTERM', () => process.exit(0));
  console.log(`[standby] ready pid ${process.pid}`);
}, Number(process.env.FAKE_LOAD_MS ?? 0));
