// Persistence for the entity world (spec <eden4>/28 §10): small JSON rows
// in the world's SQLite, created ad hoc like the other edge features. Assets
// (meshes, textures) are NOT stored here; they go to the content-addressed
// file store (M5). Tables carry world_id first and a composite key.
import type { Db } from '../db.ts';
import { WorldModel, type Diff, type Op, type StoredDef, type Entity, type Accepted, type Result } from '@sim/world-compiler';
import { CREATION_LIMITS as L } from '@sim/generators';

export const GOD_EDIT_RECEIPTS = L.requestReceipts;
export const GOD_EDIT_OUTCOME_BYTES = L.requestOutcomeBytes;
export type EditRequest = { clientRef: string; requestHash: string; payloadHash: string; result: Accepted };
export type CommittedReceipt = { world: string; clientRef: string; payloadHash: string; seq: number; result: Accepted };
export type BuildRow = { id: string; status: 'active' | 'paused' | 'done' | 'abandoned'; rev: number; created_at: number; last_at: number; body: string };
export type BuildWrite = { id: string; expectRev: number; status: BuildRow['status']; lastAt: number; body: string; echo?: true; rev?: number };
type CommitEdit = { seq: number; by: string; at: number; note?: string; group?: string; ops: Op[]; inverse: Op[]; kind: EditRow['kind']; undoOf?: number; builds?: BuildWrite[] };
class StaleBuild extends Error {}
const staleBuild = (): Result => ({ accepted: false, failures: [{ op: -1, code: 'revision.stale', field: 'build', detail: 'The durable build changed while this edit was planned.', fix: 'Read the build and re-plan the edit.' }] });

export type EditRow = { seq: number; by: string; at: number; note: string | null; grp: string | null; ops: Op[]; inverse: Op[]; undone: number; undo_of: number | null; kind: 'edit' | 'undo' | 'redo' | 'engine' };
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
    CREATE TABLE IF NOT EXISTS god_edit_receipts_v1 (world_id TEXT NOT NULL, client_ref TEXT NOT NULL CHECK(length(client_ref)<=100), request_hash TEXT NOT NULL, payload_hash TEXT NOT NULL, seq INTEGER NOT NULL, result TEXT NOT NULL CHECK(json_valid(result) AND length(CAST(result AS BLOB))<=${L.requestOutcomeBytes}), PRIMARY KEY(world_id,client_ref)) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS god_edit_receipts_v1_seq ON god_edit_receipts_v1(world_id,seq DESC);
    CREATE TABLE IF NOT EXISTS world_edit_usage_v1 (world_id TEXT PRIMARY KEY, entries INTEGER NOT NULL, bytes INTEGER NOT NULL) WITHOUT ROWID;
    INSERT OR IGNORE INTO world_edit_usage_v1 SELECT world_id,count(*),sum(length(CAST(ops AS BLOB))+length(CAST(inverse AS BLOB))+coalesce(length(CAST(note AS BLOB)),0)) FROM world_edits_v1 WHERE world_id NOT IN (SELECT world_id FROM world_edit_usage_v1) GROUP BY world_id;
    CREATE TRIGGER IF NOT EXISTS world_edit_usage_insert_v1 AFTER INSERT ON world_edits_v1 BEGIN
      INSERT INTO world_edit_usage_v1(world_id,entries,bytes) VALUES(new.world_id,1,length(CAST(new.ops AS BLOB))+length(CAST(new.inverse AS BLOB))+coalesce(length(CAST(new.note AS BLOB)),0))
      ON CONFLICT(world_id) DO UPDATE SET entries=entries+1,bytes=bytes+excluded.bytes;
    END;
  `);
  const cols = (db.db.prepare('PRAGMA table_info(world_edits_v1)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('grp')) db.db.exec('ALTER TABLE world_edits_v1 ADD COLUMN grp TEXT');
  db.db.exec(`
    CREATE INDEX IF NOT EXISTS world_edits_v1_grp ON world_edits_v1(world_id,grp);
    CREATE TABLE IF NOT EXISTS god_builds_v1 (
      world_id TEXT NOT NULL, id TEXT NOT NULL CHECK(length(id)<=40),
      status TEXT NOT NULL CHECK(status IN ('active','paused','done','abandoned')),
      rev INTEGER NOT NULL, created_at INTEGER NOT NULL, last_at INTEGER NOT NULL,
      body TEXT NOT NULL CHECK(json_valid(body) AND length(CAST(body AS BLOB))<=65536),
      PRIMARY KEY(world_id,id)) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS god_builds_v1_open ON god_builds_v1(world_id,status,last_at);
    CREATE INDEX IF NOT EXISTS god_builds_v1_rev ON god_builds_v1(world_id,rev);
  `);
}

type Meta = { constants: WorldModel['constants']; state: WorldModel['state']; seed: string; seq: number; editSeq: number; ground: ReturnType<WorldModel['ground']>; owner: string | null; defRefs?: Record<string, string> };

export class WorldStore {
  readonly db: Db; readonly worldId: string;
  constructor(db: Db, worldId: string) { this.db = db; this.worldId = worldId; ensureWorldSchema(db); }

  meta(): Meta | null {
    const r = this.db.db.prepare('SELECT body FROM world_meta_v1 WHERE world_id=?').get(this.worldId) as { body: string } | undefined;
    return r ? (JSON.parse(r.body) as Meta) : null;
  }
  /** Load the model, or null when this world has never been initialised. */
  load(assets?: ConstructorParameters<typeof WorldModel>[0]['assets'], library?: WorldModel['library']): { model: WorldModel; owner: string | null } | null {
    const meta = this.meta(); if (!meta) return null;
    const defs = (this.db.db.prepare('SELECT body FROM world_defs_v1 WHERE world_id=?').all(this.worldId) as { body: string }[]).map((r) => JSON.parse(r.body) as StoredDef);
    const entities = (this.db.db.prepare('SELECT body FROM world_entities_v1 WHERE world_id=?').all(this.worldId) as { body: string }[]).map((r) => JSON.parse(r.body) as Entity);
    const model = WorldModel.fromSnapshot({ constants: meta.constants, state: meta.state, seed: meta.seed, seq: meta.seq, editSeq: meta.editSeq, defs, defRefs: meta.defRefs, entities, ground: meta.ground }, assets, library);
    return { model, owner: meta.owner };
  }
  /** First write: constants, seed, and any defs the model already stores (none from the shared library: CATRUN). */
  init(model: WorldModel, owner: string | null) {
    this.tx(() => {
      this.writeMeta(model, owner);
      for (const d of new Set(model.defs.values())) this.writeDef(d);
    });
  }
  private writeMeta(model: WorldModel, owner: string | null) {
    const meta: Meta = { constants: model.constants, state: model.state, seed: model.seed, seq: model.seq, editSeq: model.editSeq, ground: model.ground(), owner, defRefs: model.defRefs() };
    this.db.db.prepare('INSERT INTO world_meta_v1 (world_id, body) VALUES (?, ?) ON CONFLICT(world_id) DO UPDATE SET body=excluded.body').run(this.worldId, JSON.stringify(meta));
  }
  private writeDef(d: StoredDef) {
    this.db.db.prepare('INSERT OR IGNORE INTO world_defs_v1 (world_id, hash, ref, body) VALUES (?, ?, ?, ?)').run(this.worldId, d.hash, d.ref, JSON.stringify(d));
  }
  /** One committed batch: entity rows, defs, meta, and the edit with its inverse. */
  commit(model: WorldModel, owner: string | null, diff: Diff, edit: CommitEdit, request?: EditRequest): Result | null {
    try { return this.tx(() => {
      // Recheck under the write lock: another connection may have committed while this owner planned.
      if (request) { const replay = this.retry(request.clientRef, request.requestHash); if (replay) return replay; }
      if (this.meta()?.editSeq !== edit.seq - 1) return { accepted: false, failures: [{ op: -1, code: 'revision.stale', detail: 'The durable world changed while this owner planned. Reload the world before submitting another edit.', field: 'editSeq', fix: 'Reload the current world and re-plan the edit.' }] } as Result;
      for (const b of edit.builds ?? []) if ((this.db.db.prepare('SELECT rev FROM god_builds_v1 WHERE world_id=? AND id=?').get(this.worldId, b.id) as { rev: number } | undefined)?.rev !== b.expectRev) return staleBuild();
      const journal = this.journalBudgetFailure(edit, diff); if (journal) return journal;
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
      for (const a of diff.answers) this.db.db.prepare('UPDATE god_prayers_v1 SET answer=?,answered_at=? WHERE world_id=? AND id=?').run(a.text, edit.at, this.worldId, a.prayer);
      for (const b of edit.builds ?? []) {
        this.updateBuild(b);
        if (b.echo && request) (request.result as Accepted & { build: { rev: number } }).build.rev = b.rev!;
      }
      if (edit.builds?.length) this.pruneBuilds();
      if (request) {
        this.db.db.prepare('INSERT INTO god_edit_receipts_v1(world_id,client_ref,request_hash,payload_hash,seq,result) VALUES(?,?,?,?,?,?)').run(this.worldId, request.clientRef, request.requestHash, request.payloadHash, edit.seq, JSON.stringify(request.result));
        this.db.db.prepare('DELETE FROM god_edit_receipts_v1 WHERE world_id=? AND client_ref IN (SELECT client_ref FROM god_edit_receipts_v1 WHERE world_id=? ORDER BY seq DESC LIMIT -1 OFFSET ?)').run(this.worldId, this.worldId, GOD_EDIT_RECEIPTS);
      }
      return null;
    }); } catch (e) { if (e instanceof StaleBuild) return staleBuild(); throw e; }
  }
  /** Durable aggregate avoids rescanning the append-only journal on each construction edit. */
  private journalBudgetFailure(edit: CommitEdit, diff: Diff): Result | null {
    if (!edit.ops.length && edit.kind === 'edit') return null;
    const old = this.db.db.prepare('SELECT entries,bytes FROM world_edit_usage_v1 WHERE world_id=?').get(this.worldId) as { entries: number; bytes: number } | undefined;
    const bytes = Buffer.byteLength(JSON.stringify(edit.ops)) + Buffer.byteLength(JSON.stringify(edit.inverse)) + Buffer.byteLength(edit.note ?? '');
    // An exhausted creation budget must not strand a retired body/probe. Reserve a bounded amount
    // for engine edits that strictly remove existing entities, without creating entities or defs.
    const existing = this.db.db.prepare('SELECT 1 FROM world_entities_v1 WHERE world_id=? AND id=?');
    const cleanup = edit.kind === 'engine' && diff.removes.length > 0 && !diff.defs.length && diff.upserts.every(e => existing.get(this.worldId, e.id));
    const entryLimit = L.journalEntries + (cleanup ? L.journalCleanupEntries : 0), byteLimit = L.journalBytes + (cleanup ? L.journalCleanupBytes : 0);
    for (const [field, measured, limit] of [['journal.entries', (old?.entries ?? 0) + 1, entryLimit], ['journal.bytes', (old?.bytes ?? 0) + bytes, byteLimit]] as const) {
      if (measured > limit) return { accepted: false, failures: [{ op: -1, code: 'budget.world', field, measured, limit, detail: `${field}: ${measured} > ${limit}`, fix: 'This world has reached its retained authoring journal budget. Preserve its history and ask the owner to provision an archive before more edits.' }] };
    }
    return null;
  }
  receipt(clientRef: string): CommittedReceipt | null {
    const row = this.db.db.prepare('SELECT payload_hash,seq,result FROM god_edit_receipts_v1 WHERE world_id=? AND client_ref=?').get(this.worldId, clientRef) as { payload_hash: string; seq: number; result: string } | undefined;
    return row ? { world: this.worldId, clientRef, payloadHash: row.payload_hash, seq: row.seq, result: JSON.parse(row.result) as Accepted } : null;
  }
  retry(clientRef: string, requestHash: string): Result | null {
    const row = this.db.db.prepare('SELECT request_hash,seq,result FROM god_edit_receipts_v1 WHERE world_id=? AND client_ref=?').get(this.worldId, clientRef) as { request_hash: string; seq: number; result: string } | undefined;
    if (!row) return null;
    return row.request_hash === requestHash ? { ...JSON.parse(row.result) as Accepted, replayed: true } : { accepted: false, failures: [{ op: -1, code: 'request.conflict', detail: `clientRef ${JSON.stringify(clientRef)} already committed a different payload at seq ${row.seq}.`, field: 'clientRef', measured: { seq: row.seq }, fix: 'Look up the original receipt, or use a fresh clientRef for a different edit.' }] };
  }
  setOwner(model: WorldModel, owner: string) { this.tx(() => this.writeMeta(model, owner)); }

  edits(limit = 50): EditRow[] {
    return (this.db.db.prepare('SELECT seq, by, at, note, grp, ops, inverse, undone, undo_of, kind FROM world_edits_v1 WHERE world_id=? ORDER BY seq DESC LIMIT ?').all(this.worldId, limit) as (Omit<EditRow, 'ops' | 'inverse'> & { ops: string; inverse: string })[])
      .map((r) => ({ ...r, ops: JSON.parse(r.ops), inverse: JSON.parse(r.inverse) }));
  }
  /** The edit `undo` would revert: newest not-undone edit or redo. */
  undoable(): EditRow | null { return this.stackHead("kind IN ('edit','redo')"); }
  /** The undo `redo` would revert: newest not-undone undo. */
  redoable(): EditRow | null { return this.stackHead("kind='undo'"); }
  private stackHead(predicate: string): EditRow | null {
    const r = this.db.db.prepare(`SELECT seq,by,at,note,grp,ops,inverse,undone,undo_of,kind FROM world_edits_v1 WHERE world_id=? AND undone=0 AND ${predicate} ORDER BY seq DESC LIMIT 1`).get(this.worldId) as (Omit<EditRow, 'ops' | 'inverse'> & { ops: string; inverse: string }) | undefined;
    return r ? { ...r, ops: JSON.parse(r.ops), inverse: JSON.parse(r.inverse) } : null;
  }
  /** Snapshot the complete group stack before undo starts; newly journaled undos cannot hide older group edits. */
  groupEdits(group: string): EditRow[] {
    return (this.db.db.prepare("SELECT seq, by, at, note, grp, ops, inverse, undone, undo_of, kind FROM world_edits_v1 WHERE world_id=? AND grp=? AND undone=0 AND kind IN ('edit','redo') ORDER BY seq DESC").all(this.worldId, group) as (Omit<EditRow, 'ops' | 'inverse'> & { ops: string; inverse: string })[])
      .map(r => ({ ...r, ops: JSON.parse(r.ops), inverse: JSON.parse(r.inverse) }));
  }

  /** Exact group and descendants, with an index range that cannot adopt a neighbouring id. */
  groupEditsUnder(group: string, journal = false, limit = 200): EditRow[] {
    const rows = this.db.db.prepare(`SELECT seq,by,at,note,grp,ops,inverse,undone,undo_of,kind FROM world_edits_v1 WHERE world_id=? AND (grp=? OR (grp>=? AND grp<?)) ${journal ? '' : "AND undone=0 AND kind IN ('edit','redo')"} ORDER BY seq DESC LIMIT ?`).all(this.worldId, group, group + '/', group + '0', limit) as (Omit<EditRow, 'ops' | 'inverse'> & { ops: string; inverse: string })[];
    return rows.map(r => ({ ...r, ops: JSON.parse(r.ops), inverse: JSON.parse(r.inverse) }));
  }
  hasGroupUnder(id: string): boolean { return !!this.db.db.prepare('SELECT 1 FROM world_edits_v1 WHERE world_id=? AND (grp=? OR (grp>=? AND grp<?)) LIMIT 1').get(this.worldId, id, id + '/', id + '0'); }
  builds(openOnly = false): BuildRow[] { return this.db.db.prepare(`SELECT id,status,rev,created_at,last_at,body FROM god_builds_v1 WHERE world_id=? ${openOnly ? "AND status IN ('active','paused')" : ''} ORDER BY rev DESC`).all(this.worldId) as BuildRow[]; }
  build(id: string): BuildRow | null { return this.db.db.prepare('SELECT id,status,rev,created_at,last_at,body FROM god_builds_v1 WHERE world_id=? AND id=?').get(this.worldId, id) as BuildRow ?? null; }
  buildsRev(): number { return (this.db.db.prepare('SELECT COALESCE(MAX(rev),0) AS rev FROM god_builds_v1 WHERE world_id=?').get(this.worldId) as { rev: number }).rev; }
  insertBuild(id: string, at: number, body: string): BuildRow | null {
    return this.tx(() => {
      if (this.build(id) || this.hasGroupUnder(id)) return null;
      this.db.db.prepare("INSERT INTO god_builds_v1(world_id,id,status,rev,created_at,last_at,body) SELECT ?,?,'active',COALESCE(MAX(rev),0)+1,?,?,? FROM god_builds_v1 WHERE world_id=?").run(this.worldId, id, at, at, body, this.worldId);
      return this.build(id)!;
    });
  }
  saveBuild(b: BuildWrite): Result | null {
    try { return this.tx(() => { this.updateBuild(b); this.pruneBuilds(); return null; }); }
    catch (e) { if (e instanceof StaleBuild) return staleBuild(); throw e; }
  }
  private updateBuild(b: BuildWrite) {
    const r = this.db.db.prepare('UPDATE god_builds_v1 SET status=?,rev=(SELECT COALESCE(MAX(rev),0)+1 FROM god_builds_v1 WHERE world_id=?),last_at=?,body=? WHERE world_id=? AND id=? AND rev=? RETURNING rev').get(b.status, this.worldId, b.lastAt, b.body, this.worldId, b.id, b.expectRev) as { rev: number } | undefined;
    if (!r) throw new StaleBuild();
    b.rev = r.rev;
  }
  private pruneBuilds() { this.db.db.prepare("DELETE FROM god_builds_v1 WHERE world_id=? AND id IN (SELECT id FROM god_builds_v1 WHERE world_id=? AND status IN ('done','abandoned') ORDER BY rev DESC LIMIT -1 OFFSET 200)").run(this.worldId, this.worldId); }

  // ---- god tokens
  addToken(hash: string, label: string | null) { this.db.db.prepare('INSERT OR IGNORE INTO god_tokens_v1 (world_id, token_hash, label, created_at) VALUES (?, ?, ?, ?)').run(this.worldId, hash, label, Date.now()); }
  hasToken(hash: string): boolean {
    const r = this.db.db.prepare('SELECT token_hash FROM god_tokens_v1 WHERE world_id=? AND token_hash=?').get(this.worldId, hash);
    if (r) this.db.db.prepare('UPDATE god_tokens_v1 SET last_used=? WHERE world_id=? AND token_hash=?').run(Date.now(), this.worldId, hash);
    return !!r;
  }
  tokenLabel(hash: string): string | null { return (this.db.db.prepare('SELECT label FROM god_tokens_v1 WHERE world_id=? AND token_hash=?').get(this.worldId, hash) as { label: string | null } | undefined)?.label ?? null; }
  tokens(): { label: string | null; created_at: number; last_used: number | null }[] { return this.db.db.prepare('SELECT label, created_at, last_used FROM god_tokens_v1 WHERE world_id=?').all(this.worldId) as never; }

  // ---- prayers
  addPrayer(p: PrayerRow) { this.db.db.prepare('INSERT INTO god_prayers_v1 (world_id, id, soul_id, soul_name, text, at) VALUES (?, ?, ?, ?, ?, ?)').run(this.worldId, p.id, p.soul_id, p.soul_name, p.text, p.at); }
  answerPrayer(id: string, answer: string): PrayerRow | null {
    this.db.db.prepare('UPDATE god_prayers_v1 SET answer=?, answered_at=? WHERE world_id=? AND id=?').run(answer, Date.now(), this.worldId, id);
    return (this.db.db.prepare('SELECT id, soul_id, soul_name, text, at, answer, answered_at FROM god_prayers_v1 WHERE world_id=? AND id=?').get(this.worldId, id) as PrayerRow | undefined) ?? null;
  }
  prayer(id: string): PrayerRow | null {
    return (this.db.db.prepare('SELECT id,soul_id,soul_name,text,at,answer,answered_at FROM god_prayers_v1 WHERE world_id=? AND id=?').get(this.worldId, id) as PrayerRow | undefined) ?? null;
  }
  prayers(opts: { unanswered?: boolean; soulId?: string; limit?: number } = {}): PrayerRow[] {
    const where = ['world_id=?']; const args: unknown[] = [this.worldId];
    if (opts.unanswered) where.push('answer IS NULL');
    if (opts.soulId) { where.push('soul_id=?'); args.push(opts.soulId); }
    return this.db.db.prepare(`SELECT id, soul_id, soul_name, text, at, answer, answered_at FROM god_prayers_v1 WHERE ${where.join(' AND ')} ORDER BY at DESC LIMIT ?`).all(...(args as never[]), opts.limit ?? 100) as PrayerRow[];
  }

  private tx<T>(fn: () => T): T {
    this.db.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.db.exec('COMMIT'); return result; } catch (e) { this.db.db.exec('ROLLBACK'); throw e; }
  }
}
