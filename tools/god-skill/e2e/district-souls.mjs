#!/usr/bin/env node
// R2 "eden-two runs with a few fresh Souls" (plan <eden4>/33 §7 R2; §9: eden-two = L11's representative district
// template worlds/templates/eden-district.json — a proof in principle, not a rebuild).
// One fresh world booted from the template (GENESIS_FILE, as the launcher does). The harness plays both parts over HTTP:
//   the GOD (god token) marks four of the district's named places with flags (the plaza fountain, the library, the
//   commons pavilion, the pond bank), later adds a bench beside a Soul, and tries edits that would unseat or bury a
//   seated Soul (refused, naming her);
//   three fresh SOULS (owner invite → create → pair → Soul token; only /v1/edge/*) live in the district at once:
//   Ana walks to the plaza fountain and sits on a plaza bench; Ben walks to the library, sits on the god's new bench and
//   prays (the god answers, he reads it); Cleo walks to the commons pavilion, then into a two-storey house and up its
//   stairs to sit upstairs.
// Screenshots (Chrome lease, real GPU): an overview with the three in it, and one close shot per Soul.
//
//   node tools/god-skill/e2e/district-souls.mjs [--port 5182] [--keep] [--no-shots]
//
// Harness copied from souls-r2.mjs (A-souls). Report under .lane/e2e-district/<stamp>/.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromeLease } from '../lib/chrome-lease.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const slug = typeof args.slug === 'string' ? args.slug : 'eden-two';
const port = Number(args.port ?? 5182);
const TEMPLATE = resolve(root, 'worlds/templates/eden-district.json');
const out = resolve(root, '.lane/e2e-district', stamp);
mkdirSync(out, { recursive: true });
const dataDir = resolve(out, 'data');
const base = `http://127.0.0.1:${port}/w/${slug}`;
const report = { slug, port, template: 'worlds/templates/eden-district.json', startedAt: new Date().toISOString(), steps: [], shots: [], failures: [], souls: {}, samples: {} };
const log = (...a) => console.log(...a);
const t = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- the world process (fake minds, dev auth, fresh data dir, local Mars assets, the district as genesis)
const marsWeb = resolve(root, '.lane/mars-web');
const env = { ...process.env, ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), WORLD_KEY: slug, WORLD_ID: `${slug}-1`, WORLD_NAME: 'Eden two', ENGINE: 'mars', PORT: String(port), DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', DATA_DIR: dataDir, PUBLIC_URL: `http://127.0.0.1:${port}`, GENESIS_FILE: TEMPLATE };
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

// ---------- clients: owners (dev identities), the god (god token), the Souls (Soul tokens)
let godToken = '';
async function api(path, { method, body, as = 'god' } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (as === 'god') headers.authorization = `Bearer ${godToken}`;
  else if (typeof as === 'object' && as?.token) headers.authorization = `Bearer ${as.token}`;
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
const describe = async (ref) => (await api('/v1/god/query', { body: { describe: ref } })).data.describe;
const observe = async (s) => (await api('/v1/edge/observe', { as: s })).data;
const caps = async (s) => (await api('/v1/edge/capabilities', { as: s })).data.capabilities ?? [];
const xz = (p) => [p[0], p[2]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const near = (p, q, d) => dist(xz(p), q) <= d;
/** Act as a Soul and follow the receipt to its end, sampling the body (position, activity) on the way. */
async function soulDoes(s, capability, { params, maxS = 300, until: stopWhen } = {}) {
  const t0 = Date.now();
  const r = await api('/v1/edge/act', { body: { capability, ...(params ? { params } : {}) }, as: s });
  if (!r.data?.accepted) return { accepted: false, code: r.data?.code, reason: r.data?.reason, status: r.status, samples: [], end: null, ms: Date.now() - t0 };
  const id = r.data.receipt?.id, samples = [];
  let rec = r.data.receipt;
  while (Date.now() - t0 < maxS * 1000) {
    const o = await observe(s); const me = o.self;
    samples.push({ ms: Date.now() - t0, tick: o.tick, p: me.position, activity: me.activity, state: me.state });
    if (stopWhen?.(me)) break;
    if (id) rec = (await api(`/v1/edge/receipts/${encodeURIComponent(id)}`, { as: s })).data?.receipt ?? rec;
    if (['completed', 'failed', 'replaced'].includes(rec?.phase)) break;
    await sleep(700);
  }
  const o = await observe(s);
  // path length walked vs the straight line (an odd route shows as a high ratio)
  let walked = 0; for (let i = 1; i < samples.length; i++) walked += dist(xz(samples[i].p), xz(samples[i - 1].p));
  const straight = samples.length ? dist(xz(samples[0].p), xz(o.self.position)) : 0;
  return { accepted: true, phase: rec?.phase, code: rec?.code, reason: rec?.reason, result: r.data.result, samples, ms: Date.now() - t0, walked: +walked.toFixed(1), straight: +straight.toFixed(1), end: { p: o.self.position, activity: o.self.activity, state: o.self.state } };
}
/** The longest time a body stood still (≤ 5 cm between samples) while its walk was still running. */
const longestStall = (samples) => { let best = 0, from = null; for (let i = 1; i < samples.length; i++) { const still = dist(xz(samples[i].p), xz(samples[i - 1].p)) < 0.05 && samples[i].activity !== 'sit'; if (still) { from ??= samples[i - 1].ms; best = Math.max(best, samples[i].ms - from); } else from = null; } return best; };

// ---------- screenshots (Chrome via the viewer's Playwright; one Chrome machine-wide via the lease)
let chromium = null;
if (!args['no-shots']) try { chromium = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test').chromium; } catch { log('  (no @playwright/test; screenshots skipped)'); }
const shotUrl = ({ eye, at, wait = 4000, hideRoofs = false }) => {
  const q = new URLSearchParams({ dev: '1', shot: '1', settle: String(wait), ...(hideRoofs ? { hideRoofs: '1' } : {}) });
  if (eye) q.set('eye', eye.map((v) => v.toFixed(2)).join(',')); if (at) q.set('at', at.map((v) => v.toFixed(2)).join(','));
  return `${base}?${q}`;
};
async function withPage(fn) {
  const release = await chromeLease('district-souls').catch(() => null);
  if (!release) { log('  (chrome lease busy; screenshot skipped)'); return false; }
  let browser = null;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => { localStorage.setItem('sim.dev', 'admin'); });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { (report.pageErrors ??= []).push(String(e).slice(0, 300)); });
    return await fn(page);
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
/** Open the page first, then start `run` (the Souls' walks) and photograph it mid-motion, `afterMs` later. */
async function shotDuring(name, opts, run) {
  if (!chromium) return run();
  let p = null;
  try {
    await withPage(async (page) => {
      await load(page, { ...opts, wait: 3000 }); p = run();
      await sleep(opts.afterMs ?? 15000);
      await snap(page, name); return true;
    });
  } catch (e) { log('  (mid-motion screenshot failed: ' + String(e.message).split('\n')[0] + ')'); }
  return p ?? run();
}

// ================================================================ the scenario
// The district (template coordinates, metres): commons lawn around the origin (Souls are born here), pond west
// (−53, 0), commons pavilion (9, −5), the housing street along z = 21.5 from x 26 to 88 with four homes, the library
// hall (74, −7) with its door on the street side, the plaza (66..84, 12..26) with the fountain at (75, 19).
const genesis = JSON.parse(readFileSync(TEMPLATE, 'utf8'));
const placeOps = genesis.batches.reduce((n, b) => n + b.ops.filter((o) => o.op === 'place').length, 0);
const FLAGS = {
  'plaza-fountain': { p: [71.6, 19], label: 'the plaza fountain' },
  'library': { p: [71.6, -0.6], label: 'the library' },
  'commons-pavilion': { in: { parent: 'commons-pavilion', slot: 'pavilion' }, p: [0, 0, 0], label: 'the commons pavilion' },
  'pond-bank': { p: [-43.5, 0.5], label: 'the pond bank' },
};
const HOUSE = 'eden-house-3', HOUSE_P = [33.98, 30], UP_SEAT = `${HOUSE}/bath-2-stool`, CAFE = 'cafe-table-1', CAFE_P = [69, 15], PBENCH = 'plaza-bench-1', PBENCH_P = [75, 14.6];
const BENCH_P = [77.6, -1.9];
const PEOPLE = [
  { key: 'ana', name: 'Ana', description: 'likes the sound of fountains and a coffee in the sun', goes: 'plaza-fountain' },
  { key: 'ben', name: 'Ben', description: 'a reader who keeps the library hours and talks to the sky', goes: 'library' },
  { key: 'cleo', name: 'Cleo', description: 'walks the commons at noon, then climbs to the quiet room upstairs', goes: 'commons-pavilion' },
];
const souls = {};
const ids = {};
let bootMs = 0, floor1Y = 2.9, flagAt = {};
const upstairs = (p) => Math.abs(p[1] - floor1Y) < 0.3 && dist(xz(p), HOUSE_P) < 7;
const record = (who, what, r) => { (report.souls[who] ??= []).push({ what, ms: r?.ms, phase: r?.phase, code: r?.code, walked: r?.walked, straight: r?.straight, stallMs: r?.samples ? longestStall(r.samples) : undefined, end: r?.end }); };
try {
  bootMs = await boot();
  log(`▶ world "${slug}" on :${port} booted from eden-district.json in ${bootMs.toFixed(0)} ms`);

  // ======================== the district as the template made it
  await step('G0 the owner mints a god token for eden-two', async () => { const r = await api('/v1/god/mint', { as: 'admin', body: { label: 'e2e district-souls' } }); godToken = r.data.token; return { status: r.status, token: !!godToken }; }, (r) => r.status === 200 && r.token);
  await step(`G0 the world is the district: every place op of the template is an entity (${placeOps}), its named places exist`, async () => {
    const names = ['plaza-fountain', 'eden-library-1', 'commons-pavilion', 'shore-water', HOUSE, CAFE, PBENCH, 'region-old-town.plaza', 'eden-housing'];
    const found = {}; for (const n of names) found[n] = !!(await entity(n))?.entity;
    const count = Number(/(\d+) entities/.exec(serverLog)?.[1] ?? -1);
    return { count, found };
  }, (r) => r.count === placeOps && Object.values(r.found).every(Boolean));

  // ======================== GOD: marks the named places so newcomers can walk to them by name
  await step('G1 the god marks four named places with flags: the plaza fountain, the library, the commons pavilion, the pond bank', async () => {
    const r = await act(Object.entries(FLAGS).map(([name, f]) => ({ op: 'place', def: 'core/flag@1', name: `to-${name}`, ...(f.in ? { in: f.in } : {}), p: f.p, state: { label: f.label } })), 'way-marks for newcomers');
    return { accepted: r.data?.accepted, failures: r.data?.failures };
  }, (r) => r.accepted === true);
  // where the flags really are (the pavilion's one is placed in its room)
  for (const name of Object.keys(FLAGS)) {
    const d = await describe(f2path(name));
    flagAt[name] = d?.pose ? [d.pose.x, d.pose.z] : (FLAGS[name].in ? [9, -5] : FLAGS[name].p);
  }
  const hd = await step(`G2 ${HOUSE} (two storeys) has a door on the ground floor and stairs; reach from the pavilion to its upstairs`, async () => {
    const e = await describe(HOUSE);
    floor1Y = (e?.rooms ?? []).find((r) => r.floor === 1)?.y ?? floor1Y;
    const doors = (e?.openings ?? []).filter((o) => o.kind === 'door' && o.level === 0).map((o) => o.at);
    const reach = (await until(async () => { const r = (await api('/v1/god/query', { body: { reach: { from: flagAt['commons-pavilion'], to: `${HOUSE}:bath-2` } } })).data.reach; return { ok: r?.reachable === true && r.levels?.includes(1), r }; }, 90000))?.r;
    return { floor1Y, doors, stairs: (e?.links ?? []).filter((l) => l.kind === 'stairs').length, rooms: (e?.rooms ?? []).map((r) => `${r.id}@${r.floor}`), reachable: reach?.reachable, levels: reach?.levels, why: reach?.code ?? reach?.reason };
  }, (r) => r.doors.length && r.stairs >= 1 && r.reachable === true);
  for (const p of [UP_SEAT, CAFE, PBENCH]) ids[p] = (await entity(p))?.entity?.id;

  // ======================== three fresh Souls, born through the normal owner flow
  for (const who of PEOPLE) {
    await step(`S0 an owner is invited and creates a Soul "${who.name}"; an agent pairs and gets a Soul token`, async () => {
      const inv = await api('/v1/admin', { as: 'admin', body: { action: 'invite', uses: 1 } });
      const ok = await api('/v1/invite', { as: who.key, body: { code: inv.data.code } });
      const s = await api('/v1/souls', { as: who.key, body: { name: who.name, description: who.description } });
      const soul = s.data.soul;
      const c = soul ? await api(`/v1/souls/${soul.id}/pair`, { as: who.key, body: {} }) : null;
      const x = c ? await api('/v1/agent/pair', { as: 'none', body: { code: c.data.code, agent: `e2e district ${who.key}` } }) : null;
      souls[who.key] = { ...who, soul, token: x?.data?.token };
      return { inv: inv.status, ok: ok.status, soul, token: !!x?.data?.token };
    }, (r) => r.soul?.id && r.soul?.entityId && r.token);
  }
  const S = (k) => ({ token: souls[k].token });
  await step('S1 each is born a body on the district\'s ground (y = tile height), apart from the others', async () => {
    const at = {};
    for (const k of Object.keys(souls)) {
      for (let i = 0; i < 60; i++) { const o = await observe(S(k)); if (o?.self?.position) { at[k] = o.self.position; break; } await sleep(500); }
    }
    const gs = await groundAt(Object.values(at).map(xz));
    const ks = Object.keys(at), apart = ks.flatMap((a, i) => ks.slice(i + 1).map((b) => dist(xz(at[a]), xz(at[b]))));
    return { at, off: Object.values(at).map((p, i) => +(p[1] - gs[i].y).toFixed(3)), minApart: Math.min(...apart) };
  }, (r) => Object.keys(r.at).length === 3 && r.off.every((d) => Math.abs(d) < 0.03) && r.minApart > 0.4);
  await step('S1 their capabilities name the god\'s four way-marks and prayer', () => until(async () => {
    const want = Object.keys(FLAGS).map((n) => `walk:flag-to-${n}`).concat('pray');
    const missing = {}; for (const k of Object.keys(souls)) { const c = (await caps(S(k))).map((x) => x.id); const m = want.filter((w) => !c.includes(w)); if (m.length) missing[k] = m; }
    return { ok: !Object.keys(missing).length, missing };
  }, 30000), (r) => r?.ok);

  // ======================== the three walk at once, each to a different named place
  const walks = await step('S2 at once: Ana walks to the plaza fountain, Ben to the library, Cleo to the commons pavilion', async () => {
    const run = () => Promise.all(PEOPLE.map((p) => soulDoes(S(p.key), `walk:flag-to-${p.goes}`, { maxS: 360 }).then((r) => [p.key, r])));
    const res = Object.fromEntries(await shotDuring('s2-walking-overview', { eye: [34, 34, 52], at: [34, 0, 6], afterMs: 22000 }, run));
    const brief = {};
    for (const p of PEOPLE) { const r = res[p.key]; record(p.key, `walk to ${p.goes}`, r); report.samples[`${p.key}-walk`] = r.samples; brief[p.key] = { phase: r.phase, code: r.code, reason: r.reason, s: +(r.ms / 1000).toFixed(1), walked: r.walked, straight: r.straight, stallS: +(longestStall(r.samples) / 1000).toFixed(1), end: r.end?.p?.map((v) => +v.toFixed(2)), flag: flagAt[p.goes], off: r.end ? +dist(xz(r.end.p), flagAt[p.goes]).toFixed(2) : null }; }
    return brief;
  }, (r) => PEOPLE.every((p) => r[p.key]?.phase === 'completed' && r[p.key].off !== null && r[p.key].off < 1.6));

  // ---- Ana: a bench on the plaza, facing the fountain. (A café chair faults the engine — see the note at the end.)
  const ana = await step('S3 Ana sits on a plaza bench by the fountain', async () => {
    const id = ids[PBENCH], cap = `sit:${id}`;
    const seen = await until(async () => ({ ok: (await caps(S('ana'))).some((c) => c.id === cap) }), 20000);
    const r = await soulDoes(S('ana'), cap, { params: { seconds: 600 }, maxS: 180, until: (me) => me.activity === 'sit' });
    record('ana', 'sit on a plaza bench', r);
    return { offered: !!seen?.ok, accepted: r.accepted, code: r.code, reason: r.reason, s: +(r.ms / 1000).toFixed(1), end: r.end, fromBench: r.end ? +dist(xz(r.end.p), PBENCH_P).toFixed(2) : null };
  }, (r) => r.accepted && r.end?.activity === 'sit' && r.fromBench < 1);

  // ---- Ben: the god adds a bench beside him at the library; he sits on it and prays; the god answers
  await step('G3 the god adds a bench beside Ben at the library door — accepted', async () => {
    const me = (await observe(S('ben'))).self.position;
    const r = await act([{ op: 'place', def: 'core/bench@1', name: 'library-bench', p: BENCH_P, r: 0 }], 'a bench by the library for Ben');
    ids['library-bench'] = (await entity('library-bench'))?.entity?.id;
    return { accepted: r.data?.accepted, failures: r.data?.failures, fromBen: +dist(xz(me), BENCH_P).toFixed(2) };
  }, (r) => r.accepted === true && r.fromBen < 8);
  const ben = await step('S4 Ben sits on the god\'s new bench', async () => {
    const cap = `sit:${ids['library-bench']}`;
    const seen = await until(async () => ({ ok: (await caps(S('ben'))).some((c) => c.id === cap) }), 30000);
    const r = await soulDoes(S('ben'), cap, { params: { seconds: 600 }, maxS: 120, until: (me) => me.activity === 'sit' });
    record('ben', 'sit on the god\'s bench', r);
    return { offered: !!seen?.ok, accepted: r.accepted, code: r.code, reason: r.reason, s: +(r.ms / 1000).toFixed(1), end: r.end, fromBench: r.end ? +dist(xz(r.end.p), BENCH_P).toFixed(2) : null };
  }, (r) => r.accepted && r.end?.activity === 'sit' && r.fromBench < 1);
  let prayerId = null;
  await step('S5 Ben prays from the bench', async () => { const r = await api('/v1/edge/act', { as: S('ben'), body: { capability: 'pray', params: { text: 'Could the library stay open after dark?' } } }); prayerId = r.data.result?.prayer; return r.data; }, (r) => r.accepted === true && !!prayerId);
  await step('G4 the prayer reaches the god; the god answers', async () => { const p = (await api('/v1/god/prayers')).data.prayers; const mine = p.find((x) => x.id === prayerId); const a = await act([{ op: 'answer', prayer: prayerId, text: 'Yes. The lamps on the street will stay lit for you.' }]); return { seen: !!mine, from: mine?.soul_name, text: mine?.text, answered: a.data.accepted }; }, (r) => r.seen && r.from === 'Ben' && r.answered);
  await step('S5 Ben reads the answer', async () => { const p = (await api('/v1/god/prayers/mine', { as: S('ben') })).data.prayers; return { answer: p.find((x) => x.id === prayerId)?.answer }; }, (r) => /lamps on the street/.test(r.answer ?? ''));

  // ---- Cleo: into the house, up its stairs, seated upstairs
  const cleo = await step(`S6 Cleo goes from the pavilion into ${HOUSE}, up its stairs, and sits upstairs (bath-2 stool, floor 1)`, async () => {
    const cap = `sit:${ids[UP_SEAT]}`;
    const seen = await until(async () => ({ ok: (await caps(S('cleo'))).some((c) => c.id === cap) }), 20000);
    const r = await soulDoes(S('cleo'), cap, { params: { seconds: 600 }, maxS: 300, until: (me) => me.activity === 'sit' });
    record('cleo', 'into the house and upstairs', r); report.samples['cleo-upstairs'] = r.samples;
    const doors = hd?.doors ?? [];
    const throughDoor = doors.length ? Math.min(...r.samples.map((s) => Math.min(...doors.map((d) => dist(xz(s.p), d))))) : null;
    const climbing = r.samples.filter((s, i) => i && s.p[1] > r.samples[i - 1].p[1] + 0.05 && s.p[1] < floor1Y - 0.05 && dist(xz(s.p), HOUSE_P) < 7).length;
    return { offered: !!seen?.ok, accepted: r.accepted, code: r.code, reason: r.reason, s: +(r.ms / 1000).toFixed(1), walked: r.walked, straight: r.straight, end: r.end, upstairs: !!r.end && upstairs(r.end.p), throughDoor: throughDoor === null ? null : +throughDoor.toFixed(2), climbing };
  }, (r) => r.accepted && r.end?.activity === 'sit' && r.upstairs && r.throughDoor !== null && r.throughDoor < 1.5 && r.climbing >= 2);

  // ======================== the god's edits that touch seated bodies are refused, naming them
  const named = (r, who) => r.data?.accepted === false && r.data.failures?.some((f) => /by-body/.test(f.code) && new RegExp(who).test(f.detail));
  const refusals = {};
  const refuse = (name, who, ops) => step(name, async () => { const r = await act(ops, name); refusals[name] = r.data; return r; }, (r) => named(r, who));
  await refuse('G5 unseat: the god moves the plaza bench Ana sits on — refused, naming Ana', 'Ana', [{ op: 'move', id: PBENCH, p: [PBENCH_P[0] - 3, PBENCH_P[1]] }]);
  await refuse('G5 bury: the god drops a crate where Ana sits — refused, naming Ana', 'Ana', [{ op: 'place', def: 'core/crate@1', name: 'crate-on-ana', p: xz((await observe(S('ana'))).self.position) }]);
  await refuse(`G6 unseat: the god rebuilds ${HOUSE} with one floor while Cleo sits upstairs — refused, naming Cleo`, 'Cleo', [{ op: 'set', id: HOUSE, params: { floors: 1 } }]);
  await refuse(`G6 unseat: the god removes ${HOUSE} — refused, naming Cleo`, 'Cleo', [{ op: 'remove', id: HOUSE }]);
  await refuse('G6 unseat: the god removes the library bench Ben sits on — refused, naming Ben', 'Ben', [{ op: 'remove', id: 'library-bench' }]);
  await step('G7 the refusals left the district as it was: all three still seated where they sat; no crate', async () => {
    const st = {}; for (const k of Object.keys(souls)) { const o = (await observe(S(k))).self; st[k] = { activity: o.activity, p: o.position.map((v) => +v.toFixed(2)) }; }
    const crate = await entity('crate-on-ana'), house = await describe(HOUSE);
    return { st, crate: !!crate?.entity, floors: (house?.rooms ?? []).some((r) => r.floor === 1), cleoUp: upstairs(st.cleo.p) };
  }, (r) => Object.values(r.st).every((s) => s.activity === 'sit') && !r.crate && r.floors && r.cleoUp);
  await step('G8 a harmless edit beside them still goes through (planters by the plaza)', () => act([{ op: 'place', def: 'core/planter-box@1', name: 'plaza-planter', p: [86.5, 19], r: Math.PI / 2 }], 'a planter'), (r) => r.data?.accepted === true);

  // ======================== pictures: the district with its three Souls
  const pos = {}; for (const k of Object.keys(souls)) pos[k] = (await observe(S(k))).self.position;
  const close = (p, dx, dz, h = 3.2) => ({ eye: [p[0] + dx, p[1] + h, p[2] + dz], at: [p[0], p[1] + 0.8, p[2]] });
  await shots([
    // the district as a visitor sees it (roofs on), then the same three with the roofs off (Cleo is upstairs
    // against the house's south wall, so that view comes from the east, where no wall stands between)
    { name: 'overview-district', eye: [50, 42, 64], at: [52, 0, 12], wait: 8000 },
    { name: 'overview-three-souls-roofs-off', eye: [96, 34, 22], at: [58, 0, 14], wait: 8000, hideRoofs: true },
    { name: 'ana-on-the-plaza-bench', ...close(pos.ana, 3.5, 4.5, 2.4), wait: 6000 },
    { name: 'ben-on-the-gods-bench', ...close(pos.ben, -1.5, 6.5), wait: 6000 },
    // from inside her room, in front of her (she faces north, away from the landing wall), so the stool shows
    { name: 'cleo-upstairs-roof-hidden', eye: [pos.cleo[0] - 0.6, pos.cleo[1] + 1.9, pos.cleo[2] - 2.6], at: [pos.cleo[0], pos.cleo[1] + 0.6, pos.cleo[2]], wait: 8000, hideRoofs: true },
  ]);

  // ======================== known issue, recorded (not a pass/fail step): a café chair (core/parasol-table seat)
  if (!args['no-cafe']) {
    const t0 = t(), before = recoveries().length;
    await soulDoes(S('ana'), 'stand:here', { maxS: 30 });
    const cap = `sit:${ids[CAFE]}`;
    await until(async () => ({ ok: (await caps(S('ana'))).some((c) => c.id === cap) }), 20000);
    const r = await soulDoes(S('ana'), cap, { params: { seconds: 600 }, maxS: 120, until: (me) => me.activity === 'sit' });
    await sleep(1500);
    // a recovery may replay her back onto the plaza bench (seated, but not at the café): judge by where she sits
    const fresh = recoveries().slice(before), fromCafe = r.end ? +dist(xz(r.end.p), CAFE_P).toFixed(2) : null;
    const seated = r.end?.activity === 'sit' && fromCafe !== null && fromCafe < 1.3 && !fresh.length;
    report.notes = { cafeChair: { ms: +(t() - t0).toFixed(0), phase: r.phase, code: r.code, reason: r.reason, end: r.end, seated, fromCafe, recoveries: fresh } };
    log(`  note: Ana at a café chair → ${seated ? 'seated' : `not seated (${fresh.length ? 'engine fault recovered: ' + fresh[0].reason.slice(0, 160) : r.code ?? r.phase}); she ended at ${JSON.stringify(r.end?.p)}`}`);
  }
} catch (e) {
  report.failures.push({ name: 'harness', error: String(e?.stack ?? e) });
  log('harness error', e);
} finally {
  report.recoveries = recoveries();
  report.summary = { steps: report.steps.length, failed: report.failures.length, bootMs: +bootMs.toFixed(0), faults: (serverLog.match(/engine fault|violat/g) ?? []).length, recoveries: report.recoveries.length, refusedWriteBacks: (serverLog.match(/write-back refused/g) ?? []).length };
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(resolve(out, 'server.log'), serverLog);
  const soulRows = Object.entries(report.souls).flatMap(([k, rows]) => rows.map((r) => `| ${k} | ${r.what} | ${r.phase ?? '—'} | ${r.ms != null ? (r.ms / 1000).toFixed(1) : '—'} | ${r.walked ?? '—'} / ${r.straight ?? '—'} | ${r.stallMs != null ? (r.stallMs / 1000).toFixed(1) : '—'} |`));
  const md = [`# eden-two with fresh Souls — ${slug} — ${report.startedAt}`, '', `template worlds/templates/eden-district.json · boot ${report.summary.bootMs} ms · ${report.summary.steps} steps · ${report.summary.failed} failed · engine faults/violations in log: ${report.summary.faults} · fault recoveries in the journal: ${report.summary.recoveries} · refused write-backs: ${report.summary.refusedWriteBacks}`, '', '| step | ms | ok |', '|---|---:|:-:|', ...report.steps.map((s) => `| ${s.name} | ${s.ms} | ${s.ok ? '✔' : '✖ ' + (s.error ?? JSON.stringify(s.result)).slice(0, 240).replace(/\|/g, '/')} |`), '', '## Souls', '| soul | did | phase | s | walked / straight m | longest stall s |', '|---|---|---|---:|---|---:|', ...soulRows, '', '## engine-fault recoveries (journal)', ...(report.recoveries.length ? report.recoveries.map((r) => `- seq ${r.seq} tick ${r.tick}: ${r.reason} — set aside ${r.edge}`) : ['none']), '', '## notes (known issues, not pass/fail)', '```json', JSON.stringify(report.notes ?? {}, null, 1), '```', '', '## shots', ...report.shots.map((s) => `- ${s.name}: \`${s.file}\``)].join('\n');
  writeFileSync(resolve(out, 'REPORT.md'), md);
  log(`\n${report.summary.failed ? '✖' : '✔'} ${report.summary.steps} steps, ${report.summary.failed} failed. Report: ${resolve(out, 'REPORT.md')}`);
  if (!args.keep) stop();
  process.exit(report.summary.failed ? 1 : 0);
}
/** Engine-fault recoveries logged in the world's journal (the fault's reason, and which Souls' events were set aside). */
function recoveries() {
  try {
    const rows = execFileSync('sqlite3', [resolve(dataDir, 'sim.db'), "select seq, tick, json_extract(payload,'$.recovery.reason'), json_extract(payload,'$.recovery.edge') from events where kind='rules' and json_extract(payload,'$.recovery') is not null"], { encoding: 'utf8' });
    return rows.trim().split('\n').filter(Boolean).map((l) => { const [seq, tick, reason, edge] = l.split('|'); return { seq: +seq, tick: +tick, reason, edge }; });
  } catch { return []; }
}
function f2path(name) { return FLAGS[name].in ? `${FLAGS[name].in.parent}/to-${name}` : `to-${name}`; }
