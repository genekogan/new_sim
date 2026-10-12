// Real Chrome input at dpr1/2 on a disposable launcher and private review file; no production/key access.
import './gpu-chrome.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const root = resolve(new URL('../..', import.meta.url).pathname), out = resolve(process.argv[2] ?? '.lane/p1-browser-proof');
mkdirSync(out, { recursive: true });
const { chromium } = createRequire(new URL('../../mars/viewer/package.json', import.meta.url))('@playwright/test');
const env = { ...process.env, BRAIN_MODE: 'fake', SEED_NATIVES: '0', CATALOG_REGISTRY_DIR: resolve(root, '.lane/registry'), CATALOG_CHANNEL: 'candidate' };
const origin = 'http://127.0.0.1:6110';
const server = spawn(process.execPath, ['tools/catalog/proof-launcher.mjs', `${out}/data`], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; server.stdout.on('data', (data) => { log += data; }); server.stderr.on('data', (data) => { log += data; });
const report = { source: process.env.P1_SOURCE_SHA ?? 'unknown', realm: 'disposable local launcher in Modal', runs: [] };
const dprs = process.env.P1_PROOF_DPR ? [Number(process.env.P1_PROOF_DPR)] : [1, 2];
if (dprs.some((value) => ![1, 2].includes(value))) throw new Error('proof dpr must be 1 or 2');
const camera = () => { const s = window.__simEntity; return s ? s.camera.position.toArray() : null; };
const different = (a, b) => !!(a && b) && a.some((value, i) => Math.abs(value - b[i]) > 0.01);
let worldUrl;
try {
  for (let i = 0; i < 600; i++) {
    if (server.exitCode !== null) throw new Error('proof launcher exited during boot');
    try { if ((await fetch(origin + '/worlds/__sim/healthz')).ok) break; } catch {}
    await new Promise((done) => setTimeout(done, 100));
  }
  for (const dpr of dprs) {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1352, height: 780 }, deviceScaleFactor: dpr, acceptDownloads: true });
      await context.addInitScript(() => localStorage.setItem('sim.dev', 'catalogue-probe'));
      const page = await context.newPage(), errors = [], run = { dpr, checks: {} };
      page.on('pageerror', (error) => errors.push(String(error)));
      if (!worldUrl) {
        await page.goto(origin + '/worlds/', { waitUntil: 'domcontentloaded' });
        await page.locator('[data-new-world]').first().click();
        await page.locator('[data-world-name]').fill('Catalogue probe');
        await page.locator('[data-template="empty"] input').check();
        const godName = page.locator('[data-god-name]'); if (await godName.isVisible().catch(() => false)) await godName.fill('Probe');
        await page.screenshot({ path: `${out}/home-dpr${dpr}.png` });
        await page.locator('[data-create]').click();
        await page.waitForURL(/\/worlds\/w\//, { timeout: 120000 }); const created = new URL(page.url()); created.search = ''; created.hash = ''; worldUrl = created.href;
      } else await page.goto(worldUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!window.__simEntity?.layer.active, null, { timeout: 120000 });
      await page.locator('.viewer-arrival').waitFor({ state: 'hidden', timeout: 120000 });
      await page.waitForTimeout(500);
      const api = async (path, body, token = 'dev:catalogue-probe') => {
        const response = await fetch(worldUrl.replace(/\/$/, '') + path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
        return { status: response.status, data: await response.json() };
      };
      const minted = await api('/v1/god/mint', { label: 'proof' });
      if (minted.status !== 200) throw new Error(`proof mint status ${minted.status}`);
      const token = minted.data.token; // Ephemeral fixture token; never printed or persisted.
      const found = await api('/v1/god/defs?q=rainfall%20meter&compact=1', undefined, token);
      run.checks.find = found.status === 200 && found.data.defs[0]?.ref === 'eden/rain-gauge@1';
      if (!run.checks.find) throw new Error('candidate registry find failed');
      if (report.runs.length === 0) {
        const placed = await api('/v1/god/act', { ops: [{ op: 'place', def: 'eden/rain-gauge@1', name: 'rain-gauge', p: [0, 0, 0] }] }, token);
        run.checks.place = placed.status === 200 && placed.data.accepted;
        if (!run.checks.place) throw new Error('candidate placement failed');
      } else run.checks.reload = (await api('/v1/world/snapshot', undefined, token)).data.entities.some((entity) => entity.name === 'rain-gauge');
      await page.waitForTimeout(1000);
      const canvas = page.locator('canvas[aria-label="Live 3D view of the world"]');
      run.geometry = await canvas.evaluate((element) => ({ css: [element.clientWidth, element.clientHeight], buffer: [element.width, element.height], dpr: devicePixelRatio }));
      run.checks.retina = run.geometry.buffer[0] === run.geometry.css[0] * dpr && run.geometry.buffer[1] === run.geometry.css[1] * dpr;
      const a = await page.evaluate(camera);
      await page.mouse.move(550, 500); await page.mouse.down(); await page.waitForTimeout(150);
      for (let i = 1; i <= 10; i++) { await page.mouse.move(550 + i * 15, 500 - i * 5); await page.waitForTimeout(50); }
      await page.mouse.up(); await page.waitForTimeout(700);
      const b = await page.evaluate(camera); run.checks.drag = different(a, b);
      await page.mouse.wheel(0, -500); await page.waitForTimeout(1000); const c = await page.evaluate(camera); run.checks.wheel = different(b, c);
      await page.keyboard.down('w'); await page.waitForTimeout(900); await page.keyboard.up('w'); await page.waitForTimeout(400); const d = await page.evaluate(camera); run.checks.keys = different(c, d);
      await page.mouse.dblclick(580, 540); await page.waitForTimeout(2000); run.checks.doubleClick = different(d, await page.evaluate(camera));
      await page.screenshot({ path: `${out}/world-dpr${dpr}.png` });
      // Current join front door: the shared header's New Soul opens the agent connection prompt.
      await page.locator('.account-avatar').click();
      const newSoul = page.locator('.bring-agent-open').first();
      await newSoul.click(); await page.waitForTimeout(300);
      const bodyText = await page.locator('body').innerText();
      run.checks.joinPrompt = /agent|skill\.md|connect/i.test(bodyText);
      writeFileSync(`${out}/world-a11y-dpr${dpr}.txt`, await page.locator('body').innerText());
      await page.screenshot({ path: `${out}/join-dpr${dpr}.png` });
      // Exercise the private review controls; exported fixture decision is NOT imported into the registry.
      await page.goto(pathToFileURL(resolve(root, '.lane/review/index.html')).href);
      await page.locator('select').first().selectOption('fix');
      await page.getByRole('textbox', { name: /Review note/ }).fill('Browser proof fixture; do not import.');
      const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export decisions' }).click();
      const download = await downloading; await download.saveAs(`${out}/review-fixture-dpr${dpr}.json`);
      const decisions = JSON.parse(readFileSync(`${out}/review-fixture-dpr${dpr}.json`, 'utf8'));
      run.checks.reviewExport = decisions.length === 1 && decisions[0].verdict === 'fix';
      await page.screenshot({ path: `${out}/review-dpr${dpr}.png` });
      run.errors = errors; run.checks.noPageErrors = !errors.length; report.runs.push(run);
      writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
      await context.close();
    } finally { await browser.close(); }
  }
  report.ok = report.runs.length === dprs.length && report.runs.every((run) => Object.values(run.checks).every(Boolean));
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, runs: report.runs.map(({ dpr, checks }) => ({ dpr, checks })), out }));
  process.exitCode = report.ok ? 0 : 1;
} catch (error) {
  writeFileSync(`${out}/failure.txt`, String(error)); throw error;
} finally { server.kill(); writeFileSync(`${out}/server.log`, log); }
