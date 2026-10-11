#!/usr/bin/env node
// LAYERS proof: a god world's invisible systems, played by the god and two Souls in one scenario (no web UI: the god
// CLI eden-god.mjs and the UNCHANGED Soul CLI tools/edge-skill/eden-agent.mjs, plus the Soul API):
//   the GOD zones a little town (a commercial quarter, homes), builds a café with a door, a market plaza with stalls, a
//   lamp and Ana's private back door; schedules the café (07:00–15:00, its door unlocks while open), the market
//   (Saturdays 09:00–13:00) and a concert (20:00); makes Ana the café's owner (she works there), puts a loaf on sale,
//   names the currency and gives Souls coins;
//   BEN checks `whatson` before nine, sees the market opening, and walks there at opening time; the café door has
//   unlocked by itself; the concert is on the calendar; BEN buys a loaf from ANA (wallets move, the loaf is his);
//   BEN cannot open Ana's private door (refused, with the reason) and ANA can; undo of a god grant restores wallets.
//
//   node tools/god-skill/e2e/layers.mjs [--port 5711] [--keep]
//
// Report under .lane/e2e-layers/<stamp>/ (report.json, REPORT.md, every CLI read as JSON under reads/).
import { spawn, execFile } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const slug = typeof args.slug === 'string' ? args.slug : 'layers';
const port = Number(args.port ?? 5711);
const out = resolve(root, '.lane/e2e-layers', stamp);
mkdirSync(resolve(out, 'reads'), { recursive: true });
const dataDir = resolve(out, 'data');
const base = `http://127.0.0.1:${port}/w/${slug}`;
const report = { slug, port, startedAt: new Date().toISOString(), steps: [], failures: [] };
const log = (...a) => console.log(...a);
const t = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- the world process (fake minds, dev auth, fresh data dir, local Mars assets)
const marsWeb = resolve(root, '.lane/mars-web');
const env = { ...process.env, ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), WORLD_KEY: slug, WORLD_ID: `${slug}-1`, ENGINE: 'mars', PORT: String(port), DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', SOUL_LIFECYCLE: '1', EDGE_FADING: '1', INVITE_REQUIRED: '0', MIND_DRIVER: 'edge', MAX_SOULS_PER_USER: '10', DATA_DIR: dataDir, PUBLIC_URL: `http://127.0.0.1:${port}` };
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

async function api(path, { method, body, token } = {}) {
  const headers = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
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
  log(`${okay ? '✔' : '✖'} ${name} — ${ms.toFixed(0)} ms${okay ? '' : ' — ' + (error ?? JSON.stringify(brief)).slice(0, 600)}`);
  return result;
}

// ---------- the god CLI and two Soul CLIs, each in its own folder
const GOD = resolve(root, 'tools/god-skill/eden-god.mjs'), CLI = resolve(root, 'tools/edge-skill/eden-agent.mjs');
const godDir = resolve(out, 'god-cli'); mkdirSync(godDir, { recursive: true });
const god = (...argv) => new Promise((ok) => execFile(process.execPath, [GOD, ...argv], { cwd: godDir, timeout: 180_000, env: { ...process.env, EDEN_GOD_NO_LEASE: '1' } }, (err, stdout, stderr) => ok({ code: err?.code ?? 0, out: String(stdout), err: String(stderr).slice(0, 400) })));
let reads = 0;
function soulCli(who) {
  const dir = resolve(out, `soul-${who}`); mkdirSync(dir, { recursive: true });
  const run = (...argv) => new Promise((ok) => execFile(process.execPath, [CLI, ...argv], { cwd: dir, timeout: 150_000, env: { ...process.env, EDEN_AGENT_NO_DASHBOARD: '1' } }, (err, stdout, stderr) => {
    const s = String(stdout); let data = null; try { data = JSON.parse(s.slice(s.indexOf('{'))); } catch { }
    writeFileSync(resolve(out, 'reads', `${String(++reads).padStart(3, '0')}-${who}-${argv[0]}.json`), JSON.stringify({ argv, data, raw: data ? undefined : s.slice(0, 2000), stderr: String(stderr).slice(0, 400) }, null, 1));
    ok({ code: err?.code ?? 0, data, stderr: String(stderr).slice(0, 400), raw: data ? undefined : s.slice(0, 400) });
  }));
  const state = () => JSON.parse(readFileSync(resolve(dir, '.eden-agent.json'), 'utf8'));
  /** Follow an accepted act's receipt to its end (the Soul's own token, as its agent would). */
  const follow = async (acted, maxS = 200) => {
    if (!acted?.accepted) return { accepted: false, code: acted?.code, reason: acted?.reason };
    const id = acted.receipt?.id, t0 = Date.now(), path = []; let rec = acted.receipt;
    while (Date.now() - t0 < maxS * 1000 && id) {
      const pos = (await api('/v1/edge/here', { token: state().token })).data?.here?.me?.pos; if (pos) path.push(pos);
      rec = (await api(`/v1/edge/receipts/${encodeURIComponent(id)}`, { token: state().token })).data?.receipt ?? rec;
      if (['completed', 'failed', 'replaced'].includes(rec?.phase)) break;
      await sleep(700);
    }
    return { accepted: true, resolved: acted.resolved?.to ?? rec?.capability, phase: rec?.phase, code: rec?.code, reason: rec?.reason, endedAt: rec?.endedAt, path };
  };
  return { run, state, follow, act: async (...a) => follow((await run('act', ...a)).data) };
}
const ana = soulCli('ana'), ben = soulCli('ben');
const tokenOf = (cli) => cli.state().token;
const entity = async (ref) => (await api(`/v1/world/entities/${ref}`)).data?.entity;
const caps = async (cli) => (await api('/v1/edge/observe?include=capabilities', { token: tokenOf(cli) })).data?.capabilities ?? [];
const me = async (cli) => (await api('/v1/world/layers/me', { token: tokenOf(cli) })).data;
const godOk = (g) => g.code === 0 && !/REFUSED/.test(g.out);
const until = async (fn, ms = 20_000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await fn(); if (v) return v; await sleep(500); } return v; };

let bootMs = 0;
try {
  bootMs = await boot();
  log(`▶ world "${slug}" on :${port} booted in ${bootMs.toFixed(0)} ms`);
  await step('G0 the owner mints a god token; before any layer the world has none (GET /v1/world/layers: no zones, things, relations)', async () => {
    const r = await api('/v1/god/mint', { token: 'dev:admin', body: { label: 'e2e layers' } });
    writeFileSync(resolve(godDir, '.eden-god.json'), JSON.stringify({ world: base, token: r.data.token }, null, 1));
    const L = (await api('/v1/world/layers')).data, snap = (await api('/v1/world/snapshot')).data;
    return { token: !!r.data.token, zones: L?.zones?.length, things: L?.things?.length, relations: L?.relations?.length, stateLayers: 'layers' in (snap?.state ?? {}) };
  }, (r) => r.token && r.zones === 0 && r.things === 0 && r.relations === 0 && r.stateLayers === false);
  await step('S0 two owners register the Soul CLI and create Souls Ana and Ben (the normal agent flow)', async () => {
    const o = {};
    for (const [who, cli, name] of [['ana', ana, 'Ana'], ['ben', ben, 'Ben']]) { await cli.run('register', base); const c = await cli.run('create-soul', name, 'a layers probe'); o[who] = c.data?.soul?.id ?? null; }
    for (let i = 0; i < 60 && !(await ana.run('here')).data?.me?.pos; i++) await sleep(500);
    return o;
  }, (r) => r.ana && r.ben);

  // ---- 1. land use: the god zones a little town; the zone suggests what suits it
  await step('L1 the god zones a commercial quarter and a residential street (zone …): each is a place; the CLI lists catalogue categories that suit it', async () => {
    const a = await god('zone', 'market-quarter', 'commercial', '--rect', '0,0,100,70'), b = await god('zone', 'homes', 'residential', '--rect', '0,70,100,40');
    const s = (await api('/v1/god/layers/zone-suggest?use=commercial')).data;
    return { ok: godOk(a) && godOk(b), suits: a.out.split('\n')[1], cats: s?.categories?.map((c) => `${c.category}:${c.defs.length}`) };
  }, (r) => r.ok && /building\.commercial/.test(r.suits ?? '') && r.cats?.some((c) => /^building\.commercial:[1-9]/.test(c)));
  const built = [
    ['place', 'plaza', '--rect', '15,-12,22,16', '--name', 'market'],
    ['place', 'market-stall', '--at', '10,-12', '--name', 'bread-stall'],
    ['place', 'market-stall', '--at', '20,-12', '--name', 'fruit-stall'],
    ['place', 'cafe', '--at', '-20,0', '--name', 'cafe'],
    ['place', 'door', '--at', '-20,10', '--name', 'cafe-door'],
    ['place', 'door', '--at', '30,-2', '--name', 'ana-back-door'],
    ['place', 'loaf', '--on', 'bread-stall', '--name', 'loaf'],
    ['place', 'lamp-post', '--at', '0,10', '--name', 'square-lamp'],
    ['place', 'cottage', '--at', '-20,80', '--name', 'ana-house'],
  ];
  await step('G1 the god builds the town: a market plaza with two stalls, a café, its door, Ana\'s back door (her stall store), a loaf on the bread stall, a lamp, Ana\'s house', async () => {
    const res = []; for (const c of built) { const g = await god(...c); res.push({ cmd: c.slice(0, 2).join(' ') + ' ' + c[c.length - 1], ok: godOk(g), out: godOk(g) ? undefined : g.out.slice(0, 200) + g.err }); }
    return { all: res.every((x) => x.ok), res };
  }, (r) => r.all);

  // ---- 2. schedules
  await step('H1 the god schedules: café 07:00–15:00 (its door unlocked while open), market Saturdays 09:00–13:00, a concert at 20:00 for 90 min on the plaza, the lamp on while dark', async () => {
    const res = [
      await god('hours', 'cafe', '--open', '07:00-15:00'),
      await god('hours', 'cafe-door', '--open', '07:00-15:00', '--follow', 'locked@open=false/true'),
      await god('hours', 'market', '--open', '09:00-13:00@sat', '--event', 'concert 20:00 90'),
      await god('hours', 'square-lamp', '--follow', 'on@dark=true/false'),
    ];
    const bad = await god('hours', 'cafe-door', '--follow', 'lit@dark=true');
    return { ok: res.every(godOk), outs: res.map((g) => g.out.trim()), refusedBadField: /REFUSED: state.invalid/.test(bad.out) };
  }, (r) => r.ok && r.refusedBadField);
  await step('H2 the world clock drives states: at 06:xx the café door is locked (closed) and the lamp is on; the concert is on the calendar (GET /v1/edge/calendar)', async () => {
    await god('time', '06:10');
    const door = await until(async () => { const e = await entity('cafe-door'); return e?.state?.locked === true ? e : null; });
    const lamp = await until(async () => { const e = await entity('square-lamp'); return e?.state?.on === true ? e : null; });
    const cal = await until(async () => { const c = (await ben.run('calendar')).data; return c?.items?.some((i) => /concert/.test(i.title)) ? c : null; });
    return { doorLocked: door?.state?.locked, lampOn: lamp?.state?.on, calendar: (cal?.items ?? []).map((i) => `${i.title} @ ${i.placeName} (${i.phase})`) };
  }, (r) => r.doorLocked === true && r.lampOn === true && r.calendar.some((x) => /concert @ market/.test(x)));
  await step('H3 at 08:45 Ben checks whatson: the market opens at 09:00 (in 15 min, with the walk to it) and the café is open now', async () => {
    await god('time', '08:45');
    const w = await until(async () => { const d = (await ben.run('whatson')).data; return d?.items?.some((i) => /market/.test(i.where) && i.startsInWorldMinutes > 0) ? d : null; });
    const m = w?.items?.find((i) => /market/.test(i.what)), c = w?.items?.find((i) => /cafe/.test(i.what));
    return { clock: w?.clock, market: m && { what: m.what, at: m.at, starts: m.startsInWorldMinutes, go: m.go }, cafe: c && { what: c.what, now: c.now } };
  }, (r) => r.market?.at === '09:00' && r.market.starts > 0 && r.market.starts <= 20 && /^walk:/.test(r.market.go ?? '') && r.cafe?.now === true);
  await step('H4 the café door unlocked by itself at opening time (an engine edit in the history); the lamp went out after dawn', async () => {
    const door = await until(async () => { const e = await entity('cafe-door'); return e?.state?.locked === false ? e : null; });
    const lamp = await until(async () => { const e = await entity('square-lamp'); return e?.state?.on === false ? e : null; });
    const h = await god('history', '8');
    return { doorLocked: door?.state?.locked, lampOn: lamp?.state?.on, history: h.out.split('\n').filter((l) => /schedule:/.test(l)).slice(0, 3) };
  }, (r) => r.doorLocked === false && r.lampOn === false && r.history.length >= 1);
  await step('H5 Ben walks to the market (whatson\'s walk) and is there at opening time: here names "market < market-quarter"; the market\'s hours say open now', async () => {
    const w = (await ben.run('whatson')).data, m = w?.items?.find((i) => /market/.test(i.what));
    const r = await ben.act(m?.go ?? 'walk:market');
    await god('time', '09:02');
    const h = (await ben.run('here')).data, L = (await api('/v1/world/layers')).data, mk = L?.things?.find((t) => t.name === 'market');
    const map = (await ben.run('map')).data?.places ?? [], zone = map.find((p) => p.id === 'g-market-quarter');
    return { walk: m?.go, phase: r.phase, placePath: h?.me?.placePath, hours: mk?.hours, zone: zone && { kind: zone.kind, description: zone.description } };
  }, (r) => r.phase === 'completed' && r.placePath?.[0] === 'market' && r.placePath?.includes('market-quarter') && /open now/.test(r.hours ?? '') && r.zone?.kind === 'commercial zone');

  // ---- 3. ownership, relationships, economy
  await step('O1 the god makes Ana the café\'s owner (she works there; her house and back door are hers, private), a friend of Ben; the loaf is hers, for 3 shells; Ben gets 10, Ana 2', async () => {
    const res = [
      await god('own', 'cafe', 'Ana'), await god('own', 'ana-back-door', 'Ana', '--private'), await god('own', 'ana-house', 'Ana', '--private'),
      await god('own', 'bread-stall/loaf', 'Ana'), await god('price', 'bread-stall/loaf', '3'), await god('currency', 'shells'),
      await god('give', 'Ben', '10'), await god('give', 'Ana', '2'),
      await god('relate', 'Ana', 'works-at', 'cafe'), await god('relate', 'Ana', 'lives-at', 'ana-house'), await god('relate', 'Ana', 'friend', 'Ben'),
    ];
    const L = await god('layers');
    return { ok: res.every(godOk), failed: res.filter((g) => !godOk(g)).map((g) => g.out + g.err), layers: L.out };
  }, (r) => r.ok && /wallets: .*Ben 10/.test(r.layers) && /Ana works-at cafe/.test(r.layers));
  await step('O2 the god grants 5 more and undoes it: Ben\'s wallet is 10 again (layer edits are undoable)', async () => {
    await god('give', 'Ben', '5'); const mid = (await me(ben))?.wallet; await god('undo'); const after = (await me(ben))?.wallet;
    return { mid, after };
  }, (r) => r.mid === 15 && r.after === 10);
  await step('O3 Souls perceive it: Ana\'s own view (wallet 2, owns café/door/house/loaf, works at the café, friend of Ben); the map says whose the café is and who works there; the public snapshot has no wallets', async () => {
    const a = await me(ana), map = (await ana.run('map')).data?.places ?? [], cafe = map.find((p) => p.id === 'g-cafe'), snap = (await api('/v1/world/snapshot')).data;
    return { wallet: a?.wallet, currency: a?.currency, owns: a?.owns?.map((o) => o.name), rel: a?.relationships, cafe: cafe?.description, snapWallets: snap?.state?.layers?.wallets };
  }, (r) => r.wallet === 2 && r.currency === 'shells' && ['cafe', 'ana-back-door', 'ana-house', 'bread-stall/loaf'].every((n) => r.owns?.includes(n)) && r.rel?.some((x) => x.you === 'works-at' && x.with === 'cafe') && /Ana's/.test(r.cafe ?? '') && /Ana works here/.test(r.cafe ?? '') && /open 07:00–15:00/.test(r.cafe ?? '') && Object.keys(r.snapWallets ?? {}).length === 0);
  await step('E1 Ben, at the market, sees the loaf on the bread stall; observe shows the loaf as "Ana\'s; for sale: 3 shells" and offers buy:<loaf> (you have 10 shells); picking it up first is refused (for sale)', async () => {
    const r = { phase: 'completed' };
    const loaf = await entity('bread-stall/loaf'), cs = await caps(ben), buy = cs.find((c) => c.id === `buy:${loaf.id}`), pick = cs.find((c) => c.id === `pick-up:${loaf.id}`);
    const o = (await api('/v1/edge/observe', { token: tokenOf(ben) })).data, seen = o?.here?.objects?.find((x) => x.id === loaf.id);
    return { walk: r.phase, buy: buy && { label: buy.label, available: buy.available }, pick: pick && { available: pick.available, blocked: pick.blocked?.code }, seen: seen && { owner: seen.owner, price: seen.price, what: seen.public?.what } };
  }, (r) => r.walk === 'completed' && r.buy?.available && /from Ana for 3 shells \(you have 10 shells/.test(r.buy.label) && (!r.pick || r.pick.blocked === 'object.for-sale') && r.seen?.owner === "Ana's" && /for sale: 3 shells/.test(r.seen.what ?? ''));
  await step('E2 Ben buys the loaf from Ana: accepted (a completed receipt); Ben 7, Ana 5; the loaf is Ben\'s ("yours"), no longer for sale; the purchase is an engine edit in the history', async () => {
    const loaf = await entity('bread-stall/loaf'), r = (await ben.run('act', `buy:${loaf.id}`)).data;
    const b = await me(ben), a = await me(ana), after = await entity('bread-stall/loaf');
    const o = (await api('/v1/edge/observe', { token: tokenOf(ben) })).data, seen = o?.here?.objects?.find((x) => x.id === loaf.id);
    const h = await god('history', '4');
    return { accepted: r?.accepted, receipt: r?.receipt?.phase, result: r?.result, ben: b?.wallet, ana: a?.wallet, owner: after?.owner, price: after?.price ?? null, seenOwner: seen?.owner, history: h.out.split('\n').find((l) => /bought/.test(l)) };
  }, (r) => r.accepted && r.receipt === 'completed' && r.ben === 7 && r.ana === 5 && /^soul:/.test(r.owner ?? '') && r.price === null && r.seenOwner === 'yours' && !!r.history);
  await step('E3 Ben cannot overspend: buying a 30-shell service at the fruit stall is refused (wallet.insufficient) and nothing moves', async () => {
    await god('own', 'fruit-stall', 'Ana'); await god('price', 'fruit-stall', '30', '--service', 'a fruit basket');
    const cafe = await entity('fruit-stall'), c = (await caps(ben)).find((x) => x.id === `buy:${cafe.id}`), r = (await ben.run('act', `buy:${cafe.id}`)).data, b = await me(ben);
    await god('price', 'fruit-stall', 'none');
    return { offered: c && { available: c.available, blocked: c.blocked?.code }, accepted: r?.accepted, code: r?.code, wallet: b?.wallet };
  }, (r) => r.offered?.available === false && r.offered.blocked === 'wallet.insufficient' && r.accepted === false && r.code === 'wallet.insufficient' && r.wallet === 7);
  await step('E4 Ben pays Ana 2 shells (pay:<Ana>): Ben 5, Ana 7', async () => {
    const id = ana.state().soul, cs = await caps(ben), c = cs.find((x) => x.id === `pay:${id}`);
    const r = (await api('/v1/edge/act', { token: tokenOf(ben), body: { capability: `pay:${id}`, params: { amount: 2, for: 'thanks' }, clientRef: 'pay-1' } })).data;
    return { offered: !!c, accepted: r?.accepted, ben: (await me(ben))?.wallet, ana: (await me(ana))?.wallet };
  }, (r) => r.accepted && r.ben === 5 && r.ana === 7);
  await step('P1 Ben cannot open Ana\'s private back door: the capability is blocked (object.private, "ana-back-door is Ana\'s and private") and acting it is refused; the door stays shut', async () => {
    const door = await entity('ana-back-door'), c = (await caps(ben)).find((x) => x.id === `object:${door.id}:open`);
    const r = (await ben.run('act', `object:${door.id}:open`, '{}', '--force')).data, after = await entity('ana-back-door');
    const o = (await api('/v1/edge/observe', { token: tokenOf(ben) })).data, seen = o?.here?.objects?.find((x) => x.id === door.id);
    return { cap: c && { available: c.available, code: c.blocked?.code, reason: c.blocked?.reason }, accepted: r?.accepted, code: r?.code, reason: r?.reason, open: after?.state?.open ?? false, seenOwner: seen?.owner };
  }, (r) => r.cap?.available === false && r.cap.code === 'object.private' && /Ana's and private/.test(r.cap.reason ?? '') && r.accepted === false && r.open === false && r.seenOwner === "Ana's, private");
  await step('P2 Ana can: she walks over to the market and opens her back door (walks up, reaches out); it is open in the world', async () => {
    await ana.act('walk:market');
    const door = await entity('ana-back-door'), c = (await caps(ana)).find((x) => x.id === `object:${door.id}:open`);
    const r = await ana.act(`object:${door.id}:open`, '{}', '--force');
    const after = await until(async () => { const e = await entity('ana-back-door'); return e?.state?.open === true ? e : null; });
    const o = (await api('/v1/edge/observe', { token: tokenOf(ana) })).data, seen = o?.here?.objects?.find((x) => x.id === door.id);
    return { cap: c?.available, phase: r.phase, open: after?.state?.open, seenOwner: seen?.owner };
  }, (r) => r.cap === true && r.phase === 'completed' && r.open === true && r.seenOwner === 'yours, private' || (r.cap === true && r.phase === 'completed' && r.open === true && r.seenOwner === 'yours'));
  await step('N1 night: at 20:30 the lamp is on, the café door locked again, and whatson lists the concert happening now on the market', async () => {
    await god('time', '20:30');
    const lamp = await until(async () => { const e = await entity('square-lamp'); return e?.state?.on === true ? e : null; });
    const door = await until(async () => { const e = await entity('cafe-door'); return e?.state?.locked === true ? e : null; });
    const w = await until(async () => { const d = (await ben.run('whatson')).data; return d?.items?.some((i) => /concert/.test(i.what) && i.now) ? d : null; });
    return { lamp: lamp?.state?.on, locked: door?.state?.locked, concert: w?.items?.find((i) => /concert/.test(i.what)) };
  }, (r) => r.lamp === true && r.locked === true && r.concert?.now === true && r.concert.where === 'market');
  await step('Z nothing faulted: no engine faults, violations, or layers errors in the server log', async () => ({ faults: (serverLog.match(/engine fault|violat/g) ?? []).length, layerErrors: (serverLog.match(/layers( capabilities)?:|god places:|perceive:|schedule: refused|calendar cal-/g) ?? []).length }), (r) => r.faults === 0 && r.layerErrors === 0);
} catch (e) {
  report.failures.push({ name: 'harness', error: String(e?.stack ?? e) });
  log('harness error', e);
} finally {
  report.summary = { steps: report.steps.length, failed: report.failures.length, bootMs: +bootMs.toFixed(0), faults: (serverLog.match(/engine fault|violat/g) ?? []).length };
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(resolve(out, 'server.log'), serverLog);
  const md = [`# LAYERS — ${slug} — ${report.startedAt}`, '', `boot ${report.summary.bootMs} ms · ${report.summary.steps} steps · ${report.summary.failed} failed · engine faults/violations in log: ${report.summary.faults}`, '', '| step | ms | ok |', '|---|---:|:-:|', ...report.steps.map((s) => `| ${s.name} | ${s.ms} | ${s.ok ? '✔' : '✖ ' + (s.error ?? JSON.stringify(s.result)).slice(0, 240).replace(/\|/g, '/')} |`), '', `CLI reads: \`${resolve(out, 'reads')}\``].join('\n');
  writeFileSync(resolve(out, 'REPORT.md'), md);
  log(`\n${report.summary.failed ? '✖' : '✔'} ${report.summary.steps} steps, ${report.summary.failed} failed. Report: ${resolve(out, 'REPORT.md')}`);
  if (!args.keep) stop();
  process.exit(report.summary.failed ? 1 : 0);
}
