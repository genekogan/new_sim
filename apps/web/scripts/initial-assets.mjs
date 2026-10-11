#!/usr/bin/env node
// Release-time manifest of what an old world downloads while its arrival card is up, with byte sizes, so the
// loading bar knows the total before the first byte (apps/web/src/asset-bytes.ts reads src/initial-assets.json).
//
//   node apps/web/scripts/initial-assets.mjs <origin> [--worlds eden,mars,littlemartians] [--out <file>]
//
// <origin> serves the old worlds at /w/<key> (production https://sim.eden.art, or a local candidate server). Read
// only: it opens each world signed out in real Chrome (cold cache), records the asset GETs made until the arrival
// card is done, then measures each file's decoded size with a plain GET. New worlds need no manifest: their snapshot
// carries assetBytes from the server's asset index.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const origin = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))?.replace(/\/$/, '');
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
if (!origin) { console.error('usage: initial-assets.mjs <origin> [--worlds eden,mars,littlemartians] [--out file]'); process.exit(2); }
const worlds = opt('worlds', 'eden,mars,littlemartians').split(',');
const out = resolve(opt('out', resolve(root, 'apps/web/src/initial-assets.json')));
const ASSET = /\.(glb|gltf|bin|ktx2|wasm|drc|hdr|exr|png|jpe?g|webp)$/i;
const { chromium } = createRequire(resolve(root, 'mars/viewer/package.json'))('@playwright/test');
const { chromeLease } = await import(resolve(root, 'tools/god-skill/lib/chrome-lease.mjs'));

const manifest = { contract: 'initial-assets/1', origin, at: new Date().toISOString(), worlds: {} };
const release = await chromeLease('initial-assets');
try {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
  for (const key of worlds) {
    const ctx = await browser.newContext({ viewport: { width: 1352, height: 780 } });
    const page = await ctx.newPage(); const urls = new Set();
    page.on('request', (r) => { if (r.method() === 'GET') { const u = new URL(r.url()); if (u.origin === new URL(origin).origin && ASSET.test(u.pathname)) urls.add(u.pathname + u.search); } });
    await page.goto(`${origin}/w/${key}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    const t0 = Date.now(); let seen = false;
    for (;;) {
      const s = await page.evaluate(() => { const c = document.querySelector('.viewer-arrival'); return c ? c.getAttribute('data-done') : null; }).catch(() => null);
      if (s === 'false') seen = true;
      if (seen && s !== 'false') break;
      if (Date.now() - t0 > 600_000) throw Error(`${key}: the arrival card did not finish in 10 min`);
      await page.waitForTimeout(250);
    }
    await ctx.close();
    const sizes = {};
    for (const u of [...urls].sort()) {
      const r = await fetch(origin + u); if (!r.ok) continue;
      const bytes = (await r.arrayBuffer()).byteLength; if (bytes > 0) sizes[u.split('?')[0]] = bytes;
    }
    manifest.worlds[key] = sizes;
    console.log(`${key}: ${Object.keys(sizes).length} files, ${(Object.values(sizes).reduce((a, b) => a + b, 0) / 1048576).toFixed(1)} MB`);
  }
  await browser.close();
} finally { release(); }
writeFileSync(out, JSON.stringify(manifest, null, 1) + '\n');
console.log('wrote', out);
