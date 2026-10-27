import { contextStage } from './context-timing.ts';
// Requested architectural pictures. Labels/access are resolved live; only pixels and revision state are stored.
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
export const CONTEXT_LIMITS = { batch: 6, records: 24, attempts: 2, imageBytes: 1048576, cacheBytes: 16777216, timeoutMs: 60000 } as const;
export type ContextInput = {
    key: string;
    revision: number;
    payload: unknown;
};
export type ContextRender = {
    png?: Uint8Array;
    photo?: Record<string, unknown>;
    reason?: string;
};
export type ContextRecord = {
    ref: string;
    key: string;
    revision: number;
    status: 'pending' | 'ready' | 'unavailable';
    attempts: number;
    reason: string | null;
    bytes: number;
    photo: Record<string, unknown> | null;
};
type Row = {
    ref: string;
    key: string;
    revision: number;
    status: ContextRecord['status'];
    attempts: number;
    reason: string | null;
    bytes: number;
    touched: number;
    requested: number;
    photo: string | null;
};
export const contextHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class ContextViewCache {
    private running: Promise<void> | null = null;
    private scheduled = false;
    private refreshGeneration = 0;
    private refreshing: Promise<void> | null = null;
    private preparationAbort = new AbortController();
    private priorityRun = 0;
    private closed = false;
    private controller: AbortController | null = null;
    private db: DatabaseSync;
    private world: string;
    private input: (ref: string) => ContextInput | null;
    private prepare?: (signal: AbortSignal) => Promise<void>;
    private render: (input: ContextInput, signal: AbortSignal) => Promise<ContextRender>;
    constructor(db: DatabaseSync, world: string, input: (ref: string) => ContextInput | null, render: (input: ContextInput, signal: AbortSignal) => Promise<ContextRender>, prepare?: (signal: AbortSignal) => Promise<void>) {
        this.prepare = prepare;
        this.db = db;
        this.world = world;
        this.input = input;
        this.render = render;
        db.exec(`CREATE TABLE IF NOT EXISTS context_views_v1(world TEXT NOT NULL,ref TEXT NOT NULL,key TEXT NOT NULL,revision INTEGER NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL,reason TEXT,png BLOB,touched INTEGER NOT NULL,PRIMARY KEY(world,ref));`);
        // Existing persisted queues gain scheduling state without changing pixel records.
        const columns = db.prepare('PRAGMA table_info(context_views_v1)').all() as { name: string }[];
        if (!columns.some(column => column.name === 'requested'))
            db.exec('ALTER TABLE context_views_v1 ADD COLUMN requested INTEGER NOT NULL DEFAULT 0');
        if (!columns.some(column => column.name === 'photo'))
            db.exec('ALTER TABLE context_views_v1 ADD COLUMN photo TEXT');
    }
    private row(ref: string) {
        return this.db.prepare('SELECT ref,key,revision,status,attempts,reason,COALESCE(length(png),0) bytes,touched,requested,photo FROM context_views_v1 WHERE world=? AND ref=?')
            .get(this.world, ref) as Row | undefined;
    }
    private summary(row: Row): ContextRecord {
        return { ref: row.ref, key: row.key, revision: row.revision, status: row.status, attempts: row.attempts, reason: row.reason, bytes: row.bytes, photo: row.photo ? JSON.parse(row.photo) : null };
    }
    private reconcile(ref: string, create = false): Row | null {
        const old = this.row(ref);
        if (!old && !create) return null;
        const current = contextStage('cache.input', () => this.input(ref));
        if (!current) {
            if (old)
                this.db.prepare('DELETE FROM context_views_v1 WHERE world=? AND ref=?').run(this.world, ref);
            return null;
        }
        if (!old && !create)
            return null;
        if (!old || old.key !== current.key)
            this.db.prepare(`INSERT INTO context_views_v1(world,ref,key,revision,status,attempts,reason,png,touched) VALUES(?,?,?,?,'pending',0,NULL,NULL,?) ON CONFLICT(world,ref) DO UPDATE SET key=excluded.key,revision=excluded.revision,status='pending',attempts=0,reason=NULL,png=NULL,requested=0,photo=NULL`).run(this.world, ref, current.key, current.revision, Date.now());
        else if (old.revision !== current.revision)
            this.db.prepare('UPDATE context_views_v1 SET revision=? WHERE world=? AND ref=?').run(current.revision, this.world, ref);
        return this.row(ref)!;
    }
    /** Startup recovery and committed-edit coalescing. No timer survives an empty drain. */
    refresh() {
        if (this.closed) return;
        this.refreshGeneration++;
        if (this.scheduled) return;
        this.scheduled = true;
        let covered = this.refreshGeneration;
        this.refreshing = (async () => {
            await new Promise<void>(resolve => setImmediate(resolve));
            while (!this.closed) {
                const generation = this.refreshGeneration;
                covered = generation;
                try {
                    // Empty caches do not prepare geometry, including after startup or edits.
                    if (this.rows().length) await this.prepare?.(this.preparationAbort.signal);
                    if (this.closed) return;
                    contextStage('cache.refresh', () => {
                        for (const row of this.rows()) this.reconcile(row.ref);
                    });
                    this.start();
                } catch {
                    // Preserve pending rows on failure. Only a real notification that
                    // arrived during this pass permits another pass; no idle retry spin.
                }
                if (generation === this.refreshGeneration) return;
            }
        })().finally(() => {
            this.scheduled = false; this.refreshing = null;
            if (!this.closed && covered !== this.refreshGeneration) this.refresh();
        });
    }
    request(ref: string): ContextRecord | null {
        if (this.closed)
            return null;
        const row = this.reconcile(ref, true);
        if (!row)
            return null;
        // Monotonic ordering also distinguishes requests arriving in the same millisecond.
        const latest = this.db.prepare('SELECT COALESCE(MAX(touched),0) value FROM context_views_v1 WHERE world=?').get(this.world) as { value: number };
        const touched = Math.max(Date.now(), latest.value + 1);
        this.db.prepare('UPDATE context_views_v1 SET touched=?,requested=? WHERE world=? AND ref=?').run(touched, row.status === 'pending' ? touched : 0, this.world, ref);
        this.trim(ref);
        this.refresh();
        return this.summary(row);
    }
    peek(ref: string): ContextRecord | null {
        const row = this.reconcile(ref);
        return row ? this.summary(row) : null;
    }
    image(ref: string, key: string): Uint8Array | null {
        const row = this.reconcile(ref);
        if (row?.status !== 'ready' || row.key !== key)
            return null;
        const image = this.db.prepare('SELECT png FROM context_views_v1 WHERE world=? AND ref=? AND key=?')
            .get(this.world, ref, key) as { png: Uint8Array } | undefined;
        return image?.png ?? null;
    }
    /** LRU order is for eviction and the maintenance fallback, never request priority. */
    private rows() {
        return this.db.prepare('SELECT ref,key,revision,status,attempts,reason,COALESCE(length(png),0) bytes,touched,requested,photo FROM context_views_v1 WHERE world=? ORDER BY touched,ref')
            .all(this.world) as Row[];
    }
    private trim(keep: string) {
        const rows = this.rows();
        let bytes = rows.reduce((n, row) => n + row.bytes, 0);
        while (rows.length > CONTEXT_LIMITS.records || bytes > CONTEXT_LIMITS.cacheBytes) {
            const at = rows.findIndex(row => row.ref !== keep);
            if (at < 0)
                break;
            const [row] = rows.splice(at, 1);
            bytes -= row.bytes;
            this.db.prepare('DELETE FROM context_views_v1 WHERE world=? AND ref=?').run(this.world, row.ref);
        }
    }
    private start() {
        if (this.closed || this.running)
            return;
        let failed = false;
        const generation = this.refreshGeneration;
        this.running = this.drain().catch(() => { failed = true; }).finally(() => {
            this.running = null;
            if ((!failed || generation !== this.refreshGeneration) && !this.closed && this.rows().some(row => row.status === 'pending'))
                this.start();
        });
    }
    private async drain() {
        for (;;) {
            if (this.closed)
                return;
            const pending = this.rows().filter(row => row.status === 'pending');
            // Give recent explicit requests priority, but every seventh job serves the
            // oldest pending record, including old explicit requests, to bound starvation.
            const urgent = pending.filter(row => row.requested).sort((a, b) => b.requested - a.requested || a.ref.localeCompare(b.ref));
            const fairTurn = this.priorityRun >= CONTEXT_LIMITS.batch;
            const row = fairTurn ? pending[0] : urgent[0] ?? pending[0];
            if (!row) {
                this.priorityRun = 0;
                return;
            }
            await this.prepare?.(this.preparationAbort.signal);
            if (this.closed) return;
            const input = this.input(row.ref);
            if (!input) {
                this.reconcile(row.ref);
                continue;
            }
            if (input.key !== row.key) {
                this.reconcile(row.ref);
                continue;
            }
            if (row.attempts >= CONTEXT_LIMITS.attempts) {
                this.db.prepare("UPDATE context_views_v1 SET status='unavailable',reason='retry limit' WHERE world=? AND ref=? AND key=?").run(this.world, row.ref, row.key);
                continue;
            }
            this.priorityRun = row.requested && !fairTurn ? this.priorityRun + 1 : 0;
            this.db.prepare('UPDATE context_views_v1 SET attempts=attempts+1,requested=0 WHERE world=? AND ref=? AND key=?').run(this.world, row.ref, row.key);
            const startedAt = Date.now();
            if (process.env.SIM_CONTEXT_TRACE === '1')
                console.info('[context-job]', JSON.stringify({ phase: 'start', ref: row.ref, key: input.key, revision: input.revision, at: startedAt }));
            const ac = new AbortController();
            this.controller = ac;
            const timer = setTimeout(() => ac.abort(new Error('render deadline')), CONTEXT_LIMITS.timeoutMs);
            let result: ContextRender;
            try {
                result = await this.render(input, ac.signal);
                if (ac.signal.aborted)
                    throw ac.signal.reason;
                if (result.png && result.png.byteLength > CONTEXT_LIMITS.imageBytes)
                    result = { reason: 'image exceeds storage limit' };
            }
            catch (e) {
                result = { reason: e instanceof Error ? e.message : 'render failed' };
            }
            finally {
                clearTimeout(timer);
                this.controller = null;
            }
            if (process.env.SIM_CONTEXT_TRACE === '1')
                console.info('[context-job]', JSON.stringify({ phase: 'finish', ref: row.ref, key: input.key, at: Date.now(), ms: Date.now() - startedAt, ready: !!result.png, reason: result.reason ?? null }));
            if (this.closed)
                return;
            // Includes commits during capture and deletion/undo races, before any pixel becomes observable.
            await this.prepare?.(this.preparationAbort.signal);
            if (this.closed) return;
            const current = this.reconcile(row.ref);
            if (!current || current.key !== input.key)
                continue;
            const retry = !result.png && current.attempts < CONTEXT_LIMITS.attempts;
            const photo = result.photo ? JSON.stringify(result.photo) : null;
            this.db.prepare('UPDATE context_views_v1 SET status=?,png=?,reason=?,photo=? WHERE world=? AND ref=? AND key=?').run(result.png ? 'ready' : retry ? 'pending' : 'unavailable', result.png ?? null, result.reason?.slice(0, 400) ?? null, photo && photo.length <= 8192 ? photo : null, this.world, row.ref, input.key);
            this.trim(row.ref);
        }
    }
    async settled() {
        for (;;) {
            await new Promise<void>(resolve => setImmediate(resolve));
            if (this.running)
                await this.running;
            else if (!this.scheduled)
                return;
        }
    }
    async close() {
        this.closed = true;
        this.preparationAbort.abort(new Error('world closed'));
        this.controller?.abort(new Error('world closed'));
        await this.refreshing;
        await this.running;
    }
}
