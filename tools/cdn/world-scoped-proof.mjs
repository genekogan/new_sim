#!/usr/bin/env node
// Local-only proof that /w/mars loads its campus from a world-scoped CDN copy and falls back to origin.
// Nothing here reads credentials or contacts R2: `serve` runs the real publishScoped against a local origin with a
// synthetic key and an on-disk stand-in bucket, then serves that bucket as the CDN.
//
//   build:  SIM_ASSETS_CDN_ENABLED=1 SIM_ASSETS_CDN_ORIGIN=http://127.0.0.1:6141 vite build --outDir <web-on>
//   serve:  NODE_OPTIONS=--import=<abs>/tools/test-harness/port-remap.mjs PORT_REMAP_BASE=6107 \
//             node tools/cdn/world-scoped-proof.mjs serve --web-dir <web-on> --out <dir>
//           (the Mars launcher only accepts port 4963..4969; the preload binds it on 6140 instead, never the live 4963)
//   check:  node tools/cdn/world-scoped-proof.mjs check --out <dir> [--shots <dir>]
// Ports: 6140 world (origin), 6141 CDN stand-in, 6142 stand-in control.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENDPOINT, BUCKET } from './publish.mjs';
import { mergeManifest, plan, publishScoped, readRecords } from './world-scoped.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2), mode = args[0];
const opt = (name, fallback) => { const i = args.indexOf('--' + name); return i < 0 ? fallback : args[i + 1]; };
const out = resolve(opt('out', '<team>/scratch/cdn2/proof'));
const WORLD = '/w/mars', CAMPUS = '/browser/campus.glb?v=20260922b';
const ORIGIN = 'http://127.0.0.1:6140', CDN = 'http://127.0.0.1:6141', CONTROL = 'http://127.0.0.1:6142';
mkdirSync(out, { recursive: true });

if (mode === 'serve') {
  assert.equal(globalThis.__portRemap, 6107, 'run serve with the port-remap preload and PORT_REMAP_BASE=6107 (4963 -> 6140)');
  const webDir = resolve(opt('web-dir', '<team>/scratch/cdn2/web-on'));
  const bucket = resolve(out, 'bucket'), dataDir = resolve(out, 'world-data');
  rmSync(dataDir, { recursive: true, force: true }); rmSync(bucket, { recursive: true, force: true }); // this proof's own scratch only
  const records = await readRecords();
  const { openWorldServer } = await import('../core/multiworld/world-server.mjs');
  const world = await openWorldServer({ input: root, dataDir, worldKey: 'mars', worldId: 'mars-2026-1', port: 4963, publicOrigin: ORIGIN,
    webDir, marsWebDir: resolve(root, '.lane/mars-web'), seedCast: false, nativeCast: false, runtimePolicies: false, cards: false, build: 'local-cdn2-proof' });
  let cdn, control;
  const stop = async () => { cdn?.closeAllConnections?.(); cdn?.close(); control?.close(); await world.close().catch(() => {}); };
  try {
    assert.equal(world.server.address().port, 6140, 'world must bind the remapped port, never the live 4963');
    // Real publishScoped: public GET of each served path on the local origin, then HEAD/PUT/GET against a stand-in bucket.
    const p = await plan({ records });
    const scoped = { ...p, objects: p.objects.filter(o => o.world === WORLD) };
    const objectFile = url => { const key = decodeURIComponent(new URL(url).pathname).replace(`/${BUCKET}/`, ''); assert.match(key, /^assets\/w\/mars\/[0-9a-f]{64}\.glb$/); return resolve(bucket, key); };
    const fetcher = async (url, init = {}) => {
      if (!url.startsWith(ENDPOINT + '/')) { assert.ok(url.startsWith(ORIGIN + '/'), 'only the local origin and the stand-in bucket are contacted'); return fetch(url, init); }
      assert.match(init.headers.authorization, /^AWS4-HMAC-SHA256 Credential=LOCAL_PROOF_ONLY\//);
      const file = objectFile(url), meta = file + '.meta.json', method = init.method ?? 'GET';
      if (method === 'PUT') {
        if (existsSync(file) && init.headers['if-none-match'] === '*') return new Response(null, { status: 412 });
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, init.body);
        await writeFile(meta, JSON.stringify({ 'content-length': String(init.body.length), ...Object.fromEntries(['content-type', 'cache-control', 'x-amz-meta-sha256', 'x-amz-meta-licence', 'x-amz-meta-world'].map(h => [h, init.headers[h]])) }));
        return new Response(null, { status: 200 });
      }
      if (!existsSync(file)) return new Response(null, { status: 404 });
      const headers = JSON.parse(await readFile(meta, 'utf8'));
      return new Response(method === 'HEAD' ? null : await readFile(file), { status: 200, headers });
    };
    const receipt = await publishScoped(scoped, { records, origin: ORIGIN, fetcher, credentials: { accessKeyId: 'LOCAL_PROOF_ONLY', secretAccessKey: 'LOCAL_PROOF_ONLY' } });
    writeFileSync(resolve(out, 'local-receipt.json'), JSON.stringify(receipt, null, 2));
    const campus = receipt.results.find(r => r.paths.includes(CAMPUS));
    assert.equal(campus?.verified, true, 'campus served by the local origin and verified in the stand-in bucket');
    // Merge into the disposable build's Vite-emitted manifest (kept pristine in a .orig copy for reruns).
    const emitted = readdirSync(resolve(webDir, 'assets')).filter(n => /^cdn-manifest-.*\.json$/.test(n));
    assert.equal(emitted.length, 1, 'one Vite-emitted publication manifest');
    const manifestFile = resolve(webDir, 'assets', emitted[0]), pristine = manifestFile + '.orig';
    if (!existsSync(pristine)) copyFileSync(manifestFile, pristine);
    const { manifest, added } = mergeManifest(JSON.parse(readFileSync(pristine, 'utf8')), receipt, { records, origin: ORIGIN });
    writeFileSync(manifestFile, JSON.stringify(manifest));
    // CDN stand-in: serves the bucket by key with CORS, like assets.eden.art; `corrupt` returns same-length zeros.
    let state = 'up';
    const startCdn = async () => {
      if (cdn?.listening) return;
      cdn = createServer((req, res) => {
        const key = decodeURIComponent(new URL(req.url, CDN).pathname.slice(1));
        const file = resolve(bucket, key);
        if (!/^assets\/w\/[a-z-]+\/[0-9a-f]{64}\.glb$/.test(key) || !existsSync(file)) { res.writeHead(404, { 'access-control-allow-origin': '*' }).end(); return; }
        const size = statSync(file).size;
        res.writeHead(200, { 'content-type': 'model/gltf-binary', 'content-length': size, 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
        if (state === 'corrupt') res.end(Buffer.alloc(size)); else createReadStream(file).pipe(res);
      });
      await new Promise((yes, no) => cdn.once('error', no).listen(6141, '127.0.0.1', yes));
    };
    await startCdn();
    control = createServer(async (req, res) => {
      const next = req.url.slice(1);
      if (next === 'down') { cdn.closeAllConnections?.(); await new Promise(yes => cdn.close(yes)); state = 'down'; }
      else if (next === 'up' || next === 'corrupt') { state = next; await startCdn(); }
      else { res.writeHead(404).end(); return; }
      res.end(state);
    });
    await new Promise((yes, no) => control.once('error', no).listen(6142, '127.0.0.1', yes));
    for (const s of ['SIGTERM', 'SIGINT']) process.once(s, () => void stop().finally(() => process.exit(0)));
    const config = await (await fetch(ORIGIN + WORLD + '/v1/config')).json();
    assert.equal(config.worldKey, 'mars');
    const ready = { pid: process.pid, origin: ORIGIN, cdn: CDN, campusKey: campus.key, campusSha256: campus.sha256, campusBytes: campus.bytes, worldPathsMapped: added,
      receipt: receipt.results.map(r => ({ key: r.key, disposition: r.disposition, verified: r.verified, paths: r.paths })) };
    writeFileSync(resolve(out, 'ready.json'), JSON.stringify(ready, null, 2));
    console.log(JSON.stringify({ ready: true, ...ready }));
  } catch (error) { await stop(); throw error; }
} else if (mode === 'check') {
  const { chromeLease } = await import('<team>/ops/chrome-lease.mjs');
  const { findPlaywright } = await import('../god-skill/lib/look.mjs');
  const ready = JSON.parse(readFileSync(resolve(out, 'ready.json'), 'utf8'));
  const shots = resolve(opt('shots', out)); mkdirSync(shots, { recursive: true });
  const cdnUrl = `${CDN}/${ready.campusKey}`, originUrl = ORIGIN + CAMPUS;
  const release = await chromeLease('cdn2');
  const { chromium } = findPlaywright();
  const report = { at: new Date().toISOString(), cdnUrl, originUrl, bytes: ready.campusBytes, runs: [] };
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });
    for (const dpr of [1, 2]) for (const scenario of ['cdn', 'unreachable', 'corrupt']) {
      assert.equal(await (await fetch(`${CONTROL}/${scenario === 'cdn' ? 'up' : scenario === 'corrupt' ? 'corrupt' : 'down'}`)).text(), scenario === 'cdn' ? 'up' : scenario === 'corrupt' ? 'corrupt' : 'down');
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr });
      const page = await context.newPage(), events = [], blocked = [], errors = [];
      const t0 = Date.now();
      // Only the local origin and the CDN stand-in; never the live ports or any external host.
      await page.route('**/*', route => { const u = new URL(route.request().url()); if (['blob:', 'data:'].includes(u.protocol) || (u.hostname === '127.0.0.1' && ['6140', '6141'].includes(u.port))) return route.continue(); blocked.push(u.origin); return route.abort(); });
      const campus = url => url === cdnUrl || url === originUrl || url.includes('/blobs/assets/64/');
      page.on('request', r => { if (campus(r.url())) events.push({ ms: Date.now() - t0, at: 'request', url: r.url() }); });
      page.on('response', r => { if (campus(r.url())) events.push({ ms: Date.now() - t0, at: 'response', url: r.url(), status: r.status() }); });
      page.on('requestfinished', r => { if (campus(r.url())) events.push({ ms: Date.now() - t0, at: 'finished', url: r.url() }); });
      page.on('requestfailed', r => { if (campus(r.url())) events.push({ ms: Date.now() - t0, at: 'failed', url: r.url(), error: r.failure()?.errorText }); });
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(`${ORIGIN}${WORLD}?weather=clear`, { waitUntil: 'domcontentloaded' });
      const want = scenario === 'cdn' ? cdnUrl : originUrl;
      // The canvas is revealed only once the initial gate, which requires the campus backdrop, is ready.
      await page.waitForSelector('.world-canvas-host[data-initial-revealed="true"], [data-initial-stage="failed"]', { timeout: 240_000 });
      assert.equal(await page.locator('[data-initial-stage="failed"]').count(), 0, 'the world (campus included) was prepared');
      const arrivedMs = Date.now() - t0;
      const renderer = await page.evaluate(() => { const gl = document.querySelector('canvas')?.getContext('webgl2'); const ext = gl?.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ''; });
      assert.ok(renderer && !/swiftshader|llvmpipe|software/i.test(renderer), renderer);
      // Real input: take the camera and move it before the screenshot.
      const canvas = page.locator('canvas').first();
      await canvas.click({ position: { x: 640, y: 400 }, force: true });
      await page.mouse.move(640, 420); await page.mouse.down(); await page.mouse.move(700, 440, { steps: 8 }); await page.mouse.up();
      await page.keyboard.down('KeyW'); await page.waitForTimeout(400); await page.keyboard.up('KeyW');
      await page.waitForTimeout(1500);
      const cdnOk = events.some(e => e.at === 'response' && e.url === cdnUrl && e.status === 200);
      const originOk = events.some(e => e.at === 'response' && e.url === originUrl && e.status === 200);
      if (scenario === 'cdn') { assert.ok(cdnOk, 'campus came from the CDN stand-in'); assert.ok(!originOk, 'origin campus not fetched when the CDN copy verifies'); }
      if (scenario === 'unreachable') { assert.ok(events.some(e => e.at === 'failed' && e.url === cdnUrl), 'CDN attempt refused'); assert.ok(originOk, 'origin fallback'); }
      if (scenario === 'corrupt') { assert.ok(cdnOk && originOk, 'corrupt CDN bytes rejected by SHA-256, origin fallback'); }
      assert.deepEqual(errors, []);
      const served = events.find(e => e.at === 'response' && e.url === want && e.status === 200);
      const shot = resolve(shots, `mars-campus-${scenario}-dpr${dpr}.png`);
      await page.screenshot({ path: shot });
      const run = { scenario, dpr, renderer, campusFrom: want, campusResponseMs: served.ms, arrivedMs, events, blocked: [...new Set(blocked)], shot };
      report.runs.push(run);
      console.log(JSON.stringify({ scenario, dpr, campusFrom: want, campusResponseMs: served.ms, arrivedMs, result: 'PASS' }));
      await context.close();
    }
  } catch (error) {
    const page = browser?.contexts().at(-1)?.pages().at(-1);
    report.failure = { error: String(error), url: page?.url(), body: await page?.locator('body').innerText().catch(() => '') };
    await page?.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser?.close(); release();
    await fetch(CONTROL + '/up').catch(() => {});
    writeFileSync(resolve(out, 'proof.json'), JSON.stringify(report, null, 2));
  }
} else throw Error('Usage: world-scoped-proof.mjs serve --web-dir <CDN-on build> [--out <dir>] | check [--out <dir>] [--shots <dir>]');
