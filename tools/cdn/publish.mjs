#!/usr/bin/env node
// Immutable publishing, ported from db11f401 tools/blobs/cdn-upload.mjs.
// Dry-run is the default and never reads credentials or contacts any server.
import { createHash, createHmac } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ALLOWED_LICENCES, BR_EXTENSIONS, CACHE, DEFAULT_BR_CACHE, DEFAULT_SOURCES, ROOT, TYPES, encodedCopy, inventory, isBrKey, licenceEvidence, parseCsv, readReviewed, readServedAll, shaFile, validKey } from './inventory.mjs';
import { withNewReceipt } from './receipt.mjs';
import { deployEnv } from '../world-launcher/deploy/deploy-env.mjs';

// The R2 S3 endpoint of the Cloudflare account that owns the bucket: CF_ACCOUNT_ID in the environment or deploy.env.
// Unset, ENDPOINT is a stand-in (tests and dry runs need no account) and a real --apply stops before any request.
const ACCOUNT = /^[0-9a-f]{32}$/.test(deployEnv('CF_ACCOUNT_ID') ?? '') ? deployEnv('CF_ACCOUNT_ID') : null;
export const ENDPOINT = `https://${ACCOUNT ?? 'cf-account-id-unset'}.r2.cloudflarestorage.com`;
export function requireAccount() {
  if (!ACCOUNT) throw Error('Set CF_ACCOUNT_ID (the 32-hex Cloudflare account id) in the environment or deploy.env (template: deploy.env.example)');
}
// Repo media (tools/assets): pull-only objects for files that left git. Their evidence is the committed asset manifest
// (path, sha256, bytes, url), never the plan; they never enter the client cdn-manifest.json.
export const REPO_MEDIA = 'repo-media';
export const ASSET_MANIFEST = resolve(ROOT, 'tools/assets/manifest.json');
const REPO_MEDIA_TYPES = { ...TYPES, '.mp3': 'audio/mpeg', '.gz': 'application/gzip' };
async function readAssetManifest(file = ASSET_MANIFEST) {
  const m = JSON.parse(await readFile(file, 'utf8')), byKey = new Map();
  for (const f of m.files) if (f.url) byKey.set(new URL(f.url).pathname.slice(1), f);
  return byKey;
}
export const BUCKET = 'eden-assets';
export const SCOPED_KEY = /^assets(?:\/worlds)?\/w\/[a-z][a-z0-9-]{0,31}\/[0-9a-f]{64}\.[a-z0-9]+$/;
const sha = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
const enc = value => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export async function loadCredentials(file = process.env.EDEN_ASSETS_CREDENTIALS) {
  if (!file || !isAbsolute(file)) throw Error('Set EDEN_ASSETS_CREDENTIALS to the absolute path of a mode-0600 credential file');
  const info = await lstat(file);
  if (info.isSymbolicLink() || !info.isFile() || (info.mode & 0o777) !== 0o600 || info.uid !== process.getuid() || info.nlink !== 1) throw Error('Credential file must be a single-link regular file owned by this user, mode 0600');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (opened.ino !== info.ino || opened.dev !== info.dev || !opened.isFile() || (opened.mode & 0o777) !== 0o600 || opened.uid !== process.getuid() || opened.nlink !== 1 || opened.size > 16_384) throw Error('Credential file changed while opening or exceeds the size limit');
    const values = {};
    for (const line of (await handle.readFile('utf8')).split(/\r?\n/).filter(Boolean)) {
      const m = /^(R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY)=([A-Za-z0-9+/=_-]+)$/.exec(line);
      if (!m || values[m[1]]) throw Error('Credential file has invalid or duplicate fields');
      values[m[1]] = m[2];
    }
    if (!values.R2_ACCESS_KEY_ID || !values.R2_SECRET_ACCESS_KEY) throw Error('Credential file requires the two R2 key fields');
    return { accessKeyId: values.R2_ACCESS_KEY_ID, secretAccessKey: values.R2_SECRET_ACCESS_KEY };
  } finally { await handle.close(); }
}

export function sigv4Headers({ url, method, credentials, body = Buffer.alloc(0), headers = {}, now = new Date(), region = 'auto' }) {
  const time = now.toISOString().replace(/[-:]|\.\d{3}/g, ''), day = time.slice(0, 8), scope = `${day}/${region}/s3/aws4_request`;
  const signed = Object.fromEntries(Object.entries({ ...headers, host: url.host, 'x-amz-date': time, 'x-amz-content-sha256': sha(body) }).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')]));
  const keys = Object.keys(signed).sort(), signedHeaders = keys.join(';');
  const canonical = [method, url.pathname, '', keys.map(k => `${k}:${signed[k]}\n`).join(''), signedHeaders, signed['x-amz-content-sha256']].join('\n');
  const string = ['AWS4-HMAC-SHA256', time, scope, sha(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(string).digest('hex');
  signed.authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return signed;
}
export function signRequest({ method, key, credentials, body = Buffer.alloc(0), headers = {}, now = new Date() }) {
  // Shared catalogue keys, or world-scoped keys bound to one world page namespace (world-scoped.mjs).
  if (!/^assets\/(?:br\/)?[0-9a-f]{2}\/[0-9a-f]{64}\.[a-z0-9]+$/.test(key) && !SCOPED_KEY.test(key)) throw Error('Invalid immutable key');
  const url = new URL(`/${BUCKET}/${key.split('/').map(enc).join('/')}`, ENDPOINT);
  return { url: url.href, headers: sigv4Headers({ url, method, credentials, body, headers, now }) };
}

// A precompressed object (CDN3) stores its q11 brotli bytes: Content-Length is the encoded size, Content-Encoding br,
// x-amz-meta-sha256 the decoded file's hash (what fetch hands the client) and x-amz-meta-encoded-sha256 the stored bytes'.
const isBr = object => object.encoding === 'br';
function metadataErrors(response, object) {
  const h = response.headers, errors = [], br = isBr(object);
  for (const [header, expected] of [['content-length', String(br ? object.encodedBytes : object.bytes)], ['content-type', object.contentType], ['cache-control', CACHE], ['content-encoding', br ? 'br' : null], ['x-amz-meta-sha256', object.sha256], ['x-amz-meta-encoded-sha256', br ? object.encodedSha256 : null], ['x-amz-meta-licence', object.licence]]) {
    if (h.get(header) !== expected) errors.push(header);
  }
  return errors;
}
/** The exact bytes to store: the file itself, or its q11 brotli copy, which must be the plan's encoded bytes and decode
 *  to the plan's sha256 (encodedCopy checks the round trip). */
async function storedBody(object, brCache) {
  if (!isBr(object)) {
    const body = await readFile(object.file);
    if (body.length !== object.bytes || sha(body) !== object.sha256) throw Error('Local asset changed before PUT');
    return body;
  }
  const { encoded, encodedBytes, encodedSha256 } = await encodedCopy(object.file, object.sha256, object.bytes, brCache);
  if (encodedBytes !== object.encodedBytes || encodedSha256 !== object.encodedSha256) throw Error(`Brotli bytes differ from the dry run for ${object.key} (another brotli build?); redo the dry run on this machine`);
  return encoded;
}

/** `only`: publish just these keys of the reviewed plan (the release owner's one-object live test). */
export async function publish(plan, { sources = DEFAULT_SOURCES, credentials, fetcher = fetch, now, onProgress = () => {}, brCache, only, assetManifest = ASSET_MANIFEST } = {}) {
  if (plan.version !== 1 || plan.bucket !== BUCKET || !Array.isArray(plan.objects) || !plan.objects.length) throw Error('No approved immutable objects in this plan');
  // A plan is untrusted input. Only direct function callers (tests) can override the trusted licence source.
  // A repo-media-only plan needs no SOURCES.csv: its evidence is the committed asset manifest.
  const needsSources = plan.objects.some(o => o.licence !== REPO_MEDIA);
  const sourceBytes = needsSources ? await readFile(sources) : Buffer.alloc(0), sourcesSha256 = sha(sourceBytes);
  const rows = needsSources ? parseCsv(sourceBytes.toString('utf8')) : [], reviewed = await readReviewed(), served = await readServedAll(), results = [], seen = new Set();
  const assets = plan.objects.some(o => o.licence === REPO_MEDIA) ? await readAssetManifest(assetManifest) : null;
  // Validate every object before making the first network request.
  // The dry run's brotli cache: its entries are only used after they decode to the plan's sha256 and match its encoded sha.
  brCache ??= typeof plan.brotli?.cache === 'string' && isAbsolute(plan.brotli.cache) ? plan.brotli.cache : DEFAULT_BR_CACHE;
  const objects = only ? plan.objects.filter(o => only.includes(o.key)) : plan.objects;
  if (only && objects.length !== new Set(only).size) throw Error('--only names a key that is not in the plan');
  for (const object of objects) {
    const ext = '.' + object.key.split('.').at(-1), br = isBr(object), repo = object.licence === REPO_MEDIA;
    if (!validKey(object.key, object.sha256) || seen.has(object.key) || object.contentType !== (repo ? REPO_MEDIA_TYPES : TYPES)[ext] || object.cacheControl !== CACHE || !(repo || ALLOWED_LICENCES.has(object.licence))) throw Error('Invalid or duplicate immutable object in plan');
    if (object.encoding !== undefined && !br) throw Error('Unknown object encoding in plan');
    if (br !== isBrKey(object.key) || (br && (!BR_EXTENSIONS.has(ext) || !Number.isSafeInteger(object.encodedBytes) || object.encodedBytes < 1 || object.encodedBytes >= object.bytes || !/^[0-9a-f]{64}$/.test(object.encodedSha256 ?? '')))) throw Error('Invalid precompressed object in plan');
    seen.add(object.key);
    if (repo) {
      const entry = assets.get(object.key);
      if (!entry || entry.sha256 !== object.sha256 || entry.bytes !== object.bytes) throw Error(`Repo-media object is not in tools/assets/manifest.json with this sha256/bytes: ${object.key}`);
    } else {
      const evidence = licenceEvidence(rows, object.sha256, object.bytes, reviewed, served);
      if (evidence.reason || evidence.licence !== object.licence) throw Error('Object no longer has exact allowlisted SOURCES.csv, reviewed or served-public evidence');
    }
    const digest = await shaFile(object.file);
    if (digest.sha256 !== object.sha256 || digest.bytes !== object.bytes) throw Error('Local asset changed since dry-run');
    if (br) await storedBody(object, brCache);   // the exact br bytes exist (or rebuild identically) before any request
  }
  if (fetcher === fetch) requireAccount();
  if (!credentials) credentials = await loadCredentials();
  const request = async (method, object, body, headers = {}, unsigned = {}) => {
    const signed = signRequest({ method, key: object.key, credentials, body, headers, now });
    return fetcher(signed.url, { method, headers: { ...signed.headers, ...unsigned }, ...(body ? { body } : {}), redirect: 'error', signal: AbortSignal.timeout(180_000) });
  };
  for (const object of objects) {
    let disposition = 'existing';
    const head = await request('HEAD', object);
    if (head.status === 404) {
      // Rechecked after reading, so a changed source can never be uploaded under an old hash.
      const body = await storedBody(object, brCache);
      const put = await request('PUT', object, body, { 'if-none-match': '*', 'content-type': object.contentType, 'cache-control': CACHE, ...(isBr(object) ? { 'content-encoding': 'br', 'x-amz-meta-encoded-sha256': object.encodedSha256 } : {}), 'x-amz-meta-sha256': object.sha256, 'x-amz-meta-licence': object.licence });
      if (put.status === 412) { // A racing publisher won. Verify it; never overwrite.
        const raced = await request('HEAD', object);
        if (raced.status !== 200 || metadataErrors(raced, object).length) throw Error(`Immutable key conflict after racing PUT: ${object.key}`);
      } else if (!put.ok) throw Error(`PUT failed (${put.status}) for ${object.key}`);
      else disposition = 'uploaded';
      await put.body?.cancel();
    } else if (head.status !== 200) throw Error(`HEAD failed (${head.status}) for ${object.key}`);
    else if (metadataErrors(head, object).length) throw Error(`Refusing immutable overwrite: metadata differs (${metadataErrors(head, object).join(', ')}) for ${object.key}`);
    // fetch decodes Content-Encoding, so the readback stream is the decoded file for both kinds; the headers above pin the
    // stored size and encoding. Ask for br explicitly so no hop has a reason to transform it.
    const readback = await request('GET', object, undefined, {}, { 'accept-encoding': isBr(object) ? 'br' : 'identity' });
    if (readback.status !== 200 || metadataErrors(readback, object).length) throw Error(`Readback metadata failed for ${object.key}`);
    const hash = createHash('sha256'); let bytes = 0;
    for await (const chunk of readback.body) { bytes += chunk.length; hash.update(chunk); }
    if (bytes !== object.bytes || hash.digest('hex') !== object.sha256) throw Error(`Readback bytes/SHA-256 differ for ${object.key}`);
    const result = { key: object.key, disposition, bytes, sha256: object.sha256, ...(isBr(object) ? { encoding: 'br', encodedBytes: object.encodedBytes, encodedSha256: object.encodedSha256 } : {}), verified: true };
    results.push(result); onProgress(result);
  }
  return { version: 1, at: new Date().toISOString(), bucket: BUCKET, sources: resolve(sources), sourcesSha256, ok: true, results };
}

/** Dry run for repo media: the listed paths (first TSV column, header `path`) of a tree that still has the files
 *  (a checkout from before the media left git). Each must match its tools/assets/manifest.json entry; the key is the
 *  entry's url, precompressed (q11 brotli, stored with Content-Encoding br) when that key is under assets/br/. */
export async function repoMediaPlan({ list, root, assetManifest = ASSET_MANIFEST, brCache = DEFAULT_BR_CACHE }) {
  const m = JSON.parse(await readFile(assetManifest, 'utf8')), byPath = new Map(m.files.map(f => [f.path, f]));
  const paths = (await readFile(list, 'utf8')).split(/\r?\n/).slice(1).map(l => l.split('\t')[0]).filter(Boolean);
  const objects = [], seen = new Set();
  for (const path of paths) {
    const f = byPath.get(path);
    if (!f?.url) throw Error(`${path}: not a file entry of ${assetManifest}`);
    const key = new URL(f.url).pathname.slice(1), file = resolve(root, path);
    if (seen.has(key)) continue;
    const digest = await shaFile(file);
    if (digest.sha256 !== f.sha256 || digest.bytes !== f.bytes) throw Error(`${path}: ${file} is not the manifest's bytes`);
    const ext = '.' + key.split('.').at(-1), object = { key, file, sha256: f.sha256, bytes: f.bytes, contentType: REPO_MEDIA_TYPES[ext], cacheControl: CACHE, licence: REPO_MEDIA, path };
    if (!object.contentType || !validKey(key, f.sha256)) throw Error(`${path}: no content type or invalid key ${key}`);
    if (isBrKey(key)) {
      const { encodedBytes, encodedSha256 } = await encodedCopy(file, f.sha256, f.bytes, brCache);
      if (encodedBytes >= f.bytes) throw Error(`${path}: brotli does not shrink it; give it an identity key in the manifest`);
      Object.assign(object, { encoding: 'br', encodedBytes, encodedSha256 });
    }
    seen.add(key); objects.push(object);
  }
  if (!objects.length) throw Error(`no paths listed in ${list}`);
  return { version: 1, bucket: BUCKET, repoMedia: true, brotli: { cache: brCache }, objects, totals: { objects: objects.length, bytes: objects.reduce((s, o) => s + o.bytes, 0) } };
}

async function main() {
  const args = process.argv.slice(2), value = (key, fallback) => { const i = args.indexOf(key); if (i < 0) return fallback; if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error(`Missing value for ${key}`); return args[i + 1]; };
  const allowed = new Set(['--apply', '--dry-run', '--out', '--manifest', '--root', '--sources', '--plan', '--receipt', '--only', '--identity', '--base', '--repo-media']);
  for (const arg of args.filter(a => a.startsWith('--'))) if (!allowed.has(arg)) throw Error(`Unknown option ${arg}`);
  if (args.includes('--apply') && args.includes('--dry-run')) throw Error('Choose --dry-run or --apply');
  if (args.includes('--apply')) {
    if (args.includes('--sources')) throw Error('--sources is dry-run only; publishing always uses DEFAULT_SOURCES');
    const file = value('--plan'); if (!file) throw Error('--apply requires the reviewed --plan file');
    const receipt = resolve(value('--receipt', 'cdn-upload-receipt.json'));
    const only = value('--only') ? value('--only').split(',') : undefined;
    const result = await withNewReceipt(receipt, async () => publish(JSON.parse(await readFile(file, 'utf8')), { only, onProgress: result => console.log(JSON.stringify(result)) }));
    console.log(JSON.stringify({ ok: true, objects: result.results.length, receipt }));
  } else if (args.includes('--repo-media')) {
    // node tools/cdn/publish.mjs --dry-run --repo-media <list.tsv> --root <tree with the files> --out <plan.json>
    const root = value('--root'); if (!root) throw Error('--repo-media needs --root <tree that still has the files>');
    const plan = await repoMediaPlan({ list: value('--repo-media'), root: resolve(root) }), out = resolve(value('--out', 'cdn-repo-media-plan.json'));
    await writeFile(out, JSON.stringify(plan, null, 2) + '\n');
    console.log(JSON.stringify({ dryRun: true, repoMedia: true, ...plan.totals, out }));
  } else {
    const root = resolve(value('--root', ROOT)), sources = resolve(value('--sources', DEFAULT_SOURCES));
    // --identity: CDN1/CDN2-style plan without precompressed objects.
    const plan = await inventory({ root, sources, ...(args.includes('--identity') ? { brotli: false } : {}) }), out = resolve(value('--out', 'cdn-plan.json')), manifest = resolve(value('--manifest', resolve(dirname(out), 'cdn-manifest.json')));
    // --base: keep that manifest's world-scoped section (world-scoped.mjs owns it), e.g. apps/web/src/cdn-manifest.json.
    const base = value('--base') ? JSON.parse(await readFile(value('--base'), 'utf8')) : null;
    await writeFile(out, JSON.stringify(plan, null, 2) + '\n'); await writeFile(manifest, JSON.stringify({ ...plan.manifest, ...(base?.worlds ? { worlds: base.worlds } : {}) }, null, 2) + '\n');
    console.log(JSON.stringify({ dryRun: true, ...plan.totals, out, manifest, largestFiles: plan.largestFiles.slice(0, 3) }));
  }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
