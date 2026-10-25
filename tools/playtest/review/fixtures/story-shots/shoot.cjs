// node shoot.cjs <html> <outPrefix> : viewport screenshots at 1280 (light) and 400 (dark) px — top, and the
// timeline at 40% depth — plus horizontal-overflow and console-error checks.
const { chromium } = require(require('module').createRequire('<repo>/mars/viewer/package.json').resolve('@playwright/test'));
(async () => {
  const [html, prefix] = process.argv.slice(2);
  const b = await chromium.launch();
  for (const [w, scheme] of [[1280, 'light'], [400, 'dark']]) {
    const p = await b.newPage({ viewport: { width: w, height: 1000 }, colorScheme: scheme });
    const errs = []; p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    await p.goto('file://' + html); await p.waitForTimeout(800);
    const info = await p.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, h: document.documentElement.scrollHeight, film: `${document.querySelectorAll('.st-film img[src]').length}/${document.querySelectorAll('.st-film img').length}` }));
    await p.evaluate(() => document.getElementById('story')?.scrollIntoView());
    await p.screenshot({ path: `${prefix}-${w}-top.png`, timeout: 60000 });
    await p.evaluate(() => { const ms = document.querySelectorAll('.st-m'); ms[Math.floor(ms.length * 0.4)]?.scrollIntoView(); });
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${prefix}-${w}-mid.png`, timeout: 60000 });
    console.log(JSON.stringify({ w, ...info, errs }));
    await p.close();
  }
  await b.close();
})();
