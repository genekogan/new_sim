#!/usr/bin/env node
// P4 nav proof (party lane): a fresh Soul goes to what the god built, by name, with no flags.
// One fresh world, two players over HTTP:
//   the GOD (god token) builds a fountain, a cottage named rose-house (its front door faces away from the Soul), a plaza
//   with bench-2, a pond with an unnamed bench by it and another unnamed bench by the fountain — and no flags;
//   a SOUL (created and paired through the normal owner flow, acting only through /v1/edge/*) is told, by name: walk to
//   the fountain, go into rose-house (round the house, in at its front door), walk:rose-house/kitchen, walk:plaza/bench-2,
//   sit on the bench by the pond, then walk to the bedroom in rose-house. The plain-word acts go through the real Soul
//   CLI (tools/edge-skill/eden-agent.mjs, unchanged) and the ledger's own vocabulary (unchanged): the world-engine side
//   only offers `walk:<path>` capabilities and labels seats with what they are by. Where she ends up is read from the
//   god's `where` query (room / area), not from any new edge field.
//
//   node tools/god-skill/e2e/nav.mjs [--port 5260] [--keep] [--no-shots]
//
// Harness from souls-r2.mjs. Report under .lane/e2e-nav/<stamp>/.
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
const slug = typeof args.slug === 'string' ? args.slug : 'nav';
const port = Number(args.port ?? 5260);
const out = resolve(root, '.lane/e2e-nav', stamp);
mkdirSync(out, { recursive: true });
const dataDir = resolve(out, 'data');
const base = `http://127.0.0.1:${port}/w/${slug}`;
const report = { slug, port, startedAt: new Date().toISOString(), steps: [], shots: [], failures: [], samples: {} };
const log = (...a) => console.log(...a);
const t = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- the world process (fake minds, dev auth, fresh data dir, local Mars assets)
const marsWeb = resolve(root, '.lane/mars-web');
const env = { ...process.env, ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), WORLD_KEY: slug, WORLD_ID: `${slug}-1`, ENGINE: 'mars', PORT: String(port), DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', DATA_DIR: dataDir, PUBLIC_URL: `http://127.0.0.1:${port}` };
let serverLog = '', server;
const boot = async () => {
  server = spawn(process.execPath, ['apps/server/src/main.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
  server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
  const t0 = t();
  for (let i = 0; i < 3000; i++) { try { const r = await fetch(`${base}/healthz`); if (r.ok) return t() - t0; } catch { } await sleep(100); }
  throw new Error('world did not come up');
};
const stop = () => { try { server?.kill(); } catch { } };
process.on('exit', () => { if (!args.keep) stop(); });

// ---------- clients: the owner (dev identity), the god (god token), the Soul (Soul token)
let godToken = '', soulToken = '';
async function api(path, { method, body, as = 'god' } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (as === 'god') headers.authorization = `Bearer ${godToken}`;
  else if (as === 'soul') headers.authorization = `Bearer ${soulToken}`;
  else if (as && as !== 'none') headers.authorization = `Bearer dev:${as}`;
  const r = await fetch(base + path, { method: method ?? (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000) });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
const summarize = (r) => { try { const s = JSON.stringify(r); return s && s.length > 1500 ? JSON.parse(JSON.stringify(r, (k, v) => (Array.isArray(v) && v.length > 12 ? `[${v.length} items]` : v))) : r; } catch { return String(r); } };
async function step(name, fn, expect) {
  const t0 = t(); let result, error;
  try { result = await fn(); } catch (e) { error = String(e?.stack ?? e?.message ?? e); }
  const ms = t() - t0, okay = !error && (expect ? !!expect(result) : true);
  const brief = summarize(result);
  report.steps.push({ name, ms: +ms.toFixed(0), ok: okay, result: brief, error });
  if (!okay) report.failures.push({ name, result: brief, error });
  log(`${okay ? '✔' : '✖'} ${name} — ${ms.toFixed(0)} ms${okay ? '' : ' — ' + (error ?? JSON.stringify(brief)).slice(0, 500)}`);
  return result;
}
async function until(fn, ms = 120000, every = 500) { const t0 = Date.now(); let last; while (Date.now() - t0 < ms) { last = await fn(); if (last?.ok) return last; await sleep(every); } return last; }
const act = (ops, note) => api('/v1/god/act', { body: { ops, note } });
const entity = async (path) => (await api(`/v1/world/entities/${path}`, { as: 'none' })).data;
const groundAt = async (pts) => (await api('/v1/god/query', { body: { points: pts } })).data.points;
const observe = async () => (await api('/v1/edge/observe', { as: 'soul' })).data;
const caps = async () => (await api('/v1/edge/capabilities', { as: 'soul' })).data.capabilities ?? [];
/** Act as the Soul and follow the receipt to its end, sampling the body (position, level, activity) on the way. */
async function soulDoes(capability, { params, maxS = 240, until: stopWhen } = {}) {
  const r = await api('/v1/edge/act', { body: { capability, ...(params ? { params } : {}) }, as: 'soul' });
  if (!r.data?.accepted) return { accepted: false, code: r.data?.code, reason: r.data?.reason, status: r.status, samples: [], end: null };
  const id = r.data.receipt?.id, samples = [], t0 = Date.now();
  let rec = r.data.receipt;
  while (Date.now() - t0 < maxS * 1000) {
    const o = await observe(); const me = o.self;
    samples.push({ tick: o.tick, p: me.position, activity: me.activity, state: me.state });
    if (stopWhen?.(me)) break;
    if (id) rec = (await api(`/v1/edge/receipts/${encodeURIComponent(id)}`, { as: 'soul' })).data?.receipt ?? rec;
    if (['completed', 'failed', 'replaced'].includes(rec?.phase)) break;
    await sleep(700);
  }
  const o = await observe();
  return { accepted: true, phase: rec?.phase, code: rec?.code, reason: rec?.reason, result: r.data.result, samples, fromTick: r.data.receipt?.acceptedTick ?? samples[0]?.tick ?? 0, toTick: o.tick, end: { p: o.self.position, activity: o.self.activity, state: o.self.state } };
}
const near = (p, q, d) => Math.hypot(p[0] - q[0], p[2] - q[1]) <= d;

// ---------- screenshots (Chrome via the viewer's Playwright; one Chrome machine-wide via the lease)
let chromium = null;
if (!args['no-shots']) try { chromium = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test').chromium; } catch { log('  (no @playwright/test; screenshots skipped)'); }
const shotUrl = ({ eye, at, wait = 4000, hideRoofs = false }) => {
  const q = new URLSearchParams({ dev: '1', shot: '1', settle: String(wait), ...(hideRoofs ? { hideRoofs: '1' } : {}) });
  if (eye) q.set('eye', eye.map((v) => v.toFixed(2)).join(',')); if (at) q.set('at', at.map((v) => v.toFixed(2)).join(','));
  return `${base}?${q}`;
};
async function withPage(fn) {
  const release = await chromeLease('nav').catch(() => null);
  if (!release) { log('  (chrome lease busy; screenshot skipped)'); return false; }
  let browser = null;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => { localStorage.setItem('sim.dev', 'admin'); });
    return await fn(await ctx.newPage());
  } finally { if (browser) await browser.close().catch(() => { }); release(); }
}
async function load(page, opts) {
  await page.goto(shotUrl(opts), { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 150_000 }).catch(() => log('  (shot not ready in 150 s; taking it anyway)'));
}
async function snap(page, name) {
  const file = resolve(out, `${name}.png`);
  await page.screenshot({ path: file, timeout: 120_000 });
  report.shots.push({ name, file });
  log(`  📷 ${name}.png`);
}
/** Several stills in one browser session: [{ name, eye, at, wait, hideRoofs }]. */
async function shots(list) {
  if (!chromium) return;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { if (await withPage(async (page) => { for (const s of list) { await load(page, s); await page.waitForTimeout(s.extra ?? 2500); await snap(page, s.name); } return true; })) return; }
    catch (e) { log('  (screenshot failed: ' + String(e.message).split('\n')[0] + ')'); }
  }
}
/** Open the page first, then start `run` (a Soul's walk) and photograph it `afterMs` later, mid-motion. */
async function shotDuring(name, opts, run) {
  if (!chromium) return run();
  let p = null;
  try {
    await withPage(async (page) => {
      await load(page, { ...opts, wait: 3000 }); p = run();
      // photograph when the body is where the camera looks (`when(self)`), or after `afterMs` at the latest
      const t0 = Date.now();
      while (Date.now() - t0 < (opts.afterMs ?? 10000)) { if (opts.when) { const o = await observe().catch(() => null); if (o?.self?.position && opts.when(o.self)) { await sleep(1200); break; } } await sleep(400); }
      await snap(page, name); return true;
    });
  } catch (e) { log('  (mid-motion screenshot failed: ' + String(e.message).split('\n')[0] + ')'); }
  return p ?? run();
}


// ---------- the Soul CLI (Codex's eden-agent.mjs, unchanged), in its own private folder
import { execFile } from 'node:child_process';
const cliDir = resolve(out, 'soul-cli'); mkdirSync(cliDir, { recursive: true });
const CLI = resolve(root, 'tools/edge-skill/eden-agent.mjs');
function cli(...argv) {
  return new Promise((ok) => execFile(process.execPath, [CLI, ...argv], { cwd: cliDir, timeout: 120_000, env: { ...process.env, EDEN_AGENT_NO_DASHBOARD: '1' } }, (err, stdout, stderr) => {
    const s = String(stdout); let data = null; try { data = JSON.parse(s.slice(s.indexOf('{'))); } catch { }
    ok({ code: err?.code ?? 0, data, stderr: String(stderr).slice(0, 400), raw: data ? undefined : s.slice(0, 400) });
  }));
}
/** Follow an accepted act's receipt to its end, sampling the body. */
async function follow(acted, { maxS = 240, until: stopWhen } = {}) {
  if (!acted?.accepted) return { accepted: false, code: acted?.code, reason: acted?.reason, samples: [], end: null };
  const id = acted.receipt?.id, samples = []; let rec = acted.receipt; const t0 = Date.now();
  while (Date.now() - t0 < maxS * 1000) {
    const o = await observe(); const me = o.self;
    samples.push({ tick: o.tick, p: me.position, activity: me.activity, state: me.state });
    if (stopWhen?.(me)) break;
    if (id) rec = (await api(`/v1/edge/receipts/${encodeURIComponent(id)}`, { as: 'soul' })).data?.receipt ?? rec;
    if (['completed', 'failed', 'replaced'].includes(rec?.phase)) break;
    await sleep(700);
  }
  const o = await observe();
  const w = o.self.position ? (await api('/v1/god/query', { body: { where: [o.self.position[0], o.self.position[2]] } })).data.where : null;
  return { accepted: true, resolved: acted.resolved, phase: rec?.phase, code: rec?.code, reason: rec?.reason, samples, end: { p: o.self.position, activity: o.self.activity, state: o.self.state }, room: w?.room ?? null, on: (w?.inside ?? []).map((x) => x.path) };
}
const walked = (s) => s.reduce((l, x, i) => (i ? l + Math.hypot(x.p[0] - s[i - 1].p[0], x.p[2] - s[i - 1].p[2]) : 0), 0);
const minDist = (s, q) => Math.min(...s.map((x) => Math.hypot(x.p[0] - q[0], x.p[2] - q[1])));

// ================================================================ the scenario
// layout (metres): the Soul is born near the origin. The fountain east; rose-house north-west with its front door on its
// far (north) side, so going in means walking round it; the plaza south-east; the pond south-west with a bench on its
// north bank; another bench by the fountain (so "the bench" alone is ambiguous).
const FOUNTAIN = [16, 6], HOUSE = [-8, 20], PLAZA = [[12, -32], [32, -32], [32, -16], [12, -16]], BENCH2 = [22, -24];
const POND = [[-36, -22], [-24, -22], [-24, -10], [-36, -10]], POND_BENCH = [-30, -7], FOUNTAIN_BENCH = [16, 11];
const ids = {};
let soul = null, door = null, bootMs = 0;
try {
  bootMs = await boot();
  log(`▶ world "${slug}" on :${port} booted in ${bootMs.toFixed(0)} ms`);
  await step('G0 the owner mints a god token for the new world', async () => { const r = await api('/v1/god/mint', { as: 'admin', body: { label: 'e2e nav' } }); godToken = r.data.token; return { status: r.status, token: !!godToken }; }, (r) => r.status === 200 && r.token);
  await step('G1 the god builds a fountain, rose-house, a plaza with bench-2, a pond with a bench by it, a bench by the fountain — no flags', () => act([
    { op: 'place', def: 'core/fountain@1', name: 'fountain', p: FOUNTAIN },
    { op: 'place', def: 'core/cottage@1', name: 'rose-house', p: HOUSE },
    { op: 'place', tmp: '$pl', def: 'core/plaza@1', name: 'plaza', shape: { area: PLAZA } },
    { op: 'place', def: 'core/bench@1', name: 'bench-2', in: { parent: '$pl' }, p: BENCH2 },
    { op: 'place', def: 'core/pond@1', name: 'pond', shape: { area: POND }, params: { depth: 0.3, level: 0, edge: 1 } },
    { op: 'place', def: 'core/bench@1', p: POND_BENCH, r: Math.PI },
    { op: 'place', def: 'core/bench@1', p: FOUNTAIN_BENCH },
  ], 'a little town for Souls'), (r) => r.status === 200 && r.data?.accepted === true);
  for (const p of ['fountain', 'rose-house', 'plaza', 'plaza/bench-2', 'pond']) ids[p] = (await entity(p)).entity?.id;
  await step('G2 rose-house has a front door (on its far side from the Soul) and rooms', async () => {
    const e = (await api('/v1/god/query', { body: { describe: 'rose-house' } })).data.describe;
    door = (e?.openings ?? []).find((o) => o.kind === 'door' && /front/.test(o.id)) ?? null;
    const where = (await api('/v1/god/query', { body: { where: POND_BENCH } })).data.where;
    ids.pondBench = where?.near?.find((x) => x.def?.includes('bench'))?.path;
    const fb = (await api('/v1/god/query', { body: { where: FOUNTAIN_BENCH } })).data.where;
    ids.fountainBench = fb?.near?.find((x) => x.def?.includes('bench'))?.path;
    return { door, rooms: (e?.rooms ?? []).map((r) => r.id), pondBench: ids.pondBench, fountainBench: ids.fountainBench };
  }, (r) => r.door && r.door.at[1] > HOUSE[1] && r.rooms.length >= 2 && r.pondBench && r.fountainBench && r.pondBench !== r.fountainBench);
  await shots([{ name: 'g-town-built', eye: [30, 30, 40], at: [-4, 0, -4], wait: 6000 }]);

  // ======================== SOUL: born through the owner flow, paired, acting via /v1/edge (and the CLI)
  await step('S0 an owner is invited and creates a Soul "Ana"; the owner pairs an agent, which gets a Soul token', async () => {
    const inv = await api('/v1/admin', { as: 'admin', body: { action: 'invite', uses: 1 } });
    await api('/v1/invite', { as: 'ana', body: { code: inv.data.code } });
    const s = await api('/v1/souls', { as: 'ana', body: { name: 'Ana', description: 'a walker who likes fountains and benches' } });
    soul = s.data.soul;
    const c = await api(`/v1/souls/${soul.id}/pair`, { as: 'ana', body: {} });
    const x = await api('/v1/agent/pair', { as: 'none', body: { code: c.data.code, agent: 'e2e nav agent' } });
    soulToken = x.data.token;
    // the Soul CLI's private folder: this world, this Soul, its token (what `register` + `create-soul` would have saved)
    writeFileSync(resolve(cliDir, '.eden-agent.json'), JSON.stringify({ world: base, identity: 'ana', soul: soul.id, token: soulToken, mode: 'edge' }, null, 1));
    for (let i = 0; i < 60; i++) { const o = await observe(); if (o?.self?.position) return { soul: soul.id, token: !!soulToken, at: o.self.position }; await sleep(500); }
    return { soul: soul?.id, token: !!soulToken };
  }, (r) => r.token && r.at);
  await step('S1 her capabilities offer the god\'s things by name (walk:fountain, walk:rose-house and its rooms, walk:plaza/bench-2, walk:pond), and no flags exist', () => until(async () => {
    const c = (await caps()).map((x) => x.id);
    const want = ['walk:fountain', 'walk:rose-house', 'walk:rose-house/living', 'walk:plaza', 'walk:plaza/bench-2', 'walk:pond'];
    return { ok: want.every((w) => c.includes(w)) && !c.some((x) => x.startsWith('walk:flag-')), missing: want.filter((w) => !c.includes(w)), flags: c.filter((x) => x.startsWith('walk:flag-')), walks: c.filter((x) => x.startsWith('walk:')), seats: (await caps()).filter((x) => x.verb === 'sit' && x.target).map((x) => x.label) };
  }, 30000), (r) => r?.ok);
  await step('S1 the Soul CLI (unchanged) sees them too: observe → canDo has walk:fountain and walk:rose-house/living', async () => {
    const r = await cli('observe'); const ids_ = (r.data?.canDo?.available ?? []).map((c) => c.id);
    return { code: r.code, n: ids_.length, has: ids_.filter((x) => ['walk:fountain', 'walk:rose-house', 'walk:rose-house/living'].includes(x)), err: r.stderr || r.raw };
  }, (r) => r.code === 0 && r.has.length === 3);

  // ---- 1. the fountain, in plain words through the CLI
  const f1 = await step('S2 CLI: act "walk to the fountain" → walk:fountain; she walks there and stands at its rim', async () => {
    const a = await cli('act', 'walk to the fountain');
    const r = await shotDuring('s2-walking-to-the-fountain', { eye: [FOUNTAIN[0] + 8, 5, FOUNTAIN[1] + 12], at: [FOUNTAIN[0] - 4, 1, FOUNTAIN[1]], afterMs: 25000, when: (me) => Math.hypot(me.position[0] - FOUNTAIN[0], me.position[2] - FOUNTAIN[1]) < 6 }, () => follow(a.data));
    report.samples.fountain = r.samples;
    return { cli: { code: a.code, accepted: a.data?.accepted, resolved: a.data?.resolved }, phase: r.phase, code: r.code, reason: r.reason, end: r.end, dist: r.end ? +Math.hypot(r.end.p[0] - FOUNTAIN[0], r.end.p[2] - FOUNTAIN[1]).toFixed(2) : null, walked: +walked(r.samples).toFixed(1) };
  }, (r) => r.cli.accepted && r.cli.resolved?.to === 'walk:fountain' && r.phase === 'completed' && r.dist < 3.5);

  // ---- 2. rose-house: round it, in at its front door; then a room by path
  const f3 = await step('S3 CLI: act "go into rose-house" → walk:rose-house; she walks round the house and in at its front door', async () => {
    const a = await cli('act', 'go into rose-house');
    const r = await follow(a.data);
    report.samples.enter = r.samples;
    return { cli: { code: a.code, accepted: a.data?.accepted, resolved: a.data?.resolved, reason: a.data?.reason }, phase: r.phase, code: r.code, reason: r.reason, end: r.end, room: r.room, viaDoor: door ? +minDist(r.samples, door.at).toFixed(2) : null, walked: +walked(r.samples).toFixed(1) };
  }, (r) => r.cli.accepted && r.cli.resolved?.to === 'walk:rose-house' && r.phase === 'completed' && r.room?.building === 'rose-house' && r.viaDoor < 1.2);
  { const p = f3?.end?.p; if (p) await shots([{ name: 's3-inside-rose-house-roof-hidden', eye: [p[0] + 2, p[1] + 7, p[2] - 6], at: [p[0], p[1] + 0.9, p[2]], wait: 7000, hideRoofs: true }]); }
  await step('S4 act walk:rose-house/kitchen → from the hall into the kitchen', async () => {
    const a = (await api('/v1/edge/act', { as: 'soul', body: { capability: 'walk:rose-house/kitchen' } })).data;
    const r = await follow(a);
    return { accepted: a.accepted, phase: r.phase, code: r.code, reason: r.reason, end: r.end, room: r.room };
  }, (r) => r.accepted && r.phase === 'completed' && r.room?.building === 'rose-house' && r.room.room === 'kitchen');

  // ---- 3. a bench in the plaza, by path
  await step('S5 act walk:plaza/bench-2 → out of the house and across to the plaza\'s bench', async () => {
    const a = (await api('/v1/edge/act', { as: 'soul', body: { capability: 'walk:plaza/bench-2' } })).data;
    const r = await follow(a, { maxS: 300 });
    return { accepted: a.accepted, phase: r.phase, code: r.code, reason: r.reason, end: r.end, dist: r.end ? +Math.hypot(r.end.p[0] - BENCH2[0], r.end.p[2] - BENCH2[1]).toFixed(2) : null, on: r.on, walked: +walked(r.samples).toFixed(1) };
  }, (r) => r.accepted && r.phase === 'completed' && r.dist < 2 && (r.on ?? []).includes('plaza'));

  // ---- 4. the bench by the pond (unnamed; another unnamed bench is by the fountain, bench-2 is nearer her)
  const f5 = await step('S6 CLI: act "sit on the bench by the pond" → the pond\'s bench (not bench-2, not the fountain\'s); she walks over and sits', async () => {
    const a = await cli('act', 'sit on the bench by the pond', '{"seconds":600}');
    const r = await follow(a.data, { maxS: 300, until: (me) => me.activity === 'sit' });
    const used = (await api('/v1/god/query', { body: { entity: ids.pondBench } })).data.entity?.usedBy;
    return { cli: { code: a.code, accepted: a.data?.accepted, resolved: a.data?.resolved, reason: a.data?.reason }, end: r.end, usedBy: used, dist: r.end ? +Math.hypot(r.end.p[0] - POND_BENCH[0], r.end.p[2] - POND_BENCH[1]).toFixed(2) : null };
  }, (r) => r.cli.accepted && /^sit:/.test(r.cli.resolved?.to ?? '') && r.end?.activity === 'sit' && r.usedBy?.soul === 'Ana' && r.dist < 1.5);
  { const p = f5?.end?.p; if (p) await shots([{ name: 's6-on-the-bench-by-the-pond', eye: [p[0] + 5, p[1] + 3.5, p[2] + 6], at: [p[0], p[1] + 0.7, p[2] - 2], wait: 6000 }]); }

  // ---- 5. from the seat, by words naming a room: she stands up and walks into the bedroom
  await step('S7 CLI: act "walk to the bedroom in rose-house" → walk:rose-house/bedroom; she stands up and walks into it', async () => {
    const a = await cli('act', 'walk to the bedroom in rose-house');
    const r = await follow(a.data, { maxS: 300 });
    return { cli: { code: a.code, accepted: a.data?.accepted, resolved: a.data?.resolved, reason: a.data?.reason }, phase: r.phase, end: r.end, room: r.room };
  }, (r) => r.cli.accepted && r.cli.resolved?.to === 'walk:rose-house/bedroom' && r.phase === 'completed' && r.room?.room === 'bedroom');
  { const p = (await observe())?.self?.position; if (p) await shots([{ name: 's7-in-the-bedroom-roof-hidden', eye: [p[0] + 5, p[1] + 8, p[2] - 3], at: [p[0], p[1] + 0.9, p[2]], wait: 7000, hideRoofs: true }]); }
  await step('S8 nothing faulted: no engine faults or violations in the server log', async () => ({ faults: (serverLog.match(/engine fault|violat/g) ?? []).length }), (r) => r.faults === 0);
  void f1;
} catch (e) {
  report.failures.push({ name: 'harness', error: String(e?.stack ?? e) });
  log('harness error', e);
} finally {
  report.summary = { steps: report.steps.length, failed: report.failures.length, bootMs: +bootMs.toFixed(0), faults: (serverLog.match(/engine fault|violat/g) ?? []).length };
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(resolve(out, 'server.log'), serverLog);
  const md = [`# P4 nav proof (god + Soul, by name, no flags) — ${slug} — ${report.startedAt}`, '', `boot ${report.summary.bootMs} ms · ${report.summary.steps} steps · ${report.summary.failed} failed · engine faults/violations in log: ${report.summary.faults}`, '', '| step | ms | ok |', '|---|---:|:-:|', ...report.steps.map((s) => `| ${s.name} | ${s.ms} | ${s.ok ? '✔' : '✖ ' + (s.error ?? JSON.stringify(s.result)).slice(0, 240).replace(/\|/g, '/')} |`), '', '## shots', ...report.shots.map((s) => `- ${s.name}: \`${s.file}\``)].join('\n');
  writeFileSync(resolve(out, 'REPORT.md'), md);
  log(`\n${report.summary.failed ? '✖' : '✔'} ${report.summary.steps} steps, ${report.summary.failed} failed. Report: ${resolve(out, 'REPORT.md')}`);
  if (!args.keep) stop();
  process.exit(report.summary.failed ? 1 : 0);
}
