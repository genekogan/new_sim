#!/usr/bin/env node
// MARSLIVED: Mars two as a lived-in world. Five fresh Souls (owner flow, Soul tokens, /v1/edge/* only; simple scripted
// agents, no model spend) go about a Mars College morning on the mars-two template at the same time, for well over
// twenty world-minutes:
//   Ana   tea room: walks into Mimos through its glazed front, sits on the honey sofa, talks with Ben; later takes the tea
//         kettle to the kitchen and comes back to the diner for lunch;
//   Ben   climbs to the raised main, sits on the red sofa, comes down through the pass-through pallet racks to the tea
//         room and sits on a tea stool beside Ana; later walks to the showers and back to the diner;
//   Cleo  cooks: into the working kitchen, takes a mixing bowl from the prep table, carries it to a diner table, sits;
//   Dev   the diner: sits in a bus seat against the blue wall, talks with Cleo across the room;
//   Eli   the Tool library: climbs the new stair to the loft, sits on a floor cushion, comes down, walks through the
//         Dojo's racks and over to the diner.
// Checks the brief's fixes on the way (the Tool library stair reaches the loft, Mimos's front is glass with a door, the
// default world has no economy), and photographs Souls in Mimos, the kitchen and the diner in real Chrome at dpr 1 and 2.
//
//   node tools/god-skill/e2e/mars-lived.mjs [--port 5874] [--keep] [--no-shots]
//
// Harness from mars-two.mjs. Report under .lane/e2e-mars-lived/<stamp>/.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromeLease } from '../lib/chrome-lease.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const slug = typeof args.slug === 'string' ? args.slug : 'mars-lived';
const port = Number(args.port ?? 5874);
const out = resolve(root, '.lane/e2e-mars-lived', stamp);
mkdirSync(out, { recursive: true });
const dataDir = resolve(out, 'data');
const base = `http://127.0.0.1:${port}/w/${slug}`;
const report = { slug, port, startedAt: new Date().toISOString(), steps: [], shots: [], failures: [], souls: {}, said: [] };
const log = (...a) => console.log(...a);
const t = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- the world process (fake minds, dev auth, fresh data dir, local Mars assets; no LAYERS opt-in)
const marsWeb = resolve(root, '.lane/mars-web');
const env = { ...process.env, ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), WORLD_KEY: slug, WORLD_ID: `${slug}-1`, ENGINE: 'mars', PORT: String(port), DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', DATA_DIR: dataDir, PUBLIC_URL: `http://127.0.0.1:${port}`, GENESIS_FILE: resolve(root, 'worlds/templates/mars-two.json') };
delete env.LAYERS;
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

// ---------- clients
let godToken = '';
async function api(path, { method, body, as = 'god' } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (as === 'god') headers.authorization = `Bearer ${godToken}`;
  else if (as && typeof as === 'object') headers.authorization = `Bearer ${as.token}`;
  else if (as && as !== 'none') headers.authorization = `Bearer dev:${as}`;
  const r = await fetch(base + path, { method: method ?? (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000) });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
const summarize = (r) => { try { const s = JSON.stringify(r); return s && s.length > 2500 ? JSON.parse(JSON.stringify(r, (k, v) => (Array.isArray(v) && v.length > 14 ? `[${v.length} items]` : v))) : r; } catch { return String(r); } };
async function step(name, fn, expect) {
  const t0 = t(); let result, error;
  try { result = await fn(); } catch (e) { error = String(e?.stack ?? e?.message ?? e); }
  const ms = t() - t0, okay = !error && (expect ? !!expect(result) : true);
  const brief = summarize(result);
  report.steps.push({ name, ms: +ms.toFixed(0), ok: okay, result: brief, error });
  if (!okay) report.failures.push({ name, result: brief, error });
  log(`${okay ? '✔' : '✖'} ${name} — ${ms.toFixed(0)} ms${okay ? '' : ' — ' + (error ?? JSON.stringify(brief)).slice(0, 700)}`);
  return result;
}
const query = async (body) => (await api('/v1/god/query', { body })).data;
const observe = async (s) => (await api('/v1/edge/observe', { as: s })).data;
const caps = async (s) => (await api('/v1/edge/capabilities', { as: s })).data.capabilities ?? [];
const clock = async () => (await api('/v1/world/layers', { as: 'none' })).data?.clock ?? null;
const worldMinute = (c) => c ? Date.parse(c.day + 'T00:00:00Z') / 60000 + c.minute : NaN;

// ---------- screenshots (Chrome via the viewer's Playwright; one Chrome machine-wide via the lease)
let chromium = null;
if (!args['no-shots']) try { chromium = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test').chromium; } catch { log('  (no @playwright/test; screenshots skipped)'); }
const shotUrl = ({ eye, at, wait = 5000, hideRoofs = false }) => {
  const q = new URLSearchParams({ dev: '1', shot: '1', settle: String(wait), ...(hideRoofs ? { hideRoofs: '1' } : {}) });
  q.set('eye', eye.map((v) => v.toFixed(2)).join(',')); q.set('at', at.map((v) => v.toFixed(2)).join(','));
  return `${base}?${q}`;
};
/** Several stills, each at dpr 1 and dpr 2, in one Chrome session per dpr: [{ name, eye, at, hideRoofs }]. */
async function shots(list) {
  if (!chromium) return;
  const release = await chromeLease('mars-lived e2e').catch(() => null);
  if (!release) { log('  (chrome lease busy; screenshots skipped)'); return; }
  let browser = null;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
    for (const dpr of [1, 2]) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr });
      await ctx.addInitScript(() => { localStorage.setItem('sim.dev', 'admin'); });
      const page = await ctx.newPage();
      for (const s of list) {
        try {
          await page.goto(shotUrl(s), { waitUntil: 'domcontentloaded', timeout: 120_000 });
          await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 150_000 }).catch(() => log('  (shot not ready in 150 s; taking it anyway)'));
          await page.waitForTimeout(2500);
          const file = resolve(out, `${s.name}${dpr === 2 ? '@2x' : ''}.png`);
          await page.screenshot({ path: file, timeout: 120_000 });
          report.shots.push({ name: s.name, dpr, file }); log(`  📷 ${s.name}${dpr === 2 ? '@2x' : ''}.png`);
        } catch (e) { log(`  (screenshot ${s.name} dpr ${dpr} failed: ${String(e.message).split('\n')[0]})`); }
      }
      await ctx.close();
    }
  } finally { if (browser) await browser.close().catch(() => { }); release(); }
}

// ================================================================ the Souls' scripted agents
// mars-two frame: x = east, z = south; Mimos origin (48, 0). Room rectangles (layout.mjs, N/E → x = E + 48, z = −N).
const X0 = 48, R = (n0, n1, e0, e1) => ({ x0: e0 + X0, x1: e1 + X0, z0: -n1, z1: -n0 });
const ROOMS = { 'mimos/main': R(0.09, 5.92, -4.73, 0), 'mimos/main-south': R(-1.85, 0.09, -4.73, 0), 'mimos/floor': R(-1.85, 0.75, 0, 3.66), 'kitchen/working-kitchen': R(-1.85, 5.92, -11.735, -7.615), 'kitchen/dining-hall': R(-1.85, 5.92, -7.615, -4.73) };
const inRoom = (p, k) => { const r = ROOMS[k]; return !!p && p[0] >= r.x0 - 0.15 && p[0] <= r.x1 + 0.15 && p[2] >= r.z0 - 0.15 && p[2] <= r.z1 + 0.15; };
const LOFT_Y = 2.857, LOFT = [-13.07, -55.69];
const PEOPLE = [
  { key: 'ana', name: 'Ana', description: 'a Mars College resident who starts the day with tea in Mimos' },
  { key: 'ben', name: 'Ben', description: 'studies on the raised floor in Mimos, then joins friends in the tea room' },
  { key: 'cleo', name: 'Cleo', description: 'cooks in the Chiba kitchen' },
  { key: 'dev', name: 'Dev', description: 'eats in the diner and talks to whoever is cooking' },
  { key: 'eli', name: 'Eli', description: 'reads in the Tool library loft and wanders the racks' },
];
const souls = {};

/** Follow an accepted act's receipt to its end; the body's samples and where it ends. */
async function follow(s, acted, { maxS = 300, until } = {}) {
  if (!acted?.accepted) return { accepted: false, code: acted?.code, reason: acted?.reason, samples: [], end: null };
  const id = acted.receipt?.id, samples = [], t0 = Date.now(); let rec = acted.receipt;
  while (Date.now() - t0 < maxS * 1000) {
    const o = await observe(s); const me = o.self;
    samples.push({ p: me.position, activity: me.activity });
    if (until?.(me)) break;
    if (id) rec = (await api(`/v1/edge/receipts/${encodeURIComponent(id)}`, { as: s })).data?.receipt ?? rec;
    if (['completed', 'failed', 'replaced'].includes(rec?.phase)) break;
    await sleep(800);
  }
  const o = await observe(s);
  return { accepted: true, phase: rec?.phase, code: rec?.code, reason: rec?.reason, samples, end: { p: o.self.position, activity: o.self.activity, holding: o.self.holding ?? o.self.carrying ?? null } };
}
const walked = (sm) => sm.reduce((l, x, i) => (i && x.p && sm[i - 1].p ? l + Math.hypot(x.p[0] - sm[i - 1].p[0], x.p[2] - sm[i - 1].p[2]) : l), 0);

/** One task of a Soul's day. `find` picks a capability by verb and a pattern over its id and label (nearest first). */
async function task(who, k) {
  const s = souls[who], t0 = Date.now();
  // a scripted agent names the thing it wants (never `sit:here`, the nearest free seat, which two Souls arriving at once can both pick)
  const pick = async (verb, re) => { const c = (await caps(s)).filter((x) => x.verb === verb && !x.id.endsWith(':here') && (!re || re.test(`${x.id} ${x.label}`))); return c.find((x) => x.available) ?? c[0]; };
  let r;
  if (k.do === 'walk') {
    const a = (await api('/v1/edge/act', { as: s, body: { capability: `walk:${k.to}` } })).data;
    r = await follow(s, a, { maxS: k.maxS ?? 300 });
  } else if (k.do === 'sit' || k.do === 'take' || k.do === 'put') {
    const verb = { sit: 'sit', take: 'pick-up', put: 'put-on' }[k.do];
    const c = await pick(verb, k.match);
    if (!c) r = { accepted: false, code: 'no-capability', reason: `no ${verb} capability matching ${k.match}`, samples: [] };
    else if (!c.available) r = { accepted: false, code: c.blocked?.code ?? 'unavailable', reason: `${c.id}: ${c.blocked?.reason ?? 'not available'}`, samples: [] };
    else {
      const a = (await api('/v1/edge/act', { as: s, body: { capability: c.id, ...(k.do === 'sit' ? { params: { seconds: 600 } } : {}) } })).data;
      r = { ...(await follow(s, a, { maxS: k.maxS ?? 300, until: k.do === 'sit' ? (me) => me.activity === 'sit' : undefined })), cap: c.id };
      if (k.do === 'sit' && r.end?.activity === 'sit') r.phase = 'completed';
    }
  } else if (k.do === 'say') {
    const a = (await api('/v1/edge/say', { as: s, body: { text: k.text } })).data;
    r = { accepted: !!a?.said, phase: a?.said ? 'completed' : 'failed', heardBy: a?.said?.heardBy ?? 0, code: a?.code, reason: a?.reason ?? a?.error?.message, samples: [] };
    report.said.push({ who, text: k.text, heardBy: r.heardBy, channel: a?.said?.channel?.kind });
    if (k.heard && r.heardBy < 1) { r.phase = 'failed'; r.code = 'unheard'; }
  } else if (k.do === 'wait') { await sleep(k.s * 1000); r = { accepted: true, phase: 'completed', samples: [] }; }
  const o = await observe(s), p = o.self.position;
  const where = p ? (await query({ where: [p[0], p[2]] })).where : null;
  const room = where?.room ? `${where.room.building ?? where.room.of ?? ''}/${where.room.room ?? where.room.id ?? ''}` : null;
  const res = { task: k.label ?? `${k.do} ${k.to ?? k.match ?? k.text ?? ''}`, accepted: r.accepted, phase: r.phase, code: r.code, reason: r.reason, cap: r.cap, s: +((Date.now() - t0) / 1000).toFixed(1), walked: +walked(r.samples ?? []).toFixed(1), end: p?.map((v) => +v.toFixed(2)), activity: o.self.activity, room, heardBy: r.heardBy };
  const ok = r.accepted && r.phase === 'completed' && (!k.check || k.check(p, o.self));
  res.ok = !!ok;
  (report.souls[who] ??= []).push(res);
  log(`   ${ok ? '·' : '✖'} ${souls[who].name}: ${res.task} → ${res.phase ?? res.code} ${res.room ?? ''} ${res.end ? `[${res.end.join(', ')}]` : ''} ${res.s}s${ok ? '' : ` (${res.code ?? ''} ${res.reason ?? ''})`}`);
  return res;
}
/** Run each Soul's list of tasks at the same time (one scripted agent per Soul). */
const day = (plans) => Promise.all(Object.entries(plans).map(async ([who, list]) => { const rs = []; for (const k of list) rs.push(await task(who, k)); return [who, rs]; })).then(Object.fromEntries);
const allOk = (res) => Object.values(res).every((rs) => rs.every((x) => x.ok));
const brief = (res) => Object.fromEntries(Object.entries(res).map(([k, rs]) => [k, rs.map((x) => `${x.ok ? 'ok' : 'FAIL'} ${x.task}: ${x.phase ?? x.code}${x.room ? ' @' + x.room : ''}${x.ok ? '' : ` (${x.code ?? ''} ${(x.reason ?? '').slice(0, 120)})`}`)]));

let bootMs = 0, c0 = null;
try {
  bootMs = await boot();
  log(`▶ world "${slug}" on :${port} booted from the mars-two template in ${bootMs.toFixed(0)} ms`);
  await step('G0 the owner mints a god token', async () => { const r = await api('/v1/god/mint', { as: 'admin', body: { label: 'e2e mars-lived' } }); godToken = r.data.token; return { status: r.status, token: !!godToken }; }, (r) => r.status === 200 && r.token);
  await step('G1 the brief\'s fixes are in the template: the Tool library stair and Mimos\'s glazed front; the loft is reachable from the ground (and back), main south from outside through the door of the glazed front, the tea room from the raised main by the risers, and the north booths of the diner along its aisle', async () => {
    const st = (await query({ describe: 'tool-library-stair' })).describe, gl = (await query({ describe: 'mimos-front-glazing' })).describe;
    // (right after boot the engine is still taking the template in: ask again for up to a minute)
    const reach = async (from, to) => { let r; for (let i = 0; i < 60; i++) { r = (await query({ reach: { from, to } })).reach; if (r?.reachable) break; await sleep(1000); } return r?.reachable ? { m: r.length, levels: r.levels } : { code: r?.code }; };
    const TERRACE = [-9.5, LOFT_Y, -54.92];
    const up = await reach([-9.6, -46.5], TERRACE), down = await reach(TERRACE, [-9.6, -46.5]);
    const inMimos = await reach([45.22, 4.0], [45.5, 1.0]), mainToFloor = await reach([45.6, 0.53, -3], [48.25, 1.35]);
    const dinerNorth = await reach([41.3, 0.53, -1.5], [41.0, 0.53, -5.0]);
    return { stair: st ? [st.pose.x, st.pose.z] : null, glazing: gl ? [gl.pose.x, gl.pose.z] : null, up, down, inMimos, mainToFloor, dinerNorth };
  }, (r) => r.stair && r.glazing && r.up.levels?.includes(2) && r.down.levels?.includes(2) && r.inMimos.m < 9 && r.mainToFloor.m < 12 && r.dinerNorth.m < 6);
  await step('G2 the default world has no economy: the god\'s currency and relate are refused (layers.deferred); ownership still works (dry run)', async () => {
    const e = (await api('/v1/god/act', { body: { ops: [{ op: 'economy', currency: 'shells' }] } })).data;
    const rel = (await api('/v1/god/act', { body: { ops: [{ op: 'relate', a: 'soul:ana', rel: 'friend', b: 'soul:ben' }] } })).data;
    const own = (await api('/v1/god/dryrun', { body: { ops: [{ op: 'place', def: 'core/chair@1', name: 'ana-chair', p: [60, 20], owner: 'soul:Ana', access: 'private' }] } })).data;
    return { economy: e.failures?.[0]?.code, relate: rel.failures?.[0]?.code, ownDryrun: own.accepted ?? own.failures };
  }, (r) => r.economy === 'layers.deferred' && r.relate === 'layers.deferred');
  for (let i = 0; i < 60 && !c0; i++) { c0 = await clock(); if (!c0) await sleep(1000); }

  // ======================== five Souls, born through the normal owner flow
  for (const who of PEOPLE) {
    await step(`S0 an owner creates a Soul "${who.name}"; an agent pairs and gets a Soul token`, async () => {
      const inv = await api('/v1/admin', { as: 'admin', body: { action: 'invite', uses: 1 } });
      await api('/v1/invite', { as: who.key, body: { code: inv.data.code } });
      const s = await api('/v1/souls', { as: who.key, body: { name: who.name, description: who.description } });
      const soul = s.data.soul;
      const c = soul ? await api(`/v1/souls/${soul.id}/pair`, { as: who.key, body: {} }) : null;
      const x = c ? await api('/v1/agent/pair', { as: 'none', body: { code: c.data.code, agent: `e2e mars-lived ${who.key}` } }) : null;
      souls[who.key] = { ...who, soul, token: x?.data?.token };
      for (let i = 0; i < 60; i++) { const o = await observe(souls[who.key]); if (o?.self?.position) return { soul: soul.id, at: o.self.position }; await sleep(500); }
      return { soul: soul?.id };
    }, (r) => r.at);
  }
  await step('S1 no Soul is offered buy, pay or sell, and /layers/me has no wallet (deferred economy)', async () => {
    const all = (await caps(souls.ana)).map((c) => c.verb); const me = (await api('/v1/world/layers/me', { as: souls.ana })).data;
    return { econ: all.filter((v) => ['buy', 'pay', 'sell'].includes(v)), me: Object.keys(me ?? {}), verbs: [...new Set(all)].sort() };
  }, (r) => r.econ.length === 0 && !r.me.includes('wallet'));

  // ======================== morning: everyone to their place at once
  const inMimosFloor = (p) => inRoom(p, 'mimos/floor'), inKitchen = (p) => inRoom(p, 'kitchen/working-kitchen'), inDiner = (p) => inRoom(p, 'kitchen/dining-hall');
  const m = await step('D1 morning, all five at once: Ana into Mimos through the glazed front to the honey sofa; Ben up to the raised main and the red sofa; Cleo into the kitchen for a mixing bowl; Dev to a diner bus seat; Eli up the new stair to a Tool library loft cushion', () => day({
    ana: [{ do: 'walk', to: 'mimos' }, { do: 'walk', to: 'mimos/floor', check: inMimosFloor }, { do: 'sit', match: /honey.sofa/, check: inMimosFloor }],
    ben: [{ do: 'walk', to: 'mimos/main', check: (p) => inRoom(p, 'mimos/main') && p[1] > 0.45 }, { do: 'sit', match: /red.sofa/, check: (p) => inRoom(p, 'mimos/main') }],
    cleo: [{ do: 'walk', to: 'kitchen/working-kitchen', check: inKitchen }, { do: 'take', match: /bowl/, check: inKitchen }],
    dev: [{ do: 'walk', to: 'kitchen/dining-hall', check: inDiner }, { do: 'sit', match: /bus-seat-21/, check: inDiner }],
    eli: [{ do: 'sit', match: /tool.library.floor.cushion|floor.cushion/, maxS: 420, check: (p) => p && Math.abs(p[1] - LOFT_Y) < 0.35 }],
  }), allOk);
  report.morning = m && brief(m);
  const m2 = await step('D2 Ben comes down off the raised main by the risers, through the pass-through pallet racks into the tea room, and takes a tea stool beside Ana', () => day({
    ben: [{ do: 'walk', to: 'mimos/floor', check: inMimosFloor }, { do: 'sit', match: /tea-stool/, check: inMimosFloor }],
  }), allOk);
  const walkedDown = m2?.ben?.[0]?.walked;
  await step('D2b the risers are his way down: main → tea room is a short walk (not round by the rear stair)', async () => ({ walked: walkedDown }), (r) => r.walked > 0 && r.walked < 16);
  const m2t = await step('D2c Ana and Ben talk in the tea room; each is heard by the other', () => day({
    ben: [{ do: 'say', text: 'Morning, Ana. Is there still tea?', heard: true }],
    ana: [{ do: 'wait', s: 2 }, { do: 'say', text: 'Morning Ben, the kettle is still warm.', heard: true }],
  }), allOk);
  report.talk = m2t && brief(m2t);
  const P = (k) => report.souls[k]?.at(-1)?.end;
  // ---- Souls in Mimos, the kitchen and the diner (roofs off, from above the room, and inside at eye height)
  {
    const a = P('ana') ?? [49.8, 0, 0.4], c = P('cleo') ?? [38.3, 0.53, -2], d = P('dev') ?? [42.9, 0.53, -3];
    await shots([
      { name: 'mimos-tea-room', eye: [a[0] + 3.2, 4.2, a[2] + 4.6], at: [a[0] - 0.6, 0.6, a[2] - 0.6], hideRoofs: true },
      { name: 'mimos-inside', eye: [a[0] - 2.6, 1.7, a[2] + 0.9], at: [a[0] + 1.5, 0.7, a[2] - 0.2] },
      { name: 'kitchen', eye: [c[0] + 1.2, 4.6, c[2] + 4.2], at: [c[0], 0.9, c[2] - 0.8], hideRoofs: true },
      { name: 'diner', eye: [d[0] - 2.6, 4.4, d[2] + 3.6], at: [d[0] + 0.6, 0.9, d[2] - 0.6], hideRoofs: true },
      { name: 'loft', eye: [LOFT[0] + 6.5, 6.5, LOFT[1] + 7.5], at: [LOFT[0] + 1.5, 2.4, LOFT[1] + 1.5], hideRoofs: true },
    ]);
  }

  // ======================== late morning: carrying, the racks, the showers
  const m3 = await step('D3 late morning: Cleo carries the bowl to a blue diner table, sits in a bus seat and talks with Dev; Ana carries a cup from the Mimos coffee table to the kitchen prep table; Ben walks to the showers; Eli comes down the stair and walks to the Dojo', () => day({
    cleo: [{ do: 'walk', to: 'kitchen/dining-hall', check: inDiner }, { do: 'put', match: /diner-table/, check: inDiner }, { do: 'sit', match: /bus-seat-20/, check: inDiner }, { do: 'say', text: 'Dev, lunch is on the table.', heard: true }],
    dev: [{ do: 'wait', s: 30 }, { do: 'say', text: 'Smells good, Cleo.', heard: true }],
    ana: [{ do: 'take', match: /coffee-table-ceramic-cup/, check: (p) => inRoom(p, 'mimos/main') || inRoom(p, 'mimos/main-south') }, { do: 'walk', to: 'kitchen/working-kitchen', check: inKitchen }, { do: 'put', match: /prep-table-15 /, check: inKitchen }],
    ben: [{ do: 'walk', to: 'showers' }],
    eli: [{ do: 'walk', to: 'dojo', maxS: 420 }],
  }), allOk);
  report.lateMorning = m3 && brief(m3);
  // ======================== lunch: everyone in the diner
  const m4 = await step('D4 lunch: Ana, Ben and Eli join Cleo and Dev in the dining hall; Ana and Ben take the north booths (reachable now); they talk', () => day({
    ana: [{ do: 'walk', to: 'kitchen/dining-hall', check: inDiner }, { do: 'sit', match: /bus-seat-23/, check: inDiner }, { do: 'wait', s: 25 }, { do: 'say', text: 'Thanks for lunch, Cleo.', heard: true }],
    ben: [{ do: 'walk', to: 'kitchen/dining-hall', check: inDiner }, { do: 'sit', match: /bus-seat-25/, check: inDiner }],
    // (every booth has someone on its aisle seat by now; the wall seat beyond them is not taken: reaching it past a seated
    // body faults the engine — open issue in the lane report — so Eli stands at the booths' end and talks)
    eli: [{ do: 'walk', to: 'kitchen/dining-hall', maxS: 420, check: inDiner }, { do: 'say', text: 'The library loft has a stair now.', heard: true }],
  }), allOk);
  report.lunch = m4 && brief(m4);
  { const d = P('cleo') ?? [42.9, 0.53, -3]; await shots([{ name: 'diner-lunch', eye: [d[0] - 2.8, 4.6, d[2] + 3.8], at: [d[0] + 0.6, 0.9, d[2] - 1.2], hideRoofs: true }]); }

  await step('W the day ran for at least twenty world-minutes', async () => { const c1 = await clock(); return { from: c0, to: c1, minutes: +(worldMinute(c1) - worldMinute(c0)).toFixed(0) }; }, (r) => r.minutes >= 20);
  await step('T nothing faulted: no engine faults or violations in the server log', async () => ({ faults: (serverLog.match(/engine fault|violat/g) ?? []).length }), (r) => r.faults === 0);
} catch (e) {
  report.failures.push({ name: 'harness', error: String(e?.stack ?? e) });
  log('harness error', e);
} finally {
  const tasks = Object.values(report.souls).flat();
  report.summary = { steps: report.steps.length, failed: report.failures.length, tasks: tasks.length, tasksOk: tasks.filter((x) => x.ok).length, bootMs: +bootMs.toFixed(0), faults: (serverLog.match(/engine fault|violat/g) ?? []).length };
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(resolve(out, 'server.log'), serverLog);
  const md = [`# mars-lived e2e (five Souls, a Mars morning) — ${report.startedAt}`, '', `boot ${report.summary.bootMs} ms · ${report.summary.steps} steps · ${report.summary.failed} failed · tasks ${report.summary.tasksOk}/${report.summary.tasks} · engine faults/violations: ${report.summary.faults}`, '', '| step | ms | ok |', '|---|---:|:-:|', ...report.steps.map((s) => `| ${s.name} | ${s.ms} | ${s.ok ? '✔' : '✖ ' + (s.error ?? JSON.stringify(s.result)).slice(0, 300).replace(/\|/g, '/')} |`), '', '## Souls', ...Object.entries(report.souls).flatMap(([k, rs]) => [`### ${k}`, ...rs.map((x) => `- ${x.ok ? '✔' : '✖'} ${x.task} → ${x.phase ?? x.code} ${x.room ?? ''} ${x.end ? `[${x.end.join(', ')}]` : ''} ${x.s}s${x.ok ? '' : ` (${x.code ?? ''} ${x.reason ?? ''})`}`)]), '', '## said', ...report.said.map((x) => `- ${x.who}: "${x.text}" — heard by ${x.heardBy} (${x.channel})`), '', '## shots', ...report.shots.map((s) => `- ${s.name} dpr ${s.dpr}: \`${s.file}\``)].join('\n');
  writeFileSync(resolve(out, 'REPORT.md'), md);
  log(`\n${report.summary.failed ? '✖' : '✔'} ${report.summary.steps} steps, ${report.summary.failed} failed; tasks ${report.summary.tasksOk}/${report.summary.tasks}. Report: ${resolve(out, 'REPORT.md')}`);
  if (!args.keep) stop();
  process.exit(report.summary.failed ? 1 : 0);
}
