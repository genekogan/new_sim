import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldContextViews } from './WorldContextViews.ts';

test('legacy Explore never requests unsupported context metadata or pictures', async () => {
    const previous = globalThis.fetch, ac = new AbortController();
    let calls = 0, changes = 0;
    globalThis.fetch = async () => { calls++; return Response.json({}, { status: 404 }); };
    try {
        const client = new WorldContextViews(path => '/w/eden' + path, ac.signal, () => { changes++; }, false);
        await client.refresh();
        await client.search('garden');
        await client.more();
        assert.equal(await client.picture('context:room'), null);
        assert.equal(await client.picture('legacy:garden'), null);
        client.cancelPictures();
        await client.refresh();
        assert.equal(calls, 0, 'opening, searching and reopening legacy Explore cannot reach absent routes');
        assert.equal(changes, 0, 'unsupported metadata does not publish a loading/error state over the legacy fallback');
        assert.deepEqual(client.locations, []);
        assert.deepEqual(client.page(), { total: 0, more: false, loading: false, query: 'garden', error: null });
    } finally { globalThis.fetch = previous; ac.abort(); }
});

test('supported context worlds retain metadata, picture requests and visible HTTP failures', async () => {
    const previous = globalThis.fetch, ac = new AbortController(), calls: string[] = [];
    let unavailable = false;
    globalThis.fetch = async (input, init) => {
        calls.push(String(input));
        if (unavailable) return Response.json({}, { status: 404 });
        return Response.json(init?.body
            ? { views: [{ ref: 'room', status: 'ready', url: '/v1/world/context/image?ref=room' }] }
            : { revision: 4, targets: [{ ref: 'room', title: 'Room', point: [1, 2, 3], radius: 2 }] });
    };
    try {
        const client = new WorldContextViews(path => '/worlds/w/fixture' + path, ac.signal, () => {}, true);
        await client.refresh();
        assert.equal(client.locations[0].id, 'context:room');
        assert.equal(client.locations[0].previewRevision, 4);
        assert.equal(await client.picture('context:room'), '/worlds/w/fixture/v1/world/context/image?ref=room');
        unavailable = true;
        await client.refresh();
        assert.match(client.page().error!, /unavailable/);
        assert.equal(client.locations[0].label, 'Room', 'a real metadata failure retains the last usable listing');
        assert.deepEqual(calls, [
            '/worlds/w/fixture/v1/world/context',
            '/worlds/w/fixture/v1/world/context/views',
            '/worlds/w/fixture/v1/world/context',
        ]);
    } finally { globalThis.fetch = previous; ac.abort(); }
});
