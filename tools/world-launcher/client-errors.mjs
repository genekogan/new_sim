// Client error + arrival-failure reports (lane ERR, 2026-10-21). First-party only: the page's tiny beacon
// (apps/web/src/client-errors.ts) posts what a real visitor hit (a JS exception, an unhandled rejection, a lost WebGL
// context, an asset that failed to load, a socket that dropped or kept reconnecting, an arrival that never finished, a
// world page whose bootstrap failed) to
// POST <base>/__sim/client-errors; the operator reads the summary (GET <base>/__sim/client-errors, direct loopback only,
// or `op.mjs client-errors`), and the public healthz carries one number, `clientErrorsNew` = error kinds first seen since
// this build went live (sim-watch DMs Gene when it grows).
//
// Bounded by construction: a body is at most 8 KB and 10 events; one address may send a body every 5 s (burst 10) and
// the whole site 10 events a second (burst 300), beyond that 429 and nothing is stored; the table keeps at most 500 kinds
// of error (the least recently seen goes first), each with at most 16 worlds/builds/browsers; the event log rotates at
// 256 KB into one older file (<= 512 KB on disk). No PII is stored: the server scrubs every text field again (query
// strings, quoted text, tokens and ids, emails, addresses), keeps a browser class instead of the user agent, and a visitor
// is a hash of (address, user agent) with a salt that lives only in memory for one UTC day, so it counts distinct people
// per day and links nobody across days. No names, tokens, account ids or Soul messages are ever sent or kept.
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TokenBuckets } from './flood.mjs';

export const CLIENT_ERROR_LIMITS = Object.freeze({
  bodyBytes: 8192, eventsPerBody: 10, ipPerS: 0.2, ipBurst: 10, sitePerS: 10, siteBurst: 300,
  maxKinds: 500, maxKeys: 16, logBytes: 256 * 1024, maxVisitorsPerDay: 64, flushMs: 5000,
});
const KINDS = new Set(['js', 'rej', 'gl', 'asset', 'res', 'ws', 'storm', 'arrival', 'boot']);   // boot: the world's config/bootstrap failed

/** Text a page sent, made safe to keep: no query strings, quoted text, tokens/ids, emails, addresses or control chars. */
export function scrub(t, max = 160) {
  return String(t ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\b(bearer|basic)\s+\S+/gi, '$1 ‹x›')
    .replace(/\b(token|key|secret|password|session|auth\w*)\s*[=:]\s*\S+/gi, '$1=‹x›')
    .replace(/[\w%.+-]+@(?:[\w-]+\.)+[\w-]+/g, '‹email›')
    .replace(/(\/[^\s?#'"()<>]*)[?#][^\s'"()<>]*/g, '$1')
    .replace(/"[^"]{0,400}"|“[^”]{0,400}”|«[^»]{0,400}»/g, '"…"')
    .replace(/'[^']{25,400}'/g, "'…'")
    .replace(/\b(?=[\w-]*\d)[\w-]{20,}\b|\beyJ[\w.-]+/g, '‹id›')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b|\b[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){4,7}\b/gi, '‹ip›')
    .replace(/\b[A-Z][a-z]+\b/g, (w) => (CODE_WORDS.test(w) ? w : '‹w›'))
    .replace(/\s+/g, ' ').trim().slice(0, max);
}
// Title-case words kept in error text (the engine's and libraries' own vocabulary); any other one may be a name (a
// Soul's, a person's) and is dropped. Identifiers with inner capitals (TypeError, LiveWorld) and ALLCAPS are kept.
const CODE_WORDS = /^(?:Error|Uncaught|Cannot|Can|Failed|Unexpected|Invalid|Illegal|Script|Maximum|Network|Load|Loading|Not|No|Out|Too|Permission|Quota|Security|Timeout|Operation|Object|Array|Promise|Function|Symbol|Map|Set|Date|Math|Number|String|Boolean|Response|Request|Event|Element|Node|Document|Window|Worker|Blob|Context|Shader|Program|Texture|Buffer|Geometry|Material|Mesh|Scene|Camera|Renderer|Draco|Module|Importing|Dynamically|Chunk|Minified|React|Rendered|Hydration|Warning|The|A|An|Unable|Unknown|Missing|Undefined|Null|Expected|Property|Reading|Assignment|Constant|Aborted|Abort|Fetch|Socket|Closed|Connection|Refused|Internal|Server|Gateway|Service|Unavailable|Bad|Forbidden|Found)$/;
/** An asset/script URL: origin + path only (content hashes kept: they name the file), no query, fragment or ids. */
export function scrubPath(t, max = 160) {
  const s = String(t ?? '').split(/[?#\s]/)[0];
  if (/^(?:data|blob):/i.test(s)) return s.slice(0, 5).toLowerCase();   // an inline or local object: its kind, never its content
  return s.replace(/[\w%.+-]+@(?:[\w-]+\.)+[\w-]+/g, '‹email›').replace(/\buser_\w{6,}|\beyJ[\w.-]+/g, '‹id›')
    .replace(/[^\w./:@%+~-]/g, '').slice(0, max);
}
/** "chrome/phone": the only trace of the user agent that is kept. */
export function browserOf(ua = '') {
  const kind = /iPad|Tablet/.test(ua) ? 'tablet' : /Mobi|iPhone|Android/.test(ua) ? 'phone' : 'desktop';
  const b = /Edg\//.test(ua) ? 'edge' : /Firefox\/|FxiOS/.test(ua) ? 'firefox' : /Chrome\/|CriOS/.test(ua) ? 'chrome' : /Safari\//.test(ua) ? 'safari' : 'other';
  return `${b}/${kind}`;
}
const fpOf = (k, m, s) => createHash('sha256').update(`${k}|${m.replace(/\d+/g, '#')}|${s}`).digest('hex').slice(0, 12);
const bump = (map, key, max) => { if (key in map || Object.keys(map).length < max) map[key] = (map[key] ?? 0) + 1; else map['…'] = (map['…'] ?? 0) + 1; };

/**
 * clientErrors({dir, build}) → {ingest(ip, ua, body:Buffer) → [status, json|null], summary(q), newSinceRelease(), flush()}.
 * `dir` holds agg.json (the table) and events.jsonl (+ events.1.jsonl), both bounded.
 */
export function clientErrors({ dir, build = 'dev', limits = {}, now = Date.now, log = () => {} } = {}) {
  const L = { ...CLIENT_ERROR_LIMITS, ...limits };
  mkdirSync(dir, { recursive: true });
  const aggFile = join(dir, 'agg.json'), logFile = join(dir, 'events.jsonl');
  // The table is re-read when another launcher generation (a release's handover) wrote it since and nothing is unsaved here.
  let agg = { builds: {}, kinds: {} }, seenMtime = -1;
  const mtime = () => { try { return statSync(aggFile).mtimeMs; } catch { return 0; } };
  const load = () => {
    const m = mtime(); if (m === seenMtime || dirty) return; seenMtime = m;
    try { const a = JSON.parse(readFileSync(aggFile, 'utf8')); if (a && typeof a.kinds === 'object') agg = { builds: a.builds ?? {}, kinds: a.kinds }; } catch { /* first run */ }
    if (!agg.builds[build]) { agg.builds[build] = now(); later(); }
    for (const b of Object.keys(agg.builds).sort((x, y) => agg.builds[x] - agg.builds[y]).slice(0, -20)) delete agg.builds[b];
  };
  const ips = new TokenBuckets(L.ipPerS, L.ipBurst, now), site = new TokenBuckets(L.sitePerS, L.siteBurst, now);
  const stats = { accepted: 0, rate: 0, size: 0, bad: 0 };
  let salt = { day: '', key: Buffer.alloc(0) }, timer = null, dirty = false, logSize = -1;
  const visitor = (ip, ua, day) => {
    if (salt.day !== day) salt = { day, key: randomBytes(16) };
    return createHash('sha256').update(salt.key).update(`${ip}\n${ua}`).digest('hex').slice(0, 12);
  };
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!dirty) return; dirty = false;
    try { writeFileSync(`${aggFile}.tmp`, JSON.stringify(agg)); renameSync(`${aggFile}.tmp`, aggFile); seenMtime = mtime(); } catch (e) { log(`client-errors: cannot write the table: ${e.message}`); }
  };
  const later = () => { dirty = true; if (!timer) { timer = setTimeout(flush, L.flushMs); timer.unref?.(); } };
  const append = (row) => {
    try {
      if (logSize < 0) { try { logSize = statSync(logFile).size; } catch { logSize = 0; } }
      if (logSize > L.logBytes) { renameSync(logFile, `${logFile.slice(0, -6)}.1.jsonl`); logSize = 0; }   // the older file is replaced: <= 2 files
      const line = `${JSON.stringify(row)}\n`; appendFileSync(logFile, line); logSize += line.length;
    } catch (e) { log(`client-errors: cannot append: ${e.message}`); }
  };
  const evict = () => {
    const keys = Object.keys(agg.kinds); if (keys.length <= L.maxKinds) return;
    keys.sort((a, b) => agg.kinds[a].last - agg.kinds[b].last);
    for (const k of keys.slice(0, keys.length - L.maxKinds)) delete agg.kinds[k];
  };

  function ingest(ip, ua, body) {
    if (!body || body.length > L.bodyBytes) { stats.size++; return [413, { ok: false, code: 'too-large' }]; }
    if (ips.take(`ip:${ip}`)) { stats.rate++; return [429, { ok: false, code: 'slow-down' }]; }
    load();
    let d; try { d = JSON.parse(body.toString('utf8')); } catch { stats.bad++; return [400, { ok: false, code: 'bad-json' }]; }
    const events = Array.isArray(d?.e) ? d.e.slice(0, L.eventsPerBody) : [];
    const b = typeof d?.b === 'string' && /^[\w.-]{1,40}$/.test(d.b) ? d.b : '?';
    const w = typeof d?.w === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(d.w) ? d.w : 'home';
    const c = browserOf(String(ua ?? '')), t = now(), day = new Date(t).toISOString().slice(0, 10), v = visitor(ip, String(ua ?? ''), day);
    let took = 0;
    for (const e of events) {
      const k = typeof e?.k === 'string' && KINDS.has(e.k) ? e.k : null;
      if (!k) { stats.bad++; continue; }
      if (site.take('site')) { stats.rate++; continue; }
      const m = scrub(e.m), s = k === 'asset' || k === 'res' ? scrubPath(e.s) : scrub(e.s, 80);
      const n = Math.min(1000, Math.max(1, Math.floor(Number(e.n) || 1)));
      const fp = fpOf(k, m, s);
      let a = agg.kinds[fp];
      if (!a) { a = agg.kinds[fp] = { k, m, s, count: 0, visitorDays: 0, first: t, last: t, firstBuild: b, builds: {}, worlds: {}, browsers: {}, vday: '', vh: [] }; evict(); }
      a.count += n; a.last = t;
      bump(a.builds, b, L.maxKeys); bump(a.worlds, w, L.maxKeys); bump(a.browsers, c, L.maxKeys);
      if (a.vday !== day) { a.vday = day; a.vh = []; }
      if (!a.vh.includes(v) && a.vh.length < L.maxVisitorsPerDay) { a.vh.push(v); a.visitorDays++; }
      append({ t, fp, k, w, b, c, v, n });
      took++; stats.accepted++;
    }
    if (took) later();
    return [204, null];
  }

  const since = () => agg.builds[build];
  function summary({ limit = 50, world } = {}) {
    load();
    const rows = Object.entries(agg.kinds).filter(([, a]) => !world || a.worlds[world])
      .sort(([, a], [, b]) => b.count - a.count).slice(0, Math.max(1, Math.min(500, Number(limit) || 50)))
      .map(([fp, a]) => ({ fp, kind: a.k, message: a.m, source: a.s, count: a.count, visitors: a.visitorDays, first: new Date(a.first).toISOString(), last: new Date(a.last).toISOString(),
        firstBuild: a.firstBuild, new: a.first >= since(), builds: a.builds, worlds: a.worlds, browsers: a.browsers }));
    return { ok: true, build, since: new Date(since()).toISOString(), kinds: Object.keys(agg.kinds).length, newSinceRelease: newSinceRelease(), stats: { ...stats }, top: rows };
  }
  function newSinceRelease() { load(); const s = since(); let n = 0; for (const a of Object.values(agg.kinds)) if (a.first >= s) n++; return n; }
  return { ingest, summary, newSinceRelease, flush };
}
