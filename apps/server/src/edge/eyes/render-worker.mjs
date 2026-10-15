// Eyes (M3) render worker: ONE headless Chromium (Playwright) with ONE page that loads the world's own viewer in
// eyes mode (?eyes=1) and keeps it warm. The world server forks this file and sends {t:'render', id, job}; jobs run one
// at a time on that page (window.edenEyes.capture). It reads only the public spectator scene; the server decides
// what the frame may show (job.show) and the page hides every other Soul body.
//
// Env: EDGE_EYES_URL (viewer URL, e.g. http://127.0.0.1:4970/w/eden/), EDGE_EYES_GPU=auto|metal|gl|swiftshader,
// EDGE_EYES_PLAYWRIGHT (a package.json whose node_modules has @playwright/test; default <repo>/mars/viewer),
// PLAYWRIGHT_BROWSERS_PATH, EDGE_EYES_RELOAD_HOURS (default 6), EDGE_EYES_HEADLESS_SHELL=1 (old headless shell).
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {eyesBrowserLaunch, eyesBrowserModes} from './browser-config.mjs';

const viewer = process.env.EDGE_EYES_URL;
const from = process.env.EDGE_EYES_PLAYWRIGHT || fileURLToPath(new URL('../../../../../mars/viewer/package.json', import.meta.url));
const send = m => {try {process.send?.(m);} catch {/* parent gone */}};
const log = (...a) => console.error(new Date().toISOString(), ...a);
if (!viewer || !process.send) {log('eyes worker needs EDGE_EYES_URL and an IPC parent'); process.exit(2);}
const {chromium} = createRequire(from)('@playwright/test');

const order = eyesBrowserModes();
let browser = null, page = null, renderer = null, ready = false, closing = false, loadedAt = 0, busy = false;
let releaseChrome = null;
const queue = [];

async function launch() {
  if (process.platform === 'darwin' && !releaseChrome) {
    // All real Chrome work on the shared laptop participates in the same lease as visual QA.
    const {chromeLease} = await import('../../../../../tools/god-skill/lib/chrome-lease.mjs');
    releaseChrome = await chromeLease(process.env.EDGE_EYES_CHROME_OWNER || 'bodies');
  }
  for (const mode of order) {
    try {
      const b = await chromium.launch(eyesBrowserLaunch(mode));
      const p = await b.newPage({viewport: {width: 512, height: 320}, deviceScaleFactor: 1});
      const gl = await p.evaluate(() => {const c = document.createElement('canvas').getContext('webgl2'); if (!c) return null; const x = c.getExtension('WEBGL_debug_renderer_info'); return x ? c.getParameter(x.UNMASKED_RENDERER_WEBGL) : c.getParameter(c.RENDERER);});
      if (!gl) {await b.close(); log('no WebGL with', mode); continue;}
      if (mode === 'metal' && /swiftshader|llvmpipe|software/i.test(gl)) {await b.close(); log('Metal hardware required, got', gl); continue;}
      browser = b; page = p; renderer = `${mode}: ${gl}`; log('browser up', renderer);
      p.on('crash', () => {log('page crashed'); fail('page crashed');});
      p.on('pageerror', e => log('page error:', String(e.message).slice(0, 200)));
      browser.on('disconnected', () => {if (!closing) {log('browser disconnected'); fail('browser disconnected');}});
      return;
    } catch (e) {log('launch failed', mode, e.message.split('\n')[0]);}
  }
  throw new Error('no headless browser with WebGL could be started');
}
async function load() {
  ready = false; send({t: 'status', ready: false, renderer, detail: 'loading the viewer'});
  const url = viewer + (viewer.includes('?') ? '&' : '?') + 'eyes=1';
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 60_000});
      await page.waitForFunction(() => window.edenEyes?.ready?.() === true, null, {timeout: 180_000, polling: 500});
      break;
    } catch (e) {log('viewer not ready yet:', e.message.split('\n')[0]); if (attempt >= 8) throw e; await new Promise(r => setTimeout(r, Math.min(30_000, 2000 * 2 ** attempt)));}
  }
  // one throwaway frame compiles the shaders before the first real request
  try {await page.evaluate(() => window.edenEyes.capture({mode: 'eyes', w: 320, h: 180, quality: 0.5, pose: {p: [9, 1.6, 12], yaw: -Math.PI / 2, pitch: -0.06, vfov: 1}, self: '', show: []}));} catch (e) {log('warm-up frame failed', e.message.split('\n')[0]);}
  loadedAt = Date.now(); ready = true; send({t: 'status', ready: true, renderer, detail: null}); log('viewer ready');
}
let failing = false;
async function fail(why) {
  if (failing || closing) return; failing = true; ready = false; send({t: 'status', ready: false, renderer, detail: why});
  try {await browser?.close();} catch {/* already gone */}
  browser = page = null;
  try {await start();} catch (e) {log('restart failed', e.message); process.exit(1);} finally {failing = false;}
}
async function start() {await launch(); await load();}

async function run(msg) {
  const t0 = performance.now();
  try {
    if (!ready || !page) throw new Error('viewer not ready');
    const out = await page.evaluate(job => window.edenEyes.capture(job), msg.job);
    if (!out?.ok) throw new Error(out?.error ?? 'capture failed');
    send({t: 'result', id: msg.id, ok: true, jpeg: Buffer.from(out.b64, 'base64'), ms: performance.now() - t0, frameTick: out.frameTick ?? null});
  } catch (e) {send({t: 'result', id: msg.id, ok: false, error: e.message.split('\n')[0]});}
}
async function drain() {
  if (busy) return; busy = true;
  try {while (queue.length) await run(queue.shift());} finally {busy = false;}
  // a long-lived page can grow: reload it between jobs every few hours
  const hours = Number(process.env.EDGE_EYES_RELOAD_HOURS || 6);
  if (ready && hours > 0 && Date.now() - loadedAt > hours * 3600_000) {try {await load();} catch (e) {log('reload failed', e.message); fail('reload failed');}}
}
process.on('message', msg => {
  if (msg?.t === 'render') {queue.push(msg); void drain();}
  else if (msg?.t === 'close') void shutdown(0);
});
async function shutdown(code) {closing = true; try {await browser?.close();} catch {/* gone */} await releaseChrome?.(); releaseChrome = null; process.exit(code);}
process.on('disconnect', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));
// liveness: if the page stops answering, start it again
setInterval(async () => {
  if (!ready || busy || !page) return;
  try {await Promise.race([page.evaluate(() => window.edenEyes?.ready?.()), new Promise((_, r) => setTimeout(() => r(new Error('page not answering')), 15_000))]);}
  catch (e) {log(e.message); fail('page not answering');}
}, 60_000).unref();
start().catch(e => {log('eyes worker failed to start:', e.message); send({t: 'status', ready: false, renderer, detail: e.message}); void shutdown(1);});
