// Persistence for the entity world (spec <eden4>/28 §10): small JSON rows
// in the world's SQLite, created ad hoc like the other edge features. Assets
// (meshes, textures) are NOT stored here; they go to the content-addressed
// file store (M5). Tables carry world_id first and a composite key.
import type { Db } from '../db.ts';
import { WorldModel, type Diff, type Op, type StoredDef, type Entity } from '@sim/world-compiler';

export type EditRow = { seq: number; by: string; at: number; note: string | null; grp: string | null; ops: Op[]; inverse: Op[]; undone: number; undo_of: number | null; kind: 'edit' | 'undo' | 'redo' };
export type PrayerRow = { id: string; soul_id: string; soul_name: string; text: string; at: number; answer: string | null; answered_at: number | null };

export function ensureWorldSchema(db: Db) {
  db.db.exec(`
    CREATE TABLE IF NOT EXISTS world_meta_v1 (world_id TEXT PRIMARY KEY, body TEXT NOT NULL CHECK(json_valid(body))) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS world_defs_v1 (world_id TEXT NOT NULL, hash TEXT NOT NULL, ref TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), PRIMARY KEY (world_id, hash)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS world_entities_v1 (world_id TEXT NOT NULL, id TEXT NOT NULL, parent TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), PRIMARY KEY (world_id, id)) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS world_entities_v1_parent ON world_entities_v1 (world_id, parent);
    CREATE TABLE IF NOT EXISTS world_edits_v1 (world_id TEXT NOT NULL, seq INTEGER NOT NULL, by TEXT NOT NULL, at INTEGER NOT NULL, note TEXT, ops TEXT NOT NULL, inverse TEXT NOT NULL, undone INTEGER NOT NULL DEFAULT 0, undo_of INTEGER, kind TEXT NOT NULL DEFAULT 'edit', PRIMARY KEY (world_id, seq)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS god_tokens_v1 (world_id TEXT NOT NULL, token_hash TEXT NOT NULL, label TEXT, created_at INTEGER NOT NULL, last_used INTEGER, PRIMARY KEY (world_id, token_hash)) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS god_prayers_v1 (world_id TEXT NOT NULL, id TEXT NOT NULL, soul_id TEXT NOT NULL, soul_name TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL, answer TEXT, answered_at INTEGER, PRIMARY KEY (world_id, id)) WITHOUT ROWID;
  `);
  const cols = (db.db.prepare('PRAGMA table_info(world_edits_v1)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('grp')) db.db.exec('ALTER TABLE world_edits_v1 ADD COLUMN grp TEXT');
}

type Meta = { constants: WorldModel['constants']; state: WorldModel['state']; seed: string; seq: number; editSeq: number; ground: ReturnType<WorldModel['ground']>; owner: string | null };

export class WorldStore {
  readonly db: Db; readonly worldId: string;
  constructor(db: Db, worldId: string) { this.db = db; this.worldId = worldId; ensureWorldSchema(db); }

  meta(): Meta | null {
    const r = this.db.db.prepare('SELECT body FROM world_meta_v1 WHERE world_id=?').get(this.worldId) as { body: string } | undefined;
    return r ? (JSON.parse(r.body) as Meta) : null;
  }
  /** Load the model, or null when this world has never been initialised. */
  load(assets?: ConstructorParameters<typeof WorldModel>[0]['assets']): { model: WorldModel; owner: string | null } | null {
    const meta = this.meta(); if (!meta) return null;
    const defs = (this.db.db.prepare('SELECT body FROM world_defs_v1 WHERE world_id=?').all(this.worldId) as { body: string }[]).map((r) => JSON.parse(r.body) as StoredDef);
    const entities = (this.db.db.prepare('SELECT body FROM world_entities_v1 WHERE world_id=?').all(this.worldId) as { body: string }[]).map((r) => JSON.parse(r.body) as Entity);
    const model = WorldModel.fromSnapshot({ constants: meta.constants, state: meta.state, seed: meta.seed, seq: meta.seq, editSeq: meta.editSeq, defs, entities, ground: meta.ground }, assets);
    return { model, owner: meta.owner };
  }
  /** First write: constants, seed, the core kit. */
  init(model: WorldModel, owner: string | null) {
    this.tx(() => {
      this.writeMeta(model, owner);
      for (const d of new Set(model.defs.values())) this.writeDef(d);
    });
  }
  private writeMeta(model: WorldModel, owner: string | null) {
    const meta: Meta = { constants: model.constants, state: model.state, seed: model.seed, seq: model.seq, editSeq: model.editSeq, ground: model.ground(), owner };
    this.db.db.prepare('INSERT INTO world_meta_v1 (world_id, body) VALUES (?, ?) ON CONFLICT(world_id) DO UPDATE SET body=excluded.body').run(this.worldId, JSON.stringify(meta));
  }
  private writeDef(d: StoredDef) {
    this.db.db.prepare('INSERT OR IGNORE INTO world_defs_v1 (world_id, hash, ref, body) VALUES (?, ?, ?, ?)').run(this.worldId, d.hash, d.ref, JSON.stringify(d));
  }
  /** One committed batch: entity rows, defs, meta, and the edit with its inverse. */
  commit(model: WorldModel, owner: string | null, diff: Diff, edit: { seq: number; by: string; at: number; note?: string; group?: string; ops: Op[]; inverse: Op[]; kind: EditRow['kind']; undoOf?: number }) {
    this.tx(() => {
      for (const d of diff.defs) this.writeDef(d);
      const up = this.db.db.prepare('INSERT INTO world_entities_v1 (world_id, id, parent, body) VALUES (?, ?, ?, ?) ON CONFLICT(world_id, id) DO UPDATE SET parent=excluded.parent, body=excluded.body');
      for (const e of diff.upserts) up.run(this.worldId, e.id, e.in.parent, JSON.stringify(e));
      const del = this.db.db.prepare('DELETE FROM world_entities_v1 WHERE world_id=? AND id=?');
      for (const id of diff.removes) del.run(this.worldId, id);
      this.writeMeta(model, owner);
      if (edit.ops.length || edit.kind !== 'edit') this.db.db.prepare('INSERT INTO world_edits_v1 (world_id, seq, by, at, note, grp, ops, inverse, undone, undo_of, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)')
        .run(this.worldId, edit.seq, edit.by, edit.at, edit.note ?? null, edit.group ?? null, JSON.stringify(edit.ops), JSON.stringify(edit.inverse), edit.undoOf ?? null, edit.kind);
      if (edit.kind === 'undo') this.db.db.prepare('UPDATE world_edits_v1 SET undone=1 WHERE world_id=? AND seq=?').run(this.worldId, edit.undoOf!);
      if (edit.kind === 'redo') this.db.db.prepare('UPDATE world_edits_v1 SET undone=1 WHERE world_id=? AND seq=?').run(this.worldId, edit.undoOf!);
      // a fresh edit clears the redo stack: pending undos can no longer be redone
      if (edit.kind === 'edit') this.db.db.prepare("UPDATE world_edits_v1 SET undone=1 WHERE world_id=? AND kind='undo' AND undone=0").run(this.worldId);
    });
  }
  setOwner(model: WorldModel, owner: string) { this.tx(() => this.writeMeta(model, owner)); }

  edits(limit = 50): EditRow[] {
    return (this.db.db.prepare('SELECT seq, by, at, note, grp, ops, inverse, undone, undo_of, kind FROM world_edits_v1 WHERE world_id=? ORDER BY seq DESC LIMIT ?').all(this.worldId, limit) as (Omit<EditRow, 'ops' | 'inverse'> & { ops: string; inverse: string })[])
      .map((r) => ({ ...r, ops: JSON.parse(r.ops), inverse: JSON.parse(r.inverse) }));
  }
  /** The edit `undo` would revert: newest not-undone edit or redo. */
  undoable(): EditRow | null { return this.edits(500).find((e) => !e.undone && e.kind !== 'undo') ?? null; }
  /** The undo `redo` would revert: newest not-undone undo. */
  redoable(): EditRow | null { return this.edits(500).find((e) => !e.undone && e.kind === 'undo') ?? null; }

  // ---- god tokens
  addToken(hash: string, label: string | null) { this.db.db.prepare('INSERT OR IGNORE INTO god_tokens_v1 (world_id, token_hash, label, created_at) VALUES (?, ?, ?, ?)').run(this.worldId, hash, label, Date.now()); }
  hasToken(hash: string): boolean {
    const r = this.db.db.prepare('SELECT token_hash FROM god_tokens_v1 WHERE world_id=? AND token_hash=?').get(this.worldId, hash);
    if (r) this.db.db.prepare('UPDATE god_tokens_v1 SET last_used=? WHERE world_id=? AND token_hash=?').run(Date.now(), this.worldId, hash);
    return !!r;
  }
  tokens(): { label: string | null; created_at: number; last_used: number | null }[] { return this.db.db.prepare('SELECT label, created_at, last_used FROM god_tokens_v1 WHERE world_id=?').all(this.worldId) as never; }

  // ---- prayers
  addPrayer(p: PrayerRow) { this.db.db.prepare('INSERT INTO god_prayers_v1 (world_id, id, soul_id, soul_name, text, at) VALUES (?, ?, ?, ?, ?, ?)').run(this.worldId, p.id, p.soul_id, p.soul_name, p.text, p.at); }
  answerPrayer(id: string, answer: string): PrayerRow | null {
    this.db.db.prepare('UPDATE god_prayers_v1 SET answer=?, answered_at=? WHERE world_id=? AND id=?').run(answer, Date.now(), this.worldId, id);
    return (this.db.db.prepare('SELECT id, soul_id, soul_name, text, at, answer, answered_at FROM god_prayers_v1 WHERE world_id=? AND id=?').get(this.worldId, id) as PrayerRow | undefined) ?? null;
  }
  prayers(opts: { unanswered?: boolean; soulId?: string; limit?: number } = {}): PrayerRow[] {
    const where = ['world_id=?']; const args: unknown[] = [this.worldId];
    if (opts.unanswered) where.push('answer IS NULL');
    if (opts.soulId) { where.push('soul_id=?'); args.push(opts.soulId); }
    return this.db.db.prepare(`SELECT id, soul_id, soul_name, text, at, answer, answered_at FROM god_prayers_v1 WHERE ${where.join(' AND ')} ORDER BY at DESC LIMIT ?`).all(...(args as never[]), opts.limit ?? 100) as PrayerRow[];
  }

  private tx(fn: () => void) {
    this.db.db.exec('BEGIN IMMEDIATE');
    try { fn(); this.db.db.exec('COMMIT'); } catch (e) { this.db.db.exec('ROLLBACK'); throw e; }
  }
}
