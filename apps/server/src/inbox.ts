// Private owner -> agent mailbox. One replaceable message, no conversation log.
import {randomUUID} from 'node:crypto';
import type {Db} from './db.ts';
import {ApiError} from './souls.ts';

export type InboxScope = {scope: string; owner: string};
export type InboxMessage = {id: string; text: string; state: 'sent' | 'delivered' | 'acknowledged'; sentAt: number; deliveredAt?: number; acknowledgedAt?: number; reply?: string};
export type InboxView = {connected: boolean; lastSeenAt: number | null; latest: InboxMessage | null};
type Row = {id: string | null; text: string | null; sent_at: number | null; delivered_at: number | null; acknowledged_at: number | null; reply: string | null; last_seen_at: number | null};
export const INBOX_CONNECTED_MS = 120_000;
export const INBOX_TEXT_MAX = 1000;

export class AgentInbox {
  readonly db: Db; readonly worldId: string; readonly now: () => number;
  private waiters = new Map<string, Set<() => void>>();
  constructor(db: Db, worldId: string, now = Date.now) {
    this.db = db; this.worldId = worldId; this.now = now;
    db.db.exec(`CREATE TABLE IF NOT EXISTS agent_inbox_v1 (
      world_id TEXT NOT NULL, scope TEXT NOT NULL, owner TEXT NOT NULL,
      id TEXT, text TEXT, sent_at INTEGER, delivered_at INTEGER, acknowledged_at INTEGER, reply TEXT, last_seen_at INTEGER,
      PRIMARY KEY(world_id,scope,owner)
    ) WITHOUT ROWID`);
  }
  private key(s: InboxScope) { return JSON.stringify([this.worldId, s.scope, s.owner]); }
  private row(s: InboxScope) { return this.db.db.prepare('SELECT id,text,sent_at,delivered_at,acknowledged_at,reply,last_seen_at FROM agent_inbox_v1 WHERE world_id=? AND scope=? AND owner=?').get(this.worldId, s.scope, s.owner) as Row | undefined; }
  view(s: InboxScope): InboxView {
    const r = this.row(s), lastSeenAt = r?.last_seen_at ?? null;
    return {connected: lastSeenAt !== null && this.now() - lastSeenAt >= 0 && this.now() - lastSeenAt <= INBOX_CONNECTED_MS, lastSeenAt,
      latest: r?.id ? {id: r.id, text: r.text!, state: r.acknowledged_at !== null ? 'acknowledged' : r.delivered_at !== null ? 'delivered' : 'sent', sentAt: r.sent_at!,
        ...(r.delivered_at !== null ? {deliveredAt: r.delivered_at} : {}), ...(r.acknowledged_at !== null ? {acknowledgedAt: r.acknowledged_at} : {}), ...(r.reply !== null ? {reply: r.reply} : {})} : null};
  }
  send(s: InboxScope, text: unknown) {
    if (typeof text !== 'string' || !text.trim() || text.trim().length > INBOX_TEXT_MAX) throw new ApiError(400, 'invalid', `text is required (1–${INBOX_TEXT_MAX} characters)`);
    // Keep private response headers bounded even for non-JSON commands. Normal
    // whitespace is allowed; C0 controls would expand to six-byte JSON escapes.
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new ApiError(400, 'invalid', 'text must not contain control characters');
    this.db.db.prepare(`INSERT INTO agent_inbox_v1(world_id,scope,owner,id,text,sent_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(world_id,scope,owner) DO UPDATE SET id=excluded.id,text=excluded.text,sent_at=excluded.sent_at,delivered_at=NULL,acknowledged_at=NULL,reply=NULL`).run(this.worldId, s.scope, s.owner, 'msg_' + randomUUID(), text.trim(), this.now());
    for (const wake of [...(this.waiters.get(this.key(s)) ?? [])]) wake();
    return this.view(s);
  }
  touch(s: InboxScope) {
    this.db.db.prepare(`INSERT INTO agent_inbox_v1(world_id,scope,owner,last_seen_at) VALUES(?,?,?,?)
      ON CONFLICT(world_id,scope,owner) DO UPDATE SET last_seen_at=excluded.last_seen_at`).run(this.worldId, s.scope, s.owner, this.now());
  }
  /** Called only when a private agent response actually includes this message. */
  deliver(s: InboxScope) {
    this.db.db.prepare('UPDATE agent_inbox_v1 SET delivered_at=COALESCE(delivered_at,?) WHERE world_id=? AND scope=? AND owner=? AND id IS NOT NULL').run(this.now(), this.worldId, s.scope, s.owner);
    return this.view(s);
  }
  acknowledge(s: InboxScope, id: string, reply: unknown) {
    if (reply !== undefined && (typeof reply !== 'string' || reply.length > 140 || /[\r\n]/.test(reply))) throw new ApiError(400, 'invalid', 'reply must be one line of at most 140 characters');
    const r = this.row(s);
    if (!r?.id || r.id !== id) throw new ApiError(404, 'not-found', 'this is no longer the latest message');
    if (r.delivered_at === null) throw new ApiError(409, 'not-delivered', 'receive the message before acknowledging it');
    // An ack retry is idempotent; it cannot rewrite a previous short reply.
    if (r.acknowledged_at === null) this.db.db.prepare('UPDATE agent_inbox_v1 SET acknowledged_at=?,reply=? WHERE world_id=? AND scope=? AND owner=? AND id=?').run(this.now(), typeof reply === 'string' ? reply.trim() || null : null, this.worldId, s.scope, s.owner, id);
    return this.view(s);
  }
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
