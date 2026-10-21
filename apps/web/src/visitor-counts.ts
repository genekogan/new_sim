// Lane t4-analytics (Gene 2026-10-21): visitor counts for sim.eden.art in GoatCounter, the same as genekogan.com and
// mars.college. Site code `simeden`, dashboard https://simeden.goatcounter.com. No GoatCounter script is loaded: the page
// sends GoatCounter's own count requests (https://<code>.goatcounter.com/count?p=…, what its count.js sends) itself, so
// the page grows by well under 1 KB and runs no third-party code. Cookieless and nothing personal: a world page counts as
// /w/<slug> (never a query string, hash, Soul id, code or token), the world list as /, a referrer as its origin only,
// the screen as its width (GoatCounter's phone/tablet/desktop split). Three events, counts only: "enter world <slug>"
// (the arrival card went), "soul paired" (a Soul approved for an agent), "god connected" (a world's god approved).
// Off: on local and private hosts (dev, tests, e2e), under automation (navigator.webdriver: every Playwright walk, the
// release probe, poster, stall and cdn-walk of ship.sh), on ?shot looks, in a browser that set localStorage
// skipgc=t (GoatCounter's own opt-out), and in a build with SIM_GOATCOUNTER=off (vite.config.ts; a code or a full
// count URL selects another site, default `simeden`).
import { whenMarked } from './arrival-marks.ts';

declare const __SIM_GOATCOUNTER__: string | undefined;
const DEFAULT_CODE = 'simeden';

/** The count URL a setting names: a GoatCounter code, a full http(s) count URL, or null for off ('', 'off', '0'). */
export function countEndpoint(setting: string | undefined): string | null {
  const v = (setting ?? DEFAULT_CODE).trim();
  if (!v || v === 'off' || v === '0') return null;
  if (/^[a-z0-9][a-z0-9-]{0,62}$/.test(v)) return `https://${v}.goatcounter.com/count`;
  try { const u = new URL(v); return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin + u.pathname : null; } catch { return null; }
}

/** A host nobody outside reaches: never counted (localhost, *.localhost/.test/.local/.internal/.ts.net, loopback, private,
 *  link-local and tailnet addresses). */
export function localHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h || h === 'localhost' || h === '0.0.0.0' || /\.(localhost|test|local|internal|lan|home\.arpa|ts\.net)$/.test(h)) return true;
  if (h.includes(':')) return h === '::1' || /^(f[cd]|fe[89ab])/.test(h) || h.startsWith('::ffff:') && localHost(h.slice(7));
  return /^(127|10)\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h)
    || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h);
}

/** The counted path of a page: /w/<slug> for a world page (any base, nothing after the slug), / for the world list, else
 *  null (not counted). */
export function countedPath(pathname: string, base: string): string | null {
  const p = base && (pathname === base || pathname.startsWith(base + '/')) ? pathname.slice(base.length) || '/' : pathname;
  if (p === '/') return '/';
  const m = p.match(/^\/w\/([a-z][a-z0-9-]{0,31})(?:\/|$)/);
  return m ? '/w/' + m[1] : null;
}

/** A referrer as counted: another site's origin only; one of ours as its counted path; anything else nothing. */
export function countedReferrer(referrer: string, origin: string, base: string): string {
  try {
    const u = new URL(referrer);
    if (u.origin === origin) { const p = countedPath(u.pathname, base); return p ? origin + p : ''; }
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : '';
  } catch { return ''; }
}

/** One count request: GoatCounter's parameters (p path, t title, r referrer, s screen width, e event). */
export function countUrl(endpoint: string, f: { path: string; title?: string; referrer?: string; width?: number; event?: boolean }): string {
  const q = new URLSearchParams({ p: f.path });
  if (f.title) q.set('t', f.title);
  if (f.referrer) q.set('r', f.referrer);
  if (f.width && f.width > 0) q.set('s', String(Math.round(f.width)));
  if (f.event) q.set('e', 'true');
  q.set('rnd', Math.random().toString(36).slice(2, 8));
  return endpoint + '?' + q;
}

let endpoint: string | null | undefined, width = 0;
/** This page's count URL, or null when this page is not counted (decided once). */
function counting(): string | null {
  if (endpoint !== undefined) return endpoint;
  endpoint = null;
  try {
    if (typeof location === 'undefined' || typeof navigator === 'undefined' || navigator.webdriver) return null;
    if (localHost(location.hostname) || new URLSearchParams(location.search).has('shot')) return null;
    try { if (localStorage.getItem('skipgc') === 't') return null; } catch { /* storage blocked: still counted */ }
    try { width = screen.width; } catch { /* no screen */ }
    endpoint = countEndpoint(typeof __SIM_GOATCOUNTER__ === 'string' ? __SIM_GOATCOUNTER__ : undefined);
  } catch { endpoint = null; }
  return endpoint;
}

function send(url: string) {
  try { if (navigator.sendBeacon?.(url)) return; } catch { /* fall back to an image */ }
  try { const img = new Image(); img.referrerPolicy = 'no-referrer'; img.src = url; } catch { /* never breaks the page */ }
}

export type CountedEvent = 'soul paired' | 'god connected';
/** Count one event (a fixed name: no ids ever). */
export function countEvent(name: CountedEvent | `enter world ${string}`) {
  const at = counting(); if (at) send(countUrl(at, { path: name, title: name, width, event: true }));
}

/** Count this page view once, and its world entry once the arrival card has gone. */
let counted = false;
export function countPage(base: string) {
  if (counted) return; counted = true;
  const at = counting(); if (!at) return;
  const path = countedPath(location.pathname, base); if (!path) return;
  const slug = path.startsWith('/w/') ? path.slice(3) : null;
  send(countUrl(at, { path, title: slug ?? 'worlds', referrer: countedReferrer(document.referrer, location.origin, base), width }));
  if (slug) void whenMarked('card-done').then(() => countEvent(`enter world ${slug}`));
}
