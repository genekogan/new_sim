import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { startWire, wireFetch, _resetWire, WIRE } from './wire.mjs';

function folder(t) {
  const cwd = process.cwd(), dir = mkdtempSync(join(tmpdir(), 'god-wire-'));
  process.chdir(dir); _resetWire();
  t.after(() => { process.chdir(cwd); rmSync(dir, { recursive: true, force: true }); _resetWire(); });
  return dir;
}
async function world(t, handler) {
  const seen = [];
  const s = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, wire: req.headers['x-eden-god-wire'], target: req.headers['x-eden-god-target'], socket: req.socket.remotePort, body: b }); handler(req, res, b); }); });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  t.after(() => s.close());
  return { url: `http://127.0.0.1:${s.address().port}/w/test`, seen, server: s };
}

test('wire: the CLI goes through the relay on one kept-alive connection, headers and bodies intact', async (t) => {
  folder(t);
  const w = await world(t, (req, res, b) => { res.writeHead(201, { 'content-type': 'application/json', 'x-eden-inbox': '3' }); res.end(JSON.stringify({ echo: b, path: req.url })); });
  const relay = await startWire(w.url); t.after(() => relay.close());
  assert.equal(statSync(WIRE).mode & 0o777, 0o600);
  const before = relay.usedAt();
  for (let i = 0; i < 3; i++) {
    const r = await wireFetch(`${w.url}/v1/god/act?x=${i}`, { method: 'POST', headers: { authorization: 'Bearer god_x', 'content-type': 'application/json' }, body: `{"i":${i}}` });
    assert.equal(r.status, 201); assert.equal(r.headers.get('x-eden-inbox'), '3');
    assert.deepEqual(await r.json(), { echo: `{"i":${i}}`, path: `/w/test/v1/god/act?x=${i}` });
  }
  const sent = w.seen.filter((x) => x.url.startsWith('/w/test/v1/god/act'));
  assert.equal(sent.length, 3);
  assert.ok(sent.every((x) => x.auth === 'Bearer god_x' && x.wire === undefined && x.target === undefined), 'relay headers never reach the world');
  assert.equal(new Set(sent.map((x) => x.socket)).size, 1, 'one warm connection for all three');
  assert.ok(relay.usedAt() > before);
});

test('wire: no relay, a dead relay, or another world: direct, silently', async (t) => {
  folder(t);
  const w = await world(t, (req, res) => { res.end('{"ok":true}'); });
  // none
  assert.equal((await wireFetch(`${w.url}/v1/world/seq`)).status, 200);
  // a relay file whose process is gone
  writeFileSync(WIRE, JSON.stringify({ world: w.url, port: 1, pid: 2 ** 30, secret: 's' })); _resetWire();
  assert.equal((await wireFetch(`${w.url}/v1/world/seq`)).status, 200);
  const closed = await new Promise((r) => { const x = http.createServer(); x.listen(0, '127.0.0.1', () => { const p = x.address().port; x.close(() => r(p)); }); });
  // a live pid, but nothing listens: GET and POST both go direct (refused = nothing sent)
  writeFileSync(WIRE, JSON.stringify({ world: w.url, port: closed, pid: process.pid, secret: 's' })); _resetWire();
  assert.equal((await wireFetch(`${w.url}/v1/world/seq`)).status, 200); _resetWire();
  assert.equal((await wireFetch(`${w.url}/v1/god/act`, { method: 'POST', body: '{}' })).status, 200);
  // a relay for another world is not used
  const relay = await startWire(w.url + '-other'); t.after(() => relay.close()); _resetWire();
  const gets = () => w.seen.filter((x) => x.method === 'GET' && x.wire === undefined && x.url.endsWith('/v1/world/seq')).length, n = gets();
  assert.equal((await wireFetch(`${w.url}/v1/world/seq`)).status, 200);
  assert.equal(gets(), n + 1);
});

test('wire: the relay refuses callers without the secret and targets outside its world', async (t) => {
  folder(t);
  const w = await world(t, (req, res) => { res.end('{}'); });
  const relay = await startWire(w.url); t.after(() => relay.close());
  await new Promise((r) => setTimeout(r, 100)); // the relay's own warm-up HEAD
  const n = w.seen.length;
  const r = await fetch(`http://127.0.0.1:${relay.port}/`, { headers: { 'x-eden-god-target': `${w.url}/v1/world/seq` } });
  assert.equal(r.status, 403);
  const { secret } = JSON.parse(readFileSync(WIRE, 'utf8'));
  const r2 = await fetch(`http://127.0.0.1:${relay.port}/`, { headers: { 'x-eden-god-wire': secret, 'x-eden-god-target': 'http://127.0.0.1:1/elsewhere' } });
  assert.equal(r2.status, 400);
  assert.equal(w.seen.length, n, 'neither reached the world');
});

test('wire: a world that went away mid-way: GET falls back, POST fails like a lost connection', async (t) => {
  folder(t);
  // a relay whose world has gone away
  const dead = await world(t, () => {}); const deadUrl = dead.url; await new Promise((r) => dead.server.close(r));
  const relay = await startWire(deadUrl); t.after(() => relay.close()); _resetWire();
  await assert.rejects(wireFetch(`${deadUrl}/v1/god/act`, { method: 'POST', body: '{}' }), (e) => /relay|fetch failed/.test(e.message));
  _resetWire();
  await assert.rejects(wireFetch(`${deadUrl}/v1/world/seq`), /fetch failed/); // direct fallback also fails: the world is down
});

test('wire: HTTP/2 to an https world, one session, compressed bodies pass through', async (t) => {
  folder(t);
  const http2 = await import('node:http2'), zlib = await import('node:zlib'), { execFileSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'god-wire-tls-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  try { execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' }); }
  catch { t.skip('no openssl'); return; }
  const sessions = new Set();
  const s = http2.createSecureServer({ key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')) }, (req, res) => {
    sessions.add(req.stream.session);
    const gz = /gzip/.test(req.headers['accept-encoding'] ?? '');
    res.writeHead(200, { 'content-type': 'application/json', ...(gz ? { 'content-encoding': 'gzip' } : {}) });
    const body = JSON.stringify({ path: req.url, big: 'x'.repeat(50_000) });
    res.end(gz ? zlib.gzipSync(body) : body);
  });
  await new Promise((r) => s.listen(0, '127.0.0.1', r)); t.after(() => s.close());
  // trust the throwaway certificate (this test process only)
  const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED; process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  t.after(() => { if (prev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED; else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev; });
  const url = `https://127.0.0.1:${s.address().port}/w/tls`;
  const relay = await startWire(url); t.after(() => relay.close()); _resetWire();
  for (let i = 0; i < 3; i++) {
    const r = await wireFetch(`${url}/v1/god/snapshot?i=${i}`, { headers: { 'accept-encoding': 'gzip' } });
    const j = await r.json();
    assert.equal(j.path, `/w/tls/v1/god/snapshot?i=${i}`); assert.equal(j.big.length, 50_000);
  }
  assert.equal(sessions.size, 1, 'one HTTP/2 session for every call');
});
