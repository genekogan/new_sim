#!/usr/bin/env node
// Public read-only CDN proof; derived from db11f401 tools/blobs/cdn-verify.mjs.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { CACHE, TYPES, isBrKey, validKey } from './inventory.mjs';
import { withNewReceipt } from './receipt.mjs';
import { SCOPED_KEY } from './publish.mjs';

// Shared catalogue keys, or world-scoped keys (world-scoped.mjs) whose file name is the object's own SHA-256.
const publishedKey = (key, sha) => validKey(key, sha) || (/^[0-9a-f]{64}$/.test(sha) && SCOPED_KEY.test(key) && key.split('/').at(-1).startsWith(sha + '.'));

// Chrome's own Accept-Encoding: the edge must keep the stored br for it (not transcode to zstd).
const CHROME = 'gzip, deflate, br, zstd';

export function checkHeaders(response, object, { hit = false } = {}) {
  const h = response.headers, errors = [];
  if (response.status !== 200) errors.push(`status ${response.status}, expected 200`);
  if ((h.get('content-type') ?? '').split(';')[0].trim() !== object.contentType) errors.push('wrong Content-Type');
  if (h.get('cache-control') !== CACHE) errors.push('missing immutable one-year cache policy');
  if (!['https://sim.eden.art', '*'].includes(h.get('access-control-allow-origin'))) errors.push('CORS does not allow https://sim.eden.art');
  if (!h.get('etag')) errors.push('missing ETag');
  if (hit && h.get('cf-cache-status') !== 'HIT') errors.push(`cache ${h.get('cf-cache-status') ?? 'missing'}; expected HIT`);
  if (hit && !/^\d+$/.test(h.get('age') ?? '')) errors.push('missing numeric Age on cache HIT');
  return errors;
}

export async function verify(origin, plan, { sample = 3, key, fetcher = fetch, allowWarm = false, wait = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const u = new URL(origin);
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw Error('CDN origin must be a bare HTTPS domain');
  const all = plan.objects ?? [...new Map(Object.values(plan.assets ?? {}).map(o => [o.key, { ...o, contentType: TYPES['.' + o.key.split('.').at(-1)] }])).values()];
  const keys = key ? String(key).split(',') : null, objects = keys ? all.filter(p => keys.includes(p.key)) : [...all].sort((a, b) => a.bytes - b.bytes).slice(0, sample);
  if (keys && objects.length !== new Set(keys).size) throw Error('--key names a key that is not in the plan');
  if (!Number.isSafeInteger(sample) || sample < 1 || !objects.length) throw Error('Empty CDN sample; choose a nonempty plan and positive sample');
  const results = [];
  for (const object of objects) {
    if (!publishedKey(object.key, object.sha256)) throw Error('Invalid content-addressed key');
    const url = new URL(object.key, u).href, requests = [], errors = [];
    // CDN3: a precompressed object (stored q11 br) must reach a br client as exactly those bytes (Content-Encoding br,
    // the stored length) and every other client as the decoded file: Cloudflare decodes for clients without br. fetch
    // decodes whatever arrives, so the hash check covers both; the encoding header shows which one the edge sent.
    const br = object.encoding === 'br' || isBrKey(object.key), modes = br ? ['br', 'br', CHROME, 'identity', 'gzip'] : ['identity', 'identity'];
    // GET primes the edge. HEAD alone need not populate a CDN's body cache.
    for (const [i, encoding] of modes.entries()) {
      const response = await fetcher(url, { method: 'GET', headers: { Origin: 'https://sim.eden.art', 'Accept-Encoding': encoding }, redirect: 'error', signal: AbortSignal.timeout(180_000) });
      const hash = createHash('sha256'); let bytes = 0;
      if (response.body) for await (const chunk of response.body) { bytes += chunk.length; hash.update(chunk); }
      const downloadedSha256 = hash.digest('hex'), sent = response.headers.get('content-encoding'), length = response.headers.get('content-length');
      errors.push(...checkHeaders(response, object, { hit: i > 0 }));
      if (i === 0 && response.headers.get('cf-cache-status') !== 'MISS' && !(allowWarm && response.headers.get('cf-cache-status') === 'HIT')) errors.push(`first request cache ${response.headers.get('cf-cache-status') ?? 'missing'}; expected MISS (use a newly uploaded object, or --allow-warm for a warm recheck)`);
      if (bytes !== object.bytes || downloadedSha256 !== object.sha256) errors.push(`${encoding} request: download bytes/SHA-256 differ from upload plan`);
      if (br && (encoding === 'br' || encoding === CHROME) && sent !== 'br') errors.push(`${encoding} request: content-encoding ${sent ?? 'none'}, expected the stored br bytes`);
      if (br && (encoding === 'br' || encoding === CHROME) && object.encodedBytes && length !== null && Number(length) !== object.encodedBytes) errors.push(`br request: content-length ${length}, expected the stored ${object.encodedBytes}`);
      if (encoding === 'identity' && sent && sent !== 'identity') errors.push(`identity request: got content-encoding ${sent}`);
      if (encoding === 'gzip' && sent && !['gzip', 'identity'].includes(sent)) errors.push(`gzip request: got content-encoding ${sent}`);
      requests.push({ method: 'GET', acceptEncoding: encoding, status: response.status, contentEncoding: sent, wireBytes: length === null ? null : Number(length), headers: Object.fromEntries(response.headers), decodedBytes: bytes, decodedSha256: downloadedSha256 });
      if (i === 0) await wait(1100); // Age may honestly be 0 for an immediate HIT; wait to show useful evidence.
    }
    results.push({ key: object.key, url, ok: !errors.length, requests, errors });
  }
  return { version: 1, origin: u.origin, at: new Date().toISOString(), ok: results.every(r => r.ok), cacheProof: allowWarm ? 'warm recheck allowed; inspect first cache status' : 'strict MISS then HIT', results };
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [origin, file, ...args] = process.argv.slice(2), value = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
  try {
    const out = value('--out', 'cdn-cache-proof.json');
    const report = await withNewReceipt(out, async () => verify(origin, JSON.parse(await readFile(file, 'utf8')), { sample: Number(value('--sample', 3)), key: value('--key'), allowWarm: args.includes('--allow-warm') }));
    console.log(JSON.stringify({ ok: report.ok, objects: report.results.length, out })); process.exitCode = report.ok ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
