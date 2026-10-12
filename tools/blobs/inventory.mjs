#!/usr/bin/env node
// Lane BLOBS: what every page loads, who serves it, how it is cached, and how long arrival takes.
//   node tools/blobs/inventory.mjs <origin> <out.json> [--mbps N] [--pages /w/mars/,/worlds/w/mars/] [--warm]
// Per page (fresh browser context = cold cache): every response on the page's origin with status, wire bytes
// (CDP encodedDataLength), content-type/-encoding, cache-control, etag, last-modified, and which box answers it on
// sim.eden.art (/worlds* = eden2 launcher; /blobs/* and routed static = eden2 Caddy; everything else = laptop
// via the tunnel). Arrival = the old-world card is gone and the canvas is revealed (or network idle for other pages).
// --warm reloads the page once in the same context and records the second arrival (what caching buys a returning visitor).
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { findPlaywright } from '../god-skill/lib/look.mjs';
import { chromeLease } from '../god-skill/lib/chrome-lease.mjs';

const args = process.argv.slice(2);
const [origin, outArg] = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--'));
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const mbps = Number(opt('mbps', '0')), warm = args.includes('--warm');
const pages = opt('pages', '/,/w/eden/,/w/mars/,/w/littlemartians/,/worlds/,/worlds/w/eden/,/worlds/w/mars/,/worlds/w/littlemartians/,/worlds/w/helloworld2/').split(',');
const out = resolve(outArg); mkdirSync(dirname(out), { recursive: true });
const { chromium } = findPlaywright();
const host = new URL(origin).host;
const servedBy = (path) => path.startsWith('/worlds') ? 'eden2:launcher' : path.startsWith('/blobs/') ? 'eden2:caddy' : 'laptop';

async function visit(page, cdp, path, label) {
  const rows = new Map();
  const onResp = (e) => { const u = new URL(e.response.url); if (u.host !== host) return; const h = Object.fromEntries(Object.entries(e.response.headers).map(([k, v]) => [k.toLowerCase(), v]));
    rows.set(e.requestId, { path: u.pathname + u.search, status: e.response.status, type: h['content-type']?.split(';')[0], enc: h['content-encoding'] || '', cc: h['cache-control'] || '', etag: h.etag || '', lm: h['last-modified'] || '', fromCache: e.response.fromDiskCache || e.response.fromMemoryCache || false, t0: e.timestamp }); };
  const onDone = (e) => { const r = rows.get(e.requestId); if (r) { r.wire = e.encodedDataLength; r.doneS = +(e.timestamp - r.t0).toFixed(2); } };
  cdp.on('Network.responseReceived', onResp); cdp.on('Network.loadingFinished', onDone);
  const t0 = Date.now(); let inflight = 0, idleSince = Date.now();
  const inc = () => { inflight++; }, dec = () => { inflight = Math.max(0, inflight - 1); idleSince = Date.now(); };
  page.on('request', inc); page.on('requestfinished', dec); page.on('requestfailed', dec);
  if (label === 'warm') await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  else await page.goto(origin + path, { waitUntil: 'domcontentloaded', timeout: 180000 });
  let how = 'timeout';
  for (;;) {
    const s = await page.evaluate(() => ({ revealed: document.querySelector('.world-canvas-host')?.getAttribute('data-initial-revealed') ?? null, card: !!document.querySelector('.viewer-arrival') })).catch(() => null);
    if (s && s.revealed === 'true' && !s.card) { how = 'revealed'; break; }
    if (s && s.revealed === null && !s.card && inflight === 0 && Date.now() - idleSince > 2500 && Date.now() - t0 > 3000) { how = 'idle'; break; }
    if (Date.now() - t0 > 240000) break;
    await page.waitForTimeout(250);
  }
  const arrivalMs = how === 'idle' ? idleSince - t0 : Date.now() - t0;
  await page.waitForTimeout(1500);
  cdp.off('Network.responseReceived', onResp); cdp.off('Network.loadingFinished', onDone);
  page.off('request', inc); page.off('requestfinished', dec); page.off('requestfailed', dec);
  const list = [...rows.values()].map((r) => ({ ...r, by: servedBy(r.path.split('?')[0]), t0: undefined })).sort((a, b) => (b.wire || 0) - (a.wire || 0));
  return { path, label, mbps, arrivalMs, how, wireBytes: list.reduce((n, r) => n + (r.wire || 0), 0), laptopBytes: list.filter((r) => r.by === 'laptop').reduce((n, r) => n + (r.wire || 0), 0), requests: list };
}

const release = await chromeLease('blobs-inventory');
const report = { origin, mbps, at: new Date().toISOString(), pages: [] };
try {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
  try {
    for (const path of pages) {
      const ctx = await browser.newContext({ viewport: { width: 1352, height: 780 } }); const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable');
      if (mbps > 0) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: mbps * 125000, uploadThroughput: mbps * 125000 });
      const runs = [await visit(page, cdp, path, 'cold')]; if (warm) runs.push(await visit(page, cdp, path, 'warm'));
      for (const r of runs) { report.pages.push(r); console.log(JSON.stringify({ path, label: r.label, mbps, arrivalMs: r.arrivalMs, how: r.how, MB: +(r.wireBytes / 1e6).toFixed(1), laptopMB: +(r.laptopBytes / 1e6).toFixed(1), n: r.requests.length })); }
      await ctx.close();
    }
  } finally { await browser.close(); }
} finally { release(); }
writeFileSync(out, JSON.stringify(report, null, 1));
