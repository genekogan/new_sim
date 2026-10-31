#!/usr/bin/env node
// Fetch the repository's binary media (models, images, audio, fixture databases) from the asset CDN into the paths the
// code reads them from. Git carries only tools/assets/manifest.json: one entry per file, {path, sha256, bytes, url}.
// No credentials: every object is a public, immutable, content-addressed key. See tools/assets/README.md.
//
//   node tools/assets/pull.mjs [--set web,runtime,test] [--only <glob>[,<glob>]] [--dest <tree>] [--cache <dir>]
//                              [--concurrency 8] [--from <tree>] [--offline] [--manifest <file>] [--quiet]
//   node tools/assets/pull.mjs --check [--remote] [...same filters]   verify only, write nothing
//   node tools/assets/pull.mjs entry <file>...                        print manifest entries for new files
//
// Order per file: already in place with the right bytes → skip; else the shared content-addressed cache
// (<cache>/<sha[:2]>/<sha>, one copy for every checkout on the machine); else --from <tree> (another checkout that has
// the file); else GET <url>. Every byte that lands is checked against sha256 + size of the decoded file. Exit 1 lists
// every path that is missing or wrong.
import { createHash, randomBytes } from 'node:crypto';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readlink, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const MANIFEST = join(ROOT, 'tools/assets/manifest.json');
export const SETS = ['web', 'runtime', 'test'];
export const defaultCache = () => process.env.SIM_ASSETS_CACHE || join(homedir(), '.cache/sim-assets');
const SHA = /^[0-9a-f]{64}$/;
const MAX_CONCURRENCY = 32;

/** A glob over repo paths: `**` crosses directories, `*` and `?` do not. A trailing `/` means everything under it. */
export function globToRegExp(glob) {
  const g = glob.endsWith('/') ? `${glob}**` : glob;
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') { re += g[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += g[i + 2] === '/' ? 2 : 1; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export async function loadManifest(file = MANIFEST) {
  const m = JSON.parse(await readFile(file, 'utf8'));
  if (m.version !== 1 || !Array.isArray(m.files)) throw Error(`${file}: not a version 1 asset manifest`);
  const seen = new Set();
  for (const f of m.files) {
    if (typeof f.path !== 'string' || f.path.startsWith('/') || f.path.split('/').includes('..') || seen.has(f.path)) throw Error(`bad or duplicate path in manifest: ${f.path}`);
    seen.add(f.path);
    if (!SETS.includes(f.set)) throw Error(`${f.path}: unknown set ${f.set}`);
    if (f.symlink !== undefined) { if (typeof f.symlink !== 'string' || f.symlink.startsWith('/')) throw Error(`${f.path}: bad symlink`); continue; }
    if (!SHA.test(f.sha256) || !Number.isSafeInteger(f.bytes) || f.bytes < 0 || !/^https:\/\/[^/]+\/\S+$/.test(f.url)) throw Error(`${f.path}: entry needs sha256, bytes and an https url`);
  }
  return m;
}

export function select(files, { sets = SETS, only = [] } = {}) {
  const res = only.map(globToRegExp);
  return files.filter(f => sets.includes(f.set) && (!res.length || res.some(r => r.test(f.path))));
}

async function hashFile(file) {
  const h = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(file)) { h.update(chunk); bytes += chunk.length; }
  return { sha256: h.digest('hex'), bytes };
}

/** Size+mtime+inode → sha256 per destination tree, so a re-run does not rehash every file. Kept in the cache dir. */
async function openState(cache, dest) {
  const file = join(cache, 'state', createHash('sha256').update(resolve(dest)).digest('hex').slice(0, 32) + '.json');
  let data = {};
  try { data = JSON.parse(await readFile(file, 'utf8')); } catch {}
  return {
    async sha(path, abs) {
      const s = await stat(abs), key = `${s.size}:${s.mtimeMs}:${s.ino}`;
      if (data[path]?.key === key) return { sha256: data[path].sha256, bytes: s.size };
      const d = await hashFile(abs); data[path] = { key, sha256: d.sha256 }; return d;
    },
    forget(path) { delete data[path]; },
    async save() { try { await mkdir(dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(data)); } catch {} },
  };
}

const exists = p => lstat(p).then(() => true, () => false);
const tmpName = p => `${p}.${randomBytes(4).toString('hex')}.part`;

/** Is <dest>/<path> already the right file (or the right symlink)? */
async function inPlace(f, dest, state) {
  const abs = join(dest, f.path);
  if (f.symlink !== undefined) return readlink(abs).then(t => t === f.symlink, () => false);
  try {
    const s = await lstat(abs);
    if (!s.isFile() || s.size !== f.bytes) return false;
    const d = await state.sha(f.path, abs);
    return d.sha256 === f.sha256 && d.bytes === f.bytes;
  } catch { return false; }
}

/** Stream a URL, hashing the decoded body. With `to`, the bytes are written there (deleted again on any mismatch). */
export async function fetchVerified(url, f, to, { fetcher = fetch, tries = 3 } = {}) {
  let last;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetcher(url, { headers: { 'accept-encoding': 'br, gzip' }, redirect: 'follow', signal: AbortSignal.timeout(300_000) });
      if (res.status === 404 || res.status === 403) { await res.body?.cancel(); throw Object.assign(Error(`HTTP ${res.status} (not published?)`), { final: true }); }
      if (!res.ok || !res.body) { await res.body?.cancel(); throw Error(`HTTP ${res.status}`); }
      const h = createHash('sha256'); let bytes = 0;
      const tap = async function* (source) { for await (const chunk of source) { h.update(chunk); bytes += chunk.length; if (to) yield chunk; } };
      if (to) await pipeline(Readable.fromWeb(res.body), tap, createWriteStream(to));
      else for await (const _ of tap(Readable.fromWeb(res.body))) ;
      const sha256 = h.digest('hex');
      if (sha256 !== f.sha256 || bytes !== f.bytes) throw Object.assign(Error(`got ${bytes} bytes sha256 ${sha256.slice(0, 12)}…, want ${f.bytes} bytes ${f.sha256.slice(0, 12)}…`), { final: true });
      return { bytes };
    } catch (e) {
      last = e; if (to) await rm(to, { force: true });
      if (e.final || attempt === tries) break;
      await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw last;
}

/** Put one file in place: cache → --from tree → network, then copy (clone on APFS) into the destination and verify. */
async function place(f, opts, state) {
  const abs = join(opts.dest, f.path);
  await mkdir(dirname(abs), { recursive: true });
  if (f.symlink !== undefined) { await rm(abs, { force: true }); await symlink(f.symlink, abs); return 'linked'; }
  const cached = join(opts.cache, f.sha256.slice(0, 2), f.sha256);
  let how = 'cache';
  if (!(await exists(cached))) {
    await mkdir(dirname(cached), { recursive: true });
    const part = tmpName(cached);
    const local = opts.from && join(opts.from, f.path);
    if (local && (await exists(local)) && (await hashFile(local).then(d => d.sha256 === f.sha256 && d.bytes === f.bytes, () => false))) {
      await copyFile(local, part, constants.COPYFILE_FICLONE); how = 'from';
    } else if (opts.offline) throw Error(opts.from ? 'not in the cache or --from tree (offline)' : 'not in the cache (offline)');
    else { await fetchVerified(f.url, f, part, opts); how = 'downloaded'; }
    await rename(part, cached);
  }
  // A copy, not a hard link: a tool rewriting the file in one checkout must never change the cache or other checkouts.
  const part = tmpName(abs);
  await copyFile(cached, part, constants.COPYFILE_FICLONE);
  const d = await hashFile(part);
  if (d.sha256 !== f.sha256 || d.bytes !== f.bytes) { await rm(part, { force: true }); await rm(cached, { force: true }); throw Error('cache entry was corrupt (removed); run again'); }
  await rm(abs, { force: true }); await rename(part, abs); state.forget(f.path);
  return how;
}

async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; await fn(items[i], i); } }));
}

export async function run(options) {
  const opts = { manifest: MANIFEST, dest: ROOT, cache: defaultCache(), concurrency: 8, sets: SETS, only: [], ...options };
  const manifest = await loadManifest(opts.manifest);
  const files = select(manifest.files, opts);
  const state = await openState(opts.cache, opts.dest);
  const counts = {}, failed = [];
  const tally = k => { counts[k] = (counts[k] || 0) + 1; };
  let done = 0, bytes = 0;
  const progress = () => { if (!opts.quiet && process.stderr.isTTY) process.stderr.write(`\r  ${done}/${files.length} files, ${(bytes / 1e6).toFixed(1)} MB`); };
  await pool(files, opts.concurrency, async f => {
    try {
      if (opts.check && opts.remote) {
        if (f.symlink !== undefined) tally('symlink');
        else { await fetchVerified(f.url, f, null, opts); tally('on cdn'); bytes += f.bytes; }
      } else if (await inPlace(f, opts.dest, state)) tally('ok');
      else if (opts.check) { failed.push({ path: f.path, error: (await exists(join(opts.dest, f.path))) ? 'wrong bytes' : 'missing' }); }
      else { tally(await place(f, opts, state)); bytes += f.bytes || 0; }
    } catch (e) { failed.push({ path: f.path, url: f.url, error: e.message }); }
    done++; progress();
  });
  if (!opts.quiet && process.stderr.isTTY) process.stderr.write('\n');
  await state.save();
  return { files: files.length, counts, failed };
}

/** Manifest entries for files about to leave git: publish each object at its url first (tools/cdn/publish.mjs). */
export async function entry(paths, { root = ROOT, cdn = 'https://assets.eden.art', set = 'runtime' } = {}) {
  const out = [];
  for (const p of paths) {
    const abs = resolve(p), path = relative(root, abs), d = await hashFile(abs);
    out.push({ path, sha256: d.sha256, bytes: d.bytes, url: `${cdn}/assets/${d.sha256.slice(0, 2)}/${d.sha256}${extname(path).toLowerCase()}`, set });
  }
  return out;
}

function parse(argv) {
  const o = { manifest: MANIFEST, dest: ROOT, cache: defaultCache(), concurrency: 8, sets: SETS, only: [], check: false, remote: false, offline: false, quiet: false, from: null };
  const val = (i, k) => { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) throw Error(`${k} needs a value`); return v; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--check': o.check = true; break;
      case '--remote': o.remote = true; break;
      case '--offline': o.offline = true; break;
      case '--quiet': o.quiet = true; break;
      case '--all': o.sets = SETS; break;
      case '--set': o.sets = val(i, a).split(','); i++; if (o.sets.some(s => !SETS.includes(s))) throw Error(`--set takes ${SETS.join(',')}`); break;
      case '--only': o.only.push(...val(i, a).split(',').filter(Boolean)); i++; break;
      case '--dest': o.dest = resolve(val(i, a)); i++; break;
      case '--cache': o.cache = resolve(val(i, a)); i++; break;
      case '--from': o.from = resolve(val(i, a)); i++; break;
      case '--manifest': o.manifest = resolve(val(i, a)); i++; break;
      case '--concurrency': o.concurrency = Number(val(i, a)); i++; if (!Number.isInteger(o.concurrency) || o.concurrency < 1) throw Error('--concurrency takes a positive integer'); o.concurrency = Math.min(o.concurrency, MAX_CONCURRENCY); break;
      case '-h': case '--help': o.help = true; break;
      default: throw Error(`unknown argument ${a} (see --help)`);
    }
  }
  if (o.remote && !o.check) throw Error('--remote goes with --check');
  return o;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === 'entry') {
    const set = argv.includes('--set') ? argv[argv.indexOf('--set') + 1] : 'runtime';
    for (const e of await entry(argv.slice(1).filter((a, i, all) => a !== '--set' && all[i - 1] !== '--set'), { set })) console.log(JSON.stringify(e));
    return;
  }
  const o = parse(argv);
  if (o.help) { console.log(readHelp()); return; }
  const what = o.check ? (o.remote ? 'checking the CDN for' : 'checking') : 'pulling';
  if (!o.quiet) console.error(`assets: ${what} ${relative(process.cwd(), o.dest) || '.'} (sets ${o.sets.join(',')}${o.only.length ? `, only ${o.only.join(',')}` : ''})`);
  const r = await run(o);
  const summary = Object.entries(r.counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing';
  if (!r.failed.length) { if (!o.quiet) console.error(`assets: ${r.files} files: ${summary}`); return; }
  const shown = o.check && !o.remote ? 10 : 40;
  for (const f of r.failed.slice(0, shown)) console.error(`  ${f.path}: ${f.error}`);
  if (r.failed.length > shown) console.error(`  … and ${r.failed.length - shown} more`);
  const verb = o.check ? (o.remote ? 'not on the CDN' : 'not in place') : 'failed';
  console.error(`assets: ${r.failed.length} of ${r.files} files ${verb} (${summary})${o.check && !o.remote ? '. Run: pnpm assets:pull' : ''}`);
  process.exitCode = 1;
}
const readHelp = () => {
  const src = fileURLToPath(import.meta.url);
  return `see the header of ${relative(process.cwd(), src)} and tools/assets/README.md`;
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(e => { console.error(`assets: ${e.message}`); process.exitCode = 2; });
