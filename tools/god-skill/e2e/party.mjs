#!/usr/bin/env node
// F1 party proof: tonight's staging-rehearsal failures, reproduced and passing. One fresh world (launcher env: edge
// minds, Soul lifecycle), two players:
//   the GOD, through its own CLI (eden-god.mjs) as at the rehearsal, builds a fountain with benches and a lamp, a sign
//   with text, a roundhouse furnished plus two extra chairs round its table and a hearth, a pond with a jetty and a
//   canoe moored alongside it;
//   a SOUL (owner flow, the unchanged Soul CLI) walks to the fountain and sees it, looks at it, reads the sign, walks
//   into the cottage's living room, walks out onto the jetty, boards the canoe, sits on a bench by the fountain (the
//   bench then shows taken), and the god's map shows her there.
//
//   node tools/god-skill/e2e/party.mjs [--port 5266] [--keep] [--no-shots]
//
// Harness from nav.mjs. Report under .lane/e2e-party/<stamp>/.
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
const slug = typeof args.slug === 'string' ? args.slug : 'party';
const port = Number(args.port ?? 5260);
const out = resolve(root, '.lane/e2e-party', stamp);
mkdirSync(out, { recursive: true });
const dataDir = resolve(out, 'data');
const base = `http://127.0.0.1:${port}/w/${slug}`;
const report = { slug, port, startedAt: new Date().toISOString(), steps: [], shots: [], failures: [], samples: {} };
const log = (...a) => console.log(...a);
const t = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- the world process (fake minds, dev auth, fresh data dir, local Mars assets)
const marsWeb = resolve(root, '.lane/mars-web');
const env = { ...process.env, ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), WORLD_KEY: slug, WORLD_ID: `${slug}-1`, ENGINE: 'mars', PORT: String(port), DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', SOUL_LIFECYCLE: '1', INVITE_REQUIRED: '0', MIND_DRIVER: 'edge', DATA_DIR: dataDir, PUBLIC_URL: `http://127.0.0.1:${port}` };
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
  const release = await chromeLease('party').catch(() => null);
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

const godDir = resolve(out, 'god-cli'); mkdirSync(godDir, { recursive: true });
const GOD = resolve(root, 'tools/god-skill/eden-god.mjs');
function god(...argv) {
  return new Promise((ok) => execFile(process.execPath, [GOD, ...argv], { cwd: godDir, timeout: 180_000, env: { ...process.env, EDEN_GOD_NO_LEASE: '1' } }, (err, stdout, stderr) => ok({ code: err?.code ?? 0, out: String(stdout), err: String(stderr).slice(0, 400) })));
}
const describe = async (ref) => (await api('/v1/god/query', { body: { describe: ref } })).data.describe;
const idOf = async (path) => (await entity(path)).entity?.id;

// ================================================================ the scenario: tonight's rehearsal failures
// layout (as Party Hill): fountain + two benches + a sign up north; moss-cottage (a roundhouse) west of the fountain,
// furnished, with the god's two extra chairs round its table and a hearth; a pond south-east with a jetty from its south
// bank and the canoe moored alongside the jetty (the god's own last fix in the rehearsal).
const FOUNTAIN = [0, -20], SIGN = [4, -12], COTTAGE = [-16, -20], JETTY_END = [16, 15.5];
const built = [
  ['place', 'fountain', '--at', '0,-20', '--name', 'fountain'],
  ['place', 'bench', '--near', 'fountain', '--count', '2', '--facing', 'fountain', '--dist', '2.5', '--name', 'plaza-bench'],
  ['place', 'lamp-post', '--near', 'fountain', '--dir', 'e', '--dist', '4', '--name', 'fountain-lamp'],
  ['place', 'sign', '--at', '4,-12', '--facing', 's', '--state', '{"text":"Welcome to Party Hill\\nfountain · plaza benches\\nmoss-cottage (west)"}', '--name', 'welcome-sign'],
  ['place', 'roundhouse', '--at', '-16,-20', '--facing', 'fountain', '--name', 'moss-cottage'],
  ['furnish', 'moss-cottage'],
  ['place', 'chair', '--inside', 'moss-cottage/living', '--count', '2', '--facing', 'moss-cottage/living-table', '--name', 'moss-chair'],
  ['place', 'hearth', '--inside', 'moss-cottage/living', '--wall', 'back', '--name', 'moss-hearth'],
  ['place', 'pond', '--circle', '14,12,7', '--name', 'pond'],
  ['place', 'pier', '--path', '[[17.5,22],[16,15.5]]', '--param', 'width=1.6', '--param', 'platform=2.5', '--param', 'height=0.4', '--name', 'pond-jetty'],
  ['place', 'canoe', '--float', '--at', 'pond', '--name', 'pond-canoe'],
  ['move', 'pond-canoe', '--at', '14.5,17.6', '--facing', 'e'],
];
const ids = {};
let soul = null, bootMs = 0;
try {
  bootMs = await boot();
  log(`▶ world "${slug}" on :${port} booted in ${bootMs.toFixed(0)} ms`);
  await step('G0 the owner mints a god token; the god CLI is set up in its own folder', async () => {
    const r = await api('/v1/god/mint', { as: 'admin', body: { label: 'e2e party' } }); godToken = r.data.token;
    writeFileSync(resolve(godDir, '.eden-god.json'), JSON.stringify({ world: base, token: godToken }, null, 1));
    return { status: r.status, token: !!godToken };
  }, (r) => r.status === 200 && r.token);
  await step('G1 the god builds (CLI, as at the rehearsal): fountain, benches, a lamp, a sign with text, a furnished roundhouse with two extra chairs and a hearth, a pond, a jetty, a canoe moored alongside it', async () => {
    const res = [];
    for (const c of built) { const r = await god(...c); res.push({ cmd: c.slice(0, 2).join(' '), ok: r.code === 0 && !/REFUSED/.test(r.out), out: r.out.split('\n')[0].slice(0, 160) }); }
    return { all: res.every((x) => x.ok), res };
  }, (r) => r.all);
  for (const p of ['fountain', 'fountain-lamp', 'welcome-sign', 'moss-cottage', 'pond-jetty', 'pond-canoe', 'plaza-bench-1', 'plaza-bench-2']) ids[p] = await idOf(p);
  await shots([{ name: 'g-party-built', eye: [26, 22, 34], at: [-2, 0, -4], wait: 6000 }]);

  // ======================== SOUL Ana: owner flow, Soul CLI (unchanged)
  await step('S0 an owner creates a Soul "Ana" and pairs an agent (the normal flow); her CLI folder is set up', async () => {
    const s = await api('/v1/souls', { as: 'ana', body: { name: 'Ana', description: 'a party guest' } });
    soul = s.data.soul;
    const c = await api(`/v1/souls/${soul.id}/pair`, { as: 'ana', body: {} });
    const x = await api('/v1/agent/pair', { as: 'none', body: { code: c.data.code, agent: 'e2e party agent' } });
    soulToken = x.data.token;
    writeFileSync(resolve(cliDir, '.eden-agent.json'), JSON.stringify({ world: base, identity: 'ana', soul: soul.id, token: soulToken, mode: 'edge' }, null, 1));
    for (let i = 0; i < 60; i++) { const o = await observe(); if (o?.self?.position) return { soul: soul.id, token: !!soulToken, at: o.self.position }; await sleep(500); }
    return { soul: soul?.id, token: !!soulToken };
  }, (r) => r.token && r.at);

  // ---- 1. the fountain: walk there, see it, look at it
  await step('S1 CLI: act "walk to the fountain" → she walks there', async () => {
    const a = await cli('act', 'walk to the fountain'); const r = await follow(a.data);
    return { accepted: a.data?.accepted, resolved: a.data?.resolved?.to, phase: r.phase, dist: r.end ? +Math.hypot(r.end.p[0] - FOUNTAIN[0], r.end.p[2] - FOUNTAIN[1]).toFixed(2) : null };
  }, (r) => r.accepted && r.phase === 'completed' && r.dist < 4);
  await step('S2 here.objects lists the fountain, its lamp and the welcome sign as things she sees (readable)', async () => {
    const r = await cli('here'); const objs = r.data?.objects ?? [];
    return { objects: objs.map((o) => `${o.kind}:${o.name}`), has: ['fountain', 'fountain-lamp', 'welcome-sign'].filter((n) => objs.some((o) => o.name === n)) };
  }, (r) => r.has.includes('fountain') && r.has.length >= 2);
  await step('S3 CLI: act look fountain → accepted (it was target.not-in-sight); view names the fountain', async () => {
    const a = await cli('act', 'look', 'fountain');
    const v = await cli('view', '--alt-only');
    const alt = JSON.stringify(v.data ?? v.raw ?? '');
    return { accepted: a.data?.accepted, code: a.data?.code, chosen: a.data?.chosen ?? a.data?.receipt?.capability, viewSaysFountain: /fountain/i.test(alt), alt: alt.slice(0, 300) };
  }, (r) => r.accepted && r.viewSaysFountain);
  await step('S4 `object <fountain id>` answers (it was 404 "no such object here"): what it is and what it is by', async () => {
    const r = await cli('object', ids.fountain); const o = r.data?.object;
    return { code: r.code, name: o?.name, what: o?.state?.what };
  }, (r) => r.name === 'fountain' && /fountain/.test(r.what ?? ''));

  // ---- 2. the sign
  const f5 = await step('S5 CLI: act "read the welcome-sign" → read:<sign> (its words in the label); she walks up and faces it; `object` gives the text', async () => {
    const res = await cli('resolve', 'read the welcome-sign');
    const a = await cli('act', 'read the welcome-sign'); const r = await follow(a.data);
    const o = (await cli('object', ids['welcome-sign'])).data?.object;
    return { label: res.data?.would?.label, resolved: a.data?.resolved?.to ?? a.data?.receipt?.capability, phase: r.phase, text: o?.state?.text, dist: r.end ? +Math.hypot(r.end.p[0] - SIGN[0], r.end.p[2] - SIGN[1]).toFixed(2) : null };
  }, (r) => /Welcome to Party Hill/.test(r.label ?? '') && r.resolved === `read:${ids['welcome-sign']}` && r.phase === 'completed' && /Welcome to Party Hill/.test(r.text ?? '') && r.dist < 2.5);
  { const p = f5?.result?.dist !== undefined ? (await observe()).self.position : null; if (p) await shots([{ name: 's5-reading-the-sign', eye: [p[0] + 2.5, p[1] + 2.2, p[2] + 4], at: [SIGN[0], 1, SIGN[1]], wait: 6000 }]); }

  // ---- 3. the cottage's living room (furnished + the god's extra chairs)
  const f6 = await step('S6 act walk:moss-cottage/living (furnished, two extra chairs, a hearth) → resolve and act agree; she ends inside the living room', async () => {
    const res = await cli('resolve', 'walk:moss-cottage/living');
    const a = (await api('/v1/edge/act', { as: 'soul', body: { capability: 'walk:moss-cottage/living' } })).data;
    const r = await follow(a, { maxS: 200 });
    return { resolveOk: res.data?.ok, available: res.data?.would?.available, accepted: a.accepted, code: a.code ?? r.code, phase: r.phase, room: r.room };
  }, (r) => r.accepted && r.phase === 'completed' && r.room?.building === 'moss-cottage' && r.room.room === 'living');
  { const p = f6?.end?.p ?? (await observe()).self.position; if (p) await shots([{ name: 's6-in-the-living-room-roof-hidden', eye: [p[0] + 3, p[1] + 7, p[2] + 4], at: [p[0], p[1] + 0.8, p[2]], wait: 7000, hideRoofs: true }]); }

  // ---- 4. the jetty, then the canoe moored alongside it
  const f7 = await step('S7 CLI: act walk:pond-jetty → she walks out onto the deck to its end (it was route.unreachable)', async () => {
    const a = await cli('act', 'walk:pond-jetty'); const r = await follow(a.data, { maxS: 200 });
    return { accepted: a.data?.accepted, code: a.data?.code ?? r.code, reason: r.reason, phase: r.phase, end: r.end, dist: r.end ? +Math.hypot(r.end.p[0] - JETTY_END[0], r.end.p[2] - JETTY_END[1]).toFixed(2) : null, on: r.on, water: (await api('/v1/god/query', { body: { points: [[r.end?.p[0] ?? 0, r.end?.p[2] ?? 0]] } })).data.points?.[0]?.medium, onDeck: (r.on ?? []).includes('pond-jetty') && r.end?.state === 'standing' };
  }, (r) => r.accepted && r.phase === 'completed' && r.dist < 2 && r.onDeck);
  const f8 = await step('S8 CLI: act sit:<canoe> → she boards the canoe from the jetty (it was slot.unreachable); the god sees her in its seat', async () => {
    const a = await cli('act', `sit:${ids['pond-canoe']}`, '{"seconds":120}');
    const r = await follow(a.data, { maxS: 120, until: (me) => me.activity === 'sit' });
    const d = await describe('pond-canoe');
    return { accepted: a.data?.accepted, code: a.data?.code, reason: a.data?.reason, end: r.end, seats: (d?.slots ?? []).filter((s) => s.kind === 'seat').map((s) => `${s.id} ${s.used}/${s.capacity} ${s.occupants?.join(',') ?? ''}`) };
  }, (r) => r.accepted && r.end?.activity === 'sit' && r.seats.some((s) => /Ana/.test(s)));
  { const p = f8?.end?.p; if (p) await shots([{ name: 's8-in-the-canoe-by-the-jetty', eye: [p[0] - 4, p[1] + 3, p[2] + 6], at: [p[0], p[1] + 0.3, p[2]], wait: 6000 }]); }

  // ---- 5. a bench by the fountain: sit:here names it, she sits, the bench shows taken, the god's map shows her there
  await step('S9 back at the fountain, observe → sit:here names the nearest free bench (it said "no free seat within 30 m")', async () => {
    const a = await cli('act', 'walk:fountain'); await follow(a.data, { maxS: 200 });
    const o = await cli('observe'); const sh = [...(o.data?.doHere ?? []), ...(o.data?.canDo?.available ?? [])].find((c) => c.id === 'sit:here');
    return { label: sh?.label };
  }, (r) => /nearest free seat \(plaza-bench/.test(r.label ?? ''));
  const f10 = await step('S10 CLI: act sit:here → she sits on that bench; describe shows the seat taken by Ana; to her it is seat.yours (not free)', async () => {
    const a = await cli('act', 'sit:here', '{"seconds":300}');
    const r = await follow(a.data, { maxS: 120, until: (me) => me.activity === 'sit' });
    await sleep(1500);
    const bench = ['plaza-bench-1', 'plaza-bench-2'].find(Boolean) && (await Promise.all(['plaza-bench-1', 'plaza-bench-2'].map(async (b) => ({ b, d: await describe(b) })))).find((x) => (x.d?.slots ?? []).some((s) => (s.occupants ?? []).includes('Ana')));
    const mine = (await caps()).find((c) => bench && c.id === `sit:${ids[bench.b]}`);
    const here = (await cli('here')).data?.objects?.find((o) => bench && o.id === ids[bench.b]);
    return { accepted: a.data?.accepted, activity: r.end?.activity, bench: bench?.b, slots: bench?.d?.slots?.filter((s) => s.kind === 'seat').map((s) => `${s.id} ${s.used}/${s.capacity} ${s.occupants?.join(',') ?? ''}`), myCap: mine ? { available: mine.available, blocked: mine.blocked?.code } : null, hereFree: here?.free, at: r.end?.p };
  }, (r) => r.accepted && r.activity === 'sit' && r.bench && r.myCap?.blocked === 'seat.yours' && r.hereFree === false);
  await step('S11 the god\'s map shows Ana at that bench (it showed Souls at the spawn)', async () => {
    let line = '', d = Infinity;
    for (let i = 0; i < 20; i++) {
      const m = await god('map'); line = m.out.split('\n').find((l) => /^- ana \[core\/humanoid/.test(l)) ?? '';
      const at = /at \(([-\d.]+), ([-\d.]+), ([-\d.]+)\)/.exec(line); const p = f10?.at;
      if (at && p) { d = Math.hypot(+at[1] - p[0], +at[3] - p[2]); if (d < 1) break; }
      await sleep(1000);
    }
    return { line, dist: +d.toFixed(2) };
  }, (r) => r.dist < 1);
  { const p = (await observe())?.self?.position; if (p) await shots([{ name: 's10-on-the-bench-by-the-fountain', eye: [p[0] + 4, p[1] + 3, p[2] + 6], at: [FOUNTAIN[0], 0.8, FOUNTAIN[1]], wait: 6000 }]); }
  await step('S12 nothing faulted: no engine faults or violations in the server log', async () => ({ faults: (serverLog.match(/engine fault|violat/g) ?? []).length, refused: (serverLog.match(/write-back refused/g) ?? []).length }), (r) => r.faults === 0);
} catch (e) {
  report.failures.push({ name: 'harness', error: String(e?.stack ?? e) });
  log('harness error', e);
} finally {
  report.summary = { steps: report.steps.length, failed: report.failures.length, bootMs: +bootMs.toFixed(0), faults: (serverLog.match(/engine fault|violat/g) ?? []).length };
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(resolve(out, 'server.log'), serverLog);
  const md = [`# F1 party proof (rehearsal failures) — ${slug} — ${report.startedAt}`, '', `boot ${report.summary.bootMs} ms · ${report.summary.steps} steps · ${report.summary.failed} failed · engine faults/violations in log: ${report.summary.faults}`, '', '| step | ms | ok |', '|---|---:|:-:|', ...report.steps.map((s) => `| ${s.name} | ${s.ms} | ${s.ok ? '✔' : '✖ ' + (s.error ?? JSON.stringify(s.result)).slice(0, 240).replace(/\|/g, '/')} |`), '', '## shots', ...report.shots.map((s) => `- ${s.name}: \`${s.file}\``)].join('\n');
  writeFileSync(resolve(out, 'REPORT.md'), md);
  log(`\n${report.summary.failed ? '✖' : '✔'} ${report.summary.steps} steps, ${report.summary.failed} failed. Report: ${resolve(out, 'REPORT.md')}`);
  if (!args.keep) stop();
  process.exit(report.summary.failed ? 1 : 0);
}
