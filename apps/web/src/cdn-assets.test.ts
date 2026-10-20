import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cdnFetch, cdnOrigin, installCdnAssets, manifestAsset, pageWorld, readCdnManifest } from './cdn-assets.ts';

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
  // A rendition alias names its requested sha; only hash aliases may, and never with the delivered sha.
  const of = 'f'.repeat(64);
  assert.equal(readCdnManifest({ version: 1, assets: { [`/assets/${of}.glb`]: { ...entry, of, licence: 'served-public' } } }).assets[`/assets/${of}.glb`].sha256, sha256);
  assert.throws(() => readCdnManifest({ version: 1, assets: { [`/assets/${'e'.repeat(64)}.glb`]: { ...entry, of } } }), /Invalid CDN hash alias/);
  assert.throws(() => readCdnManifest({ version: 1, assets: { '/a.glb': { ...entry, of } } }), /rendition/);
  assert.throws(() => readCdnManifest({ version: 1, assets: { [`/assets/${sha256}.glb`]: { ...entry, of: sha256 } } }), /rendition/);
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
  // CDN1: the CC0 lod1 meshes (make.lod1, fetched by SHA like any core mesh) resolve too. CDN2 (Gene, 2026-10-20): so do
  // the private lods and every other core-set file the origin already serves by hash (served-public).
  const cowLod = '2d26b0ae1d8c726aba1d6f13c4c05712dbd4c728412334c7a03cac93ac4042e5';
  const minaretLod = '00e3310904d14f07bf29b30800e12f4b811fc55232f32a76a5525756afcb31d1'; // Little Martians
  for (const prefix of ['', '/worlds']) {
    assert.equal(manifestAsset(prepared, `${prefix}/w/eden/assets/${cowLod}.glb`, page)?.sha256, cowLod);
    assert.equal(manifestAsset(prepared, `${prefix}/w/littlemartians/assets/${minaretLod}.glb`, page)?.licence, 'served-public');
  }
  // A core mesh whose origin route sends a rendition maps to the rendition's bytes (what the origin delivers).
  const withRendition = Object.entries(prepared.assets).find(([path, a]) => a.of && path.startsWith('/assets/'));
  assert.ok(withRendition);
  assert.equal(manifestAsset(prepared, `/worlds/w/any-world/assets/${withRendition[1].of}.glb`, page)?.sha256, withRendition[1].sha256);
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

const scopedEntry = (world: string, ext = 'glb') => ({ key: `assets${world}/${sha256}.${ext}`, sha256, bytes: bytes.length, licence: 'world-scoped' });
const scoped = readCdnManifest({ version: 1, assets: { '/browser/campus.glb?v=shared': entry }, worlds: {
  '/w/mars': { '/browser/campus.glb?v=20260922b': scopedEntry('/w/mars'), [`/blobs/assets/${sha256.slice(0, 2)}/${sha256}.glb`]: scopedEntry('/w/mars') },
  '/worlds/w/mars': { [`/blobs/assets/${sha256.slice(0, 2)}/${sha256}.glb`]: scopedEntry('/worlds/w/mars') },
  '/w/littlemartians': { '/world-assets/littlemartians/characters/kin/chebel.glb': scopedEntry('/w/littlemartians') },
} });

test('world-scoped entries apply only on their own world page, by exact path and version query', () => {
  const campus = '/browser/campus.glb?v=20260922b', blob = `/blobs/assets/${sha256.slice(0, 2)}/${sha256}.glb`;
  assert.equal(pageWorld('https://sim.eden.art/w/mars?dev=1'), '/w/mars');
  assert.equal(pageWorld('https://sim.eden.art/worlds/w/mars/'), '/worlds/w/mars');
  assert.equal(pageWorld('https://sim.eden.art/'), undefined);
  assert.equal(manifestAsset(scoped, campus, 'https://sim.eden.art/w/mars?dev=1')?.key, `assets/w/mars/${sha256}.glb`);
  assert.equal(manifestAsset(scoped, blob, 'https://sim.eden.art/w/mars')?.key, `assets/w/mars/${sha256}.glb`);
  // The fork's page uses its own scope; it never inherits root Mars's legacy campus mapping.
  assert.equal(manifestAsset(scoped, blob, 'https://sim.eden.art/worlds/w/mars')?.key, `assets/worlds/w/mars/${sha256}.glb`);
  assert.equal(manifestAsset(scoped, campus, 'https://sim.eden.art/worlds/w/mars'), undefined);
  for (const page of ['https://sim.eden.art/w/eden', 'https://sim.eden.art/w/mars-two', 'https://sim.eden.art/', 'https://sim.eden.art/worlds/w/marsx']) {
    assert.equal(manifestAsset(scoped, campus, page), undefined, page);
    assert.equal(manifestAsset(scoped, blob, page), undefined, page);
  }
  assert.equal(manifestAsset(scoped, '/browser/campus.glb', 'https://sim.eden.art/w/mars'), undefined, 'query pins stay exact');
  assert.equal(manifestAsset(scoped, '/browser/campus.glb?v=other', 'https://sim.eden.art/w/mars'), undefined);
  assert.equal(manifestAsset(scoped, '/world-assets/littlemartians/characters/kin/chebel.glb', 'https://sim.eden.art/w/mars'), undefined);
  assert.equal(manifestAsset(scoped, '/world-assets/littlemartians/characters/kin/chebel.glb', 'https://sim.eden.art/w/littlemartians')?.licence, 'world-scoped');
  // Scoped hashes never become shared or dynamic /assets/<sha> aliases.
  assert.equal(manifestAsset(scoped, `/w/mars/assets/${sha256}.glb`, 'https://sim.eden.art/w/mars'), undefined);
  assert.equal(manifestAsset(scoped, `/assets/${sha256}.glb`, 'https://sim.eden.art/w/mars'), undefined);
  assert.equal(manifestAsset(scoped, '/browser/campus.glb?v=shared', 'https://sim.eden.art/w/eden'), entry, 'shared entries unchanged');
});

test('world-scoped manifest validation binds key, rights label and namespace', () => {
  const bad = (world: string, path: string, value: object) => assert.throws(() => readCdnManifest({ version: 1, assets: {}, worlds: { [world]: { [path]: value } } }), /Invalid/, JSON.stringify(value));
  bad('/w/mars', '/browser/campus.glb', { ...scopedEntry('/w/mars'), licence: 'CC0-1.0' });
  bad('/w/mars', '/browser/campus.glb', scopedEntry('/w/littlemartians'));
  bad('/w/mars', '/browser/campus.glb', scopedEntry('/worlds/w/mars'));
  bad('/w/mars', '/browser/campus.glb', entry);
  bad('/w/mars', '/browser/campus.glb', scopedEntry('/w/mars', 'png'));
  bad('/w/mars', '/browser/campus.gltf', scopedEntry('/w/mars', 'gltf'));
  bad('/w/Mars', '/browser/campus.glb', scopedEntry('/w/Mars'));
  bad('/x/w/mars', '/browser/campus.glb', scopedEntry('/x/w/mars'));
  bad('/w/mars', '//other.test/campus.glb', scopedEntry('/w/mars'));
  bad('/w/mars', '/browser/campus.glb', { ...scopedEntry('/w/mars'), key: `assets/w/mars/${'0'.repeat(64)}.glb` });
  assert.throws(() => readCdnManifest({ version: 1, assets: { '/a.glb': scopedEntry("/w/mars") } }), /Invalid/, "scoped rights never enter the shared catalogue");
  assert.throws(() => readCdnManifest({ version: 1, assets: {}, worlds: [] }));
  assert.deepEqual(Object.keys(readCdnManifest({ version: 1, assets: {} })), ['version', 'assets']);
});

test('a large CDN body that keeps moving outlasts the stall timeout and reports progress', async () => {
  const progress: number[] = [];
  const original: typeof fetch = async () => new Response(new ReadableStream({ async start(c) {
    for (const byte of bytes) { await new Promise(r => setTimeout(r, 3)); c.enqueue(new Uint8Array([byte])); }
    c.close();
  } }));
  // 22 chunks x 3 ms is well past a 20 ms total, but no single gap reaches it.
  const response = await cdnFetch(original, scoped, 'https://assets.eden.art', 'https://sim.eden.art/w/mars', 20, (url, loaded, total) => {
    assert.equal(url, '/browser/campus.glb?v=20260922b'); assert.equal(total, bytes.length); progress.push(loaded);
  })('/browser/campus.glb?v=20260922b');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.equal(progress.length, bytes.length);
  assert.equal(progress.at(-1), bytes.length);
});

test('a CDN body that stalls falls back to the exact origin request; an oversize body is rejected early', async () => {
  for (const body of ['stall', 'oversize']) {
    const calls: (RequestInfo | URL)[] = [];
    const original: typeof fetch = async (input, init) => {
      calls.push(input);
      if (calls.length === 2) return new Response('origin');
      return new Response(new ReadableStream({ start(c) {
        c.enqueue(body === 'oversize' ? new Uint8Array(bytes.length + 1) : bytes.slice(0, 4));
        init?.signal?.addEventListener('abort', () => c.error(init.signal?.reason));
      } }));
    };
    const keepAlive = setTimeout(() => {}, 500);
    try {
      const response = await cdnFetch(original, scoped, 'https://assets.eden.art', 'https://sim.eden.art/w/mars', 15)('/browser/campus.glb?v=20260922b');
      assert.equal(await response.text(), 'origin', body);
      assert.deepEqual(calls, [`https://assets.eden.art/assets/w/mars/${sha256}.glb`, '/browser/campus.glb?v=20260922b']);
    } finally { clearTimeout(keepAlive); }
  }
});

test('CDN3: precompressed br keys validate, still hash-bound; /modular resolves by exact version query', async () => {
  const brEntry = { ...entry, key: `assets/br/${sha256.slice(0, 2)}/${sha256}.glb` };
  const m = readCdnManifest({ version: 1, assets: { '/modular/environment/x.glb?v=abc': brEntry } });
  assert.equal(manifestAsset(m, '/modular/environment/x.glb?v=abc', page), brEntry);
  assert.equal(manifestAsset(m, '/modular/environment/x.glb?v=new', page), undefined);
  for (const key of [`assets/br/00/${sha256}.glb`, `assets/gz/${sha256.slice(0, 2)}/${sha256}.glb`, `assets/br/br/${sha256.slice(0, 2)}/${sha256}.glb`]) {
    assert.throws(() => readCdnManifest({ version: 1, assets: { '/a.glb': { ...entry, key } } }), /Invalid CDN key/);
  }
  // The browser decodes Content-Encoding br before the body reaches the transport: the check runs on the decoded bytes.
  const calls: string[] = [];
  const response = await cdnFetch(async (input) => { calls.push(String(input)); return new Response(bytes, { headers: { 'content-encoding': 'br' } }); }, m, 'https://assets.eden.art', page)('https://sim.eden.art/modular/environment/x.glb?v=abc');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.deepEqual(calls, ['https://assets.eden.art/' + brEntry.key]);
  const prepared = readCdnManifest(JSON.parse(readFileSync(new URL('./cdn-manifest.json', import.meta.url), 'utf8')));
  for (const prefix of ['', '/worlds']) {
    const mesh = manifestAsset(prepared, `${prefix}/modular/environment/animated-casual.mesh.glb?v=767b7c427cc6`, page);
    assert.equal(mesh?.sha256.slice(0, 12), '767b7c427cc6'); assert.match(mesh!.key, /^assets\/br\//);
  }
});

test('CDN4: a god upload the snapshot sized maps to the pull-through Worker, only on its own /worlds world page', async () => {
  const { noteUploadSizes, clearUploadSizesForTest, UPLOAD_MAX_BYTES } = await import('./cdn-assets.ts');
  const up = createHash('sha256').update('a god upload').digest('hex'), other = 'e'.repeat(64);
  const own = 'https://sim.eden.art/worlds/w/bench-hamlet/', path = `/worlds/w/bench-hamlet/assets/${up}.glb`;
  assert.equal(manifestAsset(manifest, path, own), undefined, 'unsized: origin');
  noteUploadSizes({ [up]: 12, [other]: UPLOAD_MAX_BYTES + 1, nothex: 5, ['f'.repeat(64)]: 0 } as Record<string, number>);
  assert.deepEqual(manifestAsset(manifest, path, own), { key: `w/bench-hamlet/assets/${up}.glb`, sha256: up, bytes: 12, licence: 'god-upload' });
  assert.equal(manifestAsset(manifest, `https://sim.eden.art${path}`, own)?.key, `w/bench-hamlet/assets/${up}.glb`);
  for (const [url, pageUrl, why] of [
    [path, 'https://sim.eden.art/worlds/w/other-world/', 'another world page'],
    [path, 'https://sim.eden.art/w/bench-hamlet', 'a legacy root page'],
    [`/w/bench-hamlet/assets/${up}.glb`, 'https://sim.eden.art/w/bench-hamlet', 'legacy root worlds serve no uploads'],
    [`${path}?v=1`, own, 'a query'],
    [`/worlds/w/bench-hamlet/assets/${up}.png`, own, 'not a GLB'],
    [`/worlds/w/bench-hamlet/assets/${other}.glb`, own, 'over the cap'],
    [`https://other.test${path}`, own, 'cross-origin'],
  ] as const) assert.equal(manifestAsset(manifest, url, pageUrl), undefined, why);
  // A manifest entry for the same sha wins (core set, renditions); the upload route is only the fallback.
  const core = readCdnManifest({ version: 1, assets: { [`/worlds/assets/${sha256}.glb`]: entry } });
  noteUploadSizes({ [sha256]: bytes.length });
  assert.equal(manifestAsset(core, `/worlds/w/bench-hamlet/assets/${sha256}.glb`, own), entry);

  // The transport: exact bytes + sha in, else the exact original request.
  const body = new TextEncoder().encode('a god upload');
  noteUploadSizes({ [up]: body.length });
  const calls: string[] = [];
  const ok: typeof fetch = async (input) => { calls.push(String(input)); return new Response(body); };
  const r = await cdnFetch(ok, manifest, 'https://assets.eden.art', own)(`https://sim.eden.art${path}`);
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), body);
  assert.deepEqual(calls, [`https://assets.eden.art/w/bench-hamlet/assets/${up}.glb`]);
  for (const bad of [new Response('x'.repeat(body.length)), new Response('not deployed', { status: 404 }), new Response(body.slice(1))]) {
    const seen: string[] = [];
    const f: typeof fetch = async (input) => { seen.push(String(input)); return seen.length === 1 ? bad : new Response('origin'); };
    assert.equal(await (await cdnFetch(f, manifest, 'https://assets.eden.art', own)(`https://sim.eden.art${path}`)).text(), 'origin');
    assert.deepEqual(seen, [`https://assets.eden.art/w/bench-hamlet/assets/${up}.glb`, `https://sim.eden.art${path}`]);
  }
  // ?godcdn=0 turns the route off at run time.
  const loc = globalThis.location;
  (globalThis as { location: unknown }).location = new URL(`${own}?godcdn=0`);
  try { assert.equal(manifestAsset(manifest, path, own), undefined); } finally { (globalThis as { location: unknown }).location = loc; }
  clearUploadSizesForTest();
  assert.equal(manifestAsset(manifest, path, own), undefined);
});
