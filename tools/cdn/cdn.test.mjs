import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { BR_PARAMS, CACHE, DEFAULT_SOURCES, ROOT, brKeyFor, brotli, encodedCopy, inventory, keyFor, licenceEvidence, parseCsv, readReviewed, readServed, shaFile } from './inventory.mjs';
import { brotliDecompressSync } from 'node:zlib';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { buildRecords, modularRecords } from './served-public.mjs';
import { ENDPOINT, loadCredentials, publish, signRequest, sigv4Headers } from './publish.mjs';
import { verify } from './verify.mjs';
import { withNewReceipt } from './receipt.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
const data = Buffer.from('synthetic GLB test asset'), sha256 = hash(data);
const credentials = { accessKeyId: 'SYNTHETIC_TEST_KEY', secretAccessKey: 'SYNTHETIC_TEST_SECRET' };
const object = { key: keyFor(sha256, '.glb'), sha256, bytes: data.length, contentType: 'model/gltf-binary', cacheControl: CACHE, licence: 'CC0-1.0' };
const objectHeaders = { 'content-length': String(data.length), 'content-type': object.contentType, 'cache-control': CACHE, 'x-amz-meta-sha256': sha256, 'x-amz-meta-licence': object.licence };
const publicHeaders = { ...objectHeaders, 'access-control-allow-origin': 'https://sim.eden.art', etag: '"fixture"' };
// The canonical licence evidence (SOURCES.csv) is private and lives outside the repo (EDEN_ASSETS_SOURCES).
const NO_SOURCES = existsSync(DEFAULT_SOURCES) ? false : 'needs the private SOURCES.csv (EDEN_ASSETS_SOURCES)';
async function fixture(fn) {
  const base = join(ROOT, '.local/cdn/tests'); await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, 'case-'));
  try {
    const file = join(dir, 'asset.glb'), sources = join(dir, 'SOURCES.csv');
    await writeFile(file, data); await writeFile(sources, `path,url,author,licence,date_utc,sha256,bytes,note\nfixture.glb,https://example.test/source,Fixture,CC0-1.0,2026-10-15,${sha256},${data.length},synthetic fixture\n`);
    return await fn({ dir, file, sources, plan: { version: 1, bucket: 'eden-assets', sources, objects: [{ ...object, file }] } });
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('CSV parsing preserves quoted provenance; licence approvals require exact hash and bytes', () => {
  const rows = parseCsv('path,licence,sha256,bytes,note\r\n"one,two",CC0-1.0,abc,12,"line 1\nline 2"\r\n');
  assert.equal(rows[0].path, 'one,two'); assert.equal(rows[0].note, 'line 1\nline 2');
  assert.equal(licenceEvidence(rows, 'abc', 12).licence, 'CC0-1.0');
  assert.equal(licenceEvidence(rows, 'abc', 13).licence, 'unknown');
  assert.match(licenceEvidence([...rows, { ...rows[0], licence: 'private' }], 'abc', 12).reason, /restricted/);
  assert.equal(licenceEvidence([{ path: 'x', licence: 'own work', sha256: 'abc', bytes: '12' }], 'abc', 12).licence, 'own-work');
});

test('dry-run inventory is network/credential independent, content-addressed, excludes unknowns and sidecars', async () => fixture(async ({ dir, sources }) => {
  const pub = join(dir, 'public'); await mkdir(pub);
  await writeFile(join(pub, 'allowed.glb'), data); await writeFile(join(pub, 'unknown.webp'), 'unknown'); await writeFile(join(pub, 'allowed.glb.br'), 'compressed');
  await writeFile(join(pub, '.eden-agent.json'), 'must never read this hidden file');
  await writeFile(join(pub, 'credentials.json'), 'must never read this named file');
  await mkdir(join(pub, '.hidden')); await writeFile(join(pub, '.hidden', 'asset.glb'), data);
  await mkdir(join(pub, 'secrets')); await writeFile(join(pub, 'secrets', 'asset.glb'), data);
  const plan = await inventory({ root: dir, sources, roots: [{ dir: pub, prefixes: ['/', '/worlds/'], pages: ['/w/eden', '/w/mars', '/w/littlemartians', '/worlds'] }], reviewed: { derivatives: [] } });
  assert.equal(plan.objects.length, 1); assert.equal(plan.manifest.assets['/allowed.glb'].key, object.key);
  assert.equal(plan.manifest.assets['/worlds/allowed.glb'].licence, 'CC0-1.0');
  assert.equal(plan.totals.candidateFiles, 2); assert.equal(plan.excluded.length, 2);
  const cli = spawnSync(process.execPath, [new URL('./publish.mjs', import.meta.url).pathname, '--dry-run', '--root', dir, '--sources', sources, '--out', join(dir, 'plan.json')], { encoding: 'utf8', env: { ...process.env, EDEN_ASSETS_CREDENTIALS: '/no/such/credentials' } });
  assert.equal(cli.status, 0, cli.stderr); assert.match(cli.stdout, /"dryRun":true/);
}));

test('only reviewed SHA-pinned core outputs receive runtime mesh aliases', async () => fixture(async ({ dir, sources }) => {
  const pub = join(dir, 'public'); await mkdir(pub); await writeFile(join(pub, 'model.glb'), data);
  const reviewed = { derivatives: [{ sha256, bytes: data.length, path: 'worlds/core-assets/packs/fixture.glb', licence: 'CC0-1.0' }], sources: {} };
  const plan = await inventory({ root: dir, sources, roots: [{ dir: pub, prefixes: ['/world-assets/'], pages: ['/worlds'] }], reviewed });
  assert.equal(plan.manifest.assets[`/assets/${sha256}.glb`].key, object.key);
  assert.equal(plan.manifest.assets[`/worlds/assets/${sha256}.glb`].key, object.key);
  assert.deepEqual(plan.objects[0].paths, [`/world-assets/model.glb`, `/assets/${sha256}.glb`, `/worlds/assets/${sha256}.glb`]);
  const direct = await inventory({ root: dir, sources, roots: [{ dir: pub, prefixes: ['/world-assets/'], pages: ['/worlds'] }], reviewed: { derivatives: [] } });
  assert.equal(direct.manifest.assets[`/assets/${sha256}.glb`], undefined);
}));

test('client manifest excludes unsupported file kinds even when upload licence is approved', async () => fixture(async ({ dir, sources }) => {
  const pub = join(dir, 'public'); await mkdir(pub);
  for (const ext of ['json', 'gltf', 'wasm', 'svg', 'glb', 'webp']) await writeFile(join(pub, `approved.${ext}`), data);
  const plan = await inventory({ root: dir, sources, roots: [{ dir: pub, prefixes: ['/'], pages: ['/worlds'] }], reviewed: { derivatives: [] } });
  assert.equal(plan.objects.length, 6);
  assert.deepEqual(Object.keys(plan.manifest.assets).sort(), ['/approved.glb', '/approved.webp']);
}));

test('reviewed CC0 derivatives require pinned output bytes and every source-family record', () => {
  const source = { path: 'raw/pack.zip', sha256: 'a'.repeat(64), bytes: 7, licence: 'CC0-1.0' };
  const reviewed = { derivatives: [{ ...object, path: 'output.glb', source: 'family' }], sources: { family: [source] } };
  assert.equal(licenceEvidence([source], sha256, data.length, reviewed).licence, 'CC0-1.0');
  assert.equal(licenceEvidence([], sha256, data.length, reviewed).licence, 'unknown');
  assert.equal(licenceEvidence([source], sha256, data.length + 1, reviewed).licence, 'unknown');
});

test('checked-in derivative allowlist pins exactly 96 current files and source chains', async () => {
  const reviewed = await readReviewed();
  assert.equal(reviewed.derivatives.length, 96); assert.equal(reviewed.derivatives.reduce((n, d) => n + d.bytes, 0), 3745692);
  for (const d of reviewed.derivatives) {
    const actual = await shaFile(new URL('../../' + d.path, import.meta.url));
    assert.deepEqual(actual, { sha256: d.sha256, bytes: d.bytes });
    assert.ok(reviewed.sources[d.source]?.length);
  }
});

test('the 20 reviewed lod1 records are exactly the CC0 lods, each from an approved CC0 model of the same family', async () => {
  const reviewed = await readReviewed();
  const raw = await readFile(new URL('../../worlds/core-assets/lods.index.json', import.meta.url));
  assert.equal(createHash('sha256').update(raw).digest('hex'), reviewed.lodsIndexSha256, 'lods.index.json changed: re-review the lod records');
  const lods = JSON.parse(raw.toString('utf8')).assets;
  const recorded = reviewed.derivatives.filter(d => d.path.startsWith('worlds/core-assets/lods/'));
  assert.equal(recorded.length, 20);
  assert.deepEqual(recorded.map(d => d.sha256).sort(), Object.keys(lods).filter(sha => lods[sha].license === 'CC0 1.0').sort());
  for (const d of recorded) {
    const parent = reviewed.derivatives.find(p => p.path === d.lodOf.path && p.sha256 === d.lodOf.sha256 && !p.lodOf);
    assert.ok(parent, `${d.path}: parent is not an approved model`);
    assert.equal(d.source, parent.source); assert.equal(d.licence, 'CC0-1.0');
    assert.equal(lods[d.sha256].source, `lod1 of ${parent.path} (${parent.sha256})`);
  }
});

test('CDN2: served-public.json is current and holds the 125 private lods, each pinned to its lod bytes', async () => {
  const served = await readServed();
  assert.deepEqual(served, await buildRecords(), 'stale: run node tools/cdn/served-public.mjs --write and review the diff');
  assert.equal(served.rule.date, '2026-10-20');
  const lods = JSON.parse(await readFile(new URL('../../worlds/core-assets/lods.index.json', import.meta.url), 'utf8')).assets;
  const records = served.objects.filter(r => r.path.startsWith('worlds/core-assets/lods/'));
  const priv = Object.entries(lods).filter(([, a]) => a.license !== 'CC0 1.0');
  assert.equal(priv.length, 125); assert.equal(records.length, 125);
  for (const [sha, a] of priv) {
    const r = records.find(x => x.sha256 === sha);
    assert.ok(r, `private lod ${a.name} has no record`);
    assert.deepEqual({ bytes: r.bytes, path: r.path, rights: r.rights, source: r.source }, { bytes: a.bytes, path: a.path, rights: a.license, source: a.source });
    assert.deepEqual(await shaFile(new URL('../../' + r.path, import.meta.url)), { sha256: sha, bytes: r.bytes });
  }
  const reviewed = await readReviewed();
  for (const r of served.objects) assert.ok(!reviewed.derivatives.some(d => d.sha256 === r.sha256), `${r.path}: CC0-reviewed bytes never need a served-public record`);
  assert.equal(licenceEvidence([], records[0].sha256, records[0].bytes, reviewed, served).licence, 'served-public');
  assert.equal(licenceEvidence([], records[0].sha256, records[0].bytes + 1, reviewed, served).licence, 'unknown');
});

test('CDN2: every /blobs/assets/ file the web client names has a BLOBS record and a manifest alias', async () => {
  const { readdir } = await import('node:fs/promises');
  const src = new URL('../../apps/web/src/', import.meta.url), named = new Set();
  for (const f of (await readdir(src, { recursive: true })).filter(f => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))) {
    for (const m of (await readFile(new URL(f, src), 'utf8')).matchAll(/\/blobs\/assets\/[0-9a-f]{2}\/[0-9a-f]{64}\.[a-z0-9]+/g)) named.add(m[0]);
  }
  const blobs = JSON.parse(await readFile(new URL('./served-blobs.json', import.meta.url), 'utf8')).objects;
  const manifest = JSON.parse(await readFile(new URL('../../apps/web/src/cdn-manifest.json', import.meta.url), 'utf8')).assets;
  assert.ok(named.size >= 3);
  for (const path of named) {
    const r = blobs.find(b => b.blob === path);
    assert.ok(r, `${path}: add it to served-blobs.json`);
    // CDN3: stored precompressed (q11 br) under assets/br/ when that saves >= 3%; the entry always names the decoded bytes.
    assert.deepEqual(manifest[path], { key: brKeyFor(r.sha256, '.glb'), sha256: r.sha256, bytes: r.bytes, licence: 'served-public' });
  }
});

test('hash aliases carry the bytes the origin route sends: a rendition under its source sha, marked `of`', async () => fixture(async ({ dir, sources }) => {
  const src = Buffer.from('source mesh'), ren = Buffer.from('smaller rendition'), plain = Buffer.from('plain mesh');
  const [s, r, p] = [src, ren, plain].map(hash);
  const core = join(dir, 'worlds/core-assets'); await mkdir(join(core, 'renditions'), { recursive: true });
  await writeFile(join(core, 'src.glb'), src); await writeFile(join(core, `renditions/${r}.glb`), ren); await writeFile(join(core, 'plain.glb'), plain);
  await writeFile(join(core, 'index.json'), JSON.stringify({ assets: { [s]: { ext: 'glb', path: 'worlds/core-assets/src.glb', license: 'private' }, [p]: { ext: 'glb', path: 'worlds/core-assets/plain.glb', license: 'private' } } }));
  await writeFile(join(core, 'renditions.json'), JSON.stringify({ schema: 'core-renditions/1', renditions: { [s]: { sha: r, path: `worlds/core-assets/renditions/${r}.glb` } } }));
  const reviewed = { derivatives: [], sources: {} };
  const served = await buildRecords(dir, reviewed);
  assert.deepEqual(served.objects.map(o => [o.path, o.renditionOf]), [['worlds/core-assets/plain.glb', undefined], [`worlds/core-assets/renditions/${r}.glb`, [s]]]);
  const plan = await inventory({ root: dir, sources, roots: [{ dir: join(dir, 'worlds'), prefixes: ['/world-assets/'], pages: ['/worlds'] }], reviewed, served });
  for (const prefix of ['/assets/', '/worlds/assets/']) {
    assert.deepEqual(plan.manifest.assets[`${prefix}${s}.glb`], { key: keyFor(r, '.glb'), sha256: r, bytes: ren.length, licence: 'served-public', of: s });
    assert.deepEqual(plan.manifest.assets[`${prefix}${p}.glb`], { key: keyFor(p, '.glb'), sha256: p, bytes: plain.length, licence: 'served-public' });
  }
  assert.equal(plan.manifest.assets[`/assets/${r}.glb`], undefined, 'the origin has no /assets route for a rendition sha');
  assert.equal(plan.objects.length, 2, 'the unserved source bytes are not uploaded');
}));

test('SigV4 signs immutable precondition, payload, date, target and metadata without leaking secret', () => {
  const signed = signRequest({ method: 'PUT', key: object.key, credentials, body: data, now: new Date('2026-10-15T00:01:02Z'), headers: { 'if-none-match': '*', 'content-type': object.contentType, 'cache-control': CACHE, 'x-amz-meta-sha256': sha256 } });
  assert.equal(signed.url, ENDPOINT + '/eden-assets/' + object.key);
  assert.equal(signed.headers['x-amz-date'], '20261015T000102Z'); assert.equal(signed.headers['x-amz-content-sha256'], sha256);
  assert.match(signed.headers.authorization, /Credential=SYNTHETIC_TEST_KEY\/20261015\/auto\/s3\/aws4_request/);
  assert.match(signed.headers.authorization, /SignedHeaders=cache-control;content-type;host;if-none-match;x-amz-content-sha256;x-amz-date;x-amz-meta-sha256/);
  assert.equal(JSON.stringify(signed).includes(credentials.secretAccessKey), false);
});

test('SigV4 matches an independently computed Python HMAC fixture with synthetic credentials', () => {
  // AWS S3 GET example request shape (sig-v4-header-based-auth.html), with our synthetic credentials.
  // Expected signature computed independently with Python hashlib/hmac and a literal canonical request.
  const signed = sigv4Headers({ url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'), method: 'GET', region: 'us-east-1', now: new Date('2013-05-24T00:00:00Z'), headers: { range: 'bytes=0-9' }, credentials });
  assert.match(signed.authorization, /Signature=e3a7f5a152b0fd618de99331394c593bfb63baed44c90c1e583d8fb8d4eebf01$/);
});

test('credential loader only accepts an owned mode0600 regular file with exact two fields (synthetic fixtures)', async () => fixture(async ({ dir }) => {
  const file = join(dir, 'synthetic-only.txt'); await writeFile(file, 'R2_ACCESS_KEY_ID=SYNTHETIC_TEST_KEY\nR2_SECRET_ACCESS_KEY=SYNTHETIC_TEST_SECRET\n', { mode: 0o600 });
  assert.deepEqual(await loadCredentials(file), credentials);
  await chmod(file, 0o644); await assert.rejects(loadCredentials(file), /mode 0600/);
  await chmod(file, 0o600); const link = join(dir, 'link'); await symlink(file, link); await assert.rejects(loadCredentials(link), /regular file/);
  await writeFile(file, 'R2_ACCESS_KEY_ID=x\nR2_SECRET_ACCESS_KEY=$(bad)\n'); await assert.rejects(loadCredentials(file), /invalid/);
  await assert.rejects(loadCredentials('relative'), /absolute/);
}));

test('new upload uses HEAD then conditional PUT and byte/SHA readback', async () => fixture(async ({ plan, sources }) => {
  const methods = [];
  const result = await publish(plan, { sources, credentials, fetcher: async (url, opts) => {
    methods.push(opts.method); assert.equal(opts.redirect, 'error'); assert.ok(url.startsWith(ENDPOINT));
    if (opts.method === 'HEAD') return new Response(null, { status: 404 });
    if (opts.method === 'PUT') { assert.equal(opts.headers['if-none-match'], '*'); assert.equal(opts.headers['cache-control'], CACHE); assert.equal(opts.headers['content-type'], object.contentType); assert.deepEqual(opts.body, data); return new Response(null); }
    return new Response(data, { headers: objectHeaders });
  } });
  assert.deepEqual(methods, ['HEAD', 'PUT', 'GET']); assert.equal(result.results[0].disposition, 'uploaded');
  assert.equal(result.sources, sources); assert.equal(result.sourcesSha256, hash(await readFile(sources)));
}));

test('a forged plan CSV cannot authorize an object; apply CLI rejects a sources override', { skip: NO_SOURCES }, async () => fixture(async ({ plan, sources, dir }) => {
  const canonicalRows = parseCsv(await readFile(DEFAULT_SOURCES, 'utf8'));
  assert.ok(licenceEvidence(canonicalRows, sha256, data.length).reason, 'synthetic fixture is absent from trusted sources');
  await assert.rejects(publish(plan, { credentials, fetcher: async () => assert.fail('forged CSV must not enable network access') }), /allowlisted SOURCES.csv/);
  const cli = spawnSync(process.execPath, [new URL('./publish.mjs', import.meta.url).pathname, '--apply', '--plan', join(dir, 'not-read.json'), '--sources', sources], { encoding: 'utf8', env: { ...process.env, EDEN_ASSETS_CREDENTIALS: '/no/such/credentials' } });
  assert.equal(cli.status, 1); assert.match(cli.stderr, /dry-run only/);
}));

test('publish uses canonical sources despite a forged or absent plan.sources and receipts its exact raw CSV hash', { skip: NO_SOURCES }, async () => fixture(async ({ plan, sources }) => {
  const reviewed = await readReviewed(), d = reviewed.derivatives[0];
  const file = new URL('../../' + d.path, import.meta.url), body = await readFile(file);
  const headers = { ...objectHeaders, 'content-length': String(d.bytes), 'x-amz-meta-sha256': d.sha256 };
  const objects = [{ ...object, key: keyFor(d.sha256, '.glb'), sha256: d.sha256, bytes: d.bytes, file }];
  for (const sourceField of [{ sources }, {}]) {
    const result = await publish({ version: 1, bucket: 'eden-assets', objects, ...sourceField }, { credentials, fetcher: async (_, opts) => new Response(opts.method === 'HEAD' ? null : body, { headers }) });
    assert.equal(result.sources, resolve(DEFAULT_SOURCES));
    assert.equal(result.sourcesSha256, hash(await readFile(DEFAULT_SOURCES)));
  }
}));

test('source receipt hash identifies the parsed snapshot even if a test source file changes during requests', async () => fixture(async ({ plan, sources }) => {
  const before = await readFile(sources); let calls = 0;
  const result = await publish(plan, { sources, credentials, fetcher: async (_, opts) => {
    if (++calls === 1) await writeFile(sources, 'path,licence,sha256,bytes\nchanged,private,x,1\n');
    return new Response(opts.method === 'HEAD' ? null : data, { headers: objectHeaders });
  } });
  assert.equal(result.sourcesSha256, hash(before));
  assert.notEqual(result.sourcesSha256, hash(await readFile(sources)));
}));

test('existing verified object is idempotent: HEAD+GET, zero PUTs', async () => fixture(async ({ plan, sources }) => {
  const methods = [];
  const result = await publish(plan, { sources, credentials, fetcher: async (_, opts) => { methods.push(opts.method); return new Response(opts.method === 'HEAD' ? null : data, { headers: objectHeaders }); } });
  assert.deepEqual(methods, ['HEAD', 'GET']); assert.equal(result.results[0].disposition, 'existing');
}));

test('metadata conflict, failed HEAD and corrupted readback never overwrite an existing object', async () => fixture(async ({ plan, sources }) => {
  for (const conflict of ['content-length', 'content-type', 'cache-control', 'x-amz-meta-sha256', 'x-amz-meta-licence']) {
    let calls = 0;
    await assert.rejects(publish(plan, { sources, credentials, fetcher: async () => { calls++; return new Response(null, { headers: { ...objectHeaders, [conflict]: 'different' } }); } }), /Refusing immutable overwrite/);
    assert.equal(calls, 1);
  }
  await assert.rejects(publish(plan, { sources, credentials, fetcher: async () => new Response(null, { status: 403 }) }), /HEAD failed \(403\)/);
  await assert.rejects(publish(plan, { sources, credentials, fetcher: async (_, opts) => new Response(opts.method === 'HEAD' ? null : 'corrupt', { headers: objectHeaders }) }), /Readback bytes\/SHA-256/);
}));

test('racing conditional PUT is verified rather than overwritten', async () => fixture(async ({ plan, sources }) => {
  const methods = []; let heads = 0;
  const result = await publish(plan, { sources, credentials, fetcher: async (_, opts) => {
    methods.push(opts.method);
    if (opts.method === 'HEAD') return heads++ === 0 ? new Response(null, { status: 404 }) : new Response(null, { headers: objectHeaders });
    if (opts.method === 'PUT') return new Response(null, { status: 412 });
    return new Response(data, { headers: objectHeaders });
  } });
  assert.deepEqual(methods, ['HEAD', 'PUT', 'HEAD', 'GET']); assert.equal(result.results[0].disposition, 'existing');
}));

test('changed bytes, changed licence and malformed content key are rejected before network access', async () => fixture(async ({ plan, file, sources }) => {
  const options = { sources, credentials, fetcher: async () => assert.fail('network must not be called') };
  await writeFile(file, 'changed'); await assert.rejects(publish(plan, options), /changed since dry-run/);
  await writeFile(file, data); await writeFile(sources, `path,licence,sha256,bytes\nx,private,${sha256},${data.length}\n`);
  await assert.rejects(publish(plan, options), /allowlisted SOURCES.csv/);
  await assert.rejects(publish({ ...plan, objects: [{ ...plan.objects[0], key: 'assets/00/wrong.glb' }] }, options), /Invalid/);
}));

test('public checker proves strict MISS then HIT with Age, app CORS and both byte hashes', async () => {
  const requests = [];
  const report = await verify('https://assets.example.test', { objects: [object] }, { wait: async () => {}, fetcher: async (_, opts) => {
    requests.push(opts); return new Response(data, { headers: { ...publicHeaders, 'cf-cache-status': requests.length === 1 ? 'MISS' : 'HIT', ...(requests.length > 1 ? { age: '1' } : {}) } });
  } });
  assert.equal(report.ok, true); assert.equal(requests.length, 2); assert.ok(requests.every(o => o.method === 'GET' && o.headers.Origin === 'https://sim.eden.art'));
});

test('public checker fails warm-only MISS proof, absent cache/CORS/Age, and corrupt bytes', async () => {
  const report = await verify('https://assets.example.test', { objects: [object] }, { wait: async () => {}, fetcher: async () => new Response('bad', { headers: { ...publicHeaders, 'access-control-allow-origin': 'https://wrong.test', 'cf-cache-status': 'HIT' } }) });
  assert.equal(report.ok, false); const errors = report.results[0].errors.join();
  assert.match(errors, /first request cache HIT/); assert.match(errors, /Age/); assert.match(errors, /CORS/); assert.match(errors, /SHA-256/);
  for (const origin of ['http://assets.example.test', 'https://user:pass@assets.example.test', 'https://assets.example.test/path']) await assert.rejects(verify(origin, { objects: [object] }), /bare HTTPS/);
});

test('receipts reserve a new file before operations and refuse existing files or symlinks', async () => fixture(async ({ dir }) => {
  const file = join(dir, 'receipt.json'), result = { ok: true, proof: 'synthetic' };
  assert.deepEqual(await withNewReceipt(file, async () => result), result);
  const original = await readFile(file, 'utf8');
  const link = join(dir, 'linked.json'), dangling = join(dir, 'dangling.json');
  await symlink(file, link); await symlink(join(dir, 'absent.json'), dangling);
  for (const target of [file, link, dangling]) await assert.rejects(withNewReceipt(target, async () => assert.fail('existing receipt must stop before work')), { code: 'EEXIST' });
  assert.equal(await readFile(file, 'utf8'), original);
}));

test('concurrent receipt reservations have one winner; failed attempts remain labelled and cannot be overwritten', async () => fixture(async ({ dir }) => {
  let calls = 0;
  const file = join(dir, 'race.json'), work = async () => { calls++; return { ok: true }; };
  const outcomes = await Promise.allSettled([withNewReceipt(file, work), withNewReceipt(file, work)]);
  assert.equal(calls, 1); assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
  const failed = join(dir, 'failed.json');
  await assert.rejects(withNewReceipt(failed, async () => { throw Error('synthetic upload failure'); }), /synthetic upload failure/);
  const receipt = JSON.parse(await readFile(failed, 'utf8'));
  assert.equal(receipt.ok, false); assert.equal(receipt.status, 'incomplete');
  await assert.rejects(withNewReceipt(failed, work), { code: 'EEXIST' });
}));

test('a replaced receipt pathname cannot be reported as saved or overwrite its replacement', async () => fixture(async ({ dir }) => {
  const file = join(dir, 'receipt.json');
  await assert.rejects(withNewReceipt(file, async () => {
    await rename(file, join(dir, 'reserved-original.json'));
    await writeFile(file, 'an earlier receipt moved here');
    return { ok: true };
  }), /Receipt path changed/);
  assert.equal(await readFile(file, 'utf8'), 'an earlier receipt moved here');
}));

test('both CLI commands refuse existing receipt paths before reading a plan or accessing credentials/network', async () => fixture(async ({ dir }) => {
  const receipt = join(dir, 'prior-receipt.json'); await writeFile(receipt, 'preserve this audit record');
  for (const [script, args] of [
    ['publish.mjs', ['--apply', '--plan', join(dir, 'absent-plan.json'), '--receipt', receipt]],
    ['verify.mjs', ['https://assets.example.test', join(dir, 'absent-plan.json'), '--out', receipt]],
  ]) {
    const cli = spawnSync(process.execPath, [new URL('./' + script, import.meta.url).pathname, ...args], { encoding: 'utf8', env: { ...process.env, EDEN_ASSETS_CREDENTIALS: '/no/such/credentials' } });
    assert.equal(cli.status, 1); assert.match(cli.stderr, /EEXIST/);
    assert.equal(await readFile(receipt, 'utf8'), 'preserve this audit record');
  }
}));

// ---- CDN3 (2026-10-20): precompressed q11 brotli objects and the /modular class ----
const glbish = Buffer.from(Array.from({ length: 400 }, (_, i) => `node_${i % 23} mesh primitive accessor ${i % 7};`).join('')), glbSha = hash(glbish);
async function brFixture(fn) {
  return fixture(async ctx => {
    const file = join(ctx.dir, 'big.glb'), cache = join(ctx.dir, 'br-cache');
    await writeFile(file, glbish);
    await writeFile(ctx.sources, `path,url,author,licence,date_utc,sha256,bytes,note\nfixture.glb,https://example.test/source,Fixture,CC0-1.0,2026-10-15,${sha256},${data.length},synthetic\nbig.glb,https://example.test/big,Fixture,CC0-1.0,2026-10-20,${glbSha},${glbish.length},synthetic compressible\n`);
    const pub = join(ctx.dir, 'public'); await mkdir(pub); await writeFile(join(pub, 'big.glb'), glbish); await writeFile(join(pub, 'small.glb'), data);
    const plan = await inventory({ root: ctx.dir, sources: ctx.sources, roots: [{ dir: pub, prefixes: ['/'], pages: [] }], reviewed: { derivatives: [] }, brotli: { cache } });
    return fn({ ...ctx, cache, plan, br: plan.objects.find(o => o.sha256 === glbSha) });
  });
}
const brHeaders = br => ({ 'content-length': String(br.encodedBytes), 'content-type': 'model/gltf-binary', 'cache-control': CACHE, 'content-encoding': 'br', 'x-amz-meta-sha256': br.sha256, 'x-amz-meta-encoded-sha256': br.encodedSha256, 'x-amz-meta-licence': 'CC0-1.0' });

test('CDN3: inventory stores compressible objects as q11 br under assets/br/, keeps incompressible ones identity', async () => brFixture(async ({ plan, br, cache }) => {
  assert.deepEqual(plan.brotli, { ...BR_PARAMS, minSaving: 0.03, cache });
  assert.equal(br.key, brKeyFor(glbSha, '.glb')); assert.equal(br.encoding, 'br'); assert.equal(br.bytes, glbish.length);
  const stored = await readFile(join(cache, `${glbSha}.q11w24.br`));
  assert.equal(stored.length, br.encodedBytes); assert.equal(hash(stored), br.encodedSha256); assert.deepEqual(brotliDecompressSync(stored), glbish);
  assert.deepEqual(stored, await brotli(glbish), 'deterministic q11 output');
  assert.ok(br.encodedBytes < glbish.length * 0.2);
  // The manifest names the decoded bytes; only the key changes.
  assert.deepEqual(plan.manifest.assets['/big.glb'], { key: br.key, sha256: glbSha, bytes: glbish.length, licence: 'CC0-1.0' });
  const small = plan.objects.find(o => o.sha256 === sha256);
  assert.equal(small.key, keyFor(sha256, '.glb')); assert.equal(small.encoding, undefined, '24 bytes do not compress: identity');
  assert.equal(plan.totals.brObjects, 1); assert.equal(plan.totals.storedBytes, br.encodedBytes + data.length);
  // A corrupt cache entry is rebuilt, never trusted.
  await writeFile(join(cache, `${glbSha}.q11w24.br`), 'garbage');
  assert.equal((await encodedCopy(br.file, glbSha, glbish.length, cache)).encodedSha256, br.encodedSha256);
}));

test('CDN3: publish PUTs the stored br bytes with Content-Encoding br and verifies the decoded readback', async () => brFixture(async ({ plan, br, sources }) => {
  const calls = [];
  const result = await publish({ ...plan, objects: [br] }, { sources, credentials, fetcher: async (url, opts) => {
    calls.push([opts.method, opts.headers['accept-encoding']]);
    if (opts.method === 'HEAD') return new Response(null, { status: 404 });
    if (opts.method === 'PUT') {
      assert.equal(opts.headers['content-encoding'], 'br'); assert.equal(opts.headers['x-amz-meta-sha256'], glbSha);
      assert.equal(opts.headers['x-amz-meta-encoded-sha256'], br.encodedSha256); assert.equal(opts.headers['x-amz-content-sha256'], br.encodedSha256, 'signed payload = stored bytes');
      assert.deepEqual(brotliDecompressSync(opts.body), glbish); assert.ok(url.includes('/assets/br/'));
      return new Response(null);
    }
    return new Response(glbish, { headers: brHeaders(br) });   // fetch hands back the decoded body
  } });
  assert.deepEqual(calls, [['HEAD', undefined], ['PUT', undefined], ['GET', 'br']]);
  assert.deepEqual(result.results[0], { key: br.key, disposition: 'uploaded', bytes: glbish.length, sha256: glbSha, encoding: 'br', encodedBytes: br.encodedBytes, encodedSha256: br.encodedSha256, verified: true });
  // An existing object without the encoding (or with the identity length) is a conflict, never overwritten.
  for (const conflict of [{ 'content-encoding': undefined }, { 'content-length': String(glbish.length) }, { 'x-amz-meta-encoded-sha256': 'x' }]) {
    const headers = Object.fromEntries(Object.entries({ ...brHeaders(br), ...conflict }).filter(([, v]) => v !== undefined));
    await assert.rejects(publish({ ...plan, objects: [br] }, { sources, credentials, fetcher: async () => new Response(null, { headers }) }), /Refusing immutable overwrite/);
  }
}));

test('CDN3: tampered precompressed plans fail before any request; --only publishes one reviewed key', async () => brFixture(async ({ plan, br, sources }) => {
  const options = { sources, credentials, fetcher: async () => assert.fail('network must not be called') };
  for (const bad of [{ encodedBytes: br.encodedBytes + 1 }, { encodedSha256: '0'.repeat(64) }, { key: keyFor(glbSha, '.glb') }, { encoding: 'gzip' }, { encodedBytes: glbish.length }]) {
    await assert.rejects(publish({ ...plan, objects: [{ ...br, ...bad }] }, options), /Brotli bytes differ|Invalid precompressed|Unknown object encoding/);
  }
  const identity = plan.objects.find(o => o.sha256 === sha256);
  await assert.rejects(publish({ ...plan, objects: [{ ...identity, key: brKeyFor(sha256, '.glb') }] }, options), /Invalid precompressed/);
  await assert.rejects(publish(plan, { ...options, only: ['assets/br/00/missing.glb'] }), /--only/);
  const keys = [];
  await publish(plan, { sources, credentials, only: [br.key], fetcher: async (url, opts) => { keys.push(url); return new Response(opts.method === 'HEAD' ? null : glbish, { headers: brHeaders(br) }); } });
  assert.ok(keys.length === 2 && keys.every(u => u.includes(br.key)));
}));

test('CDN3: Node fetch decodes a stored br response, so publish and verify hash the decoded file (real HTTP)', async () => brFixture(async ({ br }) => {
  const stored = await brotli(glbish);
  const server = createServer((req, res) => {
    const br = /\bbr\b/.test(req.headers['accept-encoding'] ?? '');
    res.writeHead(200, { 'content-type': 'model/gltf-binary', ...(br ? { 'content-encoding': 'br', 'content-length': stored.length } : { 'content-length': glbish.length }) });
    res.end(br ? stored : glbish);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    for (const ae of ['br', 'identity']) {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/x.glb`, { headers: { 'accept-encoding': ae } });
      const body = Buffer.from(await r.arrayBuffer());
      assert.equal(hash(body), br.sha256); assert.equal(body.length, br.bytes);
      assert.equal(r.headers.get('content-encoding'), ae === 'br' ? 'br' : null);
      if (ae === 'br') assert.equal(Number(r.headers.get('content-length')), stored.length);
    }
  } finally { server.close(); }
}));

test('CDN3: the checker asks br, br, Chrome\'s header, identity, gzip and requires br bytes for br and decoded bytes for the rest', async () => brFixture(async ({ br }) => {
  const make = (wrong) => { const seen = []; return { seen, fetcher: async (_, opts) => {
    const ae = opts.headers['Accept-Encoding']; seen.push(ae);
    const wantsBr = /\bbr\b/.test(ae), send = wrong === ae ? (wantsBr ? 'identity' : 'br') : (wantsBr ? 'br' : 'identity');
    const h = { ...publicHeaders, 'content-type': 'model/gltf-binary', 'cf-cache-status': seen.length === 1 ? 'MISS' : 'HIT', ...(seen.length > 1 ? { age: '3' } : {}), ...(send === 'br' ? { 'content-encoding': 'br', 'content-length': String(br.encodedBytes) } : { 'content-length': String(glbish.length) }) };
    return new Response(glbish, { headers: h });
  } }; };
  const ok = make(null), report = await verify('https://assets.example.test', { objects: [br] }, { wait: async () => {}, fetcher: ok.fetcher });
  assert.deepEqual(ok.seen, ['br', 'br', 'gzip, deflate, br, zstd', 'identity', 'gzip']); assert.equal(report.ok, true, JSON.stringify(report.results[0].errors));
  assert.deepEqual(report.results[0].requests.map(r => [r.acceptEncoding, r.contentEncoding, r.wireBytes]), [['br', 'br', br.encodedBytes], ['br', 'br', br.encodedBytes], ['gzip, deflate, br, zstd', 'br', br.encodedBytes], ['identity', null, glbish.length], ['gzip', null, glbish.length]]);
  const bad1 = await verify('https://assets.example.test', { objects: [br] }, { wait: async () => {}, fetcher: make('br').fetcher });
  assert.match(bad1.results[0].errors.join(), /br request: content-encoding none/);
  const bad2 = await verify('https://assets.example.test', { objects: [br] }, { wait: async () => {}, fetcher: make('identity').fetcher });
  assert.match(bad2.results[0].errors.join(), /identity request: got content-encoding br/);
}));

test('CDN3: /modular records carry the exact version queries the client requests, in both namespaces', async () => {
  const served = await readServed(), modular = served.objects.filter(r => r.class === 'modular');
  assert.deepEqual(modular, await modularRecords());
  const manifest = JSON.parse(await readFile(new URL('../../apps/web/src/cdn-manifest.json', import.meta.url), 'utf8')).assets;
  const wire = await readFile(new URL('../../mars/viewer/app/engine-view/character-wire.ts', import.meta.url), 'utf8');
  // The 11 files every world requests at arrival (CDN2 capture, 2026-10-20), with their live query strings.
  const arrival = ['animated-casual.mesh.glb?v=767b7c427cc6', 'animated-woman.mesh.glb?v=7cce8c4153ce', 'animated-punk.mesh.glb?v=3d971341fe35', 'clips-ual.glb?v=372246400b19', 'clips-ual-woman.glb?v=0b81be6416c1',
    'eden-boats-bikes.glb?v=imports-1', 'eden-animals.glb?v=imports-1', 'eden-crops.glb?v=imports-1', 'eden-nature.glb?v=imports-1', 'eden-food.glb?v=imports-1', 'eden-interior.glb?v=imports-1'];
  for (const f of arrival) for (const prefix of ['/modular/environment/', '/worlds/modular/environment/']) {
    const entry = manifest[prefix + f], r = modular.find(x => x.url === '/modular/environment/' + f.split('?')[0]);
    assert.ok(entry && r, `${prefix}${f} is not on the CDN`);
    assert.deepEqual([entry.sha256, entry.bytes, entry.licence], [r.sha256, r.bytes, 'served-public']);
    if (/[0-9a-f]{12}$/.test(f)) { assert.equal(f.split('=')[1], r.sha256.slice(0, 12), `${f}: query is the file's own sha prefix`); assert.ok(wire.includes(r.sha256)); }
  }
  assert.ok(modular.filter(r => r.url.startsWith('/modular/humanoid/')).length >= 200, 'the humanoid kit');
  for (const r of modular) assert.ok(manifest[r.url] && manifest['/worlds' + r.url], `${r.url}: bare name in both namespaces`);
});
