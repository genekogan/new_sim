#!/usr/bin/env node
// Local-only proof. `serve` owns a fresh fake world + CDN stand-in; `check` takes the cdn Chrome lease.
// Build first with SIM_ASSETS_CDN_ENABLED=1 SIM_ASSETS_CDN_ORIGIN=http://127.0.0.1:5811.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateSync, crc32 } from 'node:zlib';
import { startWorld } from '../god-skill/dev-world.mjs';
import { findPlaywright } from '../god-skill/lib/look.mjs';
import { chromeLease } from '../god-skill/lib/chrome-lease.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2), mode = args[0];
const opt = (name, fallback) => { const i = args.indexOf('--' + name); return i < 0 ? fallback : args[i + 1]; };
const out = resolve(opt('out', '<team>/scratch/cdn/browser-root'));
const prefix = opt('prefix', '');
assert.ok(['', '/worlds'].includes(prefix));
const index = JSON.parse(readFileSync(resolve(root, 'worlds/core-assets/index.json'), 'utf8'));
const [sha, record] = Object.entries(index.assets).find(([, a]) => a.name === 'cow-pack');
const bytes = readFileSync(resolve(root, record.path));
assert.equal(createHash('sha256').update(bytes).digest('hex'), sha);
const assetPath = `${prefix}/w/cdn-proof/assets/${sha}.glb`;
const key = `assets/${sha.slice(0, 2)}/${sha}.glb`;
// Z2 (2026-10-20): a far cow loads its lod1 first (make.lod1), by its own sha; the proof accepts and serves either.
const lods = JSON.parse(readFileSync(resolve(root, 'worlds/core-assets/lods.index.json'), 'utf8')).assets;
const [lodSha, lodRecord] = Object.entries(lods).find(([, a]) => a.source?.includes(sha)) ?? [];
const lodBytes = lodRecord ? readFileSync(resolve(root, lodRecord.path)) : null;
const lodKey = lodSha ? `assets/${lodSha.slice(0, 2)}/${lodSha}.glb` : null, lodPath = lodSha ? `${prefix}/w/cdn-proof/assets/${lodSha}.glb` : null;
// Original checkerboard texture: no external asset or licence dependency.
const chunk = (type, data) => { const tag = Buffer.from(type); const size = Buffer.alloc(4); size.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tag, data]))); return Buffer.concat([size, tag, data, crc]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 2;
const pixels = Buffer.alloc(8 * 25);
for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) pixels.set((x + y) % 2 ? [240, 130, 30] : [30, 190, 210], y * 25 + 1 + x * 3);
const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
const pngSha = createHash('sha256').update(png).digest('hex'), pngPath = prefix + '/assets/cdn-proof.png', pngKey = `assets/${pngSha.slice(0, 2)}/${pngSha}.png`;
const origin = 'http://127.0.0.1:5812';
mkdirSync(out, { recursive: true });

if (mode === 'serve') {
  const webDir = resolve(opt('web-dir', '<team>/scratch/cdn/web-on'));
  const manifest = JSON.parse(readFileSync(resolve(opt('manifest', '<team>/scratch/cdn/cdn-manifest.json')), 'utf8'));
  assert.deepEqual(manifest.assets[`${prefix}/assets/${sha}.glb`], { key, sha256: sha, bytes: bytes.length, licence: 'CC0-1.0' }, 'proof must use the actual inventory publication alias');
  manifest.assets[pngPath] = { key: pngKey, sha256: pngSha, bytes: png.length, licence: 'own-work' };
  // Amend only the disposable test build's emitted manifest with the synthetic PNG entry.
  // Production uses the untouched manifest emitted by Vite from the reviewed source JSON.
  const emitted = readdirSync(resolve(webDir, 'assets')).filter(name => /^cdn-manifest-.*\.json$/.test(name));
  assert.equal(emitted.length, 1, 'use a fresh build output with one Vite-emitted publication manifest');
  writeFileSync(resolve(webDir, 'assets', emitted[0]), JSON.stringify(manifest));
  writeFileSync(resolve(webDir, 'assets/cdn-proof.png'), png);
  const genesis = resolve(out, 'genesis.json');
  writeFileSync(genesis, JSON.stringify({ schema: 'genesis/1', name: 'CDN local proof', constants: { extent: 300, ground: 'land' }, state: { constitution: 'Local CDN transport proof. Fake minds only.' }, batches: [{ note: 'a CC0 cow beside a cottage', ops: [
    { op: 'place', def: 'core/cow-pack@1', name: 'cdn-cow', p: [0, 0] },
    { op: 'place', def: 'core/cottage@1', name: 'cottage', p: [10, 8] },
    { op: 'place', def: 'core/flag@1', name: 'arrival', p: [0, 4], state: { label: 'CDN proof' } },
    { op: 'place', def: 'core/screen@1', name: 'cdn-texture', p: [4, 0], state: { media: origin + pngPath } },
  ] }] }));
  process.env.WEB_DIR = webDir;
  process.env.WORLD_PATH = prefix + '/w/cdn-proof';
  const { child } = await startWorld({ slug: 'cdn-proof', port: 5810, data: resolve(out, 'world-data'), genesis, fresh: true, log: resolve(out, 'world.log') });
  let cdn, proxy;
  try {
  // Like the real launcher: preserve the advertised world namespace for HTTP/WS, strip BASE for shared static files.
  const upstreamPath = path => prefix && path.startsWith(prefix + '/') && !path.startsWith(prefix + '/w/') ? path.slice(prefix.length) : path;
  let corrupt = false;
  const startCdn = async () => {
    if (cdn?.listening) return;
    cdn = createServer((req, res) => {
      const source = req.url === '/' + key ? bytes : req.url === '/' + pngKey ? png : lodKey && req.url === '/' + lodKey ? lodBytes : null;
      if (!source) { res.writeHead(404).end(); return; }
      const body = corrupt ? Buffer.alloc(source.length, 0) : source;
      res.writeHead(200, { 'content-type': source === png ? 'image/png' : 'model/gltf-binary', 'content-length': body.length, 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
      res.end(body);
    });
    await new Promise((yes, no) => cdn.once('error', no).listen(5811, '127.0.0.1', yes));
  };
  await startCdn();
  proxy = createServer(async (req, res) => {
    try {
      if (req.url === '/__fixture/cdn/down') { await new Promise(yes => cdn.close(yes)); res.end('down'); return; }
      if (req.url === '/__fixture/cdn/up') { corrupt = false; await startCdn(); res.end('up'); return; }
      if (req.url === '/__fixture/cdn/corrupt') { corrupt = true; await startCdn(); res.end('corrupt'); return; }
      const path = upstreamPath(req.url);
      const response = await fetch('http://127.0.0.1:5810' + path, { method: req.method, signal: AbortSignal.timeout(30_000) });
      const headers = Object.fromEntries(response.headers);
      delete headers['content-encoding']; delete headers['content-length'];
      res.writeHead(response.status, headers);
      if (response.body) for await (const chunk of response.body) res.write(chunk);
      res.end();
    } catch (error) { res.writeHead(502).end(String(error)); }
  });
  proxy.on('upgrade', (req, socket, head) => {
    const upstream = connect(5810, '127.0.0.1', () => {
      const path = upstreamPath(req.url);
      const headers = req.rawHeaders.reduce((all, value, i) => i % 2 ? all : all + value + ': ' + req.rawHeaders[i + 1] + '\r\n', '');
      upstream.write(`${req.method} ${path} HTTP/${req.httpVersion}\r\n${headers}\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream); upstream.pipe(socket);
    });
    upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
    socket.on('close', () => upstream.destroy());
  });
  await new Promise((yes, no) => proxy.once('error', no).listen(5812, '127.0.0.1', yes));
  const close = () => { child.kill('SIGTERM'); cdn?.close(); proxy.close(); setTimeout(() => process.exit(0), 1000).unref(); };
  process.once('SIGTERM', close); process.once('SIGINT', close);
  for (const path of [`${prefix}/assets/${emitted[0]}`, pngPath]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200, 'fixture static route is served');
    assert.match(response.headers.get('content-type') ?? '', path.endsWith('.json') ? /application\/json/ : /image\/png/, 'static route must not return the SPA shell');
    await response.body?.cancel();
  }
  const configResponse = await fetch(origin + prefix + '/w/cdn-proof/v1/config');
  assert.equal(configResponse.status, 200);
  assert.match(configResponse.headers.get('content-type') ?? '', /application\/json/);
  const config = await configResponse.json();
  assert.equal(config.worldKey, 'cdn-proof');
  assert.equal(config.worldPath, prefix + '/w/cdn-proof', 'fixture must advertise the same namespace as its frontend');
  writeFileSync(resolve(out, 'ready.json'), JSON.stringify({ pid: process.pid, worldPid: child.pid, origin, prefix, assetPath, sha, bytes: bytes.length }, null, 2));
  console.log(JSON.stringify({ ready: true, origin, prefix, pid: process.pid, worldPid: child.pid }));
  } catch (error) {
    child.kill('SIGTERM'); cdn?.closeAllConnections(); cdn?.close(); proxy?.closeAllConnections(); proxy?.close();
    throw error;
  }
} else if (mode === 'check') {
  const release = await chromeLease('cdn');
  const { chromium } = findPlaywright();
  const report = { at: new Date().toISOString(), origin, prefix, sha, bytes: bytes.length, runs: [] };
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
    for (const dpr of [1, 2]) for (const scenario of ['cdn', 'unreachable', 'corrupt']) {
      await fetch(origin + '/__fixture/cdn/' + (scenario === 'cdn' ? 'up' : scenario === 'corrupt' ? 'corrupt' : 'down'));
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr });
      const page = await context.newPage(), requests = [], responses = [], failed = [], errors = [];
      await page.route('**/*', route => { const u = new URL(route.request().url()); return ['blob:', 'data:'].includes(u.protocol) || ['127.0.0.1', 'localhost'].includes(u.hostname) ? route.continue() : route.abort(); });
      const tracked = url => url.includes(sha) || (lodSha && url.includes(lodSha)) || url.includes(pngSha) || url.endsWith('/cdn-proof.png');
      page.on('request', req => { if (tracked(req.url())) requests.push(req.url()); });
      page.on('response', res => { if (tracked(res.url())) responses.push({ url: res.url(), status: res.status() }); });
      page.on('requestfailed', req => { if (tracked(req.url())) failed.push({ url: req.url(), error: req.failure()?.errorText }); });
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${origin}${prefix}/w/cdn-proof?dev=1&weather=clear`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(shas => shas.some(s => globalThis.__assetStages?.[s] === 'done'), [sha, lodSha].filter(Boolean), { timeout: 90_000 });
      const renderer = await page.evaluate(() => { const canvas = document.querySelector('canvas'); const gl = canvas?.getContext('webgl2'); const ext = gl?.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ''; });
      assert.ok(renderer && !/swiftshader|llvmpipe|software/i.test(renderer), renderer);
      // Real input: focus the canvas, drag the camera, and use the walk keys before the screenshot.
      const canvas = page.locator('canvas').first();
      await canvas.click({ position: { x: 640, y: 400 }, force: true });
      await page.mouse.move(700, 400); await page.mouse.down(); await page.mouse.move(760, 435, { steps: 6 }); await page.mouse.up();
      await page.keyboard.down('ArrowUp'); await page.waitForTimeout(350); await page.keyboard.up('ArrowUp');
      // Frame an authored landmark through the real Explore UI, so the screenshot shows the fixture
      // rather than whichever empty horizon the manual camera gesture happened to face.
      // Best effort (the Explore UI changes between releases): the assertions below do not depend on it.
      await (async () => {
        await page.getByRole('button', { name: /^Explore/ }).first().click({ timeout: 5000 });
        await page.getByRole('searchbox').first().fill('cottage', { timeout: 5000 });
        await page.getByRole('button', { name: 'cottage', exact: true }).click({ timeout: 5000 });
      })().catch(() => page.keyboard.press('Escape'));
      await page.waitForTimeout(1500);
      assert.ok(requests.some(url => url === 'http://127.0.0.1:5811/' + key || (lodKey && url === 'http://127.0.0.1:5811/' + lodKey)), 'CDN was attempted');
      // CDN2: GLBs are downloaded in the asset worker (asset-fetch.ts); its requests count like the page's.
      const originLoaded = responses.some(row => (row.url === origin + assetPath || (lodPath && row.url === origin + lodPath)) && row.status === 200);
      assert.equal(originLoaded, scenario !== 'cdn', 'only failure scenarios fetch origin');
      assert.ok(requests.includes('http://127.0.0.1:5811/' + pngKey), 'standalone TextureLoader uses CDN too');
      assert.equal(responses.some(row => row.url === origin + pngPath && row.status === 200), scenario !== 'cdn', 'standalone texture falls back to origin');
      // CDN2: the GLB came through the download worker (3.50's bypass): it delivered, and from the CDN when it is up.
      const worker = await page.evaluate(() => globalThis.__assetWorker);
      assert.ok(worker?.delivered > 0 && !worker.failed, `asset worker used: ${JSON.stringify(worker)}`);
      assert.equal(worker.cdn > 0, scenario === 'cdn', `worker CDN deliveries: ${JSON.stringify(worker)}`);
      if (scenario === 'unreachable') assert.ok(failed.some(row => row.url.startsWith('http://127.0.0.1:5811/')), 'CDN connection refused');
      assert.deepEqual(errors, []);
      const shot = resolve(out, `${scenario}-dpr${dpr}.png`);
      await page.screenshot({ path: shot });
      report.runs.push({ scenario, dpr, renderer, requests, responses, failed, errors, modelStage: 'done', worker, shot });
      console.log(JSON.stringify({ scenario, dpr, renderer, originLoaded, worker, result: 'PASS' }));
      await context.close();
    }
  } catch (error) {
    const page = browser?.contexts().at(-1)?.pages().at(-1);
    report.failure = { error: String(error), url: page?.url(), body: await page?.locator('body').innerText().catch(() => '') };
    await page?.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {});
    throw error;
  } finally { await browser?.close(); release(); writeFileSync(resolve(out, 'proof.json'), JSON.stringify(report, null, 2)); }
} else throw Error('Usage: browser-proof.mjs serve --web-dir <built app> [--prefix /worlds] [--out <dir>] | check [--prefix /worlds] [--out <dir>]');
