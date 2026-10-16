// Read-only asset inventory. No network or credential access.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const DEFAULT_SOURCES = '<team>/asset-scouting/SOURCES.csv';
export const CACHE = 'public, max-age=31536000, immutable';
export const TYPES = { '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.ktx2': 'image/ktx2', '.hdr': 'image/vnd.radiance', '.exr': 'image/x-exr' };
const SOURCE_LICENCES = new Set(['CC0-1.0', 'CC0 1.0', 'CC0-1.0 sources', 'own work']);
export const ALLOWED_LICENCES = new Set(['CC0-1.0', 'own-work']);
export const CLIENT_EXTENSIONS = new Set(['.glb', '.bin', '.ktx2', '.png', '.jpg', '.jpeg', '.webp', '.avif', '.hdr', '.exr']);
const normalizedLicence = licence => licence === 'own work' ? 'own-work' : 'CC0-1.0';
export const keyFor = (sha, ext) => `assets/${sha.slice(0, 2)}/${sha}${ext}`;
export function validKey(key, sha) { return /^[0-9a-f]{64}$/.test(sha) && new RegExp(`^assets/${sha.slice(0, 2)}/${sha}\\.[a-z0-9]+$`).test(key); }

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
export function licenceEvidence(rows, sha256, bytes, reviewed = { derivatives: [] }) {
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
  return { reason: 'no exact SHA-256/bytes licence record in SOURCES.csv or reviewed derivative allowlist', licence: 'unknown' };
}
export async function readReviewed() { return JSON.parse(await readFile(new URL('./approved-derivatives.json', import.meta.url), 'utf8')); }
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
export async function inventory({ root = ROOT, sources = DEFAULT_SOURCES, roots = defaultRoots(root), now = new Date(), reviewed } = {}) {
  const rows = parseCsv(await readFile(sources, 'utf8')), byPath = new Map(), missingRoots = [];
  reviewed ??= await readReviewed();
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
    const digest = hashes.get(candidate.file), evidence = licenceEvidence(rows, digest.sha256, digest.bytes, reviewed);
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
  // Runtime mesh endpoints use a SHA, independent of the core catalogue's on-disk name.
  // Only explicitly reviewed core outputs receive these public aliases.
  for (const object of objects.values()) {
    if (!reviewed.derivatives.some(d => d.sha256 === object.sha256 && d.bytes === object.bytes)) continue;
    const ext = extname(object.file).toLowerCase();
    if (!CLIENT_EXTENSIONS.has(ext)) continue;
    for (const prefix of ['/assets/', '/worlds/assets/']) {
      const path = `${prefix}${object.sha256}${ext}`;
      assets[path] = { key: object.key, sha256: object.sha256, bytes: object.bytes, licence: object.licence };
      if (!object.paths.includes(path)) object.paths.push(path);
    }
  }
  const files = [...hashes].map(([file, digest]) => ({ file, ...digest }));
  return {
    version: 1, generatedAt: now.toISOString(), root: resolve(root), sources: resolve(sources), bucket: 'eden-assets',
    coverage: ['/w/eden', '/w/mars', '/w/littlemartians', '/worlds'],
    note: 'Local public-asset inventory, not a live traffic capture. Missing roots and unlicensed files are explicit. No network or credentials used.',
    manifest: { version: 1, assets }, objects: [...objects.values()].sort((a, b) => a.key.localeCompare(b.key)), excluded, missingRoots,
    totals: { candidateFiles: files.length, candidateBytes: files.reduce((n, f) => n + f.bytes, 0), candidatePaths: candidates.length, publishableObjects: objects.size, publishableBytes: [...objects.values()].reduce((n, f) => n + f.bytes, 0), publishablePaths: Object.keys(assets).length, excludedPaths: excluded.length },
    largestFiles: files.sort((a, b) => b.bytes - a.bytes).slice(0, 20),
  };
}
