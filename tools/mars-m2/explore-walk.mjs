#!/usr/bin/env node
// Real input in real Chrome (shared lease), as a stranger: open the world, open Explore, type a search, click a location,
// screenshot what the visitor then sees (dpr 1 and 2). Lists every Explore location label it found.
//   node tools/mars-m2/explore-walk.mjs --base <world URL> --out <dir> --pick "Inside: Mimos floor" [--pick ...] [--dpr 1,2]
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const picks = args.flatMap((a, i) => (a === '--pick' ? [args[i + 1]] : []));
const base = flag('base'), out = flag('out'), dprs = flag('dpr', '1,2').split(',').map(Number);
assert(base && out && picks.length, '--base --out --pick');
mkdirSync(out, { recursive: true });
const { chromium } = createRequire(`${ROOT}/mars/viewer/package.json`)('@playwright/test');
const { chromeLease } = await import('<team>/ops/chrome-lease.mjs');
const release = await chromeLease('n3-explore', { waitMs: 45 * 60000 });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
try {
  for (const dpr of dprs) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr })).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.locator('.explore-open').waitFor({ timeout: 240000 });
    await page.waitForTimeout(4000);
    for (const pick of picks) {
      await page.locator('.explore-open').click();
      await page.locator('.explore-search').fill('');
      if (dpr === dprs[0] && pick === picks[0]) console.log('locations:', JSON.stringify(await page.locator('.explore-locations button').allInnerTexts()));
      await page.locator('.explore-search').pressSequentially(pick.slice(0, 18), { delay: 30 });
      await page.locator('.explore-locations button', { hasText: pick }).first().click();
      await page.waitForTimeout(6000);
      const file = `${out}/explore-${slug(pick)}-dpr${dpr}.png`; await page.screenshot({ path: file }); console.log('shot', file);
    }
    if (errors.length) console.log('page errors', errors.slice(0, 4));
    await page.context().close();
  }
} finally { await browser.close(); release(); }
