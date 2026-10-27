import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldContextViews } from './WorldContextViews.ts';
test('Explore uses server stable refs/revisions and batches only explicit pictures, six at a time', async () => {
    const previous = globalThis.fetch, calls: {
        url: string;
        refs?: string[];
    }[] = [];
    const ac = new AbortController();
    let revision = 2;
    globalThis.fetch = async (input, init) => { const url = String(input), body = init?.body ? JSON.parse(String(init.body)) : null; calls.push({ url, refs: body?.refs }); return Response.json(body ? { views: body.refs.map((ref: string) => ({ ref, status: 'ready', url: '/v1/world/context/image?ref=' + ref })) } : { revision, nextCursor: url.includes('cursor=') ? null : revision + ':1', targets: url.includes('cursor=') ? [{ ref: 'e_room', title: 'Room', point: [1, 2, 3], radius: 2, enclosed: true, camera: { eye: [1, 2, 4], at: [1, 2, 3] } }] : [{ ref: 'e_stable', title: 'Actual seat', point: [1, 2, 3], radius: 2, viewpoint: { eye: [2, 4, 5], at: [1, 2, 3] }, enclosed: false }] }); };
    try {
        const client = new WorldContextViews(p => '/w/fixture' + p, ac.signal);
        assert.equal(calls.length, 0, 'no startup browser or request loop');
        await client.refresh();
        assert.equal(calls.length, 1, 'only the first page is fetched initially');
        assert.equal(client.locations.length, 1);
        assert.equal(client.page().more, true);
        await client.more();
        assert.equal(calls.length, 2);
        assert.equal(client.locations.length, 2);
        assert.equal(client.locations[0].inside, undefined, 'exterior authored camera stays exterior');
        assert.ok(client.locations[1].inside, 'actual room uses interior camera');
        assert.equal(client.locations[0].id, 'context:e_stable');
        assert.equal(client.locations[0].previewRevision, 2);
        const images = await Promise.all(Array.from({ length: 8 }, (_, i) => client.picture('context:e_' + i)));
        assert.equal(images.length, 8);
        assert.deepEqual(calls.filter(c => c.refs).map(c => c.refs!.length), [6, 2]);
        assert.ok(images.every(url => url?.startsWith('/w/fixture/v1/world/context/image?')));
        revision = 3;
        await client.refresh();
        assert.equal(client.locations[0].id, 'context:e_stable');
        assert.equal(client.locations[0].previewRevision, 3);
        ac.abort();
        assert.equal(await client.picture('context:e_stable'), null);
    }
    finally {
        globalThis.fetch = previous;
        ac.abort();
    }
});
import { contextStamp } from './context-stamp.ts';
test('media-only authored changes invalidate Explore pictures', () => { const before = { id: 'e_art', state: { media: '/assets/old.png' } } as never, after = { id: 'e_art', state: { media: '/assets/new.png' } } as never; assert.notEqual(contextStamp(before), contextStamp(after)); assert.equal(contextStamp({ id: 'h_soul', state: {} } as never), null); });

test('rapid search and old pagination cannot overwrite or merge into a new query', async () => {
    const previous = globalThis.fetch, ac = new AbortController();
    let finishOld!: (value: Response) => void;
    const oldPage = new Promise<Response>(resolve => { finishOld = resolve; });
    const target = (ref: string) => ({ ref, title: ref, point: [0, 0, 0], radius: 2 });
    globalThis.fetch = async input => {
        const url = new URL(String(input), 'https://fixture.test');
        if (url.searchParams.has('cursor')) return oldPage;
        const query = url.searchParams.get('q') ?? 'old';
        return Response.json({ revision: 1, listingRevision: query, total: query === 'old' ? 2 : 1, nextCursor: query === 'old' ? 'cursor-old' : null, targets: [target(query)] });
    };
    try {
        const client = new WorldContextViews(path => path, ac.signal);
        await client.search('old');
        const more = client.more();
        await client.search('new');
        finishOld(Response.json({ revision: 1, listingRevision: 'old', total: 2, nextCursor: null, targets: [target('stale-more')] }));
        await more;
        assert.deepEqual(client.locations.map(location => location.label), ['new']);
        assert.deepEqual(client.page(), { total: 1, more: false, loading: false, query: 'new', error: null });
    } finally { globalThis.fetch = previous; ac.abort(); }
});
test('cursor409 restarts once, remains bounded under repeated revisions, and opening retries failures', async () => {
    const previous = globalThis.fetch, ac = new AbortController();
    let calls = 0, mode = 'conflict';
    globalThis.fetch = async () => { calls++; return mode === 'conflict' ? Response.json({}, { status: 409 }) : mode === 'failure' ? Response.json({}, { status: 503 }) : Response.json({ revision: 7, total: 1, nextCursor: null, targets: [{ ref: 'ready', title: 'Ready text', point: [0, 0, 0], radius: 2 }] }); };
    try {
        const client = new WorldContextViews(path => path, ac.signal);
        await client.refresh();
        assert.equal(calls, 2);
        assert.match(client.page().error!, /changed again/);
        mode = 'ready';
        await client.search('');
        assert.equal(client.locations[0].label, 'Ready text');
        mode = 'failure';
        await client.refresh();
        assert.equal(client.locations[0].label, 'Ready text', 'existing text survives image-independent metadata failure');
        assert.match(client.page().error!, /unavailable/);
        mode = 'ready';
        await client.search('');
        assert.equal(client.page().error, null);
    } finally { globalThis.fetch = previous; ac.abort(); }
});

test('closing Explore aborts pending picture polling and reopening starts a fresh request', async () => {
    const previous = globalThis.fetch, ac = new AbortController();
    let calls = 0, requested!: () => void;
    const started = new Promise<void>(resolve => { requested = resolve; });
    globalThis.fetch = async (_input, init) => {
        calls++;
        if (calls === 1) {
            requested();
            return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('closed')), { once: true }));
        }
        return Response.json({ views: [{ ref: 'seat', status: 'ready', url: '/v1/world/context/image?ref=seat' }] });
    };
    try {
        const client = new WorldContextViews(path => path, ac.signal);
        const pending = client.picture('context:seat');
        await started;
        client.cancelPictures();
        const reopened = client.picture('context:seat');
        assert.equal(await pending, null);
        assert.equal(await reopened, '/v1/world/context/image?ref=seat');
        assert.equal(calls, 2, 'the cancelled client never resumes polling');
    } finally { globalThis.fetch = previous; ac.abort(); }
});


test('changing search cancels old picture generation without blocking new-query pictures', async () => {
    const previous = globalThis.fetch, ac = new AbortController();
    let started!: () => void, pictureCalls = 0;
    const pendingStarted = new Promise<void>(resolve => { started = resolve; });
    globalThis.fetch = async (_input, init) => {
        if (!init?.body) return Response.json({ targets: [], revision: 1, listingRevision: 'new', total: 0 });
        pictureCalls++;
        if (pictureCalls === 1) {
            started();
            return new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('superseded')), { once: true }));
        }
        return Response.json({ views: [{ ref: 'new', status: 'ready', url: '/new.png' }] });
    };
    try {
        const client = new WorldContextViews(path => path, ac.signal);
        const old = client.picture('context:old');
        await pendingStarted;
        await client.search('new');
        assert.equal(await old, null);
        assert.equal(await client.picture('context:new'), '/new.png');
        assert.equal(pictureCalls, 2);
    } finally { globalThis.fetch = previous; ac.abort(); }
});
