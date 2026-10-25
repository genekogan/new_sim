#!/usr/bin/env node
// Build the MARS_WEB_DIR asset overlay from production URLs, for a machine without the laptop's root-worlds mars-web
// (the cloud box). Without it a dev world proxies /modular and /browser to sim.mars.college, which the cloud cannot reach.
//
//   node tools/playtest/arena/assets-overlay.mjs <dir> [--only manifests,draco,browser,kit,environment]
//        [--origin https://sim.eden.art] [--server-root <root>] [--concurrency 6] [--probe]
//   --probe: no downloads; a 1-byte GET of every URL the plan holds (kit parts and the Draco list need the kit.json
//   and static-manifest.json already in <dir>, e.g. from a previous `--only manifests,kit`).
//
// Layout (what apps/server/src/mars-static.ts serves from MARS_WEB_DIR):
//   static-manifest.json, campus-manifest.json  ← <origin>/mars-assets/<name>   (metadata; static lists the Draco files)
//   draco/<file>                                 ← <origin>/mars-assets/draco/<file>   (served at /mars-assets/draco/)
//   browser/campus.glb                           ← <origin>/browser/campus.glb (sha256 checked against campus-manifest)
//   modular/humanoid/kit.json + every .glb it names (parts/*, rig-*.glb) ← <origin>/modular/humanoid/<path>
//   modular/environment/*.glb                    ← <origin>/modular/environment/<name>: the known set plus any name the
//                                                  server root's apps/web/src and apps/server/src reference
// Resumable: finished files are kept (downloads land in .part and are renamed); <dir>/overlay-manifest.json records
// url, bytes and sha256 of every file and what was missing. Exit 1 when a required file could not be fetched.
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, createReadStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const GROUPS = ['manifests', 'draco', 'browser', 'kit', 'environment'];
export const DEFAULT_DRACO = ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js'];
export const DEFAULT_ENVIRONMENT = ['animated-casual.glb', 'animated-casual.mesh.glb', 'animated-punk.glb', 'animated-punk.mesh.glb', 'animated-woman.glb', 'animated-woman.mesh.glb', 'clips-ual.glb', 'clips-ual-woman.glb', 'eden-animals.glb', 'eden-boats-bikes.glb', 'eden-crops.glb', 'eden-food.glb', 'eden-interior.glb', 'eden-nature.glb'];
const BROWSER = ['campus.glb'];

const readJsonFile = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

/** Every .glb path a kit.json names (relative to modular/humanoid/), sorted and unique. */
export function kitFiles(kit) {
  const out = new Set();
  const walk = (v) => { if (typeof v === 'string') { if (/^[\w./-]+\.glb$/.test(v) && !v.includes('..') && !v.startsWith('/')) out.add(v); } else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(kit); return [...out].sort();
}

/** Environment GLB names referenced by a server root's web and server sources (tests and fixtures skipped). */
export function scanEnvironment(serverRoot) {
  const names = new Set();
  const walk = (d) => {
    let ents; try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (!['node_modules', 'dist', 'fixtures', '__tests__'].includes(e.name)) walk(p); continue; }
      if (!/\.(ts|tsx|mjs|js|json)$/.test(e.name) || /\.test\./.test(e.name)) continue;
      for (const m of readFileSync(p, 'utf8').matchAll(/\/modular\/environment\/([\w.-]+\.glb)/g)) names.add(m[1]);
    }
  };
  for (const sub of ['apps/web/src', 'apps/server/src']) walk(join(serverRoot, sub));
  return [...names].sort();
}

/** The download list for the chosen groups. Reads already-fetched manifests/kit from dir for the dependent lists.
 *  → [{rel, url, group, required, sha256?}] */
export function planOverlay(dir, { origin = 'https://sim.eden.art', only = GROUPS, serverRoot = null } = {}) {
  const o = origin.replace(/\/+$/, '');
  const items = [];
  const add = (group, rel, url, required = true, sha256 = null) => items.push({ group, rel, url, required, ...(sha256 ? { sha256 } : {}) });
  if (only.includes('manifests')) for (const n of ['static-manifest.json', 'campus-manifest.json']) add('manifests', n, `${o}/mars-assets/${n}`);
  if (only.includes('draco')) {
    const sm = readJsonFile(join(dir, 'static-manifest.json'));
    const files = Array.isArray(sm?.files) && sm.files.length ? sm.files.filter((f) => /^[\w.-]+$/.test(f?.name ?? '')) : DEFAULT_DRACO.map((name) => ({ name }));
    for (const f of files) add('draco', `draco/${f.name}`, `${o}/mars-assets/draco/${f.name}`, true, f.sha256);
  }
  if (only.includes('browser')) {
    const cm = readJsonFile(join(dir, 'campus-manifest.json'));
    for (const n of BROWSER) add('browser', `browser/${n}`, `${o}/browser/${n}`, true, n === 'campus.glb' ? cm?.sha256 : null);
  }
  if (only.includes('kit')) {
    add('kit', 'modular/humanoid/kit.json', `${o}/modular/humanoid/kit.json`);
    const kit = readJsonFile(join(dir, 'modular/humanoid/kit.json'));
    if (kit) for (const f of kitFiles(kit)) add('kit', `modular/humanoid/${f}`, `${o}/modular/humanoid/${f}`);
  }
  if (only.includes('environment')) {
    const scanned = serverRoot ? scanEnvironment(serverRoot) : [];
    for (const n of [...new Set([...DEFAULT_ENVIRONMENT, ...scanned])].sort()) add('environment', `modular/environment/${n}`, `${o}/modular/environment/${n}`, DEFAULT_ENVIRONMENT.includes(n));
  }
  return items;
}

const sha256File = async (p) => { const h = createHash('sha256'); await pipeline(createReadStream(p), h); return h.digest('hex'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fetch one item into dir (resume: an existing final file is kept). → {rel, url, bytes, sha256} or {missing:true, status} */
export async function fetchItem(dir, it, { fetchImpl = fetch, tries = 4 } = {}) {
  const dst = join(dir, it.rel);
  if (existsSync(dst) && statSync(dst).size > 0) {
    const sha = await sha256File(dst);
    if (!it.sha256 || it.sha256 === sha) return { rel: it.rel, url: it.url, bytes: statSync(dst).size, sha256: sha, resumed: true };
    rmSync(dst); // stale or corrupt against the published sha256: fetch again
  }
  mkdirSync(dirname(dst), { recursive: true });
  let last = null;
  for (let i = 0; i < tries; i++) {
    if (i) await sleep(1000 * 2 ** i);
    try {
      const r = await fetchImpl(it.url, { redirect: 'follow', signal: AbortSignal.timeout(300000) });
      const type = r.headers.get('content-type') ?? '';
      if (r.status === 404 || (r.ok && /text\/html/i.test(type) && !it.rel.endsWith('.html'))) { await r.body?.cancel?.(); return { rel: it.rel, url: it.url, missing: true, status: r.ok ? 'html fallback' : r.status }; }
      if (!r.ok) { last = `HTTP ${r.status}`; await r.body?.cancel?.(); continue; }
      const part = `${dst}.part`;
      await pipeline(Readable.fromWeb(r.body), createWriteStream(part));
      const sha = await sha256File(part);
      if (it.sha256 && it.sha256 !== sha) { rmSync(part, { force: true }); last = `sha256 ${sha.slice(0, 12)} != published ${it.sha256.slice(0, 12)}`; continue; }
      renameSync(part, dst);
      return { rel: it.rel, url: it.url, bytes: statSync(dst).size, sha256: sha };
    } catch (e) { last = String(e?.message ?? e).slice(0, 160); }
  }
  return { rel: it.rel, url: it.url, missing: true, status: last };
}

async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }

/** Build (or resume) the overlay. Groups run in dependency order: manifests before draco/browser, kit.json before parts. */
export async function buildOverlay(dir, { origin = 'https://sim.eden.art', only = GROUPS, serverRoot = null, concurrency = 6, fetchImpl = fetch, log = () => {} } = {}) {
  dir = resolve(dir); mkdirSync(dir, { recursive: true });
  const manFile = join(dir, 'overlay-manifest.json');
  const prev = readJsonFile(manFile);
  const files = new Map((prev?.files ?? []).map((f) => [f.rel, f]));
  const missing = new Map();
  const phases = [['manifests', 'kit'], ['draco', 'browser', 'kit', 'environment']].map((p) => p.filter((g) => only.includes(g)));
  const done = new Set();
  for (const groups of phases) {
    if (!groups.length) continue;
    const items = planOverlay(dir, { origin, only: groups, serverRoot }).filter((it) => !done.has(it.rel));
    const res = await pool(items, concurrency, (it) => fetchItem(dir, it, { fetchImpl }));
    res.forEach((r, k) => { const it = items[k]; done.add(it.rel); if (r.missing) { missing.set(it.rel, { ...r, required: it.required, group: it.group }); files.delete(it.rel); } else { files.set(it.rel, { group: it.group, ...r, resumed: undefined }); missing.delete(it.rel); } });
    log(`${groups.join('+')}: ${res.filter((r) => !r.missing).length} ok (${res.filter((r) => r.resumed).length} kept), ${res.filter((r) => r.missing).length} missing`);
  }
  const manifest = { version: 1, origin, builtAt: new Date().toISOString(), groups: only, files: [...files.values()].sort((a, b) => a.rel.localeCompare(b.rel)), missing: [...missing.values()] };
  manifest.bytes = manifest.files.reduce((a, f) => a + (f.bytes ?? 0), 0);
  writeFileSync(manFile, JSON.stringify(manifest, null, 1));
  return { ...manifest, ok: !manifest.missing.some((m) => m.required), manifestFile: manFile };
}

/** Probe every planned URL with a 1-byte range GET (no files written): the full URL list with status and type. */
export async function probeOverlay(dir, opts = {}) {
  const items = planOverlay(dir, opts);
  return pool(items, opts.concurrency ?? 8, async (it) => {
    try { const r = await fetch(it.url, { headers: { range: 'bytes=0-0' }, signal: AbortSignal.timeout(30000) }); const type = r.headers.get('content-type') ?? ''; const size = r.headers.get('content-range')?.split('/')[1] ?? r.headers.get('content-length'); await r.body?.cancel?.(); return { ...it, status: r.status, type, size: size ? Number(size) : null, ok: (r.status === 200 || r.status === 206) && !/text\/html/i.test(type) }; }
    catch (e) { return { ...it, status: null, ok: false, error: String(e?.message ?? e).slice(0, 120) }; }
  });
}

async function main() {
  const argv = process.argv.slice(2); const flag = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  const dir = argv.find((x, i) => !x.startsWith('--') && !argv[i - 1]?.startsWith('--'));
  if (!dir) { console.error('usage: assets-overlay.mjs <dir> [--only manifests,draco,browser,kit,environment] [--origin url] [--server-root dir] [--concurrency n]'); process.exit(1); }
  const only = String(flag('only', GROUPS.join(','))).split(',').filter((g) => GROUPS.includes(g));
  const t0 = Date.now();
  if (argv.includes('--probe')) {
    const rows = await probeOverlay(resolve(dir), { origin: flag('origin', 'https://sim.eden.art'), serverRoot: flag('server-root', null) });
    for (const x of rows) console.log(`${x.ok ? 'ok ' : 'BAD'} ${String(x.status).padEnd(4)} ${String(x.size ?? '?').padStart(9)} ${x.required ? 'req' : 'opt'} ${x.url}`);
    const bad = rows.filter((x) => !x.ok && x.required);
    console.error(`[overlay] probe: ${rows.length} urls, ${rows.filter((x) => x.ok).length} ok, ${bad.length} required missing, ${Math.round(rows.reduce((a, x) => a + (x.ok ? x.size ?? 0 : 0), 0) / 1048576)} MB`);
    process.exit(bad.length ? 1 : 0);
  }
  const r = await buildOverlay(dir, { origin: flag('origin', 'https://sim.eden.art'), only, serverRoot: flag('server-root', null), concurrency: Number(flag('concurrency', 6)), log: (m) => console.error(`[overlay] ${m}`) });
  console.log(JSON.stringify({ ok: r.ok, dir: resolve(dir), files: r.files.length, bytes: r.bytes, missing: r.missing.map((m) => `${m.rel} (${m.status}${m.required ? ', required' : ''})`), seconds: Math.round((Date.now() - t0) / 1000), manifest: r.manifestFile }, null, 1));
  process.exit(r.ok ? 0 : 1);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
