// World-scoped publication: synthetic records and mocked HTTP only; no credential file or network access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { CACHE } from './inventory.mjs';
import { ENDPOINT, publish } from './publish.mjs';
import { LICENCE, ORIGIN, evidence, mergeManifest, plan, publishScoped, readRecords, scopedKey, validateRecords } from './world-scoped.mjs';
import { manifestAsset, readCdnManifest } from '../../apps/web/src/cdn-assets.ts';

const hash = data => createHash('sha256').update(data).digest('hex');
const credentials = { accessKeyId: 'SYNTHETIC_TEST_KEY', secretAccessKey: 'SYNTHETIC_TEST_SECRET' };
const campus = Buffer.from('synthetic campus bytes'), kin = Buffer.from('synthetic kin head');
const rights = { holder: 'Fixture holder', status: 'no open licence; private to this project', terms: 'fixture terms', record: 'fixture record' };
const object = (world, paths, data) => ({ world, paths, sha256: hash(data), bytes: data.length, localSource: null, derivation: 'fixture', referencedBy: ['fixture'], rights: { ...rights } });
const records = () => ({
  version: 1, schema: 'cdn-world-scoped/1', origin: ORIGIN,
  authorization: { ref: 'fixture', permits: 'fixture', whyWithinAuthority: 'fixture', preparedBy: 'test', preparedAt: '2026-10-16', reviewer: 'test' },
  worlds: {
    '/w/mars': { slug: 'mars', namespace: 'root', worldId: 'mars-2026-1', page: ORIGIN + '/w/mars', audience: 'public' },
    '/w/littlemartians': { slug: 'littlemartians', namespace: 'root', worldId: 'littlemartians-1', page: ORIGIN + '/w/littlemartians', audience: 'public' },
  },
  objects: [object('/w/mars', ['/browser/campus.glb?v=20260922b'], campus), object('/w/littlemartians', ['/world-assets/littlemartians/characters/kin/chebel.glb', '/world-assets/littlemartians/characters/chebel.glb'], kin)],
});

/** A public origin plus an in-memory R2 that honours conditional PUT and returns stored metadata. */
function world({ served = { '/browser/campus.glb?v=20260922b': campus, '/world-assets/littlemartians/characters/kin/chebel.glb': kin, '/world-assets/littlemartians/characters/chebel.glb': kin } } = {}) {
  const bucket = new Map(), calls = [];
  const fetcher = async (url, init = {}) => {
    const u = new URL(url), method = init.method ?? 'GET';
    calls.push(`${method} ${u.origin === ENDPOINT ? 'r2' : 'origin'} ${u.pathname}${u.search}`);
    if (u.origin === ORIGIN) {
      assert.equal(init.headers['accept-encoding'], 'identity');
      assert.equal(init.headers.authorization, undefined, 'served-URL evidence is public and unauthenticated');
      const body = served[u.pathname + u.search];
      return body ? new Response(body, { headers: { 'content-type': 'model/gltf-binary', etag: '"o"' } }) : new Response('not here', { status: 404 });
    }
    assert.equal(u.origin, ENDPOINT); assert.match(init.headers.authorization, /^AWS4-HMAC-SHA256 Credential=SYNTHETIC_TEST_KEY\//);
    const key = u.pathname, stored = bucket.get(key);
    if (method === 'PUT') {
      if (stored && init.headers['if-none-match'] === '*') return new Response(null, { status: 412 });
      bucket.set(key, { body: Buffer.from(init.body), headers: { 'content-length': String(init.body.length), ...Object.fromEntries(['content-type', 'cache-control', 'x-amz-meta-sha256', 'x-amz-meta-licence', 'x-amz-meta-world'].map(h => [h, init.headers[h]])) } });
      return new Response(null, { status: 200 });
    }
    if (!stored) return new Response(null, { status: 404 });
    return new Response(method === 'HEAD' ? null : stored.body, { status: 200, headers: stored.headers });
  };
  return { bucket, calls, fetcher };
}
const planned = async (r = records()) => plan({ records: r, now: new Date('2026-10-16T00:00:00Z') });

test('checked-in records validate: only world-scoped keys, own rights, live-release copies match', async () => {
  const real = validateRecords(await readRecords());
  const p = await plan({ records: real });
  assert.equal(p.totals.objects, 17);
  assert.ok(p.totals.byWorld['/w/mars'] > 100e6, 'the Mars campus is in scope');
  const shared = JSON.parse(await readFile(new URL('../../apps/web/src/cdn-manifest.json', import.meta.url), 'utf8'));
  const sharedKeys = new Set(Object.values(shared.assets).map(a => a.key));
  for (const o of p.objects) {
    assert.match(o.key, /^assets\/w\/(mars|littlemartians)\/[0-9a-f]{64}\.glb$/);
    assert.equal(o.licence, LICENCE); assert.ok(!sharedKeys.has(o.key));
    assert.doesNotMatch(o.rights.status, /^CC0/);
    if (o.local && o.local.available !== false) assert.equal(o.local.ok, true, o.local.file);
  }
  // The prepared world sections pass the real client reader and resolve only on their own world page.
  const client = readCdnManifest({ version: 1, assets: shared.assets, worlds: p.preparedManifest.worlds });
  assert.equal(manifestAsset(client, '/browser/campus.glb?v=20260922b', 'https://sim.eden.art/w/mars')?.bytes, 70772556);
  assert.equal(manifestAsset(client, '/browser/campus.glb?v=20260922b', 'https://sim.eden.art/w/eden'), undefined);
  assert.equal(manifestAsset(client, '/world-assets/littlemartians/characters/kin/chebel.glb', 'https://sim.eden.art/w/littlemartians')?.licence, LICENCE);
  assert.equal(manifestAsset(client, '/world-assets/littlemartians/characters/kin/chebel.glb', 'https://sim.eden.art/w/eden'), undefined);
});

test('records refuse open-licence relabelling, unreviewed worlds and mismatched paths', () => {
  const bad = (edit, why) => { const r = records(); edit(r); assert.throws(() => validateRecords(r), undefined, why); };
  bad(r => { r.objects[0].rights.status = 'CC0-1.0'; }, 'rights keep their own terms');
  bad(r => { r.objects[0].world = '/w/eden'; }, 'unreviewed world');
  bad(r => { r.objects[0].paths.push('/browser/campus.png'); }, 'one file type per object');
  bad(r => { r.objects[0].paths = ['https://other.test/campus.glb']; }, 'same-origin paths only');
  bad(r => { r.objects[0].paths = ['/browser/campus.glb#x']; }, 'no fragments');
  bad(r => { r.objects[1].paths.push(r.objects[1].paths[0]); }, 'duplicate path');
  bad(r => { delete r.objects[1].rights.terms; }, 'rights terms required');
  bad(r => { r.worlds['/w/mars'].page = ORIGIN + '/w/eden'; }, 'world page bound to its scope');
  bad(r => { r.origin = 'http://127.0.0.1:6140'; }, 'records name the live origin');
  bad(r => { delete r.authorization.reviewer; }, 'authorization needs a reviewer');
});

test('apply uploads exactly the served bytes under world-scoped keys with world metadata, then merge maps only them', async () => {
  const { bucket, calls, fetcher } = world();
  const p = await planned();
  const receipt = await publishScoped(p, { records: records(), credentials, fetcher });
  assert.equal(receipt.uploaded, 2); assert.equal(receipt.notServed, 0);
  const marsKey = scopedKey('/w/mars', hash(campus), '.glb');
  assert.deepEqual([...bucket.keys()].sort(), [`/eden-assets/${marsKey}`, `/eden-assets/${scopedKey('/w/littlemartians', hash(kin), '.glb')}`].sort());
  const stored = bucket.get(`/eden-assets/${marsKey}`);
  assert.deepEqual(stored.body, campus);
  assert.equal(stored.headers['x-amz-meta-licence'], 'world-scoped'); assert.equal(stored.headers['x-amz-meta-world'], '/w/mars');
  assert.equal(stored.headers['cache-control'], CACHE);
  // Evidence (public GET) precedes every R2 request for that object.
  assert.ok(calls.indexOf('GET origin /browser/campus.glb?v=20260922b') < calls.indexOf(`HEAD r2 /eden-assets/${marsKey}`));
  const mars = receipt.results.find(r => r.world === '/w/mars');
  assert.match(mars.evidence[0].at, /^\d{4}-\d\d-\d\dT/); assert.equal(mars.evidence[0].sha256, hash(campus));
  // A repeated run verifies and skips; nothing is overwritten.
  const again = await publishScoped(p, { records: records(), credentials, fetcher });
  assert.equal(again.existing, 2); assert.equal(again.uploaded, 0);
  const { manifest, added } = mergeManifest({ version: 1, assets: {} }, receipt, { records: records() });
  assert.equal(added, 3);
  const client = readCdnManifest(manifest);
  assert.equal(manifestAsset(client, '/world-assets/littlemartians/characters/chebel.glb', 'https://sim.eden.art/w/littlemartians')?.key, scopedKey('/w/littlemartians', hash(kin), '.glb'));
  assert.equal(manifestAsset(client, '/browser/campus.glb?v=20260922b', 'https://sim.eden.art/w/littlemartians'), undefined);
});

test('files the origin does not serve, or serves differently, are never uploaded or mapped', async () => {
  const { bucket, calls, fetcher } = world({ served: { '/browser/campus.glb?v=20260922b': Buffer.from('a different campus!!!!'), '/world-assets/littlemartians/characters/kin/chebel.glb': kin } });
  const receipt = await publishScoped(await planned(), { records: records(), credentials, fetcher });
  assert.equal(receipt.notServed, 1); assert.equal(receipt.uploaded, 1);
  assert.ok(!calls.some(c => c.includes('/assets/w/mars/')), 'no R2 request for an unserved object');
  const lm = receipt.results.find(r => r.world === '/w/littlemartians');
  assert.deepEqual(lm.paths, ['/world-assets/littlemartians/characters/kin/chebel.glb'], 'only the path that served the bytes');
  assert.equal(bucket.size, 1);
  const { manifest, added } = mergeManifest({ version: 1, assets: {} }, receipt, { records: records() });
  assert.equal(added, 1);
  assert.deepEqual(Object.keys(manifest.worlds), ['/w/littlemartians']);
  const report = await evidence(await planned(), { records: records(), fetcher });
  assert.equal(report.ok, false); assert.equal(report.results[0].served, false);
});

test('tampered plans and receipts stop before any request; shared publisher refuses scoped objects', async () => {
  const { calls, fetcher } = world();
  for (const edit of [o => { o.paths.push('/browser/other.glb'); }, o => { o.key = o.key.replace('/w/mars/', '/w/eden/'); }, o => { o.licence = 'CC0-1.0'; }, o => { o.bytes += 1; }, o => { o.world = '/w/littlemartians'; }]) {
    const p = await planned(); edit(p.objects[0]);
    await assert.rejects(publishScoped(p, { records: records(), credentials, fetcher }), /reviewed record|No world-scoped/);
  }
  const p = await planned(); p.origin = 'http://127.0.0.1:1';
  await assert.rejects(publishScoped(p, { records: records(), credentials, fetcher }));
  assert.equal(calls.length, 0);
  // Metadata conflict on an existing key is refused, never overwritten.
  const { fetcher: f2, bucket } = world();
  const key = `/eden-assets/${scopedKey('/w/mars', hash(campus), '.glb')}`;
  bucket.set(key, { body: campus, headers: { 'content-length': String(campus.length), 'content-type': 'model/gltf-binary', 'cache-control': CACHE, 'x-amz-meta-sha256': hash(campus), 'x-amz-meta-licence': 'world-scoped', 'x-amz-meta-world': '/w/eden' } });
  await assert.rejects(publishScoped(await planned(), { records: records(), credentials, fetcher: f2 }), /metadata differs/);
  // Merge needs served evidence for every mapped path and a live-origin receipt.
  const receipt = await publishScoped(await planned(), { records: records(), credentials, fetcher: world().fetcher });
  const forged = structuredClone(receipt); forged.results[1].paths.push('/world-assets/littlemartians/characters/other.glb');
  assert.throws(() => mergeManifest({ version: 1, assets: {} }, forged, { records: records() }), /served evidence/);
  assert.throws(() => mergeManifest({ version: 1, assets: {} }, { ...receipt, origin: 'http://127.0.0.1:1' }, { records: records() }), /receipt/);
  const scoped = (await planned()).objects[0];
  await assert.rejects(publish({ version: 1, bucket: 'eden-assets', objects: [{ ...scoped, file: '/dev/null', licence: 'CC0-1.0' }] }, { credentials, fetcher }), /Invalid or duplicate/);
});
