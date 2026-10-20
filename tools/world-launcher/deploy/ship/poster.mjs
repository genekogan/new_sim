// poster.mjs <outDir> <url> [runs=3] : phone 390x844 dpr3 (CPU env = throttle). From navigation, css-scale screenshots for WIN ms (default 7000);
// records page errors, console warnings count, sim:* performance marks, and when .viewer-arrival-stage was ever seen.
import { createRequire } from 'node:module'; import { mkdirSync } from 'node:fs';
import { chromeLease } from '<team>/ops/chrome-lease.mjs';
const { chromium } = createRequire('<repo>/mars/viewer/package.json')('@playwright/test');
const [out, url, runs = '3'] = process.argv.slice(2); mkdirSync(out, { recursive: true });
const release = await chromeLease('t4-r6-poster'); let b;
try {
  b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
  for (let k = 1; k <= Number(runs); k++) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const p = await ctx.newPage(); if (process.env.CPU) await (await ctx.newCDPSession(p)).send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU) });
    const errs = []; let warns = 0; p.on('pageerror', e => errs.push(String(e).slice(0, 160))); p.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') warns++; });
    const t0 = Date.now(); await p.goto(url, { waitUntil: 'commit' });
    const shots = []; let card = 0;
    while (Date.now() - t0 < Number(process.env.WIN ?? 7000)) { const at = Date.now() - t0;
      try { await p.screenshot({ path: `${out}/r${k}-f-${String(at).padStart(5, '0')}.png`, scale: 'css', timeout: 3000 }); shots.push(at); } catch {}
      if (await p.evaluate(() => !!document.querySelector('.viewer-arrival-stage')).catch(() => false)) card++; }
    const marks = await p.evaluate(() => performance.getEntriesByType('mark').filter(m => m.name.startsWith('sim:')).map(m => `${m.name}@${Math.round(m.startTime)}`)).catch(() => []);
    console.log(JSON.stringify({ k, cardSeenShots: card, errs, warns, marks, shots: shots.length }));
    await ctx.close();
  }
} finally { await b?.close(); release(); }
