// Private owner -> agent mailbox. Every box is a queue (a Soul's since lane MSG 2026-10-20, the god's since G4).
// MSG (Gene, 2026-10-20: "it should always work through its backlog"): a Soul's messages no longer overwrite one another;
// they wait oldest first (at most 50), each is acknowledged by its id, and a Soul's `listen` hands over the whole backlog
// at once (`backlog`, oldest first) so its agent can work through it. `presence` says whether a listener is waiting now.
// G4 (Gene, 2026-10-20): the god's box is a queue. Commands typed while the agent is away wait in order (none overwrites
// another); the agent still sees exactly one message at a time (`latest`, the oldest one it has not acknowledged), so an
// older CLI's listen/ack loop works unchanged and receives them in order. Each command is a ticket whose status comes
// from what the agent already does: sent = pending, delivered (a response to the agent carried it) = in progress,
// acknowledged = complete, or failed when its ack says so. While a ticket is in progress, the edits that commit are
// recorded against it; its ack freezes where they are (`focus`), so the owner's log can fly the camera there.
import {randomUUID} from 'node:crypto';
import type {SQLInputValue} from 'node:sqlite';
import type {Db} from './db.ts';
import {ApiError} from './souls.ts';

export type InboxScope = {scope: string; owner: string};
export type Outcome = 'done' | 'failed' | 'withdrawn';
/** `reply` = the agent's first answer ("Got it: walking to the cottage"); a Soul's `result` = its second, the outcome
 *  ("Arrived" / "Couldn't: ..."), with `outcome` done or failed. D3c: `progress` = the world's line for an act that served
 *  an earlier step of the message ("now: …; not resting yet"); the message is not finished. */
export type InboxMessage = {id: string; text: string; state: 'sent' | 'delivered' | 'acknowledged'; sentAt: number; deliveredAt?: number; acknowledgedAt?: number; reply?: string; outcome?: Outcome; result?: string; resultAt?: number; resultBy?: 'server'; progress?: string};
/** Where a finished command's edits are: the camera's target and the span to frame. */
export type TicketFocus = {x: number; y: number; z: number; span: number; label?: string; count: number};
export type Ticket = InboxMessage & {focus?: TicketFocus; touched?: number};
/** listening = a listener is waiting now; working = it holds a message and called recently; recent = it called within the
 *  last half minute; away = none of these. PRESENCE (SOUL3): a Soul's box is only ever listening (a listen open, or one
 *  closed within SOUL_LISTEN_GRACE_MS), working (that grace, holding messages it took) or away; its other calls never count. */
export type Presence = 'listening' | 'working' | 'recent' | 'away';
/** `listenedAt` (a Soul's box only): when its agent last had a listen open (now while one is), null = never; durable. */
export type InboxView = {connected: boolean; lastSeenAt: number | null; listenedAt?: number | null; latest: InboxMessage | null; queued?: number; presence?: Presence; log?: Ticket[]};
type QRow = {n: number; id: string; text: string; sent_at: number; delivered_at: number | null; acknowledged_at: number | null; reply: string | null; outcome: Outcome | null; touched: string | null; focus: string | null; result: string | null; result_by?: string | null; result_at: number | null; progress?: string | null};
export const INBOX_CONNECTED_MS = 120_000;
export const INBOX_TEXT_MAX = 1000;
/** God presence: a call within this long counts as connected; a god holding a command, within WORKING_MS. */
export const GOD_RECENT_MS = 30_000, GOD_WORKING_MS = 600_000;
/** PRESENCE (SOUL3): a Soul stays listening this long after its last listen closed (the CLI re-polls within ~50 ms; an
 *  agent working through what it took listens again soon). Only a listen counts: ordinary calls never keep it here. */
export const SOUL_LISTEN_GRACE_MS = 60_000;
/** At most this many commands wait at once; the owner's log keeps the newest LOG_KEEP. */
export const GOD_QUEUE_MAX = 50, GOD_LOG_KEEP = 200, GOD_LOG_VIEW = 50, GOD_TOUCHED_MAX = 300;
/** A Soul's box: at most this many wait; the newest SOUL_KEEP (finished included) are kept. */
export const SOUL_QUEUE_MAX = 50, SOUL_KEEP = 100;
const QCOLS = 'n,id,text,sent_at,delivered_at,acknowledged_at,reply,outcome,touched,focus';

export class AgentInbox {
  readonly db: Db; readonly worldId: string; readonly now: () => number;
  /** Set by the routes: where a ticket's touched entities are now (null when none is left in the world). */
  focusOf: (ids: string[]) => TicketFocus | null = () => null;
  private waiters = new Map<string, Set<() => void>>();
  private listeners = new Map<string, number>();
  private connectedAt = new Map<string, number>();
  /** LISTEN-LEAK: the live listen of each scope (the newest; older ones are aborted as superseded). */
  private claims = new Map<string, Set<AbortController>>();
  /** SOULSIM-H F1: told the Soul id whenever its owner writes, so its `/v1/edge/wait` wakes too (not only its listen). */
  private soulSends: ((soulId: string) => void)[] = [];
  constructor(db: Db, worldId: string, now = Date.now) {
    this.db = db; this.worldId = worldId; this.now = now;
    db.db.exec(`CREATE TABLE IF NOT EXISTS agent_inbox_v1 (
      world_id TEXT NOT NULL, scope TEXT NOT NULL, owner TEXT NOT NULL,
      id TEXT, text TEXT, sent_at INTEGER, delivered_at INTEGER, acknowledged_at INTEGER, reply TEXT, last_seen_at INTEGER, listened_at INTEGER,
      PRIMARY KEY(world_id,scope,owner)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS god_inbox_queue_v1 (
      world_id TEXT NOT NULL, owner TEXT NOT NULL, n INTEGER NOT NULL, id TEXT NOT NULL, text TEXT NOT NULL, sent_at INTEGER NOT NULL,
      delivered_at INTEGER, acknowledged_at INTEGER, reply TEXT, outcome TEXT, touched TEXT, focus TEXT,
      PRIMARY KEY(world_id,owner,n)
    ) WITHOUT ROWID;
    CREATE UNIQUE INDEX IF NOT EXISTS god_inbox_queue_v1_id ON god_inbox_queue_v1(world_id,owner,id);
    CREATE INDEX IF NOT EXISTS god_inbox_queue_v1_open ON god_inbox_queue_v1(world_id,owner,n) WHERE acknowledged_at IS NULL;
    CREATE TABLE IF NOT EXISTS soul_inbox_queue_v1 (
      world_id TEXT NOT NULL, scope TEXT NOT NULL, owner TEXT NOT NULL, n INTEGER NOT NULL, id TEXT NOT NULL, text TEXT NOT NULL, sent_at INTEGER NOT NULL,
      delivered_at INTEGER, acknowledged_at INTEGER, reply TEXT, outcome TEXT, touched TEXT, focus TEXT, result TEXT, result_at INTEGER,
      PRIMARY KEY(world_id,scope,owner,n)
    ) WITHOUT ROWID;
    CREATE UNIQUE INDEX IF NOT EXISTS soul_inbox_queue_v1_id ON soul_inbox_queue_v1(world_id,scope,owner,id);
    CREATE INDEX IF NOT EXISTS soul_inbox_queue_v1_open ON soul_inbox_queue_v1(world_id,scope,owner,n) WHERE acknowledged_at IS NULL;`);
    if (!(db.db.prepare(`SELECT 1 FROM pragma_table_info('agent_inbox_v1') WHERE name='listened_at'`).get())) db.db.exec('ALTER TABLE agent_inbox_v1 ADD COLUMN listened_at INTEGER');
    // D3: 'server' when the world wrote a message's result from the act linked to it (the agent's own result replaces it)
    if (!(db.db.prepare(`SELECT 1 FROM pragma_table_info('soul_inbox_queue_v1') WHERE name='result_by'`).get())) db.db.exec('ALTER TABLE soul_inbox_queue_v1 ADD COLUMN result_by TEXT');
    // D3c: the world's progress line for a message whose act served an earlier step (the message stays open)
    if (!(db.db.prepare(`SELECT 1 FROM pragma_table_info('soul_inbox_queue_v1') WHERE name='progress'`).get())) db.db.exec('ALTER TABLE soul_inbox_queue_v1 ADD COLUMN progress TEXT');
    // A message still waiting in the old one-message box becomes the first of its queue; the old slot is then emptied
    // (only last_seen_at stays there), so a later boot never moves it again.
    db.db.exec('BEGIN');
    try {
      for (const r of db.db.prepare(`SELECT scope,owner,id,text,sent_at,delivered_at FROM agent_inbox_v1 WHERE world_id=? AND id IS NOT NULL AND acknowledged_at IS NULL`).all(worldId) as {scope: string; owner: string; id: string; text: string; sent_at: number; delivered_at: number | null}[]) {
        const s = {scope: r.scope, owner: r.owner}, q = this.q(s);
        if (!db.db.prepare(`SELECT 1 FROM ${q.t} WHERE ${q.k} AND id=?`).get(...q.a, r.id))
          db.db.prepare(`INSERT INTO ${q.t}(${q.cols},n,id,text,sent_at,delivered_at) VALUES(${q.a.map(() => '?').join(',')},?,?,?,?,?)`).run(...q.a, this.nextN(s), r.id, r.text, r.sent_at, r.delivered_at);
        db.db.prepare('UPDATE agent_inbox_v1 SET id=NULL,text=NULL,sent_at=NULL,delivered_at=NULL,acknowledged_at=NULL,reply=NULL WHERE world_id=? AND scope=? AND owner=?').run(worldId, r.scope, r.owner);
      }
      db.db.exec('COMMIT');
    } catch (e) { db.db.exec('ROLLBACK'); throw e; }
  }
  /** Which queue holds this box: the god's (one per owner) or a Soul's (one per Soul and owner). */
  private q(s: InboxScope) {
    return s.scope === 'god'
      ? {t: 'god_inbox_queue_v1', k: 'world_id=? AND owner=?', cols: 'world_id,owner', a: [this.worldId, s.owner], sel: QCOLS + ',NULL AS result,NULL AS result_at,NULL AS result_by'}
      : {t: 'soul_inbox_queue_v1', k: 'world_id=? AND scope=? AND owner=?', cols: 'world_id,scope,owner', a: [this.worldId, s.scope, s.owner], sel: QCOLS + ',result,result_at,result_by,progress'};
  }
  private get(s: InboxScope, where: string, ...args: SQLInputValue[]) { const q = this.q(s); return this.db.db.prepare(`SELECT ${q.sel} FROM ${q.t} WHERE ${q.k} ${where}`).get(...q.a, ...args) as QRow | undefined; }
  private all(s: InboxScope, where: string, ...args: SQLInputValue[]) { const q = this.q(s); return this.db.db.prepare(`SELECT ${q.sel} FROM ${q.t} WHERE ${q.k} ${where}`).all(...q.a, ...args) as QRow[]; }
  private set(s: InboxScope, sets: string, n: number, ...args: SQLInputValue[]) { const q = this.q(s); this.db.db.prepare(`UPDATE ${q.t} SET ${sets} WHERE ${q.k} AND n=?`).run(...args, ...q.a, n); }
  private key(s: InboxScope) { return JSON.stringify([this.worldId, s.scope, s.owner]); }
  private god(s: InboxScope) { return s.scope === 'god'; }
  private seen(s: InboxScope) { const r = this.db.db.prepare('SELECT last_seen_at,listened_at FROM agent_inbox_v1 WHERE world_id=? AND scope=? AND owner=?').get(this.worldId, s.scope, s.owner) as {last_seen_at: number | null; listened_at: number | null} | undefined; return {lastSeenAt: r?.last_seen_at ?? null, listenedAt: r?.listened_at ?? null}; }
  private nextN(s: InboxScope) { const q = this.q(s); return ((this.db.db.prepare(`SELECT MAX(n) m FROM ${q.t} WHERE ${q.k}`).get(...q.a) as {m: number | null}).m ?? 0) + 1; }
  /** The message the agent sees: the oldest one not acknowledged. */
  private head(s: InboxScope) { return this.get(s, 'AND acknowledged_at IS NULL ORDER BY n LIMIT 1'); }
  private newest(s: InboxScope) { return this.get(s, 'ORDER BY n DESC LIMIT 1'); }
  private waiting(s: InboxScope) { const q = this.q(s); return (this.db.db.prepare(`SELECT COUNT(*) c FROM ${q.t} WHERE ${q.k} AND acknowledged_at IS NULL`).get(...q.a) as {c: number}).c; }
  private message(r: QRow): InboxMessage {
    return {id: r.id, text: r.text, state: r.acknowledged_at !== null ? 'acknowledged' : r.delivered_at !== null ? 'delivered' : 'sent', sentAt: r.sent_at,
      ...(r.delivered_at !== null ? {deliveredAt: r.delivered_at} : {}), ...(r.acknowledged_at !== null ? {acknowledgedAt: r.acknowledged_at} : {}),
      ...(r.reply !== null ? {reply: r.reply} : {}), ...(r.acknowledged_at !== null && r.outcome ? {outcome: r.outcome} : {}),
      ...(r.result != null ? {result: r.result} : {}), ...(r.result_at != null ? {resultAt: r.result_at} : {}), ...(r.result_by === 'server' ? {resultBy: 'server' as const} : {}), ...(r.progress != null ? {progress: r.progress} : {})};
  }
  private ticket(r: QRow): Ticket {
    const touched = r.touched ? (JSON.parse(r.touched) as string[]).length : 0;
    return {...this.message(r), ...(r.focus ? {focus: JSON.parse(r.focus) as TicketFocus} : {}), ...(touched ? {touched} : {})};
  }
  private presence(s: InboxScope, lastSeenAt: number | null, listenedAt: number | null, head: QRow | undefined): Presence {
    if ((this.listeners.get(this.key(s)) ?? 0) > 0) return 'listening';
    if (!this.god(s)) {
      const gap = listenedAt === null ? Infinity : this.now() - listenedAt;   // a clock stepped back (gap < 0) claims nothing
      return gap < 0 || gap > SOUL_LISTEN_GRACE_MS ? 'away' : head?.delivered_at != null ? 'working' : 'listening';
    }
    const age = lastSeenAt === null ? Infinity : this.now() - lastSeenAt;
    if (age < 0) return 'away';
    if (head?.delivered_at != null && age <= GOD_WORKING_MS) return 'working';
    return age <= GOD_RECENT_MS ? 'recent' : 'away';
  }
  /** What the agent sees (and every generic caller): one message, the oldest not acknowledged (else the newest), with
   *  `queued` = how many wait, this one included. */
  view(s: InboxScope): InboxView {
    const {lastSeenAt, listenedAt} = this.seen(s), head = this.head(s), shown = head ?? this.newest(s), presence = this.presence(s, lastSeenAt, listenedAt, head);
    const listened = this.god(s) ? {} : {listenedAt: this.listeners.get(this.key(s)) ? this.now() : listenedAt};
    return {connected: presence !== 'away', lastSeenAt, ...listened, latest: shown ? this.message(shown) : null, queued: head ? this.waiting(s) : 0, presence};
  }
  /** What the owner sees: `latest` = the newest message (its state and reply); the god's adds its recent log, newest first. */
  ownerView(s: InboxScope): InboxView {
    const v = this.view(s), newest = this.newest(s);
    if (!this.god(s)) return {...v, latest: newest ? this.message(newest) : null};
    const log = this.all(s, 'ORDER BY n DESC LIMIT ?', GOD_LOG_VIEW).map(r => this.ticket(r));
    return {...v, latest: newest ? this.message(newest) : null, log};
  }
  /** Where a Soul's listen `after` cursor stands (0 = before everything; an unknown or pruned id counts as 0). */
  private cursor(s: InboxScope, after: string | undefined) { return after ? this.get(s, 'AND id=?', after)?.n ?? 0 : 0; }
  /** A Soul's listen: the first message not acknowledged after the cursor (an older CLI's listen/follow loop sees it). */
  nextAfter(s: InboxScope, after: string | undefined) { const r = this.get(s, 'AND acknowledged_at IS NULL AND n>? ORDER BY n LIMIT 1', this.cursor(s, after)); return r ? this.message(r) : null; }
  /** A Soul's listen: every message not acknowledged (after the cursor), oldest first; each is now delivered (the agent
   *  holds them all). */
  takeBacklog(s: InboxScope, after?: string): InboxMessage[] {
    const rows = this.all(s, 'AND acknowledged_at IS NULL AND n>? ORDER BY n LIMIT ?', this.cursor(s, after), SOUL_QUEUE_MAX), now = this.now();
    for (const r of rows) if (r.delivered_at === null) { this.set(s, 'delivered_at=?', r.n, now); r.delivered_at = now; }
    return rows.map(r => this.message(r));
  }
  send(s: InboxScope, text: unknown) {
    if (typeof text !== 'string' || !text.trim() || text.trim().length > INBOX_TEXT_MAX) throw new ApiError(400, 'invalid', `text is required (1–${INBOX_TEXT_MAX} characters)`);
    // Keep private response headers bounded even for non-JSON commands. Normal
    // whitespace is allowed; C0 controls would expand to six-byte JSON escapes.
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new ApiError(400, 'invalid', 'text must not contain control characters');
    const id = 'msg_' + randomUUID(), god = this.god(s), q = this.q(s);
    if (this.waiting(s) >= (god ? GOD_QUEUE_MAX : SOUL_QUEUE_MAX)) throw new ApiError(429, 'queue-full', god
      ? `${GOD_QUEUE_MAX} commands are already waiting for your agent; withdraw some or let it catch up`
      : `${SOUL_QUEUE_MAX} messages are already waiting for your agent; let it catch up`);
    const n = this.nextN(s);
    this.db.db.prepare(`INSERT INTO ${q.t}(${q.cols},n,id,text,sent_at) VALUES(${q.a.map(() => '?').join(',')},?,?,?,?)`).run(...q.a, n, id, text.trim(), this.now());
    this.db.db.prepare(`DELETE FROM ${q.t} WHERE ${q.k} AND n<=? AND acknowledged_at IS NOT NULL`).run(...q.a, n - (god ? GOD_LOG_KEEP : SOUL_KEEP));
    for (const wake of [...(this.waiters.get(this.key(s)) ?? [])]) wake();
    if (!god && s.scope.startsWith('soul:')) for (const l of this.soulSends) try { l(s.scope.slice(5)); } catch { /* a waker never breaks a send */ }
    return this.ownerView(s);
  }
  onSoulSend(listener: (soulId: string) => void) { this.soulSends.push(listener); }
  /** SOULSIM-H F1: what interrupts a Soul's `wait`: messages not acknowledged that no listen has handed over yet, or that
   *  were sent at or after `since` (the agent's last look). null = nothing new. */
  ownerWrote(s: InboxScope, since: number): {waiting: number; newestAt: number} | null {
    const q = this.q(s), r = this.db.db.prepare(`SELECT COUNT(*) AS n, MAX(sent_at) AS at FROM ${q.t} WHERE ${q.k} AND acknowledged_at IS NULL AND (sent_at>=? OR delivered_at IS NULL)`).get(...q.a, since) as {n: number; at: number | null};
    return r.n ? {waiting: r.n, newestAt: r.at ?? since} : null;
  }
  touch(s: InboxScope) {
    this.db.db.prepare(`INSERT INTO agent_inbox_v1(world_id,scope,owner,last_seen_at) VALUES(?,?,?,?)
      ON CONFLICT(world_id,scope,owner) DO UPDATE SET last_seen_at=excluded.last_seen_at`).run(this.worldId, s.scope, s.owner, this.now());
  }
  /** Called only when a private agent response actually includes this message. */
  deliver(s: InboxScope) {
    const head = this.head(s);
    if (head && head.delivered_at === null) this.set(s, 'delivered_at=?', head.n, this.now());
    return this.view(s);
  }
  acknowledge(s: InboxScope, id: string, reply: unknown, outcome?: unknown) {
    if (reply !== undefined && (typeof reply !== 'string' || reply.length > 140 || /[\r\n]/.test(reply))) throw new ApiError(400, 'invalid', 'reply must be one line of at most 140 characters');
    if (outcome !== undefined && outcome !== 'done' && outcome !== 'failed') throw new ApiError(400, 'invalid', 'outcome is done or failed');
    const r = this.get(s, 'AND id=?', id);
    // An ack retry is idempotent (it cannot rewrite the reply). The god's is refused once the agent has received a later
    // command, as before; a Soul's agent holds its whole backlog at once, so its retries stay idempotent.
    if (r?.acknowledged_at != null) {
      if (this.god(s) && this.get(s, 'AND n>? AND delivered_at IS NOT NULL', r.n)) throw new ApiError(404, 'not-found', 'this is no longer the latest message');
      return {...this.view(s), latest: this.message(r)};
    }
    if (!r) throw new ApiError(404, 'not-found', 'no such message (it may be too old)');
    // The god's command must be received first. A Soul's id reaches only its agent (listen, or the private notice on any
    // answer), so acknowledging it also marks it received: listen is the one consumer, nothing else delivers.
    if (r.delivered_at === null && this.god(s)) throw new ApiError(409, 'not-delivered', 'receive the message before acknowledging it');
    const ids = r.touched ? JSON.parse(r.touched) as string[] : [];
    let focus: TicketFocus | null = null; try { focus = ids.length ? this.focusOf(ids) : null; } catch { /* the ack stands without a link */ }
    this.set(s, 'delivered_at=COALESCE(delivered_at,?),acknowledged_at=?,reply=?,outcome=?,focus=?', r.n, this.now(), this.now(), typeof reply === 'string' ? reply.trim() || null : null,
      outcome === 'failed' ? 'failed' : outcome === 'done' || this.god(s) ? 'done' : null, focus ? JSON.stringify(focus) : null);
    // the answer shows the acknowledged message (and how many wait); the next one is handed over by the next listen
    return {...this.view(s), latest: this.message(this.get(s, 'AND n=?', r.n)!)};
  }
  /** A Soul's second answer, once its work ends: `done` ("Arrived at the cottage") or `failed` ("Couldn't: ..., options: ...").
   *  It acknowledges the message too if the agent skipped that. One result per message; a retry with the same words is fine. */
  result(s: InboxScope, id: string, text: unknown, outcome: unknown) {
    if (this.god(s)) throw new ApiError(404, 'not-found', 'god commands finish with their ack');
    if (typeof text !== 'string' || !text.trim() || text.length > 140 || /[\r\n]/.test(text)) throw new ApiError(400, 'invalid', 'result must be one line of 1–140 characters');
    if (outcome !== 'done' && outcome !== 'failed') throw new ApiError(400, 'invalid', 'outcome is done or failed');
    let r = this.get(s, 'AND id=?', id);
    if (!r) throw new ApiError(404, 'not-found', 'no such message (it may be too old)');
    if (r.result_at !== null && r.result_by !== 'server') {
      if (r.result === text.trim() && r.outcome === outcome) return {...this.view(s), latest: this.message(r)};
      throw new ApiError(409, 'finished', 'this message already has its result');
    }
    if (r.acknowledged_at === null) { this.acknowledge(s, id, undefined); r = this.get(s, 'AND id=?', id)!; }
    this.set(s, 'result=?,result_at=?,outcome=?,result_by=NULL', r.n, text.trim(), this.now(), outcome);
    return {...this.view(s), latest: this.message(this.get(s, 'AND n=?', r.n)!)};
  }
  /** D3 (playtest 2026-10-25: 39% of card messages got a result before the cutoff): the world's result for a message an
   *  act was linked to (`act --for <id>`), written when that act ends. Never over the agent's own result; a later linked
   *  act's end replaces the world's earlier line. False when nothing was written. */
  serverResult(s: InboxScope, id: string, text: string, outcome: 'done' | 'failed'): boolean {
    if (this.god(s)) return false;
    const r = this.get(s, 'AND id=?', id); if (!r || (r.result_at !== null && r.result_by !== 'server')) return false;
    const line = text.replace(/\s+/g, ' ').trim(); if (!line) return false;
    this.set(s, "delivered_at=COALESCE(delivered_at,?),acknowledged_at=COALESCE(acknowledged_at,?),result=?,result_at=?,outcome=?,result_by='server'", r.n, this.now(), this.now(), line.length > 140 ? line.slice(0, 139) + '…' : line, this.now(), outcome);
    return true;
  }
  /** D3c: the world's progress line for a linked act that served an earlier step; the message stays open. Never once it
   *  has a result. False when nothing was written. */
  serverProgress(s: InboxScope, id: string, text: string): boolean {
    if (this.god(s)) return false;
    const r = this.get(s, 'AND id=?', id); if (!r || r.result_at !== null) return false;
    const line = text.replace(/\s+/g, ' ').trim(); if (!line) return false;
    this.set(s, 'delivered_at=COALESCE(delivered_at,?),acknowledged_at=COALESCE(acknowledged_at,?),progress=?', r.n, this.now(), this.now(), line.length > 140 ? line.slice(0, 139) + '…' : line);
    return true;
  }
  /** D3c: the owner's words of this Soul's message (an implicit link is judged by them), else null. */
  messageText(s: InboxScope, id: string): string | null { return this.god(s) ? null : this.get(s, 'AND id=?', id)?.text ?? null; }
  /** D3: whether this Soul's box holds a message with this id (an act may be linked to it). */
  hasMessage(s: InboxScope, id: string): boolean { return !this.god(s) && !!this.get(s, 'AND id=?', id); }
  /** The owner takes back a command that is not finished (waiting, or one the agent holds and never finished). */
  withdraw(s: InboxScope, id: string) {
    if (!this.god(s)) throw new ApiError(404, 'not-found', 'only god commands can be withdrawn');
    const r = this.get(s, 'AND id=?', id);
    if (!r) throw new ApiError(404, 'not-found', 'no such command');
    if (r.acknowledged_at !== null) throw new ApiError(409, 'finished', 'this command is already finished');
    this.set(s, "acknowledged_at=?,outcome='withdrawn'", r.n, this.now());
    // a listener waiting behind it gets the next command now
    for (const wake of [...(this.waiters.get(this.key(s)) ?? [])]) wake();
    return this.ownerView(s);
  }
  /** Edits that committed while the god holds a command (delivered, not acknowledged) are that command's. */
  recordTouched(s: InboxScope, ids: Iterable<string>) {
    if (!this.god(s)) return;
    const head = this.head(s); if (!head || head.delivered_at === null) return;
    const have = head.touched ? JSON.parse(head.touched) as string[] : [], seen = new Set(have), before = have.length;
    for (const id of ids) { if (have.length >= GOD_TOUCHED_MAX) break; if (!seen.has(id)) { seen.add(id); have.push(id); } }
    if (have.length !== before) this.set(s, 'touched=?', head.n, JSON.stringify(have));
  }
  /** A listener is waiting for this scope (presence); the returned function ends it. A Soul's open and close are stamped
   *  durably (`listened_at`), so its grace and "away since" survive a restart. (`handed` is kept for the routes' call.) */
  listening(s: InboxScope) {
    const key = this.key(s);
    // LINK: when this listen turns an away Soul connected, the owner's `link.since` starts here (in memory; a restart
    // falls back to the last listen stamp).
    if (!this.god(s) && this.view(s).presence === 'away') this.connectedAt.set(key, this.now());
    this.listeners.set(key, (this.listeners.get(key) ?? 0) + 1);
    this.listened(s);
    const soul = !this.god(s) && s.scope.startsWith('soul:') ? s.scope.slice(5) : null;
    if (soul) { this.soulOpen.set(soul, (this.soulOpen.get(soul) ?? 0) + 1); for (const l of this.soulListens) try { l(soul); } catch { /* a waker never breaks a listen */ } }
    let ended = false;
    return (_handed = false) => { if (ended) return; ended = true; const n = (this.listeners.get(key) ?? 1) - 1; if (n > 0) this.listeners.set(key, n); else this.listeners.delete(key);
      if (soul) { const k = (this.soulOpen.get(soul) ?? 1) - 1; if (k > 0) this.soulOpen.set(soul, k); else this.soulOpen.delete(soul); }
      this.listened(s); };
  }
  /** LINK BODY: open listens per Soul id (any owner), and who is told when one opens (the body rule wakes the body). */
  private soulOpen = new Map<string, number>();
  private soulListens: ((soulId: string) => void)[] = [];
  onSoulListen(listener: (soulId: string) => void) { this.soulListens.push(listener); }
  /** LINK BODY: whether this Soul's agent has a listen open now, and when it last had one (ms; null = never). Durable. */
  soulPresence(soulId: string): {listening: boolean; at: number | null} {
    if ((this.soulOpen.get(soulId) ?? 0) > 0) return {listening: true, at: this.now()};
    const r = this.db.db.prepare('SELECT MAX(listened_at) at FROM agent_inbox_v1 WHERE world_id=? AND scope=?').get(this.worldId, `soul:${soulId}`) as {at: number | null} | undefined;
    return {listening: false, at: r?.at ?? null};
  }
  private listened(s: InboxScope) {
    if (this.god(s)) return;
    this.db.db.prepare(`INSERT INTO agent_inbox_v1(world_id,scope,owner,listened_at) VALUES(?,?,?,?)
      ON CONFLICT(world_id,scope,owner) DO UPDATE SET listened_at=excluded.listened_at`).run(this.worldId, s.scope, s.owner, this.now());
  }
  /** LINK: the owner link inputs: presence now, the last listen stamp, and when the current connection began. */
  linkPresence(s: InboxScope): {presence: Presence; listenedAt: number | null; connectedSince: number | null} {
    const v = this.view(s), listenedAt = v.listenedAt ?? null, presence = v.presence ?? 'away';
    return {presence, listenedAt, connectedSince: presence === 'away' ? null : this.connectedAt.get(this.key(s)) ?? listenedAt};
  }
  listenerCount(s: InboxScope) { return this.listeners.get(this.key(s)) ?? 0; }
  /** LISTEN-LEAK: one live listen per agent. A new listen supersedes every older one for the same scope (its signal aborts;
   *  it answers 409 superseded and hands over nothing, so each message still goes to exactly one listener). */
  claimListen(s: InboxScope) {
    const key = this.key(s), ctl = new AbortController();
    for (const old of this.claims.get(key) ?? []) old.abort();
    this.claims.set(key, new Set([ctl]));
    return {signal: ctl.signal, release: () => { const set = this.claims.get(key); set?.delete(ctl); if (set && !set.size) this.claims.delete(key); }};
  }
  async listen(s: InboxScope, after: string | undefined, timeoutMs: number, signal: AbortSignal) {
    // A Soul's listen wakes for any message not acknowledged after its cursor (none = any); the god's, as before.
    const pending = this.god(s) ? () => { const m = this.view(s).latest; return !!m && m.id !== after && m.state !== 'acknowledged'; } : () => !!this.nextAfter(s, after);
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
