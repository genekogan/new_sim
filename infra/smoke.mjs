// Focused milestone browser proof. Install Chromium into an explicit workspace
// cache, then run: SIM_SMOKE_BASE=https://... node infra/smoke.mjs
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH ??= root + '.e2e/browsers';
const require = createRequire(new URL('../mars/viewer/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const base = process.env.SIM_SMOKE_BASE ?? 'http://127.0.0.1:4610';
const marsBase = process.env.SIM_SMOKE_MARS_BASE ?? base;
const output = process.env.SIM_SMOKE_OUTPUT ?? root + '.e2e/runs/' + new Date().toISOString().replaceAll(':', '-');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const results = [];
try {
  for (const [name, origin, path, needle] of [
    ['world-list', base, '/', 'Persistent worlds'],
    ['toy', base, '/w/toy', 'toy-1'],
    ['mars', marsBase, '/w/mars', process.env.SIM_SMOKE_MARS_ID ?? 'mars-1'],
    ['lab', base, '/l/mars', 'Lab'],
    ['year-2020', base, '/w/mars/2020', '2020'],
    ['year-2026', base, '/w/mars/2026', '2026'],
    ...(process.env.SIM_SMOKE_EXTRA_WORLDS==='1'?[['littlemartians',base,'/w/littlemartians','littlemartians-1'],['eden',base,'/w/eden','eden-1'],['lab-littlemartians',base,'/l/littlemartians','Lab'],['lab-eden',base,'/l/eden','Lab']]:[]),
  ]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], failures = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.status() >= 400 && new URL(r.url()).origin === new URL(origin).origin) failures.push(`${r.status()} ${new URL(r.url()).pathname}`); });
    await page.goto(origin + path, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (name.startsWith('year')) await page.locator('body').filter({ hasText: needle }).waitFor({ timeout: 30_000 });
    else await page.getByText(needle, { exact: false }).first().waitFor({ timeout: 30_000 });
    if (['toy','mars','littlemartians','eden'].includes(name)) {
      await page.getByText('Live now', { exact: true }).waitFor({ timeout: 30_000 });
      await page.locator('canvas[aria-label="Live 3D view of the world"]').waitFor();
      // Let templates and two successive take chunks render.
      await page.waitForTimeout(2500);
      for (const person of name==='toy'?[]:name==='mars'?['Alice','Bob','Carol','David']:name==='littlemartians'?['Verdelis','Kalama','Kweku','Mycos','Ada','Shuijing','Nyx']:['Eden']) await page.getByText(person, { exact: true }).first().waitFor();
    }
    if (name.startsWith('lab') || name.startsWith('year')) {
      await page.locator('canvas').first().waitFor({ timeout: 45_000 });
      if (name.startsWith('year') && name !== 'year-2020') await page.waitForFunction(() => window.__marsStudio?.ready, {timeout:120000});
      else await page.waitForTimeout(2500);
    }
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
    writeFileSync(`${output}/${name}.txt`, await page.locator('body').innerText());
    results.push({ name, url: origin + path, errors, failures });
    await page.close();
  }
} finally { await browser.close(); }
writeFileSync(`${output}/summary.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify({ output, results }));
if (results.some(r => r.errors.length || r.failures.length)) process.exitCode = 1;
