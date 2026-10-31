// Repo media (tools/assets): a pull-only object is publishable only when the committed asset manifest lists its key
// with the same sha256 and bytes. Offline: a stub stands in for R2.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CACHE, keyFor } from './inventory.mjs';
import { ENDPOINT, REPO_MEDIA, publish, repoMediaPlan } from './publish.mjs';

const credentials = { accessKeyId: 'SYNTHETIC_TEST_KEY', secretAccessKey: 'synthetic-secret' };
const body = Buffer.from('ID3 synthetic audio'), sha256 = createHash('sha256').update(body).digest('hex');

test('repo-media plans come from the asset manifest and publish without SOURCES.csv; unlisted objects are refused', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'repo-media-'));
  try {
    const key = keyFor(sha256, '.mp3');
    await mkdir(join(dir, 'snd')); await writeFile(join(dir, 'snd/a.mp3'), body);
    await writeFile(join(dir, 'list.tsv'), 'path\tbytes\nsnd/a.mp3\t1\n');
    const manifest = join(dir, 'manifest.json');
    await writeFile(manifest, JSON.stringify({ version: 1, files: [{ path: 'snd/a.mp3', sha256, bytes: body.length, url: `https://cdn.test/${key}`, set: 'web' }] }));
    const plan = await repoMediaPlan({ list: join(dir, 'list.tsv'), root: dir, assetManifest: manifest });
    assert.deepEqual(plan.objects.map(o => [o.key, o.licence, o.contentType, o.cacheControl]), [[key, REPO_MEDIA, 'audio/mpeg', CACHE]]);
    const stored = new Map(), calls = [];
    const fetcher = async (url, init) => {
      assert.ok(url.startsWith(ENDPOINT + '/')); calls.push(init.method);
      const k = new URL(url).pathname.split('/').slice(2).join('/');
      if (init.method === 'PUT') { stored.set(k, { body: init.body, headers: init.headers }); return new Response(null, { status: 200 }); }
      const s = stored.get(k); if (!s) return new Response(null, { status: 404 });
      const h = { 'content-length': String(s.body.length), 'content-type': s.headers['content-type'], 'cache-control': s.headers['cache-control'], 'x-amz-meta-sha256': s.headers['x-amz-meta-sha256'], 'x-amz-meta-licence': s.headers['x-amz-meta-licence'] };
      return new Response(init.method === 'HEAD' ? null : s.body, { status: 200, headers: h });
    };
    const result = await publish(plan, { credentials, fetcher, sources: join(dir, 'absent.csv'), assetManifest: manifest });
    assert.deepEqual([result.results[0].disposition, calls], ['uploaded', ['HEAD', 'PUT', 'GET']]);
    // the same object with other bytes, or one the manifest does not list, stops before any request
    const forged = { ...plan, objects: [{ ...plan.objects[0], bytes: body.length + 1 }] };
    await assert.rejects(publish(forged, { credentials, fetcher: () => assert.fail('no request'), sources: join(dir, 'absent.csv'), assetManifest: manifest }), /not in tools\/assets\/manifest.json/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
