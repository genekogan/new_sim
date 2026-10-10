// A stand-in world for the launcher's tests: answers the few routes the launcher
// touches (healthz, god status), streams SSE, and echoes a raw WebSocket-style
// upgrade. Not a Sim server; never used outside tests.
import { createServer } from 'node:http';
const slug = process.env.WORLD_KEY, port = Number(process.env.PORT);
const base = `/w/${slug}`;
const server = createServer((req, res) => {
  const path = req.url.startsWith(base) ? req.url.slice(base.length) || '/' : req.url;
  if (path === '/healthz') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, worldId: `${slug}-1`, genesis: process.env.GENESIS_FILE ?? null, pid: process.pid }));
  if (path === '/v1/god/status') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ worldId: `${slug}-1`, hasOwner: false, you: 'anonymous', pending: [], entities: 3, seq: 1 }));
  if (path === '/v1/god/edits?limit=1') return req.headers.authorization === 'Bearer god_ok' ? res.writeHead(200).end('{"edits":[]}') : res.writeHead(401).end('{}');
  if (path === '/v1/god/preview' && req.method === 'POST') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'pv_test', accepted: true, summary: { upserts: 1 } }));
  if (path === '/sse') { res.writeHead(200, { 'content-type': 'text/event-stream' }); let n = 0; const t = setInterval(() => { res.write(`data: ${n++}\n\n`); if (n > 3) { clearInterval(t); res.end(); } }, 100); return; }
  if (path === '/echo' && req.method === 'POST') { res.writeHead(200, { 'x-echo': '1', 'x-host': req.headers.host ?? '' }); req.pipe(res); return; }
  if (path === '/crash') { res.end('bye'); setTimeout(() => process.exit(3), 10); return; }
  res.writeHead(404).end('fake: no such route ' + path);
});
server.on('upgrade', (req, socket) => {
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n');
  socket.on('data', (d) => socket.write(Buffer.from(String(d).toUpperCase())));
});
if (process.env.FAKE_BOOT_FAIL === slug) process.exit(9);
setTimeout(() => server.listen(port, '127.0.0.1'), Number(process.env.FAKE_BOOT_MS ?? 50));
