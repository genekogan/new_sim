import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { Db } from '../db.ts';
import { GodMode } from './god.ts';
import { mountContextViews } from './context-views.ts';
import { encodeContextPng } from './context-sheet.ts';

const world = 'context-process-restart';
const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const png = () => encodeContextPng(1, 1, new Uint8Array([31, 127, 211, 255]));
type Message = { kind: string; [key: string]: unknown };
const send = (message: Message) => new Promise<void>((resolve, reject) => {
    assert.ok(JSON.stringify(message).length < 8192, 'bounded test IPC');
    process.send!(message, error => error ? reject(error) : resolve());
});
const row = (db: DatabaseSync) => db.prepare('SELECT ref,key,revision,status,attempts,length(png) bytes FROM context_views_v1 WHERE world=?').get(world);

// This is the actual service startup hook over a persisted GodMode, with explicit
// public/ready dependencies. It does not claim full-main/native readiness or Chrome.
async function child(role: string, directory: string) {
    assert.ok(role === 'first' || role === 'second');
    const db = new Db(join(directory, 'world.sqlite'));
    let service: ReturnType<typeof mountContextViews> | undefined;
    let closing: Promise<void> | undefined;
    let requests = 0, renders = 0, aborted = false, terminating = false;
    const keepAlive = setInterval(() => {}, 1000);
    const close = () => closing ??= (async () => {
        await service?.close();
        clearInterval(keepAlive);
        db.close();
    })();
    const onTerm = () => {
        terminating = true;
        void (async () => {
            await service!.close();
            const persisted = row(db.db);
            await close();
            await send({ kind: 'stopped', persisted, requests, renders, aborted });
            process.disconnect();
        })().catch(error => { console.error(error); process.exit(1); });
    };
    process.once('SIGTERM', onTerm);
    try {
        // Child two deliberately supplies neither genesis nor fixture edits.
        const god = new GodMode(db, { worldId: world, ownerId: null, tick: () => 0, emit() {}, assetDir: join(directory, 'assets') });
        if (role === 'first') {
            assert.equal(god.model.entities.size, 0);
            assert.equal(god.act({ ops: [{ op: 'place', def: 'core/bench@1', name: 'restart-seat', p: [0, 0], about: { title: 'Restart seat' } }] }).accepted, true);
        }
        const entity = god.model.get('restart-seat');
        assert.ok(entity, 'second process must load the authored entity from disk');
        const identity = { ref: entity.id, editSeq: god.model.editSeq, entityHash: digest(JSON.stringify(entity)), pose: god.model.worldPose(entity) };
        await send({ kind: 'loaded', identity, persisted: role === 'second' ? row(db.db) : null });
        const app = new Hono();
        app.use('*', async (_c, next) => { requests++; await next(); });
        service = mountContextViews(app, {
            god, edge: { places: { byId: new Map() }, knowledge: { knows: () => true } } as never,
            worldUrl: 'http://127.0.0.1:1', levelAt: () => 0,
            contextReady: () => true, waitForContext: async () => {}, soul: () => null, limit() {},
            renderer: async (input, signal) => {
                renders++;
                await send({ kind: 'capture-start', key: input.key, revision: input.revision, persisted: row(db.db), requests, renders });
                if (role === 'first') {
                    await new Promise<void>(resolve => {
                        const stopped = () => { aborted = true; resolve(); };
                        if (signal.aborted) stopped();
                        else signal.addEventListener('abort', stopped, { once: true });
                    });
                    return { reason: 'orderly restart interrupted held test renderer' };
                }
                return { png: png() };
            },
        });
        if (role === 'first') {
            const response = await app.request('/v1/world/context/views', {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refs: [entity.id] }),
            });
            assert.equal(response.status, 200);
            const body = await response.json();
            assert.equal(body.views[0].ref, entity.id);
            assert.equal(body.views[0].status, 'pending');
            await send({ kind: 'requested', requests });
            return; // IPC + keepAlive remain until the parent's actual SIGTERM.
        }
        await service.cache.settled(); // Startup refresh, with zero client requests.
        if (terminating) return;
        assert.equal(requests, 0);
        assert.equal(renders, 1);
        const persisted = row(db.db) as { key: string; status: string; attempts: number };
        assert.equal(persisted.status, 'ready');
        assert.equal(persisted.attempts, 2);
        const stored = db.db.prepare('SELECT png FROM context_views_v1 WHERE world=?').get(world) as { png: Uint8Array };
        assert.equal(digest(stored.png), digest(png()));
        await close();
        await send({ kind: 'recovered', persisted, identity, requests, renders, imageSha: digest(stored.png) });
        process.disconnect();
    } catch (error) {
        if (terminating) return; // SIGTERM's orderly owner closes DB and IPC.
        await close();
        await send({ kind: 'failed', error: String(error) });
        process.exitCode = 1;
        process.disconnect();
    }
}

if (process.env.CONTEXT_RESTART_CHILD) {
    await child(process.env.CONTEXT_RESTART_CHILD, process.env.CONTEXT_RESTART_DIRECTORY!);
} else {
    test('disk-persisted context capture resumes once after an orderly OS-process restart', { timeout: 40000 }, async t => {
        const directory = mkdtempSync(join(tmpdir(), 'context-process-restart-'));
        t.diagnostic(`Retained process/SQLite evidence: ${directory}`);
        const owned: { process: ChildProcess; exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }> }[] = [];
        const launch = (role: string) => {
            const process = spawn(globalThis.process.execPath, [fileURLToPath(import.meta.url)], {
                env: { ...globalThis.process.env, CONTEXT_RESTART_CHILD: role, CONTEXT_RESTART_DIRECTORY: directory },
                stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
            });
            const messages: Message[] = [], waiters = new Set<() => void>();
            let stdout = '', stderr = '', ended = false;
            let escalation: ReturnType<typeof setTimeout> | undefined;
            const deadline = setTimeout(() => {
                process.kill('SIGTERM');
                escalation = setTimeout(() => process.kill('SIGKILL'), 500);
            }, 15000);
            process.stdout!.on('data', bytes => { stdout = (stdout + bytes).slice(-32768); });
            process.stderr!.on('data', bytes => { stderr = (stderr + bytes).slice(-32768); });
            process.on('message', value => { messages.push(value as Message); for (const notify of waiters) notify(); });
            const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
                process.once('error', error => { clearTimeout(deadline); clearTimeout(escalation); reject(error); });
                process.once('exit', (code, signal) => {
                    ended = true;
                    clearTimeout(deadline); clearTimeout(escalation);
                    writeFileSync(join(directory, role + '.json'), JSON.stringify({ pid: process.pid, code, signal, messages, stdout, stderr }, null, 2));
                    for (const notify of waiters) notify();
                    resolve({ code, signal });
                });
            });
            owned.push({ process, exit });
            const wait = (kind: string) => new Promise<Message>((resolve, reject) => {
                const timer = setTimeout(() => finish(new Error(`${role}: timed out waiting for ${kind}; ${stderr}`)), 12000);
                const finish = (error?: Error, found?: Message) => { clearTimeout(timer); waiters.delete(notify); error ? reject(error) : resolve(found!); };
                const notify = () => {
                    const failure = messages.find(message => message.kind === 'failed');
                    const found = messages.find(message => message.kind === kind);
                    if (failure) finish(new Error(`${role}: ${failure.error}`));
                    else if (found) finish(undefined, found);
                    else if (ended) finish(new Error(`${role}: exited before ${kind}; ${stderr}`));
                };
                waiters.add(notify); notify();
            });
            return { process, exit, wait };
        };
        const inspectDisk = () => {
            const db = new DatabaseSync(join(directory, 'world.sqlite'), { readOnly: true });
            try { return row(db); } finally { db.close(); }
        };
        try {
            const first = launch('first');
            const initial = await first.wait('loaded');
            await first.wait('requested');
            const started = await first.wait('capture-start');
            assert.equal((started.persisted as { attempts: number }).attempts, 1);
            assert.equal(started.renders, 1);
            first.process.kill('SIGTERM');
            const stopped = await first.wait('stopped');
            assert.deepEqual(await first.exit, { code: 0, signal: null });
            assert.equal(stopped.aborted, true);
            const pending = inspectDisk() as { ref: string; key: string; status: string; attempts: number; bytes: number | null };
            assert.equal(pending.status, 'pending'); assert.equal(pending.attempts, 1); assert.equal(pending.bytes, null);
            assert.equal(pending.key, started.key);

            const second = launch('second');
            const loaded = await second.wait('loaded');
            assert.deepEqual(loaded.identity, initial.identity, 'GodMode reopened exact persistent ref/editSeq/entity/pose, without replaying fixture edits');
            assert.deepEqual(loaded.persisted, { ...pending }, 'IPC preserves every persisted field; SQLite rows have a null prototype');
            const recovered = await second.wait('recovered');
            assert.deepEqual(await second.exit, { code: 0, signal: null });
            assert.equal(recovered.requests, 0, 'automatic startup recovery precedes every client request');
            assert.equal(recovered.renders, 1);
            const ready = inspectDisk() as typeof pending;
            assert.equal(ready.ref, pending.ref); assert.equal(ready.key, pending.key);
            assert.equal(ready.status, 'ready'); assert.equal(ready.attempts, 2); assert.equal(ready.bytes, png().length);
        } finally {
            // Only children created above are signalled; no shared server/browser exists.
            for (const child of owned) {
                if (child.process.exitCode !== null || child.process.signalCode !== null) continue;
                child.process.kill('SIGTERM');
                const kill = setTimeout(() => child.process.kill('SIGKILL'), 500);
                try { await child.exit; } finally { clearTimeout(kill); }
            }
        }
    });
}
