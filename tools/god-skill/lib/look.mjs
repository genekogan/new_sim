// god look: a screenshot of the world from a chosen viewpoint, for the god's own eyes.
//
// The world's ordinary viewer page renders the picture in its `?shot=1` mode (canvas only, camera from
// eye/at, window.__shotReady once drawn). Default: open Chrome, wait until every entity has eased in,
// read the canvas back (the WebGL buffer is preserved by an init script), close Chrome. Machines shared
// by many agents take a lease (/tmp/eden-chrome-lease) so only one headless Chrome renders at a time.
// `look --keep` instead leaves a keeper process holding one tab on the world (it follows edits live),
// so later looks cost seconds; it quits after 20 idle minutes, `look --stop` ends it. Use it on your own
// machine, not a shared one. GPU by default; EDEN_GOD_GL=swiftshader forces software GL.
//
// Needs Google Chrome and a Playwright package (playwright-core, playwright or @playwright/test)
// resolvable from the current folder, EDEN_GOD_PLAYWRIGHT_FROM, or the sim repo; else npx's cached
// playwright-core (fetched once). Only without npx does it fall back to `npx playwright-core screenshot`
// (a fixed 30 s wait, no --keep).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPASS, compassKey } from './solver.mjs';

const GL_ARGS = process.env.EDEN_GOD_GL === 'swiftshader' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist'];
const PRESERVE = () => { const orig = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (type, attrs) { if (/webgl/.test(String(type))) attrs = { ...(attrs || {}), preserveDrawingBuffer: true }; return orig.call(this, type, attrs); }; };
import { chromeLease as lease } from './chrome-lease.mjs';
/** One headless Chrome at a time on a shared machine (the lanes' lease); EDEN_GOD_NO_LEASE=1 skips it. */
export const chromeLease = (holder = 'eden-god', o) => (process.env.EDEN_GOD_NO_LEASE ? Promise.resolve(() => {}) : lease(holder, o));
const KEEPER = '.eden-god.look.json';
const IDLE_MS = 20 * 60_000;

export function findPlaywright() {
  const here = (() => { try { return dirname(fileURLToPath(import.meta.url)); } catch { return process.cwd(); } })();
  const bases = [process.env.EDEN_GOD_PLAYWRIGHT_FROM, process.cwd(), here, resolve(here, '../..'), resolve(here, '../../..'), resolve(here, '../../../mars/viewer'), resolve(here, '../../mars/viewer'), resolve(here, '../mars/viewer')].filter(Boolean);
  for (const b of bases) {
    const pkg = existsSync(resolve(b, 'package.json')) ? resolve(b, 'package.json') : resolve(b, 'noop.js');
    for (const name of ['playwright-core', 'playwright', '@playwright/test']) {
      try { const m = createRequire(pkg)(name); if (m?.chromium) return m; } catch { /* next */ }
    }
  }
  // none next to the CLI (a god folder holds only eden-god.mjs): npx's own cache, fetched once (~10 MB, no browser;
  // Google Chrome draws). The folder is remembered in the environment, so the keeper and shot children skip this.
  if (process.env.EDEN_GOD_NO_NPX) return null;
  try {
    const r = spawnSync('npx', ['-y', '-p', 'playwright-core@1', '-c', 'echo "$PATH"'], { encoding: 'utf8', timeout: 300_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const bin = (r.stdout ?? '').trim().split(':').find((d) => /[\\/]_npx[\\/][^\\/]+[\\/]node_modules[\\/]\.bin$/.test(d));
    if (bin) {
      const base = resolve(bin, '../..'), m = createRequire(resolve(base, 'noop.js'))('playwright-core');
      if (m?.chromium) { process.env.EDEN_GOD_PLAYWRIGHT_FROM = base; return m; }
    }
  } catch { /* no npx */ }
  return null;
}

/** Camera for a target box: from a compass side (or above), at a distance that frames it. */
export function camera({ target, span, from = 's', dist, inside = false, height, tight = false }) {
  const key = from === 'above' || from === 'top' ? 'above' : compassKey(from) ?? 's';
  const d = dist ?? (tight ? span * 1.2 : Math.max(16, span * (inside ? 1.0 : 1.2) + 8));
  const el = key === 'above' ? 1.35 : inside ? 0.95 : 0.5;            // elevation (radians)
  const u = key === 'above' ? [0, 0.08] : COMPASS[key];
  const at = target.map((v) => Math.round(v * 10) / 10), origin = tight ? at : target;
  const eye = [origin[0] + u[0] * Math.cos(el) * d, origin[1] + (height ?? Math.sin(el) * d), origin[2] + u[1] * Math.cos(el) * d];
  // Preserve ordinary target rounding; small explicit spans need finer eye precision to avoid collapse.
  const precision = tight ? 1e6 : 10;
  return { eye: eye.map((v) => Math.round(v * precision) / precision), at, from: key };
}

const freePort = () => new Promise((res, rej) => { const s = createServer(); s.unref(); s.on('error', rej); s.listen(Number(process.env.EDEN_GOD_LOOK_PORT ?? 0), '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const alive = async (port) => { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(3000) }); return r.ok; } catch { return false; } };
const readKeeper = () => { try { return JSON.parse(readFileSync(KEEPER, 'utf8')); } catch { return null; } };

/** The keeper process body (`eden-god.mjs look-keeper <worldUrl> <port>`): one Chrome, one tab on the world, until idle. */
export async function keeper(worldUrl, port) {
  const pw = findPlaywright(); if (!pw) throw new Error('no Playwright package found');
  const browser = await pw.chromium.launch({ channel: 'chrome', headless: true, args: [...GL_ARGS, `--remote-debugging-port=${port}`] });
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 640 } });
  // keep the WebGL drawing buffer so the canvas can be read back at any time (page.screenshot stalls on a slow software compositor)
  await ctx.addInitScript(PRESERVE);
  const page = await ctx.newPage();
  await page.goto(`${worldUrl}?shot=1`, { waitUntil: 'commit', timeout: 600_000 });
  writeFileSync(KEEPER, JSON.stringify({ world: worldUrl, port, pid: process.pid, at: Date.now() }));
  for (;;) {
    await new Promise((r) => setTimeout(r, 30_000));
    let last = 0; try { last = statSync(KEEPER).mtimeMs; } catch { break; }
    if (Date.now() - last > IDLE_MS || readKeeper()?.pid !== process.pid) break;
  }
  await browser.close().catch(() => {});
  process.exit(0);
}

async function ensureKeeper(worldUrl, cliPath) {
  const k = readKeeper();
  if (k && k.world === worldUrl && await alive(k.port)) { const now = new Date(); try { utimesSync(KEEPER, now, now); } catch { /* fine */ } return k; }
  if (k?.pid) try { process.kill(k.pid); } catch { /* gone */ }
  rmSync(KEEPER, { force: true });
  const port = await freePort();
  const child = spawn(process.execPath, [cliPath, 'look-keeper', worldUrl, String(port)], { detached: true, stdio: 'ignore', cwd: process.cwd(), env: process.env });
  child.unref();
  for (let i = 0; i < 600; i++) { await new Promise((r) => setTimeout(r, 1000)); const kk = readKeeper(); if (kk?.pid === child.pid && await alive(port)) return kk; }
  throw new Error('look: the browser keeper did not start in 10 minutes');
}
export function stopKeeper() { const k = readKeeper(); if (k?.pid) try { process.kill(k.pid); } catch { /* gone */ } rmSync(KEEPER, { force: true }); return k ? `stopped the look keeper (pid ${k.pid})` : 'no look keeper running'; }

/** Event-driven viewer startup, followed by render-frame settlement (no fixed minimum delay). */
export function waitForShot({ expect = 0, timeoutMs = 600_000 } = {}) {
  return new Promise((resolve, reject) => {
    let raf, timer, stable = 0, last = -1;
    const cleanup = () => { clearTimeout(timer); cancelAnimationFrame(raf); window.removeEventListener('sim-shot-ready', tick); };
    const tick = () => {
      cancelAnimationFrame(raf);
      if (document.title === 'no-entity-world') { cleanup(); reject(Error('look: this world has no entity layer')); return; }
      const w = window.__simEntity, drawn = w?.layer?.drawn, now = w?.layer?.now ?? performance.now();
      const easing = drawn ? [...drawn.values()].filter(d => (now - d.t0) / 1000 < d.dur).length : 0;
      const ready = !!window.__shotReady && !!w?.layer?.active && (!expect || (drawn?.size ?? 0) >= Math.floor(expect * .6)) && easing === 0;
      stable = ready && drawn?.size === last ? stable + 1 : 0; last = drawn?.size ?? -1;
      if (ready && stable >= 2) { cleanup(); resolve({ ready, drawn: drawn?.size ?? 0, want: expect, easing, shotReady: true }); }
      else raf = requestAnimationFrame(tick);
    };
    timer = setTimeout(() => { cleanup(); reject(Error('look: viewer did not initialize and settle before timeout')); }, timeoutMs);
    window.addEventListener('sim-shot-ready', tick, { once: true });
    tick();
  });
}

/** Browser-side composition keeps the downloadable CLI dependency-free. */
export async function composeSheet({ cells, width = 1024, height = 640, cols = 2, strip = false }) {
  const label = 34, columns = strip ? cells.length : Math.min(cols, cells.length), rows = Math.ceil(cells.length / columns);
  const canvas = document.createElement('canvas'); canvas.width = columns * width; canvas.height = rows * (height + label);
  const ctx = canvas.getContext('2d'); if (!ctx) throw Error('look: cannot compose the sheet');
  ctx.fillStyle = '#f3eee3'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const [i, cell] of cells.entries()) {
    const img = new Image(); img.src = cell.data; await img.decode();
    const x = (i % columns) * width, y = Math.floor(i / columns) * (height + label);
    ctx.drawImage(img, x, y, width, height); ctx.fillStyle = '#2c2924'; ctx.font = '16px sans-serif'; ctx.fillText(cell.label, x + 12, y + height + 23, width - 24);
  }
  return canvas.toDataURL('image/png');
}

/** Take one picture or a labelled sheet with one browser/page and one readiness wait. */
export async function shoot({ worldUrl, eye, at, out, hour, weather, hideRoofs = false, cut = null, span = 0, expect = 0, timeoutMs = Number(process.env.EDEN_GOD_LOOK_TIMEOUT_MS ?? 600_000), settleMs, cliPath, keep = false, width = 1024, height = 640, views, frames: frameCount = 1, every = 250, studio }, runtime = {}) {
  const sequence = views ?? [{ eye, at }], sheet = !!views || frameCount > 1;
  if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > 16 || !Number.isFinite(every) || every < 16 || every > 60_000) throw Error('look: frames must be 1..16 and every must be 16..60000 ms');
  if (views && frameCount > 1) throw Error('look: choose views or motion frames per sheet');
  if (sequence.length < 1 || sequence.length > 8) throw Error('look: use 1..8 views');
  if (![width, height].every(n => Number.isInteger(n) && n >= 64 && n <= 4096) || width * height * (studio ? 4 : Math.max(sequence.length, frameCount)) > 32_000_000) throw Error('look: sheet exceeds the 32 megapixel limit (dimensions 64..4096)');
  settleMs ??= sheet ? 0 : 800;
  mkdirSync(dirname(resolve(out)), { recursive: true });
  const now = runtime.now ?? Date.now, t0 = now();
  const overrides = { ...(hour != null ? { hour } : {}), ...(weather != null ? { weather } : {}) };
  const pw = runtime.pw === undefined ? findPlaywright() : runtime.pw;
  if (!pw) {
    if (keep || sheet || studio) throw new Error('look sheets/workbench/--keep need a local Playwright package and Google Chrome');
    const q = new URLSearchParams({ shot: '1', eye: eye.join(','), at: at.join(','), ...(hideRoofs ? { hideRoofs: '1', ...(cut !== null ? { cut: String(cut) } : {}) } : {}), ...overrides });
    const r = (runtime.spawnSync ?? spawnSync)('npx', ['-y', 'playwright-core@1', 'screenshot', '--channel', 'chrome', '--wait-for-timeout', '30000', '--viewport-size', '1024,640', `${worldUrl}?${q}`, resolve(out)], { stdio: 'pipe', encoding: 'utf8', timeout: timeoutMs });
    if (r.status !== 0) throw new Error(`look: no Playwright found and npx playwright-core failed: ${(r.stderr || r.stdout || '').slice(0, 300)}. Install one (npm i -g playwright-core) and Google Chrome`);
    return { file: resolve(out), ms: now() - t0, via: 'npx playwright-core screenshot' };
  }
  let page, browser, release = () => {};
  const first = sequence[0];
  const q = new URLSearchParams({ shot: '1', ...(!studio ? { eye: first.eye.join(','), at: first.at.join(','), settle: '1500' } : {}), ...(hideRoofs ? { hideRoofs: '1', ...(cut !== null ? { cut: String(cut) } : {}) } : {}), ...overrides });
  try {
    if (keep && !studio) {
      const k = await (runtime.ensureKeeper ?? ensureKeeper)(worldUrl, cliPath ?? process.argv[1]);
      browser = await pw.chromium.connectOverCDP(`http://127.0.0.1:${k.port}`, { timeout: 60_000 });
      page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith(worldUrl));
      if (!page) throw Error('look: the keeper has no world tab; run `look --stop` and look again');
      const current = new URL(page.url()).searchParams;
      if (!current.has('eye') || !current.has('at') || ['hour', 'weather'].some(key => current.get(key) !== q.get(key))) await page.goto(`${worldUrl}?${q}`, { waitUntil: 'commit', timeout: timeoutMs });
      await page.setViewportSize?.({ width, height });
    } else {
      release = await (runtime.lease ?? chromeLease)('eden-god look');
      browser = await pw.chromium.launch({ channel: 'chrome', headless: true, args: GL_ARGS }).catch(e => { throw Error(`look: cannot start Chrome (${String(e.message).split('\n')[0]}); install Google Chrome`); });
      const ctx = await browser.newContext({ viewport: { width, height } });
      await ctx.addInitScript(PRESERVE); page = await ctx.newPage();
      await page.goto(`${worldUrl}${studio ? '/god/workbench' : ''}?${q}`, { waitUntil: 'commit', timeout: timeoutMs });
    }
    if (studio) {
      await page.waitForFunction(() => !!window.workbench, null, { timeout: timeoutMs, polling: 'raf' });
      const result = await page.evaluate(async payload => window.workbench.render(payload), { ...studio, hour, width, height });
      writeFileSync(resolve(out), Buffer.from(result.data.split(',')[1], 'base64'));
      return { file: resolve(out), ms: now() - t0, via: 'studio', ...result, data: undefined };
    }
    const state = await (runtime.waitReady ? runtime.waitReady(page, { expect, timeoutMs }) : page.evaluate(waitForShot, { expect, timeoutMs }));
    const cells = [], receipts = []; let capturedAt = 0, cameraFrames;
    for (let i = 0; i < (frameCount > 1 ? frameCount : sequence.length); i++) {
      const view = sequence[frameCount > 1 ? 0 : i];
      if (frameCount > 1 && i > 0) await page.waitForTimeout(Math.max(0, capturedAt + i * every - now()));
      const frames = frameCount > 1 && i > 0 ? cameraFrames : await page.evaluate(([e0, a, roofs, cutAt, fitSpan]) => new Promise((res) => {
        const w = window.__simEntity;
        // back the camera off until `fitSpan` metres fit the frame at this camera's real field of view
        let e = e0;
        if (fitSpan > 0 && w.camera.fov) {
          const v = (w.camera.fov * Math.PI) / 180, h = 2 * Math.atan(Math.tan(v / 2) * (w.camera.aspect || 1.6));
          const need = (fitSpan / 2) / Math.tan(Math.min(v, h) / 2) * 1.05, d = [e0[0] - a[0], e0[1] - a[1], e0[2] - a[2]], len = Math.hypot(...d) || 1;
          if (len < need) e = d.map((c, i) => a[i] + (c / len) * need);
        }
        const eyeDistance = Math.hypot(...e.map((c, i) => c - a[i]));
        if (!e.every(Number.isFinite) || !a.every(Number.isFinite) || !Number.isFinite(eyeDistance) || eyeDistance <= Math.max(0, w.camera.near ?? 0)) throw Error('Requested look camera is within the viewer near clipping plane');
        // L2's interior view: roofs (and the storeys above `cut`) off for every building
        window.__buildingView = roofs ? { hideRoofs: true, cut: cutAt } : { hideRoofs: false, cut: null };
        w.controls.target.set(a[0], a[1], a[2]); w.camera.position.set(e[0], e[1], e[2]); w.camera.lookAt(w.controls.target); w.controls.update?.();
        // a world-scale look (the camera a kilometre out) must not be cut by the play camera's far plane or fog
        const dist = Math.hypot(e[0] - a[0], e[1] - a[1], e[2] - a[2]);
        if (w.camera.far < dist * 3) { w.camera.far = dist * 3; w.camera.updateProjectionMatrix?.(); }
        const fog = w.scene.fog; if (fog && 'far' in fog && fog.far < dist * 2.5) { fog.near = Math.max(fog.near ?? 0, dist * 0.8); fog.far = dist * 2.5; }
        if (fog && 'density' in fog) fog.density = Math.min(fog.density, 0.6 / Math.max(1, dist));
        const hidden = [];
        if (roofs) w.scene.traverse((o) => { if (o.visible && (/roof/i.test(o.name ?? '') || o.userData?.role === 'roof')) { o.visible = false; hidden.push(o); } });
        window.__lookRestore = () => { for (const o of hidden) o.visible = true; };
        const canvas = document.querySelector('canvas');
        if (canvas) { const keep = new Set(); for (let n = canvas; n; n = n.parentElement) keep.add(n); for (const n of keep) for (const c of n.children ?? []) if (!keep.has(c)) c.style.visibility = 'hidden'; }
        let n = 0; const t = performance.now(); const tick = () => { if (++n >= 4 || performance.now() - t > 120000) res({ n, ms: Math.round(performance.now() - t), roofsHidden: hidden.length, eye: e, at: a }); else requestAnimationFrame(tick); }; requestAnimationFrame(tick);
      }), [view.eye, view.at, view.hideRoofs ?? hideRoofs, view.cut === undefined ? cut : view.cut, view.span ?? span]);
      cameraFrames = frames;
      if (settleMs && (frameCount === 1 || i === 0)) await page.waitForTimeout(settleMs);
      const data = await page.evaluate(({ eye, at, restore }) => {
        try {
          const w = window.__simEntity, close = (v, want) => v?.toArray().every((c, i) => Number.isFinite(c) && Math.abs(c - want[i]) <= 1e-4);
          if (!window.__shotReady || !close(w?.camera?.position, eye) || !close(w?.controls?.target, at)) throw Error('look: requested camera changed before capture; retry the shot');
          const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
          return c ? c.toDataURL('image/png') : null;
        } catch (e) { restore = true; throw e; }
        finally { if (restore) window.__lookRestore?.(); }
      }, { ...frames, restore: frameCount === 1 || i === frameCount - 1 });
      if (!data) throw Error('look: no canvas on the page');
      const timestamp = now(); if (i === 0) capturedAt = timestamp;
      receipts.push({ ...frames, ...(sheet ? { ms: timestamp - capturedAt } : {}), label: view.label ?? `${i + 1}` });
      cells.push({ data, label: frameCount > 1 ? `Frame ${i + 1} · +${timestamp - capturedAt} ms` : view.label ?? `View ${i + 1}` });
    }
    const data = sheet ? await page.evaluate(composeSheet, { cells, width, height, strip: frameCount > 1 }) : cells[0].data;
    writeFileSync(resolve(out), Buffer.from(data.split(',')[1], 'base64'));
    return { file: resolve(out), ms: now() - t0, state, frames: sheet ? receipts : receipts[0], cells: cells.length, via: keep ? 'keeper' : 'chrome' };
  } finally { if (keep && page) await page.evaluate(() => window.__lookRestore?.()).catch(() => {}); if ((!keep || studio) && browser) await browser.close().catch(() => {}); release(); }
}
