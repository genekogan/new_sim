// RL7: a bounded, in-memory ring per world of god requests — route template, token hash8, build/step, outcome code,
// field and ms. Never payload text: no bodies, no query strings, no details, no names. Rows vanish on restart by
// design (nothing here is a journal). Loop hints: the same refusal code + field 3 or more times within 2 minutes.
// Recording is O(1) on the request path; reading (`rows`, `loops`) is for the lead's `trace` and `build show`.

export const TRACE_LIMITS = { rows: 1024, loopWindowMs: 120_000, loopMin: 3, code: 60, field: 80, keys: 256 } as const;

export type TraceRow = {
  at: number; method: string; route: string; status: number; ms: number;
  /** First 8 hex of the god token's hash; null when the bearer was not a known god token. */
  tok: string | null;
  build?: string; step?: number;
  /** `ok`, a refusal/error code (`overlap.solid`, `build.lease`, `unauthorized`, `rate-limited`) or `http.<status>`. */
  code: string; field?: string;
};
export type LoopHint = { code: string; field: string | null; count: number; firstAt: number; lastAt: number; routes: string[]; toks: string[]; builds: string[] };
export type TraceStats = { since: number; traced: number; untraced: number; refused: number; repeated: number; dropped: number };

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const clip = (s: unknown, n: number) => typeof s === 'string' && s ? s.slice(0, n) : undefined;
// Fields are schema paths, but some carry a caller's ids or keys (`expect.<ref>`, `preview.subtrees.<id>`, an upload's
// form key): keep identifier and index segments, mask the rest, and mask everything after a keyed prefix.
const KEYED = /^(expect|preview\.subtrees)\./, SEGMENT = /^(?:\d{1,6}|[A-Za-z_][A-Za-z0-9_]{0,31})$/;
const fieldShape = (s: unknown) => {
  const f = clip(s, 400); if (!f) return undefined;
  const keyed = KEYED.exec(f);
  return (keyed ? `${keyed[1]}.*` : f.split('.').map(x => SEGMENT.test(x) ? x : '*').join('.')).slice(0, TRACE_LIMITS.field);
};

/** Outcome of one god response, from the object the route returned (no serialisation) or the error it threw. */
export function outcomeOf(result: unknown, error: unknown, status: number): { code: string; field?: string } {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code: unknown }).code === 'string' && 'status' in error) {
    const e = error as { code: string; extra?: Record<string, unknown> };
    const field = fieldShape(e.extra?.field);
    return { code: e.code.slice(0, TRACE_LIMITS.code), ...(field ? { field } : {}) };
  }
  if (error) return { code: 'internal' };
  if (result && typeof result === 'object') {
    const r = result as { accepted?: unknown; ok?: unknown; failures?: { code?: unknown; field?: unknown }[]; code?: unknown; reason?: { code?: unknown } };
    const failed = r.accepted === false || r.ok === false;
    if (failed) {
      const f = Array.isArray(r.failures) ? r.failures[0] : undefined;
      const code = clip(f?.code, TRACE_LIMITS.code) ?? clip(r.code, TRACE_LIMITS.code) ?? clip(r.reason?.code, TRACE_LIMITS.code) ?? 'refused';
      const field = fieldShape(f?.field);
      return { code, ...(field ? { field } : {}) };
    }
  }
  return status >= 400 ? { code: `http.${status}` } : { code: 'ok' };
}

export class GodTrace {
  readonly enabled: boolean;
  private ring: (TraceRow | undefined)[];
  private next = 0;
  readonly stats: TraceStats;
  private readonly now: () => number;
  constructor(opts: { rows?: number; enabled?: boolean; now?: () => number } = {}) {
    this.ring = new Array(Math.max(16, Math.min(65_536, Math.floor(opts.rows ?? TRACE_LIMITS.rows))));
    this.enabled = opts.enabled ?? process.env.GOD_TRACE !== '0';
    this.now = opts.now ?? Date.now;
    // wall clock: the host's clock may not be ready while its owner is still being constructed
    this.stats = { since: Date.now(), traced: 0, untraced: 0, refused: 0, repeated: 0, dropped: 0 };
  }
  get size() { return Math.min(this.stats.traced, this.ring.length); }

  /** Keep one row (the caller has already reduced it to metadata). O(1): refusals also update a per-key window. */
  record(row: TraceRow) {
    if (!this.enabled) return;
    if (row.build !== undefined && !SLUG.test(row.build)) delete row.build;
    if (row.step !== undefined && !(Number.isInteger(row.step) && row.step >= 0 && row.step <= 999)) delete row.step;
    if (row.code !== 'ok') this.refusal(row);
    if (this.ring[this.next]) this.stats.dropped++;
    this.ring[this.next] = row; this.next = (this.next + 1) % this.ring.length; this.stats.traced++;
  }
  /** A god request the trace saw but does not keep (the SSE stream, reads of the trace itself). */
  skip() { if (this.enabled) this.stats.untraced++; }

  /** Refusal times per code + field inside the loop window (at most loopMin kept per key: enough to say "loop"). */
  private recent = new Map<string, number[]>();
  private refusal(row: TraceRow) {
    this.stats.refused++;
    const key = `${row.code}\u0000${row.field ?? ''}`, times = this.recent.get(key) ?? [];
    while (times.length && row.at - times[0] > TRACE_LIMITS.loopWindowMs) times.shift();
    if (times.length >= TRACE_LIMITS.loopMin - 1) this.stats.repeated++;
    times.push(row.at); if (times.length > TRACE_LIMITS.loopMin) times.shift();
    this.recent.set(key, times);
    if (this.recent.size > TRACE_LIMITS.keys) {
      for (const [k, t] of this.recent) if (!t.length || row.at - t[t.length - 1] > TRACE_LIMITS.loopWindowMs) this.recent.delete(k);
      // still full of live keys: forget the oldest-inserted ones, so the map stays bounded whatever the request mix
      for (const k of this.recent.keys()) { if (this.recent.size <= TRACE_LIMITS.keys / 2) break; if (k !== key) this.recent.delete(k); }
    }
  }
  /** Walk kept rows newest first until `visit` returns false. */
  private walk(visit: (r: TraceRow) => boolean | void) {
    for (let i = 1; i <= this.ring.length; i++) { const r = this.ring[(this.next - i + this.ring.length) % this.ring.length]; if (!r || visit(r) === false) return; }
  }

  /** Newest first (copies). */
  rows(filter: { build?: string; tok?: string; since?: number; limit?: number } = {}): TraceRow[] {
    const out: TraceRow[] = [], limit = Math.max(1, Math.min(this.ring.length, filter.limit ?? 50));
    this.walk(r => {
      if (filter.since !== undefined && r.at < filter.since) return false;
      if ((!filter.build || r.build === filter.build) && (!filter.tok || r.tok === filter.tok)) out.push({ ...r });
      return out.length < limit;
    });
    return out;
  }

  /** Refusals repeated (same code + field) at least loopMin times within the window ending now. */
  loops(filter: { build?: string; now?: number } = {}): LoopHint[] {
    const now = filter.now ?? this.now(), since = now - TRACE_LIMITS.loopWindowMs;
    // fast path for every build show: no key reached loopMin inside the window, so there is nothing to group
    let any = false; for (const t of this.recent.values()) if (t.length >= TRACE_LIMITS.loopMin && t[0] >= since) { any = true; break; }
    if (!any) return [];
    const groups = new Map<string, LoopHint>();
    this.walk(r => {
      if (r.at < since) return false;
      if (r.code === 'ok' || (filter.build && r.build !== filter.build)) return;
      const key = `${r.code}\u0000${r.field ?? ''}`;
      let g = groups.get(key);
      if (!g) { g = { code: r.code, field: r.field ?? null, count: 0, firstAt: r.at, lastAt: r.at, routes: [], toks: [], builds: [] }; groups.set(key, g); }
      g.count++; g.firstAt = Math.min(g.firstAt, r.at); g.lastAt = Math.max(g.lastAt, r.at);
      const route = `${r.method} ${r.route}`;
      if (!g.routes.includes(route)) g.routes.push(route);
      if (r.tok && !g.toks.includes(r.tok)) g.toks.push(r.tok);
      if (r.build && !g.builds.includes(r.build)) g.builds.push(r.build);
    });
    return [...groups.values()].filter(g => g.count >= TRACE_LIMITS.loopMin).sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
  }

  /** Measures: share of god requests kept, and how many refusals were repeats inside a loop. */
  summary() {
    const s = this.stats, seen = s.traced + s.untraced;
    return { ...s, kept: this.size, rowsMax: this.ring.length, tracedShare: seen ? Math.round(1000 * s.traced / seen) / 1000 : null, repeatRefusalRate: s.refused ? Math.round(1000 * s.repeated / s.refused) / 1000 : null };
  }
}
