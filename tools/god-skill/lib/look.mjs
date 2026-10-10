// god look: a screenshot of the world from a chosen viewpoint, for the god's own eyes.
//
// The world's ordinary viewer page renders the picture. Loading that page in a headless browser with
// software GL takes from 20 s (idle laptop) to minutes (busy one), so the first `look` starts a small
// keeper process that holds one Chrome tab on the world (it follows edits live over the hub) and
// later looks only move its camera and read the canvas back: seconds, not minutes. The keeper quits
// after 20 idle minutes (`look --stop` ends it now). State: .eden-god.look.json.
//
// Needs Google Chrome and a Playwright package (playwright-core, playwright or @playwright/test)
// resolvable from the current folder, EDEN_GOD_PLAYWRIGHT_FROM, or the sim repo; else it falls back
// to `npx -y playwright-core screenshot` (slow, UI visible).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPASS, compassKey } from './solver.mjs';

const GL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
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
  return null;
}

/** Camera for a target box: from a compass side (or above), at a distance that frames it. */
export function camera({ target, span, from = 's', dist, inside = false, height }) {
  const key = from === 'above' || from === 'top' ? 'above' : compassKey(from) ?? 's';
  const d = dist ?? Math.max(14, span * (inside ? 0.9 : 1.25) + 8);
  const el = key === 'above' ? 1.35 : inside ? 0.95 : 0.5;            // elevation (radians)
  const u = key === 'above' ? [0, 0.08] : COMPASS[key];
  const eye = [target[0] + u[0] * Math.cos(el) * d, target[1] + (height ?? Math.sin(el) * d), target[2] + u[1] * Math.cos(el) * d];
  return { eye: eye.map((v) => Math.round(v * 10) / 10), at: target.map((v) => Math.round(v * 10) / 10), from: key };
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
  await ctx.addInitScript(() => { const orig = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (type, attrs) { if (/webgl/.test(String(type))) attrs = { ...(attrs || {}), preserveDrawingBuffer: true }; return orig.call(this, type, attrs); }; });
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

/** Take the picture. Returns { file, ms, state, via }. */
export async function shoot({ worldUrl, eye, at, out, hideRoofs = false, expect = 0, timeoutMs = Number(process.env.EDEN_GOD_LOOK_TIMEOUT_MS ?? 900_000), settleMs = 800, cliPath }) {
  mkdirSync(dirname(resolve(out)), { recursive: true });
  const t0 = Date.now();
  const pw = findPlaywright();
  if (!pw) {
    const q = new URLSearchParams({ shot: '1', eye: eye.join(','), at: at.join(',') });
    const r = spawnSync('npx', ['-y', 'playwright-core@1', 'screenshot', '--channel', 'chrome', '--wait-for-timeout', '30000', '--viewport-size', '1024,640', `${worldUrl}?${q}`, resolve(out)], { stdio: 'pipe', encoding: 'utf8', timeout: timeoutMs });
    if (r.status !== 0) throw new Error(`look: no Playwright found and npx playwright-core failed: ${(r.stderr || r.stdout || '').slice(0, 300)}. Install one (npm i -g playwright-core) and Google Chrome`);
    return { file: resolve(out), ms: Date.now() - t0, via: 'npx playwright-core screenshot' };
  }
  const k = await ensureKeeper(worldUrl, cliPath ?? process.argv[1]);
  const browser = await pw.chromium.connectOverCDP(`http://127.0.0.1:${k.port}`, { timeout: 60_000 });
  const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith(worldUrl));
  if (!page) throw new Error('look: the keeper has no world tab; run `look --stop` and look again');
  const deadline = Date.now() + timeoutMs;
  let state = null;
  while (Date.now() < deadline) {
    state = await page.evaluate((want) => {
      const w = window.__simEntity; if (!w?.layer?.active) return { ready: false, why: 'loading the viewer' };
      const drawn = w.layer.drawn; const now = w.layer.now ?? performance.now();
      const easing = drawn ? [...drawn.values()].filter((d) => (now - d.t0) / 1000 < d.dur).length : 0;
      return { ready: (!want || (drawn?.size ?? 0) >= want) && easing === 0, drawn: drawn?.size ?? null, want, easing };
    }, expect).catch((e) => ({ ready: false, why: String(e.message).slice(0, 80) }));
    if (state.ready) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const frames = await page.evaluate(([e, a, roofs]) => new Promise((res) => {
    const w = window.__simEntity;
    w.controls.target.set(a[0], a[1], a[2]); w.camera.position.set(e[0], e[1], e[2]); w.camera.lookAt(w.controls.target); w.controls.update?.();
    const hidden = [];
    if (roofs) w.scene.traverse((o) => { if (o.visible && (/roof/i.test(o.name ?? '') || o.userData?.role === 'roof')) { o.visible = false; hidden.push(o); } });
    window.__lookRestore = () => { for (const o of hidden) o.visible = true; };
    const canvas = document.querySelector('canvas');
    if (canvas) { const keep = new Set(); for (let n = canvas; n; n = n.parentElement) keep.add(n); for (const n of keep) for (const c of n.children ?? []) if (!keep.has(c)) c.style.visibility = 'hidden'; }
    let n = 0; const t = performance.now(); const tick = () => { if (++n >= 4 || performance.now() - t > 120000) res({ n, ms: Math.round(performance.now() - t), roofsHidden: hidden.length }); else requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  }), [eye, at, hideRoofs]);
  await page.waitForTimeout(settleMs);
  const data = await page.evaluate(() => { const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]; const d = c ? c.toDataURL('image/png') : null; window.__lookRestore?.(); return d; });
  if (!data) throw new Error('look: no canvas on the page');
  writeFileSync(resolve(out), Buffer.from(data.split(',')[1], 'base64'));
  return { file: resolve(out), ms: Date.now() - t0, state, frames, via: 'keeper' };
}
