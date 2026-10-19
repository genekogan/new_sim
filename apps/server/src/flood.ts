// Runaway-agent protection (lane P2, 2026-10-19). One overall token bucket per god token (helpers draw from their lead's)
// and per visitor address, in front of every /v1 route, on top of the per-route allowances (god/rate-limit.ts, souls.ts).
// Generous: Gene's fastest Godmode builds (team/reviews/godmode-observe-20261017, 6,007 traced requests) peaked at 6
// requests in a second, 34 in 10 s and 157 in a minute for one token, so a real builder never empties these buckets;
// a tight loop does, then gets one request per refill step. Refusals are a 429 with Retry-After and a sentence the CLI
// prints, and are logged (rate-limited: one line per key at once, then one summary a minute).
import type { Context, MiddlewareHandler } from 'hono';
import { createHash } from 'node:crypto';

export const FLOOD_LIMITS = Object.freeze({
  /** Every /v1 request carrying one god token (and its helpers): 600 a minute sustained, 300 at once. */
  godTokenPerS: 10, godTokenBurst: 300,
  /** Writes (anything but GET/HEAD) from one visitor address: several builders behind one NAT still fit. */
  ipWritesPerS: 20, ipWritesBurst: 600,
  /** API reads from one visitor address (a page load reads tiles, the snapshot, config...). */
  ipReadsPerS: 40, ipReadsBurst: 800,
});

/** Token buckets keyed by string; take() answers 0 (allowed) or how many ms until one token is back. */
export class TokenBuckets {
  private b = new Map<string, { t: number; at: number }>(); private calls = 0;
  readonly perS: number; readonly burst: number; private now: () => number;
  constructor(perS: number, burst: number, now: () => number = Date.now) { this.perS = perS; this.burst = burst; this.now = now; }
  take(key: string): number {
    const now = this.now(); let e = this.b.get(key);
    if (!e) { e = { t: this.burst, at: now }; this.b.set(key, e); }
    else { e.t = Math.min(this.burst, e.t + Math.max(0, now - e.at) * this.perS / 1000); e.at = now; }
    if (++this.calls % 5000 === 0) this.prune(now);
    if (e.t >= 1) { e.t -= 1; return 0; }
    return Math.max(1, Math.ceil((1 - e.t) * 1000 / this.perS));
  }
  /** forget full buckets: a key nobody used lately costs nothing to recreate */
  prune(now = this.now()) { for (const [k, e] of this.b) if (e.t + (now - e.at) * this.perS / 1000 >= this.burst) this.b.delete(k); }
  get size() { return this.b.size; }
}

/** Refusals in the log without flooding it: the first per key at once, then a count per key every `everyMs`. */
export class RefusalLog {
  private seen = new Map<string, { n: number; since: number; last: string }>();
  private write: (line: string) => void; private everyMs: number; private now: () => number;
  constructor(write: (line: string) => void = (l) => console.warn(l), everyMs = 60_000, now: () => number = Date.now) {
    this.write = write; this.everyMs = everyMs; this.now = now;
    const t = setInterval(() => this.flush(), everyMs); t.unref?.();
  }
  note(scope: string, key: string, what: string) {
    const id = `${scope} ${key}`, now = this.now(), e = this.seen.get(id);
    if (!e) { this.seen.set(id, { n: 0, since: now, last: what }); this.write(`[limit] refused ${scope} ${key}: ${what} (further refusals counted, one line a minute)`); return; }
    e.n++; e.last = what;
    if (now - e.since >= this.everyMs) this.flushOne(id, e, now);
  }
  private flushOne(id: string, e: { n: number; since: number; last: string }, now: number) {
    if (e.n) this.write(`[limit] refused ${id}: ${e.n} more in the last ${Math.round((now - e.since) / 1000)} s (latest ${e.last})`);
    if (e.n) { e.n = 0; e.since = now; } else this.seen.delete(id);
  }
  flush() { const now = this.now(); for (const [id, e] of this.seen) if (now - e.since >= this.everyMs) this.flushOne(id, e, now); }
}

const short = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 8);

export type FloodDeps = {
  /** the pool a god token draws from (its lead's hash for a helper), or null for no god token */
  godPool: (token: string) => string | null;
  limits?: Partial<Record<keyof typeof FLOOD_LIMITS, number>>;
  log?: RefusalLog;
  now?: () => number;
};

export function floodGuard(d: FloodDeps): MiddlewareHandler {
  const L = { ...FLOOD_LIMITS, ...d.limits }, now = d.now ?? Date.now;
  const god = new TokenBuckets(L.godTokenPerS, L.godTokenBurst, now), writes = new TokenBuckets(L.ipWritesPerS, L.ipWritesBurst, now), reads = new TokenBuckets(L.ipReadsPerS, L.ipReadsBurst, now);
  const log = d.log ?? new RefusalLog();
  return async (c, next) => {
    const path = c.req.path;
    if (!path.startsWith('/v1/') || c.req.method === 'OPTIONS') return next();
    const write = c.req.method !== 'GET' && c.req.method !== 'HEAD';
    const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
    const pool = token?.startsWith('god_') ? d.godPool(token) : null;
    if (pool) {
      const wait = god.take(pool);
      if (wait) return refuse(c, wait, 'god-token', short(pool), `more than ${L.godTokenPerS * 60} requests a minute from this god token`, L.godTokenPerS, L.godTokenBurst);
    }
    // a request with no x-forwarded-for came from this machine (the launcher's own reads, operator tools, tests): no address limit
    const xff = c.req.header('x-forwarded-for');
    if (xff) {
      const ip = xff.split(',')[0].trim(), wait = (write ? writes : reads).take(ip);
      if (wait) return refuse(c, wait, write ? 'ip-writes' : 'ip-reads', short(ip), `more than ${(write ? L.ipWritesPerS : L.ipReadsPerS) * 60} ${write ? 'changes' : 'reads'} a minute from your address`, write ? L.ipWritesPerS : L.ipReadsPerS, write ? L.ipWritesBurst : L.ipReadsBurst);
    }
    return next();
  };
  function refuse(c: Context, waitMs: number, scope: string, key: string, why: string, perS: number, burst: number) {
    const s = Math.max(1, Math.ceil(waitMs / 1000));
    log.note(scope, key, `${c.req.method} ${c.req.path}`);
    return c.json({ ok: false, code: 'rate-limited', message: `slow down: ${why}; try again in ${s} s`, retry_after: s, retryAfterMs: waitMs, limit: { scope, perMinute: perS * 60, burst } }, 429, { 'Retry-After': String(s), 'Cache-Control': 'no-store' });
  }
}
