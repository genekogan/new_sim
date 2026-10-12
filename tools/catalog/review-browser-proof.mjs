// Bounded real-input proof for the private review artifact only. Fixture decisions are never imported.
import './gpu-chrome.mjs';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = createRequire(new URL('../../mars/viewer/package.json', import.meta.url))('@playwright/test');
const root = resolve(new URL('../..', import.meta.url).pathname), out = resolve(process.argv[2]); mkdirSync(out, { recursive: true });
const report = { artifact: 'private review', runs: [] };
for (const dpr of [1, 2]) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1352, height: 780 }, deviceScaleFactor: dpr, acceptDownloads: true }), page = await context.newPage(), errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(pathToFileURL(resolve(root, '.lane/review/index.html')).href);
    await page.locator('img').first().waitFor({ state: 'visible' });
    await page.getByText('Gate details', { exact: true }).click(); await page.getByText('Gate details', { exact: true }).click();
    await page.locator('select').selectOption('fix'); await page.getByRole('textbox', { name: /Review note/ }).fill('Browser proof fixture; do not import.');
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export decisions' }).click();
    await (await download).saveAs(`${out}/fixture-dpr${dpr}.json`);
    const decisions = JSON.parse(readFileSync(`${out}/fixture-dpr${dpr}.json`));
    const images = await page.locator('img').evaluateAll((nodes) => nodes.every((node) => node.complete && node.naturalWidth === 256));
    await page.screenshot({ path: `${out}/review-dpr${dpr}.png` });
    report.runs.push({ dpr, images, export: decisions.length === 1 && decisions[0].verdict === 'fix', errors });
    await context.close();
  } finally { await browser.close(); }
}
report.ok = report.runs.every((run) => run.images && run.export && !run.errors.length);
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); process.exitCode = report.ok ? 0 : 1;
