// stall.mjs <url> [runs=2] : phone 390x844 dpr3; after the card lifts, 40 s of rAF: per-run max frame gap, gaps >1 s, fps; plus a screenshot every 5 s (timed).
import { createRequire } from 'node:module';
import { chromeLease } from '<team>/ops/chrome-lease.mjs';
const { chromium } = createRequire('<repo>/mars/viewer/package.json')('@playwright/test');
const [url, runs = '2'] = process.argv.slice(2);
const release = await chromeLease('t4-r5-stall'); let b;
try {
  b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
  for (let k = 1; k <= Number(runs); k++) {
    const ctx = await b.newContext(process.env.DESK ? { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 } : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 150)));
    await p.addInitScript(() => { const g = (window.__gaps = []); let last = 0; const f = (t) => { if (last) g.push([Math.round(performance.now()), Math.round(t - last)]); last = t; requestAnimationFrame(f); }; requestAnimationFrame(f); });
    const t0 = Date.now(); await p.goto(url, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => !document.querySelector('.viewer-arrival-stage') && document.querySelector('.world-viewport canvas'), null, { timeout: 120000, polling: 50 });
    const card = Date.now() - t0; const shots = [];
    for (let i = 0; i < 8; i++) { await p.waitForTimeout(5000); const s = Date.now(); try { await p.screenshot({ path: `/tmp/r5-stall.png`, timeout: 30000 }); shots.push(Date.now() - s); } catch { shots.push('TIMEOUT'); } }
    const g = await p.evaluate(() => window.__gaps).catch(() => []); const after = g.filter(([t]) => t > card);
    const big = after.filter(([, d]) => d > 1000); const max = Math.max(0, ...after.map(([, d]) => d));
    console.log(JSON.stringify({ k, card, frames: after.length, maxGap: max, gapsOver1s: big.slice(0, 8), shotsMs: shots, errs }));
    await ctx.close();
  }
} finally { await b?.close(); await release(); }
