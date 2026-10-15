import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { CACHE, DEFAULT_SOURCES, inventory, keyFor, licenceEvidence, parseCsv, readReviewed, shaFile } from './inventory.mjs';
import { ENDPOINT, loadCredentials, publish, signRequest, sigv4Headers } from './publish.mjs';
import { verify } from './verify.mjs';
import { withNewReceipt } from './receipt.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
const data = Buffer.from('synthetic GLB test asset'), sha256 = hash(data);
const credentials = { accessKeyId: 'SYNTHETIC_TEST_KEY', secretAccessKey: 'SYNTHETIC_TEST_SECRET' };
const object = { key: keyFor(sha256, '.glb'), sha256, bytes: data.length, contentType: 'model/gltf-binary', cacheControl: CACHE, licence: 'CC0-1.0' };
const objectHeaders = { 'content-length': String(data.length), 'content-type': object.contentType, 'cache-control': CACHE, 'x-amz-meta-sha256': sha256, 'x-amz-meta-licence': object.licence };
const publicHeaders = { ...objectHeaders, 'access-control-allow-origin': 'https://sim.eden.art', etag: '"fixture"' };
async function fixture(fn) {
  const base = '<team>/scratch/cdn/tests'; await mkdir(base, { recursive: true });
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

test('checked-in derivative allowlist pins exactly 76 current files and source chains', async () => {
  const reviewed = await readReviewed();
  assert.equal(reviewed.derivatives.length, 76); assert.equal(reviewed.derivatives.reduce((n, d) => n + d.bytes, 0), 3337244);
  for (const d of reviewed.derivatives) {
    const actual = await shaFile(new URL('../../' + d.path, import.meta.url));
    assert.deepEqual(actual, { sha256: d.sha256, bytes: d.bytes });
    assert.ok(reviewed.sources[d.source]?.length);
  }
});

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

test('a forged plan CSV cannot authorize an object; apply CLI rejects a sources override', async () => fixture(async ({ plan, sources, dir }) => {
  const canonicalRows = parseCsv(await readFile(DEFAULT_SOURCES, 'utf8'));
  assert.ok(licenceEvidence(canonicalRows, sha256, data.length).reason, 'synthetic fixture is absent from trusted sources');
  await assert.rejects(publish(plan, { credentials, fetcher: async () => assert.fail('forged CSV must not enable network access') }), /allowlisted SOURCES.csv/);
  const cli = spawnSync(process.execPath, [new URL('./publish.mjs', import.meta.url).pathname, '--apply', '--plan', join(dir, 'not-read.json'), '--sources', sources], { encoding: 'utf8', env: { ...process.env, EDEN_ASSETS_CREDENTIALS: '/no/such/credentials' } });
  assert.equal(cli.status, 1); assert.match(cli.stderr, /dry-run only/);
}));

test('publish uses canonical sources despite a forged or absent plan.sources and receipts its exact raw CSV hash', async () => fixture(async ({ plan, sources }) => {
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
