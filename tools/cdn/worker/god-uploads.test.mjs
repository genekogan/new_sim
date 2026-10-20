// Local tests for the god-uploads Worker: a fake R2 binding, a fake origin and a fake edge cache (no network).
//   node --test tools/cdn/worker/god-uploads.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MAX_BYTES, IMMUTABLE, handle, parsePath } from './god-uploads.js';
import { FakeR2 } from './fake-r2.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const GLB = new TextEncoder().encode('glTF fake upload bytes ' + 'x'.repeat(5000));
const SHA = sha(GLB);
const url = (path) => `https://assets.eden.art${path}`;
const PATH = `/w/bench-hamlet/assets/${SHA}.glb`;

class FakeCache {
  constructor() { this.map = new Map(); }
  async match(req) { const r = this.map.get(req.url); return r ? r.clone() : undefined; }
  async put(req, res) { this.map.set(req.url, res.clone()); }
}
function origin(routes) {
  const calls = [];
  const fetch = async (u, init) => {
    calls.push({ url: String(u), init });
    const r = routes[String(u)];
    if (!r) return new Response('{"error":"not-found"}', { status: 404, headers: { 'content-type': 'application/json' } });
    return typeof r === 'function' ? r() : new Response(r.body, { status: r.status ?? 200, headers: r.headers ?? {} });
  };
  return { fetch, calls };
}
// `call` returns as soon as the handler answers, like a client: work the Worker left in ctx.waitUntil is still running
// (a real isolate keeps it going after the response). `settle()` waits for it. The R2 fake's puts take 40 ms to land, so
// anything a test reads from R2 right after `call` was written before the answer, not in the background.
function rig(routes = {}, r2 = {}) {
  const env = { ASSETS: new FakeR2(r2) }, o = origin(routes), cache = new FakeCache(), waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };
  const call = (path, init = {}) => handle(new Request(url(path), init), env, ctx, { fetch: o.fetch, caches: cache });
  const settle = () => Promise.all(waits.splice(0));
  return { env, o, cache, call, settle };
}
const SRC = `https://sim.eden.art/worlds/w/bench-hamlet/assets/${SHA}.glb`;
const body = async (r) => new Uint8Array(await r.arrayBuffer());

test('parsePath: only /w/<slug>/assets/<sha>.<ext>, strict shapes', () => {
  assert.deepEqual(parsePath(PATH), { slug: 'bench-hamlet', sha: SHA, ext: 'glb', key: `w/bench-hamlet/assets/${SHA}.glb` });
  for (const ext of ['png', 'jpg', 'json']) assert.ok(parsePath(`/w/a/assets/${SHA}.${ext}`));
  for (const bad of [
    `/w/Bench/assets/${SHA}.glb`, `/w/1abc/assets/${SHA}.glb`, `/w/${'a'.repeat(33)}/assets/${SHA}.glb`, `/w/a_b/assets/${SHA}.glb`,
    `/w/a/assets/${SHA.toUpperCase()}.glb`, `/w/a/assets/${SHA.slice(1)}.glb`, `/w/a/assets/${SHA}.gltf`, `/w/a/assets/${SHA}.webp`,
    `/w/a/assets/${SHA}.glb/`, `/w/a/assets/../assets/${SHA}.glb`, `/w/a/b/assets/${SHA}.glb`, `/assets/${SHA}.glb`, `/w/a/${SHA}.glb`,
    `/w/a/assets/${SHA}.GLB`, `/w//assets/${SHA}.glb`, `/w/a%2fb/assets/${SHA}.glb`,
  ]) assert.equal(parsePath(bad), null, bad);
});

test('miss with a good hash: pulls the god world route, returns the bytes, stores them with immutable metadata', async () => {
  const { env, o, call } = rig({ [SRC]: { body: GLB, headers: { 'content-type': 'model/gltf-binary' } } });
  const r = await call(PATH);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-eden-cdn'), 'miss');
  assert.equal(r.headers.get('content-type'), 'model/gltf-binary');
  assert.equal(r.headers.get('cache-control'), IMMUTABLE);
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://sim.eden.art');
  assert.equal(r.headers.get('etag'), `"${SHA}"`);
  assert.equal(r.headers.get('content-length'), String(GLB.byteLength));
  assert.deepEqual(await body(r), GLB);
  assert.equal(o.calls.length, 1); assert.equal(o.calls[0].url, SRC); assert.equal(o.calls[0].init.redirect, 'manual');
  assert.equal(env.ASSETS.puts.length, 1);
  assert.ok(env.ASSETS.objects.has(`w/bench-hamlet/assets/${SHA}.glb`), 'stored in R2 before the 200 (not left in waitUntil)');
  const put = env.ASSETS.puts[0];
  assert.equal(put.key, `w/bench-hamlet/assets/${SHA}.glb`);
  assert.equal(put.opts.sha256, SHA);
  assert.deepEqual(put.opts.httpMetadata, { contentType: 'model/gltf-binary', cacheControl: IMMUTABLE });
  assert.equal(put.opts.customMetadata.sha256, SHA); assert.equal(put.opts.customMetadata.bytes, String(GLB.byteLength));
  assert.equal(put.opts.customMetadata.world, 'bench-hamlet'); assert.equal(put.opts.customMetadata.licence, 'god-upload');
});

test('the origin may send brotli: the Worker hashes the decoded bytes it reads (Workers fetch decodes)', async () => {
  // A fetch implementation hands the decoded body to the Worker; content-encoding on the origin answer is not a size claim.
  const { env, call } = rig({ [SRC]: { body: GLB, headers: { 'content-encoding': 'br', 'content-length': '10' } } });
  const r = await call(PATH);
  assert.equal(r.status, 200); assert.deepEqual(await body(r), GLB); assert.equal(env.ASSETS.puts.length, 1);
});

test('hit: served from R2 (no origin request), then from the edge cache (no R2 read)', async () => {
  const { env, o, call, settle } = rig({ [SRC]: { body: GLB } });
  await call(PATH); await settle();                  // miss -> stored; the edge-cache fill finishes in the background
  const r1 = await call(PATH);
  assert.equal(r1.status, 200); assert.equal(r1.headers.get('x-eden-cdn'), 'edge');   // the miss also filled the edge cache
  assert.deepEqual(await body(r1), GLB);
  assert.equal(o.calls.length, 1);
  const { env: env2, o: o2, cache: c2, call: call2, settle: settle2 } = rig({});
  env2.ASSETS.objects = env.ASSETS.objects;          // R2 already holds it, edge cache empty
  const r2 = await call2(PATH);
  assert.equal(r2.status, 200); assert.equal(r2.headers.get('x-eden-cdn'), 'hit');
  assert.equal(r2.headers.get('cache-control'), IMMUTABLE); assert.equal(r2.headers.get('content-type'), 'model/gltf-binary');
  assert.equal(r2.headers.get('access-control-allow-origin'), 'https://sim.eden.art');
  assert.deepEqual(await body(r2), GLB); await settle2();
  assert.equal(o2.calls.length, 0); assert.equal(env2.ASSETS.gets, 1); assert.equal(c2.map.size, 1);
  const r3 = await call2(PATH);
  assert.equal(r3.headers.get('x-eden-cdn'), 'edge'); assert.equal(env2.ASSETS.gets, 1); assert.deepEqual(await body(r3), GLB);
});

test('hit on an object stored precompressed: Content-Encoding br, the stored bytes as they are', async () => {
  const { env, call } = rig({});
  const br = new Uint8Array([1, 2, 3, 4]);
  env.ASSETS.objects.set(`w/bench-hamlet/assets/${SHA}.glb`, { bytes: br, httpMetadata: { contentType: 'model/gltf-binary', contentEncoding: 'br' }, customMetadata: { sha256: SHA } });
  const r = await call(PATH);
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-encoding'), 'br'); assert.equal(r.headers.get('content-length'), null);
});

test('bad hash: 502, nothing stored, nothing cached, the next request asks the origin again', async () => {
  const { env, o, cache, call, settle } = rig({ [SRC]: () => new Response(new TextEncoder().encode('not the bytes the sha names')) });
  const r = await call(PATH); await settle();
  assert.equal(r.status, 502); assert.equal(r.headers.get('x-eden-cdn'), 'refused:sha-mismatch'); assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(env.ASSETS.puts.length, 0); assert.equal(cache.map.size, 0);
  await call(PATH); assert.equal(o.calls.length, 2);
});

test('origin non-200: 404 stays 404, 500 and redirects are 502; nothing stored', async () => {
  const { env, call } = rig({});
  const r404 = await call(PATH);
  assert.equal(r404.status, 404); assert.equal(r404.headers.get('cache-control'), 'no-store');
  for (const status of [500, 503, 302, 304, 206]) {
    const x = rig({ [SRC]: { status, body: status === 304 ? null : GLB, headers: status === 302 ? { location: 'https://elsewhere.example/x' } : {} } });
    const r = await x.call(PATH);
    assert.equal(r.status, 502, String(status)); assert.equal(r.headers.get('x-eden-cdn'), `refused:origin-${status}`);
    assert.equal(x.env.ASSETS.puts.length, 0);
  }
  assert.equal(env.ASSETS.puts.length, 0);
  const down = rig({ [SRC]: () => { throw Error('connect ECONNREFUSED'); } });
  const r = await down.call(PATH); assert.equal(r.status, 502); assert.equal(down.env.ASSETS.puts.length, 0);
});

test('too large: refused by declared length and while reading; nothing stored', async () => {
  const declared = rig({ [SRC]: { body: GLB, headers: { 'content-length': String(MAX_BYTES + 1) } } });
  assert.equal((await declared.call(PATH)).status, 502);
  let pulled = 0;
  const chunk = new Uint8Array(1024 * 1024);
  const stream = rig({ [SRC]: () => new Response(new ReadableStream({ pull(c) { pulled++; if (pulled > 40) c.close(); else c.enqueue(chunk); } })) });
  const r = await stream.call(PATH);
  assert.equal(r.status, 502); assert.equal(r.headers.get('x-eden-cdn'), 'refused:too-large');
  assert.ok(pulled <= 34, `stopped reading at the cap (read ${pulled} chunks)`);
  assert.equal(stream.env.ASSETS.puts.length, 0);
  const empty = rig({ [SRC]: { body: new Uint8Array(0) } });
  assert.equal((await empty.call(PATH)).status, 502);
});

test('malformed paths, queries and methods: refused before any R2 or origin access', async () => {
  const { env, o, call } = rig({ [SRC]: { body: GLB } });
  for (const p of ['/w/', '/w/bench-hamlet', `/w/bench-hamlet/assets/${SHA}`, `/w/bench-hamlet/assets/${SHA}.exe`, `/w/Bench/assets/${SHA}.glb`,
    `/w/bench-hamlet/assets/${SHA.slice(0, 63)}g.glb`, `/w/bench-hamlet/assets/${SHA}.glb?v=1`, `/w/bench-hamlet/assets/%2e%2e/${SHA}.glb`]) {
    const r = await call(p);
    assert.equal(r.status, 400, p); assert.equal(r.headers.get('cache-control'), 'no-store');
  }
  for (const method of ['POST', 'PUT', 'DELETE']) assert.equal((await call(PATH, { method, body: method === 'DELETE' ? undefined : 'x' })).status, 405);
  assert.equal(o.calls.length, 0); assert.equal(env.ASSETS.gets, 0); assert.equal(env.ASSETS.puts.length, 0);
});

test('HEAD never pulls; OPTIONS answers CORS; If-None-Match gives 304', async () => {
  const { env, o, call } = rig({ [SRC]: { body: GLB } });
  const h = await call(PATH, { method: 'HEAD' });
  assert.equal(h.status, 404); assert.equal(o.calls.length, 0);
  await call(PATH);
  const h2 = await call(PATH, { method: 'HEAD' });
  assert.equal(h2.status, 200); assert.equal(h2.headers.get('content-length'), String(GLB.byteLength)); assert.equal(h2.headers.get('x-eden-cdn'), 'hit');
  const opt = await call(PATH, { method: 'OPTIONS' });
  assert.equal(opt.status, 204); assert.equal(opt.headers.get('access-control-allow-origin'), 'https://sim.eden.art');
  const nm = await call(PATH, { headers: { 'if-none-match': `W/"${SHA}"` } });
  assert.equal(nm.status, 304); assert.equal(env.ASSETS.puts.length, 1);
});

test('a stray object at the key without our sha metadata is not served; the verified pull replaces it', async () => {
  const { env, o, call } = rig({ [SRC]: { body: GLB } });
  env.ASSETS.objects.set(`w/bench-hamlet/assets/${SHA}.glb`, { bytes: new Uint8Array([9, 9]), httpMetadata: {}, customMetadata: {} });
  const r = await call(PATH);
  assert.equal(r.status, 200); assert.equal(r.headers.get('x-eden-cdn'), 'miss'); assert.deepEqual(await body(r), GLB); assert.equal(o.calls.length, 1);
});

test('no binding: 500, never an origin pull', async () => {
  const o = origin({ [SRC]: { body: GLB } });
  const r = await handle(new Request(url(PATH)), {}, {}, { fetch: o.fetch, caches: null });
  assert.equal(r.status, 500); assert.equal(o.calls.length, 0);
});

test('HEAD right after the miss answers 200 hit: the write landed before the miss answered (the live 2026-10-20 race)', async () => {
  const { call } = rig({ [SRC]: { body: GLB } }, { latencyMs: 150 });
  const t0 = Date.now();
  const m = await call(PATH);
  assert.equal(m.headers.get('x-eden-cdn'), 'miss'); assert.ok(Date.now() - t0 >= 140, 'the miss waited for the R2 write');
  const h = await call(PATH, { method: 'HEAD' });     // no settle(): nothing left in the background may be needed
  assert.equal(h.status, 200); assert.equal(h.headers.get('x-eden-cdn'), 'hit');
});

test('R2 write fails: the verified bytes still answer (miss-unstored), the error is logged, the next request pulls again', async () => {
  const { env, o, cache, call, settle } = rig({ [SRC]: { body: GLB } }, { failPuts: true });
  const logged = [], was = console.error; console.error = (...a) => logged.push(a.join(' '));
  try {
    const r = await call(PATH); await settle();
    assert.equal(r.status, 200); assert.equal(r.headers.get('x-eden-cdn'), 'miss-unstored'); assert.deepEqual(await body(r), GLB);
    assert.equal(env.ASSETS.objects.size, 0);
    assert.ok(logged.some((l) => l.includes('R2 put failed') && l.includes(`w/bench-hamlet/assets/${SHA}.glb`)), logged.join('\n'));
    const h = await call(PATH, { method: 'HEAD' }); assert.equal(h.status, 404);
    cache.map.clear(); await call(PATH); assert.equal(o.calls.length, 2);
  } finally { console.error = was; }
});

test('edge cache put failure is logged, not swallowed', async () => {
  const { call, settle, cache } = rig({ [SRC]: { body: GLB } });
  cache.put = async () => { throw Error('cache quota'); };
  const logged = [], was = console.error; console.error = (...a) => logged.push(a.join(' '));
  try { const r = await call(PATH); await settle(); assert.equal(r.status, 200); } finally { console.error = was; }
  assert.ok(logged.some((l) => l.includes('edge cache put failed')), logged.join('\n'));
});

test('the R2 fake is as strict as the R2 Workers API: unknown options, two hashes, bad metadata and a wrong hash reject', async () => {
  const r2 = new FakeR2({ latencyMs: 0 }), b = new Uint8Array([1, 2, 3]), h = sha(b);
  await assert.rejects(r2.put('k', b, { sha256: h, md5: createHash('md5').update(b).digest('hex') }), /single hashing/);
  await assert.rejects(r2.put('k', b, { checksum: h }), /unknown option checksum/);
  await assert.rejects(r2.put('k', b, { httpMetadata: { contentLength: '3' } }), /unknown httpMetadata/);
  await assert.rejects(r2.put('k', b, { customMetadata: { n: 3 } }), /must be a string/);
  await assert.rejects(r2.put('k', b, { customMetadata: { big: 'x'.repeat(2048) } }), /limit 2048/);
  await assert.rejects(r2.put('k', b, { sha256: sha(new Uint8Array([9])) }), /sha256 mismatch/);
  assert.equal(r2.objects.size, 0);
  assert.equal((await r2.put('k', b, { sha256: h, httpMetadata: { contentType: 'x/y', cacheControl: IMMUTABLE }, customMetadata: { sha256: h } })).size, 3);
});
