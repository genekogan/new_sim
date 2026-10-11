#!/usr/bin/env node
// Lane LOOKS: Souls choose how they look, end to end, through the real Soul CLI the world serves.
// A dev world (launcher-like env: no invitations, native Soul lifecycle, the launcher's pinned CLI) on :5741.
// Two agents curl the CLI, register, create-soul; each is born with a different kit look; Rosa's agent asks for
// "tall, red hoodie, short hair", Benji's for "short, blue jacket, beanie, mohawk"; a wrong value is refused.
// Real Chrome (lease, real GPU) at dpr 1 and 2 frames each Soul with real wheel input and takes shots; while the page
// is open Rosa changes again (a viewer sees it live, no reload); the world restarts and both looks are still there.
//
//   node tools/god-skill/e2e/looks.mjs [--port 5741] [--keep] [--no-shots]
import { spawn, execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromeLease } from '../lib/chrome-lease.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
const slug = 'looks', port = Number(args.port ?? 5741);
if (port < 5730 || port > 5749) throw new Error('lane LOOKS ports only (5730-5749)');
const out = resolve(root, '.lane/e2e-looks', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${port}/w/${slug}`;
const report = { slug, port, startedAt: new Date().toISOString(), steps: [], shots: [], failures: [] };
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exec = promisify(execFile);

const marsWeb = resolve(root, '.lane/mars-web');
const env = { ...process.env, ...(existsSync(marsWeb) ? { MARS_WEB_DIR: marsWeb } : {}), WORLD_KEY: slug, WORLD_ID: `${slug}-1`, ENGINE: 'mars', PORT: String(port), DEV_AUTH: '1', BRAIN_MODE: 'fake',
  SEED_NATIVES: '0', EDGE_FADING: '1', DATA_DIR: resolve(out, 'data'), PUBLIC_URL: `http://127.0.0.1:${port}`, INVITE_REQUIRED: '0', SOUL_LIFECYCLE: '1',
  EDGE_CLI_FILE: resolve(root, 'tools/world-launcher/soul/eden-agent.mjs'), ANTHROPIC_API_KEY: '', TYPESAFE_API_KEY: '', OPENAI_API_KEY: '' };
let server;
const boot = async () => {
  server = spawn(process.execPath, ['apps/server/src/main.ts'], { cwd: root, stdio: 'ignore', env });
  for (let i = 0; i < 3000; i++) { try { if ((await fetch(`${base}/healthz`)).ok) return; } catch { } await sleep(100); }
  throw new Error('world did not come up');
};
const halt = async () => { if (!server) return; const s = server; server = null; s.kill(); await new Promise((r) => s.once('exit', r)); };
process.on('exit', () => { if (!args.keep) try { server?.kill(); } catch { } });

async function step(name, fn, expect) {
  const t0 = performance.now(); let result, error;
  try { result = await fn(); } catch (e) { error = String(e?.stack ?? e?.message ?? e); }
  const okay = !error && (expect ? !!expect(result) : true);
  report.steps.push({ name, ms: Math.round(performance.now() - t0), ok: okay, result, error });
  if (!okay) report.failures.push({ name, result, error });
  log(`${okay ? '✔' : '✖'} ${name}${okay ? '' : ' — ' + (error ?? JSON.stringify(result)).slice(0, 600)}`);
  return result;
}
const cli = (dir, ...a) => exec(process.execPath, ['eden-agent.mjs', ...a], { cwd: dir, timeout: 120_000 }).then((r) => JSON.parse(r.stdout), (e) => ({ error: String(e.stderr || e.message).trim().slice(0, 400) }));
async function agent(name) {
  const dir = mkdtempSync(join(tmpdir(), `looks-${name.toLowerCase()}-`));
  await exec('bash', ['-c', `curl -fsSo eden-agent.mjs ${base}/eden-agent.mjs`], { cwd: dir });
  await cli(dir, 'register', base);
  return { dir, create: await cli(dir, 'create-soul', name) };
}

// ---------- browser
let chromium = null;
if (!args['no-shots']) try { chromium = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test').chromium; } catch { log('  (no Playwright; shots skipped)'); }
let browser = null, release = null;
async function openPage(dpr) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: dpr });
  page.on('pageerror', (e) => (report.pageErrors ??= []).push(`dpr${dpr}: ${e.message}`));
  await page.goto(`${base}?dev=1`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('canvas', { timeout: 120_000 }); await sleep(9000);
  return page;
}
/** Real wheel input under a Soul's name tag, a few rounds (the tag moves as the camera does). */
async function zoomTo(page, name, rounds = 5) {
  const at = [];
  for (let k = 0; k < rounds; k++) {
    const t = await page.evaluate((n) => { const r = [...document.querySelectorAll('b')].filter((e) => e.textContent.trim() === n).map((e) => e.getBoundingClientRect()).find((r) => r.width > 0); return r ? [r.x + r.width / 2, r.y + r.height + 50] : null; }, name);
    if (!t) break; at.push(t.map(Math.round));
    await page.mouse.move(t[0], t[1]); for (let i = 0; i < 2; i++) { await page.mouse.wheel(0, -220); await sleep(90); } await sleep(900);
  }
  return at;
}
/** The page's own "Back to broadcast" button (real click) returns the camera to the wide view. */
async function reset(page) { const b = page.getByText('Back to broadcast'); if (await b.count()) { await b.first().click(); await sleep(3000); } }
async function snap(page, name) { const file = resolve(out, `${name}.png`); await page.screenshot({ path: file, timeout: 120_000 }); report.shots.push(file); log(`  shot ${file}`); return file; }

const ROSA = { height: 1.85, top: 'casual-hoodie', top1: '#b3261e', hair: 'short' };            // tall, red hoodie, short hair
const BENJI = { frame: 'masc', face: 'open', height: 1.66, top: 'jacket', top1: '#2c4f8c', hat: 'beanie', hair: 'mohawk', glasses: 'none', bag: 'none' };
const set = (dir, look) => cli(dir, 'body', 'look', '--set', ...Object.entries(look).map(([k, v]) => `${k}=${v}`));
try {
  await boot(); log(`▶ world "${slug}" on :${port}`);
  let rosa, benji;
  await step('C0 two agents install the world\'s Soul CLI (1.9), register and create-soul Rosa and Benji', async () => {
    rosa = await agent('Rosa'); benji = await agent('Benji');
    return { rosa: rosa.create.created, benji: benji.create.created, version: (await cli(rosa.dir, 'version')).skillVersion };
  }, (r) => r.rosa && r.benji && r.version === '1.9');
  await step('C1 each new Soul is born with a kit look, and the two differ', async () => {
    let a, b; for (let i = 0; i < 40 && !(a?.look && b?.look); i++) { a = await cli(rosa.dir, 'body', 'look'); b = await cli(benji.dir, 'body', 'look'); if (!(a?.look && b?.look)) await sleep(250); }
    return { rosa: a.look, benji: b.look, differ: JSON.stringify(a.look) !== JSON.stringify(b.look), hairChoices: a.choices?.hair?.length };
  }, (r) => r.rosa && r.benji && r.differ && r.hairChoices >= 19);
  await step('C2 Rosa: "tall, red hoodie, short hair" → body look --set height=1.85 top=casual-hoodie top1=#b3261e hair=short', async () => ({ changed: (await set(rosa.dir, ROSA)).changed, look: (await cli(rosa.dir, 'body', 'look')).look }),
    (r) => r.changed === true && Object.entries(ROSA).every(([k, v]) => r.look[k] === v));
  await step('C3 Benji: "short, blue jacket, beanie, mohawk"', () => set(benji.dir, BENJI), (r) => r.changed === true && r.body.params.hat === 'beanie' && r.body.params.height === 1.66);
  await step('C4 a value outside the kit is refused and changes nothing', async () => {
    const before = (await cli(rosa.dir, 'body', 'look')).look, bad = await cli(rosa.dir, 'body', 'look', '--set', 'hair=purple'), tall = await cli(rosa.dir, 'body', 'look', '--set', 'height=2.3');
    return { bad: bad.error, tall: tall.error, same: JSON.stringify((await cli(rosa.dir, 'body', 'look')).look) === JSON.stringify(before) };
  }, (r) => /body\.look/.test(r.bad) && /body\.look/.test(r.tall) && r.same);

  if (chromium) {
    release = await chromeLease('LOOKS-e2e');
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
    for (const dpr of [1, 2]) {
      const page = await openPage(dpr);
      await step(`V${dpr} dpr ${dpr}: the world page frames Rosa, then Benji (real wheel input)`, async () => {
        const r = await zoomTo(page, 'Rosa', 3); await snap(page, `dpr${dpr}-rosa`);
        await reset(page); const b = await zoomTo(page, 'Benji', 3); await snap(page, `dpr${dpr}-benji`);
        return { rosa: r.length, benji: b.length, renderer: await page.evaluate(() => { const c = document.querySelector('canvas'); const gl = c?.getContext('webgl2'); const x = gl?.getExtension('WEBGL_debug_renderer_info'); return x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : null; }) };
      }, (r) => r.rosa > 0 && r.benji > 0);
      if (dpr === 2) await step('L0 a viewer sees Rosa change live (no reload): a green hoodie, a beanie and round glasses', async () => {
        await reset(page); await zoomTo(page, 'Rosa', 3); const before = await snap(page, 'live-before');
        const r = await set(rosa.dir, { hat: 'beanie', top1: '#2f6b4f', glasses: 'round' }); await sleep(4000);
        const after = await snap(page, 'live-after');
        return { changed: r.changed, before, after };
      }, (r) => r.changed === true);
      await page.close();
    }
  }
  await step('P0 the world restarts; both looks are still worn', async () => {
    const want = { rosa: (await cli(rosa.dir, 'body', 'look')).look, benji: (await cli(benji.dir, 'body', 'look')).look };
    await halt(); await boot();
    const got = { rosa: (await cli(rosa.dir, 'body', 'look')).look, benji: (await cli(benji.dir, 'body', 'look')).look };
    return { same: JSON.stringify(want) === JSON.stringify(got), rosaHat: got.rosa?.hat, benjiHeight: got.benji?.height };
  }, (r) => r.same && r.rosaHat === 'beanie' && r.benjiHeight === 1.66);
} catch (e) { report.failures.push({ name: 'harness', error: String(e?.stack ?? e) }); log('✖ harness', e); }
finally {
  try { await browser?.close(); } catch { } try { release?.(); } catch { }
  if (!args.keep) await halt();
  report.finishedAt = new Date().toISOString();
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 1));
  const passed = report.steps.filter((s) => s.ok).length;
  log(`\n${passed}/${report.steps.length} steps passed; page errors: ${report.pageErrors?.length ?? 0}; report ${out}/report.json`);
  process.exit(report.failures.length ? 1 : 0);
}
