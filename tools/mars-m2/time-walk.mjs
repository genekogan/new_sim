#!/usr/bin/env node
// Real input as a stranger: open the world, click the world time in the status chip, move the time-of-day slider with the
// keyboard to each hour asked, screenshot (dpr 1 and 2), then "Back to now".
//   node tools/mars-m2/time-walk.mjs --base <world URL> --out <dir> [--hours 19,22] [--eye x,y,z --at x,y,z] [--dpr 1,2]
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const base = flag('base'), out = flag('out'), dprs = flag('dpr', '1,2').split(',').map(Number), hours = flag('hours', '19,22').split(',').map(Number);
assert(base && out); mkdirSync(out, { recursive: true });
const { chromium } = createRequire(`${ROOT}/mars/viewer/package.json`)('@playwright/test');
const { chromeLease } = await import(process.env.CHROME_LEASE_MODULE ?? '../god-skill/lib/chrome-lease.mjs');
const release = await chromeLease('n3-time', { waitMs: 45 * 60000 });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
try {
  for (const dpr of dprs) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr })).newPage();
    const q = flag('eye') ? `?eye=${flag('eye')}&at=${flag('at')}` : '';
    await page.goto(base + q, { waitUntil: 'domcontentloaded', timeout: 180000 });
    const t = page.locator('.world-time-button'); await t.waitFor({ timeout: 240000 }); await page.waitForTimeout(5000);
    await page.screenshot({ path: `${out}/time-now-dpr${dpr}.png` });
    await t.click();
    const slider = page.locator('.time-preview input[type=range]');
    for (const h of hours) {
      await slider.focus(); await page.keyboard.press('Home');
      for (let i = 0; i < h * 4; i++) await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(2500);
      console.log('chip', await t.innerText());
      await page.screenshot({ path: `${out}/time-${h}-dpr${dpr}.png` }); console.log('shot', h, dpr);
    }
    await page.locator('.time-preview button', { hasText: 'Back to now' }).click(); await page.waitForTimeout(1500);
    console.log('after back', await t.innerText());
    await page.context().close();
  }
} finally { await browser.close(); release(); }
