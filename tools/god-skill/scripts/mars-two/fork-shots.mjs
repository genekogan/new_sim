#!/usr/bin/env node
// MARSLAND-FORK: same-camera screenshots of the old-world Mars fork page (/worlds/w/mars), real Chrome (GPU, Chrome lease).
//   node tools/god-skill/scripts/mars-two/fork-shots.mjs <page-url> <out-dir> [--dpr 1] [--tag fork] [--only re] [--raw] [--settle 9000]
// Views are given in the mars-two BUILD frame (x = E + 48, z = −N of Gene's Mimos plan; the frame of FURN's pairs.mjs and of
// sim.mars.college's V3 via toV3) and converted to the fork's frame (V3 + [40, 0.16, −30], the campus backdrop's `at`).
// The camera is forced at render time through three.js's __THREE_DEVTOOLS__ 'observe' hook (no app hook; FORKFIX's method).
// --raw blocks the fork's corrected campus (mars-fork.ts) so the page falls back to the raw campus (the "before").
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromeLease } from '<worktrees>/root-world-engine/tools/god-skill/lib/chrome-lease.mjs';
const { chromium } = createRequire('<worktrees>/root-world-engine/mars/viewer/package.json')('@playwright/test');
const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args.splice(i, 2)[1] : d; };
const bool = (k) => { const i = args.indexOf(`--${k}`); if (i >= 0) { args.splice(i, 1); return true; } return false; };
const dayFrom = Number(flag('day-from', 9)), dayTo = Number(flag('day-to', 15)), dayWaitMin = Number(flag('day-wait', 0)), dpr = Number(flag('dpr', 1)), tag = flag('tag', 'fork'), only = flag('only', null), settle = Number(flag('settle', 9000)), raw = bool('raw');
const [url, out] = args; mkdirSync(out, { recursive: true });
const O = [2.05645, -8.92635], NO = [0.4264952019559668, -0.9044898245467106], EA = [0.9044898245467106, 0.4264952019559668];
/** build frame → fork frame (y unchanged: V3 y = y − 0.16, the backdrop lifts it by 0.16). */
export const toFork = ([x, y, z]) => { const N = -z, E = x - 48; return [O[0] + 40 + N * NO[0] + E * EA[0], y, O[1] - 30 + N * NO[1] + E * EA[1]]; };
const r = (v) => v.map((q) => Math.round(q * 100) / 100);
// true south of the campus is the build frame's +x (BEARING 90: the plan's north is true east, its east true south)
export const VIEWS = {
  campus: { eye: [70, 34, 40], at: [44, 0, 2] },
  'chiba-south': { eye: [102, 14, 14], at: [52, 3, 12] },
  'chiba-south-low': { eye: [80, 2.2, 20], at: [52, 4, 12] },
  'mimos-kitchen-aerial': { eye: [56, 22, -18], at: [44, 0, -2] },
  'mimos-main': { eye: [46.0, 2.3, 0.4], at: [45.5, 0.9, -4.5] },
  mimos: { eye: [50.5, 1.06, 0.4], at: [47.15, 1.53, 0] },   // sim.mars.college's own Mimos room view (V3 → build)
  'mimos-floor-in': { eye: [47.6, 1.9, -0.2], at: [50.5, 0.6, 0.6] },
  'kitchen-in': { eye: [38.5, 2.4, 1.2], at: [38.3, 1.0, -5] },
  'diner-in': { eye: [41.2, 2.2, -5.6], at: [43, 0.9, 1.0] },
  'showers-out': { eye: [56, 6, -2], at: [50, 0.5, -8] },
  // layer 3: the surroundings (compass in the build frame: N = −x, E = −z, S = +x, W = +z)
  'look-south-sea': { eye: [70, 30, 10], at: [400, 0, 10] },
  'look-north-mountains': { eye: [20, 25, 10], at: [-400, 40, 10] },
  'look-west-tyres': { eye: [60, 45, -20], at: [-60, 0, 170] },
  'look-east-wash': { eye: [60, 40, 0], at: [60, 0, -500] },
  'drone-high': { eye: [260, 160, 120], at: [40, 0, 0] },
};
const names = Object.keys(VIEWS).filter((n) => (only ? new RegExp(only).test(n) : true));
const probe = () => {
  const st = { main: null, pose: null, errors: [] }; globalThis.__fk = st;
  const dev = new EventTarget(); globalThis.__THREE_DEVTOOLS__ = dev;
  dev.addEventListener('observe', (e) => {
    const o = e.detail;
    if (o && typeof o.render === 'function' && o.domElement) {
      const orig = o.render;
      o.render = function (scene, camera) {
        if (camera?.isPerspectiveCamera && this.domElement?.isConnected && this.domElement.clientWidth > 200) {
          st.main = { scene, camera };
          if (st.pose) { camera.position.fromArray(st.pose.p); camera.up.set(0, 1, 0); camera.lookAt(st.pose.t[0], st.pose.t[1], st.pose.t[2]); camera.updateMatrixWorld(true); }
        }
        return orig.call(this, scene, camera);
      };
    }
  });
};
const release = await chromeLease('marsland-fork');
const report = { url, dpr, raw, views: {} };
try {
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 1352, height: 780 }, deviceScaleFactor: dpr });
  if (raw) await ctx.route(/campus-owner-|\/blobs\/assets\/70\//, (route) => route.fulfill({ status: 404, body: '' }));
  const page = await ctx.newPage();
  const errs = [], fetched = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
  page.on('response', (res) => { if (/\.glb/.test(res.url())) fetched.push(`${res.status()} ${new URL(res.url()).pathname}`); });
  await page.addInitScript(probe);
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => document.querySelector('.world-canvas-host')?.getAttribute('data-initial-revealed') === 'true', null, { timeout: 90000 }).catch(() => {});
  report.revealedMs = Date.now() - t0;
  await page.waitForTimeout(settle);
  // the world clock runs a day an hour (dayTicks 72000): --day-wait N waits up to N minutes for a daylight hour
  const hourNow = () => page.evaluate(() => { const m = document.querySelector('header')?.textContent.match(/(\d+):(\d+)\s*([ap])m/); return m ? (Number(m[1]) % 12) + (m[3] === 'p' ? 12 : 0) + Number(m[2]) / 60 : null; });
  for (let t = Date.now(); dayWaitMin > 0 && Date.now() - t < dayWaitMin * 60000;) { const h = await hourNow(); if (h !== null && h >= dayFrom && h < dayTo) break; await page.waitForTimeout(20000); }
  report.clockHour = await hourNow();
  await page.addStyleTag({ content: 'header, .viewer-arrival, aside, nav, [class*="toast"] { visibility: hidden !important; }' });
  for (const n of names) {
    const v = VIEWS[n], eye = r(toFork(v.eye)), at = r(toFork(v.at));
    await page.evaluate(([p, t]) => { globalThis.__fk.pose = { p, t }; }, [eye, at]);
    await page.waitForTimeout(2500);
    const file = `${out}/${n}-${tag}${dpr !== 1 ? `@${dpr}x` : ''}.png`;
    await page.screenshot({ path: file });
    report.views[n] = { eye, at, file }; console.log(n, eye, at);
  }
  report.glb = fetched; report.pageErrors = errs;
  report.scene = await page.evaluate(() => { const m = globalThis.__fk.main; if (!m) return null; const g = {}; m.scene.traverse((o) => { if (o.parent === m.scene) g[o.name || o.type] = (g[o.name || o.type] ?? 0) + 1; }); return { top: g, bg: m.scene.background?.getHexString?.() ?? null, fog: m.scene.fog ? { c: m.scene.fog.color.getHexString(), d: m.scene.fog.density ?? null } : null, far: m.camera.far }; });
  await b.close();
} finally { release(); }
writeFileSync(`${out}/report-${tag}${dpr !== 1 ? `@${dpr}x` : ''}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ revealedMs: report.revealedMs, glb: report.glb, pageErrors: report.pageErrors, scene: report.scene }));
