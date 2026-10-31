#!/usr/bin/env node
// Travel between worlds (M3, docs/sim/TRAVEL.md), end to end on two local worlds behind one launcher (dev sign-in,
// edge minds, fake brain, $0). Ana is born in Alder, dresses, travels to Birch and arrives with the same name, owner
// and body; Alder hides her and refuses her acts there; Birch's god closes Birch, Ben is refused, Ana still leaves;
// she returns to her old Birch Soul; home recalls her when Birch is left behind; site routes are never public.
//
//   node tools/world-launcher/travel.e2e.mjs [--port 6110] [--range 6111-6114] [--out <dir>] [--keep] [--cli]
//
// --cli also drives the Soul CLI (tools/edge-skill/eden-agent.mjs): `travel birch`, `observe` there, `travel home`.
// Writes report.json in --out (default .local/travel/e2e-<stamp>). Runs headless (no browser).
import { execFile, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { scratchDir } from '../lib/paths.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : [])).filter((x) => x.length));
const port = Number(args.port ?? 6110), range = typeof args.range === 'string' ? args.range : '6111-6114';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = resolve(typeof args.out === 'string' ? args.out : scratchDir(`travel/e2e-${stamp}`));
mkdirSync(out, { recursive: true });
const origin = `http://127.0.0.1:${port}`;
const report = { startedAt: new Date().toISOString(), port, range, steps: [], failures: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exec = promisify(execFile);

async function step(name, fn, expect) {
  const t0 = performance.now(); let result, error;
  try { result = await fn(); } catch (e) { error = String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '); }
  const ok = !error && (expect ? !!expect(result) : true), ms = Math.round(performance.now() - t0);
  report.steps.push({ name, ok, ms, result, error });
  if (!ok) report.failures.push({ name, result, error });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} (${ms} ms)${ok ? '' : ` — ${(error ?? JSON.stringify(result)).slice(0, 600)}`}`);
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  return result;
}
const until = async (what, fn, ms = 60_000) => { const end = Date.now() + ms; let last; while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = e.message; } await sleep(300); } throw new Error(`timed out: ${what} (${JSON.stringify(last)?.slice(0, 200)})`); };

// ---------- the launcher: our own process, own data dir, our ports only
const launcher = spawn(process.execPath, ['tools/world-launcher/launcher.mjs', '--port', String(port), '--range', range, '--data', join(out, 'data'), '--eager', '0', '--idle-ms', '600000'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let launcherLog = ''; launcher.stdout.on('data', (d) => { launcherLog += d; }); launcher.stderr.on('data', (d) => { launcherLog += d; });
const stop = () => { try { launcher.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', () => { writeFileSync(join(out, 'launcher.log'), launcherLog); if (!args.keep) stop(); });
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { stop(); process.exit(130); });

async function call(base, path, { who, token, method, body, headers } = {}) {
  const bearer = token ?? (who ? `dev:${who}` : null);
  const r = await fetch(base + path, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000) });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
const W = {};
/** A Soul for `who` in world `w`: created by the owner (native lifecycle), then paired → its agent's token. */
async function soulFor(w, who, name) {
  const made = await call(W[w], '/v1/souls', { who, body: { name } });
  const id = made.data?.soul?.id ?? made.data?.lifecycle?.soulId;
  if (!id) throw new Error(`create ${name}: ${JSON.stringify(made)}`);
  await until(`${name} ready`, async () => (await call(W[w], `/v1/souls/${id}/pair`, { who, method: 'POST', body: {} })).data?.code ? true : null, 60_000);
  const code = (await call(W[w], `/v1/souls/${id}/pair`, { who, method: 'POST', body: {} })).data.code;
  const paired = await call(W[w], '/v1/agent/pair', { body: { code, agent: `${who}'s agent` } });
  return { id, token: paired.data.token };
}
const bodyOf = async (w, entityId) => (await call(W[w], '/v1/debug/world')).data?.entities?.[entityId]?.body ?? null;
const ids = {};
try {
  await until('the launcher', async () => (await fetch(`${origin}/__sim/healthz`)).ok, 60_000);
  await step('S1 two worlds on one site: Alder and Birch (empty plains); gaia claims Birch as its god', async () => {
    for (const name of ['Alder', 'Birch']) { const r = await call(origin, '/__sim/worlds', { body: { name, template: 'empty' } }); W[r.data.slug] = `${origin}${r.data.world.basePath}`; }
    const claim = await call(W.birch, '/v1/god/claim', { who: 'gaia', body: {} });
    return { worlds: Object.keys(W), claim: claim.status, you: (await call(W.birch, '/v1/god/status', { who: 'gaia' })).data.you };
  }, (r) => r.worlds.join() === 'alder,birch' && r.you === 'owner');

  await step('S2 Ana is born in Alder (owner dev:ana), paired; her owner dresses her (a seeded kit look)', async () => {
    Object.assign(ids, { ana: await soulFor('alder', 'ana', 'Ana') });
    ids.ana.entity = `h_${ids.ana.id.slice(2)}`;
    const look = await until('look set', async () => { const r = await call(W.alder, `/v1/souls/${ids.ana.id}/look`, { who: 'ana', method: 'PUT', body: { random: true, seed: 4242 } }); return r.status === 200 ? r : null; }, 60_000);
    ids.ana.body = await bodyOf('alder', ids.ana.entity);
    return { id: ids.ana.id, entity: ids.ana.entity, look: look.status, body: !!ids.ana.body, status: (await call(W.alder, '/v1/edge/travel', { token: ids.ana.token })).data };
  }, (r) => r.look === 200 && r.body && r.status.home === 'alder' && r.status.state === 'present' && r.status.available === true && r.status.open === true);

  await step('T0 refusals before anything moves: unknown world, same world, no token', async () => ({
    unknown: (await call(W.alder, '/v1/edge/travel', { token: ids.ana.token, body: { to: 'nowhere' } })).data.code,
    same: (await call(W.alder, '/v1/edge/travel', { token: ids.ana.token, body: { to: 'Alder' } })).data.code,
    anon: (await call(W.alder, '/v1/edge/travel', { body: { to: 'birch' } })).status,
    still: (await call(W.alder, '/v1/edge/travel', { token: ids.ana.token })).data.state,
  }), (r) => r.unknown === 'travel.unknown-world' && r.same === 'travel.same-world' && r.anon === 401 && r.still === 'present');

  const first = await step('T1 Ana travels to Birch (agent: POST /v1/edge/travel {to:"Birch"}): Birch admits her and hands back its base and a token', async () => {
    const r = await call(W.alder, '/v1/edge/travel', { token: ids.ana.token, body: { to: 'Birch' } });
    return { status: r.status, ...r.data, token: r.data.token ? 'sim_…' : null, _token: r.data.token };
  }, (r) => r.status === 200 && r.ok && r.to === 'birch' && r.base === W.birch && r.created === true && r.name === 'Ana' && r._token?.startsWith('sim_'));
  ids.ana.birch = { id: first?.soulId, token: first?._token };

  await step('T2 in Birch she is the same Ana: name, owner (dev:ana lists her), body (the same look), a travel log', async () => {
    const me = (await call(W.birch, '/v1/edge/observe', { token: ids.ana.birch.token })).data;
    const mine = (await call(W.birch, '/v1/me', { who: 'ana' })).data;
    const ent = `h_${ids.ana.birch.id.slice(2)}`;
    const body = await until('her body in Birch', async () => { const b = await bodyOf('birch', ent); return JSON.stringify(b) === JSON.stringify(ids.ana.body) ? b : null; }, 30_000).catch(() => null);
    const st = (await call(W.birch, '/v1/edge/travel', { token: ids.ana.birch.token })).data;
    return { observed: me?.me?.name ?? me?.self?.name ?? me?.name ?? Object.keys(me ?? {}), owned: (mine.souls ?? []).some((s) => s.id === ids.ana.birch.id), sameBody: !!body, st: { traveller: st.traveller, home: st.home, here: st.here, state: st.state, log: st.log } };
  }, (r) => r.owned && r.sameBody && r.st.traveller === `alder/${ids.ana.id}` && r.st.home === 'alder' && r.st.here === 'birch' && r.st.state === 'present' && r.st.log.at(-1)?.to === 'birch');

  await step('T3 in Alder she is away: her old token gets travel.away for acts, the public Souls list leaves her out; Birch lists her as a visitor', async () => ({
    act: (await call(W.alder, '/v1/edge/observe', { token: ids.ana.token })).data?.error?.code,
    status: (await call(W.alder, '/v1/edge/travel', { token: ids.ana.token })).data,
    listed: ((await call(W.alder, '/v1/world/souls')).data.souls ?? []).some((s) => s.id === ids.ana.id),
    visitors: (await call(W.birch, '/v1/world/visitors')).data,
  }), (r) => r.act === 'travel.away' && r.status.state === 'away' && r.status.at === 'birch' && !r.listed && r.visitors.visitors.some((v) => v.name === 'Ana' && v.home === 'alder') && r.visitors.recent[0]?.kind === 'arrived');

  await step('G1 Birch\'s god closes Birch to visitors (only the god may: ana is refused)', async () => ({
    ana: (await call(W.birch, '/v1/god/visitors', { who: 'ana', body: { open: false } })).status,
    gaia: (await call(W.birch, '/v1/god/visitors', { who: 'gaia', body: { open: false } })).data,
    open: (await call(W.birch, '/v1/world/visitors')).data.open,
  }), (r) => r.ana === 403 && r.gaia.ok && r.gaia.open === false && r.open === false);

  await step('G2 Ben (born in Alder) is refused at closed Birch and stays in Alder, with the refusal in his log', async () => {
    ids.ben = await soulFor('alder', 'ben', 'Ben');
    const r = await call(W.alder, '/v1/edge/travel', { token: ids.ben.token, body: { to: 'birch' } });
    const st = (await call(W.alder, '/v1/edge/travel', { token: ids.ben.token })).data;
    return { status: r.status, code: r.data.code, state: st.state, here: st.here, observe: (await call(W.alder, '/v1/edge/observe', { token: ids.ben.token })).status };
  }, (r) => r.status === 403 && r.code === 'travel.closed' && r.state === 'present' && r.here === 'alder' && r.observe === 200);

  await step('L1 a resident can always leave: Ana goes home from closed Birch; she is back in Alder (same Soul), away in Birch', async () => {
    const r = await call(W.birch, '/v1/edge/travel', { token: ids.ana.birch.token, body: { to: 'home' } });
    ids.ana.token = r.data.token ?? ids.ana.token;
    return { status: r.status, to: r.data.to, soulId: r.data.soulId, returned: r.data.returned, base: r.data.base,
      home: (await call(W.alder, '/v1/edge/observe', { token: ids.ana.token })).status, birch: (await call(W.birch, '/v1/edge/observe', { token: ids.ana.birch.token })).data?.error?.code,
      listed: ((await call(W.alder, '/v1/world/souls')).data.souls ?? []).some((s) => s.id === ids.ana.id) };
  }, (r) => r.status === 200 && r.to === 'alder' && r.soulId === ids.ana.id && r.returned && r.base === W.alder && r.home === 200 && r.birch === 'travel.away' && r.listed);

  await step('R1 Birch reopens; Ana visits again and gets back her own Birch Soul (same id: her Birch history continues)', async () => {
    await call(W.birch, '/v1/god/visitors', { who: 'gaia', body: { open: true } });
    const r = await call(W.alder, '/v1/edge/travel', { token: ids.ana.token, body: { to: 'birch' } });
    ids.ana.birch.token = r.data.token;
    return { status: r.status, soulId: r.data.soulId, returned: r.data.returned, created: r.data.created, log: r.data.log?.map((e) => `${e.kind}:${e.from}>${e.to}`) };
  }, (r) => r.status === 200 && r.soulId === ids.ana.birch.id && r.returned && !r.created && r.log.length >= 3);

  await step('H1 home recalls her: with her Alder token she travels home from Alder itself; Birch lets her go', async () => {
    const r = await call(W.alder, '/v1/edge/travel', { token: ids.ana.token, body: { to: 'home' } });
    return { status: r.status, recalled: r.data.recalled, released: r.data.released, home: (await call(W.alder, '/v1/edge/observe', { token: ids.ana.token })).status,
      birch: (await call(W.birch, '/v1/edge/observe', { token: ids.ana.birch.token })).data?.error?.code, visitors: (await call(W.birch, '/v1/world/visitors')).data.visitors.length };
  }, (r) => r.status === 200 && r.recalled && r.released === 'released' && r.home === 200 && r.birch === 'travel.away' && r.visitors === 0);

  await step('P1 the site routes are private: no relay without the key, no /v1/site through the public proxy', async () => ({
    relay: (await call(origin, '/__sim/site/relay', { body: { to: 'birch', path: '/v1/site/arrive', body: {} } })).status,
    worlds: (await call(origin, '/__sim/site/worlds')).status,
    proxied: (await call(W.birch, '/v1/site/presence', { body: { traveller: `alder/${ids.ana.id}` } })).status,
    forged: (await call(origin, '/__sim/site/worlds', { headers: { 'x-sim-site-key': 'f'.repeat(64) } })).status,
  }), (r) => r.relay === 404 && r.worlds === 404 && r.proxied === 404 && r.forged === 404);

  await step('P2 histories stay per world: each world logs only its own births (Ana born once in each; Ben only in Alder)', async () => {
    const births = async (w) => ((await call(W[w], '/v1/log?limit=1000')).data.events ?? []).filter((e) => e.kind === 'birth').map((e) => e.payload?.name ?? e.payload?.soulId);
    return { alder: await births('alder'), birch: await births('birch') };
  }, (r) => r.alder.filter((n) => n === 'Ana').length === 1 && r.alder.includes('Ben') && r.birch.filter((n) => n === 'Ana').length === 1 && !r.birch.includes('Ben'));

  if (args.cli) {
    const dir = mkdtempSync(join(tmpdir(), 'travel-cli-'));
    const cli = (...a) => exec(process.execPath, [join(dir, 'eden-agent.mjs'), ...a], { cwd: dir, timeout: 180_000 }).then((r) => JSON.parse(r.stdout), (e) => { throw new Error(`${a.join(' ')} → ${String(e.stdout).slice(0, 300)} ${String(e.stderr).slice(0, 300)}`); });
    await step('C1 the Soul CLI: Cleo\'s agent (create-soul in Alder), `travel Birch` → its folder now speaks to Birch; `observe` there; `travel home`', async () => {
      copyFileSync(resolve(root, 'tools/world-launcher/soul/eden-agent.mjs'), join(dir, 'eden-agent.mjs')); // the pinned one-file bundle every world serves
      await cli('register', W.alder); await cli('create-soul', 'Cleo');
      const went = await cli('travel', 'Birch');
      const conf = JSON.parse(readFileSync(join(dir, '.eden-agent.json'), 'utf8'));
      const there = await cli('travel');
      const seen = await cli('observe').then(() => 'ok', (e) => e.message.slice(0, 200));
      const back = await cli('travel', 'home');
      const home = await cli('travel');
      const after = JSON.parse(readFileSync(join(dir, '.eden-agent.json'), 'utf8'));
      return { went: { to: went.to, base: went.base, printsToken: JSON.stringify(went).includes('sim_') }, confWorld: conf.world, keptHome: conf.travel?.home?.world, there: { here: there.here, state: there.state }, seen, back: { to: back.to }, home: { here: home.here, state: home.state }, afterWorld: after.world };
    }, (r) => r.went.to === 'birch' && !r.went.printsToken && r.confWorld === W.birch && r.keptHome === W.alder && r.there.here === 'birch' && r.seen === 'ok' && r.back.to === 'alder' && r.home.here === 'alder' && r.home.state === 'present' && r.afterWorld === W.alder);
  }
} finally {
  report.finishedAt = new Date().toISOString();
  report.ok = report.failures.length === 0;
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`${report.ok ? 'PASS' : 'FAIL'} ${report.steps.length - report.failures.length}/${report.steps.length} — ${out}`);
  if (!args.keep) { stop(); await sleep(1500); }
  process.exit(report.ok ? 0 : 1);
}
