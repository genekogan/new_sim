#!/usr/bin/env node
// Nightly backup of one launcher stage (lane CLOUD; run by sim-worlds-backup@<stage>.service as simworlds):
//   node backup.mjs <dataDir> <backupRoot>
// Writes <backupRoot>/<YYYYMMDD>/{accounts.sqlite, worlds.json, worlds/<slug>.db} with SQLite's online backup API
// (consistent while the launcher and its worlds keep writing). Retention: the newest 14 nightly sets keep the small
// files; world databases are kept only in the newest 2 sets (each world also keeps its own hourly/daily backups in
// its data dir). Prints one summary line; exits non-zero if any copy failed.
import { backup, DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [dataDir, root] = process.argv.slice(2);
if (!dataDir || !root) { console.error('usage: backup.mjs <dataDir> <backupRoot>'); process.exit(2); }
const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const out = join(root, day);
mkdirSync(join(out, 'worlds'), { recursive: true });

let ok = 0, failed = 0;
async function copyDb(src, dest) {
  if (!existsSync(src)) return;
  const db = new DatabaseSync(src);
  try { await backup(db, `${dest}.tmp`); renameSync(`${dest}.tmp`, dest); ok++; }
  catch (e) { failed++; console.error(`backup ${src}: ${e.message}`); }
  finally { db.close(); }
}

await copyDb(join(dataDir, 'accounts.sqlite'), join(out, 'accounts.sqlite'));
if (existsSync(join(dataDir, 'worlds.json'))) { copyFileSync(join(dataDir, 'worlds.json'), join(out, 'worlds.json')); ok++; }
const worldsDir = join(dataDir, 'worlds');
for (const slug of existsSync(worldsDir) ? readdirSync(worldsDir) : []) await copyDb(join(worldsDir, slug, 'sim.db'), join(out, 'worlds', `${slug}.db`));

const sets = readdirSync(root).filter((d) => /^\d{8}$/.test(d)).sort().reverse();
for (const d of sets.slice(14)) rmSync(join(root, d), { recursive: true, force: true });
for (const d of sets.slice(2, 14)) rmSync(join(root, d, 'worlds'), { recursive: true, force: true });
const mb = (p) => Math.round(readdirSync(p, { recursive: true }).reduce((n, f) => { const s = statSync(join(p, f)); return n + (s.isFile() ? s.size : 0); }, 0) / 2 ** 20);
console.log(`backup ${day}: ${ok} copied, ${failed} failed, ${mb(out)} MB in ${out}; ${Math.min(sets.length, 14)} nightly sets kept`);
if (failed) process.exitCode = 1;
