// Private owner -> agent mailbox. A Soul's box is one replaceable message, no conversation log.
// G4 (Gene, 2026-10-20): the god's box is a queue. Commands typed while the agent is away wait in order (none overwrites
// another); the agent still sees exactly one message at a time (`latest`, the oldest one it has not acknowledged), so an
// older CLI's listen/ack loop works unchanged and receives them in order. Each command is a ticket whose status comes
// from what the agent already does: sent = pending, delivered (a response to the agent carried it) = in progress,
// acknowledged = complete, or failed when its ack says so. While a ticket is in progress, the edits that commit are
// recorded against it; its ack freezes where they are (`focus`), so the owner's log can fly the camera there.
import {randomUUID} from 'node:crypto';
import type {Db} from './db.ts';
import {ApiError} from './souls.ts';

export type InboxScope = {scope: string; owner: string};
export type Outcome = 'done' | 'failed' | 'withdrawn';
export type InboxMessage = {id: string; text: string; state: 'sent' | 'delivered' | 'acknowledged'; sentAt: number; deliveredAt?: number; acknowledgedAt?: number; reply?: string; outcome?: Outcome};
/** Where a finished command's edits are: the camera's target and the span to frame. */
export type TicketFocus = {x: number; y: number; z: number; span: number; label?: string; count: number};
export type Ticket = InboxMessage & {focus?: TicketFocus; touched?: number};
/** God only: listening = a listener is waiting now; working = it holds a command and called recently; recent = it called
 *  within the last half minute; away = none of these. */
export type Presence = 'listening' | 'working' | 'recent' | 'away';
export type InboxView = {connected: boolean; lastSeenAt: number | null; latest: InboxMessage | null; queued?: number; presence?: Presence; log?: Ticket[]};
type Row = {id: string | null; text: string | null; sent_at: number | null; delivered_at: number | null; acknowledged_at: number | null; reply: string | null; last_seen_at: number | null};
type QRow = {n: number; id: string; text: string; sent_at: number; delivered_at: number | null; acknowledged_at: number | null; reply: string | null; outcome: Outcome | null; touched: string | null; focus: string | null};
export const INBOX_CONNECTED_MS = 120_000;
export const INBOX_TEXT_MAX = 1000;
/** God presence: a call within this long counts as connected; a god holding a command, within WORKING_MS. */
export const GOD_RECENT_MS = 30_000, GOD_WORKING_MS = 600_000;
/** At most this many commands wait at once; the owner's log keeps the newest LOG_KEEP. */
export const GOD_QUEUE_MAX = 50, GOD_LOG_KEEP = 200, GOD_LOG_VIEW = 50, GOD_TOUCHED_MAX = 300;
const QCOLS = 'n,id,text,sent_at,delivered_at,acknowledged_at,reply,outcome,touched,focus';

export class AgentInbox {
  readonly db: Db; readonly worldId: string; readonly now: () => number;
  /** Set by the routes: where a ticket's touched entities are now (null when none is left in the world). */
  focusOf: (ids: string[]) => TicketFocus | null = () => null;
  private waiters = new Map<string, Set<() => void>>();
  private listeners = new Map<string, number>();
  constructor(db: Db, worldId: string, now = Date.now) {
    this.db = db; this.worldId = worldId; this.now = now;
    db.db.exec(`CREATE TABLE IF NOT EXISTS agent_inbox_v1 (
      world_id TEXT NOT NULL, scope TEXT NOT NULL, owner TEXT NOT NULL,
      id TEXT, text TEXT, sent_at INTEGER, delivered_at INTEGER, acknowledged_at INTEGER, reply TEXT, last_seen_at INTEGER,
      PRIMARY KEY(world_id,scope,owner)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS god_inbox_queue_v1 (
      world_id TEXT NOT NULL, owner TEXT NOT NULL, n INTEGER NOT NULL, id TEXT NOT NULL, text TEXT NOT NULL, sent_at INTEGER NOT NULL,
      delivered_at INTEGER, acknowledged_at INTEGER, reply TEXT, outcome TEXT, touched TEXT, focus TEXT,
      PRIMARY KEY(world_id,owner,n)
    ) WITHOUT ROWID;
    CREATE UNIQUE INDEX IF NOT EXISTS god_inbox_queue_v1_id ON god_inbox_queue_v1(world_id,owner,id);
    CREATE INDEX IF NOT EXISTS god_inbox_queue_v1_open ON god_inbox_queue_v1(world_id,owner,n) WHERE acknowledged_at IS NULL;`);
    // A god message that was waiting in the one-message box before the queue existed becomes the queue's first command.
    for (const r of db.db.prepare(`SELECT owner,id,text,sent_at,delivered_at FROM agent_inbox_v1 WHERE world_id=? AND scope='god' AND id IS NOT NULL AND acknowledged_at IS NULL`).all(worldId) as {owner: string; id: string; text: string; sent_at: number; delivered_at: number | null}[]) {
      if (db.db.prepare('SELECT 1 FROM god_inbox_queue_v1 WHERE world_id=? AND owner=? AND id=?').get(worldId, r.owner, r.id)) continue;
      db.db.prepare('INSERT INTO god_inbox_queue_v1(world_id,owner,n,id,text,sent_at,delivered_at) VALUES(?,?,?,?,?,?,?)').run(worldId, r.owner, this.nextN(r.owner), r.id, r.text, r.sent_at, r.delivered_at);
    }
  }
  private key(s: InboxScope) { return JSON.stringify([this.worldId, s.scope, s.owner]); }
  private queued(s: InboxScope) { return s.scope === 'god'; }
  private row(s: InboxScope) { return this.db.db.prepare('SELECT id,text,sent_at,delivered_at,acknowledged_at,reply,last_seen_at FROM agent_inbox_v1 WHERE world_id=? AND scope=? AND owner=?').get(this.worldId, s.scope, s.owner) as Row | undefined; }
  private nextN(owner: string) { return ((this.db.db.prepare('SELECT MAX(n) m FROM god_inbox_queue_v1 WHERE world_id=? AND owner=?').get(this.worldId, owner) as {m: number | null}).m ?? 0) + 1; }
  /** The command the agent sees: the oldest one not acknowledged. */
  private head(s: InboxScope) { return this.db.db.prepare(`SELECT ${QCOLS} FROM god_inbox_queue_v1 WHERE world_id=? AND owner=? AND acknowledged_at IS NULL ORDER BY n LIMIT 1`).get(this.worldId, s.owner) as QRow | undefined; }
  private newest(s: InboxScope) { return this.db.db.prepare(`SELECT ${QCOLS} FROM god_inbox_queue_v1 WHERE world_id=? AND owner=? ORDER BY n DESC LIMIT 1`).get(this.worldId, s.owner) as QRow | undefined; }
  private waiting(s: InboxScope) { return (this.db.db.prepare('SELECT COUNT(*) c FROM god_inbox_queue_v1 WHERE world_id=? AND owner=? AND acknowledged_at IS NULL').get(this.worldId, s.owner) as {c: number}).c; }
  private message(r: QRow): InboxMessage {
    return {id: r.id, text: r.text, state: r.acknowledged_at !== null ? 'acknowledged' : r.delivered_at !== null ? 'delivered' : 'sent', sentAt: r.sent_at,
      ...(r.delivered_at !== null ? {deliveredAt: r.delivered_at} : {}), ...(r.acknowledged_at !== null ? {acknowledgedAt: r.acknowledged_at} : {}),
      ...(r.reply !== null ? {reply: r.reply} : {}), ...(r.acknowledged_at !== null && r.outcome ? {outcome: r.outcome} : {})};
  }
  private ticket(r: QRow): Ticket {
    const touched = r.touched ? (JSON.parse(r.touched) as string[]).length : 0;
    return {...this.message(r), ...(r.focus ? {focus: JSON.parse(r.focus) as TicketFocus} : {}), ...(touched ? {touched} : {})};
  }
  private presence(s: InboxScope, lastSeenAt: number | null, head: QRow | undefined): Presence {
    if ((this.listeners.get(this.key(s)) ?? 0) > 0) return 'listening';
    const age = lastSeenAt === null ? Infinity : this.now() - lastSeenAt;
    if (age < 0) return 'away';
    if (head?.delivered_at != null && age <= GOD_WORKING_MS) return 'working';
    return age <= GOD_RECENT_MS ? 'recent' : 'away';
  }
  /** What the agent sees (and every generic caller): one message. The god's adds `queued` (commands waiting, this one included). */
  view(s: InboxScope): InboxView {
    const r = this.row(s), lastSeenAt = r?.last_seen_at ?? null;
    if (this.queued(s)) {
      const head = this.head(s), shown = head ?? this.newest(s), presence = this.presence(s, lastSeenAt, head);
      return {connected: presence !== 'away', lastSeenAt, latest: shown ? this.message(shown) : null, queued: head ? this.waiting(s) : 0, presence};
    }
    return {connected: lastSeenAt !== null && this.now() - lastSeenAt >= 0 && this.now() - lastSeenAt <= INBOX_CONNECTED_MS, lastSeenAt,
      latest: r?.id ? {id: r.id, text: r.text!, state: r.acknowledged_at !== null ? 'acknowledged' : r.delivered_at !== null ? 'delivered' : 'sent', sentAt: r.sent_at!,
        ...(r.delivered_at !== null ? {deliveredAt: r.delivered_at} : {}), ...(r.acknowledged_at !== null ? {acknowledgedAt: r.acknowledged_at} : {}), ...(r.reply !== null ? {reply: r.reply} : {})} : null};
  }
  /** What the owner sees: the god's whole recent log, newest first (`latest` = the newest command). A Soul's box: view(). */
  ownerView(s: InboxScope): InboxView {
    if (!this.queued(s)) return this.view(s);
    const v = this.view(s), newest = this.newest(s);
    const log = (this.db.db.prepare(`SELECT ${QCOLS} FROM god_inbox_queue_v1 WHERE world_id=? AND owner=? ORDER BY n DESC LIMIT ?`).all(this.worldId, s.owner, GOD_LOG_VIEW) as QRow[]).map(r => this.ticket(r));
    return {...v, latest: newest ? this.message(newest) : null, log};
  }
  send(s: InboxScope, text: unknown) {
    if (typeof text !== 'string' || !text.trim() || text.trim().length > INBOX_TEXT_MAX) throw new ApiError(400, 'invalid', `text is required (1–${INBOX_TEXT_MAX} characters)`);
    // Keep private response headers bounded even for non-JSON commands. Normal
    // whitespace is allowed; C0 controls would expand to six-byte JSON escapes.
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new ApiError(400, 'invalid', 'text must not contain control characters');
    const id = 'msg_' + randomUUID();
    if (this.queued(s)) {
      if (this.waiting(s) >= GOD_QUEUE_MAX) throw new ApiError(429, 'queue-full', `${GOD_QUEUE_MAX} commands are already waiting for your agent; withdraw some or let it catch up`);
      const n = this.nextN(s.owner);
      this.db.db.prepare('INSERT INTO god_inbox_queue_v1(world_id,owner,n,id,text,sent_at) VALUES(?,?,?,?,?,?)').run(this.worldId, s.owner, n, id, text.trim(), this.now());
      this.db.db.prepare('DELETE FROM god_inbox_queue_v1 WHERE world_id=? AND owner=? AND n<=? AND acknowledged_at IS NOT NULL').run(this.worldId, s.owner, n - GOD_LOG_KEEP);
    } else this.db.db.prepare(`INSERT INTO agent_inbox_v1(world_id,scope,owner,id,text,sent_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(world_id,scope,owner) DO UPDATE SET id=excluded.id,text=excluded.text,sent_at=excluded.sent_at,delivered_at=NULL,acknowledged_at=NULL,reply=NULL`).run(this.worldId, s.scope, s.owner, id, text.trim(), this.now());
    for (const wake of [...(this.waiters.get(this.key(s)) ?? [])]) wake();
    return this.ownerView(s);
  }
  touch(s: InboxScope) {
    this.db.db.prepare(`INSERT INTO agent_inbox_v1(world_id,scope,owner,last_seen_at) VALUES(?,?,?,?)
      ON CONFLICT(world_id,scope,owner) DO UPDATE SET last_seen_at=excluded.last_seen_at`).run(this.worldId, s.scope, s.owner, this.now());
  }
  /** Called only when a private agent response actually includes this message. */
  deliver(s: InboxScope) {
    if (this.queued(s)) {
      const head = this.head(s);
      if (head && head.delivered_at === null) this.db.db.prepare('UPDATE god_inbox_queue_v1 SET delivered_at=? WHERE world_id=? AND owner=? AND n=?').run(this.now(), this.worldId, s.owner, head.n);
      return this.view(s);
    }
    this.db.db.prepare('UPDATE agent_inbox_v1 SET delivered_at=COALESCE(delivered_at,?) WHERE world_id=? AND scope=? AND owner=? AND id IS NOT NULL').run(this.now(), this.worldId, s.scope, s.owner);
    return this.view(s);
  }
  acknowledge(s: InboxScope, id: string, reply: unknown, outcome?: unknown) {
    if (reply !== undefined && (typeof reply !== 'string' || reply.length > 140 || /[\r\n]/.test(reply))) throw new ApiError(400, 'invalid', 'reply must be one line of at most 140 characters');
    if (outcome !== undefined && outcome !== 'done' && outcome !== 'failed') throw new ApiError(400, 'invalid', 'outcome is done or failed');
    if (this.queued(s)) {
      const r = this.db.db.prepare(`SELECT ${QCOLS} FROM god_inbox_queue_v1 WHERE world_id=? AND owner=? AND id=?`).get(this.worldId, s.owner, id) as QRow | undefined;
      // An ack retry is idempotent until the agent has received a later command; then the old one is gone, as before.
      if (r?.acknowledged_at != null) {
        if (this.db.db.prepare('SELECT 1 FROM god_inbox_queue_v1 WHERE world_id=? AND owner=? AND n>? AND delivered_at IS NOT NULL').get(this.worldId, s.owner, r.n)) throw new ApiError(404, 'not-found', 'this is no longer the latest message');
        return {...this.view(s), latest: this.message(r)};
      }
      if (!r) throw new ApiError(404, 'not-found', 'this is no longer the latest message');
      if (r.delivered_at === null) throw new ApiError(409, 'not-delivered', 'receive the message before acknowledging it');
      const ids = r.touched ? JSON.parse(r.touched) as string[] : [];
      let focus: TicketFocus | null = null; try { focus = ids.length ? this.focusOf(ids) : null; } catch { /* the ack stands without a link */ }
      this.db.db.prepare('UPDATE god_inbox_queue_v1 SET acknowledged_at=?,reply=?,outcome=?,focus=? WHERE world_id=? AND owner=? AND n=?')
        .run(this.now(), typeof reply === 'string' ? reply.trim() || null : null, outcome === 'failed' ? 'failed' : 'done', focus ? JSON.stringify(focus) : null, this.worldId, s.owner, r.n);
      // the answer shows the acknowledged command (and how many wait); the next one is handed over by the next listen
      return {...this.view(s), latest: this.message(this.db.db.prepare(`SELECT ${QCOLS} FROM god_inbox_queue_v1 WHERE world_id=? AND owner=? AND n=?`).get(this.worldId, s.owner, r.n) as QRow)};
    }
    const r = this.row(s);
    if (!r?.id || r.id !== id) throw new ApiError(404, 'not-found', 'this is no longer the latest message');
    if (r.delivered_at === null) throw new ApiError(409, 'not-delivered', 'receive the message before acknowledging it');
    // An ack retry is idempotent; it cannot rewrite a previous short reply.
    if (r.acknowledged_at === null) this.db.db.prepare('UPDATE agent_inbox_v1 SET acknowledged_at=?,reply=? WHERE world_id=? AND scope=? AND owner=? AND id=?').run(this.now(), typeof reply === 'string' ? reply.trim() || null : null, this.worldId, s.scope, s.owner, id);
    return this.view(s);
  }
  /** The owner takes back a command that is not finished (waiting, or one the agent holds and never finished). */
  withdraw(s: InboxScope, id: string) {
    if (!this.queued(s)) throw new ApiError(404, 'not-found', 'only god commands can be withdrawn');
    const r = this.db.db.prepare(`SELECT ${QCOLS} FROM god_inbox_queue_v1 WHERE world_id=? AND owner=? AND id=?`).get(this.worldId, s.owner, id) as QRow | undefined;
    if (!r) throw new ApiError(404, 'not-found', 'no such command');
    if (r.acknowledged_at !== null) throw new ApiError(409, 'finished', 'this command is already finished');
    this.db.db.prepare("UPDATE god_inbox_queue_v1 SET acknowledged_at=?,outcome='withdrawn' WHERE world_id=? AND owner=? AND n=?").run(this.now(), this.worldId, s.owner, r.n);
    // a listener waiting behind it gets the next command now
    for (const wake of [...(this.waiters.get(this.key(s)) ?? [])]) wake();
    return this.ownerView(s);
  }
  /** Edits that committed while the god holds a command (delivered, not acknowledged) are that command's. */
  recordTouched(s: InboxScope, ids: Iterable<string>) {
    if (!this.queued(s)) return;
    const head = this.head(s); if (!head || head.delivered_at === null) return;
    const have = head.touched ? JSON.parse(head.touched) as string[] : [], seen = new Set(have), before = have.length;
    for (const id of ids) { if (have.length >= GOD_TOUCHED_MAX) break; if (!seen.has(id)) { seen.add(id); have.push(id); } }
    if (have.length !== before) this.db.db.prepare('UPDATE god_inbox_queue_v1 SET touched=? WHERE world_id=? AND owner=? AND n=?').run(JSON.stringify(have), this.worldId, s.owner, head.n);
  }
  /** A listener is waiting for this scope (presence); the returned function ends it. */
  listening(s: InboxScope) {
    const key = this.key(s); this.listeners.set(key, (this.listeners.get(key) ?? 0) + 1);
    let ended = false;
    return () => { if (ended) return; ended = true; const n = (this.listeners.get(key) ?? 1) - 1; if (n > 0) this.listeners.set(key, n); else this.listeners.delete(key); };
  }
  listenerCount(s: InboxScope) { return this.listeners.get(this.key(s)) ?? 0; }
  async listen(s: InboxScope, after: string | undefined, timeoutMs: number, signal: AbortSignal) {
    const pending = () => { const m = this.view(s).latest; return !!m && m.id !== after && m.state !== 'acknowledged'; };
    if (pending() || signal.aborted || timeoutMs === 0) return;
    const key = this.key(s);
    await new Promise<void>(resolve => {
      let timer: ReturnType<typeof setTimeout>;
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); const set = this.waiters.get(key); set?.delete(done); if (!set?.size) this.waiters.delete(key); resolve(); };
      const set = this.waiters.get(key) ?? new Set(); set.add(done); this.waiters.set(key, set);
      timer = setTimeout(done, timeoutMs); signal.addEventListener('abort', done, {once: true});
      // No gap between the read and registration, including already-aborted signals.
      if (pending() || signal.aborted) done();
    });
  }
}
