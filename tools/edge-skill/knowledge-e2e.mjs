#!/usr/bin/env node
// knowledge/1 (R13) proof on a real local world, through the unchanged CLIs a world creator and an owner's agent use:
// one fresh god world (fake minds, dev auth) on the lane's port; the GOD (eden-god.mjs) lays out a plaza, a grove next
// to it, a garden off to the east and an orchard off to the north-west, and marks the grove secret (`secret grove`);
// Soul ANA (eden-agent.mjs) reads `here` (district + far names), cannot see/walk/name the grove, walks to the plaza,
// `look around` finds the grove, walks into it; walks to the garden and back, and `here` now gives the garden's
// distance and that she has been there; Soul BEN, who never looked, still sees no grove anywhere.
// Measures the chars (~tokens) of `here` with and without the scale fields, and of `look around`.
//
//   node tools/edge-skill/knowledge-e2e.mjs [--port 6100] [--keep]
//
// Report under <team>/scratch/knowledge/e2e/<stamp>/ (report.json, every CLI read under reads/).
// Stops only the world process it started itself.
import { spawn, execFile } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const port = Number(args.port ?? 6100), slug = 'knowledge';
if (port < 6100 || port > 6109) throw new Error('lane knowledge uses ports 6100-6109 only');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = resolve(process.env.KNOWLEDGE_E2E_OUT ?? '<team>/scratch/knowledge/e2e', stamp);
mkdirSync(resolve(out, 'reads'), { recursive: true });
const base = `http://127.0.0.1:${port}/w/${slug}`;
const report = { port, startedAt: new Date().toISOString(), steps: [], failures: [], sizes: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const marsWeb = resolve(root, '.lane/mars-web');
const env = { ...process.env, ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), WORLD_KEY: slug, WORLD_ID: `${slug}-1`, ENGINE: 'mars', PORT: String(port), DEV_AUTH: '1', BRAIN_MODE: 'fake', SEED_NATIVES: '0', SOUL_LIFECYCLE: '1', EDGE_FADING: '1', INVITE_REQUIRED: '0', MIND_DRIVER: 'edge', MAX_SOULS_PER_USER: '10', DATA_DIR: resolve(out, 'data'), PUBLIC_URL: `http://127.0.0.1:${port}` };
let server, serverLog = '';
const boot = async () => {
  server = spawn(process.execPath, ['apps/server/src/main.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
  report.serverPid = server.pid;
  server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
  for (let i = 0; i < 3000; i++) { try { const r = await fetch(`${base}/healthz`); if (r.ok) return; } catch { } await sleep(100); }
  throw new Error('world did not come up');
};
const stop = () => { try { server?.kill(); } catch { } };   // only the process this script spawned
process.on('exit', () => { if (!args.keep) stop(); });

async function api(path, { method, body, token } = {}) {
  const r = await fetch(base + path, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000) });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
async function step(name, fn, expect) {
  const t0 = performance.now(); let result, error;
  try { result = await fn(); } catch (e) { error = String(e?.stack ?? e?.message ?? e); }
  const okay = !error && (expect ? !!expect(result) : true), ms = Math.round(performance.now() - t0);
  report.steps.push({ name, ms, ok: okay, result, error }); if (!okay) report.failures.push({ name, result, error });
  console.log(`${okay ? '✔' : '✖'} ${name} — ${ms} ms${okay ? '' : ' — ' + (error ?? JSON.stringify(result)).slice(0, 700)}`);
  return result;
}

const GOD = resolve(root, 'tools/god-skill/eden-god.mjs'), CLI = resolve(root, 'tools/edge-skill/eden-agent.mjs');
const godDir = resolve(out, 'god-cli'); mkdirSync(godDir, { recursive: true });
const god = (...argv) => new Promise((ok) => execFile(process.execPath, [GOD, ...argv], { cwd: godDir, timeout: 180_000, env: { ...process.env, EDEN_GOD_NO_LEASE: '1' } }, (err, stdout, stderr) => ok({ code: err?.code ?? 0, out: String(stdout), err: String(stderr) })));
let reads = 0;
function soulCli(who) {
  const dir = resolve(out, `soul-${who}`); mkdirSync(dir, { recursive: true });
  const run = (...argv) => new Promise((ok) => execFile(process.execPath, [CLI, ...argv], { cwd: dir, timeout: 150_000, env: { ...process.env, EDEN_AGENT_NO_DASHBOARD: '1' } }, (err, stdout, stderr) => {
    const s = String(stdout); let data = null; try { data = JSON.parse(s.slice(s.indexOf('{'))); } catch { }
    writeFileSync(resolve(out, 'reads', `${String(++reads).padStart(3, '0')}-${who}-${argv.join('_').replace(/[^a-z0-9_:-]/gi, '').slice(0, 40)}.json`), JSON.stringify({ argv, chars: s.length, data, stderr: String(stderr).slice(0, 400) }, null, 1));
    ok({ code: err?.code ?? 0, data, chars: s.length, stderr: String(stderr).slice(0, 400) });
  }));
  const state = () => JSON.parse(readFileSync(resolve(dir, '.eden-agent.json'), 'utf8'));
  const follow = async (acted, maxS = 240) => {
    if (!acted?.accepted) return { accepted: false, code: acted?.code, reason: acted?.reason };
    const id = acted.receipt?.id, t0 = Date.now(); let rec = acted.receipt;
    while (Date.now() - t0 < maxS * 1000 && id) {
      rec = (await api(`/v1/edge/receipts/${encodeURIComponent(id)}`, { token: state().token })).data?.receipt ?? rec;
      if (['completed', 'failed', 'replaced'].includes(rec?.phase)) break; await sleep(700);
    }
    return { accepted: true, phase: rec?.phase, code: rec?.code, reason: rec?.reason, endedAt: rec?.endedAt?.placePath };
  };
  return { run, state, act: async (...a) => follow((await run('act', ...a)).data) };
}
const ana = soulCli('ana'), ben = soulCli('ben');
const SCALE = ['district', 'far', 'farMore'];
const sizeOf = (h) => { const all = JSON.stringify(h, null, 1).length, lean = JSON.stringify(Object.fromEntries(Object.entries(h ?? {}).filter(([k]) => !SCALE.includes(k))), null, 1).length; return { withScales: all, without: lean, added: all - lean, approxTokensAdded: Math.ceil((all - lean) / 4) }; };

try {
  await boot(); console.log(`▶ world "${slug}" on :${port}`);
  await step('G0 the god lays out a plaza, a grove beside it, a garden to the east, an orchard to the north-west', async () => {
    const r = await api('/v1/god/mint', { token: 'dev:admin', body: { label: 'knowledge e2e' } });
    writeFileSync(resolve(godDir, '.eden-god.json'), JSON.stringify({ world: base, token: r.data.token }, null, 1));
    const cmds = [['place', 'plaza', '--rect', '0,-18,16,14', '--name', 'plaza'], ['place', 'lawn', '--rect', '22,-18,10,10', '--name', 'grove'],
      ['place', 'lawn', '--rect', '70,30,20,20', '--name', 'garden'], ['place', 'lawn', '--rect', '-70,-60,20,20', '--name', 'orchard'], ['place', 'bench', '--at', '0,-20', '--name', 'plaza-bench']];
    const res = []; for (const c of cmds) { const g = await god(...c); res.push({ cmd: c.join(' '), ok: g.code === 0 && !/REFUSED/.test(g.out), out: g.out.slice(0, 160) }); }
    return { token: !!r.data.token, res };
  }, (r) => r.token && r.res.every((x) => x.ok));
  await step('G1 the god marks the grove secret (eden-god secret grove) and lists it', async () => {
    const a = await god('secret', 'grove'), b = await god('secret');
    return { mark: a.out.slice(0, 300), list: b.out.slice(0, 300), code: a.code + b.code };
  }, (r) => r.code === 0 && /g-grove/.test(r.mark) && /g-grove/.test(r.list));
  await step('S0 two owners register the Soul CLI and create Souls Ana and Ben', async () => {
    const o = {};
    for (const [who, cli, name] of [['ana', ana, 'Ana'], ['ben', ben, 'Ben']]) { await cli.run('register', base); const c = await cli.run('create-soul', name, 'a knowledge probe'); o[who] = c.data?.soul?.id ?? null; }
    for (let i = 0; i < 60 && !(await ana.run('here')).data?.me?.pos; i++) await sleep(500);
    return o;
  }, (r) => r.ana && r.ben);
  const h0 = await step('K1 Ana here: near detail as before, plus district and far names with directions; no grove anywhere', async () => {
    const r = await ana.run('here'), h = r.data; report.sizes.hereStart = sizeOf(h);
    return { where: h?.me?.placePath, district: h?.district, far: h?.far, farMore: h?.farMore, exits: (h?.exits ?? []).map((e) => e.to), grove: JSON.stringify(h).includes('grove'), size: report.sizes.hereStart };
  }, (r) => Array.isArray(r.far) && r.far.some((x) => /^garden · /.test(x)) && r.far.some((x) => /^orchard · /.test(x)) && !r.grove && r.far.every((x) => x.split(' · ').length === 2));
  await step('K2 the grove is secret to Ana: not on her map, not walkable by id or by name', async () => {
    const m = (await ana.run('map')).data?.places ?? [], a = (await ana.run('act', 'walk:grove')).data, b = (await ana.run('act', 'walk to the grove')).data;
    // the reply may quote the Soul's own words back; nothing else in it (reason, note, did_you_mean) names the grove
    return { onMap: m.some((p) => p.id === 'g-grove'), mapCount: m.length, byId: { accepted: a?.accepted, code: a?.code }, byName: { accepted: b?.accepted, code: b?.code, reason: b?.reason, leaks: /grove/i.test(JSON.stringify(b ?? {}).replaceAll('walk to the grove', '')) } };
  }, (r) => !r.onMap && r.mapCount > 0 && r.byId.accepted === false && r.byName.accepted === false && !r.byName.leaks);
  await step('K3 Ana walks to the plaza and looks around: the grove is found (remembered), with its walk', async () => {
    const w = await ana.act('walk:plaza'), r = await ana.run('look', 'around'); report.sizes.lookAround = r.chars;
    const full = await ana.run('look', 'around', '--full'); report.sizes.lookAroundFull = full.chars;
    return { walk: w.phase, found: r.data?.found, places: r.data?.places?.slice(0, 5), suggestion: r.data?.suggestion, chars: r.chars, fullChars: full.chars };
  }, (r) => r.walk === 'completed' && (r.found ?? []).some((x) => /^grove/.test(x) && x.includes('[walk:grove]')));
  await step('K4 now known: Ana walks into the grove; her map is still the public one (no grove), Ben still knows nothing of it', async () => {
    const w = await ana.act('walk:grove'), h = (await ana.run('here')).data, m = (await ana.run('map')).data?.places ?? [];
    const bh = (await ben.run('here')).data, bm = (await ben.run('map')).data?.places ?? [], bw = (await ben.run('act', 'walk:grove')).data;
    return { walk: w.phase, anaAt: h?.me?.placePath, anaMapHasGrove: m.some((p) => p.id === 'g-grove'), benHere: JSON.stringify(bh).includes('grove'), benMap: bm.some((p) => p.id === 'g-grove'), benWalk: bw?.accepted };
  }, (r) => r.walk === 'completed' && r.anaAt?.[0] === 'grove' && !r.anaMapHasGrove && !r.benHere && !r.benMap && r.benWalk === false);
  await step('K5 Ana walks to the garden and back to the plaza; her here now gives the garden\'s distance and that she has been', async () => {
    const a = await ana.act('walk:garden'), b = await ana.act('walk:plaza'), h = (await ana.run('here')).data; report.sizes.hereLater = sizeOf(h);
    const bf = (await ben.run('here')).data?.far ?? [];
    return { there: a.phase, back: b.phase, far: h?.far, district: h?.district, ben: bf.find((x) => /^garden/.test(x)) };
  }, (r) => r.there === 'completed' && r.back === 'completed' && r.far?.some((x) => /^garden · [NESW]{1,2} \d+m · been/.test(x)) && /^garden · [NESW]{1,2}$/.test(r.ben ?? ''));
  await step('K6 the god makes the grove public again: Ben sees it on his map', async () => {
    const g = await god('secret', 'grove', 'off'), bm = (await ben.run('map')).data?.places ?? [];
    return { code: g.code, benMap: bm.some((p) => p.id === 'g-grove') };
  }, (r) => r.code === 0 && r.benMap);
} catch (e) { report.failures.push({ name: 'crash', error: String(e?.stack ?? e) }); console.error(e); }
finally {
  report.finishedAt = new Date().toISOString(); report.ok = report.failures.length === 0;
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 1)); writeFileSync(resolve(out, 'server.log'), serverLog.slice(-200000));
  console.log(`${report.ok ? 'PASS' : 'FAIL'} ${report.steps.filter((s) => s.ok).length}/${report.steps.length} — ${out}`); console.log(JSON.stringify(report.sizes));
  if (!args.keep) stop();
  process.exit(report.ok ? 0 : 1);
}
