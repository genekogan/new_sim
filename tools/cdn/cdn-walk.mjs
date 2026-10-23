#!/usr/bin/env node
// Runtime CDN check for the release owner's walk (CDN2, 2026-10-20; based on R10's 3.50 cdnwalk). release.sh only proves
// the build contains the CDN code; 3.50 shipped with the GLB download worker bypassing it. This loads real pages in real
// Chrome (desktop + phone, dpr 1 and 2, the asset worker ON as visitors have it) and FAILS (exit 1) when:
//   - a GLB/texture the shipped manifest maps is answered by the origin (status 200) instead of assets.eden.art,
//   - an assets.eden.art request is not 200, an assets/br/ object did not arrive Content-Encoding br (CDN3),
//     or a page loaded listed assets but none from assets.eden.art,
//   - the page's asset worker delivered GLBs but none from the CDN (window.__assetWorker.cdn === 0),
//   - CDN4: a god upload (/worlds/w/<slug>/assets/<sha>.glb, not in the manifest) came from the origin with no request to
//     the pull-through Worker (assets.eden.art/w/<slug>/assets/<sha>.glb) for that sha first. Worker requests are counted
//     per page as cdnUploads, split by the Worker's x-eden-cdn answer (miss = pulled from origin, hit = R2, edge = cache).
//   - CACHE (2026-10-22): any same-origin immutable response (hashed bundle/part, or release-stable /modular, /mars-assets,
//     /world-assets, wasm, fonts) without a long-lived public Cache-Control, or one Cloudflare answers DYNAMIC/BYPASS
//     (rule and classes: origin-cache.mjs). A first-request MISS after a release passes. Counted per page as originImmutable.
// Read-only public page loads; no credentials.
//   node tools/cdn/cdn-walk.mjs <outDir> <url>... [--manifest apps/web/src/cdn-manifest.json] [--wait 25000] [--devices desktop1,phone2]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPlaywright } from '../god-skill/lib/look.mjs';
import { chromeLease } from '../god-skill/lib/chrome-lease.mjs';
import { manifestAsset, readCdnManifest } from '../../apps/web/src/cdn-assets.ts';
import { originCacheClass, originCacheProblem } from './origin-cache.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const manifestFile = resolve(opt('manifest', resolve(root, 'apps/web/src/cdn-manifest.json')));
const WAIT = Number(opt('wait', 25000));
const DEVICES = opt('devices', 'desktop1,desktop2,phone1,phone2').split(',');
const [out, ...urls] = args;
if (!out || !urls.length) throw Error('usage: cdn-walk.mjs <outDir> <url>... [--manifest m.json] [--wait ms] [--devices desktop1,phone2]');
const manifest = readCdnManifest(JSON.parse(readFileSync(manifestFile, 'utf8')));
const ASSET = /\.(glb|bin|ktx2|png|jpe?g|webp|avif|hdr|exr)$/i;
mkdirSync(out, { recursive: true });

const { chromium } = findPlaywright();
const release = await chromeLease('cdn-walk');
const rows = []; let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
  for (const url of urls) for (const dev of DEVICES) {
    const phone = dev.startsWith('phone'), dpr = Number(dev.slice(-1));
    const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr });
    const page = await ctx.newPage(), reqs = [], errors = [], originCache = [];
    const site = new URL(url).host;
    page.on('response', (r) => {   // CACHE: every same-origin immutable response, any type (bundles, parts, wasm, json)
      const u = new URL(r.url()); if (u.host !== site || !originCacheClass(u.pathname)) return;
      const problem = originCacheProblem({ path: u.pathname + u.search, status: r.status(), headers: r.headers() });
      originCache.push({ path: u.pathname + u.search, status: r.status(), cf: r.headers()['cf-cache-status'] ?? null, ...(problem ? { problem } : {}) });
    });
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
    page.on('response', (r) => {   // includes the dedicated asset worker's fetches
      const u = new URL(r.url()); if (!ASSET.test(u.pathname)) return;
      const cdn = u.host === 'assets.eden.art';
      const listed = cdn || !!manifestAsset(manifest, r.url(), page.url() || url), h = r.headers();
      const upload = cdn ? /^\/w\/[a-z][a-z0-9-]{0,31}\/assets\/([0-9a-f]{64})\./.exec(u.pathname)?.[1] : !listed ? /^\/worlds\/w\/[a-z][a-z0-9-]{0,31}\/assets\/([0-9a-f]{64})\.glb$/.exec(u.pathname)?.[1] : undefined;
      reqs.push({ host: u.host, path: u.pathname + u.search, status: r.status(), encoding: h['content-encoding'] ?? null, listed, ...(upload ? { upload, worker: h['x-eden-cdn'] ?? null } : {}) });
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => errors.push('goto ' + e.message.slice(0, 120)));
    await page.waitForTimeout(WAIT);
    const worker = await page.evaluate(() => globalThis.__assetWorker ?? null).catch(() => null);
    const tag = `${new URL(url).pathname.replace(/\W+/g, '-')}${dev}`;
    await page.screenshot({ path: `${out}/${tag}.png` }).catch(() => {});
    const cdn = reqs.filter((r) => r.host === 'assets.eden.art');
    const originListed = reqs.filter((r) => r.host !== 'assets.eden.art' && r.listed && r.status === 200).map((r) => r.path);
    const cdnUploads = cdn.filter((r) => r.upload), originUploads = reqs.filter((r) => r.host !== 'assets.eden.art' && r.upload && r.status === 200);
    const tried = new Set(cdnUploads.map((r) => r.upload));
    const problems = [
      ...originListed.map((p) => `origin served a CDN-listed asset: ${p}`),
      ...cdn.filter((r) => r.status !== 200).map((r) => `CDN ${r.status}: ${r.path}`),
      // CDN3: a precompressed object reaches Chrome (br over HTTPS) as its stored q11 bytes, never re-encoded.
      ...cdn.filter((r) => r.status === 200 && r.path.startsWith('/assets/br/') && r.encoding !== 'br').map((r) => `CDN br object arrived ${r.encoding ?? 'identity'}: ${r.path}`),
      ...(reqs.some((r) => r.listed) && !cdn.length ? ['listed assets loaded, none from assets.eden.art'] : []),
      ...(worker && worker.delivered > 0 && !worker.cdn && reqs.some((r) => r.listed && /\.glb$/.test(r.path)) ? [`asset worker delivered ${worker.delivered} GLBs, 0 from the CDN`] : []),
      ...originUploads.filter((r) => !tried.has(r.upload)).map((r) => `god upload from the origin without a CDN attempt: ${r.path}`),
      ...[...new Set(originCache.filter((r) => r.problem).map((r) => r.problem))],
    ];
    const row = { url, dev, total: reqs.length, cdn: cdn.length, cdnBr: cdn.filter((r) => r.encoding === 'br' && r.path.startsWith('/assets/br/')).length,
      cdnUploads: cdnUploads.length, cdnUploadStates: Object.fromEntries(['miss', 'hit', 'edge'].map((k) => [k, cdnUploads.filter((r) => r.worker === k).length])), originUploads: originUploads.length, originImmutable: originCache.length, originCacheCf: Object.fromEntries([...new Set(originCache.map((r) => r.cf ?? '-'))].map((k) => [k, originCache.filter((r) => (r.cf ?? '-') === k).length])), originListed, worker, problems, errors, pass: problems.length === 0, reqs };
    rows.push(row); console.log(JSON.stringify({ ...row, reqs: undefined, originListed: originListed.slice(0, 5) }));
    await ctx.close();
  }
} finally { await browser?.close(); release(); writeFileSync(`${out}/cdn-walk.json`, JSON.stringify(rows, null, 1)); }
const failed = rows.filter((r) => !r.pass);
console.log(JSON.stringify({ result: failed.length ? 'FAIL' : 'PASS', pages: rows.length, failed: failed.length, out: `${out}/cdn-walk.json` }));
if (failed.length) process.exitCode = 1;
