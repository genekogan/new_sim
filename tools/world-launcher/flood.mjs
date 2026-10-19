// The launcher's coarse ceiling (lane P2, 2026-10-19). Every world shares this one event loop, so a flood is refused here,
// before a connection to its world is even opened. The worlds' own buckets (apps/server/src/flood.ts: a god token 10/s,
// an address 40 reads + 20 writes a second) are tighter and give the precise refusal; this one only trips on traffic no
// person or agent sends: more than 30 requests a second from one god token, or 100 API requests/writes a second from one
// address (several people behind one NAT included). Page and static-file GETs are never counted here.
import { createHash } from 'node:crypto';

export const LAUNCHER_FLOOD = Object.freeze({ godTokenPerS: 30, godTokenBurst: 900, ipPerS: 100, ipBurst: 2000 });

export class TokenBuckets {
  constructor(perS, burst, now = Date.now) { this.perS = perS; this.burst = burst; this.now = now; this.b = new Map(); this.calls = 0; }
  /** 0 when allowed, else ms until one token is back */
  take(key) {
    const now = this.now(); let e = this.b.get(key);
    if (!e) { e = { t: this.burst, at: now }; this.b.set(key, e); }
    else { e.t = Math.min(this.burst, e.t + Math.max(0, now - e.at) * this.perS / 1000); e.at = now; }
    if (++this.calls % 5000 === 0) for (const [k, x] of this.b) if (x.t + (now - x.at) * this.perS / 1000 >= this.burst) this.b.delete(k);
    if (e.t >= 1) { e.t -= 1; return 0; }
    return Math.max(1, Math.ceil((1 - e.t) * 1000 / this.perS));
  }
}

const short = (s) => createHash('sha256').update(s).digest('hex').slice(0, 8);

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
