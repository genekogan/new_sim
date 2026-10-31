// The launcher's coarse ceiling (lane P2, 2026-10-19). Every world shares this one event loop, so a flood is refused here,
// before a connection to its world is even opened. The worlds' own buckets (apps/server/src/flood.ts: a god token 10/s,
// an address 40 reads + 20 writes a second) are tighter and give the precise refusal; this one only trips on traffic no
// person or agent sends: more than 30 requests a second from one god token, or 100 API requests/writes a second from one
// address (several people behind one NAT included). Page and static-file GETs are never counted here.
import { createHash } from 'node:crypto';

export const LAUNCHER_FLOOD = Object.freeze({ godTokenPerS: 30, godTokenBurst: 900, ipPerS: 100, ipBurst: 2000 });

export class TokenBuckets {
  constructor(perS, burst, now = Date.now) { this.perS = perS; this.burst = burst; this.now = now; this.b = new Map(); this.calls = 0; }
  /** 0 when allowed, else ms until one token is back. `force`: the request was already let through (counted after
   *  the fact): take the token even when there is none, down to one burst of debt, and answer 0 */
  take(key, force = false) {
    const now = this.now(); let e = this.b.get(key);
    if (!e) { e = { t: this.burst, at: now }; this.b.set(key, e); }
    else { e.t = Math.min(this.burst, e.t + Math.max(0, now - e.at) * this.perS / 1000); e.at = now; }
    if (++this.calls % 5000 === 0) for (const [k, x] of this.b) if (x.t + (now - x.at) * this.perS / 1000 >= this.burst) this.b.delete(k);
    if (e.t >= 1 || force) { e.t = Math.max(-this.burst, e.t - 1); return 0; }
    return Math.max(1, Math.ceil((1 - e.t) * 1000 / this.perS));
  }
}

export const short = (s) => createHash('sha256').update(s).digest('hex').slice(0, 8);

/**
 * check(req, rest, behindProxy) → null (go on) or { status: 429, body, headers } for the caller to send.
 * `rest` is the path inside the world (/v1/...). Requests without a proxy's x-forwarded-for come from this machine and
 * are not address-limited.
 */
export function launcherFlood({ limits = {}, now = Date.now, log = (l) => console.warn(`[launcher] ${l}`), everyMs = 60_000 } = {}) {
  const L = { ...LAUNCHER_FLOOD, ...limits };
  const tokens = new TokenBuckets(L.godTokenPerS, L.godTokenBurst, now), ips = new TokenBuckets(L.ipPerS, L.ipBurst, now);
  const seen = new Map();
  const note = (id, what) => {
    const t = now(), e = seen.get(id);
    if (!e || t - e.since >= everyMs) {
      if (e?.n) log(`refused ${id}: ${e.n} more in the last ${Math.round((t - e.since) / 1000)} s (latest ${e.last})`);
      else if (!e) log(`refused ${id}: ${what} (further refusals counted, one line a minute)`);
      seen.set(id, { n: 0, since: t, last: what }); if (seen.size > 10_000) seen.clear(); return;
    }
    e.n++; e.last = what;
  };
  const refuse = (scope, key, why, waitMs, what) => {
    const s = Math.max(1, Math.ceil(waitMs / 1000)); note(`${scope} ${key}`, what);
    return { status: 429, headers: { 'retry-after': String(s), 'cache-control': 'no-store' }, body: { ok: false, code: 'rate-limited', message: `slow down: ${why}; try again in ${s} s`, retry_after: s, retryAfterMs: waitMs, limit: { scope } } };
  };
  return (req, rest, behindProxy, slug) => {
    const write = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
    if (!write && !rest.startsWith('/v1/')) return null;
    const what = `${req.method} ${slug} ${rest.split('?')[0]}`;
    const auth = req.headers.authorization ?? '', m = /^Bearer\s+(god_\S+)/i.exec(auth);
    if (m) { const key = short(m[1]), wait = tokens.take(key); if (wait) return refuse('god-token', key, `more than ${L.godTokenPerS * 60} requests a minute from this god token`, wait, what); }
    const xff = behindProxy ? req.headers['x-forwarded-for'] : undefined;
    if (xff) { const ip = String(xff).split(',')[0].trim(), key = short(ip), wait = ips.take(ip); if (wait) return refuse('address', key, `more than ${L.ipPerS * 60} requests a minute from your address`, wait, what); }
    return null;
  };
}

// ---------- Ceilings for untrusted clients (lane L1, LOAD-CONTRACT §2b; Gene 2026-10-31: agents that run Souls are
// untrusted users, the world must be immune to being hammered). Exact limits on the Soul API, answered at once by the
// launcher (no world call, no held refusal), registry-tunable per world (`limits` in worlds.json, op.mjs set-limits).
// Per address only behind the reverse proxy (x-forwarded-for, which Caddy sets itself); this machine is never limited by
// address. Caddy, not the launcher, accepts the connections, so "connections per address" is counted as the address's
// requests in flight to world APIs and its WebSockets.
// Re-derived 2026-10-31 (Gene, 13:40Z, team/scratch/ship/CEILINGS-DECISION-20261031.md: "I want real scalability
// solutions, not limits"): a floor an order of magnitude above legitimate use — 6 Souls at home are 20–30 requests per
// 10 s and ~110 heavy per minute; the first numbers were set before Stage A was measured and sat at that edge. The world
// budget is a stop-gap until shedding is load-driven (the world's green/amber/red/black, LOAD-CONTRACT §1).
export const SOUL_CEILINGS = Object.freeze({
  ipPer10s: 600,            // Soul API requests per address per world per 10 s
  ipConcurrent: 50,         // API requests in flight + WebSockets per address
  ipListen: 40,             // listen/wait long-polls per address
  soulListen: 4,            // listen/wait per Soul token (a Soul needs 1–2; more is a client bug)
  accountListen: 40,        // listen/wait per account (learned from the world's x-sim-account header, else per Soul)
  accountHeavyPerMin: 900,  // C1/C2 per account (as above) per minute
  worldBudgetRps: 200,      // C1/C2 forwarded to the world's main thread per second, every Soul together (bursts of 2 s); reads its read workers answer are exempt. Stop-gap until shedding is load-driven
  maxBodyKb: 64,            // a Soul API request body (body uploads excepted)
  c3CacheMs: 1000,          // C3 public reads: one world call per this long per URL (the micro-cache)
});

/** LOAD-CONTRACT §2 request classes for a path inside a world: 'C0' | 'listen' (C0 long-polls) | 'C1' | 'C2' | 'C3' | null. */
export function requestClass(rest, method = 'GET') {
  const read = method === 'GET' || method === 'HEAD';
  if (rest === '/healthz' || rest === '/v1/config') return 'C0';
  if (rest === '/v1/world/snapshot') return read ? 'C3' : null;
  if (!rest.startsWith('/v1/edge/')) return null;
  const r = rest.slice('/v1/edge/'.length);
  if (/^(inbox\/listen|wait)\/?$/.test(r)) return 'listen';
  if (/^(receipts(\/|$)|inbox(\/|$)|schema\/?$|boot\/static\/?$)/.test(r)) return 'C0';
  // `around` explores (it records the places found and invalidates menus): a write, as in-world admission classes it
  if (/^around\/?$/.test(r)) return 'C1';
  // public/souls/:id is the visitor page's Soul chip (apps/web PublicSoulRecord): a public read, served without a token
  if (read && /^(map|rides|items|platforms)\/?$|^public\//.test(r)) return 'C3';
  return read ? 'C2' : 'C1';
}

export function soulCeilings({ limitsFor = () => null, now = Date.now, log = (l) => console.warn(`[launcher] ${l}`) } = {}) {
  const buckets = new Map(), counts = new Map(), accounts = new Map(), refused = new Map();
  const bucket = (name, perS, burst) => { const k = `${name}:${perS}:${burst}`; let b = buckets.get(k); if (!b) buckets.set(k, b = new TokenBuckets(perS, burst, now)); return b; };
  const n = (k) => counts.get(k) ?? 0;
  const add = (k, d) => { const v = n(k) + d; if (v > 0) counts.set(k, v); else counts.delete(k); };
  const seen = new Map();
  const note = (slug, code, scope) => {
    const r = refused.get(slug) ?? {}; r[code] = (r[code] ?? 0) + 1; refused.set(slug, r);
    const t = now(), id = `${slug} ${scope}`, e = seen.get(id);
    if (!e || t - e.since >= 60_000) { log(`ceiling ${code} on ${id}${e?.n ? ` (+${e.n} in the last minute)` : ''}`); seen.set(id, { since: t, n: 0 }); if (seen.size > 10_000) seen.clear(); } else e.n++;
  };
  const limits = (slug) => ({ ...SOUL_CEILINGS, ...(limitsFor(slug) ?? {}) });
  const no = (slug, status, code, scope, waitMs, message) => {
    const s = Math.max(1, Math.ceil(waitMs / 1000)); note(slug, code, scope);
    return { refuse: { status, headers: { 'retry-after': String(s), 'cache-control': 'no-store' }, body: { ok: false, code, message: `${message}; try again in ${s} s`, retry_after: s, limit: { scope } } } };
  };
  const soulOf = (req) => { const t = /^Bearer\s+(sim_\S+)/i.exec(req.headers.authorization ?? '')?.[1]; return t ? short(t) + short(t + '.') : null; };
  return {
    limits, refused: (slug) => ({ ...(refused.get(slug) ?? {}) }), soulOf,
    /** Count (and log, once a minute per world) a refusal made elsewhere: the launcher's boot and load admission. */
    note: (slug, code, scope) => note(slug, code, scope),
    /** The world says which account a Soul token belongs to (an opaque id): its Souls share the account's ceilings. */
    learn(soul, account) { if (soul && account) { accounts.set(soul, short(String(account))); if (accounts.size > 50_000) accounts.clear(); } },
    /** A WebSocket from `ip` (behind the proxy): admitted, or refused; release() when it closes. */
    socket(slug, ip) {
      if (!ip) return { release() {} };
      const l = limits(slug);
      if (n(`c|${ip}`) >= l.ipConcurrent) { note(slug, 'client.rate', 'address'); return null; }
      add(`c|${ip}`, 1); let done = false;
      return { release() { if (!done) { done = true; add(`c|${ip}`, -1); } } };
    },
    /** The world budget (main's share) for a request let through without it (`worldDeferred`): a read meant for the
     *  read workers that goes to main after all. null = go on, else { refuse }; `force` (main already answered it): counted,
     *  never refused. */
    chargeWorld(slug, { force = false } = {}) {
      const l = limits(slug), wait = bucket('world', l.worldBudgetRps, l.worldBudgetRps * 2).take(slug, force);
      return wait ? no(slug, 503, 'world.busy', 'world', wait, 'this world is answering as many requests as it can') : null;
    },
    /** One request to a world: null (not an API request: go on), { refuse } or { cls, soul, release(), worldDeferred }.
     *  `toWorker`: a C2 read the world's read workers will answer (Stage B): the world budget, which protects the tick
     *  thread, is not taken here; chargeWorld() takes it if the read reaches main after all. */
    check(req, slug, rest, behindProxy, { toWorker = false } = {}) {
      if (!rest.startsWith('/v1/') && rest !== '/healthz') return null;
      const cls = requestClass(rest, req.method), edge = rest.startsWith('/v1/edge/'), l = limits(slug);
      // only the Soul API is ceilinged: god and world routes (the world creator's own coding agent) keep the god-token
      // bucket and the address flood guard (launcherFlood); a C3 public read still gets its class for the micro-cache
      if (!edge) return cls === 'C3' ? { cls, soul: null, release() {} } : null;
      const xff = behindProxy ? req.headers['x-forwarded-for'] : undefined, ip = xff ? String(xff).split(',')[0].trim() : null;
      const soul = soulOf(req), acct = soul ? accounts.get(soul) ?? soul : null, heavy = edge && (cls === 'C1' || cls === 'C2');
      const len = Number(req.headers['content-length'] ?? 0);
      if (edge && !rest.startsWith('/v1/edge/body/uploads') && len > l.maxBodyKb * 1024) { note(slug, 'request.too-large', 'body'); return { refuse: { status: 413, headers: { 'cache-control': 'no-store' }, body: { ok: false, code: 'request.too-large', message: `a request body may be at most ${l.maxBodyKb} KB` } } }; }
      if (heavy && !req.headers.authorization) { note(slug, 'auth.required', 'token'); return { refuse: { status: 401, headers: { 'cache-control': 'no-store' }, body: { ok: false, code: 'auth.required', message: 'this needs a Soul token' } } }; }
      if (ip) {
        { const wait = bucket('ip', l.ipPer10s / 10, l.ipPer10s).take(`${slug}|${ip}`); if (wait) return no(slug, 429, 'client.rate', 'address', wait, `more than ${l.ipPer10s} requests in 10 s from your address to this world`); }
        if (n(`c|${ip}`) >= l.ipConcurrent) return no(slug, 429, 'client.rate', 'address', 1000, `more than ${l.ipConcurrent} requests at once from your address`);
        if (cls === 'listen' && n(`l|${ip}`) >= l.ipListen) return no(slug, 429, 'client.rate', 'address', 5000, `more than ${l.ipListen} listening connections from your address`);
      }
      if (cls === 'listen' && soul) {
        if (n(`ls|${soul}`) >= l.soulListen) return no(slug, 429, 'soul.busy', 'soul', 5000, `this Soul already holds ${l.soulListen} listening connections`);
        if (n(`la|${acct}`) >= l.accountListen) return no(slug, 429, 'account.rate', 'account', 5000, `this account already holds ${l.accountListen} listening connections`);
      }
      if (heavy && acct) { const wait = bucket('acct', l.accountHeavyPerMin / 60, Math.max(1, Math.round(l.accountHeavyPerMin / 4))).take(acct); if (wait) return no(slug, 429, 'account.rate', 'account', wait, `more than ${l.accountHeavyPerMin} requests a minute from this account's Souls`); }
      const worldDeferred = heavy && toWorker && cls === 'C2';
      if (heavy && !worldDeferred) { const wait = bucket('world', l.worldBudgetRps, l.worldBudgetRps * 2).take(slug); if (wait) return no(slug, 503, 'world.busy', 'world', wait, 'this world is answering as many requests as it can'); }
      const keys = [...(ip ? [`c|${ip}`] : []), ...(cls === 'listen' ? [...(ip ? [`l|${ip}`] : []), ...(soul ? [`ls|${soul}`, `la|${acct}`] : [])] : [])];
      for (const k of keys) add(k, 1);
      let done = false;
      return { cls, soul, worldDeferred, release() { if (done) return; done = true; for (const k of keys) add(k, -1); } };
    },
  };
}

/** C3 public reads (LOAD-CONTRACT §2): one world call per URL per `ttlMs`, concurrent misses share it (single flight). */
export class MicroCache {
  constructor({ now = Date.now, maxEntries = 500, maxBytes = 8 * 2 ** 20 } = {}) { this.now = now; this.maxEntries = maxEntries; this.maxBytes = maxBytes; this.m = new Map(); this.flying = new Map(); this.hits = 0; this.misses = 0; }
  /** fetch() → Promise<{ status, headers, body: Buffer }>; resolves with that response and whether it was shared. */
  async get(key, ttlMs, fetch) {
    const t = this.now(), e = this.m.get(key);
    if (e && t - e.at < ttlMs) { this.hits++; return { ...e.r, cache: 'hit' }; }
    const f = this.flying.get(key);
    if (f) { this.hits++; return { ...(await f), cache: 'shared' }; }
    this.misses++;
    const p = fetch().then((r) => { if (r.status === 200 && r.body.length <= this.maxBytes) { this.m.set(key, { at: this.now(), r }); if (this.m.size > this.maxEntries) this.m.delete(this.m.keys().next().value); } return r; }).finally(() => this.flying.delete(key));
    this.flying.set(key, p);
    return { ...(await p), cache: 'miss' };
  }
}
