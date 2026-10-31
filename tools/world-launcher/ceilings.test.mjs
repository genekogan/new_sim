// node --test tools/world-launcher/ceilings.test.mjs — lane L1, LOAD-CONTRACT §2b: the launcher's ceilings on the Soul API.
// Fake worlds on lane L1's ports only: proxy :5109, children 5104–5106.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLauncher } from './launcher.mjs';
import { requestClass, soulCeilings, SOUL_CEILINGS } from './flood.mjs';

const req = (method, headers = {}) => ({ method, headers });

test('request classes follow LOAD-CONTRACT §2', () => {
  assert.equal(requestClass('/v1/edge/act', 'POST'), 'C1'); assert.equal(requestClass('/v1/edge/here'), 'C2');
  assert.equal(requestClass('/v1/edge/map'), 'C3'); assert.equal(requestClass('/v1/world/snapshot'), 'C3');
  assert.equal(requestClass('/v1/edge/inbox/listen'), 'listen'); assert.equal(requestClass('/v1/edge/wait'), 'listen');
  assert.equal(requestClass('/v1/edge/receipts/r1'), 'C0'); assert.equal(requestClass('/healthz'), 'C0'); assert.equal(requestClass('/v1/god/act', 'POST'), null);
});

test('ceilings: address rate, listen per Soul / account / address, account rate, world budget, body, token', () => {
  let t = 0; const c = soulCeilings({ now: () => t, log: () => {}, limitsFor: () => ({ ipPer10s: 5, worldBudgetRps: 3, accountHeavyPerMin: 8 }) });
  const soul = (tok, ip = '1.1.1.1', m = 'POST') => req(m, { authorization: `Bearer sim_s_${tok}_x`, 'x-forwarded-for': ip });
  const ok = (r) => { assert.ok(r && !r.refuse, JSON.stringify(r?.refuse?.body)); r.release(); return r; };
  for (let i = 0; i < 6; i++) ok(c.check(soul(`a${i}`, `9.9.9.${i}`), "w", "/v1/edge/act", true));   // the budget's 2 s burst, 6 Souls
  const busy = c.check(soul('b', '2.2.2.2'), 'w', '/v1/edge/act', true);
  assert.equal(busy.refuse.status, 503); assert.equal(busy.refuse.body.code, 'world.busy'); assert.ok(Number(busy.refuse.headers['retry-after']) >= 1);
  t += 10_000;
  for (let i = 0; i < 5; i++) { const r = c.check(soul('c', '3.3.3.3', 'GET'), 'w2', '/v1/edge/receipts/x', true); ok(r); }
  assert.equal(c.check(soul('c', '3.3.3.3', 'GET'), 'w2', '/v1/edge/receipts/x', true).refuse.body.code, 'client.rate');
  ok(c.check(soul('c', '3.3.3.3', 'GET'), 'w2', '/v1/edge/receipts/x', false));   // not behind the proxy: no address limit
  t += 10_000;
  const l1 = c.check(soul('d', '4.4.4.1', 'GET'), 'w3', '/v1/edge/inbox/listen', true), l2 = c.check(soul('d', '4.4.4.2', 'GET'), 'w3', '/v1/edge/inbox/listen', true);
  assert.equal(c.check(soul('d', '4.4.4.3', 'GET'), 'w3', '/v1/edge/inbox/listen', true).refuse.body.code, 'soul.busy');
  l1.release(); ok(c.check(soul('d', '4.4.4.3', 'GET'), 'w3', '/v1/edge/inbox/listen', true)); l2.release();
  // one account's Souls share its listen and rate ceilings once the world names the account
  const souls = ['e1', 'e2', 'e3', 'e4', 'e5'].map((x) => soul(x, `5.5.5.${x}`, 'GET'));
  for (const s of souls) c.learn(c.soulOf(s), 'acct-1');
  const held = []; for (let i = 0; i < 8; i++) held.push(c.check(souls[i % 5], 'w4', '/v1/edge/inbox/listen', true));
  assert.ok(held.every((h) => !h.refuse)); assert.equal(c.check(souls[3], 'w4', '/v1/edge/inbox/listen', true).refuse.body.code, 'account.rate');   // souls[3] holds one
  held.forEach((h) => h.release());
  t += 60_000; const big = soulCeilings({ now: () => t, log: () => {}, limitsFor: () => ({ accountHeavyPerMin: 8, worldBudgetRps: 100 }) });
  for (const s of souls) big.learn(big.soulOf(s), 'acct-1');
  for (let i = 0; i < 2; i++) ok(big.check(souls[i], 'w5', '/v1/edge/here', true));   // burst = a quarter minute's worth
  assert.equal(big.check(souls[2], 'w5', '/v1/edge/here', true).refuse.body.code, 'account.rate');
  assert.equal(c.check(req('POST', { authorization: 'Bearer sim_s_f_x', 'content-length': String(65 * 1024) }), 'w6', '/v1/edge/act', false).refuse.status, 413);
  assert.equal(c.check(req('GET', {}), 'w6', '/v1/edge/here', false).refuse.status, 401);
  // address concurrency: ten in flight from one address, the eleventh refused
  const many = []; for (let i = 0; i < SOUL_CEILINGS.ipConcurrent; i++) many.push(c.check(req('GET', { 'x-forwarded-for': '6.6.6.6' }), `w7-${i}`, '/v1/world/seq', true));
  assert.equal(c.check(req('GET', { 'x-forwarded-for': '6.6.6.6' }), 'w8', '/v1/world/seq', true).refuse.body.code, 'client.rate');
  assert.equal(c.socket('w8', '6.6.6.6'), null); many.forEach((m) => m.release()); assert.ok(c.socket('w8', '6.6.6.6'));
});

test('a 200 req/s hammer from one address: the world gets at most its budget, every refusal within 50 ms; C3 reads hit the world once a second', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'l1-ceil-'));
  const templatesDir = join(dir, 'templates'); mkdirSync(templatesDir);
  const webDir = join(dir, 'web'); mkdirSync(webDir); writeFileSync(join(webDir, 'index.html'), '<!doctype html>');
  const hits = join(dir, 'hits.txt'); writeFileSync(hits, '');
  const fake = new URL('./fake-world.mjs', import.meta.url).pathname;
  const command = (w, port) => ({ cmd: process.execPath, args: [fake], env: { ...process.env, WORLD_KEY: w.slug, PORT: String(port), FAKE_HITS: hits } });
  const P = 5109, base = `http://127.0.0.1:${P}`;
  const L = await openLauncher({ port: P, range: [5104, 5106], dataDir: join(dir, 'data'), webDir, templatesDir, command, eager: 0, log: () => {}, prewarm: false, publicOrigin: 'http://sim.test', devAuth: true });
  try {
    const made = await (await fetch(`${base}/__sim/worlds`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Anvil' }) })).json();
    const slug = made.slug, path = `${base}/w/${slug}/v1/edge/here`;
    writeFileSync(hits, '');
    const headers = { authorization: 'Bearer sim_s_hammer_secret', 'x-forwarded-for': '203.0.113.9' };
    const seconds = 3, rate = 200, t0 = Date.now(), runs = [];
    for (let i = 0; i < seconds * rate; i++) {
      const due = t0 + (i * 1000) / rate; const wait = due - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const s = performance.now();
      runs.push(fetch(path, { headers }).then(async (r) => { await r.arrayBuffer(); return { status: r.status, ms: performance.now() - s, retry: r.headers.get('retry-after') }; }));
    }
    const out = await Promise.all(runs), elapsed = (Date.now() - t0) / 1000;
    const reached = readFileSync(hits, 'utf8').split('\n').filter((l) => l === '/v1/edge/here').length;
    const refused = out.filter((r) => r.status === 429 || r.status === 503), worst = Math.max(...refused.map((r) => r.ms));
    const p99 = refused.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(refused.length * 0.99)];
    const budget = SOUL_CEILINGS.worldBudgetRps * Math.ceil(elapsed) + 2 * SOUL_CEILINGS.worldBudgetRps;
    console.log(`hammer: ${out.length} requests in ${elapsed.toFixed(1)} s; world reached ${reached} (budget ${budget}); refused ${refused.length}, p99 ${p99.toFixed(1)} ms, worst ${worst.toFixed(1)} ms`);
    assert.ok(reached <= budget, `world reached ${reached} > ${budget}`);
    assert.ok(refused.length >= out.length - budget);
    assert.ok(refused.every((r) => Number(r.retry) >= 1));
    assert.ok(p99 <= 50, `p99 ${p99} ms`);
    // C3: 50 browsers asking for the snapshot at once and again for 2.5 s cost the world about one call a second
    writeFileSync(hits, '');
    const snap = `${base}/w/${slug}/v1/world/snapshot`, s0 = Date.now(); let served = 0;
    while (Date.now() - s0 < 2500) { const rs = await Promise.all(Array.from({ length: 50 }, (_, i) => fetch(snap, { headers: { 'x-forwarded-for': `198.51.100.${i}` } }).then((r) => r.json()))); served += rs.length; await new Promise((r) => setTimeout(r, 100)); }
    const snapHits = readFileSync(hits, 'utf8').split('\n').filter((l) => l === '/v1/world/snapshot').length;
    console.log(`c3: ${served} snapshot reads, ${snapHits} reached the world`);
    assert.ok(snapHits <= 4, `${snapHits} world calls`);
    // registry-tunable: a bigger budget for this world, at once
    const r = await fetch(`${base}/__sim/op/set-limits`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug, limits: { worldBudgetRps: 50, nope: 1 } }) });
    assert.equal(r.status, 400);
    const ok = await (await fetch(`${base}/__sim/op/set-limits`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug, limits: { worldBudgetRps: 50 } }) })).json();
    assert.equal(ok.limits.worldBudgetRps, 50); assert.equal(ok.limits.ipListen, 8);
    const dash = await (await fetch(`${base}/__sim/health?json=1`)).json();
    const row = dash.worlds.find((w) => w.slug === slug);
    assert.equal(row.limits.worldBudgetRps, 50); assert.ok(row.refused['world.busy'] > 0 || row.refused['client.rate'] > 0);
  } finally { await L.close(); }
});

test('lane L7 mounts: /__sim/metrics (loopback only) carries the ceilings\' refusals; healthz has clientErrorsRate10m', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'l1-metrics-'));
  const templatesDir = join(dir, 'templates'); mkdirSync(templatesDir);
  const webDir = join(dir, 'web'); mkdirSync(webDir); writeFileSync(join(webDir, 'index.html'), '<!doctype html>');
  const fake = new URL('./fake-world.mjs', import.meta.url).pathname;
  const command = (w, port) => ({ cmd: process.execPath, args: [fake], env: { ...process.env, WORLD_KEY: w.slug, PORT: String(port) } });
  const P = 5109, base = `http://127.0.0.1:${P}`;
  const L = await openLauncher({ port: P, range: [5104, 5106], dataDir: join(dir, 'data'), webDir, templatesDir, command, eager: 0, log: () => {}, prewarm: false, publicOrigin: 'http://sim.test', devAuth: true });
  try {
    const { slug } = await (await fetch(`${base}/__sim/worlds`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Gauge' }) })).json();
    assert.equal((await fetch(`${base}/w/${slug}/v1/edge/here`, { headers: { 'x-forwarded-for': '203.0.113.1' } })).status, 401);
    const h = await (await fetch(`${base}/__sim/healthz`)).json(); assert.equal(typeof h.clientErrorsRate10m, 'number');
    const m = await (await fetch(`${base}/__sim/metrics`)).text();
    assert.match(m, new RegExp(`sim_world_refused_total\\{world="${slug}",class="auth.required"\\} 1`));
    assert.equal((await fetch(`${base}/__sim/metrics`, { headers: { 'x-forwarded-for': '1.2.3.4' } })).status, 404);
  } finally { await L.close(); }
});
