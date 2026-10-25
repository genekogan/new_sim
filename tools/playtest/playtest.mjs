#!/usr/bin/env node
// Playtest orchestrator: run | review | replay | compare | preflight. See DESIGN.md §1.
import { mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync, cpSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { now, setAnchor, sleep, monoMs } from './lib/clock.mjs';
import { writeJson, readJson, appendJsonl } from './lib/jsonl.mjs';
import { quota, quotaAllows } from './lib/quota.mjs';
import { sha256, rng } from './lib/hash.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SERVER_ROOT = '<worktrees>/soul3-integration';
const RUNS_ROOT = join(homedir(), 'Eden/team/playtest/runs');
const STEPS = ['preflight', 'provision', 'seats', 'play', 'close', 'review', 'develop', 'report'];

function args(argv) { const out = { _: [] }; for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; out[k] = v; } else out._.push(a); } return out; }
const log = (...a) => console.error(`[playtest ${new Date().toISOString().slice(11, 19)}]`, ...a);
function receipt(runDir, n, step, data) { writeJson(join(runDir, 'receipts', `${n}-${step}.json`), { step, ...now(), ...data }); }
function hasReceipt(runDir, n, step) { const r = readJson(join(runDir, 'receipts', `${n}-${step}.json`)); return r && r.ok; }

async function loadModules() {
  const m = {};
  const tryImport = async (k, p) => { try { m[k] = await import(p); } catch (e) { m[k] = null; log(`module ${k} unavailable: ${e.message.split('\n')[0]}`); } };
  await tryImport('provision', './arena/provision.mjs');
  await tryImport('seat', './arena/seat.mjs');
  await tryImport('owner', './arena/owner.mjs');
  await tryImport('godSeat', './arena/god-seat.mjs');
  await tryImport('truth', './observer/world-truth.mjs');
  await tryImport('browser', './observer/browser.mjs');
  await tryImport('evidence', './observer/evidence.mjs');
  await tryImport('persona', './director/persona.mjs');
  await tryImport('director', './director/director.mjs');
  await tryImport('oracles', './review/oracles.mjs');
  await tryImport('reviewer', './review/reviewer.mjs');
  await tryImport('developer', './review/developer.mjs');
  await tryImport('metrics', './review/metrics.mjs');
  await tryImport('report', './review/report.mjs');
  await tryImport('compare', './review/compare.mjs');
  return m;
}

export async function preflight({ serverRoot }) {
  const q = await quota();
  const checks = { quota: q, serverRoot: existsSync(join(serverRoot, 'tools/god-skill/dev-world.mjs')), webDist: existsSync(join(serverRoot, 'apps/web/dist/index.html')), controllerCli: existsSync(join(serverRoot, 'tools/world-launcher/soul/eden.mjs')), playwright: existsSync('<repo>/mars/viewer/node_modules/@playwright/test'), claude: null, codex: null };
  const { run } = await import('./lib/proc.mjs');
  checks.claude = (await run('claude', ['--version'], { maxWallMs: 20000 })).stdout.trim();
  checks.codex = (await run('codex', ['--version'], { maxWallMs: 20000 })).stdout.trim();
  const allow = quotaAllows(q, { stopPct: 85 });
  const ok = checks.serverRoot && checks.webDist && checks.controllerCli && checks.playwright && !!checks.claude && allow.allowed;
  return { ok, allow, checks };
}

async function cmdRun(a) {
  const scenarioPath = resolve(a._[1]);
  const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));
  const seed = Number(a.seed ?? scenario.seed ?? 1);
  const serverRoot = resolve(a['server-root'] ?? scenario.serverRoot ?? DEFAULT_SERVER_ROOT);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  const runDir = a.out ? resolve(a.out) : join(RUNS_ROOT, `${stamp}-${scenario.name}-${seed}`);
  mkdirSync(join(runDir, 'receipts'), { recursive: true });
  setAnchor(performance.now());
  writeJson(join(runDir, 'scenario.json'), { ...scenario, seed, serverRoot, scenarioPath, scenarioSha256: sha256(readFileSync(scenarioPath)) });
  log(`run ${runDir}`);
  const from = a.from ? STEPS.indexOf(a.from) : 0;
  const m = await loadModules();
  const ctx = { runDir, scenario, seed, serverRoot, m, world: null, seats: [], god: null, browser: null, cameras: {}, owner: null };

  // 0 preflight
  if (from <= 0) { const pf = await preflight({ serverRoot }); writeJson(join(runDir, 'preflight.json'), pf); receipt(runDir, 0, 'preflight', { ok: pf.ok, allow: pf.allow }); if (!pf.ok) { log('preflight failed', JSON.stringify(pf.checks)); return 2; } }
  // 1 provision
  if (from <= 1) {
    if (!m.provision) throw new Error('arena/provision.mjs missing');
    if (scenario.world.kind !== 'dev') throw new Error(`world kind ${scenario.world.kind} is not available in this stage`);
    const slug = scenario.world.slug ?? `pt-${scenario.name}`.slice(0, 31);
    ctx.world = await m.provision.startWorld({ serverRoot, slug, port: scenario.world.port, genesis: join(serverRoot, scenario.world.genesis), dataDir: join(runDir, 'server', 'data'), log: join(runDir, 'server', 'world.log'), fresh: true });
    writeJson(join(runDir, 'world.json'), ctx.world);
    try { writeJson(join(runDir, 'server', 'healthz-before.json'), await m.provision.healthz(ctx.world.base)); } catch { /* recorded as missing */ }
    receipt(runDir, 1, 'provision', { ok: true, base: ctx.world.base, build: ctx.world.build });
  } else { ctx.world = readJson(join(runDir, 'world.json')); }

  let exitCode = 0;
  try {
    // 2 seats
    if (from <= 2) {
      if (!m.seat || !m.owner) throw new Error('arena/seat.mjs or owner.mjs missing');
      ctx.owner = m.owner;
      for (const s of scenario.seats) {
        const seat = await m.seat.createSeat({ runDir, seat: s, worldBase: ctx.world.base, serverRoot, rails: scenario.rails ?? {} });
        const ob = await seat.onboard({ text: onboardingText(ctx.world.base, s.soulName), maxWallSec: scenario.rails?.onboardWallSec ?? 600, timeoutSec: scenario.rails?.onboardTimeoutSec ?? 540 });
        log(`seat ${s.id}: ${ob.ok ? 'paired ' + ob.soulId : 'NOT PAIRED'}`);
        if (ob.ok) { const w = seat.wakeLoop?.(); log(`seat ${s.id}: wake loop ${w ? 'on' : 'off'}`); }
        ctx.seats.push(seat);
      }
      if (scenario.god && m.godSeat) {
        ctx.god = await m.godSeat.createGodSeat({ runDir, god: scenario.god, worldBase: ctx.world.base, serverRoot, rails: scenario.rails ?? {} });
        const gb = ctx.god.onboardGod ? await ctx.god.onboardGod({ maxWallSec: scenario.rails?.onboardWallSec ?? 600, timeoutSec: scenario.rails?.onboardTimeoutSec ?? 540 }) : await ctx.god.onboard({ text: godOnboardingText(ctx.world.base), maxWallSec: scenario.rails?.maxTurnWallSec ?? 300 });
        log(`god seat: ${gb.ok ? 'paired' : 'NOT PAIRED'}`);
        if (gb.ok) ctx.god.wakeLoop?.();
      }
      receipt(runDir, 2, 'seats', { ok: ctx.seats.every((s) => !!infoOf(s).soulId), seats: ctx.seats.map((s) => infoOf(s)), god: ctx.god ? infoOf(ctx.god) : null });
    }
    // 3 play
    if (from <= 3) {
      if (!m.director) throw new Error('director/director.mjs missing');
      let observer = null;
      if (m.browser && m.evidence && m.truth) {
        ctx.browser = await m.browser.openBrowser({ headless: true, gpu: scenario.observer?.gpu ?? 'metal' });
        const vpRaw = scenario.observer?.viewport ?? [1280, 800]; const vp = Array.isArray(vpRaw) ? { width: vpRaw[0], height: vpRaw[1] } : vpRaw;
        const openCam = async (opts) => { try { return await ctx.browser.openCamera({ ...opts, arrivalTimeoutMs: scenario.observer?.arrivalTimeoutMs ?? 180000 }); } catch (e) { log(`camera ${opts.name} failed: ${String(e.message).split('\n')[0]}`); return null; } };
        for (const seat of ctx.seats) { const info = infoOf(seat); if (info.soulId) { const cam = await openCam({ base: ctx.world.base, identity: info.ownerIdentity, kind: 'follow', soulId: info.soulId, viewport: vp, dpr: scenario.observer?.dpr ?? 1, runDir, name: info.id }); if (cam) ctx.cameras[info.id] = cam; } }
        if ((scenario.observer?.cameras ?? []).includes('wide')) { const cam = await openCam({ base: ctx.world.base, identity: null, kind: 'wide', viewport: vp, dpr: scenario.observer?.dpr ?? 1, runDir, name: 'wide' }); if (cam) ctx.cameras.wide = cam; }
        observer = { camera: (id) => ctx.cameras[id] ?? null, cameras: ctx.cameras, truth: m.truth, evidence: m.evidence, browser: ctx.browser, sampleSec: scenario.observer?.sampleSec ?? 5 };
      } else log('observer modules missing: playing without screenshots/evidence');
      const quotaCheck = async () => { const q = await quota(); const r = quotaAllows(q, { stopPct: scenario.rails?.quotaStopPct ?? 90 }); if (!r.allowed) log('QUOTA STOP', r.note); return r.allowed; };
      const play = await m.director.runPlay({ runDir, scenario, world: { ...ctx.world, name: scenario.world.slug, skillPath: join(runDir, 'server', 'skill.md') }, seats: Object.fromEntries(ctx.seats.map((s) => [infoOf(s).id, s])), god: ctx.god, observer, owner: m.owner, seed, quotaCheck });
      receipt(runDir, 3, 'play', { ok: true, ...play });
    }
    // 4 close
    if (from <= 4) {
      const closed = { seats: [], god: null };
      for (const seat of ctx.seats) { try { await seat.stop(); closed.seats.push(infoOf(seat)); } catch (e) { closed.seats.push({ error: e.message }); } }
      if (ctx.god) { try { await ctx.god.stop(); closed.god = infoOf(ctx.god); } catch (e) { closed.god = { error: e.message }; } }
      if (ctx.sampler) { try { await ctx.sampler.stop?.(); } catch { /* ignore */ } }
      if (ctx.browser) { try { await ctx.browser.close(); } catch { /* ignore */ } }
      try { if (m.provision && ctx.world?.base) writeJson(join(runDir, 'server', 'healthz-after.json'), await m.provision.healthz(ctx.world.base)); } catch { /* recorded as missing */ }
      writeJson(join(runDir, 'close.json'), { ...now(), ...closed });
      receipt(runDir, 4, 'close', { ok: true });
    }
  } catch (e) {
    log('run failed:', e.stack ?? e.message); exitCode = 1;
    receipt(runDir, 9, 'failure', { ok: false, error: String(e.stack ?? e.message) });
    for (const seat of ctx.seats) { try { await seat.stop(); } catch { /* ignore */ } }
    if (ctx.browser) { try { await ctx.browser.close(); } catch { /* ignore */ } }
  } finally {
    if (ctx.world?.pid && !a['keep-world'] && m.provision) { try { await m.provision.stopWorld(ctx.world); log('world stopped'); } catch (e) { log('world stop failed', e.message); } }
  }
  if (exitCode) return exitCode;
  return await reviewRun(runDir, m, { serverRoot, from });
}

async function reviewRun(runDir, m, { serverRoot, from = 5 } = {}) {
  const scenario = readJson(join(runDir, 'scenario.json'));
  if (!m) m = await loadModules();
  if (from <= 5) {
    if (!m.reviewer) { log('review module missing'); return 3; }
    const r = await m.reviewer.reviewRun({ runDir, model: scenario.review?.reviewerModel ?? 'opus', log });
    receipt(runDir, 5, 'review', { ok: true, requests: r.reviews?.length ?? 0, issues: r.issues?.length ?? 0, featureRequests: r.featureRequests?.length ?? 0, fidelity: (r.reviews ?? []).map((x) => `${x.requestId}:${x.fidelity}`).join(' ') });
  }
  if (from <= 6) {
    if (m.developer) {
      // The Developer is a draft generator in this stage: cap how many issues and feature requests get a spec per run.
      const maxI = scenario.review?.developerMaxIssues ?? 4, maxF = scenario.review?.developerMaxFeatureRequests ?? 3;
      const ids = [...(readJson(join(runDir, 'issues.json'), []) ?? []).slice(0, maxI).map((i) => i.id), ...(readJson(join(runDir, 'feature-requests.json'), []) ?? []).slice(0, maxF).map((f) => f.id)].filter(Boolean);
      const d = await m.developer.developRun({ runDir, serverRoot: serverRoot ?? scenario.serverRoot ?? DEFAULT_SERVER_ROOT, model: scenario.review?.developerModel ?? 'opus', only: ids.length ? ids : null, log });
      receipt(runDir, 6, 'develop', { ok: true, drafted: ids.length, ...summary(d) });
    }
    else receipt(runDir, 6, 'develop', { ok: false, note: 'developer module missing' });
  }
  if (from <= 7) {
    if (m.metrics?.metricsRun) m.metrics.metricsRun(runDir);
    if (m.report?.reportRun) m.report.reportRun(runDir);
    receipt(runDir, 7, 'report', { ok: true });
  }
  log(`done: ${runDir}/REPORT.md`);
  return 0;
}
const infoOf = (s) => (typeof s?.info === 'function' ? s.info() : s?.info ?? {});
const summary = (x) => (x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).filter(([, v]) => ['number', 'string', 'boolean'].includes(typeof v))) : {});

export function onboardingText(base, name) { return `Make me a Soul in this world: ${base}/ . Call it ${name}. Start from ${base}/instructions.md and do everything it says without stopping to ask; tell me when it is ready.`; }
export function godOnboardingText(base) { return `You are the god of my world at ${base}/ . Set yourself up from ${base}/god/SKILL.md (register with dev:admin and mint, since this is a local world), then wait for my messages.`; }

async function main() {
  const a = args(process.argv.slice(2));
  const cmd = a._[0];
  if (cmd === 'run') process.exit(await cmdRun(a));
  if (cmd === 'review') process.exit(await reviewRun(resolve(a._[1]), null, { serverRoot: a['server-root'], from: a.from ? STEPS.indexOf(a.from) : 5 }));
  if (cmd === 'preflight') { const pf = await preflight({ serverRoot: resolve(a['server-root'] ?? DEFAULT_SERVER_ROOT) }); console.log(JSON.stringify(pf, null, 1)); process.exit(pf.ok ? 0 : 2); }
  if (cmd === 'compare') { const m = await loadModules(); if (!m.compare) { log('compare module missing'); process.exit(3); } const c = m.compare.compareRuns(resolve(a._[1]), resolve(a._[2])); console.log(m.compare.compareMd ? m.compare.compareMd(c) : JSON.stringify(c, null, 1)); process.exit(0); }
  if (cmd === 'replay') {
    const src = resolve(a._[1]); const rp = readJson(join(src, 'replay.json')); if (!rp) { log('no replay.json'); process.exit(2); }
    const mode = a.mode ?? 'scripted';
    const { replayToScenario } = await import('./review/report.mjs'); const scen = { ...replayToScenario(rp, mode), name: `${rp.scenario.name}-replay` };
    const tmp = join(src, `replay-${mode}.scenario.json`); writeJson(tmp, scen);
    process.exit(await cmdRun({ _: ['run', tmp], seed: rp.seed, 'server-root': a['server-root'], out: a.out }));
  }
  console.log('usage: playtest.mjs run <scenario.json> [--seed n] [--out dir] [--from step] [--server-root dir] [--keep-world] | review <run> | replay <run> --mode scripted|live | compare <a> <b> | preflight');
  process.exit(1);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
