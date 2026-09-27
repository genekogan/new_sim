// Engine state inside the MarsSimulation Durable Object (preview).
// One EngineController per (room, year) — the DO identity already isolates
// rooms and historical years; keys are additionally year-prefixed. The
// controller is the same object the browser and Node tests use; this file
// only persists it:
//   engine_blobs(key, chunk, data)  — large JSON split into ≤ 512 KiB rows
//     y<year>/history          WorldHistory.toJSON()  (rewritten on fork/execute)
//     y<year>/plan/<planHash>  StoredPlan              (immutable)
//     y<year>/take/<takeId>    Take                    (immutable, content-addressed)
//     y<year>/cams/<takeId>    CameraTrack[]           (rewritten on attach)
// Loaded lazily: history on the first engine call, takes/plans/cameras on use.
// Rehearsal runs on a private clone inside the controller and never touches
// the room head; nothing here uses engine time (wall-clock is metadata only).
import { createController, ENGINE_RULES_VERSION, ENGINE_SCENES, seedHistory, type EngineController, type OpResult, type StoredPlan } from '../engine/api/index.ts';
import { WorldHistory } from '../engine/history/store.ts';
import type { CameraTrack, Take } from '../engine/take/types.ts';

const CHUNK = 512 * 1024; // characters per row; DO SQLite caps a value at 2 MB

export type EngineCallMeta = { op: string; elapsedMs: number; loadMs?: number; stored: Record<string, number>; storage: Record<string, { count: number; bytes: number }> };

export class EngineRoom {
  private storage: DurableObjectStorage;
  private controllers = new Map<number, EngineController>();

  constructor(storage: DurableObjectStorage) {
    this.storage = storage;
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
    const saved = this.readJSON<ReturnType<WorldHistory['toJSON']>>(`${p}history`);
    const history = saved ? WorldHistory.fromJSON(saved) : seedHistory();
    // a rules change makes every plan bound under the old rules stale (checkPlan)
    history.rulesVersion = ENGINE_RULES_VERSION;
    const ctl = createController({
      history,
      scenes: ENGINE_SCENES,
      store: {
        loadTake: (id) => this.readJSON<Take>(`${p}take/${id}`),
        loadPlan: (id) => this.readJSON<StoredPlan>(`${p}plan/${id}`),
        loadCameras: (id) => this.readJSON<CameraTrack[]>(`${p}cams/${id}`),
      },
    });
    if (!saved) this.write(`${p}history`, JSON.stringify(history.toJSON()));
    this.controllers.set(year, ctl);
    return { ctl, loadMs: performance.now() - t0 };
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
    try {
      this.storage.transactionSync(() => {
        const put = (key: string, value: unknown) => {
          const text = JSON.stringify(value);
          this.write(key, text);
          stored[key] = text.length;
        };
        if (changes.history) put(`${p}history`, ctl.history.toJSON());
        for (const id of changes.plans) if (!this.exists(`${p}plan/${id}`)) put(`${p}plan/${id}`, ctl.plans.get(id));
        for (const id of changes.takes) if (!this.exists(`${p}take/${id}`)) put(`${p}take/${id}`, ctl.take(id));
        for (const id of changes.cameras) put(`${p}cams/${id}`, ctl.cameras(id));
      });
    } catch (e) {
      // in-memory state may now be ahead of storage: drop it and reload lazily next call
      this.controllers.delete(year);
      throw e;
    }
    return { ...result, _meta: { op, elapsedMs: Math.round(elapsedMs * 10) / 10, ...(loadMs !== undefined ? { loadMs: Math.round(loadMs * 10) / 10 } : {}), stored, storage: this.sizes(year) } };
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
