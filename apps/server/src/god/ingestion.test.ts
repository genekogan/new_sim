import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { ApiError } from '../souls.ts';
import { GOD_JSON_BYTES, MULTIPART_OVERHEAD_BYTES, FOOTPRINT_BYTES, godBodyLimit } from './ingestion.ts';

function fixture() {
  const app = new Hono(); let parses = 0;
  app.use('/v1/god/*', godBodyLimit(() => ({ bytes: 100 })));
  app.post('/v1/god/assets', async c => { parses++; return c.json({ bytes: (await c.req.arrayBuffer()).byteLength }); });
  app.post('/v1/god/act', async c => { parses++; return c.json(await c.req.json()); });
  app.onError((e, c) => e instanceof ApiError ? c.json({ code: e.code, ...e.extra }, e.status as 400) : c.json({ code: 'internal' }, 500));
  return { app, parses: () => parses };
}

function streamRequest(path: string, chunks: Uint8Array[], headers: Record<string, string> = {}, fail = false) {
  let i = 0, cancelled = false;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { if (i < chunks.length) controller.enqueue(chunks[i++]); else if (fail) controller.error(new Error('upload interrupted')); else controller.close(); }, cancel() { cancelled = true; } });
  return { request: new Request(`http://localhost${path}`, { method: 'POST', headers, body, duplex: 'half' } as RequestInit), cancelled: () => cancelled };
}

test('declared God JSON and asset lengths are rejected before body reads or parsing', async () => {
  for (const [path, limit, code] of [['/v1/god/act', GOD_JSON_BYTES, 'too-large'], ['/v1/god/assets', 100, 'asset.budget']] as const) {
    const f = fixture(); let reads = 0;
    const request = new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-length': String(limit + 1) }, body: new ReadableStream({ pull(c) { reads++; c.close(); } }, { highWaterMark: 0 }), duplex: 'half' } as RequestInit);
    const r = await f.app.request(request), data = await r.json() as { code: string; measured: { bytes: number }; allowed: { bytes: number } };
    assert.equal(r.status, 413); assert.equal(data.code, code); assert.equal(data.measured.bytes, limit + 1); assert.equal(data.allowed.bytes, limit);
    assert.equal(reads, 0); assert.equal(f.parses(), 0);
  }
});

test('actual stream is bounded even with absent or understated Content-Length', async () => {
  for (const headers of [{}, { 'content-length': '1' }] as Record<string, string>[]) {
    const f = fixture(), stream = streamRequest('/v1/god/assets', [new Uint8Array(60), new Uint8Array(50), new Uint8Array(10)], headers);
    const r = await f.app.request(stream.request), data = await r.json() as { measured: { bytes: number }; allowed: { bytes: number } };
    assert.equal(r.status, 413); assert.deepEqual(data.measured, { bytes: 110 }); assert.deepEqual(data.allowed, { bytes: 100 });
    assert.equal(f.parses(), 0); assert.equal(stream.cancelled(), true);
  }
});

test('God JSON stream bound applies before JSON decoding', async () => {
  const f = fixture(), stream = streamRequest('/v1/god/act', [new Uint8Array(GOD_JSON_BYTES), new Uint8Array(1)]);
  assert.equal((await f.app.request(stream.request)).status, 413); assert.equal(f.parses(), 0);
});

test('multipart has a bounded footprint and envelope allowance; normal JSON and raw files parse', async () => {
  const f = fixture(), limit = 100 + FOOTPRINT_BYTES + MULTIPART_OVERHEAD_BYTES;
  const multipart = await f.app.request('/v1/god/assets', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=test', 'content-length': String(limit + 1) }, body: 'x' });
  assert.equal(multipart.status, 413); assert.equal(f.parses(), 0);
  assert.equal((await f.app.request('/v1/god/act', { method: 'POST', body: '{"ops":[]}' })).status, 200);
  const raw = streamRequest('/v1/god/assets', [new Uint8Array(100)]);
  assert.deepEqual(await (await f.app.request(raw.request)).json(), { bytes: 100 });
});

test('interrupted and malformed-length uploads never reach parsers', async () => {
  const f = fixture(), stream = streamRequest('/v1/god/assets', [new Uint8Array(10)], {}, true);
  const r = await f.app.request(stream.request), data = await r.json() as { code: string; measured: { complete: boolean } };
  assert.equal(r.status, 400); assert.equal(data.code, 'asset.invalid'); assert.equal(data.measured.complete, false);
  const malformed = streamRequest('/v1/god/assets', [], { 'content-length': '50garbage' });
  assert.equal((await f.app.request(malformed.request)).status, 400); assert.equal(f.parses(), 0);
});
