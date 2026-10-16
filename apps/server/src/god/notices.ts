// What a resident perceives about the god's edits (G1 walk-outs; R8 reuses it for "the god changed something near
// you"). One small shape, three paths: pushed on the resident's edge stream as kind `god-change` (salience 3 when the
// resident was moved, else 2, unless the caller says otherwise), kept per Soul for its next observation
// (`observe().notices`, newest first) and, with `native: true`, logged for a native mind (a line in its recent memory
// that wakes it; world.ts `godNoticeV1`). A walk-out needs no `native`: its own logged event tells the native mind.
import type { Db } from '../db.ts';

export type GodNotice = {
  kind: 'god-change';
  /** One plain sentence the resident can read ("The god is rebuilding the church; you stepped outside."). */
  text: string;
  /** Wall-clock ms and world tick when the notice was given. */
  at: number; tick: number;
  /** What the god changed, by name, when there is one. */
  place?: string;
  /** Set when the resident's body was moved by the edit. */
  moved?: 'walked' | 'relocated';
};
export type GodNoticeInput = { text: string; tick: number; place?: string; moved?: GodNotice['moved']; salience?: 1 | 2 | 3; /** also tell a native (brain) mind, through the log */ native?: boolean };
type Streams = { deliver?(soulId: string, kind: string, tick: number, body: Record<string, unknown>): unknown };

const KEEP = 20;              // per Soul, durable
const SHOW = 3;               // in an observation
const FRESH_MS = 30 * 60_000; // older notices are history, not news

export class GodNotices {
  private readonly db: Db; private readonly worldId: string; private readonly now: () => number;
  /** The resident's push stream when edge comms are attached (resolved at call time: comms attach after the bridge). */
  streams: () => Streams | undefined = () => undefined;
  /** Logs the notice for a native mind (installed by the engine bridge). */
  native: ((soulId: string, text: string) => void) | undefined;
  constructor(db: Db, worldId: string, now: () => number = Date.now) {
    this.db = db; this.worldId = worldId; this.now = now;
    db.db.exec('CREATE TABLE IF NOT EXISTS god_notices_v1 (world_id TEXT NOT NULL, soul_id TEXT NOT NULL, n INTEGER NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), PRIMARY KEY (world_id, soul_id, n)) WITHOUT ROWID');
  }

  /** Keep the notice for the Soul's next observation and push it on its stream. Never throws. */
  notify(soulId: string, input: GodNoticeInput): GodNotice {
    const notice: GodNotice = { kind: 'god-change', text: input.text, at: this.now(), tick: input.tick, ...(input.place ? { place: input.place } : {}), ...(input.moved ? { moved: input.moved } : {}) };
    try {
      const row = this.db.db.prepare('SELECT MAX(n) n FROM god_notices_v1 WHERE world_id=? AND soul_id=?').get(this.worldId, soulId) as { n: number | null } | undefined;
      const n = (row?.n ?? 0) + 1;
      this.db.db.prepare('INSERT INTO god_notices_v1 (world_id, soul_id, n, body) VALUES (?,?,?,?)').run(this.worldId, soulId, n, JSON.stringify(notice));
      this.db.db.prepare('DELETE FROM god_notices_v1 WHERE world_id=? AND soul_id=? AND n<=?').run(this.worldId, soulId, n - KEEP);
    } catch { /* a notice never breaks the edit that caused it */ }
    try {
      const { kind: _kind, at: _at, tick: _tick, ...body } = notice;
      this.streams()?.deliver?.(soulId, 'god-change', input.tick, { ...body, ...(input.salience ? { salience: input.salience } : {}) });
    } catch { /* push is best effort; the observation still carries it */ }
    if (input.native) try { this.native?.(soulId, input.text); } catch { /* best effort, like the push */ }
    return notice;
  }

  /** The Soul's recent notices, newest first (at most 3, none older than 30 minutes). */
  recent(soulId: string, limit = SHOW): GodNotice[] {
    try {
      const rows = this.db.db.prepare('SELECT body FROM god_notices_v1 WHERE world_id=? AND soul_id=? ORDER BY n DESC LIMIT ?').all(this.worldId, soulId, limit) as { body: string }[];
      const since = this.now() - FRESH_MS;
      return rows.map(r => JSON.parse(r.body) as GodNotice).filter(n => n.at >= since);
    } catch { return []; }
  }
}
