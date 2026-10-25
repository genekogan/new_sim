// LINK tranche (COMMON-LINK §2, SPEC-SOUL-LINK §3): the agent's self-authored public status line. One per Soul, world-scoped,
// ≤140 characters after trim, control characters stripped, text only (untrusted; clients render it as text). `null` clears.
// Not world state: never in the event log, never replayed; it lives beside the inbox in the world's database.
import type {DatabaseSync} from 'node:sqlite';

export const NOW_MAX = 140;
export type SoulNowLine = {text: string; at: number};

export class NowInvalid extends Error { constructor(message: string) { super(message); } }

/** The stored form of a `now` value: a trimmed line, or null to clear. Throws NowInvalid on anything else. */
export function cleanNow(raw: unknown): string | null {
  if (raw === null) return null;
  if (typeof raw !== 'string') throw new NowInvalid('now must be a string (≤140 characters) or null to clear');
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
  if ([...text].length > NOW_MAX) throw new NowInvalid(`now is at most ${NOW_MAX} characters`);
  return text || null;
}

export class SoulNow {
  private readonly db: DatabaseSync; private readonly worldId: string; private readonly clock: () => number;
  /** Told the Soul id after every change (the host re-sends its public card). */
  onChange: (soulId: string) => void = () => {};
  constructor(db: DatabaseSync, worldId: string, clock: () => number = Date.now) {
    this.db = db; this.worldId = worldId; this.clock = clock;
    db.exec('CREATE TABLE IF NOT EXISTS soul_now_v1 (world_id TEXT NOT NULL, soul_id TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(world_id,soul_id)) WITHOUT ROWID');
  }
  get(soulId: string): SoulNowLine | null {
    const r = this.db.prepare('SELECT text,at FROM soul_now_v1 WHERE world_id=? AND soul_id=?').get(this.worldId, soulId) as SoulNowLine | undefined;
    return r ? {text: r.text, at: r.at} : null;
  }
  /** Set (or clear with null) from an already-validated raw value; returns the stored line. */
  set(soulId: string, raw: unknown): SoulNowLine | null {
    const text = cleanNow(raw);
    if (text === null) this.db.prepare('DELETE FROM soul_now_v1 WHERE world_id=? AND soul_id=?').run(this.worldId, soulId);
    else this.db.prepare('INSERT INTO soul_now_v1(world_id,soul_id,text,at) VALUES(?,?,?,?) ON CONFLICT(world_id,soul_id) DO UPDATE SET text=excluded.text,at=excluded.at').run(this.worldId, soulId, text, this.clock());
    this.onChange(soulId);
    return this.get(soulId);
  }
}
