#!/usr/bin/env node
// What a visitor and a god see during a release (lane Z1, backlog G9). Run it before the release, release, then stop it:
//
//   node tools/world-launcher/deploy/release-probe.mjs --origin https://sim.eden.art \
//        --pages /worlds/w/eden-2026/,/w/eden/ [--phone-pages /worlds/w/eden-2026/,/w/eden/] --out <dir> \
//        [--cli <god dir>[,<god dir>…]] [--cli-every 1] [--arrive-every 6] [--max-min 20] [--lease <team>/ops/chrome-lease.mjs]
//   … wait for <dir>/ready, release, wait ~20 s, then: touch <dir>/stop   (or Ctrl-C) → <dir>/report.json + a summary
//
// Watchers: real Chrome (headless, Playwright from mars/viewer) with one desktop context at dpr 1 holding every --pages
// world open, and one phone context (Pixel 7: 412x915, dpr 2.625, touch, mobile) holding --phone-pages. Each page is
// marked once it has arrived; at the end a page still carrying its mark was never reloaded. Every world socket (…/ws)
// is recorded in the page (open, first message, close code), so a socket that drops during the release gives its
// reconnect time: close → first message on the next socket. Every 500 ms the page text is read for an error page
// (Bad Gateway, Service Unavailable, a raw JSON error, …) and for "Reconnecting". Every --arrive-every seconds a fresh
// visitor opens one of the pages in a new tab (round robin, both devices) and must get a 2xx/3xx page with no error
// text within 10 s: a visitor arriving mid-release.
// CLI loop (optional; a god folder per world, as `eden-god.mjs register` + `pair`/`mint` leave it): `place barrel
// --free --name z1-<run>-<n>`, one call started per --cli-every seconds (default 1, under the edit rate limit). A call that fails is retried up to 3 times (as an agent would); a retry
// that finds the name already taken counts as landed. At the end `export` lists the world: lost = a name the CLI said it
// placed that is missing, duplicate = a name placed twice. Every placed barrel is then removed (`clear` by name) unless
// --keep-edits. Unclean = a CLI failure whose output is not the CLI's own sentence (an HTML page, a stack trace).
//
// Bar (G9): errorPages 0, every arrival loaded (document 2xx/3xx within 30 s), lost 0, unclean 0, every reconnect <= 5000 ms, no page reloaded.
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const origin = flag('origin')?.replace(/\/$/, '');
const pages = (flag('pages') ?? '').split(',').filter(Boolean);
const phonePages = (flag('phone-pages') ?? flag('pages') ?? '').split(',').filter(Boolean);
const out = flag('out');
const cliDirs = (flag('cli') ?? '').split(',').filter(Boolean);
const cliBin = resolve(flag('cli-bin', join(ROOT, 'tools/god-skill/eden-god.mjs')));
const arriveEvery = Number(flag('arrive-every', 6)) * 1000;
const maxMs = Number(flag('max-min', 20)) * 60_000;
const settleMs = Number(flag('settle-s', 20)) * 1000;
const keepEdits = argv.includes('--keep-edits');
const cliEvery = Number(flag('cli-every', 1)) * 1000;   // one edit per second per god, under the world's edit rate limit
const leasePath = flag('lease', existsSync('<team>/ops/chrome-lease.mjs') ? '<team>/ops/chrome-lease.mjs' : null);
if (!origin || !pages.length || !out) { console.error('usage: release-probe.mjs --origin <url> --pages <path,…> --out <dir> [--phone-pages …] [--cli <dir,…>]'); process.exit(2); }
mkdirSync(out, { recursive: true });
const STOP = join(out, 'stop');
const t0 = Date.now(), at = () => Date.now() - t0, iso = () => new Date().toISOString();
const say = (s) => console.log(`[probe +${(at() / 1000).toFixed(1)}s] ${s}`);
const ERROR_TEXT = /Bad Gateway|Service Unavailable|Gateway Time-?out|"code":\s*"world\.|world\.unavailable|Internal Server Error|This site can.t be reached|ERR_CONNECTION|No world called|Application error/i;

// ---------- in-page recorder: every WebSocket, plus an arrival mark
const RECORDER = () => {
  const W = window.WebSocket, log = (window.__z1ws = []);
  const Z = function (url, protocols) {
    const ws = protocols === undefined ? new W(url) : new W(url, protocols);
    const rec = { url: String(url), made: Date.now(), open: null, first: null, last: null, close: null, code: null };
    log.push(rec);
    ws.addEventListener('open', () => { rec.open = Date.now(); });
    ws.addEventListener('message', () => { const n = Date.now(); rec.first ??= n; rec.last = n; });
    ws.addEventListener('close', (e) => { rec.close = Date.now(); rec.code = e.code; });
    return ws;
  };
  Z.prototype = W.prototype; Object.assign(Z, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  window.WebSocket = Z;
};
const isWorldSocket = (u) => /\/ws(\?|$)/.test(u);

const report = { origin, startedAt: iso(), pages, phonePages, watchers: [], arrivals: [], cli: [], bar: null };
let browser = null, release = () => {};
async function openBrowser() {
  if (leasePath) { const { chromeLease } = await import(leasePath); release = await chromeLease('release-probe'); }
  const chromium = createRequire(join(ROOT, 'mars/viewer/package.json'))('@playwright/test').chromium;
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
}
const DEVICES = {
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36' },
};
async function context(device) {
  const ctx = await browser.newContext(DEVICES[device]);
  await ctx.addInitScript(RECORDER);
  return ctx;
}

// ---------- watchers
async function watch(ctx, device, path) {
  const w = { device, path, navigations: 0, errors5xx: [], errorText: [], reconnectingText: [], pageErrors: [], sockets: [], marked: false, reloaded: null };
  const page = await ctx.newPage();
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) w.navigations++; });
  page.on('response', (r) => { if (r.status() >= 500) w.errors5xx.push({ at: at(), status: r.status(), url: r.url().slice(0, 160) }); });
  page.on('pageerror', (e) => w.pageErrors.push({ at: at(), message: e.message.slice(0, 160) }));
  const r = await page.goto(origin + path, { waitUntil: 'load', timeout: 120_000 }).catch((e) => ({ status: () => `goto: ${e.message.slice(0, 80)}` }));
  w.status = r?.status?.() ?? null;
  w.page = page;
  return w;
}
async function mark(w) {
  await w.page.evaluate(() => { window.__z1mark = 'arrived'; }).catch(() => {});
  w.marked = true; w.navigationsAtMark = w.navigations;
  await w.page.screenshot({ path: join(out, `${w.device}-${slugOf(w.path)}-1-before.png`) }).catch(() => {});
}
const slugOf = (p) => p.replace(/^\/|\/$/g, '').replace(/[^a-z0-9]+/gi, '-') || 'home';
async function sample(w) {
  const txt = await textOf(w.page); if (txt === null) { w.busy = (w.busy ?? 0) + 1; return; }
  const e = txt.match(ERROR_TEXT); if (e) w.errorText.push({ at: at(), text: e[0] });
  const rc = txt.match(/Reconnecting[^\n]*/); if (rc) w.reconnectingText.push({ at: at(), text: rc[0].slice(0, 80) });
}
async function finish(w) {
  w.reloaded = (await w.page.evaluate(() => window.__z1mark).catch(() => null)) !== 'arrived' || w.navigations !== w.navigationsAtMark;
  w.canvas = await w.page.evaluate(() => [...document.querySelectorAll('canvas')].some((c) => c.width > 0 && c.height > 0)).catch(() => false);
  const socks = (await w.page.evaluate(() => window.__z1ws).catch(() => [])).filter((s) => isWorldSocketIn(s.url));
  // a drop during the watch: close → first message on the next socket of the same world
  w.sockets = socks.map((s) => ({ ...s, made: s.made - t0, open: s.open && s.open - t0, first: s.first && s.first - t0, last: s.last && s.last - t0, close: s.close && s.close - t0 }));
  w.drops = [];
  for (let i = 0; i < w.sockets.length; i++) {
    const s = w.sockets[i]; if (s.close === null || s.close < w.markAt) continue;
    const next = w.sockets.slice(i + 1).find((n) => n.first !== null && n.first >= s.close);
    w.drops.push({ closeAt: s.close, code: s.code, resumedAt: next?.first ?? null, reconnectMs: next ? next.first - s.close : null });
  }
  await w.page.screenshot({ path: join(out, `${w.device}-${slugOf(w.path)}-2-after.png`) }).catch(() => {});
  delete w.page;
}
const isWorldSocketIn = isWorldSocket;

// ---------- fresh arrivals during the release
// The page's text is read with a 2 s cap: a page whose main thread is busy (a heavy world building its scene on a loaded
// machine) is slow, not an error page — it counts as 'busy' samples, and as loaded once its document came back 2xx/3xx.
const textOf = (page) => Promise.race([page.evaluate(() => document.body?.innerText ?? ''), new Promise((r) => setTimeout(() => r(null), 2000))]).catch(() => '');
async function arrive(ctx, device, path) {
  const a = { at: at(), device, path, status: null, errorText: null, gotoMs: null, busy: 0, ms: null };
  const page = await ctx.newPage(); const s = Date.now();
  try {
    const r = await page.goto(origin + path, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    a.status = r?.status() ?? null; a.gotoMs = Date.now() - s;
    for (let i = 0; i < 10 && !a.errorText; i++) {
      const txt = await textOf(page);
      if (txt === null) a.busy++; else { const m = txt.match(ERROR_TEXT); if (m) a.errorText = m[0]; }
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch (e) { a.error = e.message.slice(0, 120); }
  a.ms = Date.now() - s;
  await Promise.race([page.close(), new Promise((r) => setTimeout(r, 5000))]).catch(() => {});
  return a;
}

// ---------- CLI loop
const run = (dir, args, timeout = 240_000) => new Promise((yes) => {
  const s = Date.now();
  execFile(process.execPath, [cliBin, ...args], { cwd: dir, timeout, maxBuffer: 64 << 20 }, (err, stdout, stderr) => yes({ code: err ? (err.code ?? 1) : 0, ms: Date.now() - s, out: `${stdout}${stderr}`.trim() }));
});
async function cliLoop(dir, runId, stopped) {
  const c = { dir, calls: 0, placed: [], failures: [], retries: 0, slowestMs: 0, unclean: 0 };
  let lastStart = 0;
  for (let n = 1; !stopped(); n++) {
    const name = `z1-${runId}-${n}`;
    let landed = false;
    for (let attempt = 0; attempt < 4 && !landed; attempt++) {
      if (attempt) { c.retries++; await new Promise((r) => setTimeout(r, 1000)); }
      const wait = lastStart + cliEvery - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastStart = Date.now();
      const startAt = at(), r = await run(dir, ['place', 'barrel', '--free', '--name', name]); c.calls++;
      c.slowestMs = Math.max(c.slowestMs, r.ms);
      if (r.ms > 5000) (c.slow ??= []).push({ name, startAt, ms: r.ms, code: r.code, out: r.out.slice(-400) });
      if (r.code === 0 && /placed /.test(r.out)) { landed = true; c.placed.push({ name, at: at(), ms: r.ms, attempt }); break; }
      if (attempt && /already|taken|exists|duplicate/i.test(r.out)) { landed = true; c.placed.push({ name, at: at(), ms: r.ms, attempt, byRetry: true }); break; }
      const clean = !/<html|<!doctype|\n\s+at .*\(|Error: |TypeError/i.test(r.out);
      if (!clean) c.unclean++;
      c.failures.push({ name, at: at(), ms: r.ms, code: r.code, clean, out: r.out.slice(-300) });
    }
    if (!landed) c.failures.push({ name, at: at(), gaveUp: true });
  }
  // what is in the world now
  const file = join(out, `export-${slugOf(dir)}.json`);
  const ex = await run(dir, ['export', file]);
  let names = [];
  try { names = (JSON.stringify(JSON.parse(readFileSync(file, 'utf8'))).match(new RegExp(`z1-${runId}-\\d+`, 'g')) ?? []); } catch (e) { c.exportError = `${ex.out.slice(-200)} ${e.message}`; }
  const count = new Map(); for (const n of names) count.set(n, (count.get(n) ?? 0) + 1);
  c.lost = c.placed.filter((p) => !count.has(p.name)).map((p) => p.name);
  c.duplicates = [...count].filter(([, k]) => k > 1).map(([n]) => n);
  c.inWorld = count.size;
  if (!keepEdits) { for (const p of c.placed) await run(dir, ['clear', p.name]); }
  return c;
}

// ---------- main
let stopping = false;
const stopped = () => stopping || existsSync(STOP) || at() > maxMs;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
try {
  await openBrowser();
  const ctxs = { desktop: await context('desktop'), phone: phonePages.length ? await context('phone') : null };
  for (const p of pages) report.watchers.push(await watch(ctxs.desktop, 'desktop', p));
  if (ctxs.phone) for (const p of phonePages) report.watchers.push(await watch(ctxs.phone, 'phone', p));
  say(`${report.watchers.length} watchers open; arriving for ${settleMs / 1000} s`);
  await new Promise((r) => setTimeout(r, settleMs));
  for (const w of report.watchers) { await mark(w); w.markAt = at(); }
  const runId = Date.now().toString(36);
  const clis = cliDirs.map((d) => cliLoop(resolve(d), runId, stopped));
  writeFileSync(join(out, 'ready'), iso());
  say(`READY (${join(out, 'ready')}): release now; then touch ${STOP}`);
  const targets = [...pages.map((p) => ['desktop', p]), ...(ctxs.phone ? phonePages.map((p) => ['phone', p]) : [])];
  let k = 0, nextArrive = Date.now(); const inflight = [];
  while (!stopped()) {
    for (const w of report.watchers) await sample(w);
    if (Date.now() >= nextArrive) { const [d, p] = targets[k++ % targets.length]; inflight.push(arrive(ctxs[d], d, p).then((a) => report.arrivals.push(a))); nextArrive = Date.now() + arriveEvery; }
    await new Promise((r) => setTimeout(r, 500));
  }
  say('stopping: collecting');
  await Promise.all(inflight);   // arrivals in flight (each capped at 40 s)
  for (const w of report.watchers) await finish(w);
  report.cli = await Promise.all(clis);
} finally {
  await browser?.close().catch(() => {}); release();
}

// ---------- verdict
const drops = report.watchers.flatMap((w) => (w.drops ?? []).map((d) => ({ ...d, device: w.device, path: w.path })));
const errorPages = report.watchers.reduce((n, w) => n + w.errorText.length + w.errors5xx.filter((e) => /\.html|\/$|\/\?/.test(e.url)).length, 0)
  + report.arrivals.filter((a) => a.errorText || (a.status !== null && !(a.status >= 200 && a.status < 400))).length;
report.bar = {
  errorPages,
  responses5xx: report.watchers.reduce((n, w) => n + w.errors5xx.length, 0),
  reloaded: report.watchers.filter((w) => w.reloaded).map((w) => `${w.device} ${w.path}`),
  reconnectingShown: report.watchers.filter((w) => w.reconnectingText.length).map((w) => `${w.device} ${w.path} ${w.reconnectingText.length}x`),
  drops: drops.length,
  reconnectMaxMs: drops.length ? Math.max(...drops.map((d) => d.reconnectMs ?? Infinity)) : 0,
  notResumed: drops.filter((d) => d.reconnectMs === null).length,
  arrivals: report.arrivals.length, arrivalsSlowestGotoMs: Math.max(0, ...report.arrivals.map((a) => a.gotoMs ?? 0)),
  arrivalsBusy: report.arrivals.filter((a) => a.busy).length, arrivalsNotLoaded: report.arrivals.filter((a) => a.error).map((a) => `${a.device} ${a.path} +${(a.at / 1000).toFixed(1)}s: ${a.error}`),
  cliCalls: report.cli.reduce((n, c) => n + c.calls, 0), cliPlaced: report.cli.reduce((n, c) => n + c.placed.length, 0),
  cliFailures: report.cli.reduce((n, c) => n + c.failures.length, 0), cliRetries: report.cli.reduce((n, c) => n + c.retries, 0),
  lost: report.cli.reduce((n, c) => n + (c.lost?.length ?? 0), 0), duplicates: report.cli.reduce((n, c) => n + (c.duplicates?.length ?? 0), 0),
  unclean: report.cli.reduce((n, c) => n + c.unclean, 0), cliSlowestMs: Math.max(0, ...report.cli.map((c) => c.slowestMs)),
};
const b = report.bar;
b.pass = b.errorPages === 0 && b.arrivalsNotLoaded.length === 0 && b.lost === 0 && b.unclean === 0 && b.notResumed === 0 && b.reconnectMaxMs <= 5000 && b.reloaded.length === 0;
report.endedAt = iso();
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(b, null, 1));
for (const d of drops) console.log(`  ${d.device} ${d.path}: socket closed (${d.code}) at +${(d.closeAt / 1000).toFixed(1)}s, ${d.reconnectMs === null ? 'NOT resumed' : `resumed in ${d.reconnectMs} ms`}`);
say(b.pass ? 'PASS' : 'FAIL');
process.exit(b.pass ? 0 : 1);
