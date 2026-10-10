#!/usr/bin/env node
// Souls on the ground (lane L8, spec <eden4>/31 B1, 33 §9): one scenario that plays both parts.
// The god (god token) builds a knoll with a flag on top, a mesa with sheer sides, a shallow pond and a
// deep lake. A Soul (created through the owner API, paired with a Soul token, driven through /v1/edge/*)
// walks to the hilltop flag — its y follows the slope in the takes — is refused the cliff, is refused
// walking into the lake, wades the pond, swims the lake and walks back out; the god then raises the
// ground under it and it is lifted; a restart replays onto the same ground. Screenshots of the Soul.
//
//   node tools/god-skill/e2e/souls-ground.mjs [--port 5162] [--keep] [--no-shots]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromeLease } from '../lib/chrome-lease.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const slug = typeof args.slug === 'string' ? args.slug : `ground-${stamp.slice(11, 19).replace(/-/g, '').toLowerCase()}`;
const port = Number(args.port ?? 5162);
const out = resolve(root, '.lane/e2e-ground', stamp);
mkdirSync(out, { recursive: true });
const dataDir = resolve(out, 'data');
const base = `http://127.0.0.1:${port}/w/${slug}`;
const report = { slug, port, startedAt: new Date().toISOString(), steps: [], shots: [], failures: [], samples: {} };
const log = (...a) => console.log(...a);
const t = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- the world process (fake minds, dev auth, fresh data dir)
const marsWeb = resolve(root, '.lane/mars-web');
const env = { ...process.env, ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), WORLD_KEY: slug, WORLD_ID: `${slug}-1`, ENGINE: 'mars', PORT: String(port), DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', DATA_DIR: dataDir, PUBLIC_URL: `http://127.0.0.1:${port}` };
let serverLog = '', server;
const boot = async () => {
  server = spawn(process.execPath, ['apps/server/src/main.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
  server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
  const t0 = t();
  for (let i = 0; i < 2400; i++) { try { const r = await fetch(`${base}/healthz`); if (r.ok) return t() - t0; } catch { } await sleep(100); }
  throw new Error('world did not come up');
};
const stop = () => { try { server?.kill(); } catch { } };
process.on('exit', () => { if (!args.keep) stop(); });

// ---------- clients: the owner (dev:admin), the god (god token), the Soul (Soul token)
let godToken = '', soulToken = '';
async function api(path, { method, body, as = 'god' } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (as === 'god') headers.authorization = `Bearer ${godToken}`;
  if (as === 'owner') headers.authorization = 'Bearer dev:admin';
  if (as === 'soul') headers.authorization = `Bearer ${soulToken}`;
  const r = await fetch(base + path, { method: method ?? (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000) });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
async function step(name, fn, expect) {
  const t0 = t(); let result, error;
  try { result = await fn(); } catch (e) { error = String(e?.stack ?? e?.message ?? e); }
  const ms = t() - t0, okay = !error && (expect ? !!expect(result) : true);
  report.steps.push({ name, ms: +ms.toFixed(0), ok: okay, result, error });
  if (!okay) report.failures.push({ name, result, error });
  log(`${okay ? '✔' : '✖'} ${name} — ${ms.toFixed(0)} ms${okay ? '' : ' — ' + (error ?? JSON.stringify(result)).slice(0, 400)}`);
  return result;
}
const act = (ops, note) => api('/v1/god/act', { body: { ops, note } });
const groundAt = async (pts) => (await api('/v1/god/query', { body: { points: pts }, as: 'none' })).data.points;
const observe = async () => (await api('/v1/edge/observe', { as: 'soul' })).data;
const caps = async () => (await api('/v1/edge/capabilities', { as: 'soul' })).data.capabilities ?? [];
/** Act as the Soul and follow the receipt to its end, sampling the body (position, activity) on the way. */
async function soulDoes(capability, { maxS = 240 } = {}) {
  const r = await api('/v1/edge/act', { body: { capability }, as: 'soul' });
  if (!r.data?.accepted) return { accepted: false, code: r.data?.code, reason: r.data?.reason, status: r.status, samples: [], end: null };
  const id = r.data.receipt.id, samples = [], t0 = Date.now();
  let rec = r.data.receipt;
  while (Date.now() - t0 < maxS * 1000) {
    const o = await observe(); const me = o.self;
    samples.push({ tick: o.tick, p: me.position, activity: me.activity, state: me.state });
    rec = (await api(`/v1/edge/receipts/${encodeURIComponent(id)}`, { as: 'soul' })).data?.receipt ?? (await api(`/v1/edge/receipts/${encodeURIComponent(id)}`, { as: 'soul' })).data;
    if (['completed', 'failed', 'replaced'].includes(rec?.phase)) break;
    await sleep(700);
  }
  const o = await observe();
  return { accepted: true, phase: rec?.phase, code: rec?.code, reason: rec?.reason, samples, end: { p: o.self.position, activity: o.self.activity, state: o.self.state } };
}
const near = (p, q, d) => Math.hypot(p[0] - q[0], p[2] - q[1]) <= d;

// ---------- screenshots (Chrome via the viewer's Playwright)
let chromium = null;
if (!args['no-shots']) try { chromium = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test').chromium; } catch { log('  (no @playwright/test; screenshots skipped)'); }
async function shot(name, opts = {}) { for (let attempt = 1; attempt <= 2; attempt++) if (await shotOnce(name, opts)) return; }
async function shotOnce(name, { eye, at, wait = 4000 } = {}) {
  if (!chromium) return true;
  const release = await chromeLease('ground').catch(() => null);
  if (!release) { log('  (chrome lease busy; screenshot skipped)'); return true; }
  let browser = null;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => { localStorage.setItem('sim.dev', 'admin'); });
    const page = await ctx.newPage();
    const q = new URLSearchParams({ dev: '1', shot: '1', settle: String(wait) }); if (eye) q.set('eye', eye.map((v) => v.toFixed(2)).join(',')); if (at) q.set('at', at.map((v) => v.toFixed(2)).join(','));
    await page.goto(`${base}?${q}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 150_000 }).catch(() => log('  (shot not ready in 150 s; taking it anyway)'));
    await page.waitForTimeout(1500);
    const file = resolve(out, `${name}.png`);
    await page.screenshot({ path: file, timeout: 120_000 });
    report.shots.push({ name, file, title: await page.title() });
    log(`  📷 ${name}.png`);
    return true;
  } catch (e) { log('  (screenshot failed: ' + String(e.message).split('\n')[0] + ')'); return false; }
  finally { if (browser) await browser.close().catch(() => { }); release(); }
}

/** Open the page first (camera on `eye`/`at`), then start `run` (e.g. a Soul's walk) and photograph it `afterMs` later, mid-motion. */
async function shotDuring(name, { eye, at, afterMs = 10000 }, run) {
  if (!chromium) return run();
  const release = await chromeLease('ground').catch(() => null);
  if (!release) { log('  (chrome lease busy; mid-motion screenshot skipped)'); return run(); }
  let browser = null, p = null;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => { localStorage.setItem('sim.dev', 'admin'); });
    const page = await ctx.newPage();
    const q = new URLSearchParams({ dev: '1', shot: '1', settle: '3000', eye: eye.map((v) => v.toFixed(2)).join(','), at: at.map((v) => v.toFixed(2)).join(',') });
    await page.goto(`${base}?${q}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 150_000 }).catch(() => log('  (shot not ready in 150 s; taking it anyway)'));
    p = run();
    await sleep(afterMs);
    const file = resolve(out, `${name}.png`);
    await page.screenshot({ path: file, timeout: 120_000 });
    report.shots.push({ name, file });
    log(`  📷 ${name}.png (mid-motion)`);
  } catch (e) { log('  (mid-motion screenshot failed: ' + String(e.message).split('\n')[0] + ')'); }
  finally { if (browser) await browser.close().catch(() => { }); release(); }
  return p ?? run();
}

// ================================================================ the scenario
// layout (metres): the Soul is born at the origin; knoll east, mesa north, pond west, lake far west
const KNOLL = [30, 0], MESA = [[-6, 30], [6, 30], [6, 42], [-6, 42]], POND = [[-30, -10], [-18, -10], [-18, 2], [-30, 2]], LAKE = [[-95, -45], [-50, -45], [-50, 5], [-95, 5]];
let bootMs = 0;
try {
  bootMs = await boot();
  log(`▶ world "${slug}" on :${port} booted in ${bootMs.toFixed(0)} ms`);
  await step('G0 the god mints a token for the new world', async () => { const r = await api('/v1/god/mint', { as: 'owner', body: { label: 'e2e-ground' } }); godToken = r.data.token; return r; }, (r) => r.status === 200 && !!godToken);
  await step('G1 the god builds the ground: a knoll, a mesa with sheer sides, a shallow pond, a deep lake, and flags', () => act([
    { op: 'place', def: 'core/knoll@1', name: 'knoll', p: KNOLL, params: { height: 6, radius: 22 } },
    { op: 'place', def: 'core/plateau@1', name: 'mesa', shape: { area: MESA }, params: { height: 8, edge: 1 } },
    { op: 'place', def: 'core/pond@1', name: 'pond', shape: { area: POND }, params: { depth: 0.3, level: 0, edge: 1 } },
    { op: 'place', def: 'core/lake@1', name: 'lake', shape: { area: LAKE }, params: { depth: 4, level: 0 } },
    { op: 'place', def: 'core/flag@1', name: 'hilltop', p: KNOLL, state: { label: 'hilltop' } },
    { op: 'place', def: 'core/flag@1', name: 'mesa-top', p: [0, 36], state: { label: 'mesa top' } },
    { op: 'place', def: 'core/flag@1', name: 'pond-middle', p: [-24, -4], state: { label: 'pond middle' } },
    { op: 'place', def: 'core/flag@1', name: 'lake-middle', p: [-72, -20], state: { label: 'lake middle' } },
  ], 'G1 ground for Souls'), (r) => r.status === 200 && r.data?.accepted === true);
  await step('G2 the ground is what the god meant: knoll top 6 m, mesa sheer, pond wadable, lake deep', async () => {
    const [k, m, mt, p, l] = await groundAt([KNOLL, [0, 30.2], [0, 36], [-24, -4], [-72, -20]]);
    return { knollY: k.y, mesaEdge: m.medium, mesaTop: mt.y, pond: [p.medium, p.water], lake: [l.medium, l.water] };
  }, (r) => r.knollY > 5.9 && r.mesaEdge === 'steep' && r.mesaTop > 7.9 && r.pond[0] === 'wade' && r.lake[0] === 'swim');

  // the Soul, through the normal owner flow
  let soul;
  await step('S1 the owner creates a Soul and pairs an agent to it (Soul token)', async () => {
    const c = await api('/v1/souls', { as: 'owner', body: { name: 'Wren', description: 'a hill walker who swims in cold lakes' } });
    soul = c.data.soul;
    const code = (await api(`/v1/souls/${soul.id}/pair`, { as: 'owner', body: {} })).data.code;
    const ex = await api('/v1/agent/pair', { as: 'none', body: { code, agent: 'e2e-ground' } });
    soulToken = ex.data.token;
    return { soul: soul?.id, entity: soul?.entityId, token: !!soulToken };
  }, (r) => r.soul && r.token);
  await step('S2 the Soul stands on the ground where it was born (y = tile height)', async () => {
    for (let i = 0; i < 60; i++) { const o = await observe(); if (o?.self?.position) { const [g] = await groundAt([[o.self.position[0], o.self.position[2]]]); return { p: o.self.position, ground: g.y, medium: g.medium }; } await sleep(500); }
    return null;
  }, (r) => r && Math.abs(r.p[1] - r.ground) < 0.02 && ['walk', 'wade'].includes(r.medium));
  await step('S3 the Soul is offered the flags and the lake', async () => (await caps()).map((c) => c.id).filter((id) => /^(walk:flag-|swim:)/.test(id)), (ids) => ['walk:flag-hilltop', 'walk:flag-mesa-top', 'walk:flag-pond-middle', 'swim:lake'].every((x) => ids.includes(x)));

  const hill = await step('S4 the Soul walks to the hilltop flag; its y follows the slope all the way up', async () => {
    // photographed mid-climb: the camera south of the knoll's west flank, the Soul passing about 11 s in
    const r = await shotDuring('soul-climbing-the-knoll', { eye: [12, 7, 16], at: [17, 2.2, 0], afterMs: 11000 }, () => soulDoes('walk:flag-hilltop'));
    report.samples.hill = r.samples;
    const gs = r.samples.length ? await groundAt(r.samples.map((s) => [s.p[0], s.p[2]])) : [];
    const off = r.samples.map((s, i) => Math.abs(s.p[1] - gs[i].y));
    return { phase: r.phase, code: r.code, end: r.end, n: r.samples.length, maxOff: off.length ? Math.max(...off) : null, ys: r.samples.map((s) => s.p[1]) };
  }, (r) => r.phase === 'completed' && near(r.end.p, KNOLL, 1.5) && r.end.p[1] > 5.5 && r.maxOff !== null && r.maxOff < 0.03 && r.ys.filter((y, i) => i && y > r.ys[i - 1] + 0.01).length >= 3);
  await step('S4 the takes carry the climb: the Soul\'s track rises from the field to the knoll top', async () => {
    const d = (await api('/v1/take?after=-1', { as: 'none' })).data;
    const ys = []; for (const c of d.chunks ?? []) for (const k of c.take?.tracks?.[soul.entityId] ?? []) ys.push(k[2] / 1000);
    return { n: ys.length, min: Math.min(...ys), max: Math.max(...ys), rises: ys.filter((y, i) => i && y > ys[i - 1] + 0.005).length };
  }, (r) => r.n > 10 && r.max > 5.5 && r.min < 1 && r.rises >= 5);
  if (hill?.end) {
    const p = hill.end.p;
    await shot('soul-on-the-hill', { eye: [p[0] - 14, p[1] + 6, p[2] + 16], at: [p[0], p[1] + 0.9, p[2]], wait: 9000 });
    await shot('soul-on-the-hill-wide', { eye: [p[0] - 40, p[1] + 22, p[2] + 48], at: [p[0] - 10, 1, p[2] - 4], wait: 6000 });
  }

  await step('S5 the mesa is refused: no footpath up a cliff (ground.cliff, named where)', () => soulDoes('walk:flag-mesa-top'), (r) => (r.code === 'ground.cliff' || r.code === 'ground.steep') && r.phase !== 'completed');
  await step('S6 walking into the lake is refused: water too deep to wade (ground.deep-water)', () => soulDoes('walk:flag-lake-middle'), (r) => r.code === 'ground.deep-water' && r.phase !== 'completed');
  const pond = await step('S7 the Soul wades into the pond: shallow water, standing on the bed, wading', async () => {
    const r = await soulDoes('walk:flag-pond-middle');
    report.samples.pond = r.samples;
    return { phase: r.phase, code: r.code, end: r.end, acts: [...new Set(r.samples.map((s) => s.activity))] };
  }, (r) => r.phase === 'completed' && r.end?.p[1] < -0.1 && (r.acts.includes('wade') || r.end.activity === 'wade' || /wad/.test(r.end.state ?? '')));
  if (pond?.end) await shot('soul-wading', { eye: [pond.end.p[0] + 10, 5, pond.end.p[2] + 12], at: [pond.end.p[0], 0, pond.end.p[2]], wait: 6000 });
  const swim = await step('S8 the Soul swims in the lake: walks to its shore, swims out, treads water with its head above', async () => {
    const r = await soulDoes('swim:lake', { maxS: 300 });
    report.samples.swim = r.samples;
    const [g] = await groundAt([[r.end.p[0], r.end.p[2]]]);
    return { phase: r.phase, code: r.code, reason: r.reason, end: r.end, acts: [...new Set(r.samples.map((s) => s.activity))], depth: g.water };
  }, (r) => r.phase === 'completed' && r.acts.includes('swim') && ['tread', 'swim'].includes(r.end.activity) && r.depth > 3 && Math.abs(r.end.p[1] - -1.2) < 0.05);
  if (swim?.end) await shot('soul-swimming', { eye: [swim.end.p[0] + 12, 5, swim.end.p[2] + 14], at: [swim.end.p[0], 0, swim.end.p[2]], wait: 6000 });
  await step('S9 from the water the Soul walks back to the hilltop: it swims to the shore first, then climbs', async () => {
    const r = await soulDoes('walk:flag-hilltop', { maxS: 400 });
    return { phase: r.phase, code: r.code, reason: r.reason, end: r.end, acts: [...new Set(r.samples.map((s) => s.activity))] };
  }, (r) => r.phase === 'completed' && near(r.end.p, KNOLL, 1.5) && r.acts.includes('swim'));

  await step('G3 the god raises the ground under the standing Soul; the Soul is lifted onto it', async () => {
    const before = (await observe()).self.position;
    const r = await act([{ op: 'place', def: 'core/knoll@1', name: 'cairn', p: [before[0] + 0.5, before[2]], params: { height: 3, radius: 8 } }], 'G3 raise under the Soul');
    let after = before;
    for (let i = 0; i < 40; i++) { await sleep(500); after = (await observe()).self.position; if (after[1] > before[1] + 1) break; }
    const [g] = await groundAt([[after[0], after[2]]]);
    return { accepted: r.data?.accepted, before: before[1], after: after[1], ground: g.y };
  }, (r) => r.accepted && r.after > r.before + 2 && Math.abs(r.after - r.ground) < 0.02);

  await step('R1 restart the world process: the Soul replays onto the same ground', async () => {
    const before = (await observe()).self.position;
    stop(); await sleep(1500);
    await boot();
    let o; for (let i = 0; i < 60; i++) { o = await observe(); if (o?.self?.position) break; await sleep(500); }
    const [g] = await groundAt([[o.self.position[0], o.self.position[2]]]);
    const ok = (await caps()).some((c) => c.id === 'walk:flag-hilltop');
    return { before, after: o.self.position, ground: g.y, capsOk: ok, faulted: /engine fault/.test(serverLog) };
  }, (r) => Math.abs(r.after[1] - r.ground) < 0.02 && Math.hypot(r.after[0] - r.before[0], r.after[2] - r.before[2]) < 0.5 && r.capsOk && !r.faulted);
} catch (e) {
  report.failures.push({ name: 'harness', error: String(e?.stack ?? e) });
  log('harness error', e);
} finally {
  report.summary = { steps: report.steps.length, failed: report.failures.length, bootMs: +bootMs.toFixed(0), faults: (serverLog.match(/engine fault|violat/g) ?? []).length };
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(resolve(out, 'server.log'), serverLog);
  const md = [`# souls on the ground — ${slug} — ${report.startedAt}`, '', `boot ${report.summary.bootMs} ms · ${report.summary.steps} steps · ${report.summary.failed} failed`, '', '| step | ms | ok |', '|---|---:|:-:|', ...report.steps.map((s) => `| ${s.name} | ${s.ms} | ${s.ok ? '✔' : '✖ ' + (s.error ?? JSON.stringify(s.result)).slice(0, 200).replace(/\|/g, '/')} |`), '', '## shots', ...report.shots.map((s) => `- ${s.name}: \`${s.file}\``)].join('\n');
  writeFileSync(resolve(out, 'REPORT.md'), md);
  log(`\n${report.summary.failed ? '✖' : '✔'} ${report.summary.steps} steps, ${report.summary.failed} failed. Report: ${resolve(out, 'REPORT.md')}`);
  if (!args.keep) stop();
  process.exit(report.summary.failed ? 1 : 0);
}
