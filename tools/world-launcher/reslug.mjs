#!/usr/bin/env node
// Offline registry-only URL migration. Never opens a world or account database.
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SLUG_RE, dataSlugOf, worldIdOf } from './registry.mjs';

export function reslugRegistry(registry, mappings, legacyBase = '/worlds') {
  if (!registry || !Array.isArray(registry.worlds) || !Array.isArray(mappings) || !mappings.length) throw Error('a worlds registry and mappings are required');
  if (!/^\/[a-z][a-z0-9-]{0,31}$/.test(legacyBase)) throw Error('invalid legacy base');
  const next = structuredClone(registry), names = new Set(), destinations = new Set();
  for (const w of next.worlds) {
    if (!SLUG_RE.test(w?.slug ?? '') || !SLUG_RE.test(dataSlugOf(w)) || !SLUG_RE.test(w.worldKey ?? w.slug) || !/^[a-z][a-z0-9-]{0,63}$/.test(worldIdOf(w)) || !Array.isArray(w.aliases ?? []) || (w.aliases?.length ?? 0) > 32) throw Error('malformed world entry');
    for (const name of [w.slug, ...(w.aliases ?? [])]) {
      if (!SLUG_RE.test(name) || names.has(name)) throw Error('duplicate or malformed slug/alias');
      names.add(name);
    }
  }
  const sources = new Set();
  for (const pair of mappings) {
    if (!Array.isArray(pair) || pair.length !== 2) throw Error('mapping must be old=new');
    const [from, to] = pair;
    if (!SLUG_RE.test(from) || !SLUG_RE.test(to) || from === to || sources.has(from) || destinations.has(to) || names.has(to)) throw Error('invalid mapping or slug collision');
    const w = next.worlds.find((w) => w.slug === from);
    if (!w || w.fork) throw Error('source must be an existing entity world (forks cannot be re-slugged)');
    if ((w.aliases?.length ?? 0) >= 32) throw Error('alias limit reached');
    sources.add(from); destinations.add(to);
    Object.assign(w, { slug: to, dataSlug: dataSlugOf(w), worldId: worldIdOf(w), worldKey: w.worldKey ?? from, aliases: [...(w.aliases ?? []), from], port: null });
  }
  const bases = next.legacyBases ?? [];
  if (!Array.isArray(bases) || bases.some((b) => !/^\/[a-z][a-z0-9-]{0,31}$/.test(b)) || bases.length > 8) throw Error('invalid legacy bases');
  next.legacyBases = [...new Set([...bases, legacyBase])];
  if (next.legacyBases.length > 8) throw Error('legacy base limit reached');
  return next;
}

export function migrateRegistry(dataDir, mappings, { apply = false, offline = false, legacyBase = '/worlds' } = {}) {
  const file = join(dataDir, 'worlds.json'), bytes = readFileSync(file, 'utf8');
  const before = JSON.parse(bytes), after = reslugRegistry(before, mappings, legacyBase);
  // A new URL may not take the name of an unregistered/archived data directory.
  for (const [, to] of mappings) if (existsSync(join(dataDir, 'worlds', to))) throw Error('destination data directory already exists');
  if (apply) {
    if (!offline) throw Error('--apply requires --offline: stop the launcher and all its world processes first');
    const backup = join(dataDir, 'worlds.before-reslug.json');
    writeFileSync(backup, bytes, { flag: 'wx', mode: 0o600 }); // never overwrite a previous migration backup
    const temp = `${file}.${process.pid}.reslug.tmp`;
    writeFileSync(temp, JSON.stringify(after, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    // Catch an accidental concurrent registry write. Offline operation remains mandatory.
    if (readFileSync(file, 'utf8') !== bytes) throw Error('registry changed during migration; no replacement made');
    renameSync(temp, file);
  }
  return { applied: apply, worlds: after.worlds.length, renamed: mappings.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), dataDir = args.shift(), mappings = []; let apply = false, offline = false, legacyBase = '/worlds';
    if (!dataDir || dataDir.startsWith('--')) throw Error('usage: reslug.mjs DATA_DIR old=new ... [--legacy-base /worlds] [--apply --offline]');
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--apply') apply = true;
      else if (args[i] === '--offline') offline = true;
      else if (args[i] === '--legacy-base') legacyBase = args[++i];
      else mappings.push(args[i].split('='));
    }
    console.log(JSON.stringify(migrateRegistry(resolve(dataDir), mappings, { apply, offline, legacyBase })));
  } catch (e) { console.error(`reslug: ${e.message}`); process.exitCode = 1; }
}
