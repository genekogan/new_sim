// LOAD-CONTRACT §2–§3: in-world admission. Heavy requests (C1 writes, C2 personal reads) no longer run straight from
// the HTTP callback: they queue, and a dispatcher runs them between ticks within a frame budget, writes before reads,
// the god's work holding a reserved quarter. One heavy request in flight per Soul (`soul.busy`); a per-Soul CPU-ms
// bucket under contention (`soul.slow-down`); a job whose deadline passes is answered `world.busy` unrun, and a job
// whose client went away is dropped. It queues, delays and refuses; it never chooses or retries an act for a Soul.
import {createHash} from 'node:crypto';
import type {Context, MiddlewareHandler} from 'hono';
import type {Level} from './shared.ts';
import {crowdedNote} from './waking.ts';

export type Cls = 'C0' | 'C1' | 'C2' | 'C3';
export type RouteClass = {cls: Cls; id: string; god: boolean; deadlineMs: number};
export type Refusal = {status: 429 | 503; code: 'soul.busy' | 'soul.slow-down' | 'world.busy'; retryAfterS: number; message: string};

const C1_MS = 20_000, GOD_C1_MS = 30_000, C2_MS = 8_000;
const EDGE_READ = /^\/v1\/edge\/(here|observe|capabilities|view|objects(?:\/[^/]+)?)$/;
const EDGE_WRITE = /^\/v1\/edge\/(act|say|converse|objects\/[^/]+\/act|plan(?:\/[^/]+)?)$/;
const PUBLIC = /^\/v1\/(?:edge\/(?:map|rides|items|platforms)|world\/snapshot)$/;
const GOD_READ = /^\/v1\/god\/(mirror|doctor|trace|recommend|layers|layers\/zone-suggest|defs\/unused)$/;
const GOD_FREE = /^\/v1\/god\/(?:pair\/|claim$|answer$|inbox\/|pray$|assets$|visitors$)/;   // auth flows, uploads, Souls' prayers
/** The request class of a route (§2); null = not admitted here (passes straight through). Paths are world-relative. */
export function classify(method: string, path: string): RouteClass | null {
  if (path === '/healthz' || path === '/v1/config') return {cls: 'C0', id: path, god: false, deadlineMs: 0};
  if (PUBLIC.test(path)) return method === 'GET' ? {cls: 'C3', id: path, god: false, deadlineMs: 0} : null;
  let m: RegExpExecArray | null;
  if (path.startsWith('/v1/edge/')) {
    // `around` explores: it records the places found and invalidates menus (around.ts), so it is a write (C1), not a read
    if (method === 'GET' && path === '/v1/edge/around') return {cls: 'C1', id: 'edge:around', god: false, deadlineMs: C1_MS};
    if (method === 'GET' && (m = EDGE_READ.exec(path))) return {cls: 'C2', id: 'edge:' + m[1].replace(/\/.*/, '/:id'), god: false, deadlineMs: C2_MS};
    if (method === 'POST' && path === '/v1/edge/resolve') return {cls: 'C2', id: 'edge:resolve', god: false, deadlineMs: C2_MS};
    if (method !== 'GET' && (m = EDGE_WRITE.exec(path))) return {cls: 'C1', id: 'edge:' + m[1].replace(/\/[^/]+/, '/:id'), god: false, deadlineMs: C1_MS};
    return null;
  }
  if (path.startsWith('/v1/god/')) {
    if (method === 'GET' && (m = GOD_READ.exec(path))) return {cls: 'C2', id: 'god:' + m[1], god: true, deadlineMs: C2_MS};
    if (method === 'POST' && path === '/v1/god/query') return {cls: 'C2', id: 'god:query', god: true, deadlineMs: C2_MS};
    if (method !== 'GET' && !GOD_FREE.test(path)) return {cls: 'C1', id: 'god:' + path.slice(8).replace(/\/[0-9a-z_-]{8,}(?=\/|$)/gi, '/:id'), god: true, deadlineMs: GOD_C1_MS};
    return null;
  }
  return null;
}

/** Dial values (LOAD-CONTRACT §1). Frame budget: request ms per 50 ms frame. Refill: per-Soul bucket multiplier. */
export const FRAME_BUDGET_MS: Record<Level, number> = {green: 25, amber: 15, red: 8, black: 0};
export const REFILL_X: Record<Level, number> = {green: 1, amber: 0.5, red: 0.25, black: 0.25};
const COOL_MS = 60_000, FRAME_MS = 50, CAPACITY_MS = 2000, GOD_SHARE = 0.25, DEFAULT_EST_MS = 20, ANSWER_MARGIN_MS = 250, ACTIVE_MS = 60_000;

type Job = {key: string; god: boolean; route: RouteClass; arrival: number; deadline: number; closed: () => boolean;
  settle: (v: 'run' | 'dropped' | Refusal) => void; finished: Promise<void>; finish: () => void};
type Bucket = {tokens: number; at: number; seen: number};
/** Socket-independent (Stage B): a job is (key = Soul or god, class, deadline, `closed()` = "has the asker gone", and the
 *  ticket as its reply handle). The HTTP middleware below is one front end; a worker's MessagePort can be another. */
export type Ticket = {refusal: Refusal} | {turn: Promise<'run' | 'dropped' | Refusal>; done: () => void; waitedMs: () => number};

export class Admission {
  level: Level = 'green';
  readonly queue: Job[] = [];
  readonly outstanding = new Set<string>();
  readonly shed = {reads: 0, acts: 0, busy: 0, slow: 0, dropped: 0, cooled: 0};
  private buckets = new Map<string, Bucket>();
  private est = new Map<string, number>();
  /** World-total request time (LOAD-CONTRACT §2b): credit accrues at budget/50 ms per ms, capped at one frame's
   *  budget, and every job's measured time is debited, so a job longer than the budget is paid back by the frames
   *  after it. Whatever the sum of the per-Soul budgets, requests never take more than budget/50 of the thread. */
  private credit = FRAME_BUDGET_MS.green; private creditAt = 0;
  private strikes = new Map<string, {slow: number[]; busy: number[]; coolUntil: number}>();
  private share = {god: 0, souls: 0};   // decaying ms spent, for the god's reserve
  private draining = false; private wake: NodeJS.Timeout | null = null; private sweeper: NodeJS.Timeout | null = null;
  private now: () => number;
  private o: {now?: () => number; yieldTurn?: () => Promise<void>};
  constructor(o: {now?: () => number; yieldTurn?: () => Promise<void>} = {}) { this.o = o; this.now = o.now ?? (() => performance.now()); }

  /** Load dial (LOAD-CONTRACT §1): frame budget 25/15/8/0 ms and bucket refill ×1/×0.5/×0.25/×0.25. */
  setLoadLevel(level: Level) { this.level = level; this.kick(); }
  queueStats() { const now = this.now(); let oldest = 0; for (const j of this.queue) oldest = Math.max(oldest, now - j.arrival); return {depth: this.queue.length, oldestMs: Math.round(oldest)}; }
  /** Principals (Souls + god) with a heavy request in the last minute: the `awake` of the refill formula. */
  active() { const now = this.now(); let n = 0; for (const b of this.buckets.values()) if (now - b.seen < ACTIVE_MS) n++; return Math.max(1, n); }
  estimate(id: string) { return this.est.get(id) ?? DEFAULT_EST_MS; }
  /** ms per ms of refill for one principal: min(200, 500/awake) ms/s × the level's dial; the god's bucket is the reserve. */
  private refill(god: boolean) { const perS = god ? 1000 * GOD_SHARE * FRAME_BUDGET_MS.green / FRAME_MS : Math.min(200, 500 / this.active()); return perS * REFILL_X[this.level] / 1000; }
  private bucket(key: string, god: boolean, now: number) {
    let b = this.buckets.get(key);
    if (!b) { b = {tokens: CAPACITY_MS, at: now, seen: now}; this.buckets.set(key, b); }
    b.tokens = Math.min(CAPACITY_MS, b.tokens + (now - b.at) * this.refill(god)); b.at = now;
    if (this.buckets.size > 4096) for (const [k, x] of this.buckets) if (now - x.seen > ACTIVE_MS && k !== key) this.buckets.delete(k);
    return b;
  }
  /** Budgets bind when someone else is waiting or in flight, or the world is red/black: one Soul alone in a calm
   *  world is never slowed (no quiet-case regression), and a crowd shares the request time fairly. */
  private contended(key: string) {
    if (this.level === 'red' || this.level === 'black') return true;
    for (const k of this.outstanding) if (k !== key) return true;
    return false;
  }

  request(r: {key: string; god: boolean; route: RouteClass; hintMs?: number; closed?: () => boolean}): Ticket {
    const now = this.now(), read = r.route.cls === 'C2';
    const cool = this.cooling(r.key, now);
    if (cool) { this.shed.slow++; if (read) this.shed.reads++; else this.shed.acts++; return {refusal: {status: 429, code: 'soul.slow-down', retryAfterS: cool, message: 'this Soul has asked for too much in a short time; the world answers it again in a minute'}}; }
    if (this.outstanding.has(r.key)) { this.shed.busy++; if (read) this.shed.reads++; this.strike(r.key, r.god, 'busy', now); return {refusal: {status: 429, code: 'soul.busy', retryAfterS: 1, message: 'a previous request from this Soul is still being answered'}}; }
    const b = this.bucket(r.key, r.god, now); b.seen = now;
    const est = this.estimate(r.route.id);
    if (read && this.level === 'black') { this.shed.reads++; return {refusal: busyRefusal(this.level)}; }
    if (read && b.tokens < est && this.contended(r.key)) {
      this.shed.slow++; this.shed.reads++; this.strike(r.key, r.god, 'slow', now);
      const rate = this.refill(r.god);
      return {refusal: {status: 429, code: 'soul.slow-down', retryAfterS: Math.max(1, Math.ceil((est - b.tokens) / Math.max(rate, 1e-6) / 1000)), message: 'this Soul has asked for a lot in a short time; the world can answer it again shortly'}};
    }
    const deadline = now + Math.min(r.route.deadlineMs, r.hintMs && r.hintMs > 0 ? r.hintMs : Infinity);
    // a read that cannot start before its deadline (the time already queued, paid at the frame budget) is answered now,
    // not after the client has waited for nothing; acts always queue (refused only past their deadline)
    if (read && this.queue.length) {
      let ahead = 0; for (const j of this.queue) ahead += this.estimate(j.route.id);
      const wait = ahead * FRAME_MS / Math.max(1, FRAME_BUDGET_MS[this.level]);
      if (now + wait + est + ANSWER_MARGIN_MS >= deadline) { this.shed.reads++; return {refusal: {...busyRefusal(this.level), retryAfterS: Math.max(busyRefusal(this.level).retryAfterS, Math.ceil(wait / 1000))}}; }
    }
    let settle!: Job['settle'], finish!: () => void;
    const turn = new Promise<'run' | 'dropped' | Refusal>(res => { settle = res; });
    const finished = new Promise<void>(res => { finish = res; });
    let ranAt = 0, isDone = false;
    const job: Job = {key: r.key, god: r.god, route: r.route, arrival: now, deadline, closed: r.closed ?? (() => false), finished, finish,
      settle: v => { if (v === 'run') ranAt = this.now(); settle(v); }};
    this.outstanding.add(r.key);
    // fast path: nothing waiting, the dispatcher idle, frame credit left and nobody else in flight → run now, inline
    // (no timer hop: the quiet case costs what it did before admission). Charged when it answers.
    if (!this.queue.length && !this.draining && this.outstanding.size === 1 && this.level === 'green' && this.creditNow(now) > 0) {
      settle('run'); ranAt = now;
      return {turn, waitedMs: () => 0, done: () => { if (isDone) return; isDone = true; this.outstanding.delete(r.key); this.charge(r.key, r.god, r.route.id, this.now() - now, now); finish(); this.kick(); }};
    }
    this.queue.push(job); this.kick();
    return {turn, waitedMs: () => (ranAt || this.now()) - now, done: () => { if (isDone) return; isDone = true; this.outstanding.delete(r.key); finish(); this.kick(); }};
  }

  private creditNow(now: number) { const budget = FRAME_BUDGET_MS[this.level]; this.credit = Math.min(budget, this.credit + (now - this.creditAt) * budget / FRAME_MS); this.creditAt = now; return this.credit; }
  /** Debit a job's measured time: the world credit, the god/Souls shares, the principal's bucket, the route estimate. */
  private charge(key: string, god: boolean, id: string, ms: number, startedAt: number) {
    this.creditNow(startedAt); this.credit -= ms;
    this.share.god = this.share.god * 0.95 + (god ? ms : 0); this.share.souls = this.share.souls * 0.95 + (god ? 0 : ms);
    const b = this.bucket(key, god, startedAt + ms); b.tokens -= ms;
    const e = this.est.get(id); this.est.set(id, e === undefined ? ms : e * 0.8 + ms * 0.2);
  }
  /** §2b cool-down: over budget 3× (or 20 refusals for overlapping requests) in a minute → 60 s of slow-down.
   *  The god is never cooled (it is never starved; its share is the reserve). */
  private strike(key: string, god: boolean, kind: 'slow' | 'busy', now: number) {
    if (god) return;
    let s = this.strikes.get(key); if (!s) { s = {slow: [], busy: [], coolUntil: 0}; this.strikes.set(key, s); }
    const xs = s[kind]; xs.push(now); while (xs.length && now - xs[0] > 60_000) xs.shift();
    if (s.slow.length >= 3 || s.busy.length >= 20) { s.coolUntil = now + COOL_MS; s.slow.length = 0; s.busy.length = 0; this.shed.cooled++; }
    if (this.strikes.size > 4096) for (const [k, x] of this.strikes) if (x.coolUntil < now && !x.slow.length && !x.busy.length) this.strikes.delete(k);
  }
  /** Seconds left of this principal's cool-down, or 0. */
  private cooling(key: string, now: number) { const s = this.strikes.get(key); return s && s.coolUntil > now ? Math.ceil((s.coolUntil - now) / 1000) : 0; }
  /** Answer what can no longer be answered in time, drop what nobody waits for. */
  private sweep(now: number) {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const j = this.queue[i];
      if (j.closed()) { this.queue.splice(i, 1); this.outstanding.delete(j.key); this.shed.dropped++; j.settle('dropped'); continue; }
      if (now + Math.min(this.estimate(j.route.id), 1000) + ANSWER_MARGIN_MS >= j.deadline) {
        this.queue.splice(i, 1); this.outstanding.delete(j.key);
        if (j.route.cls === 'C2') this.shed.reads++; else this.shed.acts++;
        j.settle(busyRefusal(this.level));
      }
    }
  }
  /** Next job: writes before reads, FIFO across Souls (each Soul has at most one), the god's reserve under contention. */
  private pick(now: number): number {
    const godTurn = this.share.god <= GOD_SHARE * (this.share.god + this.share.souls);
    let best = -1, bestScore = Infinity;
    for (let i = 0; i < this.queue.length; i++) {
      const j = this.queue[i];
      if (j.route.cls === 'C1') {
        if (this.level === 'black') continue;   // black: budget 0; acts wait for their deadline answer
        const b = this.bucket(j.key, j.god, now);
        if (b.tokens < this.estimate(j.route.id) && this.contended(j.key)) continue;   // short of budget: the act waits
      }
      const score = (j.route.cls === 'C1' ? 0 : 1e12) + (j.god === godTurn ? 0 : 1e11) + j.arrival;
      if (score < bestScore) { bestScore = score; best = i; }
    }
    return best;
  }
  private kick() {
    if (this.draining || this.wake || !this.queue.length) return;
    this.wake = setTimeout(() => { this.wake = null; void this.drain(); }, 0);
    if (!this.sweeper) { this.sweeper = setInterval(() => { this.sweep(this.now()); if (!this.queue.length && this.sweeper) { clearInterval(this.sweeper); this.sweeper = null; } }, 100); this.sweeper.unref(); }
  }
  /** The dispatcher: runs queued jobs back to back while this frame's request budget lasts, then yields to the tick. */
  async drain() {
    if (this.draining) return; this.draining = true;
    try {
      while (this.queue.length) {
        let now = this.now();
        this.sweep(now);
        const budget = FRAME_BUDGET_MS[this.level];
        if (this.creditNow(now) <= 0) { this.later(budget > 0 ? Math.min(1000, -this.credit * FRAME_MS / budget + 1) : FRAME_MS); return; }
        const i = this.pick(now);
        if (i < 0) { this.later(FRAME_MS); return; }
        const [j] = this.queue.splice(i, 1);
        j.settle('run');
        await Promise.race([j.finished, this.o.yieldTurn ? this.o.yieldTurn() : new Promise<void>(r => setImmediate(r))]);
        this.charge(j.key, j.god, j.route.id, this.now() - now, now);
      }
    } finally { this.draining = false; }
  }
  private later(ms: number) { if (this.wake) return; this.wake = setTimeout(() => { this.wake = null; void this.drain(); }, Math.max(1, Math.ceil(ms))); this.wake.unref?.(); }
  close() { if (this.wake) clearTimeout(this.wake); if (this.sweeper) clearInterval(this.sweeper); this.wake = this.sweeper = null; }
}

export const NOTE: Record<Level, string | undefined> = {green: undefined, amber: 'It is crowded here right now; things take a little longer.', red: 'It is crowded here right now; things take a little longer.', black: 'The world is very crowded right now; it is slow to answer.'};
const RETRY_S: Record<Level, number> = {green: 1, amber: 2, red: 5, black: 15};
function busyRefusal(level: Level): Refusal { return {status: 503, code: 'world.busy', retryAfterS: RETRY_S[level], message: 'the world is too busy to answer this in time'}; }
/** The `world` block of §3 (refusals always; frames at amber and above). */
export function worldBlock(level: Level, retryAfterS?: number) { const note = NOTE[level]; return {load: level, ...(retryAfterS ? {retry_after_s: retryAfterS} : {}), ...(note ? {note} : {})}; }

const LOAD_KEY = 'simLoad';
/** The level this request was admitted at (routes.ts `wrap` adds the world block from it at amber and above). */
export const loadOf = (c: Context): Level | undefined => (c.get as (k: string) => unknown)(LOAD_KEY) as Level | undefined;

/** Mount on '*' before the routes: classifies, admits, stamps X-Sim-Load (and Retry-After on refusals at amber+). */
/** An opaque, stable id of the account behind a Soul token (the same for all its Souls), never the raw account id. */
export const accountTag = (owner: string) => createHash('sha256').update('sim-account/1\0' + owner).digest('base64url').slice(0, 16);

/** `account(token)` → the token's account (Soul owner) for `x-sim-account`, which the launcher's per-account ceilings read
 *  and strip (LOAD-CONTRACT §2b). Cached per token for a minute (a token lookup reads the database). */
export function admissionMiddleware(adm: Admission, level: () => Level, bearer: (c: Context) => string | undefined, account?: (token: string) => string | undefined,
  crowded?: (token: string) => {position: number; eta_s: number} | null): MiddlewareHandler {
  const tags = new Map<string, {tag: string | null; at: number}>();
  const tagOf = (token: string) => {
    const now = Date.now(), hit = tags.get(token);
    if (hit && now - hit.at < 60_000) return hit.tag;
    let owner: string | undefined; try { owner = account?.(token); } catch { owner = undefined; }
    const tag = owner ? accountTag(owner) : null;
    if (tags.size > 4096) tags.clear();
    tags.set(token, {tag, at: now}); return tag;
  };
  const stamp = (c: Context, lv: Level, token?: string) => {
    c.header('X-Sim-Load', lv);
    if (token && account) { const tag = tagOf(token); if (tag) c.header('x-sim-account', tag); }
    if (lv !== 'green' && (c.res.status === 429 || c.res.status === 503) && !c.res.headers.has('Retry-After')) c.header('Retry-After', String(RETRY_S[lv]));
  };
  return async (c, next) => {
    const path = c.req.path, edge = path.startsWith('/v1/edge/') || path.startsWith('/v1/god/') || path.startsWith('/v1/world/');
    if (!edge) return next();
    const lv = level(); (c.set as (k: string, v: unknown) => void)(LOAD_KEY, lv);
    const r = classify(c.req.method, path), token = bearer(c);
    if (!r || !token || (r.cls !== 'C1' && r.cls !== 'C2')) { await next(); stamp(c, lv, token); return; }
    // waking limit (dark): a Soul waiting its turn has its acts answered world.crowded; its reads still answer
    const line = r.cls === 'C1' && !r.god ? crowded?.(token) : null;
    if (line) { stamp(c, lv, token); c.header('Cache-Control', 'no-store'); c.header('Retry-After', String(Math.max(1, Math.min(line.eta_s, 60))));
      return c.json({contract: 'eden-edge/1', error: {code: 'world.crowded', message: crowdedNote(line), position: line.position, eta_s: line.eta_s}, world: worldBlock(lv, Math.max(1, Math.min(line.eta_s, 60)))}, 503); }
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') await c.req.text().catch(() => '');   // read the body before the turn: its I/O is not request CPU
    // the client went away = its socket closed (not `incoming.destroyed`: a fully read request body is destroyed too)
    const env = c.env as {incoming?: {socket?: {destroyed?: boolean}}} | undefined, hint = Number(c.req.header('x-sim-timeout-ms'));
    const t = adm.request({key: r.god ? 'god' : 'soul:' + token, god: r.god, route: r, hintMs: Number.isFinite(hint) ? hint : undefined, closed: () => env?.incoming ? env.incoming.socket?.destroyed === true : c.req.raw.signal?.aborted === true});
    const refuse = (x: Refusal) => { c.header('Cache-Control', 'no-store'); c.header('Retry-After', String(x.retryAfterS)); stamp(c, lv, token);
      return c.json({contract: 'eden-edge/1', error: {code: x.code, message: x.message}, world: worldBlock(lv, x.retryAfterS)}, x.status); };
    if ('refusal' in t) return refuse(t.refusal);
    const v = await t.turn;
    if (v === 'dropped') return c.body(null, 499 as never);
    if (v !== 'run') return refuse(v);
    try { await next(); } finally { t.done(); }
    stamp(c, lv, token);
  };
}
