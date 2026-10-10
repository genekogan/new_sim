// node --test tools/world-launcher/launcher.test.mjs
// Uses fake world processes (fake-world.mjs) on the lane's own ports: proxy :5149, children 5141–5148.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLauncher } from './launcher.mjs';
import { slugFor, listTemplates } from './registry.mjs';
import { backoffMs } from './children.mjs';

const PORT = 5149, RANGE = [5141, 5148];
const dir = mkdtempSync(join(tmpdir(), 'launcher-test-'));
const templatesDir = join(dir, 'templates'); mkdirSync(templatesDir);
writeFileSync(join(templatesDir, 'hello-hamlet.json'), JSON.stringify({ schema: 'genesis/1', name: 'Hello hamlet', description: 'a hamlet', batches: [{ ops: [{ op: 'place' }] }] }));
writeFileSync(join(templatesDir, 'island.json'), JSON.stringify({ schema: 'genesis/1', name: 'Island', description: 'sea all round', batches: [] }));
writeFileSync(join(templatesDir, 'broken.json'), '{ not json');
const webDir = join(dir, 'web'); mkdirSync(join(webDir, 'assets'), { recursive: true });
writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>Sim</title>');
writeFileSync(join(webDir, 'assets', 'a.js'), 'console.log(1)');
const fake = new URL('./fake-world.mjs', import.meta.url).pathname;
const command = (w, port) => ({ cmd: process.execPath, args: [fake], env: { ...process.env, WORLD_KEY: w.slug, PORT: String(port), ...(w.templateFile ? { GENESIS_FILE: w.templateFile } : {}) } });
let L;
const open = () => openLauncher({ port: PORT, range: RANGE, dataDir: join(dir, 'data'), webDir, templatesDir, command, eager: 4, log: () => {} });
const api = (p, o = {}) => fetch(`http://127.0.0.1:${PORT}${p}`, o);
const post = (body) => api('/__sim/worlds', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
before(async () => { L = await open(); });
after(async () => { await L?.close(); });

test('slugs are url-safe, unique and avoid reserved names', () => {
  assert.equal(slugFor("Gene's Valley"), 'genes-valley');
  assert.equal(slugFor('Gene’s  Valley!!'), 'genes-valley');
  assert.equal(slugFor('Café Ñandú'), 'cafe-nandu');
  assert.equal(slugFor('42 Towers'), 'world-42-towers');
  assert.equal(slugFor('Mars'), 'mars-world');
  assert.equal(slugFor('☃'), 'world');
  assert.equal(slugFor('a', new Set(['a', 'a-2'])), 'a-3');
  assert.match(slugFor('x'.repeat(80)), /^[a-z][a-z0-9-]{0,31}$/);
});
test('templates: empty first, hello hamlet next, broken files skipped', () => {
  const t = listTemplates(templatesDir).map((x) => x.id);
  assert.deepEqual(t, ['empty', 'hello-hamlet', 'island']);
  assert.equal(backoffMs(0), 500); assert.equal(backoffMs(3), 4000); assert.equal(backoffMs(20), 30000);
});
test('homepage and assets come from the web build', async () => {
  const r = await api('/'); assert.equal(r.status, 200); assert.match(await r.text(), /<title>Sim/);
  assert.equal((await api('/assets/a.js')).status, 200);
  assert.equal((await api('/assets/../../etc/passwd')).status, 404);
});
test('create → healthy → listed; the template reaches the world as GENESIS_FILE', async () => {
  const r = await post({ name: 'Gene’s Valley', template: 'hello-hamlet' });
  assert.equal(r.status, 201); const b = await r.json();
  assert.equal(b.slug, 'genes-valley'); assert.equal(b.url, '/w/genes-valley/?dev=1&new=1');
  const h = await (await api('/w/genes-valley/healthz')).json();
  assert.match(h.genesis, /hello-hamlet\.json$/);
  const list = await (await api('/__sim/worlds.json')).json();
  assert.equal(list.contract, 'local-worlds/1'); assert.equal(list.launcher, 'world-launcher/1');
  const w = list.worlds.find((x) => x.slug === 'genes-valley');
  assert.equal(w.basePath, '/w/genes-valley'); assert.equal(w.name, 'Gene’s Valley'); assert.equal(w.templateName, 'Hello hamlet');
  assert.equal(w.entities, 3); assert.equal(w.god, false); assert.equal(w.status, 'running');
  assert.ok(list.templates.some((t) => t.id === 'island') && !list.templates.some((t) => 'file' in t));
  const again = await (await post({ name: "Gene's valley" })).json();
  assert.equal(again.slug, 'genes-valley-2');
  const e = await (await api('/w/genes-valley-2/healthz')).json(); assert.equal(e.genesis, null);
});
test('bad requests are refused with reasons', async () => {
  assert.equal((await post({ name: '' })).status, 400);
  assert.equal((await post({ name: 'x', template: 'nope' })).status, 400);
  assert.equal((await api('/__sim/worlds', { method: 'POST', body: '{' })).status, 400);
  assert.equal((await api('/w/nobody/healthz')).status, 404);
  const html = await api('/w/nobody/', { headers: { accept: 'text/html' } }); assert.equal(html.status, 404); assert.match(await html.text(), /No world called/);
  const r = await api('/w/genes-valley?dev=1', { redirect: 'manual' }); assert.equal(r.status, 308); assert.equal(r.headers.get('location'), '/w/genes-valley/?dev=1');
});
test('proxy: request bodies, host header, SSE streaming and upgrades pass through', async () => {
  const echo = await api('/w/genes-valley/echo', { method: 'POST', body: 'hello' });
  assert.equal(await echo.text(), 'hello'); assert.equal(echo.headers.get('x-host'), `127.0.0.1:${PORT}`);
  const t0 = performance.now(); const sse = await api('/w/genes-valley/sse');
  const reader = sse.body.getReader(); const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /data: 0/); assert.ok(performance.now() - t0 < 300, 'first event arrives before the stream ends');
  let rest = ''; for (;;) { const c = await reader.read(); if (c.done) break; rest += new TextDecoder().decode(c.value); }
  assert.match(rest, /data: 3/);
  const echoed = await new Promise((yes, no) => {
    const s = connect(PORT, '127.0.0.1', () => s.write('GET /w/genes-valley/ws HTTP/1.1\r\nHost: x\r\nUpgrade: test\r\nConnection: Upgrade\r\n\r\n'));
    let buf = ''; s.on('data', (d) => { buf += d; if (buf.includes('101') && !buf.includes('PING')) s.write('ping'); if (buf.includes('PING')) { s.destroy(); yes(buf); } }); s.on('error', no);
  });
  assert.match(echoed, /101 Switching/); assert.match(echoed, /PING/);
});
test('the launcher notes looks, agents and previews; previews need a god token', async () => {
  await api('/w/genes-valley/?shot=1&eye=1,2,3');
  await api('/w/genes-valley/v1/god/status', { headers: { authorization: 'Bearer god_x', 'user-agent': 'node' } });
  await api('/w/genes-valley/v1/god/preview', { method: 'POST', body: '{}' });
  await new Promise((r) => setTimeout(r, 50));
  const one = await (await api('/__sim/worlds/genes-valley')).json();
  assert.equal(one.seen.looks, 1); assert.ok(one.seen.agentSeenAt); assert.equal(one.seen.previews, 1);
  assert.equal((await api('/__sim/worlds/genes-valley/previews')).status, 401);
  const p = await (await api('/__sim/worlds/genes-valley/previews', { headers: { authorization: 'Bearer god_ok' } })).json();
  assert.equal(p.previews[0].id, 'pv_test');
});
test('a crashed world restarts by itself', async () => {
  const before = (await (await api('/__sim/launcher')).json()).children.find((c) => c.slug === 'genes-valley');
  await api('/w/genes-valley/crash');
  let after;
  for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 100)); after = (await (await api('/__sim/launcher')).json()).children.find((c) => c.slug === 'genes-valley'); if (after.status === 'running' && after.pid !== before.pid) break; }
  assert.equal(after.status, 'running'); assert.notEqual(after.pid, before.pid); assert.equal(after.restarts, 1);
  assert.equal(after.lastExit.code, 3);
  assert.equal((await api('/w/genes-valley/healthz')).status, 200);
});
test('a world that cannot boot is not registered', async () => {
  process.env.FAKE_BOOT_FAIL = 'doomed';
  const r = await post({ name: 'Doomed' }); delete process.env.FAKE_BOOT_FAIL;
  assert.equal(r.status, 500); assert.equal((await r.json()).code, 'boot-failed');
  const list = await (await api('/__sim/worlds.json')).json(); assert.ok(!list.worlds.some((w) => w.slug === 'doomed'));
});
test('the registry survives a launcher restart and worlds wake again', async () => {
  await L.close(); L = await open();
  const reg = JSON.parse(readFileSync(join(dir, 'data', 'worlds.json'), 'utf8'));
  assert.deepEqual(reg.worlds.map((w) => w.slug).sort(), ['genes-valley', 'genes-valley-2']);
  for (let i = 0; i < 50 && (await api('/w/genes-valley/healthz')).status !== 200; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal((await api('/w/genes-valley/healthz')).status, 200);
});

test('with every port taken, the least recently used idle world sleeps to make room, and wakes on its next visit', async () => {
  const L2 = await openLauncher({ port: 5140, range: [5139, 5139], dataDir: join(dir, 'data-small'), webDir, templatesDir, command, idleMs: 0, eager: 0, log: () => {} });
  try {
    const post2 = (name) => fetch('http://127.0.0.1:5140/__sim/worlds', { method: 'POST', body: JSON.stringify({ name }) });
    assert.equal((await post2('First')).status, 201);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal((await post2('Second')).status, 201);
    const kids = async () => Object.fromEntries((await (await fetch('http://127.0.0.1:5140/__sim/launcher')).json()).children.map((c) => [c.slug, c.status]));
    assert.deepEqual(await kids(), { first: 'asleep', second: 'running' });
    assert.equal((await fetch('http://127.0.0.1:5140/w/first/healthz')).status, 200);
    assert.deepEqual(await kids(), { first: 'running', second: 'asleep' });
  } finally { await L2.close(); }
});
test('children a hard-killed launcher left behind are stopped before their worlds start again', async () => {
  const { spawn } = await import('node:child_process');
  const orphan = spawn(process.execPath, [fake], { env: { ...process.env, WORLD_KEY: 'orphan', PORT: '5138' }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 300));
  const d = join(dir, 'data-orphan'); mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'children.json'), JSON.stringify({ orphan: { pid: orphan.pid, port: 5138, script: fake } }));
  const exited = new Promise((r) => orphan.once('exit', (code, signal) => r(signal ?? code)));
  const L3 = await openLauncher({ port: 5137, range: [5135, 5136], dataDir: d, webDir, templatesDir, command, eager: 0, log: () => {} });
  try { assert.equal(await exited, 'SIGTERM'); } finally { await L3.close(); }
});
