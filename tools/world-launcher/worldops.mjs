// World housekeeping for the launcher (lane WORLDOPS): archive-first delete and restore, an audit log, and the few
// world-database reads/writes the launcher needs for ownership (god tokens, owner). Nothing here deletes world data:
// an archived world's folder is moved, whole, under <data>/archive/<id>/world and comes back with one command.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const ARCHIVE_SCHEMA = 'world-archive/1';
const ID_RE = /^[a-z][a-z0-9-]{0,31}-\d{8}T\d{6}Z(-\d+)?$/;
const writeJson = (file, v) => { const tmp = `${file}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(v, null, 2) + '\n'); renameSync(tmp, file); };
const stamp = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

/** Append-only record of who did what to which world (<data>/audit.jsonl). */
export function audit(dataDir, row) {
  appendFileSync(join(dataDir, 'audit.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...row }) + '\n');
}
export function readAudit(dataDir, slug) {
  let lines = []; try { lines = readFileSync(join(dataDir, 'audit.jsonl'), 'utf8').split('\n').filter(Boolean); } catch { return []; }
  return lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && (!slug || r.slug === slug));
}

// ---------- archive
const archiveRoot = (dataDir) => join(dataDir, 'archive');
export function listArchive(dataDir) {
  let ids = []; try { ids = readdirSync(archiveRoot(dataDir)).filter((d) => ID_RE.test(d)).sort(); } catch { return []; }
  const out = [];
  for (const id of ids) {
    try {
      const a = JSON.parse(readFileSync(join(archiveRoot(dataDir), id, 'archived.json'), 'utf8'));
      if (a.schema === ARCHIVE_SCHEMA) out.push({ id, slug: a.slug, name: a.entry?.name ?? a.slug, archivedAt: a.at, by: a.by, restoredAt: a.restoredAt ?? null, hasData: existsSync(join(archiveRoot(dataDir), id, 'world')) });
    } catch { /* a half-written record is skipped */ }
  }
  return out;
}
/** Slugs of archived (not restored) worlds: a new world never takes one, so a restore always has its address back. */
export const archivedSlugs = (dataDir) => new Set(listArchive(dataDir).filter((a) => !a.restoredAt).map((a) => a.slug));

/**
 * Stop a world, move its folder into the archive and drop it from the registry. Order matters for a crash halfway:
 * the record is written first, the registry entry goes next, the data moves last (a world left unregistered with
 * its data still in place is finished by restore; its slug stays reserved by the record).
 */
export async function archiveWorld({ registry, pool, dataDir }, slug, by, reason) {
  const w = registry.get(slug); if (!w) return null;
  const child = pool.state(slug)?.child;
  await pool.stop(slug); pool.kids.delete(slug);
  // the database must be closed before its folder moves: wait for the process to be gone (stop may have SIGKILLed it)
  if (child && child.exitCode === null && child.signalCode === null) await Promise.race([new Promise((r) => child.once('exit', r)), new Promise((r) => setTimeout(r, 5000))]);
  const at = Date.now();
  let id = `${slug}-${stamp(at)}`;
  for (let i = 2; existsSync(join(archiveRoot(dataDir), id)); i++) id = `${slug}-${stamp(at)}-${i}`;
  const dest = join(archiveRoot(dataDir), id); mkdirSync(dest, { recursive: true });
  const { port: _p, ...entry } = w;
  writeJson(join(dest, 'archived.json'), { schema: ARCHIVE_SCHEMA, id, slug, entry, at: new Date(at).toISOString(), by, ...(reason ? { reason: String(reason).slice(0, 200) } : {}) });
  const src = registry.worldDir(slug);
  registry.remove(slug);
  if (existsSync(src)) renameSync(src, join(dest, 'world'));
  audit(dataDir, { op: 'archive', slug, id, by, ...(reason ? { reason: String(reason).slice(0, 200) } : {}) });
  return { id, slug, archive: dest };
}

/** Put an archived world back exactly where it was (same slug, same data, same owner); it wakes on first visit. */
export function restoreWorld({ registry, dataDir }, id, by) {
  if (!ID_RE.test(id ?? '')) return [400, { ok: false, code: 'invalid', message: 'id: an archive id from list-archive' }];
  const dest = join(archiveRoot(dataDir), id), recFile = join(dest, 'archived.json');
  let rec; try { rec = JSON.parse(readFileSync(recFile, 'utf8')); } catch { return [404, { ok: false, code: 'not-found', message: `no archive ${id}` }]; }
  if (rec.restoredAt) return [409, { ok: false, code: 'restored', message: `${id} was already restored at ${rec.restoredAt}` }];
  if (registry.slugs().has(rec.slug) || (rec.entry.aliases ?? []).some((s) => registry.slugs().has(s))) return [409, { ok: false, code: 'exists', message: `a world ${rec.slug} is registered; archive or rename it first` }];
  const data = join(dest, 'world'), target = registry.worldDir(rec.slug, rec.entry);
  if (existsSync(data)) {
    if (existsSync(target)) return [409, { ok: false, code: 'occupied', message: `${target} exists; move it aside first` }];
    mkdirSync(join(registry.dataDir, 'worlds'), { recursive: true });
    renameSync(data, target);
  } else if (!existsSync(target)) return [409, { ok: false, code: 'no-data', message: `${id} holds no world data` }];
  registry.add({ ...rec.entry, slug: rec.slug, port: null });
  writeJson(recFile, { ...rec, restoredAt: new Date().toISOString(), restoredBy: by });
  audit(dataDir, { op: 'restore', slug: rec.slug, id, by });
  return [200, { ok: true, slug: rec.slug, id }];
}

// ---------- the world's own database (owner, god tokens); the launcher opens it only while the world is stopped,
// except for read-only lookups and single-row token inserts (WAL + busy timeout, as the server itself allows)
const open = (file, readOnly = false) => { const db = new DatabaseSync(file, { readOnly }); if (!readOnly) db.exec('PRAGMA busy_timeout = 5000'); return db; };
export const hashToken = (t) => createHash('sha256').update(t).digest('hex');
/** The label of a god token of this world, '' for an unlabelled one, or null if it is not one. */
export function tokenLabel(file, worldId, token) {
  if (!existsSync(file) || !/^god_\S+$/.test(token ?? '')) return null;
  const db = open(file, true);
  try { const r = db.prepare('SELECT label FROM god_tokens_v1 WHERE world_id=? AND token_hash=?').get(worldId, hashToken(token)); return r ? (r.label ?? '') : null; }
  catch { return null; } finally { db.close(); }
}
export function addGodToken(file, worldId, token, label) {
  const db = open(file);
  try { db.prepare('INSERT INTO god_tokens_v1 (world_id, token_hash, label, created_at) VALUES (?, ?, ?, ?)').run(worldId, hashToken(token), label.slice(0, 60), Date.now()); }
  finally { db.close(); }
}
/** Remove god tokens (all, or those whose label starts with `prefix`); returns how many. */
export function dropGodTokens(file, worldId, prefix) {
  const db = open(file);
  try {
    const r = prefix === undefined
      ? db.prepare('DELETE FROM god_tokens_v1 WHERE world_id=?').run(worldId)
      : db.prepare('DELETE FROM god_tokens_v1 WHERE world_id=? AND substr(label, 1, ?)=?').run(worldId, prefix.length, prefix);
    return Number(r.changes);
  } finally { db.close(); }
}
/** Rewrite the owner in the world's meta row (the world must be stopped). */
export function setWorldOwner(file, worldId, owner) {
  const db = open(file);
  try {
    const r = db.prepare('SELECT body FROM world_meta_v1 WHERE world_id=?').get(worldId);
    if (!r) throw new Error(`no world_meta_v1 row for ${worldId}`);
    db.prepare('UPDATE world_meta_v1 SET body=? WHERE world_id=?').run(JSON.stringify({ ...JSON.parse(r.body), owner }), worldId);
  } finally { db.close(); }
}
