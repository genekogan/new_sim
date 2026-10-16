import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { boot, addSoul, follow, stop, ROOT } from './lib.mjs';
const { chromium } = createRequire(`${ROOT}/mars/viewer/package.json`)('@playwright/test');
const { chromeLease } = await import('<team>/ops/chrome-lease.mjs');
const out = '<team>/lanes/t3-mars-shots'; mkdirSync(out, { recursive: true });
const ctx = await boot({ port: 5865, template: '<team>/scratch/mars/mars-two-82.json', out: '<team>/scratch/mars/rot/shot-82' });
const release = await chromeLease('mars', { waitMs: 45 * 60000 }); let browser;
try {
  await addSoul(ctx); const snap = await ctx.api('/v1/world/snapshot', { as: 'public' });
  const r = await follow(ctx, 'walk:mimos/floor'); console.log('walk', r.ok, r.room?.room);
  const s = await follow(ctx, `sit:${snap.entities.find((e) => e.name === 'honey-sofa-13').id}`, { seated: true, params: { seconds: 900 } }); console.log('sit', s.ok);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
  const views = { 'campus-top': { eye: [10, 95, 10], at: [10, 0, -35], hide: 0 }, 'mimos-inside': { eye: [3, 7, -24], at: [3, 0, -31], hide: 1 } };
  for (const dpr of [1, 2]) for (const [n, v] of Object.entries(views)) {
    const c = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr }); await c.addInitScript(() => localStorage.setItem('sim.dev', 'admin'));
    const page = await c.newPage();
    const q = new URLSearchParams({ dev: '1', shot: '1', settle: '2500', eye: v.eye.join(','), at: v.at.join(','), ...(v.hide ? { hideRoofs: '1' } : {}), dust: 'clear' });
    await page.goto(`${ctx.base}?${q}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 120000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/rot82-${n}-dpr${dpr}.png`, timeout: 60000 }); console.log('shot', n, dpr); await c.close();
  }
} finally { await browser?.close(); release(); await stop(ctx); }
