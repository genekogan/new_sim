// Engine state inside the MarsSimulation Durable Object (preview).
// One EngineController per (room, year) — the DO identity already isolates
// rooms and historical years; keys are additionally year-prefixed. The
// controller is the same object the browser and Node tests use; this file
// only persists it:
//   engine_blobs(key, chunk, data)  — large JSON split into ≤ 512 KiB rows
//     y<year>/history            WorldHistory.toJSON({ states: false }) — checkpoint +
//                                workspace index only (rewritten on fork/execute)
//     y<year>/state/<stateHash>  WorldState  (immutable, content-addressed; written once)
//     y<year>/plan/<planHash>    StoredPlan  (immutable)
//     y<year>/take/<takeId>      Take        (immutable, content-addressed)
//     y<year>/cams/<takeId>      CameraTrack[] (rewritten on attach)
//     y<year>/store-index        { plans, takes } ids oldest-first (creation order, for the caps)
// Caps (review M5 low): at most MAX_PLANS plans and MAX_TAKES takes per (room, year). A store past a
// cap evicts the oldest ones no live workspace's checkpoint `simulation-run` cause references (take +
// its camera tracks, or plan; engine_delete_workspace frees a deleted workspace's runs); if every stored one is referenced the whole call is refused with
// `room.storage-full` (nothing persisted, in-memory state reloaded) — continue in a new room.
// Year rooms 2020–2025 also seed protected canonical `mars-<year>` from that year's generated
// campus scene (the `campusFile` loader: bundled JSON in the Worker, loadCampusFile in Node); a
// room seeded before that gets it added on first load. 2026 rooms stay synthetic-only.
// Loaded lazily: the index on the first engine call, states/takes/plans/cameras on use.
// An old-format history blob (states inline) is migrated on first load: each state
// becomes its own blob and the index is rewritten without them (review M5).
// Rehearsal runs on a private clone inside the controller and never touches the
// room head; it stores nothing unless called with `keep: true`. Nothing here uses
// engine time (wall-clock is metadata only).
import { CAMPUS_SEED_YEARS, createController, ENGINE_RULES_VERSION, ensureCampusYear, roomScenes, seedHistory, type EngineController, type OpResult, type StoredPlan } from '../engine/api/index.ts';
import type { CampusYearFile } from '../engine/campus/history.ts';
import { WorldHistory, type HistoryJSON } from '../engine/history/store.ts';
import type { WorldState } from '../engine/world/types.ts';
import type { CameraTrack, Take } from '../engine/take/types.ts';

const CHUNK = 512 * 1024; // characters per row; DO SQLite caps a value at 2 MB
export const MAX_PLANS = 64;
export const MAX_TAKES = 32;

type StoreIndex = { plans: string[]; takes: string[] }; // oldest first

export type EngineCallMeta = { op: string; elapsedMs: number; loadMs?: number; stored: Record<string, number>; storage: Record<string, { count: number; bytes: number }> };

export class EngineRoom {
  private storage: DurableObjectStorage;
  private controllers = new Map<number, EngineController>();
  private limits: { plans: number; takes: number };
  private campusFile: (year: number) => CampusYearFile | undefined;

  constructor(storage: DurableObjectStorage, limits: { plans?: number; takes?: number } = {}, campusFile: (year: number) => CampusYearFile | undefined = () => undefined) {
    this.storage = storage;
    this.campusFile = campusFile;
    this.limits = { plans: limits.plans ?? MAX_PLANS, takes: limits.takes ?? MAX_TAKES };
    storage.sql.exec('CREATE TABLE IF NOT EXISTS engine_blobs (key TEXT NOT NULL, chunk INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (key, chunk))');
  }

  private read(key: string): string | undefined {
    const rows = this.storage.sql.exec<{ data: string }>('SELECT data FROM engine_blobs WHERE key=? ORDER BY chunk', key).toArray();
    return rows.length ? rows.map((r) => r.data).join('') : undefined;
  }

  private readJSON<T>(key: string): T | undefined {
    const s = this.read(key);
    return s === undefined ? undefined : (JSON.parse(s) as T);
  }

  private write(key: string, text: string) {
    this.storage.sql.exec('DELETE FROM engine_blobs WHERE key=?', key);
    for (let i = 0, n = 0; i < text.length || n === 0; i += CHUNK, n++)
      this.storage.sql.exec('INSERT INTO engine_blobs (key, chunk, data) VALUES (?, ?, ?)', key, n, text.slice(i, i + CHUNK));
  }

  private exists(key: string) {
    return this.storage.sql.exec('SELECT 1 FROM engine_blobs WHERE key=? LIMIT 1', key).toArray().length > 0;
  }

  private controller(year: number): { ctl: EngineController; loadMs?: number } {
    const have = this.controllers.get(year);
    if (have) return { ctl: have };
    const t0 = performance.now();
    const p = `y${year}/`;
    const saved = this.readJSON<HistoryJSON>(`${p}history`);
    const file = CAMPUS_SEED_YEARS.includes(year) ? this.campusFile(year) : undefined;
    const campus = file ? { year, file } : undefined;
    const history = saved ? WorldHistory.fromJSON(saved) : seedHistory(undefined, campus);
    // a rules change makes every plan bound under the old rules stale (checkPlan)
    history.rulesVersion = ENGINE_RULES_VERSION;
    // states written by an op wait here until call() commits them with the index in one transaction
    const pending = new Map<string, WorldState>();
    this.pending.set(year, pending);
    const fresh = !saved || saved.states !== undefined; // seeded, or an old-format blob to migrate
    this.storage.transactionSync(() => {
      history.attachStateStore({
        has: (h) => pending.has(h) || this.exists(`${p}state/${h}`),
        get: (h) => pending.get(h) ?? this.readJSON<WorldState>(`${p}state/${h}`),
        put: (h, s) => void pending.set(h, s),
      });
      const added = !!saved && !!campus && ensureCampusYear(history, campus);
      if (fresh || added) this.flush(year, history);
    });
    const ctl = createController({
      history,
      scenes: roomScenes(campus),
      store: {
        loadTake: (id) => this.readJSON<Take>(`${p}take/${id}`),
        loadPlan: (id) => this.readJSON<StoredPlan>(`${p}plan/${id}`),
        loadCameras: (id) => this.readJSON<CameraTrack[]>(`${p}cams/${id}`),
        listStored: () => {
          const index = this.storeIndex(year);
          const bytes = new Map(
            this.storage.sql
              .exec<{ key: string; bytes: number }>("SELECT key, SUM(LENGTH(data)) AS bytes FROM engine_blobs WHERE key LIKE ? OR key LIKE ? OR key LIKE ? GROUP BY key", `${p}plan/%`, `${p}take/%`, `${p}cams/%`)
              .toArray()
              .map((r) => [r.key, r.bytes]),
          );
          return {
            plans: index.plans.map((id) => ({ id, bytes: bytes.get(`${p}plan/${id}`) ?? 0 })),
            takes: index.takes.map((id) => ({ id, bytes: bytes.get(`${p}take/${id}`) ?? 0, cameras: bytes.has(`${p}cams/${id}`) })),
          };
        },
      },
    });
    this.controllers.set(year, ctl);
    return { ctl, loadMs: performance.now() - t0 };
  }

  private pending = new Map<number, Map<string, WorldState>>();

  /** Write pending states and the (state-free) index. Call inside a transaction. */
  private flush(year: number, history: WorldHistory, stored?: Record<string, number>) {
    const p = `y${year}/`;
    const put = (key: string, value: unknown) => {
      const text = JSON.stringify(value);
      this.write(key, text);
      if (stored) stored[key] = text.length;
    };
    const pending = this.pending.get(year)!;
    for (const [h, s] of pending) if (!this.exists(`${p}state/${h}`)) put(`${p}state/${h}`, s);
    pending.clear();
    put(`${p}history`, history.toJSON({ states: false }));
  }

  /** Run one controller op and persist what it changed (one SQLite transaction). */
  call(year: number, op: string, input: unknown): OpResult & { _meta: EngineCallMeta } {
    const { ctl, loadMs } = this.controller(year);
    const t0 = performance.now();
    const result = ctl.call(op, input);
    const elapsedMs = performance.now() - t0;
    const changes = ctl.drainChanges();
    const stored: Record<string, number> = {};
    const p = `y${year}/`;
    const meta = (): EngineCallMeta => ({ op, elapsedMs: Math.round(elapsedMs * 10) / 10, ...(loadMs !== undefined ? { loadMs: Math.round(loadMs * 10) / 10 } : {}), stored, storage: this.sizes(year) });
    let full: OpResult | null = null;
    let evictedTakes = false;
    try {
      this.storage.transactionSync(() => {
        const put = (key: string, value: unknown) => {
          const text = JSON.stringify(value);
          this.write(key, text);
          stored[key] = text.length;
        };
        const newPlans = changes.plans.filter((id) => !this.exists(`${p}plan/${id}`));
        const newTakes = changes.takes.filter((id) => !this.exists(`${p}take/${id}`));
        const index = this.storeIndex(year);
        const evict = newPlans.length || newTakes.length ? this.evictions(year, ctl, index, newPlans, newTakes) : { plans: [], takes: [] };
        if ('full' in evict) {
          full = { ok: false, code: 'room.storage-full', message: evict.full };
          return;
        }
        if (changes.history || this.pending.get(year)!.size) this.flush(year, ctl.history, stored);
        for (const id of newPlans) put(`${p}plan/${id}`, ctl.plans.get(id));
        for (const id of newTakes) put(`${p}take/${id}`, ctl.take(id));
        for (const id of changes.cameras) if (!evict.takes.includes(id)) put(`${p}cams/${id}`, ctl.cameras(id));
        for (const id of evict.plans) {
          this.remove(`${p}plan/${id}`);
          ctl.plans.delete(id);
        }
        for (const id of evict.takes) {
          this.remove(`${p}take/${id}`);
          this.remove(`${p}cams/${id}`);
          evictedTakes = true;
        }
        if (newPlans.length || newTakes.length) {
          const next: StoreIndex = {
            plans: [...index.plans.filter((id) => !evict.plans.includes(id)), ...newPlans],
            takes: [...index.takes.filter((id) => !evict.takes.includes(id)), ...newTakes],
          };
          put(`${p}store-index`, next);
        }
      });
    } catch (e) {
      // in-memory state may now be ahead of storage: drop it and reload lazily next call
      this.controllers.delete(year);
      this.pending.delete(year);
      throw e;
    }
    if (full) {
      // refused: nothing was persisted, so the op's in-memory effects (a commit, a take) are dropped too
      this.controllers.delete(year);
      this.pending.delete(year);
      return { ...(full as OpResult), _meta: meta() };
    }
    // the controller's take library has no delete: reload it lazily so an evicted take is gone in
    // memory too (never reported as kept); unkept rehearsal takes are dropped with it, as on a restart
    if (evictedTakes) {
      this.controllers.delete(year);
      this.pending.delete(year);
    }
    return { ...result, _meta: meta() };
  }

  /** Stored plan/take ids oldest-first; built once from row order for a room stored before the caps. */
  private storeIndex(year: number): StoreIndex {
    const p = `y${year}/`;
    const saved = this.readJSON<StoreIndex>(`${p}store-index`);
    if (saved) return saved;
    // plan/take blobs are immutable, so the rowid of their first chunk is their creation order
    const ids = (kind: string) =>
      this.storage.sql
        .exec<{ key: string }>('SELECT key, MIN(rowid) AS r FROM engine_blobs WHERE key LIKE ? GROUP BY key ORDER BY r', `${p}${kind}/%`)
        .toArray()
        .map((row) => row.key.slice(`${p}${kind}/`.length));
    return { plans: ids('plan'), takes: ids('take') };
  }

  /**
   * Which stored plans/takes to evict so that the new ones fit under the caps: oldest first, never one
   * that the `simulation-run` cause of a checkpoint reachable from a live workspace references (a
   * deleted workspace frees its runs) and never one stored by this call.
   */
  private evictions(year: number, ctl: EngineController, index: StoreIndex, newPlans: string[], newTakes: string[]): { plans: string[]; takes: string[] } | { full: string } {
    const runs = ctl.referencedRuns();
    const refTakes = new Set(runs.takes.keys()), refPlans = new Set(runs.plans.keys());
    const pick = (kind: 'plan' | 'take', have: string[], added: string[], cap: number, ref: Set<string>): string[] | string => {
      const over = have.length + added.length - cap;
      if (over <= 0) return [];
      const free = have.filter((id) => !ref.has(id));
      if (free.length < over)
        return `room y${year} already holds ${have.length} stored ${kind}s (cap ${cap}) and ${have.length - free.length} of them are referenced by checkpoints of live workspaces (simulation-run), so the new ${kind} cannot be stored; this call was not persisted — delete workspaces you no longer need (engine_delete_workspace; see engine_list), or create a new room (studio leave/create) and fork your work there`;
      return free.slice(0, over);
    };
    const plans = pick('plan', index.plans, newPlans, this.limits.plans, refPlans);
    if (typeof plans === 'string') return { full: plans };
    const takes = pick('take', index.takes, newTakes, this.limits.takes, refTakes);
    if (typeof takes === 'string') return { full: takes };
    return { plans, takes };
  }

  private remove(key: string) {
    this.storage.sql.exec('DELETE FROM engine_blobs WHERE key=?', key);
  }

  /** Stored bytes per key class (for size measurements). */
  sizes(year: number) {
    const rows = this.storage.sql
      .exec<{ key: string; bytes: number }>('SELECT key, SUM(LENGTH(data)) AS bytes FROM engine_blobs WHERE key LIKE ? GROUP BY key', `y${year}/%`)
      .toArray();
    const out: Record<string, { count: number; bytes: number }> = {};
    for (const r of rows) {
      const kind = r.key.split('/')[1];
      const o = (out[kind] ??= { count: 0, bytes: 0 });
      o.count++;
      o.bytes += r.bytes;
    }
    return out;
  }
}
