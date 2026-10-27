import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ContextViewCache, CONTEXT_LIMITS, type ContextInput } from './context-view-cache.ts';
const gate = () => { let resolve!: () => void; return { promise: new Promise<void>(r => resolve = r), resolve: () => resolve() }; };
const input = (key: string): ContextInput => ({ key, revision: 1, payload: { key } });
test('shared preparation holds pending records, coalesces refresh and aborts on close', async () => {
    const db = new DatabaseSync(':memory:');
    const hold = gate(), entered = gate();
    let preparations = 0, renders = 0;
    const cache = new ContextViewCache(db, 'prep', () => input('a'), async () => { renders++; return { png: new Uint8Array([1]) }; }, async signal => {
        preparations++; entered.resolve();
        await Promise.race([hold.promise, new Promise<void>((_, reject) => {
            if (signal.aborted) reject(signal.reason);
            else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        })]);
    });
    cache.request('place');
    await entered.promise;
    for (let i = 0; i < 5; i++) cache.refresh();
    assert.equal(preparations, 1);
    assert.equal(db.prepare('SELECT status FROM context_views_v1').get()?.status, 'pending');
    await cache.close();
    assert.equal(renders, 0);
    assert.equal(db.prepare('SELECT status FROM context_views_v1').get()?.status, 'pending');
    db.close();
});
test('a dirty event at the prepare-return handoff is replayed without another external request', async () => {
    const db = new DatabaseSync(':memory:');
    let key = 'a', ready = true, first = true;
    const rendered: string[] = [];
    const cache = new ContextViewCache(db, 'handoff', () => {
        if (!ready) throw Error('preparation superseded');
        return input(key);
    }, async value => { rendered.push(value.key); return { png: new Uint8Array([1]) }; }, async () => {
        ready = true;
        if (first) {
            first = false;
            queueMicrotask(() => { key = 'b'; ready = false; cache.refresh(); });
        }
    });
    try {
        cache.request('place');
        await cache.settled();
        assert.deepEqual(rendered, ['b']);
        assert.equal(cache.peek('place')?.status, 'ready');
        assert.equal(cache.image('place', 'a'), null);
        assert.ok(cache.image('place', 'b'));
    } finally { await cache.close(); db.close(); }
});
test('a queued dirty event after a refresh pass survives promise finalization', async () => {
    const db = new DatabaseSync(':memory:');
    let key = 'a', reads = 0, ready = true;
    const rendered: string[] = [];
    const cache = new ContextViewCache(db, 'finalization', () => {
        if (!ready) throw Error('preparation superseded');
        if (++reads === 2) queueMicrotask(() => { key = 'b'; ready = false; cache.refresh(); });
        return input(key);
    }, async value => { rendered.push(value.key); return { png: new Uint8Array([1]) }; }, async () => { ready = true; });
    try {
        cache.request('place');
        await cache.settled();
        assert.deepEqual(rendered, ['b']);
        assert.equal(cache.peek('place')?.status, 'ready');
        assert.ok(cache.image('place', 'b'));
        assert.equal(cache.image('place', 'a'), null);
    } finally { await cache.close(); db.close(); }
});
test('idle, cross-client reuse, rename reuse, visual invalidation, bounded failure and eviction', async () => {
    const db = new DatabaseSync(':memory:');
    let key = 'a', revision = 1, renders = 0, fail = false;
    const c = new ContextViewCache(db, 'world', () => ({ ...input(key), revision }), async () => { renders++; return fail ? { reason: 'obstructed' } : { png: new Uint8Array([1, 2, 3]) }; });
    c.refresh();
    await c.settled();
    assert.equal(renders, 0);
    assert.equal(c.request('place')?.status, 'pending');
    c.request('place');
    await c.settled();
    assert.equal(renders, 1);
    assert.equal(c.request('place')?.status, 'ready');
    assert.equal(renders, 1);
    revision++;
    c.refresh();
    await c.settled();
    assert.equal(renders, 1);
    assert.equal(c.peek('place')?.revision, 2);
    key = 'b';
    c.refresh();
    await c.settled();
    assert.equal(renders, 2);
    assert.equal(c.image('place', 'a'), null);
    assert.deepEqual(c.image('place', 'b'), new Uint8Array([1, 2, 3]));
    fail = true;
    key = 'c';
    c.refresh();
    await c.settled();
    assert.equal(renders, 4);
    assert.equal(c.peek('place')?.status, 'unavailable');
    for (let i = 0; i < 5; i++)
        c.request('place');
    await c.settled();
    assert.equal(renders, 4, 'no retry spin or request reset');
    for (let i = 0; i < 30; i++)
        c.request('p' + i);
    await c.settled();
    assert.equal((db.prepare('SELECT COUNT(*) n FROM context_views_v1').get() as any).n, CONTEXT_LIMITS.records);
    await c.close();
    db.close();
});
test('coalesces edits, never publishes superseded capture or resurrects deletion, recovers restart', async () => {
    const db = new DatabaseSync(':memory:');
    let key: string | null = 'a', renders = 0;
    const hold = gate(), started = gate();
    const get = () => key ? input(key) : null;
    const c = new ContextViewCache(db, 'world', get, async () => { renders++; started.resolve(); await hold.promise; return { png: new Uint8Array([renders]) }; });
    c.request('place');
    await started.promise;
    key = 'b';
    c.refresh();
    key = 'c';
    c.refresh();
    hold.resolve();
    await c.settled();
    assert.equal(renders, 2);
    assert.equal(c.image('place', 'a'), null);
    assert.ok(c.image('place', 'c'));
    key = null;
    c.refresh();
    await c.settled();
    assert.equal(c.peek('place'), null);
    assert.equal((db.prepare('SELECT COUNT(*) n FROM context_views_v1').get() as any).n, 0);
    await c.close();
    key = 'd';
    db.prepare("INSERT INTO context_views_v1(world,ref,key,revision,status,attempts,reason,png,touched) VALUES('world','place','d',1,'pending',0,NULL,NULL,0)").run();
    const recovered = new ContextViewCache(db, 'world', get, async () => ({ png: new Uint8Array([9]) }));
    recovered.refresh();
    await recovered.settled();
    assert.equal(recovered.peek('place')?.status, 'ready');
    await recovered.close();
    db.close();
});
test('delete during capture discards pixels and pending survives an orderly stop', async () => {
    const db = new DatabaseSync(':memory:');
    let exists = true;
    const started = gate(), hold = gate();
    const c = new ContextViewCache(db, 'w', () => exists ? input('x') : null, async () => { started.resolve(); await hold.promise; return { png: new Uint8Array([8]) }; });
    c.request('x');
    await started.promise;
    exists = false;
    hold.resolve();
    await c.settled();
    assert.equal(c.image('x', 'x'), null);
    await c.close();
    db.close();
});
test('shutdown abort retains pending work for one bounded recovery attempt', async () => {
    const db = new DatabaseSync(':memory:'), started = gate();
    const c = new ContextViewCache(db, 'restart', () => input('key'), async (_i, signal) => { started.resolve(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); return { reason: 'stopped' }; });
    c.request('ref');
    await started.promise;
    await c.close();
    const pending = db.prepare("SELECT status,attempts FROM context_views_v1 WHERE world='restart'").get();
    assert.deepEqual({ ...pending }, { status: 'pending', attempts: 1 });
    const next = new ContextViewCache(db, 'restart', () => input('key'), async () => ({ png: new Uint8Array([1]) }));
    next.refresh();
    await next.settled();
    assert.equal(next.peek('ref')?.status, 'ready');
    assert.equal(next.peek('ref')?.attempts, 2);
    await next.close();
    db.close();
});
test('byte storage stays bounded with near-limit pictures, independently of record limit', async () => {
    const db = new DatabaseSync(':memory:'), png = new Uint8Array(CONTEXT_LIMITS.imageBytes);
    const c = new ContextViewCache(db, 'bytes', ref => input(ref), async () => ({ png }));
    for (let i = 0; i < 20; i++) {
        c.request('ref' + i);
        await c.settled();
    }
    const totals = db.prepare("SELECT COUNT(*) n,SUM(length(png)) bytes FROM context_views_v1").get() as {
        n: number;
        bytes: number;
    };
    assert.ok(totals.n <= CONTEXT_LIMITS.records);
    assert.ok(totals.bytes <= CONTEXT_LIMITS.cacheBytes);
    assert.equal(c.peek('ref19')?.bytes, CONTEXT_LIMITS.imageBytes);
    await c.close();
    db.close();
});

test('explicit stale request gets next slot after active capture, independently of LRU', async () => {
    const db = new DatabaseSync(':memory:');
    let revision = 1;
    const started = gate(), hold = gate(), order: string[] = [];
    const cache = new ContextViewCache(db, 'priority', ref => ({ key: ref + revision, revision, payload: ref }), async current => {
        if (revision === 2) {
            order.push(current.payload as string);
            if (order.length === 1) { started.resolve(); await hold.promise; }
        }
        return { png: new Uint8Array([1]) };
    });
    for (const ref of ['oldest', 'middle', 'requested', 'other']) cache.request(ref);
    await cache.settled();
    revision = 2;
    cache.refresh();
    await started.promise;
    assert.equal(order[0], 'oldest');
    cache.request('requested');
    hold.resolve();
    await cache.settled();
    assert.deepEqual(order, ['oldest', 'requested', 'middle', 'other']);
    assert.equal(new Set(order).size, 4, 'coalesces each revision to one capture');
    await cache.close();
    db.close();
});
test('maintenance advances after a bounded burst of explicitly requested captures', async () => {
    const db = new DatabaseSync(':memory:');
    let revision = 1;
    const started = gate(), hold = gate(), order: string[] = [];
    const cache = new ContextViewCache(db, 'fair', ref => ({ key: ref + revision, revision, payload: ref }), async current => {
        if (revision === 2) {
            order.push(current.payload as string);
            if (order.length === 1) { started.resolve(); await hold.promise; }
        }
        return { png: new Uint8Array([1]) };
    });
    for (const ref of ['active', 'maintenance', ...Array.from({ length: 8 }, (_, i) => 'request' + i)]) cache.request(ref);
    await cache.settled();
    revision = 2;
    cache.refresh();
    await started.promise;
    for (let i = 0; i < 8; i++) cache.request('request' + i);
    hold.resolve();
    await cache.settled();
    assert.equal(order[0], 'active');
    assert.equal(order[1], 'request7', 'latest explicit request first');
    assert.equal(order[7], 'maintenance', 'oldest maintenance after six explicit jobs');
    assert.equal(order.length, 10);
    await cache.close();
    db.close();
});

test('old explicit requests progress despite a stream of newer requests', async () => {
    const db = new DatabaseSync(':memory:'), order: string[] = [];
    const cache = new ContextViewCache(db, 'explicit-fair', ref => ({ key: ref, revision: 1, payload: ref }), async current => {
        order.push(current.payload as string);
        if (order.length <= 12) cache.request('new-' + order.length);
        return { png: new Uint8Array([1]) };
    });
    for (let i = 0; i < 8; i++) cache.request('old-' + i);
    await cache.settled();
    assert.equal(order[0], 'old-7', 'newest requested gets priority');
    assert.equal(order[6], 'old-0', 'oldest explicit request gets seventh slot');
    assert.equal(new Set(order).size, order.length, 'one capture per key');
    await cache.close(); db.close();
});


test('photo provenance persists across restart and is discarded with superseded pixels', async () => {
    const db = new DatabaseSync(':memory:'); let key = 'first';
    const photo = { recipeVersion: 'context-photo/1', provenance: { camera: 'geometric', front: 'unknown' }, cutaway: { label: 'Cutaway', mode: 'hide', occluderIds: ['roof:0'] } };
    const original = new ContextViewCache(db, 'world', () => input(key), async () => ({ png: new Uint8Array([1]), photo }));
    original.request('seat'); await original.settled(); await original.close();
    const reopened = new ContextViewCache(db, 'world', () => input(key), async () => ({ png: new Uint8Array([2]) }));
    assert.deepEqual(reopened.peek('seat')!.photo, photo);
    key = 'second';
    assert.equal(reopened.request('seat')!.photo, null, 'old provenance cannot describe a new picture');
    await reopened.settled(); assert.equal(reopened.peek('seat')!.photo, null);
    await reopened.close(); db.close();
});
