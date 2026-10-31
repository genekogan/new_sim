#!/usr/bin/env node
// The Mars viewer's static site, mars/viewer/dist/client, is the server's MARS_WEB_DIR: it serves the people's character
// set under /modular (the humanoid kit, its parts and rigs, the animated bodies and clips). Without it every world
// shows "The world could not be prepared: Person … could not be prepared" and draws no people (issue #395).
//
//   node tools/assets/mars-web.mjs            build it when its inputs changed, then check it (pnpm predev, pnpm build)
//   node tools/assets/mars-web.mjs --check    check only, build nothing: exit 1 when the character set is missing
//   node tools/assets/mars-web.mjs --force    build even when nothing changed
//
// "Changed" is a stamp: sha256 over the path, size and mtime of every build input (mars/viewer without its outputs
// and dependencies, plus pnpm-lock.yaml), kept in dist/client/.sim-build.json. When the stamp matches and the
// character set is complete the run is one directory walk (a few thousand stats, well under a second), no build.
// When the media is not pulled yet it warns and builds nothing (`pnpm dev` keeps starting, as with the media check).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const VIEWER = join(ROOT, 'mars/viewer');
export const OUT = join(VIEWER, 'dist/client');
export const STAMP = '.sim-build.json';
const PUBLIC = 'mars/viewer/public/';
// Outputs, dependencies and local state under mars/viewer, never build inputs.
const SKIP = new Set(['node_modules', 'dist', '.cloudflare', '.wrangler', '.pw-browsers', 'test-results', '.e2e', 'e2e']);

/** The character set, as paths relative to the site root with their sizes: every /modular file the media manifest
 *  lists, plus the kit files git tracks. */
export function characterSet(root = ROOT) {
  const manifest = JSON.parse(readFileSync(join(root, 'tools/assets/manifest.json'), 'utf8'));
  const files = manifest.files.filter(f => f.path.startsWith(PUBLIC + 'modular/')).map(f => ({ path: f.path.slice(PUBLIC.length), bytes: f.bytes }));
  for (const path of ['modular/humanoid/kit.json']) {
    const src = join(root, PUBLIC, path);
    files.push({ path, bytes: existsSync(src) ? statSync(src).size : undefined });
  }
  return files;
}

/** Character-set files missing from `dir` (a built site, or the viewer's public/ source), or of the wrong size. */
export function missingCharacters(dir, set = characterSet()) {
  return set.filter(({ path, bytes }) => {
    const p = join(dir, path);
    if (!existsSync(p)) return true;
    return bytes !== undefined && statSync(p).size !== bytes;
  }).map(f => f.path);
}

/** sha256 over every build input's relative path, size and mtime (symlinks followed). */
export function inputStamp(viewer = VIEWER, extra = [join(ROOT, 'pnpm-lock.yaml')]) {
  const rows = [];
  const walk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const p = join(dir, e.name);
      let s; try { s = statSync(p); } catch { continue; } // a dangling link is not an input
      if (s.isDirectory()) walk(p);
      else if (s.isFile()) rows.push(`${relative(viewer, p).split(sep).join('/')}\0${s.size}\0${s.mtimeMs}`);
    }
  };
  walk(viewer);
  for (const p of extra) if (existsSync(p)) { const s = statSync(p); rows.push(`${relative(ROOT, p).split(sep).join('/')}\0${s.size}\0${s.mtimeMs}`); }
  return createHash('sha256').update(rows.sort().join('\n')).digest('hex');
}

const readStamp = out => { try { return JSON.parse(readFileSync(join(out, STAMP), 'utf8')).inputs; } catch { return undefined; } };

function viteBuild(viewer) {
  const vite = join(viewer, 'node_modules/vite/bin/vite.js');
  if (!existsSync(vite)) throw Error(`mars-web: ${relative(ROOT, vite)} is missing; run pnpm install`);
  // The plain static build: never the Cloudflare release's public dir (CLOUDFLARE_RELEASE) or the /mars-assets/ base.
  const env = { ...process.env }; delete env.CLOUDFLARE_RELEASE; delete env.SIM_STATIC;
  const r = spawnSync(process.execPath, [vite, 'build', '--logLevel', 'error'], { cwd: viewer, env, stdio: 'inherit' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw Error(`mars-web: the viewer build failed (exit ${r.status})`);
}

/** `viewer`, `set`, `extra` and `build` are for tests; the defaults are this checkout's viewer and vite build. */
export function main(argv = process.argv.slice(2), log = console.log, { viewer = VIEWER, set = characterSet(), extra, build = viteBuild } = {}) {
  const check = argv.includes('--check'), force = argv.includes('--force');
  const out = join(viewer, 'dist/client');
  if (check) {
    const missing = missingCharacters(out, set);
    if (missing.length) { log(`mars-web: ${missing.length} of ${set.length} character files missing from ${relative(ROOT, out)} (first: ${missing.slice(0, 3).join(', ')}); run pnpm build:viewer`); return 1; }
    log(`mars-web: ${set.length} character files in ${relative(ROOT, out)}`); return 0;
  }
  const source = missingCharacters(join(viewer, 'public'), set);
  if (source.length) { log(`warning: ${source.length} character files missing from ${PUBLIC} (people will not render); run pnpm assets:pull`); return 0; }
  const stamp = inputStamp(viewer, extra);
  if (!force && readStamp(out) === stamp && !missingCharacters(out, set).length) return 0;
  const t0 = Date.now();
  build(viewer);
  const missing = missingCharacters(out, set);
  if (missing.length) { log(`mars-web: the build left ${missing.length} character files out of ${relative(ROOT, out)} (first: ${missing.slice(0, 3).join(', ')})`); return 1; }
  writeFileSync(join(out, STAMP), JSON.stringify({ inputs: stamp }) + '\n');
  log(`mars-web: built ${relative(ROOT, out)} in ${((Date.now() - t0) / 1000).toFixed(1)} s (${set.length} character files)`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { process.exitCode = main(); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
