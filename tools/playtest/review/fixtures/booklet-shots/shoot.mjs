// Screenshot booklet pages: PLAYWRIGHT_BROWSERS_PATH=$HOME/Library/Caches/ms-playwright node shoot.mjs <booklet-dir> <out-dir> index.html <run>.html[#anchor] ...
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(new URL('../../../../../mars/viewer/package.json', import.meta.url))('@playwright/test');
const [dir, out, ...pages] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const b = await chromium.launch();
for (const w of [1280, 400]) for (const spec of pages) { const [p, anchor] = spec.split('#');
  const pg = await b.newPage({ viewport: { width: w, height: 900 } });
  const errs = []; pg.on('requestfailed', (r) => errs.push(r.url()));
  await pg.goto('file://' + dir + '/' + p); await pg.waitForLoadState('load'); if (anchor) await pg.evaluate((a) => document.getElementById(a).scrollIntoView(), anchor); await pg.waitForTimeout(400);
  const m = await pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, broken: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute('src')).slice(0, 5), imgs: document.images.length }));
  const name = `${p.replace(/\.html$/, '').replace(/^\d{8}-\d{6}-/, '')}${anchor ? '-' + anchor : ''}-${w}.png`;
  await pg.screenshot({ path: `${out}/${name}`, fullPage: p === 'index.html' });
  console.log(name, JSON.stringify(m), errs.length ? 'failed:' + errs.slice(0, 3) : '');
  await pg.close();
}
await b.close();
