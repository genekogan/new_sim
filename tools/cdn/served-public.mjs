#!/usr/bin/env node
// CDN2 (2026-10-20). Gene's rule, verbatim: "yes put it on cdn. anything that loads faster from cdn should be on cdn.
// as a rule." Files the origin already serves publicly by hash may use the CDN as a transport, whatever their licence:
// the CDN adds speed, not exposure. Rights stay with their holders (each record keeps the index's licence text).
//
// Scope: the server's core asset set, exactly as `GET /assets/<sha>.<ext>` serves it (apps/server/src/god/assets.ts):
// worlds/core-assets/index.json plus every other worlds/core-assets/*.index.json (lods, littlemartians-two,
// mars-fidelity; index.json wins a clash), and for a GLB with a rendition in renditions.json the rendition's bytes,
// which the origin sends under the source sha. Measured on 2026-10-20 (team/lanes/t4-cdn2.md): Cloudflare caches
// that route uncompressed, while assets.eden.art sends brotli, so these load faster from the CDN.
// CDN3 (2026-10-20): /modular joins (modularRecords below). With precompressed q11 objects (inventory.mjs precompress)
// the CDN is at least as small on the wire as the origin's q11 brotli, so these classes load faster from it too.
//
//   node tools/cdn/served-public.mjs            check served-public.json is current (exit 1 if stale)
//   node tools/cdn/served-public.mjs --write    regenerate it after a core index or rendition changes
// No network, no credentials.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CLIENT_EXTENSIONS, ROOT, shaFile } from './inventory.mjs';

export const RULE = { by: 'Gene', date: '2026-10-20', text: 'yes put it on cdn. anything that loads faster from cdn should be on cdn. as a rule.' };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const SHA = /^[0-9a-f]{64}$/;

/** The core set the origin's /assets/<sha> route serves: sha -> { ext, path, license, source, index }. */
export async function coreSet(root = ROOT) {
  const dir = join(root, 'worlds/core-assets');
  if (!existsSync(dir)) return { assets: new Map(), pins: {} };
  const pins = {}, assets = new Map();
  const files = ['index.json', ...(await readdir(dir)).filter((n) => n.endsWith('.index.json')).sort()];
  for (const name of files) { // index.json first: the server's `{ ...extra, ...core }` lets the core index win
    const raw = await readFile(join(dir, name)); pins[name] = sha(raw);
    for (const [s, a] of Object.entries(JSON.parse(raw.toString('utf8')).assets ?? {})) {
      if (!SHA.test(s) || assets.has(s) || typeof a?.path !== 'string' || a.path.includes('..')) continue;
      assets.set(s, { ext: a.ext, path: a.path, license: a.license ?? '', source: a.source, index: name });
    }
  }
  const renditions = new Map(), rf = join(dir, 'renditions.json');
  if (existsSync(rf)) {
    const raw = await readFile(rf); pins['renditions.json'] = sha(raw);
    const idx = JSON.parse(raw.toString('utf8'));
    if (idx.schema === 'core-renditions/1') for (const [src, r] of Object.entries(idx.renditions ?? {})) {
      if (SHA.test(src) && SHA.test(r?.sha ?? '') && typeof r.path === 'string' && !r.path.includes('..') && existsSync(join(root, r.path))) renditions.set(src, r);
    }
  }
  // What the route actually sends for each source sha (rendition only for a core GLB, as AssetStore.rendition()).
  for (const [s, a] of assets) { const r = a.ext === 'glb' ? renditions.get(s) : null; if (r) a.served = { sha256: r.sha, path: r.path }; }
  return { assets, pins };
}

const MODULAR = 'mars/viewer/public/modular';
const MODULAR_RIGHTS = {
  environment: 'CC0-1.0: Quaternius animated people and Universal Animation Library clips (modular/ASSETS.md); eden-*.glb packs from Quaternius/Kenney CC0 sources (team/asset-scouting/SOURCES.csv, mars/scripts/imports/export_pack.py)',
};
const block = (src, name) => { const m = new RegExp(`export const ${name} = (\\{[\\s\\S]*?\\n\\}) as const;`).exec(src); if (!m) throw Error(`${name} not found`); return JSON.parse(m[1]); };
const one = (src, re, what) => { const m = re.exec(src); if (!m) throw Error(`${what}: pinned URL expression not found; update tools/cdn/served-public.mjs`); return m[1]; };
async function glbsUnder(dir, rel = '') {
  const out = [];
  for (const e of (await readdir(join(dir, rel), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
    if (e.isDirectory()) out.push(...await glbsUnder(dir, rel + e.name + '/'));
    else if (e.isFile() && e.name.endsWith('.glb')) out.push(rel + e.name);
  }
  return out;
}
/** CDN3: every GLB under mars/viewer/public/modular, which the origin serves publicly at `/modular/**` and
 *  `/worlds/modular/**`, with the exact version queries the client puts on them (`queries`), read from the client's own
 *  pinned URL expressions: character wire files `?v=<sha256[0:12]>` (character-wire.ts), the single-file fallback
 *  characters `?v=<tag>` (people.ts characterUrl), the Eden packs `?v=<IMPORTS_TAG>` (eden-imports/assets.ts).
 *  The humanoid kit (`modular/humanoid`) is fetched by bare name. */
export async function modularRecords(root = ROOT) {
  const dir = join(root, MODULAR);
  if (!existsSync(dir)) return [];
  const app = join(root, 'mars/viewer/app/engine-view'), queries = new Map();
  const wireSrc = await readFile(join(app, 'character-wire.ts'), 'utf8');
  for (const w of Object.values(block(wireSrc, 'CHARACTER_WIRE'))) queries.set(`environment/${w.mesh}`, `?v=${w.meshSHA256.slice(0, 12)}`);
  for (const [file, c] of Object.entries(block(wireSrc, 'CHARACTER_CLIPS'))) queries.set(`environment/${file}`, `?v=${c.sha256.slice(0, 12)}`);
  const ual = one(await readFile(join(app, 'people.ts'), 'utf8'), /\/modular\/environment\/animated-\$\{name\}\.glb\?v=([A-Za-z0-9._-]+)`/, 'people.ts characterUrl');
  const imports = one(await readFile(join(app, 'content/assets/eden-imports/assets.ts'), 'utf8'), /export const IMPORTS_TAG\s*=\s*'([A-Za-z0-9._-]+)'/, 'IMPORTS_TAG');
  const kit = existsSync(join(dir, 'humanoid/kit.json')) ? JSON.parse(await readFile(join(dir, 'humanoid/kit.json'), 'utf8')) : null;
  const records = [];
  for (const rel of await glbsUnder(dir)) {
    const digest = await shaFile(join(dir, rel)), q = queries.get(rel)
      ?? (/^environment\/animated-[a-z]+\.glb$/.test(rel) ? `?v=${ual}` : /^environment\/eden-[a-z-]+\.glb$/.test(rel) ? `?v=${imports}` : undefined);
    const rights = rel.startsWith('humanoid/') ? kit?.licence : MODULAR_RIGHTS[rel.split('/')[0]];
    if (!rights) throw Error(`${MODULAR}/${rel}: no rights text recorded`);
    records.push({ sha256: digest.sha256, bytes: digest.bytes, path: `${MODULAR}/${rel}`, rights, class: 'modular', url: `/modular/${rel}`, ...(q ? { queries: [q] } : {}) });
  }
  return records;
}

/** Records for every served file of the core set that the CC0 allowlist does not already cover. */
export async function buildRecords(root = ROOT, reviewed) {
  reviewed ??= JSON.parse(await readFile(new URL('./approved-derivatives.json', import.meta.url), 'utf8'));
  const { assets, pins } = await coreSet(root), records = new Map();
  for (const [s, a] of assets) {
    const file = a.served?.path ?? a.path;
    if (!CLIENT_EXTENSIONS.has(extname(file).toLowerCase()) || !existsSync(join(root, file))) continue;
    const digest = await shaFile(join(root, file));
    if (digest.sha256 !== (a.served?.sha256 ?? s)) throw Error(`${file}: bytes differ from the index sha`);
    if (reviewed.derivatives.some((d) => d.sha256 === digest.sha256 && d.bytes === digest.bytes)) continue;
    const r = records.get(digest.sha256) ?? { sha256: digest.sha256, bytes: digest.bytes, path: file, rights: a.license };
    if (a.served) (r.renditionOf ??= []).push(s); else { r.index = a.index; if (a.source) r.source = a.source; }
    records.set(digest.sha256, r);
  }
  const objects = [...records.values()].sort((x, y) => x.path.localeCompare(y.path));
  // CDN3: the /modular class (no overlap with the core set: a sha already recorded keeps its core record).
  for (const r of await modularRecords(root)) if (!records.has(r.sha256) && !reviewed.derivatives.some((d) => d.sha256 === r.sha256)) objects.push(r);
  return {
    version: 1, rule: RULE,
    note: 'Served-public CDN records (tools/cdn/served-public.mjs). Each file is already public on the origin by hash; the CDN is a faster transport for it, not a licence. rights = the core index licence text, unchanged.',
    pins, objects,
  };
}

async function main() {
  const file = new URL('./served-public.json', import.meta.url);
  const next = JSON.stringify(await buildRecords(), null, 1) + '\n';
  if (process.argv.includes('--write')) { await writeFile(file, next); console.log(JSON.stringify({ wrote: file.pathname, objects: JSON.parse(next).objects.length })); return; }
  const now = existsSync(file) ? await readFile(file, 'utf8') : '';
  if (now !== next) { console.error('served-public.json is stale: run node tools/cdn/served-public.mjs --write and review the diff'); process.exitCode = 1; }
  else console.log('served-public.json is current');
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
