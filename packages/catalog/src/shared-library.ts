// The shared object library across worlds (lane C16 `library`, backlog M4): Gene's "mini Thingiverse".
//
// A creator publishes an object def they made in their world; any other world can find it and place it.
//
//   - Version-pinned. Every publish of a changed def is a new immutable version `<world>/<name>@<n>`, placed into a
//     target world under its own engine ref `lib-<world>-<name>@<n>`. A world keeps exactly the version it placed:
//     version 2 is a different ref with a different hash, so publishing again never moves anyone's furniture.
//     A def's local dependencies (its `extends` parent, parts, contents) travel with it under content-addressed names
//     (`lib-<world>-<dep>-<h8>@1`), so two versions can never disagree about what a dependency means.
//   - Author and licence recorded on every version (who, which world, when; SPDX id, attribution, source; per-asset
//     licence text as uploaded).
//   - Restricted art is never offered. Gene's answer 2 (CATALOG-PROGRAM): the registry enforces redistribution limits.
//     A def that uses a restricted core asset (Little Martians, Mars College internal), extends or contains a
//     non-redistributable core def, or carries a model whose licence text is not CC0/CC-BY is refused at publish
//     (`library.restricted`) and therefore never stored, found or placed elsewhere; `offered()` re-checks on every read.
//   - Moderation: every def body and model file passes ONE seam, `gate` (library-gate.ts `validateUpload`, the
//     call shape of lane C2 `moderation`), before anything is stored.
//
// Layout on disk (write-once except yanked.json and ledger.jsonl):
//   defs/<hash>.json                         portable def/1 body (what a target world `define`s), by its engine hash
//   assets/<sha>.<ext>                       gated model bytes
//   entries/<world>/<name>/<version>.json    share/1 record
//   yanked.json                              ["<world>/<name>@<n>", ...] — gone from find and new placement
//   ledger.jsonl                             publish / yank / refuse, append-only
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync, linkSync, unlinkSync, rmdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { WorldModel, aliasRef, coreLibrary, definitionRefs, hashOf, stableStringify, categoryOf, type DefInput, type StoredDef } from '@sim/world-compiler';
import { licenceOf } from './import-core.ts';
import { idOf } from './ids.ts';
import { ASSET_POLICY, DEF_POLICY, validateUpload, type UploadGate } from './library-gate.ts';

export const SHARE1 = 'share/1' as const;
/** Licences a shared item may carry: redistributable only (our own work is CC0; CC-BY needs an attribution). */
export const SHARE_LICENCES = ['CC0-1.0', 'CC-BY-4.0'] as const;
export type ShareLicence = { spdx: (typeof SHARE_LICENCES)[number]; attribution?: string; source?: string };
export type ShareAsset = { sha: string; ext: string; bytes: number; from: string; licence?: string; source?: string };
export type ShareEntry = {
  schema: typeof SHARE1;
  id: string;                 // <world>/<name>
  version: number;            // 1, 2, … (immutable)
  ref: string;                // the engine ref a target world places: lib-<world>-<name>@<version>
  hash: string;               // the engine hash of that def (what a placing world pins)
  defs: { ref: string; hash: string; from: string }[];   // define order: dependencies first, the item last
  core: string[];             // core refs it relies on (every world resolves these)
  assets: ShareAsset[];
  from: { world: string; ref: string; hash: string };   // the def in the creator's world
  author: { world: string; by: string; name?: string };
  licence: ShareLicence & { redistribute: true };
  text: { title: string; description: string; category: string; tags: string[] };
  moderation: { gate: string; checked: string[] };      // sha of every byte string the gate passed
  at: string;
};
export type FindHit = { id: string; version: number; versions: number[]; ref: string; title: string; first: string; category: string; author: ShareEntry['author']; licence: ShareEntry['licence']; score: number; why: string[]; mine: boolean };

/** Where publish reads from: one world, as its god sees it (GET /v1/god/defs/<ref>, GET /assets/<sha>.<ext>). */
export type WorldSource = {
  world: string;
  def(ref: string): Promise<StoredDef | undefined>;
  asset(sha: string): Promise<{ bytes: Uint8Array; ext: string; license?: string; source?: string; name?: string } | undefined>;
};

export class LibraryError extends Error {
  readonly code: string;
  constructor(code: string, msg: string) { super(`${code}: ${msg}`); this.code = code; }
}

export const WORLD_SLUG = /^[a-z][a-z0-9-]{0,31}$/;
const canon = (v: unknown) => stableStringify(v) + '\n';
const enc = (s: string) => new TextEncoder().encode(s);

// ------------------------------------------------------------------------------------------------ redistribution

const coreAssetsDir = new URL('../../../worlds/core-assets/', import.meta.url);
let restricted: Map<string, string> | null = null;
/** Every core asset sha that may not leave its pack (licence text is not CC0/CC-BY): sha → its licence text. */
export function restrictedCoreAssets(): Map<string, string> {
  if (restricted) return restricted;
  restricted = new Map();
  const files = existsSync(coreAssetsDir) ? readdirSync(coreAssetsDir).filter((n) => n.endsWith('.json')) : [];
  for (const f of files) {
    try {
      const assets = (JSON.parse(readFileSync(new URL(f, coreAssetsDir), 'utf8')) as { assets?: Record<string, { license?: string; footprint?: string }> }).assets ?? {};
      for (const [sha, m] of Object.entries(assets)) if (!openLicence(m.license)) { restricted.set(sha, m.license ?? 'no licence recorded'); if (m.footprint) restricted.set(m.footprint, m.license ?? 'no licence recorded'); }
    } catch { /* a broken index file: its assets stay unknown, and unknown core shas are checked again below */ }
  }
  // belt and braces: every mesh def in the core library that the catalogue marks non-redistributable
  for (const d of coreLibrary().all()) {
    if (d.make.kind !== 'mesh') continue;
    const l = licenceOf(d, idOf(d.name));
    if (!l.redistribute) for (const s of [d.make.asset, d.make.lod1, d.make.footprint]) if (s) restricted.set(s, `${l.spdx} (${l.attribution ?? d.name})`);
  }
  return restricted;
}
/** A licence text that permits redistribution to other owners' worlds. */
export function openLicence(text: string | undefined): boolean {
  if (!text) return false;
  if (/\bNC\b|non-?commercial|\bND\b|no-?deriv|all rights reserved|private|internal|Little Martians|Vanessa Rosa/i.test(text)) return false;
  return /\bCC0\b|CC[- ]?BY(?:[- ]4\.0)?\b|public domain/i.test(text);
}
const RESTRICTED_TEXT = /Little Martians|Vanessa Rosa|all rights reserved|non-?commercial/i;

const isCoreRef = (ref: string) => /^(core\/|core-|eden\/|lm\/|mars\/)/.test(ref) || (ref.startsWith('sha:') && !!coreLibrary().get(ref));

// ------------------------------------------------------------------------------------------------ naming

const slugPart = (s: string) => s.replace(/^core-/, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'thing';
/** The engine name an item (or one of its dependencies) gets in every target world. ≤ 48 chars (NAME). */
export function portableName(world: string, name: string, dep?: string): string {
  const tail = dep ? `-${dep}` : '';
  const full = `lib-${world}-${slugPart(name)}${tail}`;
  if (full.length <= 48) return full;
  const h = hashOf([world, name]).slice(0, 6);
  return `lib-${world.slice(0, 10)}-${slugPart(name).slice(0, 48 - 4 - 10 - 1 - 7 - tail.length)}-${h}${tail}`;
}
const titleOf = (name: string) => slugPart(name).split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

/** The engine hash a world computes when it `define`s this body (the same path as WorldModel.defineDef). */
export function engineHash(body: DefInput): string {
  return new WorldModel({ constants: { ground: 'land', extent: 1000 }, seed: 'library' }).defineDef(structuredClone(body), 'library', 0).hash;
}
/** A stored def back to the body a world can `define` (no hash/ref/by/born/budget: the target recomputes those). */
function bodyOf(d: StoredDef): DefInput {
  const { hash: _h, ref: _r, by: _b, born: _n, budget: _u, ...body } = d as StoredDef & { budget?: unknown };
  return structuredClone(body) as DefInput;
}
/** Replace exact string values (refs, sha:refs, asset shas) anywhere in a def body. */
function rewrite<T>(v: T, map: Map<string, string>): T {
  if (typeof v === 'string') return (map.get(v) ?? v) as T;
  if (Array.isArray(v)) return v.map((x) => rewrite(x, map)) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rewrite(x, map)])) as T;
  return v;
}
const assetsOf = (d: { make: StoredDef['make'] }) => d.make.kind === 'mesh' ? [d.make.asset, d.make.lod1, d.make.footprint].filter((s): s is string => !!s) : [];

// ------------------------------------------------------------------------------------------------ the library

export class SharedLibrary {
  readonly root: string;
  readonly gate: UploadGate;
  readonly gateName: string;
  constructor(root: string, opts: { gate?: UploadGate; gateName?: string } = {}) {
    this.root = root; mkdirSync(root, { recursive: true });
    this.gate = opts.gate ?? validateUpload; this.gateName = opts.gateName ?? (opts.gate ? 'custom' : 'library-gate/local');
  }

  // ---------------------------------------------------------------- storage
  private writeOnce(rel: string, body: Uint8Array | string): void {
    const p = join(this.root, rel), b = typeof body === 'string' ? enc(body) : body;
    if (existsSync(p)) { if (!Buffer.from(readFileSync(p)).equals(Buffer.from(b))) throw new LibraryError('library.immutable', `${rel} exists with other content`); return; }
    mkdirSync(dirname(p), { recursive: true });
    const tmp = `${p}.tmp-${process.pid}`; writeFileSync(tmp, b, { flag: 'wx' });
    try { try { linkSync(tmp, p); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; if (!Buffer.from(readFileSync(p)).equals(Buffer.from(b))) throw new LibraryError('library.immutable', `${rel} exists with other content`); } }
    finally { unlinkSync(tmp); }
  }
  private locked<T>(fn: () => T): T {
    const lock = join(this.root, '.lock');
    try { mkdirSync(lock); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new LibraryError('library.busy', 'another publish is in progress; retry'); throw e; }
    try { return fn(); } finally { rmdirSync(lock); }
  }
  log(rec: Record<string, unknown>) { appendFileSync(join(this.root, 'ledger.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...rec }) + '\n'); }
  ledger(): Record<string, unknown>[] { const f = join(this.root, 'ledger.jsonl'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; }

  defBody(hash: string): DefInput { const f = join(this.root, 'defs', `${hash}.json`); if (!existsSync(f)) throw new LibraryError('library.missing', `def ${hash.slice(0, 12)}`); return JSON.parse(readFileSync(f, 'utf8')); }
  assetBytes(a: Pick<ShareAsset, 'sha' | 'ext'>): Uint8Array { return new Uint8Array(readFileSync(join(this.root, 'assets', `${a.sha}.${a.ext}`))); }
  yanked(): Set<string> { const f = join(this.root, 'yanked.json'); return new Set(existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) as string[] : []); }

  /** Every version of an item, oldest first. */
  versions(id: string): ShareEntry[] {
    const d = join(this.root, 'entries', id);
    if (!/^[a-z][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*$/.test(id) || !existsSync(d)) return [];
    return readdirSync(d).filter((f) => /^\d+\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(d, f), 'utf8')) as ShareEntry).sort((a, b) => a.version - b.version);
  }
  /** Every item id in the library. */
  ids(): string[] {
    const e = join(this.root, 'entries'); if (!existsSync(e)) return [];
    return readdirSync(e).flatMap((w) => readdirSync(join(e, w)).map((n) => `${w}/${n}`)).sort();
  }
  /** `<world>/<name>` (latest offered version) or `<world>/<name>@<n>` (that version, offered or not). */
  get(spec: string): ShareEntry | null {
    const m = /^(.+?)(?:@(\d+))?$/.exec(spec)!; const all = this.versions(m[1]);
    if (m[2]) return all.find((e) => e.version === Number(m[2])) ?? null;
    const y = this.yanked(); return [...all].reverse().find((e) => !y.has(`${e.id}@${e.version}`)) ?? null;
  }

  /** Redistribution + yank check, on every read: may this version be offered to (and newly placed in) `world`? */
  offered(e: ShareEntry, _world?: string): { ok: boolean; why?: string } {
    if (this.yanked().has(`${e.id}@${e.version}`)) return { ok: false, why: 'yanked' };
    if (!e.licence?.redistribute || !(SHARE_LICENCES as readonly string[]).includes(e.licence.spdx)) return { ok: false, why: 'not redistributable' };
    const bad = e.assets.find((a) => restrictedCoreAssets().has(a.sha) || (a.licence && !openLicence(a.licence)));
    if (bad) return { ok: false, why: `restricted asset ${bad.sha.slice(0, 12)}` };
    return { ok: true };
  }

  // ---------------------------------------------------------------- publish
  /**
   * Publish `ref` from a world: collect its local closure, refuse restricted art, gate every byte string, write a new
   * immutable version (or return the latest when nothing changed).
   */
  async publish(src: WorldSource, ref: string, opts: { by: string; licence: ShareLicence; title?: string; authorName?: string; now?: string }): Promise<{ entry: ShareEntry; created: boolean }> {
    const world = src.world;
    if (!WORLD_SLUG.test(world)) throw new LibraryError('library.invalid', `world slug ${world}`);
    const fail = (code: string, msg: string): never => { this.log({ op: 'refuse', world, ref, code, msg }); throw new LibraryError(code, msg); };
    if (!(SHARE_LICENCES as readonly string[]).includes(opts.licence.spdx)) fail('library.licence', `licence ${opts.licence.spdx}: the shared library takes ${SHARE_LICENCES.join(' or ')} (restricted work stays in its own world)`);
    if (opts.licence.spdx === 'CC-BY-4.0' && !opts.licence.attribution?.trim()) fail('library.licence', 'CC-BY-4.0 needs an attribution');
    if (isCoreRef(ref)) fail('library.core', `${ref} is already in the core catalogue every world has`);

    // 1. the local closure (post-order: dependencies first)
    const order: StoredDef[] = [], core = new Set<string>(), seen = new Map<string, StoredDef>(), active = new Set<string>();
    const visit = async (r: string, depth: number): Promise<StoredDef> => {
      if (depth > 8) fail('library.depth', `${ref}: dependencies nest deeper than 8`);
      const d = await src.def(r); if (!d) fail('library.missing', `${r} is not defined in ${world}`);
      const def = d!;
      if (seen.has(def.hash)) return seen.get(def.hash)!;
      if (active.has(def.hash)) fail('library.cycle', `${r} depends on itself`);
      active.add(def.hash);
      for (const dep of definitionRefs(bodyOf(def))) {
        if (isCoreRef(dep)) {
          const c = coreLibrary().get(aliasRef(dep));
          if (!c) fail('library.missing', `${r} uses ${dep}, which is not in the core catalogue`);
          const l = licenceOf(c!, idOf(c!.name));
          if (!l.redistribute) fail('library.restricted', `${r} uses ${c!.ref} (${l.spdx}, ${l.attribution ?? 'restricted'}), which may not leave its pack`);
          core.add(c!.ref);
        } else await visit(dep, depth + 1);
      }
      active.delete(def.hash); seen.set(def.hash, def); order.push(def);
      return def;
    };
    const rootDef = await visit(ref, 0);

    // 2. models: licence and redistribution, then the moderation gate
    const assets: ShareAsset[] = [], shaMap = new Map<string, string>(), checked: string[] = [];
    const blobs: { rel: string; bytes: Uint8Array }[] = [];
    for (const d of order) for (const sha of assetsOf(d)) {
      if (assets.some((a) => a.from === sha)) continue;
      const why = restrictedCoreAssets().get(sha);
      if (why) fail('library.restricted', `${d.ref} draws a restricted model (${why.slice(0, 80)}); it is never offered to other worlds`);
      const a = await src.asset(sha); if (!a) fail('library.missing', `${d.ref}: model ${sha.slice(0, 12)} is not in ${world}`);
      const text = [a!.license, a!.source, a!.name].filter(Boolean).join(' ');
      if (RESTRICTED_TEXT.test(text) || (a!.license && !openLicence(a!.license))) fail('library.restricted', `${d.ref}: model ${sha.slice(0, 12)} is licensed "${(a!.license ?? '').slice(0, 80)}", which may not be redistributed`);
      if (!a!.license && opts.licence.spdx !== 'CC0-1.0' && !opts.licence.source) fail('library.licence', `${d.ref}: model ${sha.slice(0, 12)} has no licence on record; pass a source for it`);
      if (a!.license && /CC[- ]?BY/i.test(a!.license) && !/\bCC0\b/i.test(a!.license) && opts.licence.spdx === 'CC0-1.0') fail('library.licence', `${d.ref}: model ${sha.slice(0, 12)} is ${a!.license}; publish as CC-BY-4.0 with its attribution`);
      const g = this.gate(a!.bytes, ASSET_POLICY);
      checked.push(g.sha); shaMap.set(sha, g.sha);
      assets.push({ sha: g.sha, ext: a!.ext, bytes: g.bytes.byteLength, from: sha, ...(a!.license ? { licence: a!.license } : {}), ...(a!.source ? { source: a!.source } : {}) });
      blobs.push({ rel: `assets/${g.sha}.${a!.ext}`, bytes: g.bytes });
    }
    if (order.some((d) => d.make.kind === 'mesh' && RESTRICTED_TEXT.test(d.description))) fail('library.restricted', `${ref}: a model in it is described as restricted art`);

    // 3. portable bodies, bottom-up: rename local refs, re-point gated asset shas, hash as a target world will
    const id = `${world}/${slugPart(rootDef.name)}`;
    return this.locked(() => {
      const prior = this.versions(id), latest = prior.at(-1);
      const refMap = new Map<string, string>(shaMap);
      const portable: { body: DefInput; hash: string; ref: string; from: string }[] = [];
      const put = (d: StoredDef, root: boolean, version: number) => {
        let body = rewrite(bodyOf(d), refMap);
        if (root) body = { ...body, name: portableName(world, d.name), version };
        else { const h8 = hashOf({ ...body, name: '' }).slice(0, 8); body = { ...body, name: portableName(world, d.name, h8), version: 1 }; }
        const hash = engineHash(body), pref = `${body.name}@${body.version}`;
        for (const k of [d.ref, `sha:${d.hash}`]) refMap.set(k, k.startsWith('sha:') ? `sha:${hash}` : pref);
        portable.push({ body, hash, ref: pref, from: d.ref });
      };
      for (const d of order.slice(0, -1)) put(d, false, 1);
      // nothing changed since the latest version → that version (publishing is idempotent)
      if (latest) {
        put(rootDef, true, latest.version);
        if (portable.at(-1)!.hash === latest.hash) return { entry: latest, created: false };
        portable.pop();
      }
      const version = (latest?.version ?? 0) + 1;
      put(rootDef, true, version);
      for (const p of portable) { const g = this.gate(enc(canon(p.body)), DEF_POLICY); checked.push(g.sha); }
      const root = portable.at(-1)!;
      const entry: ShareEntry = {
        schema: SHARE1, id, version, ref: root.ref, hash: root.hash,
        defs: portable.map((p) => ({ ref: p.ref, hash: p.hash, from: p.from })),
        core: [...core].sort(), assets,
        from: { world, ref: rootDef.ref, hash: rootDef.hash },
        author: { world, by: opts.by, ...(opts.authorName ? { name: opts.authorName } : {}) },
        licence: { ...opts.licence, redistribute: true },
        text: { title: opts.title?.slice(0, 60) || titleOf(rootDef.name), description: rootDef.description ?? '', category: categoryOf(rootDef as never), tags: [...(rootDef.tags ?? [])] },
        moderation: { gate: this.gateName, checked },
        at: opts.now ?? new Date().toISOString(),
      };
      for (const b of blobs) this.writeOnce(b.rel, b.bytes);
      for (const p of portable) this.writeOnce(`defs/${p.hash}.json`, canon(p.body));
      this.writeOnce(`entries/${id}/${version}.json`, canon(entry));
      this.log({ op: 'publish', id, version, hash: entry.hash, by: opts.by, licence: entry.licence.spdx, defs: entry.defs.length, assets: assets.length });
      return { entry, created: true };
    });
  }

  /** Take a version out of find and new placement. Worlds that placed it keep it (they store its def by hash). */
  yank(spec: string, by: string, reason: string): void {
    const e = this.get(spec); if (!e) throw new LibraryError('library.missing', spec);
    this.locked(() => {
      const y = this.yanked(); y.add(`${e.id}@${e.version}`);
      const f = join(this.root, 'yanked.json'), tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, JSON.stringify([...y].sort(), null, 1) + '\n'); renameSync(tmp, f);
      this.log({ op: 'yank', id: e.id, version: e.version, by, reason });
    });
  }

  // ---------------------------------------------------------------- find
  /** Lexical find over what may be offered to `forWorld` (latest offered version per item). */
  find(q: string, opts: { forWorld?: string; k?: number } = {}): FindHit[] {
    const words = q.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
    const hits: FindHit[] = [];
    for (const id of this.ids()) {
      const e = this.get(id); if (!e || !this.offered(e, opts.forWorld).ok) continue;
      const fields: [string, string, number][] = [['title', e.text.title.toLowerCase(), 3], ['name', id.toLowerCase(), 3], ['tags', e.text.tags.join(' ').toLowerCase(), 2], ['category', e.text.category.replace(/\./g, ' '), 2], ['description', e.text.description.toLowerCase(), 1], ['author', `${e.author.world} ${e.author.name ?? ''}`.toLowerCase(), 1]];
      let score = 0; const why: string[] = [];
      for (const w of words) {
        const f = fields.find(([, text]) => new RegExp(`\\b${w}`).test(text));
        if (f) { score += f[2]; why.push(`${w}:${f[0]}`); }
      }
      if (words.length && !score) continue;
      const vs = this.versions(id).filter((v) => this.offered(v).ok).map((v) => v.version);
      hits.push({ id, version: e.version, versions: vs, ref: e.ref, title: e.text.title, first: e.text.description.split(/(?<=\.)\s/)[0].slice(0, 160), category: e.text.category, author: e.author, licence: e.licence, score, why, mine: e.author.world === opts.forWorld });
    }
    return hits.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1)).slice(0, opts.k ?? 10);
  }

  // ---------------------------------------------------------------- place
  /**
   * What a target world runs to place a version: the models to upload first, then ONE batch of `define` ops
   * (dependencies first) and the `place`. `existing` is the target's own def for a ref (to refuse a name clash).
   */
  placement(spec: string, opts: { world: string; name?: string; p?: [number, number, number]; r?: number; existing?: (ref: string) => { hash: string } | undefined }): { entry: ShareEntry; assets: ShareAsset[]; ops: Record<string, unknown>[] } {
    const e = this.get(spec);
    if (!e) throw new LibraryError('library.missing', `${spec} is not in the shared library`);
    const ok = this.offered(e, opts.world);
    if (!ok.ok) throw new LibraryError(ok.why === 'yanked' ? 'library.yanked' : 'library.restricted', `${e.id}@${e.version} is not offered (${ok.why})`);
    for (const d of e.defs) { const has = opts.existing?.(d.ref); if (has && has.hash !== d.hash) throw new LibraryError('library.conflict', `${opts.world} already has a different ${d.ref}`); }
    const ops: Record<string, unknown>[] = e.defs.filter((d) => !opts.existing?.(d.ref)).map((d) => ({ op: 'define', def: this.defBody(d.hash) }));
    ops.push({ op: 'place', def: e.ref, ...(opts.name ? { name: opts.name } : {}), p: opts.p ?? [0, 0, 0], ...(opts.r !== undefined ? { r: opts.r } : {}) });
    return { entry: e, assets: e.assets, ops };
  }
}
