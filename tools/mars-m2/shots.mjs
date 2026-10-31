#!/usr/bin/env node
// Same-camera stills of a local world in real Chrome (shared lease, Metal GPU), dpr 1 and 2 (lane M, 2026-10-17).
// Views: JSON list of {name, eye:[x,y,z], at:[x,y,z], hour?:"HH:MM", hideRoofs?:1, frame?:{parent:{p,r}}}. When `frame`
// is given, eye/at are in that parent's local frame (e.g. a building's) and are turned into world coordinates here.
//   node tools/mars-m2/shots.mjs --base <world URL> --views <json> --out <dir> [--dpr 1,2] [--tag x] [--size 1280x800]
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const base = flag('base'), out = flag('out'), tag = flag('tag', ''), dprs = flag('dpr', '1,2').split(',').map(Number);
const [W, H] = flag('size', '1280x800').split('x').map(Number);
assert(base && out && flag('views'), '--base --views --out');
const views = JSON.parse(readFileSync(flag('views'), 'utf8'));
mkdirSync(out, { recursive: true });
/** parent-local point -> world (three.js yaw about +y) */
export const toWorld = (pt, { p, r }) => { const c = Math.cos(r), s = Math.sin(r); return [p[0] + pt[0] * c + pt[2] * s, (p.length === 3 ? p[1] : 0) + pt[1], p[p.length - 1] - pt[0] * s + pt[2] * c]; };
const { chromium } = createRequire(`${ROOT}/mars/viewer/package.json`)('@playwright/test');
const { chromeLease } = await import(process.env.CHROME_LEASE_MODULE ?? '../god-skill/lib/chrome-lease.mjs');
const release = await chromeLease('n3-mars-lm', { waitMs: 45 * 60000 });
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
  for (const dpr of dprs) {
    const c = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: dpr });
    await c.addInitScript(() => localStorage.setItem('sim.dev', 'admin'));
    const page = await c.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
    for (const v of views) {
      const eye = v.frame ? toWorld(v.eye, v.frame) : v.eye, at = v.frame ? toWorld(v.at, v.frame) : v.at;
      const q = new URLSearchParams({ dev: '1', shot: '1', settle: String(v.settle ?? 2500), eye: eye.map((n) => n.toFixed(3)).join(','), at: at.map((n) => n.toFixed(3)).join(','), dust: 'clear', ...(v.hour ? { hour: v.hour } : {}), ...(v.hideRoofs ? { hideRoofs: '1' } : {}) });
      for (let i = 0; ; i++) {
        await page.goto(`${base}?${q}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
        let ready = false; for (let k = 0; k < 60 && !ready; k++) { await page.waitForTimeout(3000); ready = await page.evaluate(() => window.__shotReady === true); }
        if (ready) break; assert(i < 2, 'viewer never got ready');
      }
      await page.waitForTimeout(v.wait ?? 1500);
      const file = `${out}/${v.name}${tag ? '-' + tag : ''}-dpr${dpr}.png`;
      await page.screenshot({ path: file, timeout: 60000 }); console.log('shot', file);
    }
    if (errors.length) console.log('page errors', dpr, errors.slice(0, 5));
    await c.close();
  }
} finally { await browser?.close(); release(); }
