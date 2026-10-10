#!/usr/bin/env node
// R2 Souls proof (plan <eden4>/33 §7 R2 + §9 "the e2e must play both the god and a Soul in the same scenario").
// One fresh world, two players over HTTP:
//   the GOD (god token) builds terrain — a gentle knoll, a mesa whose flanks are steeper than 30°, a wadable pond, a
//   deep lake fed by a stream — then a two-floor house (building/1: a door, its own stairs) with a chair in a bedroom
//   and a bowl on a table, and a flag on the lawn;
//   a SOUL (created and paired through the normal owner flow, acting only through /v1/edge/*) climbs the knoll (its
//   y follows the slope), is refused the mesa, wades the pond, swims the lake, walks out to the lawn, goes in through
//   the god's door and up the god's stairs to sit on the god's chair, picks up the god's bowl, prays — and the god
//   answers; then, with the Soul seated upstairs, every god edit that would unseat or bury her is refused naming her.
// Screenshots of the key moments (Chrome lease, real GPU).
//
//   node tools/god-skill/e2e/souls-r2.mjs [--port 5174] [--keep] [--no-shots]
//
// Reuses the harness of souls-ground.mjs (L8) and souls-entities.mjs (L9). Report under .lane/e2e-r2/<stamp>/.
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
const slug = typeof args.slug === 'string' ? args.slug : 'souls-r2';
const port = Number(args.port ?? 5174);
const out = resolve(root, '.lane/e2e-r2', stamp);
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
  const release = await chromeLease('souls-r2').catch(() => null);
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

// ================================================================ the scenario
// layout (metres): the Soul is born near the origin; knoll east, mesa north, pond west, lake far west (its stream
// comes in from the south), the house south-east on flat ground with its door toward the origin side.
const KNOLL = [34, 4], MESA = [[-6, 30], [6, 30], [6, 42], [-6, 42]], POND = [[-30, -10], [-18, -10], [-18, 2], [-30, 2]];
const LAKE = [[-95, -45], [-50, -45], [-50, 5], [-95, 5]], STREAM = [[-72, -78], [-70, -62], [-73, -44]];
const HOUSE = [12, -26], PIER = [[-44, -20], [-62, -20]];
const ids = {};
let soul = null, door = null, bootMs = 0, floor1Y = 2.9;
/** On the house's upper floor (observe has no level: by height, inside the house's footprint). */
const upstairs = (p) => Math.abs(p[1] - floor1Y) < 0.25 && Math.hypot(p[0] - HOUSE[0], p[2] - HOUSE[1]) < 6;
try {
  bootMs = await boot();
  log(`▶ world "${slug}" on :${port} booted in ${bootMs.toFixed(0)} ms`);

  // ======================== GOD: the ground
  await step('G0 the owner mints a god token for the new world', async () => { const r = await api('/v1/god/mint', { as: 'admin', body: { label: 'e2e souls-r2' } }); godToken = r.data.token; return { status: r.status, token: !!godToken }; }, (r) => r.status === 200 && r.token);
  await step('G1 the god builds the ground: a knoll, a mesa steeper than 30°, a shallow pond, a deep lake fed by a stream, and flags', () => act([
    { op: 'place', def: 'core/knoll@1', name: 'knoll', p: KNOLL, params: { height: 6, radius: 20 } },
    { op: 'place', def: 'core/plateau@1', name: 'mesa', shape: { area: MESA }, params: { height: 8, edge: 1 } },
    { op: 'place', def: 'core/pond@1', name: 'pond', shape: { area: POND }, params: { depth: 0.3, level: 0, edge: 1 } },
    { op: 'place', def: 'core/lake@1', name: 'lake', shape: { area: LAKE }, params: { depth: 4, level: 0 } },
    { op: 'place', def: 'core/stream@1', name: 'stream', shape: { path: STREAM, width: 2.5 } },
    { op: 'place', def: 'core/flag@1', name: 'hilltop', p: KNOLL, state: { label: 'hilltop' } },
    { op: 'place', def: 'core/flag@1', name: 'mesa-top', p: [0, 36], state: { label: 'mesa top' } },
    { op: 'place', def: 'core/flag@1', name: 'pond-middle', p: [-24, -4], state: { label: 'pond middle' } },
    { op: 'place', def: 'core/flag@1', name: 'lake-middle', p: [-72, -20], state: { label: 'lake middle' } },
  ], 'R2 ground for Souls'), (r) => r.status === 200 && r.data?.accepted === true);
  await step('G2 the ground is what the god meant: knoll top 6 m with a walkable flank, mesa flank > 30° (steep), pond wadable, lake deep', async () => {
    const [k, kf, m, mt, p, l] = await groundAt([KNOLL, [KNOLL[0] - 10, KNOLL[1]], [0, 30.2], [0, 36], [-24, -4], [-72, -20]]);
    return { knollY: k.y, flank: [kf.slopeDeg, kf.medium], mesaEdge: [m.slopeDeg, m.medium], mesaTop: mt.y, pond: [p.medium, p.water], lake: [l.medium, l.water] };
  }, (r) => r.knollY > 5.9 && r.flank[0] > 5 && r.flank[0] < 30 && r.flank[1] === 'walk' && r.mesaEdge[0] > 30 && r.mesaEdge[1] === 'steep' && r.mesaTop > 7.9 && r.pond[0] === 'wade' && r.lake[0] === 'swim');

  // a pier out over the deep lake (its deck height frozen from the water by the server's `prepare`), a flag at its end
  await step('G2 the god builds a pier from the east shore out over the deep lake, with a flag at its end', async () => {
    const prep = (await api('/v1/god/query', { body: { prepare: { def: 'core/pier@1', shape: { path: PIER } } } })).data.prepare;
    const r = await act([
      { op: 'place', tmp: '$p', def: 'core/pier@1', name: 'pier', shape: { path: PIER }, params: { ...(prep?.params ?? {}) } },
      { op: 'place', def: 'core/flag@1', name: 'pier-end', in: { parent: '$p', slot: 'end' }, state: { label: 'pier end' } },
    ], 'a pier');
    const d = (await api('/v1/god/query', { body: { describe: 'pier' } })).data.describe;
    const [w] = await groundAt([PIER[1]]);
    return { accepted: r.data?.accepted, failures: r.data?.failures, at: prep?.params?.at, notes: d?.notes, water: [w.medium, w.water] };
  }, (r) => r.accepted && r.at && r.water[0] === 'swim');
  // ======================== GOD: a house with a door and stairs, a chair, a bowl
  await step('G3 the god builds a two-floor house (building/1: rooms, a door, its own stairs)', () => act([
    { op: 'define', def: { schema: 'def/1', name: 'house2', version: 1, description: 'A two-floor house.', tags: ['building'], size: { box: [8, 6, 6] }, make: { kind: 'gen', gen: 'building/1' }, params: { floors: { type: 'int', min: 1, max: 6, default: 2 }, wall: { type: 'color', default: '#e9dcc3' } }, state: { doors: { type: 'json', default: {} } }, components: { foundation: { kind: 'none' } } } },
    { op: 'place', def: 'house2@1', name: 'house', p: HOUSE },
  ], 'two-floor house'), (r) => r.data?.accepted === true);
  const desc = await step('G3 the house has a door on the ground floor and stairs to floor 1', async () => {
    const e = (await api('/v1/god/query', { body: { describe: 'house' } })).data.describe;
    // the front door: a ground-floor door in the outer wall (the one farthest from the house's centre)
    door = (e?.openings ?? []).filter((o) => o.kind === 'door' && o.level === 0).sort((a, b) => Math.hypot(b.at[0] - HOUSE[0], b.at[1] - HOUSE[1]) - Math.hypot(a.at[0] - HOUSE[0], a.at[1] - HOUSE[1]))[0] ?? null;
    floor1Y = (e?.rooms ?? []).find((r) => r.floor === 1)?.y ?? floor1Y;
    return { floor1Y, door, stairs: (e?.links ?? []).filter((l) => l.kind === 'stairs').length, links: (e?.links ?? []).map((l) => l.kind), rooms: (e?.rooms ?? []).map((r) => `${r.id}@${r.floor}`) };
  }, (r) => r.door && r.stairs >= 1);
  // the lawn: 4 m out from the door, away from the house centre
  const doorXZ = door ? [door.at[0], door.at[1]] : null;
  const out4 = doorXZ ? (() => { const dx = doorXZ[0] - HOUSE[0], dz = doorXZ[1] - HOUSE[1], n = Math.hypot(dx, dz) || 1; return [+(doorXZ[0] + (dx / n) * 4).toFixed(2), +(doorXZ[1] + (dz / n) * 4).toFixed(2)]; })() : [HOUSE[0], HOUSE[1] + 9];
  await step('G4 the god furnishes it: a chair in a bedroom upstairs, a table with a bowl, a flag on the lawn', () => act([
    { op: 'place', def: 'core/chair@1', name: 'chair', in: { parent: 'house', slot: 'floor-1' }, p: [-2, 0, 1], r: 0 },
    { op: 'place', tmp: '$t', def: 'core/table@1', name: 'table', in: { parent: 'house', slot: 'floor-1' }, p: [2, 0, 1] },
    { op: 'place', def: 'core/bowl@1', name: 'bowl', in: { parent: '$t', slot: 'top' } },
    { op: 'place', def: 'core/flag@1', name: 'lawn', p: out4, state: { label: 'lawn' } },
  ], 'furnish the house'), (r) => r.data?.accepted === true);
  for (const p of ['house', 'house/chair', 'house/table', 'house/table/bowl', 'lawn']) ids[p] = (await entity(p)).entity?.id;
  await step('G5 reach: from the lawn through the door and up the stairs to the chair\'s floor', () => until(async () => { const r = (await api('/v1/god/query', { body: { reach: { from: out4, to: 'house:floor-1' } } })).data.reach; return { ok: r?.reachable === true && r.levels?.includes(1), r }; }, 90000), (r) => r?.ok);
  await shots([
    { name: 'g-world-built', eye: [40, 34, 44], at: [-8, 0, -14], wait: 6000 },
    { name: 'g-house-outside', eye: [HOUSE[0] + 14, 8, HOUSE[1] + 16], at: [HOUSE[0], 2, HOUSE[1]], wait: 5000 },
  ]);

  // ======================== SOUL: born through the owner flow, paired, acting via /v1/edge
  await step('S0 an owner is invited and creates a Soul "Ana"', async () => {
    const inv = await api('/v1/admin', { as: 'admin', body: { action: 'invite', uses: 1 } });
    const ok = await api('/v1/invite', { as: 'ana', body: { code: inv.data.code } });
    const s = await api('/v1/souls', { as: 'ana', body: { name: 'Ana', description: 'a hill walker who swims in cold lakes and likes high windows' } });
    soul = s.data.soul; return { inv: inv.status, ok: ok.status, soul };
  }, (r) => r.soul?.id && r.soul?.entityId);
  await step('S0 the owner pairs an agent; the agent exchanges the code for a Soul token', async () => {
    const c = await api(`/v1/souls/${soul.id}/pair`, { as: 'ana', body: {} });
    const x = await api('/v1/agent/pair', { as: 'none', body: { code: c.data.code, agent: 'e2e souls-r2 agent' } });
    soulToken = x.data.token; return { code: !!c.data.code, token: !!soulToken };
  }, (r) => r.token);
  await step('S1 birth made her body an entity, and she stands on the god\'s ground (y = tile height)', async () => {
    const e = await until(async () => { const x = await entity(soul.entityId); return { ok: x?.entity?.id === soul.entityId, def: x?.entity?.def }; }, 30000);
    for (let i = 0; i < 60; i++) { const o = await observe(); if (o?.self?.position) { const [g] = await groundAt([[o.self.position[0], o.self.position[2]]]); return { body: e?.ok, def: e?.def, p: o.self.position, ground: g.y, medium: g.medium }; } await sleep(500); }
    return { body: e?.ok };
  }, (r) => r.body && r.p && Math.abs(r.p[1] - r.ground) < 0.02 && ['walk', 'wade'].includes(r.medium));
  await step('S1 her capabilities name the god\'s flags, the lake, the chair, the bowl and prayer', () => until(async () => {
    const c = (await caps()).map((x) => x.id);
    const want = ['walk:flag-hilltop', 'walk:flag-mesa-top', 'walk:flag-pond-middle', 'walk:flag-lawn', 'walk:flag-pier-end', 'swim:lake', `sit:${ids['house/chair']}`, `pick-up:${ids['house/table/bowl']}`, 'pray'];
    return { ok: want.every((w) => c.includes(w)), missing: want.filter((w) => !c.includes(w)) };
  }, 30000), (r) => r?.ok);

  // ---- terrain: climb, refusals, wade, swim
  const hill = await step('S2 she walks up the knoll to the hilltop flag; her y follows the slope all the way', async () => {
    const r = await shotDuring('s2-climbing-the-knoll', { eye: [KNOLL[0] - 16, 6, KNOLL[1] + 14], at: [KNOLL[0] - 10, 2.6, KNOLL[1] - 1], afterMs: 40000, when: (me) => me.position[0] > KNOLL[0] - 14 }, () => soulDoes('walk:flag-hilltop'));
    report.samples.hill = r.samples;
    const gs = r.samples.length ? await groundAt(r.samples.map((s) => [s.p[0], s.p[2]])) : [];
    const off = r.samples.map((s, i) => Math.abs(s.p[1] - gs[i].y));
    return { phase: r.phase, code: r.code, end: r.end, n: r.samples.length, maxOff: off.length ? Math.max(...off) : null, ys: r.samples.map((s) => +s.p[1].toFixed(2)), fromTick: r.fromTick, toTick: r.toTick };
  }, (r) => r.phase === 'completed' && near(r.end.p, KNOLL, 1.5) && r.end.p[1] > 5.5 && r.maxOff !== null && r.maxOff < 0.03 && r.ys.filter((y, i) => i && y > r.ys[i - 1] + 0.01).length >= 3);
  await step('S2 the takes carry the climb: her archived track rises from the field to the knoll top', async () => {
    const ys = []; let from = (hill?.fromTick ?? 0) - 20;
    for (let page = 0; page < 20 && from !== null; page++) {
      const d = (await api(`/v1/takes?from=${from}&to=${(hill?.toTick ?? 0) + 20}&limit=120`, { as: 'none' })).data;
      for (const c of d.chunks ?? []) for (const k of c.take?.tracks?.[soul.entityId] ?? []) ys.push(k[2] / 1000);
      from = d.next ?? null;
    }
    return { n: ys.length, min: Math.min(...ys), max: Math.max(...ys), rises: ys.filter((y, i) => i && y > ys[i - 1] + 0.005).length };
  }, (r) => r.n > 10 && r.max > 5.5 && r.min < 1 && r.rises >= 5);
  if (hill?.end) { const p = hill.end.p; await shots([{ name: 's2-on-the-hilltop', eye: [p[0] - 14, p[1] + 6, p[2] + 16], at: [p[0], p[1] + 0.9, p[2]], wait: 8000 }]); }
  await step('S3 the mesa is refused: its flank is steeper than 30° (ground.cliff / ground.steep, named where)', () => soulDoes('walk:flag-mesa-top'), (r) => ['ground.cliff', 'ground.steep'].includes(r.code) && r.phase !== 'completed');
  await step('S3 walking into the lake is refused: too deep to wade (ground.deep-water)', () => soulDoes('walk:flag-lake-middle'), (r) => r.code === 'ground.deep-water' && r.phase !== 'completed');
  const pond = await step('S4 she wades into the pond: shallow water, feet on the bed, wading', async () => {
    const r = await soulDoes('walk:flag-pond-middle');
    report.samples.pond = r.samples;
    return { phase: r.phase, code: r.code, end: r.end, acts: [...new Set(r.samples.map((s) => s.activity))] };
  }, (r) => r.phase === 'completed' && r.end?.p[1] < -0.1 && (r.acts.includes('wade') || r.end.activity === 'wade' || /wad/.test(r.end.state ?? '')));
  if (pond?.end) await shots([{ name: 's4-wading', eye: [pond.end.p[0] + 8, 4, pond.end.p[2] + 9], at: [pond.end.p[0], 0.3, pond.end.p[2]], wait: 5000 }]);
  const swim = await step('S5 she swims in the lake: walks to its shore, swims out, treads water with her head above', async () => {
    const r = await soulDoes('swim:lake', { maxS: 300 });
    report.samples.swim = r.samples;
    const [g] = await groundAt([[r.end.p[0], r.end.p[2]]]);
    return { phase: r.phase, code: r.code, reason: r.reason, end: r.end, acts: [...new Set(r.samples.map((s) => s.activity))], depth: g.water };
  }, (r) => r.phase === 'completed' && r.acts.includes('swim') && ['tread', 'swim'].includes(r.end.activity) && r.depth > 3 && Math.abs(r.end.p[1] - -1.2) < 0.05);
  if (swim?.end) await shots([{ name: 's5-swimming', eye: [swim.end.p[0] + 12, 5, swim.end.p[2] + 14], at: [swim.end.p[0], 0, swim.end.p[2]], wait: 5000 }]);
  const pier = await step('S6 from the water she walks out to the end of the god\'s pier: swims to the shore first, then stands on the deck above deep water', async () => {
    const r = await soulDoes('walk:flag-pier-end', { maxS: 420 });
    report.samples.pier = r.samples;
    const [g] = await groundAt([[r.end.p[0], r.end.p[2]]]);
    return { phase: r.phase, code: r.code, reason: r.reason, end: r.end, acts: [...new Set(r.samples.map((s) => s.activity))], under: [g.medium, g.water] };
  }, (r) => r.phase === 'completed' && near(r.end.p, PIER[1], 1.5) && r.acts.includes('swim') && r.under[0] === 'swim' && r.end.p[1] > 0.5 && !['swim', 'tread'].includes(r.end.activity));
  if (pier?.end) await shots([{ name: 's6-on-the-pier', eye: [pier.end.p[0] + 10, 4, pier.end.p[2] + 10], at: [pier.end.p[0], 0.8, pier.end.p[2]], wait: 5000 }]);
  await step('S6 she walks from the pier to the god\'s lawn by the house', async () => {
    const r = await soulDoes('walk:flag-lawn', { maxS: 420 });
    return { phase: r.phase, code: r.code, reason: r.reason, end: r.end, acts: [...new Set(r.samples.map((s) => s.activity))] };
  }, (r) => r.phase === 'completed' && near(r.end.p, out4, 1.5));

  // ---- the house: through the door, up the stairs, onto the chair
  const seat = await step('S7 she sits on the god\'s chair upstairs: in through the door, up the stairs, seated on floor 1', async () => {
    const r = await shotDuring('s7-going-in', { eye: [out4[0] + 6, 4, out4[1] + 7], at: [doorXZ?.[0] ?? HOUSE[0], 1.2, doorXZ?.[1] ?? HOUSE[1]], afterMs: 30000, when: (me) => doorXZ && Math.hypot(me.position[0] - doorXZ[0], me.position[2] - doorXZ[1]) < 2.6 },
      () => soulDoes(`sit:${ids['house/chair']}`, { params: { seconds: 600 }, maxS: 300, until: (me) => me.activity === 'sit' }));
    report.samples.seat = r.samples;
    const throughDoor = doorXZ ? Math.min(...r.samples.map((s) => Math.hypot(s.p[0] - doorXZ[0], s.p[2] - doorXZ[1]))) : null;
    const climbing = r.samples.filter((s, i) => i && s.p[1] > r.samples[i - 1].p[1] + 0.05 && s.p[1] < floor1Y - 0.05 && Math.hypot(s.p[0] - HOUSE[0], s.p[2] - HOUSE[1]) < 6).length;
    return { accepted: r.accepted, code: r.code, phase: r.phase, end: r.end, upstairs: !!r.end && upstairs(r.end.p), throughDoor, onGroundFirst: r.samples.some((s) => s.p[1] < 0.3), climbing, n: r.samples.length };
  }, (r) => r.accepted && r.end?.activity === 'sit' && r.upstairs && r.throughDoor !== null && r.throughDoor < 1.2 && r.onGroundFirst && r.climbing >= 3);
  await shots([{ name: 's7-seated-upstairs-roof-hidden', eye: [HOUSE[0] - 5, 13, HOUSE[1] + 8], at: [HOUSE[0] - 1, 2.8, HOUSE[1] - 1], wait: 8000, hideRoofs: true }]);

  // ---- the bowl
  await step('S8 she picks up the god\'s bowl; the entity world shows it in her hands', async () => {
    const r = await api('/v1/edge/act', { as: 'soul', body: { capability: `pick-up:${ids['house/table/bowl']}` } });
    if (r.data.accepted !== true) return { r: r.data };
    return until(async () => { const e = await entity(ids['house/table/bowl']); return { ok: e?.entity?.in?.parent === soul.entityId, in: e?.entity?.in }; }, 180000, 1000);
  }, (r) => r?.ok);
  { const me = (await observe())?.self; if (me?.position) { const q = me.position; await shots([{ name: 's8-holding-the-bowl-roof-hidden', eye: [q[0] + 2.5, q[1] + 5.5, q[2] + 3.5], at: [q[0], q[1] + 1, q[2]], wait: 6000, hideRoofs: true }]); } }
  await step('S8 the journal shows the engine\'s move of the bowl (by:engine, not the god\'s to undo)', async () => { const e = (await api('/v1/god/edits?limit=30')).data.edits; const m = e.find((x) => x.by === 'engine' && x.ops.some((o) => o.op === 'move' && o.id === ids['house/table/bowl'])); return { found: !!m, note: m?.note, kind: m?.kind }; }, (r) => r.found && r.kind === 'engine');
  await step('G6 the god tries to take the bowl away: refused, held by Ana', () => act([{ op: 'remove', id: ids['house/table/bowl'] }]), (r) => r.data?.accepted === false && r.data.failures?.[0]?.code === 'held.by-body' && /Ana/.test(r.data.failures[0].detail));

  // ---- prayer and answer
  let prayerId = null;
  await step('S9 she prays (a capability like any other)', async () => { const r = await api('/v1/edge/act', { as: 'soul', body: { capability: 'pray', params: { text: 'May this house have a garden by the door?' } } }); prayerId = r.data.result?.prayer; return r.data; }, (r) => r.accepted === true && !!prayerId);
  await step('G7 the prayer reaches the god; the god answers', async () => { const p = (await api('/v1/god/prayers')).data.prayers; const mine = p.find((x) => x.id === prayerId); const a = await act([{ op: 'answer', prayer: prayerId, text: 'Yes. Look south of the door tomorrow.' }]); return { seen: !!mine, from: mine?.soul_name, text: mine?.text, answered: a.data.accepted }; }, (r) => r.seen && r.from === 'Ana' && r.answered);
  await step('S9 she reads the answer', async () => { const p = (await api('/v1/god/prayers/mine', { as: 'soul' })).data.prayers; return { answer: p.find((x) => x.id === prayerId)?.answer }; }, (r) => /south of the door/.test(r.answer ?? ''));

  // ---- with Ana seated upstairs, edits that would unseat or bury her are refused, naming her
  await step('S10 she sits on the chair again (bowl in hand)', async () => {
    const r = await soulDoes(`sit:${ids['house/chair']}`, { params: { seconds: 600 }, maxS: 180, until: (me) => me.activity === 'sit' });
    return { accepted: r.accepted, code: r.code, end: r.end };
  }, (r) => r.accepted && r.end?.activity === 'sit' && upstairs(r.end.p));
  const named = (r, code) => r.data?.accepted === false && r.data.failures?.some((f) => f.code === code && /Ana/.test(f.detail));
  const refusals = {};
  const refuse = (name, ops, code = 'occupied.by-body') => step(name, async () => { const r = await act(ops, name); refusals[name] = r.data; return r; }, (r) => named(r, code));
  await refuse('G8 unseat: the god moves the chair she sits on — refused, naming Ana', [{ op: 'move', id: 'house/chair', p: [-1, 0, 0] }]);
  await refuse('G8 unseat: the god removes the chair — refused, naming Ana', [{ op: 'remove', id: 'house/chair' }]);
  await refuse('G8 unseat: the god removes the whole house — refused, naming Ana', [{ op: 'remove', id: 'house' }]);
  await refuse('G8 unseat: the god rebuilds the house with one floor — refused, naming Ana', [{ op: 'set', id: 'house', params: { floors: 1 } }]);
  await refuse('G8 unseat: the god moves the house — refused, naming Ana', [{ op: 'move', id: 'house', p: [HOUSE[0] + 3, HOUSE[1]] }]);
  await refuse('G9 bury: the god raises a hill under the house she sits in — refused, naming Ana', [{ op: 'place', def: 'core/knoll@1', name: 'mound', p: HOUSE, params: { height: 4, radius: 9 } }]);
  await refuse('G9 bury: the god drops a crate where she sits — refused, naming Ana', [{ op: 'place', def: 'core/crate@1', name: 'crate', in: { parent: 'house', slot: 'floor-1' }, p: [-2, 0, 1] }]);
  await step('G9 the refusals left the world as it was: chair, house, bowl in her hands, ground unchanged', async () => {
    const chair = await entity('house/chair'), bowl = await entity(ids['house/table/bowl']), mound = await entity('mound'), crate = await entity('house/crate');
    const o = await observe();
    const [g] = await groundAt([HOUSE]);
    return { chair: !!chair?.entity, bowlHeld: bowl?.entity?.in?.parent === soul.entityId, mound: !!mound?.entity, crate: !!crate?.entity, activity: o.self.activity, at: o.self.position, upstairs: upstairs(o.self.position), groundAtHouse: g.y };
  }, (r) => r.chair && r.bowlHeld && !r.mound && !r.crate && r.activity === 'sit' && r.upstairs && Math.abs(r.groundAtHouse) < 0.05);
  await step('G10 a harmless edit nearby still goes through (a bench on the lawn)', () => act([{ op: 'place', def: 'core/bench@1', name: 'garden-bench', p: [out4[0] + 3, out4[1] + 1] }], 'a bench'), (r) => r.data?.accepted === true);
  await shots([
    { name: 'g-refused-seated-roof-hidden', eye: [HOUSE[0] - 5, 13, HOUSE[1] + 8], at: [HOUSE[0] - 1, 2.8, HOUSE[1] - 1], wait: 8000, hideRoofs: true },
  ]);
} catch (e) {
  report.failures.push({ name: 'harness', error: String(e?.stack ?? e) });
  log('harness error', e);
} finally {
  report.summary = { steps: report.steps.length, failed: report.failures.length, bootMs: +bootMs.toFixed(0), faults: (serverLog.match(/engine fault|violat/g) ?? []).length };
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(resolve(out, 'server.log'), serverLog);
  const md = [`# R2 Souls proof (god + Soul) — ${slug} — ${report.startedAt}`, '', `boot ${report.summary.bootMs} ms · ${report.summary.steps} steps · ${report.summary.failed} failed · engine faults/violations in log: ${report.summary.faults}`, '', '| step | ms | ok |', '|---|---:|:-:|', ...report.steps.map((s) => `| ${s.name} | ${s.ms} | ${s.ok ? '✔' : '✖ ' + (s.error ?? JSON.stringify(s.result)).slice(0, 240).replace(/\|/g, '/')} |`), '', '## shots', ...report.shots.map((s) => `- ${s.name}: \`${s.file}\``)].join('\n');
  writeFileSync(resolve(out, 'REPORT.md'), md);
  log(`\n${report.summary.failed ? '✖' : '✔'} ${report.summary.steps} steps, ${report.summary.failed} failed. Report: ${resolve(out, 'REPORT.md')}`);
  if (!args.keep) stop();
  process.exit(report.summary.failed ? 1 : 0);
}
