#!/usr/bin/env node
// Versioned, deduplicated nightly backups of one launcher stage (lane BK, 2026-10-20; replaces backup.mjs's dated full copies).
//
//   node backup-restic.mjs backup <stage>                         nightly (sim-worlds-backup@<stage>.service, as simworlds)
//   node backup-restic.mjs restore <stage> <when> <dir>           when = latest | YYYY-MM-DD (UTC night) | snapshot id
//   node backup-restic.mjs list [<stage>]                         the snapshots kept
//
// backup: every SQLite database of the stage (accounts.sqlite, forks/accounts.sqlite, worlds/<slug>/sim.db) is copied with
// SQLite's online backup API in ONE step (consistent while the worlds write; the copy keeps the live file's page layout, so pages
// that did not change are byte-identical night to night and deduplicate: measured 13 MB/night against 24-29 MB for VACUUM INTO
// copies, whose page renumbering defeats dedup), each copy gets PRAGMA quick_check, plus worlds.json, audit.jsonl and the
// uploaded assets (worlds/assets, content-addressed, copied only when new). The copies sit in a staging mirror of the data dir
// (<staging>/<stage>/...), restic snapshots that mirror (tag <stage>), then forget+prune keeps SIM_BACKUP_KEEP (default 7 daily,
// 4 weekly, 6 monthly = at most 17 snapshots) and check reads a seventh of the data (all of it once a week).
// Off-box copy: set SIM_BACKUP_OFFSITE (e.g. an R2 bucket, s3:https://<account>.r2.cloudflarestorage.com/<bucket>) and its
// credentials (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) in the env file; each night then copies the new snapshots there
// (initialising it on first use with the same chunker, so it deduplicates the same way) and applies the same retention.
//
// restore: restores one snapshot's mirror into <dir> (refuses a non-empty dir), so <dir> is laid out like the stage's data dir;
// quick_checks every database; exits non-zero if any check fails. Boot one world from it:
//   ENABLE_WORLD_ENGINE=1 SOUL_LIFECYCLE=1 node tools/god-skill/dev-world.mjs <slug> <port> --data <dir>/worlds/<slug>
//   (SOUL_LIFECYCLE=1 as the launcher sets it: without it a production world's history refuses its engine, +crew-removal/1)
//
// Env (systemd: EnvironmentFile=-/etc/sim-worlds/backup.env; every key has a default):
//   RESTIC_REPOSITORY      /srv/sim-worlds-backups/restic        RESTIC_PASSWORD_FILE  /etc/sim-worlds/restic.pass
//   RESTIC_CACHE_DIR       /srv/sim-worlds-backups/.cache        SIM_BACKUP_DATA_ROOT  /srv/sim-worlds-data
//   SIM_BACKUP_STAGING     /srv/sim-worlds-backups/staging       SIM_BACKUP_KEEP       "--keep-daily 7 --keep-weekly 4 --keep-monthly 6"
//   SIM_BACKUP_OFFSITE     (unset = local only)                  RESTIC_BIN            restic
//   SIM_BACKUP_TIME        (tests only: the snapshot's time, "YYYY-MM-DD HH:MM:SS")
import { backup as sqliteBackup, DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, utimesSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join, relative } from 'node:path';

const env = {
  RESTIC_REPOSITORY: '/srv/sim-worlds-backups/restic', RESTIC_PASSWORD_FILE: '/etc/sim-worlds/restic.pass',
  RESTIC_CACHE_DIR: '/srv/sim-worlds-backups/.cache', ...process.env,
};
const BIN = env.RESTIC_BIN || 'restic';
const DATA_ROOT = env.SIM_BACKUP_DATA_ROOT || '/srv/sim-worlds-data';
const STAGING = env.SIM_BACKUP_STAGING || '/srv/sim-worlds-backups/staging';
const KEEP = (env.SIM_BACKUP_KEEP || '--keep-daily 7 --keep-weekly 4 --keep-monthly 6').split(/\s+/).filter(Boolean);
const HOST = hostname().split('.')[0];
const STAGE_RE = /^[a-z][a-z0-9-]{0,31}$/;

/** Run restic; returns stdout. Throws with restic's stderr on failure unless `ok` lists acceptable exit codes. */
function restic(args, { repo, ok = [0], quiet = false } = {}) {
  const r = spawnSync(BIN, [...(repo ? ['-r', repo] : []), ...args], { env, encoding: 'utf8', maxBuffer: 256 << 20 });
  if (r.error) throw new Error(`${BIN}: ${r.error.message}`);
  if (!ok.includes(r.status)) throw new Error(`restic ${args[0]} exited ${r.status}: ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' | ')}`);
  if (!quiet && r.stderr.trim()) process.stderr.write(r.stderr);
  return r.stdout;
}

const quickCheck = (file) => {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return String(Object.values(db.prepare('PRAGMA quick_check').get())[0]); } finally { db.close(); }
};

/** Mirror src into dst, copying only files whose size or mtime differ, deleting what src no longer has. Returns files copied. */
function mirror(src, dst) {
  let copied = 0;
  mkdirSync(dst, { recursive: true });
  const want = new Set(readdirSync(src));
  for (const name of readdirSync(dst)) if (!want.has(name)) rmSync(join(dst, name), { recursive: true, force: true });
  for (const name of want) {
    const s = join(src, name), d = join(dst, name), st = statSync(s);
    if (st.isDirectory()) { copied += mirror(s, d); continue; }
    if (!st.isFile()) continue;
    const dt = existsSync(d) ? statSync(d) : null;
    if (dt && dt.size === st.size && Math.abs(dt.mtimeMs - st.mtimeMs) < 1) continue;   // utimes(Date) keeps whole ms only
    copyFileSync(s, `${d}.tmp`); utimesSync(`${d}.tmp`, st.atime, st.mtime); renameSync(`${d}.tmp`, d); copied++;
  }
  return copied;
}

const repoBytes = (repo) => {
  if (/^[a-z0-9]+:/i.test(repo) || !existsSync(repo)) return null;   // remote (s3:, sftp:, rclone:) or missing
  return readdirSync(repo, { recursive: true }).reduce((n, f) => { try { const s = statSync(join(repo, f)); return n + (s.isFile() ? s.size : 0); } catch { return n; } }, 0);
};
const mb = (b) => (b / 2 ** 20).toFixed(1);

async function runBackup(stage) {
  const data = join(DATA_ROOT, stage), out = join(STAGING, stage);
  if (!existsSync(data)) throw new Error(`no data dir ${data}`);
  restic(['cat', 'config'], { quiet: true });   // the repository must exist (init is a deliberate step: a missing mount must not start a new empty repo)
  restic(['unlock'], { quiet: true });          // only removes stale locks (a killed run); live locks stay
  mkdirSync(out, { recursive: true });

  // 1. databases: the live set, by relative path inside the data dir
  const dbs = ['accounts.sqlite', join('forks', 'accounts.sqlite')].filter((f) => existsSync(join(data, f)));
  const worldsDir = join(data, 'worlds');
  for (const slug of existsSync(worldsDir) ? readdirSync(worldsDir).sort() : []) {
    if (existsSync(join(worldsDir, slug, 'sim.db'))) dbs.push(join('worlds', slug, 'sim.db'));
  }
  let ok = 0; const failed = [];
  for (const rel of dbs) {
    const src = join(data, rel), dest = join(out, rel);
    mkdirSync(dirname(dest), { recursive: true });
    const db = new DatabaseSync(src);
    try {
      // one complete step: the default 100-page steps restart whenever a live world writes in between (2026-10-19)
      await sqliteBackup(db, `${dest}.tmp`, { rate: 0x7fffffff });
      const check = quickCheck(`${dest}.tmp`);
      if (check !== 'ok') throw new Error(`quick_check: ${check.slice(0, 200)}`);
      renameSync(`${dest}.tmp`, dest); ok++;
    } catch (e) { failed.push(`${rel}: ${e.message}`); rmSync(`${dest}.tmp`, { force: true }); }
    finally { db.close(); }
  }
  // 2. small files and uploads
  const files = ['worlds.json', 'audit.jsonl'].filter((f) => existsSync(join(data, f)));
  for (const f of files) { copyFileSync(join(data, f), `${join(out, f)}.tmp`); renameSync(`${join(out, f)}.tmp`, join(out, f)); }
  const assets = existsSync(join(worldsDir, 'assets')) ? mirror(join(worldsDir, 'assets'), join(out, 'worlds', 'assets')) : 0;
  // 3. drop what the stage no longer has (a deleted world stays in older snapshots, not in the mirror)
  const keep = new Set([...dbs, ...files]);
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (relative(out, join(d, e.name)) === join('worlds', 'assets') ? [] : walk(join(d, e.name))) : [join(d, e.name)]);
  for (const f of walk(out)) {
    const rel = relative(out, f);
    if (!keep.has(rel) && !failed.some((x) => x.startsWith(`${rel}:`))) rmSync(f, { force: true });
  }
  for (const d of existsSync(join(out, 'worlds')) ? readdirSync(join(out, 'worlds')) : []) {
    const p = join(out, 'worlds', d);
    if (statSync(p).isDirectory() && readdirSync(p).length === 0) rmSync(p, { recursive: true, force: true });
  }

  // 4. snapshot, retention, check
  const before = repoBytes(env.RESTIC_REPOSITORY);
  const time = env.SIM_BACKUP_TIME ? ['--time', env.SIM_BACKUP_TIME] : [];
  const summary = restic(['backup', '--json', '--retry-lock', '1h', '--host', HOST, '--tag', stage, ...time, out]).split('\n')
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((m) => m?.message_type === 'summary');
  if (!summary?.snapshot_id) throw new Error('restic backup: no snapshot id in its summary');
  const forget = ['forget', '--retry-lock', '1h', '--host', HOST, '--tag', stage, ...KEEP, '--prune'];
  restic(forget, { quiet: true });
  const day = Number(new Date().getUTCDay());
  restic(['check', '--retry-lock', '1h', '--read-data-subset', `${day + 1}/7`], { quiet: true });
  const kept = JSON.parse(restic(['snapshots', '--json', '--host', HOST, '--tag', stage], { quiet: true }) || '[]').length;
  const after = repoBytes(env.RESTIC_REPOSITORY);

  // 5. off-box copy (one config line: SIM_BACKUP_OFFSITE)
  let offsite = '';
  if (env.SIM_BACKUP_OFFSITE) {
    const off = env.SIM_BACKUP_OFFSITE, from = ['--from-repo', env.RESTIC_REPOSITORY, '--from-password-file', env.RESTIC_PASSWORD_FILE];
    try {
      const inited = spawnSync(BIN, ['-r', off, 'cat', 'config'], { env, encoding: 'utf8' }).status === 0;
      if (!inited) restic(['init', ...from, '--copy-chunker-params'], { repo: off, quiet: true });
      restic(['copy', '--retry-lock', '1h', ...from, '--host', HOST, '--tag', stage], { repo: off, quiet: true });
      restic(forget, { repo: off, quiet: true });
      offsite = `; offsite ${inited ? 'copied' : 'initialised + copied'}`;
    } catch (e) { failed.push(`offsite: ${e.message}`); offsite = '; offsite FAILED'; }
  }

  const growth = before != null && after != null ? `, repo ${mb(after)} MB (${after >= before ? '+' : ''}${mb(after - before)} MB)` : '';
  console.log(`backup ${stage}: snapshot ${summary.snapshot_id.slice(0, 8)}, ${ok}/${dbs.length} databases ok (quick_check), ${files.length} files, ` +
    `${assets} new assets, ${mb(summary.total_bytes_processed ?? 0)} MB staged${growth}; ${kept} snapshots kept${offsite}`);
  for (const f of failed) console.error(`FAILED ${f}`);
  if (failed.length) process.exitCode = 1;
}

function snapshots(stage) {
  return JSON.parse(restic(['snapshots', '--json', ...(stage ? ['--tag', stage] : [])], { quiet: true }) || '[]')
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

function runRestore(stage, when, dir) {
  const all = snapshots(stage);
  if (!all.length) throw new Error(`no snapshots tagged ${stage}`);
  const pick = when === 'latest' ? all.at(-1)
    : /^\d{4}-\d{2}-\d{2}$/.test(when) ? all.filter((s) => new Date(s.time).toISOString().slice(0, 10) === when).at(-1)
      : all.find((s) => s.id.startsWith(when) || s.short_id === when);
  if (!pick) throw new Error(`no ${stage} snapshot for "${when}"; have: ${all.map((s) => `${s.short_id} ${new Date(s.time).toISOString().slice(0, 16)}Z`).join(', ')}`);
  if (existsSync(dir) && readdirSync(dir).length) throw new Error(`${dir} is not empty (restore never overwrites)`);
  mkdirSync(dir, { recursive: true });
  restic(['restore', `${pick.id}:${pick.paths[0]}`, '--target', dir], { quiet: true });
  const dbs = readdirSync(dir, { recursive: true }).filter((f) => /\.(db|sqlite)$/.test(f)).sort();
  let bad = 0;
  for (const f of dbs) { const r = quickCheck(join(dir, f)); if (r !== 'ok') bad++; console.log(`${r === 'ok' ? 'ok  ' : 'BAD '} ${f}${r === 'ok' ? '' : ` ${r.slice(0, 200)}`}`); }
  console.log(`restore ${stage} ${pick.short_id} (${new Date(pick.time).toISOString()}) -> ${dir}: ${dbs.length - bad}/${dbs.length} databases ok` +
    `; boot one world: ENABLE_WORLD_ENGINE=1 SOUL_LIFECYCLE=1 node tools/god-skill/dev-world.mjs <slug> <port> --data ${join(dir, 'worlds', '<slug>')}`);
  if (bad || !dbs.length) process.exitCode = 1;
}

const [cmd, stage, ...rest] = process.argv.slice(2);
const usage = () => { console.error('usage: backup-restic.mjs backup <stage> | restore <stage> <latest|YYYY-MM-DD|snapshot> <dir> | list [<stage>]'); process.exit(2); };
if (stage && !STAGE_RE.test(stage)) usage();
try {
  if (cmd === 'backup' && stage) await runBackup(stage);
  else if (cmd === 'restore' && stage && rest.length === 2) runRestore(stage, rest[0], rest[1]);
  else if (cmd === 'list') for (const s of snapshots(stage)) console.log(`${s.short_id}  ${new Date(s.time).toISOString().slice(0, 16)}Z  ${s.hostname}  ${(s.tags ?? []).join(',')}  ${s.paths.join(' ')}`);
  else usage();
} catch (e) { console.error(`${cmd} ${stage ?? ''}: ${e.message}`); process.exitCode = 1; }
