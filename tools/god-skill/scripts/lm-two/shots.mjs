#!/usr/bin/env node
// Stills of a littlemartians-two world (lane LM): real Chrome on the GPU (Metal), under the machine-wide Chrome lease.
//   node tools/god-skill/scripts/lm-two/shots.mjs <world base url> <out dir> [--dpr 1|2] [--only name,name]
// Views are fixed eye/at pairs chosen to sit beside lm/map's proof renders (team/proofs/littlemartians-map/19, 21)
// and the Arium tour stills.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromeLease } from '../../lib/chrome-lease.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const [base, outDir, ...rest] = process.argv.slice(2);
const flag = (k, d) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : d; };
const dpr = Number(flag('dpr', 1)), only = flag('only') ? new Set(flag('only').split(',')) : null;
export const VIEWS = [
  { name: 'overview', eye: [0, 95, 125], at: [0, 0, 0] },                       // like proofs/19 final-overview
  { name: 'overview-expanded', eye: [0, 150, 300], at: [0, 0, 110] },          // like proofs/21 expanded-overview
  { name: 'commons-arium-floor', eye: [0, 2.2, 22], at: [0, 6, -30] },         // like the Arium tour: chalk/black floor, Minarete & beacon
  { name: 'madmaraca', eye: [-30, 9, 14], at: [-45, 10, -20] },
  { name: 'minarete-arch', eye: [42, 3, 2], at: [42, 6, -20] },
  { name: 'celadon-beacon', eye: [12, 6, -8], at: [0, 12, -37] },
  { name: 'grotto', eye: [45, 7, 22], at: [45, 4, 50] },
  { name: 'grotto-inside', eye: [45, 2.2, 41], at: [45, 3, 56] },
  { name: 'eden-garden', eye: [-30, 8, 66], at: [-45, 1, 46] },
  { name: 'overlook', eye: [0, 18, 40], at: [0, 8, 70] },
  { name: 'scan-courts', eye: [0, 30, 70], at: [0, 0, 130] },
  { name: 'scan-courts-close', eye: [-20, 5, 100], at: [-36, 2, 84] },
];
const chromium = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test').chromium;
mkdirSync(outDir, { recursive: true });
const release = await chromeLease('lane-lm-two shots');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr });
  await ctx.addInitScript(() => { localStorage.setItem('sim.dev', 'admin'); });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  for (const v of VIEWS.filter((x) => !only || only.has(x.name))) {
    const q = new URLSearchParams({ dev: '1', shot: '1', settle: String(v.wait ?? 6000), eye: v.eye.join(','), at: v.at.join(',') });
    const t0 = Date.now();
    await page.goto(`${base}?${q}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 240_000 }).catch(() => console.log(`  ${v.name}: not ready in 240 s; taking it anyway`));
    await page.waitForTimeout(2500);
    await page.screenshot({ path: resolve(outDir, `${v.name}${dpr === 2 ? '@2x' : ''}.png`) });
    console.log(`📷 ${v.name} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  if (errors.length) console.log('page errors:', errors);
} finally { await browser.close().catch(() => { }); release(); }
