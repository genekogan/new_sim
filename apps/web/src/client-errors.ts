// Lane ERR (2026-10-21): what real visitors hit, reported first-party to our own launcher (tools/world-launcher/
// client-errors.mjs): JS exceptions, unhandled rejections, a lost WebGL context, assets/scripts that failed to load, a
// socket that dropped or keeps reconnecting, an arrival that never finished. Installed on import (first import of both
// entries). One report per kind of error per page (repeats only add to its count, sent when the page is hidden), at most
// 12 per page, by sendBeacon 3 s after the first. Nothing personal: no names, tokens, ids or Soul words, no query strings
// (text is scrubbed here and again on the server); the server keeps a browser class and a per-day visitor hash only.
import { BASE } from './base-path.ts';

declare const __BUILD__: string;
type Ev = { k: string; m: string; s: string; n: number; ms?: number };
const MAX = 12, STUCK_MS = 60_000, STORM = 6, SAMPLE = 1;
const pending = new Map<string, Ev>(), sent = new Map<string, Ev>();
let build = 'dev', reports = 0, timer: ReturnType<typeof setTimeout> | undefined, on = false, hidden = false, sockets: number[] = [];

export const scrubText = (t: unknown, max = 160) => String(t ?? '').replace(/(\/[^\s?#'"()<>]*)[?#][^\s'"()<>]*/g, '$1')
  .replace(/"[^"]*"|“[^”]*”/g, '"…"').replace(/[\w%.+-]+@[\w.-]+\.\w+/g, '‹email›')
  .replace(/\b(?=[\w-]*\d)[\w-]{20,}\b|\beyJ[\w.-]+/g, '‹id›').slice(0, max);
/** "LiveWorld" from .../assets/LiveWorld-Ab12_xYz.js:3:9 (no build hash, so a kind of error keeps its name across releases). */
export const scriptName = (t: unknown) => /([\w.-]+?)(?:-[\w-]{8})?\.(?:m?js|tsx?)\b/.exec(String(t ?? '').split(/[?#]/)[0])?.[1] ?? '';

function flush() {
  if (timer) clearTimeout(timer); timer = undefined;
  if (!pending.size) return;
  const e = [...pending.values()]; pending.clear();
  for (const x of e) { const s = sent.get(x.k + x.m + x.s); if (s) s.n = 0; }
  try { navigator.sendBeacon(`${BASE}/__sim/client-errors`, JSON.stringify({ b: build, w: /\/w\/([a-z][a-z0-9-]{0,31})/.exec(location.pathname)?.[1], e })); } catch { /* never throws */ }
}
/** Hidden or leaving: send what is queued plus the repeats of what was already sent. */
function bye() {
  for (const [key, s] of sent) if (s.n > 0 && !pending.has(key)) pending.set(key, { ...s });
  flush();
}

export function report(k: string, m: unknown, s: unknown = '') {
  if (!on) return;
  try {
    const ev: Ev = { k, m: scrubText(m), s: k === 'asset' || k === 'res' ? String(s ?? '').replace(/^(data|blob):.*/s, '$1:').split(/[?#]/)[0]!.slice(0, 160) : scrubText(s, 80), n: 1 };
    const key = ev.k + ev.m + ev.s, p = pending.get(key) ?? sent.get(key);
    if (p) { p.n++; return; }
    if (reports >= MAX) return;
    reports++; sent.set(key, { ...ev, n: 0 }); pending.set(key, ev);
    timer ??= setTimeout(flush, 3000);
  } catch { /* reporting never breaks the page */ }
}

/** The viewer socket: an abnormal close while the page is shown, and reconnect storms (STORM sockets in a minute). */
export function watchSocket<T extends WebSocket>(ws: T): T {
  try {
    const t = Date.now(); sockets = [...sockets.filter((x) => t - x < 60_000), t];
    if (sockets.length === STORM) report('storm', `${STORM} connects in 60 s`);
    ws.addEventListener('close', (e) => { if (![1000, 1001, 1005].includes(e.code) && document.visibilityState !== 'hidden') report('ws', `close ${e.code}`); });
  } catch { /* never throws */ }
  return ws;
}

/** Lane DASH: one `arrived` sample per world page (ms since navigation to its card going / first live frame), sent with the
 *  next flush (3 s later), only for a page shown the whole time (a background tab's arrival time says nothing). */
function watchArrival() {
  let done = false;
  const take = (name: string, at: number) => {
    if (done || (name !== 'sim:card-done' && name !== 'sim:first-live-frame')) return;
    done = true; if (hidden) return;
    pending.set('arrived', { k: 'arrived', m: '', s: '', n: 1, ms: Math.round(at) }); timer ??= setTimeout(flush, 3000);
  };
  try {
    for (const m of performance.getEntriesByType('mark')) take(m.name, m.startTime);
    if (!done) { const o = new PerformanceObserver((l) => { for (const m of l.getEntries()) take(m.name, m.startTime); if (done) o.disconnect(); }); o.observe({ type: 'mark' }); }
  } catch { /* no User Timing: no sample */ }
}

export function installClientErrors() {
  if (on || typeof window === 'undefined' || typeof navigator?.sendBeacon !== 'function') return;
  build = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';
  on = Math.random() < SAMPLE && (build !== 'dev' || /[?&]errors=1/.test(location.search)) && !/[?&]errors=0/.test(location.search);
  if (!on) return;
  addEventListener('error', (e) => {
    if (e instanceof ErrorEvent) { report('js', e.message || e.error?.message, scriptName(e.filename)); return; }
    const t = (e as Event).target as { tagName?: string; src?: string; href?: string } | null;
    if (t?.tagName) report('res', t.tagName.toLowerCase(), t.src || t.href);
  }, true);
  addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    report('rej', r instanceof Error ? `${r.name}: ${r.message}` : typeof r, r instanceof Error ? scriptName(String(r.stack ?? '').split('\n').slice(1).join(' ')) : '');
  });
  // capture: the canvas' own event; a canvas being torn down (forceContextLoss, then removed) is no failure
  addEventListener('webglcontextlost', (e) => { if ((e.target as Element | null)?.isConnected) report('gl', 'context lost'); }, true);
  addEventListener('pagehide', bye);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { hidden = true; bye(); } });
  if (document.visibilityState === 'hidden') hidden = true;
  if (/\/w\//.test(location.pathname)) watchArrival();
  if (/\/w\//.test(location.pathname)) setTimeout(() => {
    const marks = performance.getEntriesByType('mark').map((x) => x.name).filter((x) => x.startsWith('sim:'));
    if (!hidden && !marks.includes('sim:card-done') && !marks.includes('sim:first-live-frame')) report('arrival', `not done in ${STUCK_MS / 1000} s`, marks.at(-1)?.slice(4) ?? 'no mark');
  }, STUCK_MS);
}
installClientErrors();
