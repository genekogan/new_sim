// L8 (server-reliability 2026-10-31): the in-memory object table. Every read of `edge_comms_objects` used to select and
// JSON-parse every row (3.3k on Eden 2026: ~5 CPU-ms and ~5 MB per call, several calls per request, some of them on
// unauthenticated routes). The framework owns every write (`save`/`remove`), so one table per (connection, world) is
// loaded once and updated as the framework writes. Records are the parse of the stored body, deep-frozen: callers share
// them and must copy before changing anything.
//
// Rollbacks: a write inside a transaction is applied at once (reads in the same transaction see it, as SQLite's do) and
// its id is remembered. Once the transaction is over (`db.isTransaction` false: committed, or rolled back by `tx` or by
// raw SQL), or a tracked savepoint rolled back while it is still open, those rows are re-read from the database; a row
// whose stored body is the one written costs a string compare, not a parse. A commit by another connection (PRAGMA
// data_version) reloads the whole table. Direct SQL writes on the same connection are not seen: call `reload()`.
import type {Sql} from '../store.ts';
import {rollbackGeneration} from '../store.ts';
import type {ObjectRecord} from './types.ts';

export const CELL = 32;
type KindIndex = {ids: string[]; list: readonly ObjectRecord[] | null};
type Stmts = {all: ReturnType<Sql['prepare']>; one: ReturnType<Sql['prepare']>; version: ReturnType<Sql['prepare']>};

/** Bounded counters (no names or payloads): calls answered from memory and rows parsed, since start. */
export const OBJECT_TABLE_STATS = {loads: 0, parsed: 0, reconciled: 0, writes: 0, all: 0, ofKind: 0, has: 0, row: 0};

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]); }
  return v;
}
const atOf = (o: ObjectRecord): [number, number] | null => {
  const at = (o.state as {at?: unknown} | null)?.at;
  return Array.isArray(at) && at.length >= 2 && Number.isFinite(at[0]) && Number.isFinite(at[1]) ? [at[0] as number, at[1] as number] : null;
};
const cellKey = (cx: number, cz: number) => `${cx},${cz}`;
/** First index whose id is >= id (ids are ASCII, so JS order = SQLite BINARY order = `ORDER BY id`). */
function lowerBound(a: string[], id: string): number { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >>> 1; if (a[m] < id) lo = m + 1; else hi = m; } return lo; }
function insertSorted(a: string[], id: string) { const i = lowerBound(a, id); if (a[i] !== id) a.splice(i, 0, id); }
function removeSorted(a: string[], id: string) { const i = lowerBound(a, id); if (a[i] === id) a.splice(i, 1); }

export class ObjectTable {
  private rows = new Map<string, ObjectRecord>();
  private sorted: string[] = [];
  private list: readonly ObjectRecord[] | null = null;
  private idList: readonly string[] | null = null;
  private kinds = new Map<string, KindIndex>();
  private cells = new Map<string, Set<string>>();
  private cellOf = new Map<string, string>();
  /** ids written inside a transaction not yet settled, with the body written (null = removed) */
  private pending = new Map<string, string | null>();
  private pendingGen = 0;
  private dataVersion = -1;
  private stmts: Stmts;
  private db: Sql;
  private worldId: string;
  constructor(db: Sql, worldId: string) {
    this.db = db; this.worldId = worldId;
    this.stmts = {
      all: db.prepare('SELECT body FROM edge_comms_objects WHERE world_id = ? ORDER BY id'),
      one: db.prepare('SELECT body FROM edge_comms_objects WHERE world_id = ? AND id = ?'),
      version: db.prepare('PRAGMA data_version'),
    };
  }

  /** Bring the table in line with the database (cheap when nothing happened): call before every read. */
  sync(): this {
    const dv = (this.stmts.version.get() as {data_version: number}).data_version;
    if (dv !== this.dataVersion) { this.load(); this.dataVersion = dv; return this; }
    if (this.pending.size) {
      const open = this.db.isTransaction, gen = rollbackGeneration(this.db);
      if (!open || gen !== this.pendingGen) {
        for (const [id, written] of this.pending) {
          const r = this.stmts.one.get(this.worldId, id) as {body: string} | undefined;
          const body = r?.body ?? null;
          if (body === written) continue;
          OBJECT_TABLE_STATS.reconciled++;
          if (body === null) this.drop(id); else this.put(JSON.parse(body) as ObjectRecord);
          this.pending.set(id, body);
        }
        if (!open) this.pending.clear(); else this.pendingGen = gen;
      }
    }
    return this;
  }
  /** Re-read every row (after SQL writes that bypassed the framework). */
  reload() { this.dataVersion = -1; this.sync(); }

  private load() {
    OBJECT_TABLE_STATS.loads++;
    this.rows.clear(); this.sorted = []; this.kinds.clear(); this.cells.clear(); this.cellOf.clear(); this.pending.clear();
    this.list = null; this.idList = null;
    for (const r of this.stmts.all.all(this.worldId) as {body: string}[]) {
      const o = deepFreeze(JSON.parse(r.body) as ObjectRecord); OBJECT_TABLE_STATS.parsed++;
      this.rows.set(o.id, o); this.sorted.push(o.id); this.index(o);
    }
    this.pendingGen = rollbackGeneration(this.db);
  }
  private index(o: ObjectRecord) {
    let k = this.kinds.get(o.kind); if (!k) this.kinds.set(o.kind, k = {ids: [], list: null});
    insertSorted(k.ids, o.id); k.list = null;
    const at = atOf(o);
    if (at) { const key = cellKey(Math.floor(at[0] / CELL), Math.floor(at[1] / CELL)); let s = this.cells.get(key); if (!s) this.cells.set(key, s = new Set()); s.add(o.id); this.cellOf.set(o.id, key); }
  }
  private unindex(o: ObjectRecord) {
    const k = this.kinds.get(o.kind); if (k) { removeSorted(k.ids, o.id); k.list = null; if (!k.ids.length) this.kinds.delete(o.kind); }
    const key = this.cellOf.get(o.id); if (key !== undefined) { const s = this.cells.get(key); s?.delete(o.id); if (s && !s.size) this.cells.delete(key); this.cellOf.delete(o.id); }
  }
  private put(o: ObjectRecord) {
    deepFreeze(o);
    const old = this.rows.get(o.id);
    if (old) this.unindex(old); else { insertSorted(this.sorted, o.id); this.idList = null; }
    this.rows.set(o.id, o); this.index(o); this.list = null;
  }
  private drop(id: string) {
    const old = this.rows.get(id); if (!old) return;
    this.unindex(old); this.rows.delete(id); removeSorted(this.sorted, id); this.list = null; this.idList = null;
  }

  /** The framework wrote this body (already in the database). */
  wrote(body: string) {
    OBJECT_TABLE_STATS.writes++;
    const o = JSON.parse(body) as ObjectRecord;
    this.put(o);
    if (this.db.isTransaction) { if (!this.pending.size) this.pendingGen = rollbackGeneration(this.db); this.pending.set(o.id, body); }
  }
  /** The framework deleted this row. */
  removed(id: string) {
    OBJECT_TABLE_STATS.writes++;
    this.drop(id);
    if (this.db.isTransaction) { if (!this.pending.size) this.pendingGen = rollbackGeneration(this.db); this.pending.set(id, null); }
  }

  get(id: string): ObjectRecord | undefined { OBJECT_TABLE_STATS.row++; return this.rows.get(id); }
  has(id: string): boolean { OBJECT_TABLE_STATS.has++; return this.rows.has(id); }
  all(): readonly ObjectRecord[] { OBJECT_TABLE_STATS.all++; return this.list ??= Object.freeze(this.sorted.map(id => this.rows.get(id)!)); }
  ids(): readonly string[] { return this.idList ??= Object.freeze([...this.sorted]); }
  ofKind(kind: string): readonly ObjectRecord[] {
    OBJECT_TABLE_STATS.ofKind++;
    const k = this.kinds.get(kind); if (!k) return EMPTY;
    return k.list ??= Object.freeze(k.ids.map(id => this.rows.get(id)!));
  }
  kindsPresent(): IterableIterator<string> { return this.kinds.keys(); }
  /** ids (unsorted) of objects whose `state.at` lies within `radius` of `at` (the 32 m cell index, then exact distance) */
  near(at: readonly [number, number], radius: number): string[] {
    const out: string[] = [];
    const x0 = Math.floor((at[0] - radius) / CELL), x1 = Math.floor((at[0] + radius) / CELL), z0 = Math.floor((at[1] - radius) / CELL), z1 = Math.floor((at[1] + radius) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const s = this.cells.get(cellKey(cx, cz)); if (!s) continue;
      for (const id of s) { const p = atOf(this.rows.get(id)!)!; if (Math.hypot(p[0] - at[0], p[1] - at[1]) <= radius) out.push(id); }
    }
    return out;
  }
}
const EMPTY: readonly ObjectRecord[] = Object.freeze([]);

const TABLES = new WeakMap<Sql, Map<string, ObjectTable>>();
/** The one table for this connection and world (shared by every Objects over them). */
export function objectTable(db: Sql, worldId: string): ObjectTable {
  let per = TABLES.get(db); if (!per) TABLES.set(db, per = new Map());
  let t = per.get(worldId); if (!t) per.set(worldId, t = new ObjectTable(db, worldId));
  return t.sync();
}
