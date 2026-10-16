#!/usr/bin/env node
// The meetup flow, end to end, as a person and their agent do it (spec 29 WP6, L6 brief):
// homepage → New world → the panel greets → sign in → claim → the CLI pairs from a
// fresh folder → Approve in the panel → the CLI builds a thing → it appears in the
// page → undo/redo from the panel → a preview drawn as a ghost → a killed world
// restarts by itself with everything still there → a `look` ticks the last step.
//
//   node tools/god-skill/e2e/launcher.mjs [--port 5149] [--range 5125-5148] [--keep]
//
// Starts its own launcher on a fresh data dir (fake minds, dev auth; $0). Writes
// report.json and screenshots under .lane/e2e-launcher/<stamp>/. Needs Google Chrome.
import { spawn, execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
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
const port = Number(args.port ?? 5149);
const range = typeof args.range === 'string' ? args.range : '5125-5148';
const out = resolve(root, '.lane/e2e-launcher', stamp);
mkdirSync(out, { recursive: true });
const origin = `http://127.0.0.1:${port}`;
const report = { port, range, startedAt: new Date().toISOString(), steps: [], shots: [], failures: [] };
const t = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = promisify(execFile);
const PAGE_MS = Number(args["page-ms"] ?? 30_000);

async function step(name, fn, expect) {
  const t0 = t(); let result, error;
  try { result = await fn(); } catch (e) {
    const details = String(e?.message ?? e); error = details.split('\n')[0];
    if (!report.failures.length) {
      writeFileSync(join(out, 'first-failure.log'), details);
      const file = join(out, 'first-failure.png');
      try { await page.screenshot({ path: file, timeout: 5000 }); report.shots.push(file); } catch { /* preserve original failure */ }
    }
  }
  const ms = t() - t0, ok = !error && (expect ? !!expect(result) : true);
  report.steps.push({ name, ms: Math.round(ms), ok, result: brief(result), error });
  if (!ok) report.failures.push({ name, result: brief(result), error });
  console.log(`${ok ? '✔' : '✖'} ${name} — ${(ms / 1000).toFixed(1)} s${ok ? '' : ' — ' + (error ?? JSON.stringify(brief(result)).slice(0, 400))}`);
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  return result;
}
const brief = (r) => { try { return JSON.parse(JSON.stringify(r ?? null, (k, v) => (typeof v === 'string' && v.length > 300 ? v.slice(0, 300) + '…' : v))); } catch { return String(r); } };
const until = async (what, fn, ms = 60_000, every = 400) => { const end = Date.now() + ms; let last; while (Date.now() < end) { try { last = await fn(); if (last) return last; } catch (e) { last = String(e.message); } await sleep(every); } throw new Error(`timed out waiting for ${what} (last: ${JSON.stringify(last)?.slice(0, 200)})`); };
const getJson = async (p, init) => { const r = await fetch(origin + p, init); return { status: r.status, data: await r.json().catch(() => null) }; };

// ---------- the launcher (own process, own data)
const dataDir = resolve(out, 'data');
const launcher = spawn(process.execPath, ['tools/world-launcher/launcher.mjs', '--port', String(port), '--range', range, '--data', dataDir], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let launcherLog = ''; launcher.stdout.on('data', (d) => { launcherLog += d; }); launcher.stderr.on('data', (d) => { launcherLog += d; });
const cleanup = () => { try { launcher.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', () => { if (!args.keep) cleanup(); });
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { cleanup(); process.exit(130); });
await until('the launcher', async () => (await fetch(`${origin}/__sim/worlds.json`)).ok, 30_000);

// ---------- the browser (a person) and a fresh folder (their agent)
const { chromium } = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test');
// A Chrome lease slot for this run (lib/chrome-lease.mjs): eden-lock/1's heartbeat keeps it fresh, directory mtime too.
const releaseLease = await chromeLease('launcher-e2e');
// Real GPU (Metal) headless Chrome; swiftshader starves on this shared machine.
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
const page = await ctx.newPage();
page.setDefaultTimeout(PAGE_MS);
const pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
const dialogs = []; let answer = null;
page.on('dialog', async (d) => { dialogs.push(d.message()); if (d.type() === 'prompt' && answer !== null) await d.accept(answer); else await d.dismiss(); });
async function shot(name) { const file = join(out, `${name}.png`); await page.screenshot({ path: file, timeout: PAGE_MS }); report.shots.push(file); console.log(`  📷 ${name}.png`); }
const folder = mkdtempSync(join(tmpdir(), 'god-agent-'));
const cli = (...a) => run(process.execPath, ['eden-god.mjs', ...a], { cwd: folder, timeout: 120_000 }).then((r) => r.stdout.trim());
const panel = () => page.locator('[data-god-panel]');
let slug = '', base = '', worldName = `Meetup Hollow ${stamp.slice(11, 16).replace('-', '')}`;

try {
  await step('homepage lists worlds and offers New world', async () => {
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: PAGE_MS });
    await page.locator('[data-new-world]').first().waitFor();
    await shot('01-home');
    return { title: await page.title(), button: await page.locator('[data-new-world]').count() };
  }, (r) => r.button >= 1);

  await step('New world → dialog with templates (Empty plain, Hello hamlet, …)', async () => {
    await page.locator('[data-new-world]').first().click();
    await page.locator('[data-new-world-dialog]').waitFor();
    await page.locator('[data-world-name]').fill(worldName);
    await page.locator('[data-template="hello-hamlet"]').click();
    await shot('02-dialog');
    return { templates: await page.locator('[data-template]').evaluateAll((els) => els.map((e) => e.getAttribute('data-template'))) };
  }, (r) => r.templates[0] === 'empty' && r.templates.includes('hello-hamlet'));

  await step('Create → the world starts and the page opens it with the panel', async () => {
    const t0 = t();
    await page.locator('[data-create]').click();
    await page.waitForURL(/\/w\/[a-z0-9-]+\/\?dev=1&new=1/, { timeout: PAGE_MS });
    const createMs = Math.round(t() - t0);
    slug = new URL(page.url()).pathname.split('/')[2]; base = `${origin}/w/${slug}`;
    await panel().waitFor({ timeout: PAGE_MS });
    await page.waitForFunction(() => window.__simEntity?.layer?.active === true, null, { timeout: PAGE_MS });
    await sleep(3000);
    await shot('03-new-world-panel');
    return { slug, createMs, text: (await panel().innerText()).slice(0, 300) };
  }, (r) => r.slug.startsWith('meetup-hollow') && /new world is ready/i.test(r.text) && /Sign in/.test(r.text));

  await step('sign in (a local name)', async () => {
    answer = 'gene';
    await page.locator('[data-signin]').click();
    // the panel asks for the local name inline (no window.prompt: embedded browsers drop it)
    await page.locator('[data-signin-name]').fill('gene');
    await page.locator('[data-signin-go]').click();
    await page.waitForLoadState('domcontentloaded');
    await page.locator('[data-claim]').waitFor({ timeout: PAGE_MS });
    return { text: (await panel().innerText()).slice(0, 200) };
  }, (r) => /Nobody owns this world yet/.test(r.text));

  await step('claim → god mode: welcome rendered with copy buttons, checklist ticks sign-in and claim', async () => {
    await page.locator('[data-claim]').click();
    await page.locator('[data-checklist]').waitFor();
    await page.locator('[data-god-bolt]').click();   // GODUI: the pairing line lives in the bolt panel right of Explore
    await page.locator('[data-god-bolt-panel] .gp-md .gp-code').first().waitFor();
    const ticks = await page.locator('[data-step]').evaluateAll((els) => Object.fromEntries(els.map((e) => [e.getAttribute('data-step'), e.getAttribute('data-done') === '1'])));
    const copies = await page.locator('.gp-copy').count();
    // the copy button puts the commands (without the comments) on the clipboard
    await page.locator('[data-god-bolt-panel] .gp-copy').first().click();
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
    await shot('04-claimed');
    return { ticks, copies, clip };
  }, (r) => r.ticks.signin && r.ticks.claim && !r.ticks.pair && !r.ticks.build && r.copies >= 1 && /eden-god\.mjs|SKILL\.md/.test(r.clip ?? 'eden-god.mjs'));

  let pairing;
  await step('the agent, in a fresh folder: download the CLI and skill, register, pair', async () => {
    const welcome = await (await fetch(`${base}/v1/god/welcome`, { headers: { authorization: 'Bearer dev:gene' } })).text();
    const curl = welcome.match(/curl -sO (\S+\/god\/eden-god\.mjs)/)?.[1];
    if (!curl) throw new Error('the welcome does not say where to get the CLI');
    writeFileSync(join(folder, 'eden-god.mjs'), await (await fetch(curl)).text());
    writeFileSync(join(folder, 'SKILL.md'), await (await fetch(`${base}/god/SKILL.md`)).text());
    const reg = JSON.parse(await cli('register', base));
    pairing = spawn(process.execPath, ['eden-god.mjs', 'pair', 'meetup-agent'], { cwd: folder, stdio: ['ignore', 'pipe', 'pipe'] });
    let said = ''; pairing.stderr.on('data', (d) => { said += d; }); pairing.stdout.on('data', (d) => { said += d; });
    pairing.done = new Promise((r) => pairing.once('exit', (code) => r({ code, said })));
    const link = await until('the CLI to print the approve link', async () => said.match(/(http\S+#godpair\/[A-Z0-9-]+)/)?.[1], 30_000);
    return { reg, link, cliBytes: readFileSync(join(folder, 'eden-god.mjs')).length };
  }, (r) => r.reg.worldId === `${slug}-1` && r.link.startsWith(base));

  await step('the code appears in the panel → Approve → the CLI holds god mode', async () => {
    await page.locator('[data-approve]').first().waitFor({ timeout: 30_000 });
    await shot('05-pairing-request');
    const code = await page.locator('[data-approve]').first().getAttribute('data-approve');
    await page.locator('[data-approve]').first().click();
    const done = await Promise.race([pairing.done, sleep(30_000).then(() => ({ code: 'timeout' }))]);
    const state = JSON.parse(readFileSync(join(folder, '.eden-god.json'), 'utf8'));
    await page.locator('[data-step="pair"][data-done="1"]').waitFor({ timeout: 15_000 });
    return { code, exit: done.code, token: state.token?.slice(0, slug.length + 8) };
  }, (r) => r.exit === 0 && r.token?.startsWith(`god_${slug}-1_`));

  let barnId = null;
  await step('the CLI builds a thing (a barn by the orchard flag, grouped) and it appears in the page', async () => {
    const r = JSON.parse(await cli('act', JSON.stringify({ group: 'barnyard', ops: [{ op: 'place', def: 'core/cottage@1', name: 'barn', p: [-26, -30], state: { paint: '#b5523b' } }] }), '--note', 'a red barn by the orchard'));
    barnId = r.ids?.barn ?? Object.values(r.ids ?? {})[0] ?? null;
    if (!barnId) { const s = await (await fetch(`${base}/v1/world/snapshot`)).json(); barnId = s.entities.find((e) => e.name === 'barn')?.id ?? null; }
    const drawn = await page.waitForFunction((id) => window.__simEntity?.layer?.drawn?.has(id) === true, barnId, { timeout: 60_000 }).then(() => true, () => false);
    await page.locator('[data-step="build"][data-done="1"]').waitFor({ timeout: 15_000 });
    await page.evaluate(() => { const w = window.__simEntity; w.controls.target.set(-26, 1, -30); w.camera.position.set(-60, 26, 6); w.camera.lookAt(w.controls.target); });
    await sleep(3500);
    await shot('06-barn-built');
    return { accepted: r.accepted, barnId, drawn };
  }, (r) => r.accepted && r.drawn);

  await step('the Edits tab lists it with its note and group; undo and redo from the panel', async () => {
    // Pairing leaves God controls open over the Edits tab. Dismiss it as a person would before clicking behind it.
    await page.keyboard.press('Escape');
    await page.locator('[data-god-bolt-panel]').waitFor({ state: 'hidden', timeout: 5000 });
    await page.locator('[data-tab="edits"]').click();
    await page.locator('[data-edits] li', { hasText: 'a red barn by the orchard' }).waitFor();
    await shot('07-edits');
    await page.locator('[data-undo]').click();
    const gone = await page.waitForFunction((id) => !window.__simEntity?.layer?.drawn?.has(id), barnId, { timeout: 30_000 }).then(() => true, () => false);
    await page.locator('[data-redo]').click();
    const back = await page.waitForFunction((id) => window.__simEntity?.layer?.drawn?.has(id) === true, barnId, { timeout: 30_000 }).then(() => true, () => false);
    // undo the whole group from its row
    await page.locator('[data-undo-group="barnyard"]').first().waitFor({ timeout: 15_000 });
    await page.locator('[data-undo-group="barnyard"]').first().click();
    const groupGone = await until('the group undone', async () => !(await (await fetch(`${base}/v1/world/snapshot`)).json()).entities.some((e) => e.name === 'barn'), 20_000).then(() => true, () => false);
    await page.locator('[data-redo]').click();
    const restored = await until('redo', async () => (await (await fetch(`${base}/v1/world/snapshot`)).json()).entities.some((e) => e.name === 'barn'), 20_000).then(() => true, () => false);
    return { gone, back, groupGone, restored, note: await page.locator('.gp-ok, .gp-bad').last().innerText().catch(() => null) };
  }, (r) => r.gone && r.back && r.groupGone && r.restored);

  await step('drop a flag from the panel (⚑, click the ground, name it): it ticks “Drop a flag”', async () => {
    await page.evaluate(() => { const w = window.__simEntity; w.controls.target.set(20, 0, -10); w.camera.position.set(20, 90, 40); w.camera.lookAt(w.controls.target); });
    await sleep(1500);
    answer = 'market';
    await page.locator('[data-flag-button]').click();
    await page.locator('canvas').first().click({ position: { x: 500, y: 420 } });
    const flag = await until('the flag', async () => (await (await fetch(`${base}/v1/world/snapshot`)).json()).entities.find((e) => e.name === 'market'), 30_000);
    await page.locator('[data-tab="start"]').click();
    await page.locator('[data-step="flag"][data-done="1"]').waitFor({ timeout: 20_000 });
    return { at: flag.p, label: flag.state?.label };
  }, (r) => r.label === 'market');

  await step('flags: the template’s flags are listed; clicking one flies the camera there', async () => {
    await page.locator('[data-tab="flags"]').click();
    await page.locator('[data-fly="orchard"]').waitFor();
    await page.locator('[data-fly="orchard"]').click();
    // the flight is animated per frame; on a loaded machine frames are rare, so wait for it to land
    await page.waitForFunction(() => { const t = window.__simEntity.controls.target; return Math.hypot(t.x + 40, t.z + 30) < 14 && window.__simEntity.camera.position.distanceTo(t) < 40; }, null, { timeout: 60_000 }).catch(() => {});
    const target = await page.evaluate(() => window.__simEntity.controls.target.toArray().map((v) => Math.round(v)));
    await shot('08-flags');
    return { target };
  }, (r) => Math.hypot(r.target[0] + 40, r.target[2] + 30) < 14);

  let previewId = null;
  await step('the agent previews a batch (dry run): a ghost renders over the world, nothing is built', async () => {
    const { token } = JSON.parse(readFileSync(join(folder, '.eden-god.json'), 'utf8'));
    const before = (await (await fetch(`${base}/v1/world/snapshot`)).json()).entities.length;
    const pv = await (await fetch(`${base}/v1/god/preview`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': 'node' }, body: JSON.stringify({ ops: [
      { op: 'place', def: 'core/cottage@1', name: 'guest-house', p: [-8, 24] },
      { op: 'place', def: 'core/bench@1', name: 'lookout', p: [8, 30] },
      { op: 'move', id: 'barn', p: [-30, -40] },
    ] }) })).json();
    if (!pv.accepted) throw new Error('preview refused: ' + JSON.stringify(pv.failures));
    previewId = pv.id;
    await page.goto(`${base}/?dev=1&preview=${pv.id}`, { waitUntil: 'domcontentloaded', timeout: PAGE_MS });
    await page.locator(`[data-preview-banner="${pv.id}"][data-preview-ok="1"]`).waitFor({ timeout: PAGE_MS });
    const ghost = await page.evaluate(() => ({ ...window.__simGhost?.current, inScene: window.__simGhost?.group.parent === window.__simEntity?.scene, meshes: (() => { let n = 0; window.__simGhost?.group.traverse((o) => { if (o.isMesh && o.visible) n++; }); return n; })() }));
    await page.evaluate(() => { const w = window.__simEntity; w.controls.target.set(2, 1, -2); w.camera.position.set(-62, 48, 66); w.camera.lookAt(w.controls.target); });
    await sleep(3000);
    await shot('09-preview-ghost');
    const after = (await (await fetch(`${base}/v1/world/snapshot`)).json()).entities.length;
    await page.locator('[data-tab="previews"]').click();
    const listed = await page.locator(`[data-show-preview="${pv.id}"]`).waitFor({ timeout: 20_000 }).then(() => true, () => false);
    await shot('10-previews-tab');
    return { id: pv.id, summary: pv.summary, ghost, uncommitted: before === after, listed };
  }, (r) => r.ghost?.ok && r.ghost.inScene && r.ghost.meshes >= 3 && r.ghost.drawn >= 3 && r.ghost.added >= 2 && r.ghost.changed >= 1 && r.uncommitted && r.listed);

  await step('a killed world restarts by itself; the barn is still there; the page carries on', async () => {
    const before = (await getJson('/__sim/launcher')).data.children.find((c) => c.slug === slug);
    process.kill(before.pid, 'SIGKILL');
    const after = await until('the restart', async () => { const c = (await getJson('/__sim/launcher')).data.children.find((x) => x.slug === slug); return c.status === 'running' && c.pid !== before.pid ? c : null; }, 120_000, 500);
    const snap = (await getJson(`/w/${slug}/v1/world/snapshot`)).data;
    await page.waitForFunction(() => window.__simEntity?.layer?.active === true, null, { timeout: 60_000 });
    await sleep(4000);
    await shot('11-after-restart');
    return { pid: [before.pid, after.pid], restarts: after.restarts, barn: snap.entities.some((e) => e.name === 'barn'), entities: snap.entities.length };
  }, (r) => r.restarts >= 1 && r.barn);

  await step('the agent looks (a ?shot=1 page load): the last step ticks; homepage lists the world (UXFIX2: no \'god: claimed\' line without a god name)', async () => {
    const lookPage = await ctx.newPage();
    await lookPage.goto(`${base}/?dev=1&shot=1&eye=-60,40,60&at=-20,0,-10`, { waitUntil: 'domcontentloaded', timeout: PAGE_MS });
    await lookPage.close();
    // the look is the last step: when it ticks, the panel moves itself once to the Edits tab (GodPanel), so keep reopening Start
    for (const t0 = Date.now(); ; await sleep(1000)) {
      await page.locator('[data-tab="start"]').click();
      if (await page.locator('[data-step="look"][data-done="1"]').count()) break;
      if (Date.now() - t0 > 30_000) throw new Error('the look step did not tick within 30 s');
    }
    const ticks = await page.locator('[data-step]').evaluateAll((els) => els.map((e) => e.getAttribute('data-done')).join(''));
    await shot('12-all-steps');
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: PAGE_MS });
    const card = page.locator(`[data-world="${slug}"]`); await card.waitFor();
    const text = await card.innerText();
    await shot('13-home-after');
    return { ticks, card: text };
  }, (r) => r.ticks === '111111' && /Open/.test(r.card) && !/god: claimed/.test(r.card));
} catch (e) {
  report.failures.push({ name: 'harness', error: String(e?.stack ?? e) }); console.error(e);
} finally {
  report.pageErrors = pageErrors.slice(0, 20); report.dialogs = dialogs;
  report.finishedAt = new Date().toISOString(); report.slug = slug;
  report.passed = report.steps.filter((s) => s.ok).length; report.total = report.steps.length;
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(out, 'launcher.log'), launcherLog);
  await browser.close().catch(() => {});
  releaseLease();
  console.log(`\n${report.passed}/${report.total} steps passed${report.failures.length ? `, ${report.failures.length} failures` : ''} — ${out}`);
  if (!args.keep) cleanup();
  process.exit(report.failures.length ? 1 : 0);
}
