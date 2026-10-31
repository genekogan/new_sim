// Screenshots of the summary page: node shoot.mjs <page.html> <outDir>  (viewport tops at 1280 light, 400 light/dark)
import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../../../../../mars/viewer/package.json', import.meta.url))('@playwright/test');
const [page, outDir] = process.argv.slice(2);
const b = await chromium.launch();
for (const [w, scheme] of [[1280, 'light'], [400, 'light'], [400, 'dark']]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme });
  const p = await ctx.newPage(); const errs = []; p.on('console', (m) => m.type() === 'error' && errs.push(m.text())); p.on('requestfailed', (r) => errs.push('failed ' + r.url()));
  await p.goto('file://' + page); await p.waitForLoadState('load');
  const sw = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth, [...document.images].filter((i) => !i.naturalWidth).length, document.body.scrollHeight]);
  await p.screenshot({ path: `${outDir}/summary-${w}-${scheme}.png`, fullPage: false });
  console.log(w, scheme, 'scrollW/clientW', sw[0], sw[1], 'broken imgs', sw[2], 'height', sw[3], errs.slice(0, 5));
  await ctx.close();
}
await b.close();
