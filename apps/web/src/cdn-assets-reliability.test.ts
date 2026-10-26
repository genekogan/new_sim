import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cdnFetch, readCdnManifest, CDN_HEADER_WAIT_MS, CDN_BODY_IDLE_MS } from './cdn-assets.ts';
const data = new Uint8Array([1, 2, 3]), sha = createHash('sha256').update(data).digest('hex');
const key = `assets/${sha.slice(0, 2)}/${sha}.png`;
const manifest = readCdnManifest({ version: 1, assets: { '/assets/probe.png': { key, sha256: sha, bytes: data.length, licence: 'own-work' } } });
const page = 'https://sim.eden.art/w/eden/', url = new URL('/assets/probe.png', page).href;
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise<void>(setImmediate); };
const setup = (t: TestContext) => t.mock.timers.enable({ apis: ['setTimeout'] });
const transport = (fetch: typeof globalThis.fetch) => cdnFetch(fetch, manifest, 'https://assets.eden.art', page);

test('six native connections can queue healthy origin headers past12s; all headers may be awaited before consuming', async t => {
  setup(t); let active = 0, queued = 0, admitted = 0;
  const waiting: (() => void)[] = [], signals: AbortSignal[] = [];
  const pump = () => { while (active < 6 && waiting.length) waiting.shift()!(); };
  const raw: typeof fetch = (input, init) => {
    if (String(input).startsWith('https://assets.')) return Promise.reject(Error('CDN unavailable'));
    queued++; signals.push(init!.signal!);
    return new Promise(resolve => {
      waiting.push(() => {
        active++; admitted++;
        resolve(new Response(new ReadableStream<Uint8Array>({ start(c) {
          c.enqueue(data.slice(0, 1));
          setTimeout(() => c.enqueue(data.slice(1, 2)), 10_000);
          // The tiny native response fits its own receive buffer, even before its caller consumes it.
          setTimeout(() => { c.enqueue(data.slice(2)); c.close(); active--; pump(); }, 15_000);
        } })));
      }); pump();
    });
  };
  const wrapped = transport(raw); let headersDone = false;
  const all = Promise.all(Array.from({ length: 20 }, () => wrapped(url))).then(r => { headersDone = true; return r; });
  await flush(); assert.equal(queued, 20); assert.equal(admitted, 6);
  t.mock.timers.tick(CDN_BODY_IDLE_MS + 1); await flush(); assert.equal(headersDone, false); assert.ok(signals.every(s => !s.aborted));
  t.mock.timers.tick(2999); await flush(); assert.equal(admitted, 12);
  t.mock.timers.tick(15000); await flush(); assert.equal(admitted, 18);
  t.mock.timers.tick(15000); await flush(); const responses = await all; assert.equal(admitted, 20);
  const contents = Promise.all(responses.map(r => r.arrayBuffer())); await flush();
  t.mock.timers.tick(10000); await flush(); t.mock.timers.tick(5000); await flush();
  for (const bytes of await contents) assert.deepEqual(new Uint8Array(bytes), data);
  assert.equal(active, 0); assert.equal(waiting.length, 0); assert.ok(signals.every(s => !s.aborted));
});

test('caller abort during a long queued origin header wait is immediate and discards a late response', async t => {
  setup(t); const caller = new AbortController(); let resolve!: (r: Response) => void, signal!: AbortSignal, cancelled = 0, calls = 0;
  const raw: typeof fetch = async (input, init) => {
    calls++; if (String(input).startsWith('https://assets.')) throw Error('CDN unavailable');
    signal = init!.signal!; return new Promise(r => { resolve = r; });
  };
  const result = transport(raw)(url, { signal: caller.signal }).then(() => null, e => e); await flush();
  t.mock.timers.tick(20000); await flush(); assert.equal(signal.aborted, false);
  const reason = new DOMException('left view', 'AbortError'); caller.abort(reason);
  assert.equal(await result, reason); assert.equal(signal.aborted, true);
  resolve(new Response(new ReadableStream({ cancel() { cancelled++; } }))); await flush();
  assert.equal(cancelled, 1); t.mock.timers.tick(CDN_HEADER_WAIT_MS); await flush(); assert.equal(calls, 2);
});

test('page transport settles both ignored header waits at64s without a third request, and cancels late bodies', async t => {
  setup(t); const calls: { signal: AbortSignal; resolve(r: Response): void }[] = []; let cancelled = 0;
  const raw: typeof fetch = (_url, init) => new Promise(resolve => calls.push({ signal: init!.signal!, resolve }));
  const result = transport(raw)(url).then(() => null, e => e); await flush();
  t.mock.timers.tick(4000); await flush(); assert.equal(calls.length, 2);
  t.mock.timers.tick(CDN_HEADER_WAIT_MS - 4000 - 1); await flush(); assert.ok(calls.every(x => !x.signal.aborted));
  t.mock.timers.tick(1); await flush(); assert.equal(calls[0].signal.aborted, true);
  t.mock.timers.tick(4000); await flush(); assert.equal((await result).name, 'TimeoutError');
  assert.equal(calls.length, 2); assert.ok(calls.every(x => x.signal.aborted));
  for (const call of calls) call.resolve(new Response(new ReadableStream({ cancel() { cancelled++; } })));
  await flush(); assert.equal(cancelled, 2); t.mock.timers.tick(60000); await flush(); assert.equal(calls.length, 2);
});

test('oversized open CDN body is aborted, cancelled, and unlocked before fallback completes', async t => {
  setup(t); let calls = 0, cancelled = 0, signal!: AbortSignal, source!: ReadableStream<Uint8Array>;
  const raw: typeof fetch = async (_url, init) => {
    if (++calls > 1) return new Response('origin'); signal = init!.signal!;
    source = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(4)); }, cancel() { cancelled++; } }); return new Response(source);
  };
  assert.equal(await (await transport(raw)(url)).text(), 'origin'); await flush();
  assert.equal(calls, 2); assert.equal(cancelled, 1); assert.equal(signal.aborted, true); assert.equal(source.locked, false);
});

test('raw origin fallback headers and body each settle without retries, including ignored abort', async t => {
  setup(t); let calls = 0, signal!: AbortSignal;
  const headers: typeof fetch = async (_url, init) => { if (++calls === 1) throw Error('CDN unavailable'); signal = init!.signal!; return new Promise(() => {}); };
  const headerResult = transport(headers)(url).then(() => null, e => e); await flush();
  t.mock.timers.tick(CDN_HEADER_WAIT_MS - 1); await flush(); assert.equal(signal.aborted, false);
  t.mock.timers.tick(1); await flush(); assert.equal((await headerResult).name, 'TimeoutError'); assert.equal(signal.aborted, true); assert.equal(calls, 2);
  calls = 0; let cancelled = 0;
  const body: typeof fetch = async (_url, init) => { if (++calls === 1) throw Error('CDN unavailable'); signal = init!.signal!; return new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([7])); }, cancel() { cancelled++; } })); };
  const response = await transport(body)(url); const bodyResult = response.blob().then(() => null, e => e); await flush();
  t.mock.timers.tick(12000); await flush(); assert.equal((await bodyResult).name, 'TimeoutError'); assert.equal(cancelled, 1); assert.equal(signal.aborted, true); assert.equal(calls, 2);
});

test('origin progress can take72s; no timeout while consumer is backpressured and zero chunks do not reset a pull', async t => {
  setup(t); let source!: ReadableStreamDefaultController<Uint8Array>, cancelled = 0;
  const raw: typeof fetch = async input => { if (String(input).startsWith('https://assets.')) throw Error('CDN unavailable'); return new Response(new ReadableStream({ start(c) { source = c; }, cancel() { cancelled++; } })); };
  const response = await transport(raw)(url); const reader = response.body!.getReader();
  // No consumer pull yet: no body deadline, even if the source has not produced bytes.
  t.mock.timers.tick(60000); await flush(); assert.equal(cancelled, 0);
  const values: number[] = [];
  for (const byte of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const read = reader.read(); await flush(); t.mock.timers.tick(9000); source.enqueue(new Uint8Array([byte])); await flush(); values.push(...(await read).value!);
    t.mock.timers.tick(20000); await flush(); assert.equal(cancelled, 0, 'consumer pause is not a network stall');
  }
  source.close(); assert.equal((await reader.read()).done, true); assert.deepEqual(values, [1, 2, 3, 4, 5, 6, 7, 8]);
  const next = await transport(raw)(url); const result = next.text().then(() => null, e => e); await flush();
  t.mock.timers.tick(11999); source.enqueue(new Uint8Array()); await flush(); t.mock.timers.tick(1); await flush();
  assert.equal((await result).name, 'TimeoutError'); assert.equal(cancelled, 1);
});

test('caller cancellation owns headers, a backpressured response, and a pending body pull without fallback', async t => {
  setup(t); let calls = 0, cancelled = 0;
  const ctl = new AbortController();
  const hanging: typeof fetch = async () => { calls++; return new Promise(() => {}); };
  const header = transport(hanging)(url, { signal: ctl.signal }).then(() => null, e => e); await flush();
  ctl.abort(); assert.equal((await header).name, 'AbortError'); assert.equal(calls, 1);
  for (const reading of [false, true]) {
    calls = 0; const owner = new AbortController();
    const raw: typeof fetch = async input => { calls++; if (String(input).startsWith('https://assets.')) throw Error('CDN unavailable'); return new Response(new ReadableStream({ cancel() { cancelled++; } })); };
    const response = await transport(raw)(url, { signal: owner.signal });
    const result = reading ? response.text().then(() => null, e => e) : null; await flush(); owner.abort(); await flush();
    assert.equal((result ? await result : await response.text().catch(e => e)).name, 'AbortError'); assert.equal(calls, 2);
  }
  assert.equal(cancelled, 2);
});

test('origin response keeps HTTP status, metadata, clone and request credentials/cache/headers', async t => {
  setup(t); const caller = new AbortController(); const input = new Request(url, { credentials: 'include', cache: 'reload', headers: { authorization: 'fixture-only' }, redirect: 'manual', signal: caller.signal });
  const init: RequestInit = { cache: 'no-cache', headers: { 'x-fixture': 'kept' }, referrerPolicy: 'same-origin' };
  let calls = 0;
  const raw: typeof fetch = async (arg, options) => {
    if (++calls === 1) { assert.equal(options!.credentials, 'omit'); assert.equal(options!.headers, undefined); throw Error('CDN unavailable'); }
    assert.equal(arg, input); assert.equal(options!.cache, init.cache); assert.deepEqual(options!.headers, init.headers); assert.equal(options!.referrerPolicy, init.referrerPolicy);
    const effective = new Request(arg, options); assert.equal(effective.credentials, 'include'); assert.equal(effective.redirect, 'manual'); assert.equal(effective.headers.get('x-fixture'), 'kept');
    const response = new Response('not found', { status: 404, statusText: 'Missing', headers: { 'x-result': 'raw' } });
    Object.defineProperties(response, { url: { value: 'https://sim.eden.art/redirected' }, type: { value: 'basic' }, redirected: { value: true } }); return response;
  };
  const response = await transport(raw)(input, init), clone = response.clone(), again = clone.clone();
  for (const r of [response, clone, again]) { assert.equal(r.status, 404); assert.equal(r.statusText, 'Missing'); assert.equal(r.ok, false); assert.equal(r.headers.get('x-result'), 'raw'); assert.equal(r.url, 'https://sim.eden.art/redirected'); assert.equal(r.type, 'basic'); assert.equal(r.redirected, true); }
  assert.deepEqual(await Promise.all([response.text(), clone.text(), again.text()]), ['not found', 'not found', 'not found']);
  assert.throws(() => response.clone(), TypeError);
});

test('no-body and opaque status-zero origin responses remain exact native responses', async t => {
  setup(t);
  for (const expected of [new Response(null, { status: 204 }), Response.error()]) {
    const raw: typeof fetch = async input => { if (String(input).startsWith('https://assets.')) throw Error('CDN unavailable'); return expected; };
    assert.equal(await transport(raw)(url), expected); assert.equal(expected.body, null);
  }
});

test('fast non-ok origin hedge cannot beat valid CDN headers; terminal origin HTTP status survives both errors', async t => {
  setup(t); let resolve!: (r: Response) => void, calls = 0, cancelled = 0;
  const raw: typeof fetch = input => { calls++; return String(input).startsWith('https://assets.') ? new Promise(r => resolve = r) : Promise.resolve(new Response(new ReadableStream({ cancel() { cancelled++; } }), { status: 503 })); };
  const pending = transport(raw)(url); await flush(); t.mock.timers.tick(4000); await flush();
  resolve(new Response(data)); assert.deepEqual(new Uint8Array(await (await pending).arrayBuffer()), data); assert.equal(calls, 2); assert.equal(cancelled, 1);
  const failed = transport(raw)(url); await flush(); t.mock.timers.tick(4000); await flush();
  resolve(new Response('missing', { status: 404 })); const response = await failed; assert.equal(response.status, 503); assert.equal(calls, 4); await response.body!.cancel();
});

test('consumer cancel closes owned origin reader once and unlisted/range/nonGET preserve exact pass-through identity', async t => {
  setup(t); let cancelled = 0, signal!: AbortSignal;
  const raw: typeof fetch = async (input, init) => { if (String(input).startsWith('https://assets.')) throw Error('CDN unavailable'); signal = init!.signal!; return new Response(new ReadableStream({ cancel() { cancelled++; } })); };
  const response = await transport(raw)(url); await response.body!.cancel('consumer done'); await flush(); assert.equal(cancelled, 1); assert.equal(signal.aborted, true);
  for (const [path, init] of [['/not-listed.png', {}], [url, { method: 'POST' }], [url, { headers: { range: 'bytes=0-2' } }]] as const) {
    const expected = new Response('unchanged');
    const pass: typeof fetch = async (arg, options) => { assert.equal(arg, path); assert.equal(options, init); return expected; };
    assert.equal(await transport(pass)(path, init), expected);
  }
});


test('failed CDN HTTP response plus failed origin hedge cannot start a fresh origin attempt', async t => {
  setup(t);
  for (const failure of ['network', 'timeout']) {
    let resolve!: (r: Response) => void, reject!: (reason: unknown) => void, calls = 0, cancelled = 0;
    const originError = new TypeError('origin network failure');
    const raw: typeof fetch = input => { calls++; return String(input).startsWith('https://assets.') ? new Promise(r => resolve = r) : new Promise((_r, j) => reject = j); };
    const result = transport(raw)(url).then(() => null, e => e); await flush();
    t.mock.timers.tick(4000); await flush(); t.mock.timers.tick(1000); await flush();
    resolve(new Response(new ReadableStream({ cancel() { cancelled++; } }), { status: 503 })); await flush();
    if (failure === 'network') { t.mock.timers.tick(1000); reject(originError); }
    else t.mock.timers.tick(CDN_HEADER_WAIT_MS - 1000);
    await flush(); const error = await result;
    if (failure === 'network') assert.equal(error, originError); else assert.equal(error.name, 'TimeoutError');
    assert.equal(calls, 2); assert.equal(cancelled, 1);
    t.mock.timers.tick(60000); await flush(); assert.equal(calls, 2);
  }
});
