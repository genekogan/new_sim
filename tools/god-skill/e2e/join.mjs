#!/usr/bin/env node
// Join as a Soul, end to end, on a launcher world (lane P2, GENE-DECISIONS §3 "any Soul can join any world"):
//   the launcher starts the world with edge minds and no invitations, and serves ONE skill (/SKILL.md: God mode +
//   Soul mode) plus the Soul CLI;
//   the GOD (gaia) claims it, her agent installs the god CLI the way SKILL.md's God mode says, pairs (gaia approves),
//   and builds a plaza flag, a bench, a cottage and a garden flag;
//   a second person (ana) joins through the panel's API path (POST /v1/souls → pairing code); her agent installs the
//   Soul CLI and pairs exactly as SKILL.md's Soul mode says, then walks to the plaza, sits on the god's bench and
//   prays; the god reads the prayer and answers; ana's agent reads the answer;
//   a third person (ben) joins through the panel UI in Chrome (name → Create my Soul → the code and the paste line),
//   his agent pairs with the code the page shows and acts; the god's Souls tab lists both.
// Screenshots of the panel (Chrome lease, real GPU).
//
//   node tools/god-skill/e2e/join.mjs [--port 5225] [--range 5226-5229] [--keep] [--no-shots]
//
// Report under .lane/e2e-join/<stamp>/ (report.json, REPORT.md, PNGs). $0: edge minds, fake brain, dev auth.
import { execFile, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromeLease } from '../lib/chrome-lease.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const port = Number(args.port ?? 5225);
const range = typeof args.range === 'string' ? args.range : '5226-5229';
const out = resolve(root, '.lane/e2e-join', stamp);
mkdirSync(out, { recursive: true });
const origin = `http://127.0.0.1:${port}`;
const report = { port, range, startedAt: new Date().toISOString(), steps: [], shots: [], failures: [] };
const t = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exec = promisify(execFile);
const PAGE_MS = Number(args['page-ms'] ?? 600_000);

const brief = (r) => { try { return JSON.parse(JSON.stringify(r ?? null, (k, v) => (typeof v === 'string' && v.length > 400 ? v.slice(0, 400) + '…' : v))); } catch { return String(r); } };
async function step(name, fn, expect) {
  const t0 = t(); let result, error;
  try { result = await fn(); } catch (e) { error = String(e?.stack ?? e?.message ?? e).split('\n').slice(0, 3).join(' | '); }
  const ms = t() - t0, ok = !error && (expect ? !!expect(result) : true);
  report.steps.push({ name, ms: Math.round(ms), ok, result: brief(result), error });
  if (!ok) report.failures.push({ name, result: brief(result), error });
  console.log(`${ok ? '✔' : '✖'} ${name} — ${(ms / 1000).toFixed(1)} s${ok ? '' : ' — ' + (error ?? JSON.stringify(brief(result))).slice(0, 500)}`);
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  return result;
}
const until = async (what, fn, ms = 60_000, every = 500) => { const end = Date.now() + ms; let last; while (Date.now() < end) { try { last = await fn(); if (last?.ok ?? last) return last; } catch (e) { last = String(e.message); } await sleep(every); } throw new Error(`timed out waiting for ${what} (last: ${JSON.stringify(last)?.slice(0, 300)})`); };

// ---------- the launcher (own process, own data dir)
const dataDir = resolve(out, 'data');
const launcher = spawn(process.execPath, ['tools/world-launcher/launcher.mjs', '--port', String(port), '--range', range, '--data', dataDir, '--eager', '0'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let launcherLog = ''; launcher.stdout.on('data', (d) => { launcherLog += d; }); launcher.stderr.on('data', (d) => { launcherLog += d; });
const cleanup = () => { try { launcher.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', () => { if (!args.keep) cleanup(); });
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { cleanup(); process.exit(130); });

// ---------- people (dev identities) and their agents' folders
let slug = '', base = '';
const as = (who) => (who ? { authorization: `Bearer dev:${who}` } : {});
async function api(path, { who, method, body, headers } = {}) {
  const r = await fetch(base + path, { method: method ?? (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...as(who), ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000) });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
const folder = (who) => { const f = mkdtempSync(join(tmpdir(), `join-${who}-`)); return f; };
const sh = (cwd, line, timeout = 120_000) => exec('bash', ['-c', line], { cwd, timeout, maxBuffer: 8 << 20 }).then((r) => r.stdout.trim(), (e) => { throw new Error(`${line.slice(0, 80)}… → ${String(e.stderr || e.message).trim().slice(0, 400)}`); });
const node = (cwd, file, ...a) => exec(process.execPath, [file, ...a], { cwd, timeout: 180_000, maxBuffer: 8 << 20 }).then((r) => r.stdout.trim(), (e) => { throw new Error(`${file} ${a.join(' ')} → ${String(e.stdout || '').slice(0, 300)} ${String(e.stderr || e.message).trim().slice(0, 300)}`); });
const soulCli = (cwd, ...a) => node(cwd, 'eden-agent.mjs', ...a).then((s) => JSON.parse(s));
const godCli = (cwd, ...a) => node(cwd, 'eden-god.mjs', ...a);

// ---------- the one skill: its sections and the commands they give
let skill = '';
/** The text of one `## <title>` section (up to the next `---` rule or `## `). */
const section = (title) => { const i = skill.indexOf(`\n## ${title}\n`); if (i < 0) return ''; const rest = skill.slice(i + 1); const end = rest.slice(3).search(/\n(---|## )/); return end < 0 ? rest : rest.slice(0, end + 3); };
const lineOf = (text, re) => text.split('\n').find((l) => re.test(l)) ?? null;

/** A Soul agent does what Soul mode says: install the CLI, pair with the code, check the folder is paired. */
async function soulAgentPairs(who, code) {
  const soul = section('Soul mode'), dir = folder(who);
  const install = lineOf(soul, /^test -f eden-agent\.mjs \|\| curl /), pair = lineOf(soul, /^node -e 'const \[w,c\]=/);
  if (!install || !pair) throw new Error('Soul mode does not give the install or pairing command');
  await sh(dir, install.replace(/\s+#.*$/, ''));
  const version = await soulCli(dir, 'version');
  const said = await sh(dir, pair.replace('<CODE>', code));
  const status = await soulCli(dir, 'status');
  return { dir, version: version.skillVersion, said, paired: status.paired, soul: status.soul };
}
/** act, then wait (bounded) until the receipt is terminal; returns the last receipt and the body. */
async function soulDoes(dir, capability, params, { maxS = 240, stop } = {}) {
  const a = await soulCli(dir, 'act', capability, ...(params ? [JSON.stringify(params)] : []));
  if (!a.accepted) return { accepted: false, code: a.code, reason: a.reason };
  const t0 = Date.now(); let rec = a.receipt, me = null;
  while (Date.now() - t0 < maxS * 1000) {
    const o = await soulCli(dir, 'observe'); me = o.me;
    if (stop?.(me)) break;
    const r = await soulCli(dir, 'receipt'); rec = r?.phase ? r : rec;
    if (['completed', 'failed', 'replaced'].includes(rec?.phase)) break;
    await sleep(1500);
  }
  return { accepted: true, phase: rec?.phase, code: rec?.code, me };
}

// ---------- screenshots
let chromium = null;
if (!args['no-shots']) try { chromium = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test').chromium; } catch { console.log('  (no @playwright/test; screenshots skipped)'); }

const ids = {};
let gaiaDir = '', anaDir = '', prayerId = null;
try {
  await until('the launcher', async () => (await fetch(`${origin}/__sim/worlds.json`)).ok, 60_000);
  const worldName = `Join Party ${stamp.slice(11, 16).replace('-', '')}`;
  await step('L0 a new world from the launcher (Empty plain)', async () => {
    const r = await (await fetch(`${origin}/__sim/worlds`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: worldName, template: 'empty' }) })).json();
    slug = r.slug; base = `${origin}/w/${slug}`; return r;
  }, (r) => r.ok && r.slug);
  await step('L1 launcher worlds: edge minds (the edge contract is served), no invitations, the Soul CLI served and runnable', async () => {
    const cfg = (await api('/v1/config')).data, edgeSchema = await api('/v1/edge/schema'), cli = await fetch(`${base}/eden-agent.mjs`), cliText = await cli.text();
    const dir = folder('probe'); writeFileSync(join(dir, 'eden-agent.mjs'), cliText);
    const v = await soulCli(dir, 'version'); rmSync(dir, { recursive: true, force: true });
    return { inviteRequired: cfg.inviteRequired, devAuth: cfg.devAuth, edge: edgeSchema.status, cli: cli.status, cliBytes: cliText.length, version: v.skillVersion, selfContained: !/from '\.\/client-/.test(cliText) };
  }, (r) => r.inviteRequired === false && r.edge === 200 && r.cli === 200 && r.selfContained && r.version);
  await step('K1 ONE skill at /SKILL.md: God mode and Soul mode, each with its own CLI install line; its links resolve', async () => {
    const r = await fetch(`${base}/SKILL.md`); skill = await r.text();
    const god = section('God mode'), soul = section('Soul mode');
    const links = await Promise.all(['/god/SKILL.md', '/god/eden-god.mjs', '/skill.md', '/eden-agent.mjs'].map(async (p) => [p, (await fetch(base + p)).status]));
    return { status: r.status, type: r.headers.get('content-type'), name: skill.includes(`"${worldName}"`), baseFilled: !skill.includes('{{BASE}}') && skill.includes(base), godInstall: !!lineOf(god, /eden-god\.mjs \|\| curl -fsSO .*\/god\/eden-god\.mjs/), soulInstall: !!lineOf(soul, /eden-agent\.mjs \|\| curl -fsSo eden-agent\.mjs .*\/eden-agent\.mjs/), godAlone: !/eden-agent/.test(god), soulAlone: !/eden-god/.test(soul), links: Object.fromEntries(links) };
  }, (r) => r.status === 200 && r.name && r.baseFilled && r.godInstall && r.soulInstall && r.godAlone && r.soulAlone && Object.values(r.links).every((s) => s === 200));

  // ======================== the god
  await step('G0 gaia signs in and claims the world (the panel mints her browser token)', async () => { const r = await api('/v1/god/mint', { who: 'gaia', body: { label: 'browser' } }); const s = await api('/v1/god/status', { who: 'gaia' }); return { status: r.status, you: s.data.you }; }, (r) => r.status === 200 && r.you === 'owner');
  await step('G1 her agent follows God mode: installs eden-god.mjs, registers, pairs; gaia approves the code in the panel', async () => {
    const god = section('God mode'); gaiaDir = folder('gaia');
    await sh(gaiaDir, lineOf(god, /^test -f eden-god\.mjs \|\| curl /).replace(/\s+#.*$/, ''));
    await godCli(gaiaDir, 'register', base);
    const pairing = spawn(process.execPath, ['eden-god.mjs', 'pair'], { cwd: gaiaDir, stdio: ['ignore', 'pipe', 'pipe'] });
    let said = ''; pairing.stderr.on('data', (d) => { said += d; }); pairing.stdout.on('data', (d) => { said += d; });
    const done = new Promise((r) => pairing.once('exit', (code) => r(code)));
    const pending = await until('the pairing request in the panel', async () => (await api('/v1/god/status', { who: 'gaia' })).data.pending?.[0], 30_000);
    const ok = await api('/v1/god/pair/approve', { who: 'gaia', body: { code: pending.code } });
    const exit = await Promise.race([done, sleep(30_000).then(() => 'timeout')]);
    return { code: pending.code, approve: ok.status, exit, token: JSON.parse(readFileSync(join(gaiaDir, '.eden-god.json'), 'utf8')).token?.startsWith(`god_${slug}-1_`) };
  }, (r) => r.approve === 200 && r.exit === 0 && r.token);
  await step('G2 the god builds: a plaza flag, a bench facing it, a cottage, a garden flag', async () => {
    const said = [await godCli(gaiaDir, 'flag', 'plaza', '--at', '0,12'), await godCli(gaiaDir, 'place', 'bench', '--at', '3,12', '--name', 'bench', '--facing', 'w'),
      await godCli(gaiaDir, 'place', 'cottage', '--at', '-14,-8', '--name', 'cottage'), await godCli(gaiaDir, 'flag', 'garden', '--at', '-10,6')];
    const snap = (await api('/v1/world/snapshot')).data;
    for (const n of ['bench', 'cottage', 'plaza', 'garden']) ids[n] = snap.entities.find((e) => e.name === n)?.id;
    return { said: said.map((s) => s.split('\n')[0]), ids };
  }, (r) => Object.values(r.ids).every(Boolean));

  // ======================== ana joins (the panel's API path) and her agent pairs (Soul mode)
  let anaSoul = null, anaCode = null;
  await step('V0 ana, signed in, is a visitor: she can watch or join; she has no Soul here yet', async () => { const s = await api('/v1/god/status', { who: 'ana' }), me = await api('/v1/me', { who: 'ana' }); return { you: s.data.you, souls: me.data.souls?.length, invited: me.data.me?.invited }; }, (r) => r.you === 'visitor' && r.souls === 0 && r.invited === true);
  await step('V1 Join: ana creates her Soul "Ana" (POST /v1/souls, no invitation) and asks for a pairing code', async () => {
    const s = await api('/v1/souls', { who: 'ana', body: { name: 'Ana', description: 'a walker who likes benches in the sun' } }); anaSoul = s.data.soul;
    const c = await until('a pairing code (the body arrives)', async () => { const r = await api(`/v1/souls/${anaSoul.id}/pair`, { who: 'ana', body: {} }); return r.status === 200 ? r.data : null; }, 30_000);
    anaCode = c.code; return { soul: anaSoul?.id, code: !!anaCode, expiresIn: c.expires_in };
  }, (r) => r.soul && r.code && r.expiresIn >= 600);
  await step('A0 her agent follows Soul mode: installs the Soul CLI, pairs with the code; the folder is paired to Ana', async () => { const r = await soulAgentPairs('ana', anaCode); anaDir = r.dir; return r; }, (r) => r.paired === true && r.soul === anaSoul.id && /paired with Ana/.test(r.said));
  await step('A0 the code is one-use: pairing again with it is refused', async () => { const r = await api('/v1/agent/pair', { body: { code: anaCode, agent: 'replay' } }); return { status: r.status, code: r.data?.code }; }, (r) => r.status === 404 && r.code === 'pair-invalid');
  await step('A1 her capabilities offer the god\'s things: walk to the plaza and garden flags, sit on the bench, pray', async () => until('capabilities', async () => {
    const c = await soulCli(anaDir, 'capabilities'), list = JSON.stringify(c);
    const want = ['walk:flag-plaza', 'walk:flag-garden', `sit:${ids.bench}`, '"pray"'];
    return { ok: want.every((w) => list.includes(w)), missing: want.filter((w) => !list.includes(w)) };
  }, 30_000), (r) => r?.ok);
  await step('A2 she walks to the plaza flag (act → wait → completed receipt)', () => soulDoes(anaDir, 'walk:flag-plaza'), (r) => r.accepted && r.phase === 'completed');
  await step('A3 she sits on the god\'s bench', () => soulDoes(anaDir, `sit:${ids.bench}`, { seconds: 600 }, { stop: (me) => me?.activity === 'sit' }), (r) => r.accepted && r.me?.activity === 'sit');
  await step('A4 she prays', async () => { const r = await soulCli(anaDir, 'act', 'pray', JSON.stringify({ text: 'May the plaza have a fountain?' })); return r; }, (r) => r.accepted === true);
  await step('G3 the god reads the prayer (eden-god prayers) and answers it', async () => {
    const list = await godCli(gaiaDir, 'prayers');
    prayerId = list.match(/\b(p_[a-z0-9]+|pr_[a-z0-9]+|[a-z]+_[0-9a-f]{6,})\b.*Ana/i)?.[1] ?? (await api('/v1/god/prayers', { headers: { authorization: `Bearer ${JSON.parse(readFileSync(join(gaiaDir, '.eden-god.json'), 'utf8')).token}` } })).data.prayers?.find((p) => p.soul_name === 'Ana')?.id;
    const ans = await godCli(gaiaDir, 'answer', prayerId, 'Yes: look to the plaza tomorrow.');
    return { listed: /Ana/.test(list) && /fountain/.test(list), prayerId, answer: ans.split('\n')[0] };
  }, (r) => r.listed && r.prayerId);
  await step('A5 her agent reads the answer with Soul mode\'s command (the token is never printed)', async () => {
    const line = lineOf(section('Soul mode'), /^node -e 'const s=JSON\.parse\(require\("fs"\)\.readFileSync\("\.eden-agent\.json"/);
    if (!line) throw new Error('Soul mode gives no command to read answers');
    const said = await sh(anaDir, line); const token = JSON.parse(readFileSync(join(anaDir, '.eden-agent.json'), 'utf8')).token;
    return { said: JSON.parse(said), leaked: said.includes(token) };
  }, (r) => r.said.some((p) => /fountain/.test(p.text) && /plaza tomorrow/.test(p.answer ?? '')) && !r.leaked);
  await step('W0 who lives here: /v1/world/souls lists Ana, active, at the bench', async () => { const s = (await api('/v1/world/souls')).data.souls; const a = s.find((x) => x.name === 'Ana'); return { n: s.length, ana: a }; }, (r) => r.ana?.active && r.ana.p && Math.hypot(r.ana.p[0] - 3, r.ana.p[2] - 12) < 3);

  // ======================== ben joins through the panel UI (Chrome)
  if (chromium) {
    const release = await chromeLease('join-e2e');
    let browser = null;
    try {
      browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
      const shot = async (page, name) => { const file = join(out, `${name}.png`); await page.screenshot({ path: file, timeout: PAGE_MS }); report.shots.push(file); console.log(`  📷 ${name}.png`); };
      const open = async (who, hash = '') => {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
        await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
        await ctx.addInitScript((n) => { try { if (n) localStorage.setItem('sim.dev', n); localStorage.setItem('sim.godPanel.open', '1'); } catch { } }, who);
        const page = await ctx.newPage(); page.setDefaultTimeout(PAGE_MS);
        page.errors = []; page.on('pageerror', (e) => page.errors.push(e.message));
        await page.goto(`${base}/?dev=1${hash}`, { waitUntil: 'domcontentloaded', timeout: PAGE_MS });
        await page.locator('[data-god-panel]').waitFor({ timeout: PAGE_MS });
        await page.waitForFunction(() => window.__simEntity?.layer?.active === true, null, { timeout: PAGE_MS }).catch(() => {});
        // look at the plaza: the bench (Ana on it), the flag, the cottage behind
        await page.evaluate(() => { const w = window.__simEntity; if (!w) return; w.controls.target.set(-2, 1, 8); w.camera.position.set(-16, 11, 30); w.camera.lookAt(w.controls.target); }).catch(() => {});
        await sleep(3500);
        return page;
      };
      await step('P0 a stranger (not signed in) sees the Join section and who lives here', async () => {
        const page = await open(null, '#join');
        await page.locator('[data-join]').waitFor();
        const text = await page.locator('[data-god-panel]').innerText();
        await shot(page, '01-anonymous-join');
        await page.context().close();
        return { join: /Join this world as a Soul/.test(text), hint: /Sign in/.test(text), lists: /Ana/.test(text) };
      }, (r) => r.join && r.hint && r.lists);
      let benCode = null, benPrompt = null, benDir = '';
      const benPage = await open('ben', '#join');
      await step('P1 ben, signed in, opens the shared #join link: the Join form, Souls here (Ana)', async () => {
        await benPage.locator('[data-join-form]').waitFor();
        await shot(benPage, '02-ben-join-form');
        return { text: (await benPage.locator('[data-join]').innerText()).slice(0, 600) };
      }, (r) => /Create my Soul/.test(r.text) && /Ana/.test(r.text));
      await step('P2 ben names his Soul and clicks Create my Soul: the panel shows a pairing code and the one line for his agent', async () => {
        await benPage.locator('[data-soul-name]').fill('Ben');
        await benPage.locator('[data-soul-about]').fill('a quiet reader who sits in gardens');
        await benPage.locator('[data-create-soul]').click();
        await benPage.locator('[data-pair-code]').waitFor({ timeout: 60_000 });
        benCode = await benPage.locator('[data-pair-code]').getAttribute('data-pair-code');
        benPrompt = await benPage.locator('[data-join-prompt]').innerText();
        await benPage.locator('[data-pair-code] .gp-copy').click();
        const clip = await benPage.evaluate(() => navigator.clipboard.readText().catch(() => null));
        await shot(benPage, '03-ben-pair-code');
        return { benCode, benPrompt, clip, mine: await benPage.locator('[data-my-soul="Ben"]').count() };
      }, (r) => /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(r.benCode ?? '') && r.benPrompt.includes(`${base}/SKILL.md`) && r.benPrompt.includes(r.benCode) && /Soul mode/.test(r.benPrompt) && r.mine === 1 && (r.clip === null || r.clip === r.benPrompt));
      await step('P3 ben\'s agent reads the line, follows Soul mode with that code, and acts; the panel says "agent paired"', async () => {
        const url = benPrompt.match(/Read (\S+\/SKILL\.md)/)?.[1], code = benPrompt.match(/Pairing code: ([A-Z0-9-]+)/)?.[1];
        if (url !== `${base}/SKILL.md`) throw new Error('the line does not name this world\'s skill');
        skill = await (await fetch(url)).text();
        const r = await soulAgentPairs('ben', code); benDir = r.dir;
        const walk = await soulDoes(benDir, 'walk:flag-garden');
        await benPage.locator('[data-my-soul="Ben"] .jp-ok').waitFor({ timeout: 30_000 });
        await shot(benPage, '04-ben-agent-paired');
        return { paired: r.paired, said: r.said, walk: walk.phase };
      }, (r) => r.paired && r.walk === 'completed');
      await benPage.context().close();
      await step('P4 the god\'s Souls tab: the link to share and both Souls (active); clicking Ana flies to her', async () => {
        const page = await open('gaia', '#join');
        await page.locator('[data-souls-tab]').waitFor();
        await page.locator('[data-soul="Ben"]').waitFor({ timeout: 30_000 });
        const link = await page.locator('[data-join-link]').innerText();
        await page.locator('[data-soul="Ana"] .gp-link').click().catch(() => {});
        await sleep(2500);
        const target = await page.evaluate(() => window.__simEntity?.controls.target.toArray().map((v) => Math.round(v))).catch(() => null);
        await shot(page, '05-god-souls-tab');
        const souls = await page.locator('[data-soul]').evaluateAll((els) => els.map((e) => e.getAttribute('data-soul')));
        const errors = page.errors; await page.context().close();
        return { link, souls, target, errors };
      }, (r) => r.link === `${base}/#join` && r.souls.includes('Ana') && r.souls.includes('Ben') && !r.errors.length);
      await step('P5 the god\'s start tab points to the one skill (SKILL.md link and the welcome\'s paste line)', async () => {
        const page = await open('gaia');
        await page.locator('[data-tab="start"]').click();
        await page.locator('.gp-files a', { hasText: 'SKILL.md' }).waitFor();
        const href = await page.locator('.gp-files a', { hasText: 'SKILL.md' }).getAttribute('href');
        const text = await page.locator('[data-god-panel]').innerText();
        await shot(page, '06-god-start-one-skill');
        await page.context().close();
        return { href, paste: text.includes(`Read ${base}/SKILL.md and follow its God mode section`) };
      }, (r) => r.href === `/w/${slug}/SKILL.md` && r.paste);
    } finally { if (browser) await browser.close().catch(() => {}); release(); }
  }
} catch (e) {
  report.failures.push({ name: 'harness', error: String(e?.stack ?? e) });
  console.log('harness error', e);
} finally {
  report.summary = { steps: report.steps.length, failed: report.failures.length, slug };
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(out, 'launcher.log'), launcherLog);
  const md = [`# Join as a Soul (lane P2) — ${slug} — ${report.startedAt}`, '', `${report.summary.steps} steps · ${report.summary.failed} failed`, '', '| step | s | ok |', '|---|---:|:-:|', ...report.steps.map((s) => `| ${s.name} | ${(s.ms / 1000).toFixed(1)} | ${s.ok ? '✔' : '✖ ' + (s.error ?? JSON.stringify(s.result)).slice(0, 240).replace(/\|/g, '/')} |`), '', '## shots', ...report.shots.map((f) => `- \`${f}\``)].join('\n');
  writeFileSync(join(out, 'REPORT.md'), md);
  console.log(`\n${report.summary.failed ? '✖' : '✔'} ${report.summary.steps} steps, ${report.summary.failed} failed. Report: ${join(out, 'REPORT.md')}`);
  if (!args.keep) cleanup();
  process.exit(report.summary.failed ? 1 : 0);
}
