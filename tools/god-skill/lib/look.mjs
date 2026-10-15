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
import { acquireLock, holder, liveness, lockStatus, parseHolder } from './locks.mjs';
import { atomicWrite } from './state.mjs';
import { chromeLease as lease } from './chrome-lease.mjs';
/** One headless Chrome at a time on a shared machine (the lanes' lease); EDEN_GOD_NO_LEASE=1 skips it. */
export const chromeLease = (holder = 'eden-god', o) => (process.env.EDEN_GOD_NO_LEASE ? Promise.resolve(() => {}) : lease(holder, o));
const KEEPER = '.eden-god.look.json';
const IDLE_MS = 20 * 60_000;

export function findPlaywright({ timeoutMs = 60_000 } = {}) { // first fetch of playwright-core (~10 MB) on a fresh or busy machine
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
    const r = spawnSync('npx', ['-y', '-p', 'playwright-core@1', '-c', 'echo "$PATH"'], { encoding: 'utf8', timeout: Math.max(1, Math.min(60_000, timeoutMs)), killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'] });
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
export const readKeeper = () => { try { return JSON.parse(readFileSync(KEEPER, 'utf8')); } catch { return null; } };

/** The keeper process body (`eden-god.mjs look-keeper <worldUrl> <port>`): one Chrome, one tab on the world, until idle. */
export async function keeper(worldUrl, port) {
  const release = acquireLock(`${KEEPER}.lock`, { label: 'look keeper' });
  let browser;
  try {
  const pw = findPlaywright(); if (!pw) throw new Error('no Playwright package found');
  browser = await pw.chromium.launch({ channel: 'chrome', headless: true, args: [...GL_ARGS, `--remote-debugging-port=${port}`] });
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 640 } });
  // keep the WebGL drawing buffer so the canvas can be read back at any time (page.screenshot stalls on a slow software compositor)
  await ctx.addInitScript(PRESERVE);
  const page = await ctx.newPage();
  await page.goto(`${worldUrl}?shot=1`, { waitUntil: 'commit', timeout: 25_000 });
  const identity = holder('look keeper');
  const write = () => atomicWrite(KEEPER, JSON.stringify({ world: worldUrl, port, pid: process.pid, at: Date.now(), holder: identity, heartbeatAt: Date.now(), ttlMs: 30_000 }));
  write();
  let lastUse = statSync(KEEPER).mtimeMs;
  process.once('exit', () => { try { if (readKeeper()?.holder?.start === identity.start && readKeeper()?.pid === identity.pid) rmSync(KEEPER, { force: true }); } finally { release(); } });
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    let last = 0; try { last = statSync(KEEPER).mtimeMs; } catch { break; }
    if (last !== lastUse) lastUse = last;
    if (Date.now() - lastUse > IDLE_MS || readKeeper()?.pid !== process.pid) break;
    // Refresh liveness without changing the idle-use timestamp.
    write(); utimesSync(KEEPER, new Date(lastUse), new Date(lastUse));
  }
  } finally { if (browser) await browser.close().catch(() => {}); release(); }
  process.exit(0);
}

async function ensureKeeper(worldUrl, cliPath, runtime = {}) {
  const k = readKeeper();
  if (k && !lockStatus(parseHolder(k.holder), k.heartbeatAt ?? 0).stale && k.world === worldUrl && await alive(k.port)) { const now = new Date(); try { utimesSync(KEEPER, now, now); } catch { /* fine */ } return k; }
  if (k && !lockStatus(parseHolder(k.holder), k.heartbeatAt ?? 0).stale && liveness(parseHolder(k.holder)) !== 'alive') throw Object.assign(new Error('lock.busy: look keeper identity is uncertain; run doctor after its 30 s TTL'), { code: 'lock.busy' });
  if (k?.pid && liveness(parseHolder(k.holder)) === 'alive') try { process.kill(k.pid); } catch { /* gone */ }
  rmSync(KEEPER, { force: true });
  const port = await freePort();
  const child = spawn(process.execPath, [cliPath, 'look-keeper', worldUrl, String(port)], { detached: true, stdio: 'ignore', cwd: process.cwd(), env: process.env });
  child.unref();
  runtime.keeperChild = child;
  for (let i = 0; i < 24; i++) { await new Promise((r) => setTimeout(r, 1000)); const kk = readKeeper(); if (kk && kk.world === worldUrl && !lockStatus(parseHolder(kk.holder), kk.heartbeatAt ?? 0).stale && await alive(kk.port)) { runtime.keeperChild = null; return kk; } }
  child.kill('SIGKILL');
  throw new Error('look.timeout: the browser keeper did not start within 25 s; run doctor --fix');
}
export function stopKeeper() { const k = readKeeper(); if (k?.pid && liveness(parseHolder(k.holder)) === 'alive') try { process.kill(k.pid); } catch { /* gone */ } rmSync(KEEPER, { force: true }); return k ? `stopped the look keeper (pid ${k.pid})` : 'no look keeper running'; }

/** Take the picture. Returns { file, ms, state, via }. */
async function shootInner({ worldUrl, eye, at, out, hour, weather, hideRoofs = false, cut = null, span = 0, expect = 0, timeoutMs = Number(process.env.EDEN_GOD_LOOK_TIMEOUT_MS ?? LOOK_DEFAULT_MS), settleMs = 800, cliPath, keep = false, width = 1024, height = 640 }, runtime = {}) {
  mkdirSync(dirname(resolve(out)), { recursive: true });
  const now = runtime.now ?? Date.now, wait = runtime.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const t0 = now();
  const overrides = { ...(hour != null ? { hour } : {}), ...(weather != null ? { weather } : {}) };
  const pw = runtime.pw === undefined ? findPlaywright({ timeoutMs }) : runtime.pw;
  if (now() - t0 >= timeoutMs) throw Object.assign(new Error('look.timeout: Playwright discovery exceeded deadline'), { code: 'look.timeout' });
  if (!pw) {
    if (keep) throw new Error('look --keep needs a Playwright package (npm i playwright-core here) and npx could not fetch one; look without --keep works');
    const q = new URLSearchParams({ shot: '1', eye: eye.join(','), at: at.join(','), ...(hideRoofs ? { hideRoofs: '1', ...(cut !== null ? { cut: String(cut) } : {}) } : {}), ...overrides });
    const r = (runtime.spawnSync ?? spawnSync)('npx', ['-y', 'playwright-core@1', 'screenshot', '--channel', 'chrome', '--wait-for-timeout', '30000', '--viewport-size', '1024,640', `${worldUrl}?${q}`, resolve(out)], { stdio: 'pipe', encoding: 'utf8', timeout: Math.max(1, timeoutMs - (now() - t0)), killSignal: 'SIGKILL' });
    if (r.status !== 0) throw new Error(`look: no Playwright found and npx playwright-core failed: ${(r.stderr || r.stdout || '').slice(0, 300)}. Install one (npm i -g playwright-core) and Google Chrome`);
    return { file: resolve(out), ms: now() - t0, via: 'npx playwright-core screenshot' };
  }
  let page, browser, release = () => {};
  let cancelled = false;
  runtime.cleanup = () => { cancelled = true; runtime.keeperChild?.kill('SIGKILL'); release(); if (browser && !keep) void browser.close().catch(() => {}); };
  try {
  const q = new URLSearchParams({ shot: '1', eye: eye.join(','), at: at.join(','), settle: '1500', ...(hideRoofs ? { hideRoofs: '1', ...(cut !== null ? { cut: String(cut) } : {}) } : {}), ...overrides });
  if (keep) {
    const k = await (runtime.ensureKeeper ?? ensureKeeper)(worldUrl, cliPath ?? process.argv[1], runtime);
    browser = await pw.chromium.connectOverCDP(`http://127.0.0.1:${k.port}`, { timeout: 25_000 });
    page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith(worldUrl));
    if (!page) throw new Error('look: the keeper has no world tab; run `look --stop` and look again');
    // A newly started (or older) keeper has only ?shot=1. Give the viewer its initial camera too,
    // so its own delayed arrival framing cannot overwrite the first requested shot. Hour/weather
    // overrides are read at page load, so reload when either changes (including removal).
    const current = new URL(page.url()).searchParams;
    if (!current.has('eye') || !current.has('at') || ['hour', 'weather'].some((key) => current.get(key) !== q.get(key))) await page.goto(`${worldUrl}?${q}`, { waitUntil: 'commit', timeout: timeoutMs });
  } else {
    const unlock = await (runtime.lease ?? chromeLease)('eden-god look');
    let unlocked = false; release = () => { if (!unlocked) { unlocked = true; unlock(); } };
    if (cancelled) { release(); throw new Error('look.timeout: lease wait exceeded deadline'); }
    browser = await pw.chromium.launch({ channel: 'chrome', headless: true, args: GL_ARGS }).catch((e) => { release(); throw new Error(`look: cannot start Chrome (${String(e.message).split('\n')[0]}); install Google Chrome`); });
    if (cancelled) { void browser.close().catch(() => {}); throw new Error('look.timeout: browser launch exceeded deadline'); }
    const ctx = await browser.newContext({ viewport: { width, height } });
    await ctx.addInitScript(PRESERVE);
    page = await ctx.newPage();
    await page.goto(`${worldUrl}?${q}`, { waitUntil: 'commit', timeout: timeoutMs });
  }
  const deadline = now() + timeoutMs;
  let state = null, stable = 0, lastDrawn = -1;
  while (now() < deadline) {
    state = await page.evaluate((want) => {
      const w = window.__simEntity; if (!w?.layer?.active) return { ready: false, why: document.title === 'no-entity-world' ? 'no entity world on this page' : 'loading the viewer' };
      const drawn = w.layer.drawn; const now = w.layer.now ?? performance.now();
      const easing = drawn ? [...drawn.values()].filter((d) => (now - d.t0) / 1000 < d.dur).length : 0;
      // terrain-only entities (hills, lakes) are not drawn as things: most of `want` is enough
      return { ready: !!window.__shotReady && (!want || (drawn?.size ?? 0) >= Math.floor(want * 0.6)) && easing === 0, drawn: drawn?.size ?? null, want, easing, shotReady: !!window.__shotReady };
    }, expect).catch((e) => ({ ready: false, why: String(e.message).slice(0, 80) }));
    if (state.ready && state.drawn === lastDrawn) stable++; else stable = 0;
    lastDrawn = state.drawn ?? -1;
    if (state.ready && stable >= 2) break;
    if (state.why === 'no entity world on this page') throw new Error('look: this world has no entity layer');
    await wait(1000);
  }
  if (!state?.ready || stable < 2) throw new Error(`look: viewer did not initialize and settle before timeout (${JSON.stringify(state)})`);
  const frames = await page.evaluate(([e0, a, roofs, cutAt, fitSpan]) => new Promise((res) => {
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
  }), [eye, at, hideRoofs, cut, span]);
  await page.waitForTimeout(settleMs);
  const data = await page.evaluate(({ eye, at }) => {
    try {
      const w = window.__simEntity, close = (v, want) => v?.toArray().every((c, i) => Number.isFinite(c) && Math.abs(c - want[i]) <= 1e-4);
      if (!window.__shotReady || !close(w?.camera?.position, eye) || !close(w?.controls?.target, at)) throw Error('look: requested camera changed before capture; retry the shot');
      const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
      return c ? c.toDataURL('image/png') : null;
    } finally { window.__lookRestore?.(); }
  }, frames);
  if (!data) throw new Error('look: no canvas on the page');
  writeFileSync(resolve(out), Buffer.from(data.split(',')[1], 'base64'));
  return { file: resolve(out), ms: now() - t0, state, frames, via: keep ? 'keeper' : 'chrome' };
  } finally { if (!keep) { release(); if (browser) void browser.close().catch(() => {}); } }
}

// One wall-clock deadline includes lease, keeper, navigation, settling and capture. A first look on a busy machine
// (Chrome start, world download, software GL) has taken 40 s: default 120 s, at most 10 min (EDEN_GOD_LOOK_TIMEOUT_MS).
export const LOOK_DEFAULT_MS = 120_000, LOOK_MAX_MS = 600_000;
export async function shoot(options, runtime = {}) {
  const ms = Math.min(LOOK_MAX_MS, Math.max(1, options.timeoutMs ?? Number(process.env.EDEN_GOD_LOOK_TIMEOUT_MS ?? LOOK_DEFAULT_MS)));
  let timer;
  try { return await Promise.race([shootInner({ ...options, timeoutMs: ms }, runtime), new Promise((_, reject) => { timer = setTimeout(() => { runtime.cleanup?.(); reject(Object.assign(new Error(`look.timeout: exceeded ${ms} ms; run doctor --fix`), { code: 'look.timeout' })); }, ms); })]); }
  finally { clearTimeout(timer); }
}
