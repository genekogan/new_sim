// Read-only asset inventory. No network or credential access.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { brotliCompress, brotliDecompress, constants as zlib } from 'node:zlib';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deployEnv } from '../world-launcher/deploy/deploy-env.mjs';
import { coreSet } from './served-public.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// The licence evidence CSV (asset scouting, kept outside the repo): EDEN_ASSETS_SOURCES in the environment or deploy.env.
export const DEFAULT_SOURCES = deployEnv('EDEN_ASSETS_SOURCES') || join(ROOT, '.local/cdn/SOURCES.csv');
export const CACHE = 'public, max-age=31536000, immutable';
export const TYPES = { '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.ktx2': 'image/ktx2', '.hdr': 'image/vnd.radiance', '.exr': 'image/x-exr' };
const SOURCE_LICENCES = new Set(['CC0-1.0', 'CC0 1.0', 'CC0-1.0 sources', 'own work']);
// served-public (CDN2, Gene 2026-10-20): already public on the origin by hash; the CDN is a transport, not a licence.
export const ALLOWED_LICENCES = new Set(['CC0-1.0', 'own-work', 'served-public']);
export const CLIENT_EXTENSIONS = new Set(['.glb', '.bin', '.ktx2', '.png', '.jpg', '.jpeg', '.webp', '.avif', '.hdr', '.exr']);
const normalizedLicence = licence => licence === 'own work' ? 'own-work' : 'CC0-1.0';
export const keyFor = (sha, ext) => `assets/${sha.slice(0, 2)}/${sha}${ext}`;
/** CDN3 (2026-10-20): a precompressed object lives under its own key namespace, `assets/br/<aa>/<sha>.<ext>`, stored as
 *  quality-11 brotli bytes with `Content-Encoding: br`. sha256/bytes stay those of the decoded file (what fetch hands the
 *  client), so a br key never collides with the identity object CDN1/CDN2 uploaded under `assets/<aa>/<sha>.<ext>`. */
export const brKeyFor = (sha, ext) => `assets/br/${sha.slice(0, 2)}/${sha}${ext}`;
export const isBrKey = key => typeof key === 'string' && key.startsWith('assets/br/');
export function validKey(key, sha) { return /^[0-9a-f]{64}$/.test(sha) && new RegExp(`^assets/(?:br/)?${sha.slice(0, 2)}/${sha}\\.[a-z0-9]+$`).test(key); }

// Precompression (CDN3). Origin sends /blobs, /modular and the Vite bundles as quality-11 brotli; assets.eden.art
// compresses on the fly at about quality 4 (CDN2 audit), so the CDN only beats the origin when it stores q11 itself.
// Images (PNG/JPEG/WebP/AVIF/KTX2) are already entropy-coded and stay identity.
export const BR_EXTENSIONS = new Set(['.glb', '.bin', '.hdr', '.exr', '.gltf', '.json', '.wasm', '.svg']);
/** Store br only when it saves at least this fraction (below it, identity costs no more on the wire than br would). */
export const BR_MIN_SAVING = 0.03;
/** lgwin 24 is the largest window every browser's decoder accepts (large-window brotli is not web brotli). */
export const BR_PARAMS = Object.freeze({ quality: 11, lgwin: 24 });
export const DEFAULT_BR_CACHE = process.env.EDEN_CDN_BR_CACHE || join(tmpdir(), 'eden-cdn-br');
const compress = promisify(brotliCompress), decompress = promisify(brotliDecompress);
const digest = buffer => createHash('sha256').update(buffer).digest('hex');
export function brotli(buffer) {
  return compress(buffer, { params: { [zlib.BROTLI_PARAM_QUALITY]: BR_PARAMS.quality, [zlib.BROTLI_PARAM_LGWIN]: BR_PARAMS.lgwin, [zlib.BROTLI_PARAM_MODE]: zlib.BROTLI_MODE_GENERIC, [zlib.BROTLI_PARAM_SIZE_HINT]: buffer.length } });
}
/** The q11 brotli bytes of `file`, whose decoded sha256/bytes must be the given ones. A content-addressed cache
 *  (`<cache>/<sha256>.q11w24.br`) is reused only after it decodes to exactly those bytes; otherwise it is rebuilt. */
export async function encodedCopy(file, sha256, bytes, cache = DEFAULT_BR_CACHE) {
  const cached = join(cache, `${sha256}.q${BR_PARAMS.quality}w${BR_PARAMS.lgwin}.br`);
  try {
    const encoded = await readFile(cached), decoded = await decompress(encoded);
    if (decoded.length === bytes && digest(decoded) === sha256) return { encoded, encodedBytes: encoded.length, encodedSha256: digest(encoded) };
  } catch { /* absent or undecodable cache entry: rebuild it */ }
  const raw = await readFile(file);
  if (raw.length !== bytes || digest(raw) !== sha256) throw Error(`${file}: bytes differ from the recorded sha256 before compression`);
  const encoded = await brotli(raw), check = await decompress(encoded);
  if (check.length !== bytes || digest(check) !== sha256) throw Error(`${file}: brotli round trip failed`);
  await mkdir(cache, { recursive: true });
  const tmp = `${cached}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, encoded); await rename(tmp, cached);
  return { encoded, encodedBytes: encoded.length, encodedSha256: digest(encoded) };
}
/** Decide each compressible object's encoding: q11 br under its br key when that saves >= BR_MIN_SAVING. Rewrites the
 *  manifest entries that point at a re-keyed object. Runs four compressions at a time (zlib's thread pool). */
export async function precompress(objects, assets, { cache = DEFAULT_BR_CACHE, concurrency = 4 } = {}) {
  const queue = objects.filter(o => BR_EXTENSIONS.has(extname(o.key))), rekeyed = new Map();
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let o; (o = queue.shift());) {
      const { encodedBytes, encodedSha256 } = await encodedCopy(o.file, o.sha256, o.bytes, cache);
      if (encodedBytes > o.bytes * (1 - BR_MIN_SAVING)) continue;
      const key = brKeyFor(o.sha256, extname(o.key));
      rekeyed.set(o.key, key);
      Object.assign(o, { key, encoding: 'br', encodedBytes, encodedSha256 });
    }
  }));
  for (const a of Object.values(assets)) if (rekeyed.has(a.key)) a.key = rekeyed.get(a.key);
  return rekeyed.size;
}

export function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if (c === '\n' && !quoted) { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (quoted) throw Error('Unterminated CSV quote');
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  const headers = rows.shift() ?? [];
  if (!['path', 'licence', 'sha256', 'bytes'].every(k => headers.includes(k))) throw Error('SOURCES.csv lacks required columns');
  return rows.filter(r => r.some(Boolean)).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
}
export async function shaFile(file) {
  const h = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(file)) { bytes += chunk.length; h.update(chunk); }
  return { sha256: h.digest('hex'), bytes };
}
export function licenceEvidence(rows, sha256, bytes, reviewed = { derivatives: [] }, served = { objects: [] }) {
  const matches = rows.filter(r => r.sha256 === sha256 && Number(r.bytes) === bytes);
  // Conflicting/restricted rows cannot silently be overridden by an allowlisted label.
  if (matches.some(r => !SOURCE_LICENCES.has(r.licence))) return { reason: 'restricted or conflicting SOURCES.csv licence', licence: matches.map(r => r.licence).join('; ') };
  const row = matches.find(r => SOURCE_LICENCES.has(r.licence));
  if (row) return { licence: normalizedLicence(row.licence), source: { path: row.path, url: row.url, author: row.author, sha256, bytes } };
  const derivative = reviewed.derivatives.find(r => r.sha256 === sha256 && r.bytes === bytes && r.licence === 'CC0-1.0');
  if (derivative) {
    const originals = reviewed.sources[derivative.source];
    if (originals?.length && originals.every(s => rows.some(r => r.path === s.path && r.sha256 === s.sha256 && Number(r.bytes) === s.bytes && r.licence === 'CC0-1.0'))) {
      return { licence: 'CC0-1.0', source: { reviewedDerivative: derivative.path, sourceFamily: derivative.source, originals } };
    }
    return { reason: 'reviewed derivative source records changed or missing from SOURCES.csv', licence: 'unknown' };
  }
  const record = served.objects.find(r => r.sha256 === sha256 && r.bytes === bytes);
  if (record) return { licence: 'served-public', source: { servedPublic: record.path, rights: record.rights } };
  return { reason: 'no exact SHA-256/bytes licence record in SOURCES.csv or reviewed derivative allowlist', licence: 'unknown' };
}
export async function readReviewed() { return JSON.parse(await readFile(new URL('./approved-derivatives.json', import.meta.url), 'utf8')); }
export async function readServed() { return JSON.parse(await readFile(new URL('./served-public.json', import.meta.url), 'utf8')); }
/** BLOBS files the client loads (/blobs/assets/<aa>/<sha>.<ext>; reviewed list, local copies outside the repo). */
export async function readBlobs() { return JSON.parse(await readFile(new URL('./served-blobs.json', import.meta.url), 'utf8')); }
/** Served-public evidence: the generated core-set records plus the reviewed BLOBS records. */
export async function readServedAll() { const [a, b] = await Promise.all([readServed(), readBlobs()]); return { ...a, objects: [...a.objects, ...b.objects] }; }
async function filesUnder(dir) {
  let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const files = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    // Public roots can acquire local runtime state; never open hidden or secret-named entries.
    if (e.name.startsWith('.') || /(?:credential|secret|token)/i.test(e.name) || e.name === 'node_modules') continue;
    // Never follow nested links outside the explicitly configured public roots.
    if (e.isSymbolicLink()) continue;
    const file = join(dir, e.name);
    if (e.isDirectory()) files.push(...await filesUnder(file));
    else if (e.isFile() && TYPES[extname(e.name).toLowerCase()]) files.push(file);
  }
  return files;
}
export function defaultRoots(root) {
  return [
    { dir: join(root, 'mars/viewer/public'), prefixes: ['/', '/mars-assets/', '/worlds/'], pages: ['/w/eden', '/w/mars', '/w/littlemartians', '/worlds'] },
    { dir: join(root, '.lane/mars-web'), prefixes: ['/', '/mars-assets/', '/worlds/'], pages: ['/w/eden', '/w/mars', '/w/littlemartians', '/worlds'], overlay: true },
    { dir: join(root, 'worlds'), prefixes: ['/world-assets/', '/worlds/world-assets/'], pages: ['/w/eden', '/w/mars', '/w/littlemartians', '/worlds'] },
    { dir: join(root, 'apps/web/public'), prefixes: ['/', '/worlds/'], pages: ['/w/eden', '/w/mars', '/w/littlemartians', '/worlds'] },
  ];
}
/** `brotli`: precompression options ({ cache }), or false for identity-only objects (CDN1/CDN2 plans). */
export async function inventory({ root = ROOT, sources = DEFAULT_SOURCES, roots = defaultRoots(root), now = new Date(), reviewed, served, blobs, brotli: brOptions = {} } = {}) {
  const rows = parseCsv(await readFile(sources, 'utf8')), byPath = new Map(), missingRoots = [];
  reviewed ??= await readReviewed();
  // The BLOBS list names this repo's client files; an inventory of another root (a test fixture) has none by default.
  blobs ??= resolve(root) === ROOT ? await readBlobs() : { objects: [] };
  if (!served) { const generated = await readServed(); served = { ...generated, objects: [...generated.objects, ...blobs.objects] }; }
  // The immutable release overlay takes precedence over source-public fallbacks.
  for (const spec of roots) {
    try { if (!(await stat(spec.dir)).isDirectory()) throw Error('Asset root is not a directory'); } catch (e) { if (e.code === 'ENOENT') { missingRoots.push(spec.dir); continue; } throw e; }
    for (const file of await filesUnder(spec.dir)) {
      const rel = relative(spec.dir, file).split('\\').join('/');
      for (const prefix of spec.prefixes) byPath.set(prefix + rel, { file, path: prefix + rel, pages: spec.pages });
    }
  }
  const hashes = new Map(), candidates = [], assets = {}, objects = new Map(), excluded = [];
  for (const candidate of [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    if (!hashes.has(candidate.file)) hashes.set(candidate.file, await shaFile(candidate.file));
    const digest = hashes.get(candidate.file), evidence = licenceEvidence(rows, digest.sha256, digest.bytes, reviewed, served);
    const item = { ...candidate, ...digest, licence: evidence.licence };
    candidates.push(item);
    if (evidence.reason) { excluded.push({ ...item, reason: evidence.reason }); continue; }
    const ext = extname(candidate.file).toLowerCase(), key = keyFor(digest.sha256, ext);
    if (CLIENT_EXTENSIONS.has(ext)) assets[item.path] = { key, ...digest, licence: evidence.licence };
    if (!objects.has(key)) objects.set(key, { key, file: candidate.file, ...digest, licence: evidence.licence, source: evidence.source, contentType: TYPES[ext], cacheControl: CACHE, paths: [] });
    objects.get(key).paths.push(item.path);
  }
  // Existing version pins are exact manifest aliases, never dropped by the client.
  for (const [base, alias] of [['/browser/campus.glb', '/browser/campus.glb?v=20260922b']]) {
    if (assets[base]) assets[alias] = assets[base];
    else if (byPath.has(base)) { const item = excluded.find(r => r.path === base); excluded.push({ ...item, path: alias }); }
  }
  // CDN3: /modular files carry the exact version query the client puts on them (served-public.json `queries`). A query
  // alias names the same bytes as its bare path, in both the root and /worlds namespaces.
  for (const r of served.objects) for (const q of r.queries ?? []) for (const prefix of ['', '/worlds']) {
    const entry = assets[prefix + r.url];
    if (entry) { assets[prefix + r.url + q] = entry; objects.get(entry.key)?.paths.push(prefix + r.url + q); }
  }
  // Runtime mesh endpoints use a SHA, independent of the core catalogue's on-disk name. Each alias names the bytes the
  // origin's GET /assets/<sha> sends: the core set (worlds/core-assets/*index.json) with its renditions, plus reviewed
  // outputs. A rendition alias carries `of` (the requested sha); the entry's sha256 is the bytes actually delivered.
  const targets = new Map();
  for (const d of reviewed.derivatives) targets.set(d.sha256, { sha256: d.sha256, ext: extname(d.path).toLowerCase() });
  for (const [s, a] of (await coreSet(root)).assets) targets.set(s, { sha256: a.served?.sha256 ?? s, ext: '.' + a.ext });
  const bySha = new Map([...objects.values()].map(o => [o.sha256, o]));
  for (const [s, t] of [...targets].sort(([a], [b]) => a.localeCompare(b))) {
    const object = bySha.get(t.sha256);
    if (!object || !CLIENT_EXTENSIONS.has(t.ext) || extname(object.file).toLowerCase() !== t.ext) continue;
    for (const prefix of ['/assets/', '/worlds/assets/']) {
      const path = `${prefix}${s}${t.ext}`;
      assets[path] = { key: object.key, sha256: object.sha256, bytes: object.bytes, licence: object.licence, ...(s !== object.sha256 ? { of: s } : {}) };
      if (!object.paths.includes(path)) object.paths.push(path);
    }
  }
  // BLOBS the client requests by their content-addressed path (served-blobs.json). A missing local copy is listed, not guessed.
  const missingBlobs = [];
  for (const b of blobs.objects) {
    const ext = extname(b.blob).toLowerCase(), m = /^\/blobs\/assets\/([0-9a-f]{2})\/([0-9a-f]{64})\.[a-z0-9]+$/.exec(b.blob);
    if (!m || m[2] !== b.sha256 || m[1] !== b.sha256.slice(0, 2) || !CLIENT_EXTENSIONS.has(ext)) throw Error(`Invalid BLOBS record ${b.blob}`);
    let digest; try { digest = await shaFile(b.path); } catch (e) { if (e.code === 'ENOENT') { missingBlobs.push(b.path); continue; } throw e; }
    if (digest.sha256 !== b.sha256 || digest.bytes !== b.bytes) throw Error(`${b.path}: bytes differ from its BLOBS record`);
    hashes.set(b.path, digest);
    const evidence = licenceEvidence(rows, digest.sha256, digest.bytes, reviewed, served), key = keyFor(digest.sha256, ext);
    if (evidence.reason) { excluded.push({ file: b.path, path: b.blob, ...digest, licence: evidence.licence, reason: evidence.reason }); continue; }
    assets[b.blob] = { key, ...digest, licence: evidence.licence };
    if (!objects.has(key)) objects.set(key, { key, file: b.path, ...digest, licence: evidence.licence, source: evidence.source, contentType: TYPES[ext], cacheControl: CACHE, paths: [] });
    objects.get(key).paths.push(b.blob);
  }
  const files = [...hashes].map(([file, digest]) => ({ file, ...digest }));
  const all = [...objects.values()];
  if (brOptions !== false) await precompress(all, assets, brOptions);
  return {
    version: 1, generatedAt: now.toISOString(), root: resolve(root), sources: resolve(sources), bucket: 'eden-assets',
    coverage: ['/w/eden', '/w/mars', '/w/littlemartians', '/worlds'],
    note: 'Local public-asset inventory, not a live traffic capture. Missing roots and unlicensed files are explicit. No network or credentials used.',
    ...(brOptions !== false ? { brotli: { ...BR_PARAMS, minSaving: BR_MIN_SAVING, cache: resolve(brOptions.cache ?? DEFAULT_BR_CACHE) } } : {}),
    manifest: { version: 1, assets }, objects: all.sort((a, b) => a.key.localeCompare(b.key)), excluded, missingRoots, missingBlobs,
    totals: { candidateFiles: files.length, candidateBytes: files.reduce((n, f) => n + f.bytes, 0), candidatePaths: candidates.length, publishableObjects: objects.size, publishableBytes: all.reduce((n, f) => n + f.bytes, 0), brObjects: all.filter(o => o.encoding === 'br').length, storedBytes: all.reduce((n, f) => n + (f.encodedBytes ?? f.bytes), 0), publishablePaths: Object.keys(assets).length, excludedPaths: excluded.length },
    largestFiles: files.sort((a, b) => b.bytes - a.bytes).slice(0, 20),
  };
}
