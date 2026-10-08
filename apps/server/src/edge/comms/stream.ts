// One durable event stream per Soul (EDGE-CONTRACT-v1 §5). Cursors are opaque strings
// `c_<seq>`, monotonic per Soul. Old events are pruned by count and age; a cursor older
// than the retained floor reads as a gap carrying the oldest usable cursor.
import {tx, type Sql} from './store.ts';

export type StreamEvent = {id: string; kind: string; tick: number; at: number} & Record<string, unknown>;
export type ReadResult = {cursor: string; events: StreamEvent[]; gap?: true};
export type StreamOptions = {retainEvents: number; retainMs: number; now: () => number};

const CURSOR = /^c_(0|[1-9][0-9]{0,15})$/;
export const cursorOf = (seq: number) => `c_${seq}`;
/** undefined = malformed; null = omitted ("from now"). */
export function parseCursor(raw: string | undefined | null): number | null | undefined {
  if (raw === undefined || raw === null || raw === '') return null;
  const m = CURSOR.exec(raw);
  return m ? Number(m[1]) : undefined;
}

export class EventStreams {
  private waiters = new Map<string, Set<() => void>>();
  private listeners: ((soulId: string, e: StreamEvent) => void)[] = [];
  /** EVENTS-v1: delivery-time facts merged into a stored event (`where`, `clock`, `plan`); faults never block delivery. */
  enrich: ((soulId: string, kind: string, body: Record<string, unknown>) => Record<string, unknown> | undefined) | null = null;
  private db: Sql; private worldId: string; private opts: StreamOptions;
  constructor(db: Sql, worldId: string, opts: StreamOptions) { this.db = db; this.worldId = worldId; this.opts = opts; }

  onEvent(listener: (soulId: string, e: StreamEvent) => void) { this.listeners.push(listener); }

  private headRow(soulId: string): {head: number; floor: number} {
    const row = this.db.prepare('SELECT head, floor FROM edge_comms_heads WHERE world_id = ? AND soul_id = ?').get(this.worldId, soulId) as {head: number; floor: number} | undefined;
    return row ?? {head: 0, floor: 0};
  }
  head(soulId: string): number { return this.headRow(soulId).head; }
  /** Oldest retained position (a cursor below it reads as a gap). */
  floor(soulId: string): number { return this.headRow(soulId).floor; }
  headCursor(soulId: string): string { return cursorOf(this.head(soulId)); }

  /** Append one event to a Soul's stream; returns the stored event. */
  deliver(soulId: string, kind: string, tick: number, body: Record<string, unknown>): StreamEvent {
    const at = this.opts.now();
    const event = tx(this.db, () => {
      const {head, floor} = this.headRow(soulId);
      const seq = head + 1;
      let extra: Record<string, unknown> | undefined;
      try { extra = this.enrich?.(soulId, kind, body); } catch { extra = undefined; }
      const stored = {...(extra ?? {}), ...body};
      delete stored.id; delete stored.kind; delete stored.tick; delete stored.at;
      this.db.prepare('INSERT INTO edge_comms_stream (world_id, soul_id, seq, tick, at, kind, body) VALUES (?,?,?,?,?,?,?)').run(this.worldId, soulId, seq, tick, at, kind, JSON.stringify(stored));
      this.db.prepare('INSERT INTO edge_comms_heads (world_id, soul_id, head, floor) VALUES (?,?,?,?) ON CONFLICT (world_id, soul_id) DO UPDATE SET head = excluded.head').run(this.worldId, soulId, seq, floor);
      if (seq % 25 === 0) this.prune(soulId, seq, floor);
      return {id: cursorOf(seq), kind, tick, at, ...stored} as StreamEvent;
    });
    const waiting = this.waiters.get(soulId);
    if (waiting) { this.waiters.delete(soulId); for (const wake of waiting) wake(); }
    for (const l of this.listeners) { try { l(soulId, event); } catch { /* listeners never break delivery */ } }
    return event;
  }

  private prune(soulId: string, head: number, floor: number) {
    const bySeq = head - this.opts.retainEvents, byAt = this.opts.now() - this.opts.retainMs;
    const row = this.db.prepare('SELECT MAX(seq) AS seq FROM edge_comms_stream WHERE world_id = ? AND soul_id = ? AND (seq <= ? OR at < ?)').get(this.worldId, soulId, bySeq, byAt) as {seq: number | null};
    if (row.seq === null) return;
    this.db.prepare('DELETE FROM edge_comms_stream WHERE world_id = ? AND soul_id = ? AND seq <= ?').run(this.worldId, soulId, row.seq);
    this.db.prepare('UPDATE edge_comms_heads SET floor = ? WHERE world_id = ? AND soul_id = ?').run(Math.max(floor, row.seq), this.worldId, soulId);
  }
  /** Prune every stream now (also runs incrementally on delivery). */
  pruneAll() {
    const rows = this.db.prepare('SELECT soul_id, head, floor FROM edge_comms_heads WHERE world_id = ?').all(this.worldId) as {soul_id: string; head: number; floor: number}[];
    for (const r of rows) tx(this.db, () => this.prune(r.soul_id, r.head, r.floor));
  }

  /** Events strictly after `after` (null = from now). */
  read(soulId: string, after: number | null, limit = 100): ReadResult {
    const {head, floor} = this.headRow(soulId);
    if (after === null) return {cursor: cursorOf(head), events: []};
    if (after < floor || after > head) return {cursor: cursorOf(after > head ? head : floor), events: [], gap: true};
    const rows = this.db.prepare('SELECT seq, tick, at, kind, body FROM edge_comms_stream WHERE world_id = ? AND soul_id = ? AND seq > ? ORDER BY seq LIMIT ?').all(this.worldId, soulId, after, limit) as {seq: number; tick: number; at: number; kind: string; body: string}[];
    const events = rows.map(r => ({id: cursorOf(r.seq), kind: r.kind, tick: r.tick, at: r.at, ...JSON.parse(r.body)}) as StreamEvent);
    return {cursor: events.length ? events.at(-1)!.id : cursorOf(after), events};
  }

  /** Resolves when the Soul's stream grows, the timeout passes, or the signal aborts. */
  waitForEvent(soulId: string, timeoutMs: number, signal?: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      let set = this.waiters.get(soulId);
      if (!set) { set = new Set(); this.waiters.set(soulId, set); }
      const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); this.waiters.get(soulId)?.delete(done); resolve(); };
      const timer = setTimeout(done, timeoutMs);
      signal?.addEventListener('abort', done, {once: true});
      set.add(done);
    });
  }

  async wait(soulId: string, after: number | null, timeoutMs: number, signal?: AbortSignal): Promise<ReadResult> {
    const start = after === null ? this.head(soulId) : after;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const r = this.read(soulId, start);
      if (r.gap || r.events.length) return r;
      const left = deadline - Date.now();
      if (left <= 0 || signal?.aborted) return r;
      await this.waitForEvent(soulId, left, signal);
    }
  }

  /** Close all pending long-polls (shutdown). */
  wakeAll() { for (const [, set] of this.waiters) for (const wake of set) wake(); this.waiters.clear(); }
}
