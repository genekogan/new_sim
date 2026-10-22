#!/usr/bin/env node
// Absorbs Gene's Sim Score (a separate git repository: Tone.js music written as code) into vendor/sim-score/, so Sim builds,
// tests and runs without it. Copies the files of one sim-score commit byte for byte (site/: engine, pieces, catalog, the
// browser page; the Node lint harness tools/load.mjs + lint.mjs + score.mjs; README.md, COMPOSING.md), removes vendored
// files the commit no longer has, rewrites vendor/sim-score/PROVENANCE.json (source commit, sha256 per file) and prints
// which pieces, engine modules and other files were added, changed or removed.
//
//   node tools/score/sync-sim-score.mjs <path-to-sim-score> [commit]     (commit defaults to HEAD)
//
// Refuses a source with uncommitted changes under the vendored paths, and a vendored copy that was edited by hand (a
// file whose bytes no longer match PROVENANCE.json): fix pieces in sim-score, commit there, and sync.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const VENDOR = resolve(root, 'vendor/sim-score');
const PROVENANCE = join(VENDOR, 'PROVENANCE.json');
/** What Sim keeps of sim-score: the site and the lint harness. Renders (MP3s) and the render/stage scripts stay there. */
const INCLUDE = (p) => p.startsWith('site/') || ['README.md', 'COMPOSING.md', 'tools/load.mjs', 'tools/lint.mjs', 'tools/score.mjs', 'tools/serve.py'].includes(p);
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/** The vendored files on disk, relative to vendor/sim-score (PROVENANCE.json excluded). */
function vendoredOnDisk(dir = VENDOR, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) vendoredOnDisk(p, out); else if (p !== PROVENANCE) out.push(relative(VENDOR, p));
  }
  return out.sort();
}

/** Every vendored file still has the bytes PROVENANCE.json records, and nothing is there that it does not list. */
export function checkVendored() {
  const prov = JSON.parse(readFileSync(PROVENANCE, 'utf8'));
  const listed = new Map(prov.files.map((f) => [f.path, f.sha256]));
  const problems = [];
  for (const [p, h] of listed) {
    const f = join(VENDOR, p);
    if (!existsSync(f)) problems.push(`missing ${p}`); else if (sha256(readFileSync(f)) !== h) problems.push(`edited ${p}`);
  }
  for (const p of vendoredOnDisk()) if (!listed.has(p)) problems.push(`not in PROVENANCE.json: ${p}`);
  return { prov, problems };
}

const kind = (p) => (/^site\/pieces\/[^/]+\.js$/.test(p) ? 'pieces' : /^site\/engine\/[^/]+\.js$/.test(p) ? 'engine modules' : 'other files');
const label = (p) => (kind(p) === 'other files' ? p : p.replace(/^.*\//, '').replace(/\.js$/, ''));

async function main() {
  const [srcArg, commitArg = 'HEAD'] = process.argv.slice(2);
  if (!srcArg) { console.error('usage: node tools/score/sync-sim-score.mjs <path-to-sim-score> [commit]'); process.exit(2); }
  const src = resolve(srcArg);
  const git = (...a) => execFileSync('git', ['-C', src, ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const commit = git('rev-parse', '--verify', `${commitArg}^{commit}`).trim();
  const listed = git('ls-tree', '-r', '-z', '--name-only', commit).split('\0').filter(Boolean);
  const paths = listed.filter(INCLUDE).sort();
  if (!paths.some((p) => p.startsWith('site/engine/')) || !paths.includes('tools/lint.mjs')) throw Error(`${src} @ ${commit.slice(0, 7)} does not look like sim-score (no site/engine or tools/lint.mjs)`);
  const dirty = git('status', '--porcelain', '--untracked-files=all', '--', 'site', 'tools', 'README.md', 'COMPOSING.md').trim();
  if (dirty) { console.error(`refusing: ${src} has uncommitted changes (commit them in sim-score first):\n${dirty}`); process.exit(1); }

  let old = new Map(), was = 'first sync';
  if (existsSync(PROVENANCE)) {
    const { prov, problems } = checkVendored();
    if (problems.length) { console.error(`refusing: the vendored copy was changed by hand (fix it in sim-score instead):\n  ${problems.join('\n  ')}`); process.exit(1); }
    old = new Map(prov.files.map((f) => [f.path, f.sha256]));
    was = `was ${prov.source.commit.slice(0, 7)}`;
  }

  const files = [], changes = { added: [], changed: [], removed: [] };
  for (const p of paths) {
    const bytes = execFileSync('git', ['-C', src, 'cat-file', 'blob', `${commit}:${p}`], { maxBuffer: 1 << 26 });
    const h = sha256(bytes);
    files.push({ path: p, sha256: h, bytes: bytes.length });
    if (old.get(p) === h) continue;
    changes[old.has(p) ? 'changed' : 'added'].push(p);
    mkdirSync(dirname(join(VENDOR, p)), { recursive: true });
    writeFileSync(join(VENDOR, p), bytes);
  }
  for (const p of old.keys()) if (!paths.includes(p)) { changes.removed.push(p); rmSync(join(VENDOR, p)); }

  const [date, subject] = git('show', '-s', '--format=%cI%n%s', commit).trim().split('\n');
  writeFileSync(PROVENANCE, JSON.stringify({
    source: { repository: 'sim-score', path: src, commit, date, subject },
    syncedBy: 'tools/score/sync-sim-score.mjs',
    note: 'Byte-for-byte copy of the listed files at source.commit. Do not edit here: fix in sim-score, commit there, then sync.',
    files,
  }, null, 2) + '\n');

  console.log(`vendor/sim-score <- sim-score ${commit.slice(0, 7)} "${subject}" (${was}); ${files.length} files`);
  for (const k of ['pieces', 'engine modules', 'other files']) {
    const lines = ['added', 'changed', 'removed'].map((c) => [c, changes[c].filter((p) => kind(p) === k).map(label)]).filter(([, xs]) => xs.length);
    console.log(`  ${k}: ${lines.length ? lines.map(([c, xs]) => `${c} ${xs.length} (${xs.join(', ')})`).join('; ') : 'unchanged'}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
