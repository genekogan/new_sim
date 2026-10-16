#!/usr/bin/env node
// World-scoped CDN publication (tools/cdn/README.md, "Excluded large assets and world-scoped publication").
// A file the live site already serves publicly to one world is published for that same world only, under
//   assets<world>/<sha256>.<ext>        e.g. assets/w/mars/675f4beb….glb
// and mapped in the client manifest's `worlds['<world>']` section, never in the shared CC0 catalogue.
// The reviewed per-file provenance lives in world-scoped.json (checked in). `apply` re-fetches every object from its
// public served URL, records that dated evidence, and uploads exactly those served bytes, so nothing the live site does
// not already serve to that world can be published. `plan`, `evidence` and `manifest` never read credentials.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CACHE, TYPES, shaFile } from './inventory.mjs';
import { BUCKET, SCOPED_KEY, loadCredentials, signRequest } from './publish.mjs';
import { withNewReceipt } from './receipt.mjs';

export const RECORDS = new URL('./world-scoped.json', import.meta.url);
export const ORIGIN = 'https://sim.eden.art';
export const LICENCE = 'world-scoped';
const WORLD = /^(?:\/worlds)?\/w\/[a-z][a-z0-9-]{0,31}$/;
const CLIENT = /\.(glb|bin|ktx2|png|jpe?g|webp|avif|hdr|exr)$/i;
const sha = value => createHash('sha256').update(value).digest('hex');
const extOf = path => extname(path.split('?')[0]).toLowerCase();
export const scopedKey = (world, sha256, ext) => `assets${world}/${sha256}${ext}`;

export async function readRecords(file = RECORDS) { return JSON.parse(await readFile(file, 'utf8')); }

/** Structural review of the provenance records; every rule here is also re-applied at apply time. */
export function validateRecords(records) {
  if (records?.version !== 1 || records.schema !== 'cdn-world-scoped/1' || records.origin !== ORIGIN || !Array.isArray(records.objects)) throw Error('Invalid world-scoped records');
  for (const field of ['ref', 'permits', 'whyWithinAuthority', 'preparedBy', 'preparedAt', 'reviewer']) if (!records.authorization?.[field]) throw Error(`World-scoped authorization lacks ${field}`);
  const keys = new Set(), paths = new Set();
  for (const [world, w] of Object.entries(records.worlds ?? {})) {
    if (!WORLD.test(world) || !w.slug || world.split('/').at(-1) !== w.slug || !w.worldId || w.page !== ORIGIN + world || !w.audience || w.namespace !== (world.startsWith('/worlds/') ? '/worlds' : 'root')) throw Error(`Invalid world scope ${world}`);
  }
  for (const o of records.objects) {
    const world = records.worlds?.[o.world];
    if (!world) throw Error(`Object names an unreviewed world: ${o.world}`);
    if (!/^[0-9a-f]{64}$/.test(o.sha256) || !Number.isSafeInteger(o.bytes) || o.bytes < 1 || !Array.isArray(o.paths) || !o.paths.length) throw Error(`Invalid world-scoped object ${o.sha256}`);
    const ext = extOf(o.paths[0]);
    for (const path of o.paths) {
      const url = new URL(path, ORIGIN);
      // Exact same-origin paths; a version query is part of the path and must be matched exactly by the client.
      if (!path.startsWith('/') || path.startsWith('//') || /[#\\]/.test(path) || url.origin !== ORIGIN || url.pathname + url.search !== path || !CLIENT.test(url.pathname) || extOf(path) !== ext) throw Error(`Invalid served path ${path}`);
      if (paths.has(o.world + ' ' + path)) throw Error(`Duplicate served path ${path} in ${o.world}`);
      paths.add(o.world + ' ' + path);
    }
    const key = scopedKey(o.world, o.sha256, ext);
    if (keys.has(key)) throw Error(`Duplicate world-scoped object ${key}`);
    keys.add(key);
    for (const field of ['holder', 'status', 'terms', 'record']) if (!o.rights?.[field]) throw Error(`Rights record lacks ${field} for ${key}`);
    if (/\bCC0\b|own[- ]work/i.test(o.rights.status) && !/no open licen/i.test(o.rights.status)) throw Error(`World-scoped rights must keep their own terms: ${key}`);
    if (!o.derivation || !Array.isArray(o.referencedBy) || !o.referencedBy.length) throw Error(`Provenance lacks derivation/reference for ${key}`);
  }
  return records;
}

/** Dry run: no network, no credentials. Cross-checks local copies where the live release has them. */
export async function plan({ records, recordsFile = RECORDS, now = new Date() } = {}) {
  records = validateRecords(records ?? await readRecords(recordsFile));
  const objects = [], manifest = { version: 1, worlds: {} };
  for (const o of records.objects) {
    const ext = extOf(o.paths[0]), key = scopedKey(o.world, o.sha256, ext);
    let local = null;
    if (o.localSource) {
      try { const d = await shaFile(o.localSource); local = { file: o.localSource, ok: d.sha256 === o.sha256 && d.bytes === o.bytes, ...d }; }
      catch (e) { if (e.code !== 'ENOENT') throw e; local = { file: o.localSource, available: false }; } // e.g. CI without the laptop runtime
      if (local.available !== false && !local.ok) throw Error(`Local live-release copy differs from its record: ${o.localSource}`);
    }
    objects.push({ world: o.world, worldId: records.worlds[o.world].worldId, key, sha256: o.sha256, bytes: o.bytes, contentType: TYPES[ext], cacheControl: CACHE, licence: LICENCE,
      paths: o.paths, servedUrls: o.paths.map(p => ORIGIN + p), local, derivation: o.derivation, referencedBy: o.referencedBy, rights: o.rights });
    for (const path of o.paths) (manifest.worlds[o.world] ??= {})[path] = { key, sha256: o.sha256, bytes: o.bytes, licence: LICENCE };
  }
  const bytes = objects.reduce((n, o) => n + o.bytes, 0);
  return { version: 1, schema: 'cdn-world-scoped-plan/1', generatedAt: now.toISOString(), bucket: BUCKET, origin: ORIGIN, recordsSha256: sha(JSON.stringify(records)),
    authorization: records.authorization, worlds: records.worlds, held: records.held ?? [], objects,
    note: 'Prepared, not published. apply re-fetches each served URL and uploads only matching bytes; manifest then merges only verified objects.',
    preparedManifest: manifest, totals: { objects: objects.length, bytes, paths: objects.reduce((n, o) => n + o.paths.length, 0), byWorld: Object.fromEntries(Object.keys(records.worlds).map(w => [w, objects.filter(o => o.world === w).reduce((n, o) => n + o.bytes, 0)])) } };
}

/** Plans are untrusted input: each object must equal its checked-in record. */
function trustedObjects(planned, records) {
  if (planned?.version !== 1 || planned.schema !== 'cdn-world-scoped-plan/1' || planned.bucket !== BUCKET || planned.origin !== ORIGIN || !Array.isArray(planned.objects) || !planned.objects.length) throw Error('No world-scoped objects in this plan');
  const seen = new Set();
  return planned.objects.map(o => {
    const r = records.objects.find(r => r.world === o.world && r.sha256 === o.sha256);
    const ext = r && extOf(r.paths[0]);
    if (!r || seen.has(o.key) || o.key !== scopedKey(r.world, r.sha256, ext) || !SCOPED_KEY.test(o.key) || o.bytes !== r.bytes || o.contentType !== TYPES[ext] || o.cacheControl !== CACHE || o.licence !== LICENCE ||
        !Array.isArray(o.paths) || !o.paths.length || o.paths.some(p => !r.paths.includes(p))) throw Error(`Plan object does not match its reviewed record: ${o.key}`);
    seen.add(o.key);
    return { world: r.world, key: o.key, sha256: r.sha256, bytes: r.bytes, contentType: TYPES[ext], licence: LICENCE, paths: [...o.paths] };
  });
}

/** Public GET of every served path; returns dated evidence and the bytes of the first matching response. */
export async function servedEvidence(object, { origin = ORIGIN, fetcher = fetch, now = () => new Date() } = {}) {
  const evidence = []; let body;
  for (const path of object.paths) {
    const url = new URL(path, origin).href, at = now().toISOString();
    try {
      const response = await fetcher(url, { method: 'GET', headers: { 'accept-encoding': 'identity' }, redirect: 'error', signal: AbortSignal.timeout(600_000) });
      const chunks = []; let bytes = 0;
      if (response.body) for await (const chunk of response.body) { chunks.push(chunk); bytes += chunk.length; if (bytes > object.bytes) break; }
      const data = Buffer.concat(chunks), digest = sha(data);
      const ok = response.status === 200 && data.length === object.bytes && digest === object.sha256;
      if (ok) body ??= data;
      evidence.push({ url, at, status: response.status, contentType: response.headers.get('content-type'), contentEncoding: response.headers.get('content-encoding'), etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified'), bytes: data.length, sha256: digest, ok });
    } catch (error) { evidence.push({ url, at, ok: false, error: String(error?.message ?? error) }); }
  }
  return { evidence, servedPaths: object.paths.filter((_, i) => evidence[i].ok), body };
}

/** Read-only serving check (no credentials, no upload). */
export async function evidence(planned, { records, origin = ORIGIN, fetcher = fetch } = {}) {
  records = validateRecords(records ?? await readRecords());
  const results = [];
  for (const object of trustedObjects(planned, records)) {
    const { evidence: rows, servedPaths } = await servedEvidence(object, { origin, fetcher });
    results.push({ world: object.world, key: object.key, sha256: object.sha256, bytes: object.bytes, served: servedPaths.length === object.paths.length, servedPaths, evidence: rows });
  }
  return { version: 1, schema: 'cdn-world-scoped-evidence/1', at: new Date().toISOString(), origin, ok: results.every(r => r.served), results };
}

function metadataErrors(response, object) {
  const h = response.headers, errors = [];
  for (const [header, expected] of [['content-length', String(object.bytes)], ['content-type', object.contentType], ['cache-control', CACHE], ['x-amz-meta-sha256', object.sha256], ['x-amz-meta-licence', LICENCE], ['x-amz-meta-world', object.world]]) {
    if (h.get(header) !== expected) errors.push(header);
  }
  return errors;
}

/** Release-owner step. Objects whose served bytes no longer match are skipped as `not-served`, never uploaded. */
export async function publishScoped(planned, { records, credentials, fetcher = fetch, origin = ORIGIN, now, onProgress = () => {} } = {}) {
  records = validateRecords(records ?? await readRecords());
  const objects = trustedObjects(planned, records); // validate everything before the first request
  if (!credentials) credentials = await loadCredentials();
  const request = (method, object, body, headers = {}) => {
    const signed = signRequest({ method, key: object.key, credentials, body, headers, now });
    return fetcher(signed.url, { method, headers: signed.headers, ...(body ? { body } : {}), redirect: 'error', signal: AbortSignal.timeout(600_000) });
  };
  const results = [];
  for (const object of objects) {
    const served = await servedEvidence(object, { origin, fetcher });
    if (!served.body) { const result = { world: object.world, key: object.key, disposition: 'not-served', verified: false, paths: [], evidence: served.evidence }; results.push(result); onProgress(result); continue; }
    let disposition = 'existing';
    const head = await request('HEAD', object);
    if (head.status === 404) {
      if (served.body.length !== object.bytes || sha(served.body) !== object.sha256) throw Error('Served bytes changed before PUT');
      const put = await request('PUT', object, served.body, { 'if-none-match': '*', 'content-type': object.contentType, 'cache-control': CACHE, 'x-amz-meta-sha256': object.sha256, 'x-amz-meta-licence': LICENCE, 'x-amz-meta-world': object.world });
      if (put.status === 412) {
        const raced = await request('HEAD', object);
        if (raced.status !== 200 || metadataErrors(raced, object).length) throw Error(`Immutable key conflict after racing PUT: ${object.key}`);
      } else if (!put.ok) throw Error(`PUT failed (${put.status}) for ${object.key}`);
      else disposition = 'uploaded';
      await put.body?.cancel();
    } else if (head.status !== 200) throw Error(`HEAD failed (${head.status}) for ${object.key}`);
    else if (metadataErrors(head, object).length) throw Error(`Refusing immutable overwrite: metadata differs (${metadataErrors(head, object).join(', ')}) for ${object.key}`);
    const readback = await request('GET', object);
    if (readback.status !== 200 || metadataErrors(readback, object).length) throw Error(`Readback metadata failed for ${object.key}`);
    const hash = createHash('sha256'); let bytes = 0;
    for await (const chunk of readback.body) { bytes += chunk.length; hash.update(chunk); }
    if (bytes !== object.bytes || hash.digest('hex') !== object.sha256) throw Error(`Readback bytes/SHA-256 differ for ${object.key}`);
    // Only paths that served these exact bytes are mapped later.
    const result = { world: object.world, key: object.key, disposition, bytes, sha256: object.sha256, verified: true, paths: served.servedPaths, evidence: served.evidence };
    results.push(result); onProgress(result);
  }
  return { version: 1, schema: 'cdn-world-scoped-receipt/1', at: new Date().toISOString(), bucket: BUCKET, origin, recordsSha256: sha(JSON.stringify(records)), reviewer: records.authorization.reviewer, ok: true,
    uploaded: results.filter(r => r.disposition === 'uploaded').length, existing: results.filter(r => r.disposition === 'existing').length, notServed: results.filter(r => r.disposition === 'not-served').length, results };
}

/** Merge only receipt-verified objects into the client manifest's world sections. The shared catalogue is untouched. */
export function mergeManifest(base, receipt, { records, origin = ORIGIN }) {
  validateRecords(records);
  if (base?.version !== 1 || !base.assets || typeof base.assets !== 'object') throw Error('Invalid base manifest');
  if (receipt?.schema !== 'cdn-world-scoped-receipt/1' || receipt.ok !== true || receipt.bucket !== BUCKET || receipt.origin !== origin || !Array.isArray(receipt.results)) throw Error('Merge needs a successful world-scoped upload receipt for the live origin');
  const worlds = structuredClone(base.worlds ?? {});
  let added = 0;
  for (const r of receipt.results) {
    if (r.verified !== true || !['uploaded', 'existing'].includes(r.disposition)) continue;
    const record = records.objects.find(o => o.world === r.world && o.sha256 === r.sha256);
    if (!record || r.key !== scopedKey(record.world, record.sha256, extOf(record.paths[0])) || r.bytes !== record.bytes) throw Error(`Receipt object does not match its reviewed record: ${r.key}`);
    for (const path of r.paths) {
      if (!record.paths.includes(path) || !r.evidence?.some(e => e.ok && e.url === new URL(path, origin).href)) throw Error(`Receipt path lacks served evidence: ${path}`);
      (worlds[r.world] ??= {})[path] = { key: r.key, sha256: r.sha256, bytes: r.bytes, licence: LICENCE }; added++;
    }
  }
  return { manifest: { version: 1, assets: base.assets, ...(Object.keys(worlds).length ? { worlds } : {}) }, added };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const value = (key, fallback) => { const i = args.indexOf(key); if (i < 0) return fallback; if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error(`Missing value for ${key}`); return args[i + 1]; };
  const allowed = { plan: ['--out'], evidence: ['--plan', '--out'], apply: ['--plan', '--receipt'], manifest: ['--receipt', '--base', '--out'] }[command];
  if (!allowed) throw Error('Usage: world-scoped.mjs plan --out <plan.json> | evidence --plan <plan.json> --out <evidence.json> | apply --plan <plan.json> --receipt <receipt.json> | manifest --receipt <receipt.json> --base <cdn-manifest.json> --out <cdn-manifest.json>');
  for (const arg of args.filter(a => a.startsWith('--'))) if (!allowed.includes(arg)) throw Error(`Unknown option ${arg} for ${command}`);
  if (command === 'plan') {
    const out = resolve(value('--out', 'cdn-world-scoped-plan.json')), result = await plan();
    await writeFile(out, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ dryRun: true, ...result.totals, held: result.held.length, out }));
  } else if (command === 'evidence') {
    const out = resolve(value('--out', 'cdn-world-scoped-evidence.json')), planned = JSON.parse(await readFile(value('--plan'), 'utf8'));
    const report = await withNewReceipt(out, () => evidence(planned));
    console.log(JSON.stringify({ ok: report.ok, served: report.results.filter(r => r.served).length, objects: report.results.length, out })); process.exitCode = report.ok ? 0 : 1;
  } else if (command === 'apply') {
    const planned = JSON.parse(await readFile(value('--plan'), 'utf8')), receipt = resolve(value('--receipt', 'cdn-world-scoped-receipt.json'));
    const result = await withNewReceipt(receipt, () => publishScoped(planned, { onProgress: r => console.log(JSON.stringify({ key: r.key, world: r.world, disposition: r.disposition, paths: r.paths.length })) }));
    console.log(JSON.stringify({ ok: true, uploaded: result.uploaded, existing: result.existing, notServed: result.notServed, receipt }));
  } else {
    const base = resolve(value('--base')), out = resolve(value('--out', base));
    const { manifest, added } = mergeManifest(JSON.parse(await readFile(base, 'utf8')), JSON.parse(await readFile(value('--receipt'), 'utf8')), { records: await readRecords() });
    await writeFile(out, JSON.stringify(manifest, null, 2) + '\n');
    console.log(JSON.stringify({ ok: true, worldPaths: added, out }));
  }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
