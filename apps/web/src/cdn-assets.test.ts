import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cdnFetch, cdnOrigin, installCdnAssets, manifestAsset, readCdnManifest } from './cdn-assets.ts';

const bytes = new TextEncoder().encode('approved fixture bytes');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const entry = { key: `assets/${sha256.slice(0, 2)}/${sha256}.glb`, sha256, bytes: bytes.length, licence: 'CC0-1.0' };
const manifest = readCdnManifest({ version: 1, assets: { '/worlds/assets/model.glb': entry, '/browser/campus.glb?v=reviewed': entry } });
const page = 'https://sim.eden.art/worlds/w/eden';

test('only explicit local manifest paths opt in, retaining query version pins and /worlds prefix', () => {
  assert.equal(manifestAsset(manifest, '/worlds/assets/model.glb', page), entry);
  for (const url of ['/assets/model.glb', '/worlds/assets/model.glb?v=new', 'https://other.test/worlds/assets/model.glb', '/browser/campus.glb']) assert.equal(manifestAsset(manifest, url, page), undefined);
  assert.equal(manifestAsset(manifest, '/browser/campus.glb?v=reviewed', page), entry);
  assert.throws(() => readCdnManifest({ version: 1, assets: { '/private.glb': { ...entry, licence: 'private' } } }));
  assert.throws(() => readCdnManifest({ version: 1, assets: { '/a.glb': { ...entry, key: 'assets/00/other.glb' } } }));
  assert.throws(() => readCdnManifest({ version: 1, assets: { [`/assets/${'0'.repeat(64)}.glb`]: entry } }));
  assert.throws(() => cdnOrigin('https://other.test'));
  assert.throws(() => cdnOrigin('http://127.0.0.1:5811/path'));
  assert.equal(cdnOrigin('http://127.0.0.1:5811'), 'http://127.0.0.1:5811');
});

test('default-off never asks for a manifest; dynamic world slugs use explicit immutable aliases only', async () => {
  await installCdnAssets('/must-not-fetch.json'); // no compiled opt-in, or browser global, is required
  const hashes = readCdnManifest({ version: 1, assets: { [`/worlds/assets/${sha256}.glb`]: entry, [`/assets/${sha256}.glb`]: entry } });
  assert.equal(manifestAsset(hashes, `/worlds/w/owner-created/assets/${sha256}.glb`, page), entry);
  assert.equal(manifestAsset(hashes, `/w/eden/assets/${sha256}.glb`, page), entry);
  assert.equal(manifestAsset(hashes, `/worlds/w/owner-created/assets/${'0'.repeat(64)}.glb`, page), undefined);
  assert.equal(manifestAsset(hashes, `/worlds/w/owner-created/assets/${sha256}.glb?v=new`, page), undefined);
});

test('prepared publication manifest validates and resolves real core mesh requests on both site surfaces', () => {
  const prepared = readCdnManifest(JSON.parse(readFileSync(new URL('./cdn-manifest.json', import.meta.url), 'utf8')));
  const cow = 'bbb287748cb8dbbe4fbf63ca5d92c823cda863139bb4830182b3fc66a1f6deb9';
  for (const prefix of ['', '/worlds']) assert.equal(manifestAsset(prepared, `${prefix}/w/fresh-owner-world/assets/${cow}.glb`, page)?.sha256, cow);
  assert.equal(manifestAsset(prepared, '/browser/campus.glb?v=20260922b', page), undefined, 'campus remains excluded pending publication provenance');
});

test('verified CDN bytes omit origin credentials and auth headers', async () => {
  const calls: { input: RequestInfo | URL; init?: RequestInit }[] = [];
  const original: typeof fetch = async (input, init) => { calls.push({ input, init }); return new Response(bytes, { headers: { 'content-type': 'model/gltf-binary', 'content-encoding': 'br' } }); };
  const request = new Request('https://sim.eden.art/worlds/assets/model.glb', { headers: { authorization: 'test-fixture' }, credentials: 'include' });
  const response = await cdnFetch(original, manifest, 'https://assets.eden.art', page)(request);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, 'https://assets.eden.art/' + entry.key);
  assert.equal(calls[0].init?.credentials, 'omit');
  assert.equal(calls[0].init?.headers, undefined);
  assert.equal(response.headers.get('content-encoding'), null);
});

for (const failure of ['network', 'http', 'length', 'hash', 'body']) test(`${failure} error retries the exact original request`, async () => {
  const calls: (RequestInfo | URL)[] = [];
  const input = new Request('https://sim.eden.art/worlds/assets/model.glb');
  const init = { headers: { 'x-test': 'retained' } };
  const original: typeof fetch = async (url, options) => {
    calls.push(url);
    if (calls.length === 2) { assert.equal(url, input); assert.equal(options, init); return new Response('origin'); }
    if (failure === 'network') throw Error('offline');
    if (failure === 'http') return new Response('missing', { status: 404 });
    if (failure === 'length') return new Response('short');
    if (failure === 'hash') return new Response('x'.repeat(bytes.length));
    return new Response(new ReadableStream({ start(c) { c.error(Error('body failed')); } }));
  };
  const response = await cdnFetch(original, manifest, 'https://assets.eden.art', page)(input, init);
  assert.equal(await response.text(), 'origin');
  assert.equal(calls.length, 2);
});

test('CDN timeout covers streaming body and falls back; caller cancellation stops without retry', async () => {
  let calls = 0;
  const original: typeof fetch = async (_input, init) => {
    if (++calls === 2) return new Response('origin');
    return new Response(new ReadableStream({ start(c) { init?.signal?.addEventListener('abort', () => c.error(init.signal?.reason)); } }));
  };
  // The timer's unref behavior needs another pending handle in node's test process.
  const keepAlive = setTimeout(() => {}, 500);
  try {
    assert.equal(await (await cdnFetch(original, manifest, 'https://assets.eden.art', page, 10)('/worlds/assets/model.glb')).text(), 'origin');
    calls = 0;
    const abort = new AbortController();
    const task = cdnFetch(original, manifest, 'https://assets.eden.art', page)('/worlds/assets/model.glb', { signal: abort.signal });
    setTimeout(() => abort.abort(), 5);
    await assert.rejects(task, { name: 'AbortError' });
    assert.equal(calls, 1);
  } finally { clearTimeout(keepAlive); }
});

test('unmapped, range and non-GET requests retain their ordinary transport', async () => {
  const calls: (RequestInfo | URL)[] = [];
  const original: typeof fetch = async input => { calls.push(input); return new Response('origin'); };
  const wrapped = cdnFetch(original, manifest, 'https://assets.eden.art', page);
  await wrapped('/not-published.glb');
  await wrapped('/worlds/assets/model.glb', { method: 'POST' });
  await wrapped('/worlds/assets/model.glb', { headers: { range: 'bytes=0-2' } });
  assert.deepEqual(calls, ['/not-published.glb', '/worlds/assets/model.glb', '/worlds/assets/model.glb']);
});
