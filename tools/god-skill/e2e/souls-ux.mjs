#!/usr/bin/env node
// Lane S walkthrough: Souls on a god-built world, real Chrome (lease), real input, at 1352×780 and a chosen pixel ratio.
// The god (gene) makes a world on the /worlds launcher, presses the header's "New Soul", names the Soul, gets the line,
// and their agent follows it with the PUBLISHED Soul CLI (install → register → create-soul); under Clerk the agent prints
// an approval link, the god opens it (same browser session) and presses Approve; the Soul appears in "Your Souls here",
// the Souls list and the header count, and the camera flies to its body. Then a visitor (ana) does the same from a
// signed-out page: "New Soul" → sign in → name → line → agent → Approve → her Soul.
// Clerk in the browser is Lane X's test-only clerk-js stand-in (fix-x-walkthrough.mjs) whose session tokens come from the
// synthetic issuer the worlds verify (fix-x-clerk-keys.mjs); no network, no keys.
//   node tools/god-skill/e2e/souls-ux.mjs --phase before|after [--mode clerk|dev] [--dpr 1|2] [--port 5220] [--range 5221-5224]
//        --web <vite build --base /worlds/> [--out dir] [--soul-cli f] [--soul-skill f]
// "before" only takes the screenshots (the old panel has no New Soul); "after" checks every step.
import { createRequire } from 'node:module';
import { execFile, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromeLease } from '../lib/chrome-lease.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const MODE = args.mode === 'dev' ? 'dev' : 'clerk', PHASE = args.phase === 'before' ? 'before' : 'after', DPR = Number(args.dpr ?? 1);
const port = Number(args.port ?? 5220), range = typeof args.range === 'string' ? args.range : '5221-5224';
const origin = `http://127.0.0.1:${port}`, BASE = '/worlds';
const PUBLISHED = '<team>/previews/20261010-restoration-auth/release-5e478f8a';
const SOUL_CLI = resolve(typeof args['soul-cli'] === 'string' ? args['soul-cli'] : `${PUBLISHED}/bundle/eden-agent.mjs`);
const SOUL_SKILL = resolve(typeof args['soul-skill'] === 'string' ? args['soul-skill'] : `${PUBLISHED}/input/tools/edge-skill/SKILL.md`);
const WEB = resolve(typeof args.web === 'string' ? args.web : `${root}/.lane/web-worlds`);
const out = resolve(typeof args.out === 'string' ? args.out : `${root}/.lane/souls-ux/${new Date().toISOString().replace(/[:.]/g, '-')}-${PHASE}-${MODE}-dpr${DPR}`);
mkdirSync(out, { recursive: true });
const { chromium } = createRequire(`${root}/mars/viewer/package.json`)('@playwright/test');
const exec = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = []; let failed = 0;
const check = (name, ok, data) => { const pass = PHASE === 'before' || !!ok; report.push({ name, ok: !!ok, data }); if (!pass) failed++; console.log(`${ok ? '✔' : PHASE === 'before' ? '·' : '✖'} ${name}`, data === undefined ? '' : JSON.stringify(data).slice(0, 400)); };
const sh = (cwd, line, timeout = 180_000) => exec('bash', ['-c', line], { cwd, timeout, maxBuffer: 8 << 20 }).then((r) => r.stdout.trim(), (e) => { throw new Error(`${line.slice(0, 80)}… → ${String(e.stderr || e.message).trim().slice(0, 400)}`); });

// ---------- sign-in
let sign = null; const launchArgs = [];
if (MODE === 'clerk') {
  const keys = await import('./fix-x-clerk-keys.mjs');
  await keys.init([origin]); sign = keys.sign;
  launchArgs.push('--auth-env', `${root}/.lane/fixx/clerk/clerk.env`, '--public-origin', origin);
}
const STUB = `(() => {
  const KEY = 'stubClerk.user', listeners = new Set(), NAME = window.__stubName || 'gene';
  const make = () => { const sub = localStorage.getItem(KEY);
    if (!sub) return { client: { sessions: [], signedInSessions: [], activeSessions: [], lastActiveSessionId: null }, session: null, user: null, organization: null };
    const first = sub.replace(/^user_/, ''); const user = { id: sub, firstName: first[0].toUpperCase() + first.slice(1), primaryEmailAddress: { emailAddress: first + '@example.test' }, emailAddresses: [], organizationMemberships: [] };
    const session = { id: 'sess_' + sub.replace(/[^A-Za-z0-9]/g, ''), status: 'active', user, actor: null, lastActiveToken: { jwt: { claims: { sub, sid: 'sess_' + sub.replace(/[^A-Za-z0-9]/g, ''), iss: 'https://clerk.example.test' } } }, factorVerificationAge: null,
      getToken: async () => window.__stubClerkMint(sub), checkAuthorization: () => true };
    return { client: { sessions: [session], signedInSessions: [session], activeSessions: [session], lastActiveSessionId: session.id }, session, user, organization: null }; };
  let state = make();
  const emit = () => { state = make(); for (const l of listeners) l({ ...state }); };
  const modal = () => { if (document.querySelector('[data-stub-clerk]')) return; const d = document.createElement('div'); d.dataset.stubClerk = '1';
    d.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.4);display:grid;place-items:center';
    d.innerHTML = '<div style="background:#fff;color:#111;padding:24px;border-radius:12px;font:15px system-ui"><p>Sign in (test Clerk)</p><button data-stub-clerk-continue style="font:15px system-ui;padding:8px 14px">Continue as ' + NAME + '</button></div>';
    d.querySelector('button').onclick = () => { localStorage.setItem(KEY, 'user_' + NAME); d.remove(); emit(); }; document.body.append(d); };
  window.Clerk = { loaded: false, status: 'loading', version: 'stub', sdkMetadata: {}, instanceType: 'production', frontendApi: 'clerk.example.test', isSatellite: false,
    get client() { return state.client; }, get session() { return state.session; }, get user() { return state.user; }, get organization() { return null; },
    async load() { this.loaded = true; this.status = 'ready'; },
    addListener(l) { listeners.add(l); l({ ...state }); return () => listeners.delete(l); },
    on(event, handler) { if (event === 'status' && typeof handler === 'function') setTimeout(() => handler(this.status), 0); }, off() {}, __internal_getOption() {}, __internal_updateProps() {}, telemetry: { record() {} },
    openSignIn() { modal(); }, openSignUp() { modal(); }, closeSignIn() {}, async signOut() { localStorage.removeItem(KEY); emit(); },
    async setActive() {}, buildSignInUrl() { return location.href; }, buildSignUpUrl() { return location.href; }, redirectToSignIn() { modal(); } };
})();`;

// ---------- the launcher (own process, own data dir)
const launcher = spawn(process.execPath, ['tools/world-launcher/launcher.mjs', '--port', String(port), '--range', range, '--data', join(out, 'data'), '--eager', '0', '--base', BASE, '--web', WEB,
  '--soul-cli', SOUL_CLI, '--soul-skill', SOUL_SKILL, ...launchArgs], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let launcherLog = ''; launcher.stdout.on('data', (d) => { launcherLog += d; }); launcher.stderr.on('data', (d) => { launcherLog += d; });
process.on('exit', () => { try { launcher.kill('SIGTERM'); } catch { /* gone */ } });
for (let i = 0; i < 120; i++) { try { if ((await fetch(`${origin}${BASE}/__sim/worlds.json`)).ok) break; } catch { /* starting */ } await sleep(500); }

const release = await chromeLease('souls-ux-walk');
const browser = await chromium.launch({ channel: 'chrome', headless: !args.headed, args: ['--ignore-gpu-blocklist'] });
let base = '', skill = '';
const errors = [];
const sect = (t) => { const i = skill.indexOf(`\n## ${t}\n`); if (i < 0) return ''; const rest = skill.slice(i + 1); const e = rest.slice(3).search(/\n(---|## )/); return e < 0 ? rest : rest.slice(0, e + 3); };
const lineOf = (text, re) => text.split('\n').find((l) => re.test(l)) ?? null, bare = (l) => l.replace(/\s+#.*$/, '');

async function person(name) {
  const ctx = await browser.newContext({ viewport: { width: 1352, height: 780 }, deviceScaleFactor: DPR });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  if (MODE === 'clerk') {
    await ctx.exposeFunction('__stubClerkMint', (sub) => sign(sub, origin));
    await ctx.addInitScript(`window.__stubName=${JSON.stringify(name)};`);
    await ctx.addInitScript(STUB);
    await ctx.route(/clerk\.example\.test/, (r) => r.abort());
  }
  const page = await ctx.newPage(); page.setDefaultTimeout(120_000);
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  const shot = async (n, p = page) => { const f = join(out, `${n}.png`); await p.screenshot({ path: f }); console.log('  shot', f); return f; };
  return { ctx, page, shot };
}
const headerText = (page) => page.locator('.world-hud').innerText().catch(() => '');
const pill = (page) => page.locator('[data-souls-pill]').getAttribute('data-souls-pill').catch(() => null);

/** The person's agent follows the line: the published Soul CLI from this world's SKILL.md (Soul mode). Under Clerk the
 *  person opens the approval link in a new tab of the same browser and presses Approve. */
async function agentMakesSoul(p, line, soulName) {
  const url = line.match(/Read (\S+\/SKILL\.md)/)?.[1];
  if (url !== `${base}/SKILL.md`) throw new Error(`the line does not name this world's skill: ${line}`);
  skill = await (await fetch(url)).text();
  const soul = sect('Soul mode'), dir = mkdtempSync(join(tmpdir(), `souls-ux-${soulName}-`));
  await sh(dir, bare(lineOf(soul, /^test -f eden-agent\.mjs \|\| curl /)));
  await sh(dir, bare(lineOf(soul, /^node eden-agent\.mjs register /)));
  const created = JSON.parse(await sh(dir, bare(lineOf(soul, /^node eden-agent\.mjs create-soul /)).replace('"<name>"', JSON.stringify(soulName))));
  let approvalShot = null;
  if (created.approvalURL) {
    if (!created.approvalURL.startsWith(`${base}/#approve/ap_`)) throw new Error(`approval link not on this world: ${created.approvalURL}`);
    const waiting = sh(dir, bare(lineOf(soul, /^node eden-agent\.mjs approval wait/)), 300_000).then((s) => JSON.parse(s), (e) => ({ error: String(e.message).slice(0, 300) }));
    const tab = await p.ctx.newPage(); tab.setDefaultTimeout(120_000); tab.on('pageerror', (e) => errors.push(`approval tab: ${e.message}`));
    await tab.goto(created.approvalURL, { waitUntil: 'domcontentloaded' });
    await tab.locator('[data-approve-agent]').waitFor();
    await sleep(1500);
    approvalShot = await p.shot(`${soulName.toLowerCase()}-approval-card`, tab);
    await tab.locator('[data-approve-agent]').click();
    const waited = await Promise.race([waiting, sleep(150_000).then(() => ({ error: 'timeout' }))]);
    await tab.close();
    if (waited.status !== 'ready') throw new Error(`approval wait: ${JSON.stringify(waited)}`);
  }
  const status = JSON.parse(await sh(dir, 'node eden-agent.mjs status'));
  await p.page.bringToFront();
  return { dir, status, approval: !!created.approvalURL, approvalShot };
}

try {
  // ======================== the god makes a world
  const god = await person('gene');
  await god.page.goto(`${origin}${BASE}/`, { waitUntil: 'domcontentloaded' });
  await god.page.locator('[data-new-world]').waitFor();
  if (MODE === 'clerk') {
    await god.page.locator('[data-home-signin]').click();
    await god.page.locator('[data-stub-clerk-continue]').click();
    await god.page.locator('[data-signed-in]').waitFor({ timeout: 30_000 });
  }
  await god.page.locator('[data-new-world]').click();
  await god.page.locator('[data-world-name]').click(); await god.page.keyboard.type(`Hello World ${DPR}`, { delay: 20 });
  if (MODE === 'dev') { await god.page.locator('[data-god-name]').fill(''); await god.page.locator('[data-god-name]').click(); await god.page.keyboard.type('gene', { delay: 20 }); }
  await god.page.locator('[data-template="empty"]').click().catch(() => {});
  await Promise.all([god.page.waitForURL(/\/w\/[a-z]/, { timeout: 180_000, waitUntil: 'commit' }), god.page.locator('[data-create]').click()]);
  const slug = god.page.url().match(/\/w\/([a-z][a-z0-9-]*)/)[1]; base = `${origin}${BASE}/w/${slug}`;
  await god.page.locator('[data-god-panel]').waitFor({ timeout: 180_000 });
  await god.page.waitForFunction(() => window.__simEntity?.layer?.active === true, null, { timeout: 180_000 }).catch(() => {});
  await sleep(5000);
  const you = await god.page.evaluate(async (b) => { const t = window.Clerk?.session ? await window.Clerk.session.getToken() : 'dev:' + localStorage.getItem('sim.dev'); return (await (await fetch(b + '/v1/god/status', { headers: { authorization: 'Bearer ' + t } })).json()).you; }, base);
  check('the god is the owner of the new world', you === 'owner' || you === 'god', { slug, you });
  await god.shot('god-1-arrive');
  const h1 = await headerText(god.page), p1 = await god.page.locator('[data-god-panel]').innerText();
  check('god: the header shows "New Soul" and the Souls count', /New Soul/.test(h1) && (await pill(god.page)) === '0', { header: h1.replace(/\s+/g, ' ').slice(0, 200), pill: await pill(god.page) });

  if (PHASE === 'before') {
    check('god (before): panel text', true, { panel: p1.replace(/\s+/g, ' ').slice(0, 400) });
    await god.page.locator('[data-tab="souls"]').click().catch(() => {});
    await sleep(1500); await god.shot('god-2-souls-tab');
  } else {
    // ---- the god: New Soul → name → the line
    await god.page.locator('[data-new-soul]').click();
    await god.page.locator('[data-join-form]').waitFor({ state: 'visible', timeout: 30_000 });
    const focused = await god.page.evaluate(() => document.activeElement?.getAttribute('data-soul-name'));
    await sleep(800); await god.shot('god-2-new-soul-form');
    check('god: New Soul opens the Souls tab on the New Soul form (name field focused)', (await god.page.locator('[data-tab="souls"][aria-selected="true"]').count()) === 1 && focused === '1', { focused });
    await god.page.locator('[data-soul-name]').click(); await god.page.keyboard.type('Gene', { delay: 40 });
    await god.page.locator('[data-join-go]').click();
    const line = await god.page.locator('[data-join-prompt]').innerText();
    await god.page.locator('[data-join-line] .gp-copy').click();
    const clip = await god.page.evaluate(() => navigator.clipboard.readText().catch(() => null));
    await sleep(500); await god.shot('god-3-line');
    check('god: the line names this world\'s SKILL.md, Soul mode and the name; copy puts it on the clipboard', line.includes(`${base}/SKILL.md`) && /Soul mode/.test(line) && line.includes('"Gene"') && (clip === null || clip === line), { line });
    const g = await agentMakesSoul(god, line, 'Gene');
    check('god: the agent ran the published create-soul' + (MODE === 'clerk' ? ', the god approved the link (click)' : '') + ', paired', g.status.paired === true && /^s_/.test(g.status.soul ?? '') && (MODE === 'dev' || g.approval), { soul: g.status.soul, approval: g.approval });
    await god.page.locator('[data-souls-list] [data-soul="Gene"]').waitFor({ timeout: 30_000 });
    if (MODE === 'clerk') await god.page.locator('[data-my-soul="Gene"]').waitFor({ timeout: 30_000 });
    await god.page.waitForFunction(() => document.querySelector('[data-souls-pill]')?.getAttribute('data-souls-pill') === '1', null, { timeout: 30_000 }).catch(() => {});
    const formGone = !(await god.page.locator('[data-join-prompt]').isVisible().catch(() => false));
    await god.page.locator('[data-souls-list] [data-soul="Gene"] .gp-link').click().catch(() => {});
    await sleep(3000); await god.shot('god-4-soul-born');
    const live = (await (await fetch(`${base}/v1/world/souls`)).json()).souls;
    check('god: the Soul is in the Souls list, "Your Souls here" (Clerk), the header count is 1, it has a body in the world, the used line is gone',
      (await pill(god.page)) === '1' && live.some((s) => s.name === 'Gene' && s.p) && formGone, { pill: await pill(god.page), live: live.map((s) => [s.name, s.p?.map(Math.round)]), formGone });
    if (MODE === 'clerk') {
      const reconnect = await god.page.locator('[data-reconnect-soul="Gene"]').count();
      await god.page.locator('[data-new-soul]').click();
      const again = await god.page.locator('[data-join-form]').isVisible();
      check('god: Reconnect for the existing Soul, and New Soul still offers another (main\'s limit allows 5)', reconnect === 1 && again, { reconnect, again });
      await god.page.locator('[data-reconnect-soul="Gene"]').click();
      const rl = await god.page.locator('[data-join-prompt]').innerText();
      check('god: Reconnect gives a pair-soul line for that Soul', /reconnect my Soul "Gene" \(s_/.test(rl), { rl });
      await sleep(500); await god.shot('god-5-reconnect-and-another');
    }
  }

  // ======================== a visitor
  const ana = await person('ana');
  await ana.page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await ana.page.locator('[data-god-panel]').waitFor({ timeout: 120_000 });
  await ana.page.waitForFunction(() => window.__simEntity?.layer?.active === true, null, { timeout: 120_000 }).catch(() => {});
  await sleep(4000);
  await ana.shot('visitor-1-arrive');
  const vh = await headerText(ana.page);
  check('visitor (signed out): the header shows "New Soul" and the Souls count', /New Soul/.test(vh) && (await pill(ana.page)) === (PHASE === 'after' ? '1' : '0'), { header: vh.replace(/\s+/g, ' ').slice(0, 200), pill: await pill(ana.page) });
  if (PHASE === 'after') {
    await ana.page.locator('[data-new-soul]').click();
    if (MODE === 'clerk') {
      await ana.page.locator('[data-stub-clerk-continue]').click();   // New Soul while signed out → Clerk's sign-in
    } else {
      await ana.page.locator('[data-signin-name]').click(); await ana.page.keyboard.type('ana', { delay: 30 });
      await ana.page.locator('[data-signin-go]').click();
      await ana.page.waitForLoadState('domcontentloaded'); await ana.page.locator('[data-god-panel]').waitFor({ timeout: 120_000 }); await sleep(3000);
      await ana.page.locator('[data-new-soul]').click();
    }
    await ana.page.locator('[data-join-form]').waitFor({ state: 'visible', timeout: 60_000 });
    await sleep(800); await ana.shot('visitor-2-new-soul-form');
    await ana.page.locator('[data-soul-name]').click(); await ana.page.keyboard.type('Ana', { delay: 40 });
    await ana.page.locator('[data-join-go]').click();
    const line = await ana.page.locator('[data-join-prompt]').innerText();
    await sleep(500); await ana.shot('visitor-3-line');
    const a = await agentMakesSoul(ana, line, 'Ana');
    check('visitor: New Soul → sign in → name → line → the published create-soul' + (MODE === 'clerk' ? ' → Approve (click)' : '') + ' → paired', a.status.paired === true && (MODE === 'dev' || a.approval), { soul: a.status.soul });
    await ana.page.locator('[data-souls-list] [data-soul="Ana"]').waitFor({ timeout: 30_000 });
    if (MODE === 'clerk') await ana.page.locator('[data-my-soul="Ana"]').waitFor({ timeout: 30_000 });
    await ana.page.waitForFunction(() => document.querySelector('[data-souls-pill]')?.getAttribute('data-souls-pill') === '2', null, { timeout: 30_000 }).catch(() => {});
    await ana.page.locator('[data-souls-list] [data-soul="Ana"] .gp-link').click().catch(() => {});
    await sleep(3000); await ana.shot('visitor-4-soul-born');
    const live = (await (await fetch(`${base}/v1/world/souls`)).json()).souls;
    check('visitor: her Soul is listed (and marked hers under Clerk), the header count is 2, her body is in the world', (await pill(ana.page)) === '2' && live.some((s) => s.name === 'Ana' && s.p), { pill: await pill(ana.page), live: live.map((s) => s.name) });
    // the header pill opens the list
    await ana.page.locator('[data-god-panel-toggle], [data-god-panel] [aria-label="collapse"]').first().click().catch(() => {});
    await ana.page.locator('[data-souls-pill]').click();
    await ana.page.locator('[data-souls-list]').waitFor({ state: 'visible', timeout: 10_000 });
    check('visitor: the header\'s Souls count opens the panel on the list', true);
  } else {
    await ana.page.locator('[data-join]').scrollIntoViewIfNeeded().catch(() => {});
    await ana.shot('visitor-2-panel');
  }
  check('no page errors', errors.length === 0, errors.slice(0, 3));
} catch (e) {
  check('walkthrough threw', false, String(e?.stack ?? e).split('\n').slice(0, 4).join(' | '));
  for (const c of browser.contexts()) for (const [i, pg] of c.pages().entries()) await pg.screenshot({ path: join(out, `fail-${i}.png`) }).catch(() => {});
} finally {
  writeFileSync(join(out, 'walkthrough.json'), JSON.stringify({ mode: MODE, phase: PHASE, dpr: DPR, base, report }, null, 2));
  writeFileSync(join(out, 'launcher.log'), launcherLog);
  await browser.close().catch(() => {}); release();
  console.log(`${failed ? '✖' : '✔'} ${report.length - failed}/${report.length} — ${out}`);
  process.exit(failed ? 1 : 0);
}
